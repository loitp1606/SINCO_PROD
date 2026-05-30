CREATE OR ALTER PROCEDURE dbo.beforeUpdatePaymentSlip
    @idGui NVARCHAR(50),
    @vcNum NVARCHAR(50),
    @VCDate NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NOT NULL
    BEGIN
        DELETE dbo.SupplierDebtLedger
        WHERE RefController = N'paymentSlip'
          AND ReceiptIdGui = @idGui;
    END

    IF COL_LENGTH('goodsReceiptDetail$000000', 'sl_payment') IS NULL
        RETURN;

    DECLARE @sync VARCHAR(6), @q NVARCHAR(MAX), @receiptCode NVARCHAR(100);

    SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112), @receiptCode = receiptCode
    FROM paymentslip$000000
    WHERE idGui = @idGui;

    IF @sync IS NULL
        RETURN;

    IF OBJECT_ID('tempdb..#detail') IS NOT NULL DROP TABLE #detail;
    SELECT TOP 0 d.* INTO #detail FROM paymentslipDetail$000000 d WHERE 1 = 0;

    SET @q = N'
        INSERT INTO #detail
        SELECT d.*
        FROM paymentslipDetail$' + @sync + N' d
        WHERE d.idGui = @p_idGui;
    ';
    EXEC sp_executesql @q, N'@p_idGui NVARCHAR(50)', @p_idGui = @idGui;

    IF NOT EXISTS (SELECT 1 FROM #detail)
        RETURN;

    IF OBJECT_ID('tempdb..#effect') IS NOT NULL DROP TABLE #effect;
    CREATE TABLE #effect
    (
        idGuiPN NVARCHAR(64) NULL,
        lnPN INT NULL,
        amount DECIMAL(24,6) NOT NULL
    );

    DECLARE @amountExpr NVARCHAR(300) = CASE
        WHEN COL_LENGTH('tempdb..#detail', 'amount') IS NOT NULL
            THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
        WHEN COL_LENGTH('tempdb..#detail', 'amountCur') IS NOT NULL
            THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amountCur), 0)'
        ELSE N'0'
    END;

    IF COL_LENGTH('tempdb..#detail', 'idGuiPN') IS NOT NULL
    BEGIN
        SET @q = N'
            INSERT INTO #effect(idGuiPN, lnPN, amount)
            SELECT
                CONVERT(nvarchar(64), d.idGuiPN),
                CASE WHEN COL_LENGTH(''tempdb..#detail'', ''lnPN'') IS NOT NULL THEN TRY_CONVERT(int, d.lnPN) ELSE NULL END,
                ' + @amountExpr + N'
            FROM #detail d
            WHERE ' + @amountExpr + N' <> 0;
        ';
        EXEC (@q);
    END;
    ELSE IF ISNULL(@receiptCode, N'') <> N''
    BEGIN
        INSERT INTO #effect(idGuiPN, lnPN, amount)
        SELECT
            gr.idGui,
            NULL,
            ISNULL(TRY_CONVERT(decimal(24,6), d.amount), ISNULL(TRY_CONVERT(decimal(24,6), d.amountCur), 0))
        FROM #detail d
        JOIN goodsReceipt$000000 gr ON gr.voucherNumber = @receiptCode
        WHERE ISNULL(TRY_CONVERT(decimal(24,6), d.amount), ISNULL(TRY_CONVERT(decimal(24,6), d.amountCur), 0)) <> 0;
    END;

    IF NOT EXISTS (SELECT 1 FROM #effect WHERE idGuiPN IS NOT NULL)
        RETURN;

    IF OBJECT_ID('tempdb..#keys') IS NOT NULL DROP TABLE #keys;
    SELECT DISTINCT e.idGuiPN, CONVERT(VARCHAR(6), gr.voucherDate, 112) AS sync
    INTO #keys
    FROM #effect e
    JOIN goodsReceipt$000000 gr ON gr.idGui = e.idGuiPN
    WHERE e.idGuiPN IS NOT NULL;

    DECLARE @idPN NVARCHAR(64);
    WHILE EXISTS (SELECT 1 FROM #keys)
    BEGIN
        SELECT TOP 1 @idPN = idGuiPN, @sync = sync FROM #keys;

        SET @q = N'
            UPDATE d
               SET d.sl_payment = ISNULL(d.sl_payment, 0) - ISNULL(x.amount, 0)
            FROM goodsReceiptDetail$' + @sync + N' d
            JOIN #effect x ON x.idGuiPN = d.idGui
                         AND (x.lnPN IS NULL OR x.lnPN = d.line_nbr)
            WHERE d.idGui = @p_idPN;
        ';
        EXEC sp_executesql @q, N'@p_idPN nvarchar(64)', @p_idPN = @idPN;

        SET @q = N'
            IF OBJECT_ID(N''goodsReceipt$' + @sync + N''', N''U'') IS NOT NULL
               AND COL_LENGTH(''goodsReceipt$000000'', ''paidAmount'') IS NOT NULL
               AND COL_LENGTH(''goodsReceipt$000000'', ''debtAmount'') IS NOT NULL
               AND COL_LENGTH(''goodsReceipt$000000'', ''paymentStatus'') IS NOT NULL
            BEGIN
                UPDATE gr
                   SET paidAmount = ISNULL(agg.paidAmount, 0),
                       debtAmount = ISNULL(gr.totalPayment, 0) - ISNULL(agg.paidAmount, 0),
                       paymentStatus = CASE
                           WHEN ISNULL(gr.totalPayment, 0) <= 0 THEN ''UNPAID''
                           WHEN ISNULL(agg.paidAmount, 0) <= 0 THEN ''UNPAID''
                           WHEN ISNULL(agg.paidAmount, 0) >= ISNULL(gr.totalPayment, 0) THEN ''PAID''
                           ELSE ''PARTIAL''
                       END
                FROM goodsReceipt$' + @sync + N' gr
                OUTER APPLY
                (
                    SELECT SUM(ISNULL(TRY_CONVERT(decimal(24,6), d.sl_payment), 0)) AS paidAmount
                    FROM goodsReceiptDetail$' + @sync + N' d
                    WHERE d.idGui = gr.idGui
                ) agg
                WHERE gr.idGui = @p_idPN;
            END
        ';
        EXEC sp_executesql @q, N'@p_idPN nvarchar(64)', @p_idPN = @idPN;

        DELETE #keys WHERE idGuiPN = @idPN;
    END
END
GO
