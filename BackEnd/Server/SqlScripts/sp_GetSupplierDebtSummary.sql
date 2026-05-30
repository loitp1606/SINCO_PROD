CREATE OR ALTER PROCEDURE dbo.sp_GetSupplierDebtSummary
    @supplierCode NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @resolvedUnitCode NVARCHAR(50) = NULLIF(LTRIM(RTRIM(@unitCode)), N'');
    DECLARE @depositAmount DECIMAL(24, 6) = 0;
    DECLARE @paidAmount DECIMAL(24, 6) = 0;
    DECLARE @payableAmount DECIMAL(24, 6) = 0;

    IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NOT NULL
    BEGIN
        ;WITH src AS
        (
            SELECT
                AdvanceAmount = ISNULL(TRY_CONVERT(DECIMAL(24, 6), AdvanceAmount), 0),
                PayableAmount = ISNULL(TRY_CONVERT(DECIMAL(24, 6), PayableAmount), 0),
                DebitAmount = ISNULL(TRY_CONVERT(DECIMAL(24, 6), DebitAmount), 0),
                CreditAmount = ISNULL(TRY_CONVERT(DECIMAL(24, 6), CreditAmount), 0),
                PaidAmount = ISNULL(TRY_CONVERT(DECIMAL(24, 6), PaidAmount), 0),
                ReceiptType = UPPER(ISNULL(ReceiptType, N'')),
                RefController = ISNULL(RefController, N''),
                IsLegacy = CASE WHEN ISNULL(ReceiptType, N'') = N'' THEN 1 ELSE 0 END
            FROM dbo.SupplierDebtLedger
            WHERE SupplierId = @supplierCode
              AND (@resolvedUnitCode IS NULL OR UnitCode = @resolvedUnitCode)
        )
        SELECT
            @depositAmount = ISNULL(SUM(CASE
                WHEN ReceiptType IN (N'SUPPLIER_ADVANCE', N'PAYMENT_DEPOSIT')
                  OR (IsLegacy = 1 AND RefController = N'paymentSlip' AND AdvanceAmount > 0)
                THEN AdvanceAmount
                ELSE 0
            END), 0),
            @paidAmount = ISNULL(SUM(CASE
                WHEN ReceiptType IN (N'PAYMENT_SUPPLIER', N'PAYMENT_INVOICE', N'SUPPLIER_PAYMENT')
                  OR (IsLegacy = 1 AND RefController = N'paymentSlip' AND PaidAmount > 0)
                THEN PaidAmount
                ELSE 0
            END), 0),
            @payableAmount = ISNULL(SUM(CASE
                WHEN ReceiptType IN (N'GOODS_RECEIPT', N'PAYMENT_SUPPLIER', N'PAYMENT_INVOICE', N'SUPPLIER_PAYMENT')
                  OR (IsLegacy = 1 AND RefController IN (N'goodsReceipt', N'paymentSlip'))
                THEN (PayableAmount + DebitAmount - CreditAmount - PaidAmount)
                ELSE 0
            END), 0)
        FROM src;
    END;

    SELECT
        @supplierCode AS supplierCode,
        COALESCE(@resolvedUnitCode, N'') AS unitCode,
        @depositAmount AS depositAmount,
        @paidAmount AS paidAmount,
        @paidAmount AS receivableAmount, -- giữ tương thích popupActions cũ đang map receivable
        @payableAmount AS payableAmount;
END
GO
