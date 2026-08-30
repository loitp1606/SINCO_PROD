ALTER PROCEDURE [dbo].[sp_PostDebtFromPaymentSlip]
    @idGui NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @supplierCode NVARCHAR(50),
            @voucherNumber NVARCHAR(100),
            @voucherDate DATE,
            @spentMoney INT,
            @paymentType NVARCHAR(20),
            @masterAmount DECIMAL(24, 6),
            @resolvedUnitCode NVARCHAR(50),
            @receiptType NVARCHAR(30);

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.paymentslip$000000
        WHERE idGui = @idGui;
        
        IF @sync IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#ps') IS NOT NULL DROP TABLE #ps;
        CREATE TABLE #ps
        (
            supplierCode NVARCHAR(50) NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            spentMoney INT NULL,
            paymentType NVARCHAR(20) NULL,
            total_amount DECIMAL(24,6) NULL,
            unitCode NVARCHAR(50) NULL
        );

        IF COL_LENGTH('paymentslip$000000', 'paymentType') IS NOT NULL
            SET @q = N'
                INSERT INTO #ps(supplierCode, voucherNumber, voucherDate, spentMoney, paymentType, total_amount, unitCode)
                SELECT TOP 1 supplierCode, voucherNumber, TRY_CONVERT(date, voucherDate), TRY_CONVERT(int, spentMoney), paymentType, TRY_CONVERT(decimal(24,6), total_amount), unitCode
                FROM dbo.paymentslip$' + @sync + N'
                WHERE idGui = @p_idGui;
            ';
        ELSE
            SET @q = N'
                INSERT INTO #ps(supplierCode, voucherNumber, voucherDate, spentMoney, paymentType, total_amount, unitCode)
                SELECT TOP 1 supplierCode, voucherNumber, TRY_CONVERT(date, voucherDate), TRY_CONVERT(int, spentMoney), N''SUPPLIER'', TRY_CONVERT(decimal(24,6), total_amount), unitCode
                FROM dbo.paymentslip$' + @sync + N'
                WHERE idGui = @p_idGui;
            ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50)',
            @p_idGui = @idGui;

        SELECT TOP 1
            @supplierCode = supplierCode,
            @voucherNumber = voucherNumber,
            @voucherDate = voucherDate,
            @spentMoney = spentMoney,
            @paymentType = UPPER(ISNULL(paymentType, N'SUPPLIER')),
            @masterAmount = ISNULL(total_amount, 0),
            @resolvedUnitCode = unitCode
        FROM #ps;
        
        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> ''
            SET @resolvedUnitCode = @unitCode;
        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = ''
            SET @resolvedUnitCode = 'CTY';

        DELETE dbo.SupplierDebtLedger
        WHERE RefController = N'paymentSlip'
          AND ReceiptIdGui = @idGui;
         
        IF @paymentType = N'OTHER'
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF @supplierCode IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        SET @receiptType = CASE
            WHEN @paymentType = N'DEPOSIT' THEN N'PAYMENT_DEPOSIT'
            WHEN @paymentType = N'DEPOSIT_OFFSET' THEN N'PAYMENT_DEPOSIT_OFFSET'
            ELSE N'PAYMENT_SUPPLIER'
        END;

        -- SUPPLIER / DEPOSIT_OFFSET được ghi theo từng phiếu nhập bởi
        -- sp_ApplySupplierPaymentAllocationFromPaymentSlip để tránh trùng công nợ.
        IF @paymentType IN (N'SUPPLIER', N'DEPOSIT_OFFSET')
        BEGIN
            COMMIT;
            RETURN;
        END;

        -- DEPOSIT ghi nhận tiền đặt cọc cho nhà cung cấp, không phụ thuộc detail.
        IF @paymentType = N'DEPOSIT'
        BEGIN
            IF ISNULL(@masterAmount, 0) <= 0
            BEGIN
                COMMIT;
                RETURN;
            END;

            INSERT dbo.SupplierDebtLedger
            (
                UnitCode,
                SupplierId,
                ReceiptIdGui,
                VoucherNumber,
                VoucherDate,
                ReceiptType,
                DebitAmount,
                CreditAmount,
                AdvanceAmount,
                PaidAmount,
                PayableAmount,
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
                @supplierCode,
                @idGui,
                @voucherNumber,
                @voucherDate,
                @receiptType,
                0,
                0,
                @masterAmount,
                0,
                0,
                N'paymentSlip',
                @idGui,
                NULL,
                N'Chi tiền đặt cọc cho NCC',
                @userId,
                SYSDATETIME()
            );

            COMMIT;
            RETURN;
        END;

        COMMIT;
    END TRY
    BEGIN CATCH
        print ERROR_MESSAGE()
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@err, 16, 1);
    END CATCH
END
GO
