ALTER PROCEDURE [dbo].[sp_GetSupplierDebtSummary]
    @supplierCode NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @excludePaymentIdGui NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NULL
    BEGIN
        SELECT
            supplierCode = @supplierCode,
            unitCode = ISNULL(@unitCode, N''),
            depositAmount = CAST(0 AS DECIMAL(24,6)),
            paidAmount = CAST(0 AS DECIMAL(24,6)),
            receivableAmount = CAST(0 AS DECIMAL(24,6)),
            payableAmount = CAST(0 AS DECIMAL(24,6));
        RETURN;
    END;

    IF OBJECT_ID('tempdb..#tmp') IS NOT NULL DROP TABLE #tmp;

    SELECT *
    INTO #tmp
    FROM dbo.SupplierDebtLedger
    WHERE SupplierId = @supplierCode
      AND (@unitCode IS NULL OR @unitCode = N'' OR UnitCode = @unitCode)
      AND (
            @excludePaymentIdGui IS NULL
            OR @excludePaymentIdGui = N''
            OR ISNULL(ReceiptIdGui, N'') <> @excludePaymentIdGui
          );

    SELECT
        supplierCode = @supplierCode,
        unitCode = ISNULL(@unitCode, N''),
        depositAmount = ISNULL(SUM(
            CASE
                WHEN UPPER(ISNULL(ReceiptType, N'')) IN
                    (N'DEPOSIT', N'PAYMENT_DEPOSIT', N'PAYMENT_DEPOSIT_OFFSET', N'SUPPLIER_ADVANCE')
                    THEN ISNULL(TRY_CONVERT(DECIMAL(24,6), AdvanceAmount), 0)
                ELSE 0
            END
        ), 0),
        paidAmount = ISNULL(SUM(
            CASE
                WHEN UPPER(ISNULL(ReceiptType, N'')) IN
                    (N'DEPOSIT', N'PAYMENT_DEPOSIT', N'SUPPLIER_ADVANCE')
                    THEN 0
                ELSE ISNULL(TRY_CONVERT(DECIMAL(24,6), PaidAmount), 0)
            END
        ), 0),
        receivableAmount = ISNULL(SUM(
            CASE
                WHEN UPPER(ISNULL(ReceiptType, N'')) IN
                    (N'DEPOSIT', N'PAYMENT_DEPOSIT', N'SUPPLIER_ADVANCE')
                    THEN 0
                ELSE ISNULL(TRY_CONVERT(DECIMAL(24,6), PaidAmount), 0)
            END
        ), 0),
        payableAmount = ISNULL(SUM(
            ISNULL(TRY_CONVERT(DECIMAL(24,6), PayableAmount), 0)
            - ISNULL(TRY_CONVERT(DECIMAL(24,6), CreditAmount), 0)
            + ISNULL(TRY_CONVERT(DECIMAL(24,6), DebitAmount), 0)
            - ISNULL(TRY_CONVERT(DECIMAL(24,6), PaidAmount), 0)
        ), 0)
    FROM #tmp;
END
GO
