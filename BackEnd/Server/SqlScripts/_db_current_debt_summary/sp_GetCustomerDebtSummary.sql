
CREATE PROCEDURE [dbo].[sp_GetCustomerDebtSummary]
    @customerCode NVARCHAR(50),
    @unitCode NVARCHAR(20) = NULL,
    @excludeReceiptIdGui NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NULL
    BEGIN
        SELECT
            depositAmount = CAST(0 AS DECIMAL(24,6)),
            receivableAmount = CAST(0 AS DECIMAL(24,6)),
            collectedAmount = CAST(0 AS DECIMAL(24,6));
        RETURN;
    END;

    IF OBJECT_ID('tempdb..#tmp') IS NOT NULL DROP TABLE #tmp;

    SELECT *
    INTO #tmp
    FROM dbo.CustomerDebtLedger
    WHERE CustomerId = @customerCode
      AND (@unitCode IS NULL OR @unitCode = '' OR UnitCode = @unitCode)
      AND (
            @excludeReceiptIdGui IS NULL
            OR @excludeReceiptIdGui = ''
            OR ISNULL(ReceiptIdGui, '') <> @excludeReceiptIdGui
          );

    -- Quy u?c m?i:
    -- - receiptType = RECEIPT_DEPOSIT / RECEIPT_DEPOSIT_OFFSET (lu?ng receiptV2 m?i)
    -- - receiptType = DEPOSIT (d? li?u legacy)
    -- Công th?c c?n tr? gi? theo mô hình ledger hi?n t?i.
    SELECT
        depositAmount = ISNULL(SUM(
            CASE
                WHEN UPPER(ISNULL(ReceiptType, '')) IN ('DEPOSIT', 'RECEIPT_DEPOSIT', 'RECEIPT_DEPOSIT_OFFSET')
                    THEN ISNULL(TRY_CONVERT(DECIMAL(24,6), DepositAmount), 0)
                ELSE 0
            END
        ), 0),
        receivableAmount = ISNULL(SUM(
            ISNULL(TRY_CONVERT(DECIMAL(24,6), ReceivableAmount), 0)
            - ISNULL(TRY_CONVERT(DECIMAL(24,6), CreditAmount), 0)
            + ISNULL(TRY_CONVERT(DECIMAL(24,6), DebitAmount), 0)
        ), 0),
        collectedAmount = ISNULL(SUM(
            CASE
                -- Không tính phi?u thu d?t c?c ban d?u vào "dã thu công n?"
                WHEN UPPER(ISNULL(ReceiptType, '')) IN ('DEPOSIT', 'RECEIPT_DEPOSIT')
                    THEN 0
                -- C?n c?c (RECEIPT_DEPOSIT_OFFSET) + thu khách/invoice v?n tính vào dã thu công n?
                ELSE ISNULL(TRY_CONVERT(DECIMAL(24,6), CollectedAmount), 0)
            END
        ), 0)
    FROM #tmp;
END

