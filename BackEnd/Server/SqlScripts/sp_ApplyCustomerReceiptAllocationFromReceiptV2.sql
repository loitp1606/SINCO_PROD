ALTER PROCEDURE [dbo].[sp_ApplyCustomerReceiptAllocationFromReceiptV2]
    @idGui NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NULL
           OR OBJECT_ID('dbo.CustomerReceiptAllocation', 'U') IS NULL
            RETURN;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @customerCode NVARCHAR(50),
            @voucherNumber NVARCHAR(100),
            @voucherDate DATE,
            @receiptType NVARCHAR(30),
            @masterAmount DECIMAL(24,6),
            @resolvedUnitCode NVARCHAR(50),
            @status NVARCHAR(10),
            @isReceived INT,
            @allocatedTotal DECIMAL(24,6),
            @depositBalance DECIMAL(24,6);

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.receiptV2$000000
        WHERE idGui = @idGui;

        IF @sync IS NULL RETURN;

        CREATE TABLE #$_mt
        (
            customerCode NVARCHAR(50) NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            receiptType NVARCHAR(30) NULL,
            total_amount DECIMAL(24,6) NULL,
            unitCode NVARCHAR(50) NULL,
            status NVARCHAR(10) NULL,
            isReceived INT NULL
        );

        SET @q = N'
            INSERT INTO #$_mt(customerCode, voucherNumber, voucherDate, receiptType, total_amount, unitCode, status, isReceived)
            SELECT TOP 1
                customerCode, voucherNumber, TRY_CONVERT(date, voucherDate),
                ISNULL(receiptType, N''CUSTOMER''), TRY_CONVERT(decimal(24,6), total_amount),
                unitCode, status, TRY_CONVERT(int, isReceived)
            FROM dbo.receiptV2$' + @sync + N'
            WHERE idGui = @p_idGui;';

        EXEC sp_executesql @q, N'@p_idGui nvarchar(50)', @p_idGui = @idGui;

        SELECT TOP 1
            @customerCode = customerCode,
            @voucherNumber = voucherNumber,
            @voucherDate = voucherDate,
            @receiptType = UPPER(ISNULL(receiptType, N'CUSTOMER')),
            @masterAmount = ISNULL(total_amount, 0),
            @resolvedUnitCode = unitCode,
            @status = status,
            @isReceived = ISNULL(isReceived, 0)
        FROM #$_mt;

        IF @customerCode IS NULL OR @receiptType NOT IN (N'CUSTOMER', N'DEPOSIT_OFFSET')
            RETURN;

        -- Phiếu nháp không làm thay đổi công nợ hay tiền đặt cọc.
        IF ISNULL(@status, N'0') <> N'1' AND ISNULL(@isReceived, 0) <> 1
            RETURN;

        IF NULLIF(LTRIM(RTRIM(@unitCode)), N'') IS NOT NULL
            SET @resolvedUnitCode = @unitCode;
        IF NULLIF(LTRIM(RTRIM(@resolvedUnitCode)), N'') IS NULL
            SET @resolvedUnitCode = N'CTY';

        SELECT @allocatedTotal = ISNULL(SUM(ISNULL(AllocatedAmount, 0)), 0)
        FROM dbo.CustomerReceiptAllocation
        WHERE ReceiptIdGui = @idGui;

        IF @allocatedTotal <= 0
        BEGIN
            BEGIN TRAN;

            DELETE dbo.CustomerDebtLedger
            WHERE RefController = N'receiptV2'
              AND ReceiptIdGui = @idGui
              AND ReceiptType IN (N'RECEIPT_CUSTOMER', N'RECEIPT_DEPOSIT_OFFSET', N'RECEIPT_DEPOSIT');

            COMMIT;
            RETURN;
        END;

        IF @allocatedTotal > ISNULL(@masterAmount, 0)
            RAISERROR(N'Tổng phân bổ vượt quá số tiền phiếu thu.', 16, 1);

        IF @receiptType = N'DEPOSIT_OFFSET' AND @allocatedTotal <> ISNULL(@masterAmount, 0)
            RAISERROR(N'Thu công nợ từ tiền đặt cọc phải phân bổ hết số tiền cấn trừ.', 16, 1);

        IF @receiptType = N'DEPOSIT_OFFSET'
        BEGIN
            SELECT @depositBalance = ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), DepositAmount), 0)), 0)
            FROM dbo.CustomerDebtLedger
            WHERE CustomerId = @customerCode
              AND UnitCode = @resolvedUnitCode
              AND ISNULL(ReceiptIdGui, N'') <> @idGui
              AND UPPER(ISNULL(ReceiptType, N'')) IN (N'DEPOSIT', N'RECEIPT_DEPOSIT', N'RECEIPT_DEPOSIT_OFFSET');

            IF @masterAmount > @depositBalance
                RAISERROR(N'Số tiền cấn trừ vượt quá tiền đặt cọc hiện có của khách hàng.', 16, 1);
        END;

        BEGIN TRAN;

        DELETE dbo.CustomerDebtLedger
        WHERE RefController = N'receiptV2'
          AND ReceiptIdGui = @idGui
          AND ReceiptType IN (N'RECEIPT_CUSTOMER', N'RECEIPT_DEPOSIT_OFFSET', N'RECEIPT_DEPOSIT');

        INSERT dbo.CustomerDebtLedger
        (
            UnitCode, CustomerId, ReceiptIdGui, VoucherNumber, VoucherDate,
            ReceiptType, DebitAmount, CreditAmount, DepositAmount, CollectedAmount,
            ReceivableAmount, RefController, RefIdGui, RefLineNbr, Note,
            CreatedBy, CreatedAt
        )
        SELECT
            @resolvedUnitCode, @customerCode, @idGui, @voucherNumber, @voucherDate,
            CASE WHEN @receiptType = N'DEPOSIT_OFFSET' THEN N'RECEIPT_DEPOSIT_OFFSET' ELSE N'RECEIPT_CUSTOMER' END,
            0, 0,
            CASE WHEN @receiptType = N'DEPOSIT_OFFSET' THEN -ISNULL(a.AllocatedAmount, 0) ELSE 0 END,
            ISNULL(a.AllocatedAmount, 0), 0, N'receiptV2', a.RefIdGuiDN, a.RefLineNbrDN,
            CASE WHEN @receiptType = N'DEPOSIT_OFFSET'
                 THEN N'Thu công nợ từ tiền đặt cọc'
                 ELSE N'Thu công nợ trực tiếp' END,
            @userId, SYSDATETIME()
        FROM dbo.CustomerReceiptAllocation a
        WHERE a.ReceiptIdGui = @idGui
          AND ISNULL(a.AllocatedAmount, 0) > 0;

        -- Tiền thu trực tiếp vượt phần công nợ được ghi nhận thành tiền đặt cọc.
        IF @receiptType = N'CUSTOMER' AND @masterAmount > @allocatedTotal
        BEGIN
            INSERT dbo.CustomerDebtLedger
            (
                UnitCode, CustomerId, ReceiptIdGui, VoucherNumber, VoucherDate,
                ReceiptType, DebitAmount, CreditAmount, DepositAmount, CollectedAmount,
                ReceivableAmount, RefController, RefIdGui, RefLineNbr, Note,
                CreatedBy, CreatedAt
            )
            VALUES
            (
                @resolvedUnitCode, @customerCode, @idGui, @voucherNumber, @voucherDate,
                N'RECEIPT_DEPOSIT', 0, 0, @masterAmount - @allocatedTotal, 0,
                0, N'receiptV2', @idGui, NULL,
                N'Tiền thu công nợ dư chuyển thành tiền đặt cọc', @userId, SYSDATETIME()
            );
        END;

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@err, 16, 1);
    END CATCH
END
GO
