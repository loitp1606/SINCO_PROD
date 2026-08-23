ALTER PROCEDURE [dbo].[sp_PostDebtFromReceiptV2]
    @idGui NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @customerCode NVARCHAR(50),
            @voucherNumber NVARCHAR(100),
            @voucherDate DATE,
            @receiptType NVARCHAR(30),
            @masterAmount DECIMAL(24, 6),
            @resolvedUnitCode NVARCHAR(50),
            @depositReceiptNo NVARCHAR(50),
            @status NVARCHAR(10),
            @isReceived INT;

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.receiptV2$000000
        WHERE idGui = @idGui;

        IF @sync IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#mt') IS NOT NULL DROP TABLE #mt;
        CREATE TABLE #mt
        (
            customerCode NVARCHAR(50) NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            receiptType NVARCHAR(30) NULL,
            total_amount DECIMAL(24, 6) NULL,
            unitCode NVARCHAR(50) NULL,
            depositReceiptNo NVARCHAR(50) NULL,
            status NVARCHAR(10) NULL,
            isReceived INT NULL
        );

        SET @q = N'
            INSERT INTO #mt(customerCode, voucherNumber, voucherDate, receiptType, total_amount, unitCode, depositReceiptNo, status, isReceived)
            SELECT TOP 1
                customerCode,
                voucherNumber,
                TRY_CONVERT(date, voucherDate),
                ISNULL(receiptType, N''CUSTOMER''),
                TRY_CONVERT(decimal(24,6), total_amount),
                unitCode,
                CASE WHEN COL_LENGTH(''receiptV2$000000'', ''depositReceiptNo'') IS NOT NULL THEN depositReceiptNo ELSE NULL END,
                status,
                TRY_CONVERT(int, isReceived)
            FROM dbo.receiptV2$' + @sync + N'
            WHERE idGui = @p_idGui;
        ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50)',
            @p_idGui = @idGui;

        SELECT TOP 1
            @customerCode = customerCode,
            @voucherNumber = voucherNumber,
            @voucherDate = voucherDate,
            @receiptType = UPPER(ISNULL(receiptType, N'CUSTOMER')),
            @masterAmount = ISNULL(total_amount, 0),
            @resolvedUnitCode = unitCode,
            @depositReceiptNo = depositReceiptNo,
            @status = status,
            @isReceived = ISNULL(isReceived, 0)
        FROM #mt;

        IF @customerCode IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> ''
            SET @resolvedUnitCode = @unitCode;
        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = ''
            SET @resolvedUnitCode = 'CTY';

        -- Re-post an toàn
        DELETE dbo.CustomerDebtLedger
        WHERE RefController = N'receiptV2'
          AND ReceiptIdGui = @idGui;

        -- Chỉ ghi sổ khi phiếu đã xác nhận/đã thu
        IF ISNULL(@status, N'0') <> N'1' AND ISNULL(@isReceived, 0) <> 1
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF @receiptType = N'INVOICE'
        BEGIN
            IF OBJECT_ID('tempdb..#dt') IS NOT NULL DROP TABLE #dt;
            SELECT TOP 0 d.* INTO #dt FROM dbo.receiptdetailV2$000000 d WHERE 1 = 0;

            SET @q = N'
                INSERT INTO #dt
                SELECT d.*
                FROM dbo.receiptdetailV2$' + @sync + N' d
                WHERE d.idGui = @p_idGui;
            ';
            EXEC sp_executesql
                @q,
                N'@p_idGui NVARCHAR(50)',
                @p_idGui = @idGui;

            SET @q = N'
                INSERT dbo.CustomerDebtLedger
                (
                    UnitCode,
                    CustomerId,
                    ReceiptIdGui,
                    VoucherNumber,
                    VoucherDate,
                    ReceiptType,
                    DebitAmount,
                    CreditAmount,
                    DepositAmount,
                    CollectedAmount,
                    ReceivableAmount,
                    RefController,
                    RefIdGui,
                    RefLineNbr,
                    Note,
                    CreatedBy,
                    CreatedAt
                )
                SELECT
                    @p_unitCode,
                    @p_customerCode,
                    @p_idGui,
                    @p_voucherNumber,
                    @p_voucherDate,
                    N''RECEIPT_INVOICE'',
                    0,
                    0,
                    0,
                    ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0),
                    0,
                    N''receiptV2'',
                    COALESCE(CONVERT(nvarchar(50), d.idGuiDN), CONVERT(nvarchar(50), d.invoiceNumber), CONVERT(nvarchar(50), d.idGui)),
                    TRY_CONVERT(int, d.line_nbr),
                    N''Thu theo hóa đơn'',
                    @p_userId,
                    SYSDATETIME()
                FROM #dt d
                WHERE ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0) > 0;
            ';

            EXEC sp_executesql
                @q,
                N'@p_unitCode NVARCHAR(50), @p_customerCode NVARCHAR(50), @p_idGui NVARCHAR(50), @p_voucherNumber NVARCHAR(100), @p_voucherDate DATE, @p_userId NVARCHAR(50)',
                @p_unitCode = @resolvedUnitCode,
                @p_customerCode = @customerCode,
                @p_idGui = @idGui,
                @p_voucherNumber = @voucherNumber,
                @p_voucherDate = @voucherDate,
                @p_userId = @userId;
        END
        ELSE IF @receiptType = N'DEPOSIT'
        BEGIN
            IF @masterAmount > 0
            BEGIN
                INSERT dbo.CustomerDebtLedger
                (
                    UnitCode,
                    CustomerId,
                    ReceiptIdGui,
                    VoucherNumber,
                    VoucherDate,
                    ReceiptType,
                    DebitAmount,
                    CreditAmount,
                    DepositAmount,
                    CollectedAmount,
                    ReceivableAmount,
                    RefController,
                    RefIdGui,
                    RefLineNbr,
                    Note,
                    CreatedBy,
                    CreatedAt
                )
                VALUES
                (
                    @resolvedUnitCode,
                    @customerCode,
                    @idGui,
                    @voucherNumber,
                    @voucherDate,
                    N'RECEIPT_DEPOSIT',
                    0,
                    0,
                    @masterAmount,
                    0,
                    0,
                    N'receiptV2',
                    @idGui,
                    NULL,
                    N'Thu đặt cọc',
                    @userId,
                    SYSDATETIME()
                );
            END
        END
        ELSE IF @receiptType IN (N'CUSTOMER', N'DEPOSIT_OFFSET')
        BEGIN
            -- Hai loại thu công nợ được ghi theo từng phiếu xuất bởi
            -- sp_ApplyCustomerReceiptAllocationFromReceiptV2.
            -- Không ghi một dòng tổng tại đây để tránh trùng công nợ.
        END
        ELSE
        BEGIN
            -- OTHER và các loại không tác động công nợ chỉ lưu chứng từ thu.
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
