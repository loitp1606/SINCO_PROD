ALTER PROCEDURE [dbo].[sp_ApplySupplierPaymentAllocationFromPaymentSlip]
    @idGui NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NULL RETURN;
        IF OBJECT_ID('dbo.SupplierPaymentAllocation', 'U') IS NULL RETURN;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @supplierCode NVARCHAR(50),
            @voucherNumber NVARCHAR(100),
            @voucherDate DATE,
            @paymentType NVARCHAR(30),
            @masterAmount DECIMAL(24,6),
            @resolvedUnitCode NVARCHAR(50),
            @spentMoney INT,
            @allocatedTotal DECIMAL(24,6);

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.paymentslip$000000
        WHERE idGui = @idGui;
        IF @sync IS NULL RETURN;

        IF OBJECT_ID('tempdb..#$mt') IS NOT NULL DROP TABLE #$mt;
        CREATE TABLE #$mt
        (
            supplierCode NVARCHAR(50) NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            paymentType NVARCHAR(30) NULL,
            total_amount DECIMAL(24,6) NULL,
            unitCode NVARCHAR(50) NULL,
            spentMoney INT NULL
        );

        IF COL_LENGTH('dbo.paymentslip$000000', 'paymentType') IS NOT NULL
            SET @q = N'
                INSERT INTO #$mt(supplierCode, voucherNumber, voucherDate, paymentType, total_amount, unitCode, spentMoney)
                SELECT TOP 1
                    supplierCode,
                    voucherNumber,
                    TRY_CONVERT(date, voucherDate),
                    ISNULL(paymentType, N''SUPPLIER''),
                    TRY_CONVERT(decimal(24,6), total_amount),
                    unitCode,
                    TRY_CONVERT(int, spentMoney)
                FROM dbo.paymentslip$' + @sync + N'
                WHERE idGui = @p_idGui;';
        ELSE
            SET @q = N'
                INSERT INTO #$mt(supplierCode, voucherNumber, voucherDate, paymentType, total_amount, unitCode, spentMoney)
                SELECT TOP 1
                    supplierCode,
                    voucherNumber,
                    TRY_CONVERT(date, voucherDate),
                    N''SUPPLIER'',
                    TRY_CONVERT(decimal(24,6), total_amount),
                    unitCode,
                    TRY_CONVERT(int, spentMoney)
                FROM dbo.paymentslip$' + @sync + N'
                WHERE idGui = @p_idGui;';
        EXEC sp_executesql @q, N'@p_idGui nvarchar(50)', @p_idGui = @idGui;

        SELECT TOP 1
            @supplierCode = supplierCode,
            @voucherNumber = voucherNumber,
            @voucherDate = voucherDate,
            @paymentType = UPPER(ISNULL(paymentType, N'SUPPLIER')),
            @masterAmount = ISNULL(total_amount, 0),
            @resolvedUnitCode = unitCode,
            @spentMoney = ISNULL(spentMoney, 0)
        FROM #$mt;

        IF @supplierCode IS NULL OR @paymentType <> N'SUPPLIER' RETURN;
        IF ISNULL(@spentMoney, 0) <> 1 RETURN;

        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> N''
            SET @resolvedUnitCode = @unitCode;
        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = N''
            SET @resolvedUnitCode = N'CTY';

        SELECT @allocatedTotal = ISNULL(SUM(ISNULL(AllocatedAmount, 0)), 0)
        FROM dbo.SupplierPaymentAllocation
        WHERE PaymentIdGui = @idGui;

        IF @allocatedTotal > ISNULL(@masterAmount, 0)
        BEGIN
            RAISERROR(N'Tổng phân bổ vượt quá số tiền phiếu chi.', 16, 1);
            RETURN;
        END;

        BEGIN TRAN;

        DELETE dbo.SupplierDebtLedger
        WHERE RefController = N'paymentSlip'
          AND ReceiptIdGui = @idGui
          AND ReceiptType = N'PAYMENT_SUPPLIER';

        INSERT dbo.SupplierDebtLedger
        (
            UnitCode, SupplierId, ReceiptIdGui, VoucherNumber, VoucherDate, ReceiptType,
            DebitAmount, CreditAmount, AdvanceAmount, PaidAmount, PayableAmount,
            RefController, RefIdGui, RefLineNbr, Note, CreatedBy, CreatedAt
        )
        SELECT
            @resolvedUnitCode, @supplierCode, @idGui, @voucherNumber, @voucherDate, N'PAYMENT_SUPPLIER',
            0, 0, 0, ISNULL(a.AllocatedAmount, 0), 0,
            N'paymentSlip', ISNULL(a.RefIdGuiPN, @idGui), a.RefLineNbrPN,
            N'Chi tiền NCC (phân bổ hóa đơn)', @userId, SYSDATETIME()
        FROM dbo.SupplierPaymentAllocation a
        WHERE a.PaymentIdGui = @idGui
          AND ISNULL(a.AllocatedAmount, 0) > 0;

        IF @masterAmount > @allocatedTotal
        BEGIN
            INSERT dbo.SupplierDebtLedger
            (
                UnitCode, SupplierId, ReceiptIdGui, VoucherNumber, VoucherDate, ReceiptType,
                DebitAmount, CreditAmount, AdvanceAmount, PaidAmount, PayableAmount,
                RefController, RefIdGui, RefLineNbr, Note, CreatedBy, CreatedAt
            )
            VALUES
            (
                @resolvedUnitCode, @supplierCode, @idGui, @voucherNumber, @voucherDate, N'PAYMENT_SUPPLIER',
                0, 0, 0, @masterAmount - @allocatedTotal, 0,
                N'paymentSlip', @idGui, NULL, N'Chi tiền NCC (chưa phân bổ hóa đơn)', @userId, SYSDATETIME()
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
