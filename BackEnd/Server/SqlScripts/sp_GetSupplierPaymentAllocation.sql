CREATE OR ALTER PROCEDURE dbo.sp_GetSupplierPaymentAllocation
    @mode NVARCHAR(20) = N'SAVED',
    @idGui NVARCHAR(50) = NULL,
    @supplierCode NVARCHAR(50) = NULL,
    @unitCode NVARCHAR(50) = NULL,
    @keyword NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @normalizedMode NVARCHAR(20) = UPPER(ISNULL(LTRIM(RTRIM(@mode)), N'SAVED'));

    -- Backward compatibility: old call style "exec dbo.sp_GetSupplierPaymentAllocation @idGui"
    IF @normalizedMode NOT IN (N'OPEN', N'EDIT', N'SAVED') AND @idGui IS NULL
    BEGIN
        SET @idGui = @mode;
        SET @normalizedMode = N'SAVED';
    END;

    IF @normalizedMode = N'OPEN'
    BEGIN
        IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NULL
        BEGIN
            SELECT TOP 0
                CAST('' AS NVARCHAR(50)) AS refIdGuiDN,
                CAST('' AS NVARCHAR(50)) AS refIdGuiPN,
                CAST(NULL AS INT) AS refLineNbrDN,
                CAST(NULL AS INT) AS refLineNbrPN,
                CAST(NULL AS INT) AS receiptLineNbr,
                CAST(NULL AS INT) AS paymentLineNbr,
                CAST('' AS NVARCHAR(100)) AS voucherNumber,
                CAST(NULL AS DATE) AS voucherDate,
                CAST(0 AS DECIMAL(24,6)) AS payableAmount,
                CAST(0 AS DECIMAL(24,6)) AS paidAmount,
                CAST(0 AS DECIMAL(24,6)) AS outstandingAmount,
                CAST(0 AS DECIMAL(24,6)) AS allocatedAmount,
                CAST('' AS NVARCHAR(500)) AS note,
                CAST('' AS NVARCHAR(100)) AS invoiceNumber,
                CAST(NULL AS DATE) AS invoiceDate,
                CAST(0 AS DECIMAL(24,6)) AS invoiceAmount;
            RETURN;
        END;

        DECLARE @resolvedUnitCodeOpen NVARCHAR(50) = NULLIF(LTRIM(RTRIM(@unitCode)), N'');
        DECLARE @kwOpen NVARCHAR(210) = NULLIF(LTRIM(RTRIM(@keyword)), N'');
        DECLARE @sqlOpen NVARCHAR(MAX);

        DECLARE @exprPayableOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'PayableAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), PayableAmount), 0)'
            ELSE N'0'
        END;
        DECLARE @exprPaidOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'PaidAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), PaidAmount), 0)'
            ELSE N'0'
        END;
        DECLARE @exprDebitOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'DebitAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), DebitAmount), 0)'
            ELSE N'0'
        END;
        DECLARE @exprCreditOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'CreditAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), CreditAmount), 0)'
            ELSE N'0'
        END;
        DECLARE @zkwOpen NVARCHAR(210);
        SELECT @zkwOpen = CASE WHEN @kwOpen IS NULL THEN NULL ELSE N'%' + @kwOpen + N'%' END;

        SET @sqlOpen = N'
            ;WITH src AS
            (
                SELECT
                    RefIdGui = ISNULL(RefIdGui, N''''),
                    VoucherNumber = ISNULL(VoucherNumber, N''''),
                    VoucherDate = TRY_CONVERT(date, VoucherDate),
                    PayableAmount = ' + @exprPayableOpen + N',
                    PaidAmount = ' + @exprPaidOpen + N',
                    DebitAmount = ' + @exprDebitOpen + N',
                    CreditAmount = ' + @exprCreditOpen + N'
                FROM dbo.SupplierDebtLedger
                WHERE SupplierId = @p_supplierCode
                  AND (@p_unitCode IS NULL OR UnitCode = @p_unitCode)
                  AND ISNULL(RefIdGui, N'''') <> N''''
                  AND (
                        ISNULL(RefController, N'''') = N''goodsReceipt''
                        OR (
                            ISNULL(RefController, N'''') = N''paymentSlip''
                            AND UPPER(ISNULL(ReceiptType, N'''')) IN (N''PAYMENT_SUPPLIER'', N''PAYMENT_INVOICE'', N''PAYMENT_DEPOSIT'')
                        )
                  )
            ),
            agg AS
            (
                SELECT
                    refIdGuiPN = RefIdGui,
                    voucherNumber = MAX(VoucherNumber),
                    voucherDate = MAX(VoucherDate),
                    payableAmount = SUM(PayableAmount),
                    paidAmount = SUM(PaidAmount),
                    debitAmount = SUM(DebitAmount),
                    creditAmount = SUM(CreditAmount)
                FROM src
                GROUP BY RefIdGui
            )
            SELECT
                refIdGuiDN = refIdGuiPN,
                refIdGuiPN,
                refLineNbrDN = CAST(NULL AS int),
                refLineNbrPN = CAST(NULL AS int),
                receiptLineNbr = CAST(NULL AS int),
                paymentLineNbr = CAST(NULL AS int),
                voucherNumber,
                voucherDate,
                payableAmount,
                paidAmount,
                outstandingAmount = payableAmount + debitAmount - creditAmount - paidAmount,
                allocatedAmount = CAST(0 AS decimal(24,6)),
                note = CAST(N'''' AS nvarchar(500)),
                invoiceNumber = voucherNumber,
                invoiceDate = voucherDate,
                invoiceAmount = CAST(0 AS decimal(24,6))
            FROM agg
            WHERE (payableAmount + debitAmount - creditAmount - paidAmount) > 0
              AND (
                    @p_kw IS NULL
                    OR voucherNumber LIKE @p_kw
                    OR refIdGuiPN LIKE @p_kw
                  )
            ORDER BY voucherDate, voucherNumber;';

        EXEC sp_executesql
            @sqlOpen,
            N'@p_supplierCode nvarchar(50), @p_unitCode nvarchar(50), @p_kw nvarchar(210)',
            @p_supplierCode = @supplierCode,
            @p_unitCode = @resolvedUnitCodeOpen,
            @p_kw = @zkwOpen;

        RETURN;
    END;

    IF @normalizedMode = N'EDIT'
    BEGIN
        DECLARE @syncEdit VARCHAR(6) = NULL;
        DECLARE @sqlEdit NVARCHAR(MAX);
        DECLARE @resolvedSupplierCode NVARCHAR(50) = NULLIF(LTRIM(RTRIM(@supplierCode)), N'');
        DECLARE @resolvedUnitCodeEdit NVARCHAR(50) = NULLIF(LTRIM(RTRIM(@unitCode)), N'');
        DECLARE @kwEdit NVARCHAR(210) = NULLIF(LTRIM(RTRIM(@keyword)), N'');
        DECLARE @zkwEdit NVARCHAR(210);

        IF @idGui IS NOT NULL AND LTRIM(RTRIM(@idGui)) <> N'' AND OBJECT_ID('dbo.paymentslip$000000', 'U') IS NOT NULL
        BEGIN
            SELECT @syncEdit = CONVERT(VARCHAR(6), voucherDate, 112)
            FROM dbo.paymentslip$000000
            WHERE idGui = @idGui;

            IF @syncEdit IS NOT NULL
            BEGIN
                IF OBJECT_ID('tempdb..#mtEdit') IS NOT NULL DROP TABLE #mtEdit;
                CREATE TABLE #mtEdit(supplierCode NVARCHAR(50), unitCode NVARCHAR(50));

                SET @sqlEdit = N'
                    INSERT INTO #mtEdit(supplierCode, unitCode)
                    SELECT TOP 1 supplierCode, unitCode
                    FROM dbo.paymentslip$' + @syncEdit + N'
                    WHERE idGui = @p_idGui;';

                EXEC sp_executesql @sqlEdit, N'@p_idGui nvarchar(50)', @p_idGui = @idGui;

                SELECT TOP 1
                    @resolvedSupplierCode = COALESCE(NULLIF(LTRIM(RTRIM(supplierCode)), N''), @resolvedSupplierCode),
                    @resolvedUnitCodeEdit = COALESCE(NULLIF(LTRIM(RTRIM(unitCode)), N''), @resolvedUnitCodeEdit)
                FROM #mtEdit;
            END
        END

        IF @resolvedUnitCodeEdit IS NULL SET @resolvedUnitCodeEdit = N'CTY';
        SELECT @zkwEdit = CASE WHEN @kwEdit IS NULL THEN NULL ELSE N'%' + @kwEdit + N'%' END;

        IF OBJECT_ID('tempdb..#openEdit') IS NOT NULL DROP TABLE #openEdit;
        CREATE TABLE #openEdit
        (
            refIdGuiPN NVARCHAR(50) NOT NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            payableAmount DECIMAL(24,6) NOT NULL,
            paidAmount DECIMAL(24,6) NOT NULL,
            outstandingAmount DECIMAL(24,6) NOT NULL
        );

        IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NOT NULL AND @resolvedSupplierCode IS NOT NULL
        BEGIN
            DECLARE @exprPayableEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'PayableAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), PayableAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @exprPaidEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'PaidAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), PaidAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @exprDebitEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'DebitAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), DebitAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @exprCreditEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'CreditAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), CreditAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @selfReceiptFilter NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'ReceiptIdGui') IS NOT NULL
                    THEN N' AND ISNULL(ReceiptIdGui, N'''') <> @p_idGui'
                ELSE N''
            END;

            SET @sqlEdit = N'
                ;WITH src AS
                (
                    SELECT
                        RefIdGui = ISNULL(RefIdGui, N''''),
                        VoucherNumber = ISNULL(VoucherNumber, N''''),
                        VoucherDate = TRY_CONVERT(date, VoucherDate),
                        PayableAmount = ' + @exprPayableEdit + N',
                        PaidAmount = ' + @exprPaidEdit + N',
                        DebitAmount = ' + @exprDebitEdit + N',
                        CreditAmount = ' + @exprCreditEdit + N'
                    FROM dbo.SupplierDebtLedger
                    WHERE SupplierId = @p_supplierCode
                      AND (@p_unitCode IS NULL OR UnitCode = @p_unitCode)
                      AND ISNULL(RefIdGui, N'''') <> N''''
                      ' + @selfReceiptFilter + N'
                      AND (
                            ISNULL(RefController, N'''') = N''goodsReceipt''
                            OR (
                                ISNULL(RefController, N'''') = N''paymentSlip''
                                AND UPPER(ISNULL(ReceiptType, N'''')) IN (N''PAYMENT_SUPPLIER'', N''PAYMENT_INVOICE'', N''PAYMENT_DEPOSIT'')
                            )
                      )
                ),
                agg AS
                (
                    SELECT
                        refIdGuiPN = RefIdGui,
                        voucherNumber = MAX(VoucherNumber),
                        voucherDate = MAX(VoucherDate),
                        payableAmount = SUM(PayableAmount),
                        paidAmount = SUM(PaidAmount),
                        debitAmount = SUM(DebitAmount),
                        creditAmount = SUM(CreditAmount)
                    FROM src
                    GROUP BY RefIdGui
                )
                INSERT INTO #openEdit(refIdGuiPN, voucherNumber, voucherDate, payableAmount, paidAmount, outstandingAmount)
                SELECT
                    refIdGuiPN,
                    voucherNumber,
                    voucherDate,
                    payableAmount,
                    paidAmount,
                    payableAmount + debitAmount - creditAmount - paidAmount
                FROM agg
                WHERE (payableAmount + debitAmount - creditAmount - paidAmount) > 0;';

            EXEC sp_executesql
                @sqlEdit,
                N'@p_supplierCode nvarchar(50), @p_unitCode nvarchar(50), @p_idGui nvarchar(50)',
                @p_supplierCode = @resolvedSupplierCode,
                @p_unitCode = @resolvedUnitCodeEdit,
                @p_idGui = @idGui;
        END;

        IF OBJECT_ID('tempdb..#savedEdit') IS NOT NULL DROP TABLE #savedEdit;
        CREATE TABLE #savedEdit
        (
            refIdGuiPN NVARCHAR(50) NOT NULL,
            refLineNbrPN INT NULL,
            paymentLineNbr INT NULL,
            invoiceNumber NVARCHAR(100) NULL,
            invoiceDate DATE NULL,
            invoiceAmount DECIMAL(24,6) NULL,
            outstandingAmount DECIMAL(24,6) NULL,
            allocatedAmount DECIMAL(24,6) NOT NULL,
            note NVARCHAR(500) NULL
        );

        IF OBJECT_ID('dbo.SupplierPaymentAllocation', 'U') IS NOT NULL AND @idGui IS NOT NULL
        BEGIN
            INSERT INTO #savedEdit
            (
                refIdGuiPN,
                refLineNbrPN,
                paymentLineNbr,
                invoiceNumber,
                invoiceDate,
                invoiceAmount,
                outstandingAmount,
                allocatedAmount,
                note
            )
            SELECT
                ISNULL(refIdGuiPN, N''),
                refLineNbrPN,
                paymentLineNbr,
                invoiceNumber,
                invoiceDate,
                invoiceAmount,
                outstandingAmount,
                ISNULL(allocatedAmount, 0),
                note
            FROM dbo.SupplierPaymentAllocation
            WHERE PaymentIdGui = @idGui
              AND ISNULL(refIdGuiPN, N'') <> N'';
        END;

        ;WITH savedAgg AS
        (
            SELECT
                refIdGuiPN,
                refLineNbrPN = MAX(refLineNbrPN),
                paymentLineNbr = MAX(paymentLineNbr),
                invoiceNumber = MAX(invoiceNumber),
                invoiceDate = MAX(invoiceDate),
                invoiceAmount = MAX(ISNULL(invoiceAmount, 0)),
                outstandingAmount = MAX(ISNULL(outstandingAmount, 0)),
                allocatedAmount = SUM(ISNULL(allocatedAmount, 0)),
                note = MAX(note)
            FROM #savedEdit
            GROUP BY refIdGuiPN
        )
        SELECT
            refIdGuiDN = COALESCE(o.refIdGuiPN, s.refIdGuiPN),
            refIdGuiPN = COALESCE(o.refIdGuiPN, s.refIdGuiPN),
            refLineNbrDN = s.refLineNbrPN,
            refLineNbrPN = s.refLineNbrPN,
            receiptLineNbr = s.paymentLineNbr,
            paymentLineNbr = s.paymentLineNbr,
            voucherNumber = COALESCE(o.voucherNumber, s.invoiceNumber, N''),
            voucherDate = COALESCE(o.voucherDate, s.invoiceDate),
            payableAmount = CASE
                WHEN ISNULL(o.payableAmount, 0) > 0 THEN ISNULL(o.payableAmount, 0)
                WHEN ISNULL(s.invoiceAmount, 0) > 0 THEN ISNULL(s.invoiceAmount, 0)
                ELSE 0
            END,
            paidAmount = CASE
                WHEN o.refIdGuiPN IS NOT NULL THEN ISNULL(o.paidAmount, 0)
                WHEN ISNULL(s.invoiceAmount, 0) > ISNULL(s.outstandingAmount, 0)
                    THEN ISNULL(s.invoiceAmount, 0) - ISNULL(s.outstandingAmount, 0)
                ELSE 0
            END,
            outstandingAmount = CASE
                WHEN ISNULL(o.outstandingAmount, 0) > 0 THEN ISNULL(o.outstandingAmount, 0)
                ELSE ISNULL(s.outstandingAmount, 0)
            END,
            allocatedAmount = ISNULL(s.allocatedAmount, 0),
            note = ISNULL(s.note, N''),
            invoiceNumber = COALESCE(s.invoiceNumber, o.voucherNumber, N''),
            invoiceDate = COALESCE(s.invoiceDate, o.voucherDate),
            invoiceAmount = CASE
                WHEN ISNULL(s.invoiceAmount, 0) > 0 THEN ISNULL(s.invoiceAmount, 0)
                WHEN ISNULL(o.payableAmount, 0) > 0 THEN ISNULL(o.payableAmount, 0)
                ELSE 0
            END
        FROM #openEdit o
        FULL OUTER JOIN savedAgg s
            ON s.refIdGuiPN = o.refIdGuiPN
        WHERE
            (
                CASE
                    WHEN ISNULL(o.outstandingAmount, 0) > 0 THEN ISNULL(o.outstandingAmount, 0)
                    ELSE ISNULL(s.outstandingAmount, 0)
                END > 0
                OR ISNULL(s.allocatedAmount, 0) > 0
            )
            AND
            (
                @zkwEdit IS NULL
                OR COALESCE(o.voucherNumber, s.invoiceNumber, N'') LIKE @zkwEdit
                OR COALESCE(o.refIdGuiPN, s.refIdGuiPN, N'') LIKE @zkwEdit
            )
        ORDER BY voucherDate, voucherNumber;

        RETURN;
    END;

    -- SAVED mode (default)
    IF OBJECT_ID('dbo.SupplierPaymentAllocation', 'U') IS NULL
    BEGIN
        SELECT TOP 0
            CAST('' AS NVARCHAR(50)) AS refIdGuiDN,
            CAST('' AS NVARCHAR(50)) AS refIdGuiPN,
            CAST(NULL AS INT) AS refLineNbrDN,
            CAST(NULL AS INT) AS refLineNbrPN,
            CAST(NULL AS INT) AS receiptLineNbr,
            CAST(NULL AS INT) AS paymentLineNbr,
            CAST('' AS NVARCHAR(100)) AS invoiceNumber,
            CAST(NULL AS DATE) AS invoiceDate,
            CAST(0 AS DECIMAL(24,6)) AS invoiceAmount,
            CAST(0 AS DECIMAL(24,6)) AS outstandingAmount,
            CAST(0 AS DECIMAL(24,6)) AS allocatedAmount,
            CAST('' AS NVARCHAR(500)) AS note;
        RETURN;
    END;

    SELECT
        refIdGuiDN = refIdGuiPN,
        refIdGuiPN,
        refLineNbrDN = refLineNbrPN,
        refLineNbrPN,
        receiptLineNbr = paymentLineNbr,
        paymentLineNbr,
        invoiceNumber,
        invoiceDate,
        invoiceAmount,
        outstandingAmount,
        allocatedAmount,
        note
    FROM dbo.SupplierPaymentAllocation
    WHERE PaymentIdGui = @idGui
    ORDER BY Id;
END
GO

