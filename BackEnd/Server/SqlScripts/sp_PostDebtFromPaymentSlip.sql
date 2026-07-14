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
            @amountExpr NVARCHAR(200),
            @refLineExpr NVARCHAR(200),
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
        
        IF @supplierCode IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> ''
            SET @resolvedUnitCode = @unitCode;
        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = ''
            SET @resolvedUnitCode = 'CTY';

        DELETE dbo.SupplierDebtLedger
        WHERE RefController = N'paymentSlip'
          AND ReceiptIdGui = @idGui;
         
        --IF ISNULL(@spentMoney, 0) <> 1
        --BEGIN
        --    COMMIT;
        --    RETURN;
        --END;

        SET @receiptType = CASE
            WHEN @paymentType = N'DEPOSIT' THEN N'PAYMENT_DEPOSIT'
            WHEN @paymentType = N'DEPOSIT_OFFSET' THEN N'PAYMENT_DEPOSIT_OFFSET'
            WHEN @paymentType = N'INVOICE' THEN N'PAYMENT_INVOICE'
            ELSE N'PAYMENT_SUPPLIER'
        END;

        -- DEPOSIT / DEPOSIT_OFFSET / SUPPLIER: ghi nhận theo tổng master, không phụ thuộc detail
        IF @paymentType <> N'INVOICE'
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
                CASE
                    WHEN @receiptType = N'PAYMENT_DEPOSIT' THEN @masterAmount
                    WHEN @receiptType = N'PAYMENT_DEPOSIT_OFFSET' THEN -@masterAmount
                    ELSE 0
                END,
                CASE WHEN @receiptType = N'PAYMENT_DEPOSIT' THEN 0 ELSE @masterAmount END,
                0,
                N'paymentSlip',
                @idGui,
                NULL,
                CASE
                    WHEN @receiptType = N'PAYMENT_DEPOSIT' THEN N'Chi tiền đặt cọc cho NCC'
                    WHEN @receiptType = N'PAYMENT_DEPOSIT_OFFSET' THEN N'Cấn trừ công nợ từ tiền đặt cọc NCC'
                    ELSE N'Giảm phải trả NCC từ phiếu chi'
                END,
                @userId,
                SYSDATETIME()
            );

            COMMIT;
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#detail') IS NOT NULL DROP TABLE #detail;
        SELECT TOP 0 d.* INTO #detail FROM dbo.paymentslipDetail$000000 d WHERE 1 = 0;

        SET @q = N'
            INSERT INTO #detail
            SELECT d.*
            FROM dbo.paymentslipDetail$' + @sync + N' d
            WHERE d.idGui = @p_idGui;
        ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50)',
            @p_idGui = @idGui;

        IF NOT EXISTS (SELECT 1 FROM #detail)
        BEGIN
            COMMIT;
            RETURN;
        END;

        SET @amountExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'amountCur') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amountCur), 0)'
            ELSE N'0'
        END;

        SET @refLineExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'lnPN') IS NOT NULL
                THEN N'TRY_CONVERT(int, d.lnPN)'
            ELSE N'NULL'
        END;

        SET @q = N'
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
            SELECT
                @p_unitCode,
                @p_supplierCode,
                @p_idGui,
                @p_voucherNumber,
                @p_voucherDate,
                @p_receiptType,
                0,
                0,
                CASE WHEN @p_receiptType = N''PAYMENT_DEPOSIT'' THEN ' + @amountExpr + N' ELSE 0 END,
                CASE WHEN @p_receiptType = N''PAYMENT_DEPOSIT'' THEN 0 ELSE ' + @amountExpr + N' END,
                0,
                N''paymentSlip'',
                CONVERT(nvarchar(50), d.idGuiPN),
                ' + @refLineExpr + N',
                N''Giảm phải trả NCC từ phiếu chi'',
                @p_userId,
                SYSDATETIME()
            FROM #detail d
            WHERE ' + @amountExpr + N' > 0;
        ';
      
        EXEC sp_executesql
            @q,
            N'@p_unitCode NVARCHAR(50), @p_supplierCode NVARCHAR(50), @p_idGui NVARCHAR(50), @p_voucherNumber NVARCHAR(100), @p_voucherDate DATE, @p_userId NVARCHAR(50), @p_receiptType NVARCHAR(30)',
            @p_unitCode = @resolvedUnitCode,
            @p_supplierCode = @supplierCode,
            @p_idGui = @idGui,
            @p_voucherNumber = @voucherNumber,
            @p_voucherDate = @voucherDate,
            @p_userId = @userId,
            @p_receiptType = @receiptType;

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
