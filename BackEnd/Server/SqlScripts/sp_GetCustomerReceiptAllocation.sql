CREATE OR ALTER PROCEDURE dbo.sp_GetCustomerReceiptAllocation
    @mode NVARCHAR(20) = N'SAVED',
    @idGui NVARCHAR(50) = NULL,
    @customerCode NVARCHAR(50) = NULL,
    @unitCode NVARCHAR(50) = NULL,
    @keyword NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @normalizedMode NVARCHAR(20) = UPPER(ISNULL(LTRIM(RTRIM(@mode)), N'SAVED'));

    IF @normalizedMode = N'OPEN'
    BEGIN
        IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NULL
        BEGIN
            SELECT TOP 0
                CAST('' AS NVARCHAR(50)) AS refIdGuiDN,
                CAST(NULL AS INT) AS refLineNbrDN,
                CAST('' AS NVARCHAR(100)) AS voucherNumber,
                CAST(NULL AS DATE) AS voucherDate,
                CAST(0 AS DECIMAL(24,6)) AS receivableAmount,
                CAST(0 AS DECIMAL(24,6)) AS collectedAmount,
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

        DECLARE @exprReceivableOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'ReceivableAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), ReceivableAmount), 0)'
            ELSE N'0'
        END;
        DECLARE @exprCollectedOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'CollectedAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), CollectedAmount), 0)'
            ELSE N'0'
        END;
        DECLARE @exprDebitOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'DebitAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), DebitAmount), 0)'
            ELSE N'0'
        END;
        DECLARE @exprCreditOpen NVARCHAR(200) = CASE
            WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'CreditAmount') IS NOT NULL
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
                    ReceivableAmount = ' + @exprReceivableOpen + N',
                    CollectedAmount = ' + @exprCollectedOpen + N',
                    DebitAmount = ' + @exprDebitOpen + N',
                    CreditAmount = ' + @exprCreditOpen + N'
                FROM dbo.CustomerDebtLedger
                WHERE CustomerId = @p_customerCode
                  AND (@p_unitCode IS NULL OR UnitCode = @p_unitCode)
                  AND ISNULL(RefIdGui, N'''') <> N''''
                  AND
                  (
                        ISNULL(RefController, N'''') = N''deliveryNote''
                        OR (
                            ISNULL(RefController, N'''') = N''receiptV2''
                            AND UPPER(ISNULL(ReceiptType, N'''')) IN (N''RECEIPT_CUSTOMER'', N''RECEIPT_INVOICE'', N''RECEIPT_DEPOSIT_OFFSET'')
                        )
                  )
            ),
            agg AS
            (
                SELECT
                    refIdGuiDN = RefIdGui,
                    voucherNumber = MAX(VoucherNumber),
                    voucherDate = MAX(VoucherDate),
                    receivableAmount = SUM(ReceivableAmount),
                    collectedAmount = SUM(CollectedAmount),
                    debitAmount = SUM(DebitAmount),
                    creditAmount = SUM(CreditAmount)
                FROM src
                GROUP BY RefIdGui
            )
            SELECT
                refIdGuiDN,
                refLineNbrDN = CAST(NULL AS int),
                voucherNumber,
                voucherDate,
                receivableAmount,
                collectedAmount,
                outstandingAmount = receivableAmount + debitAmount - creditAmount - collectedAmount,
                allocatedAmount = CAST(0 AS decimal(24,6)),
                note = CAST(N'''' AS nvarchar(500)),
                invoiceNumber = voucherNumber,
                invoiceDate = voucherDate,
                invoiceAmount = CAST(0 AS decimal(24,6))
            FROM agg
            WHERE (receivableAmount + debitAmount - creditAmount - collectedAmount) > 0
              AND (
                    @p_kw IS NULL
                    OR voucherNumber LIKE @p_kw
                    OR refIdGuiDN LIKE @p_kw
                  )
            ORDER BY voucherDate, voucherNumber;';

        EXEC sp_executesql
            @sqlOpen,
            N'@p_customerCode nvarchar(50), @p_unitCode nvarchar(50), @p_kw nvarchar(210)',
            @p_customerCode = @customerCode,
            @p_unitCode = @resolvedUnitCodeOpen,
            @p_kw = @zkwOpen;

        RETURN;
    END;

    IF @normalizedMode = N'EDIT'
    BEGIN
        DECLARE @syncEdit VARCHAR(6) = NULL;
        DECLARE @sqlEdit NVARCHAR(MAX);
        DECLARE @resolvedCustomerCode NVARCHAR(50) = NULLIF(LTRIM(RTRIM(@customerCode)), N'');
        DECLARE @resolvedUnitCodeEdit NVARCHAR(50) = NULLIF(LTRIM(RTRIM(@unitCode)), N'');
        DECLARE @kwEdit NVARCHAR(210) = NULLIF(LTRIM(RTRIM(@keyword)), N'');
        DECLARE @zkwEdit NVARCHAR(210);

        IF @idGui IS NOT NULL AND LTRIM(RTRIM(@idGui)) <> N'' AND OBJECT_ID('dbo.receiptV2$000000', 'U') IS NOT NULL
        BEGIN
            SELECT @syncEdit = CONVERT(VARCHAR(6), voucherDate, 112)
            FROM dbo.receiptV2$000000
            WHERE idGui = @idGui;

            IF @syncEdit IS NOT NULL
            BEGIN
                IF OBJECT_ID('tempdb..#mtEdit') IS NOT NULL DROP TABLE #mtEdit;
                CREATE TABLE #mtEdit(customerCode NVARCHAR(50), unitCode NVARCHAR(50));

                SET @sqlEdit = N'
                    INSERT INTO #mtEdit(customerCode, unitCode)
                    SELECT TOP 1 customerCode, unitCode
                    FROM dbo.receiptV2$' + @syncEdit + N'
                    WHERE idGui = @p_idGui;';

                EXEC sp_executesql @sqlEdit, N'@p_idGui nvarchar(50)', @p_idGui = @idGui;

                SELECT TOP 1
                    @resolvedCustomerCode = COALESCE(NULLIF(LTRIM(RTRIM(customerCode)), N''), @resolvedCustomerCode),
                    @resolvedUnitCodeEdit = COALESCE(NULLIF(LTRIM(RTRIM(unitCode)), N''), @resolvedUnitCodeEdit)
                FROM #mtEdit;
            END
        END

        IF @resolvedUnitCodeEdit IS NULL SET @resolvedUnitCodeEdit = N'CTY';
        SELECT @zkwEdit = CASE WHEN @kwEdit IS NULL THEN NULL ELSE N'%' + @kwEdit + N'%' END;

        IF OBJECT_ID('tempdb..#openEdit') IS NOT NULL DROP TABLE #openEdit;
        CREATE TABLE #openEdit
        (
            refIdGuiDN NVARCHAR(50) NOT NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            receivableAmount DECIMAL(24,6) NOT NULL,
            collectedAmount DECIMAL(24,6) NOT NULL,
            outstandingAmount DECIMAL(24,6) NOT NULL
        );

        IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NOT NULL AND @resolvedCustomerCode IS NOT NULL
        BEGIN
            DECLARE @exprReceivableEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'ReceivableAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), ReceivableAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @exprCollectedEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'CollectedAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), CollectedAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @exprDebitEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'DebitAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), DebitAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @exprCreditEdit NVARCHAR(200) = CASE
                WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'CreditAmount') IS NOT NULL
                    THEN N'ISNULL(TRY_CONVERT(decimal(24,6), CreditAmount), 0)'
                ELSE N'0'
            END;

            SET @sqlEdit = N'
                ;WITH src AS
                (
                    SELECT
                        RefIdGui = ISNULL(RefIdGui, N''''),
                        VoucherNumber = ISNULL(VoucherNumber, N''''),
                        VoucherDate = TRY_CONVERT(date, VoucherDate),
                        ReceivableAmount = ' + @exprReceivableEdit + N',
                        CollectedAmount = ' + @exprCollectedEdit + N',
                        DebitAmount = ' + @exprDebitEdit + N',
                        CreditAmount = ' + @exprCreditEdit + N'
                    FROM dbo.CustomerDebtLedger
                    WHERE CustomerId = @p_customerCode
                       
                      AND (@p_unitCode IS NULL OR UnitCode = @p_unitCode)
                      AND ISNULL(RefIdGui, N'''') <> N'''' AND ISNULL(ReceiptIdGui, N'''') <> @p_idGui
                      AND
                      (
                            ISNULL(RefController, N'''') = N''deliveryNote''
                            OR (
                                ISNULL(RefController, N'''') = N''receiptV2''
                                AND UPPER(ISNULL(ReceiptType, N'''')) IN (N''RECEIPT_CUSTOMER'', N''RECEIPT_INVOICE'', N''RECEIPT_DEPOSIT_OFFSET'')
                            )
                      )
                ),
                  
                agg AS
                (
                  
                    SELECT
                        refIdGuiDN = RefIdGui,
                        voucherNumber = MAX(VoucherNumber),
                        voucherDate = MAX(VoucherDate),
                        receivableAmount = SUM(ReceivableAmount),
                        collectedAmount = SUM(CollectedAmount),
                        debitAmount = SUM(DebitAmount),
                        creditAmount = SUM(CreditAmount)
                    FROM src
                    GROUP BY RefIdGui
                )
                INSERT INTO #openEdit(refIdGuiDN, voucherNumber, voucherDate, receivableAmount, collectedAmount, outstandingAmount)
                SELECT
                    refIdGuiDN,
                    voucherNumber,
                    voucherDate,
                    receivableAmount,
                    collectedAmount,
                    receivableAmount + debitAmount - creditAmount - collectedAmount
                FROM agg
                WHERE (receivableAmount + debitAmount - creditAmount - collectedAmount) > 0;';

            EXEC sp_executesql
                @sqlEdit,
                N'@p_customerCode nvarchar(50), @p_unitCode nvarchar(50), @p_idGui nvarchar(50)',
                @p_customerCode = @resolvedCustomerCode,
                @p_unitCode = @resolvedUnitCodeEdit,
                @p_idGui = @idGui;
        END;

   
        IF OBJECT_ID('tempdb..#savedEdit') IS NOT NULL DROP TABLE #savedEdit;
        CREATE TABLE #savedEdit
        (
            refIdGuiDN NVARCHAR(50) NOT NULL,
            refLineNbrDN INT NULL,
            invoiceNumber NVARCHAR(100) NULL,
            invoiceDate DATE NULL,
            invoiceAmount DECIMAL(24,6) NULL,
            outstandingAmount DECIMAL(24,6) NULL,
            allocatedAmount DECIMAL(24,6) NOT NULL,
            note NVARCHAR(500) NULL
        );

        IF OBJECT_ID('dbo.CustomerReceiptAllocation', 'U') IS NOT NULL AND @idGui IS NOT NULL
        BEGIN
            INSERT INTO #savedEdit
            (
                refIdGuiDN,
                refLineNbrDN,
                invoiceNumber,
                invoiceDate,
                invoiceAmount,
                outstandingAmount,
                allocatedAmount,
                note
            )
            SELECT
                ISNULL(refIdGuiDN, N''),
                refLineNbrDN,
                invoiceNumber,
                invoiceDate,
                invoiceAmount,
                outstandingAmount,
                ISNULL(allocatedAmount, 0),
                note
            FROM dbo.CustomerReceiptAllocation
            WHERE ReceiptIdGui = @idGui
              AND ISNULL(refIdGuiDN, N'') <> N'';
        END;

        ;WITH savedAgg AS
        (
            SELECT
                refIdGuiDN,
                refLineNbrDN = MAX(refLineNbrDN),
                invoiceNumber = MAX(invoiceNumber),
                invoiceDate = MAX(invoiceDate),
                invoiceAmount = MAX(ISNULL(invoiceAmount, 0)),
                outstandingAmount = MAX(ISNULL(outstandingAmount, 0)),
                allocatedAmount = SUM(ISNULL(allocatedAmount, 0)),
                note = MAX(note)
            FROM #savedEdit
            GROUP BY refIdGuiDN
        )
        SELECT
            refIdGuiDN = COALESCE(o.refIdGuiDN, s.refIdGuiDN),
            refLineNbrDN = s.refLineNbrDN,
            voucherNumber = COALESCE(o.voucherNumber, s.invoiceNumber, N''),
            voucherDate = COALESCE(o.voucherDate, s.invoiceDate),
            receivableAmount = CASE
                WHEN ISNULL(o.receivableAmount, 0) > 0 THEN ISNULL(o.receivableAmount, 0)
                WHEN ISNULL(s.invoiceAmount, 0) > 0 THEN ISNULL(s.invoiceAmount, 0)
                ELSE 0
            END,
            collectedAmount = CASE
                WHEN o.refIdGuiDN IS NOT NULL THEN ISNULL(o.collectedAmount, 0)
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
                WHEN ISNULL(o.receivableAmount, 0) > 0 THEN ISNULL(o.receivableAmount, 0)
                ELSE 0
            END
        FROM #openEdit o
        FULL OUTER JOIN savedAgg s
            ON s.refIdGuiDN = o.refIdGuiDN
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
                OR COALESCE(o.refIdGuiDN, s.refIdGuiDN, N'') LIKE @zkwEdit
            )
        ORDER BY voucherDate, voucherNumber;

        RETURN;
    END;

    -- SAVED mode (default)
    IF OBJECT_ID('dbo.CustomerReceiptAllocation', 'U') IS NULL
    BEGIN
        SELECT TOP 0
            CAST('' AS NVARCHAR(50)) AS refIdGuiDN,
            CAST(NULL AS INT) AS refLineNbrDN,
            CAST(NULL AS INT) AS receiptLineNbr,
            CAST('' AS NVARCHAR(100)) AS invoiceNumber,
            CAST(NULL AS DATE) AS invoiceDate,
            CAST(0 AS DECIMAL(24,6)) AS invoiceAmount,
            CAST(0 AS DECIMAL(24,6)) AS outstandingAmount,
            CAST(0 AS DECIMAL(24,6)) AS allocatedAmount,
            CAST('' AS NVARCHAR(500)) AS note;
        RETURN;
    END;

    SELECT
        refIdGuiDN,
        refLineNbrDN,
        receiptLineNbr,
        invoiceNumber,
        invoiceDate,
        invoiceAmount,
        outstandingAmount,
        allocatedAmount,
        note
    FROM dbo.CustomerReceiptAllocation
    WHERE ReceiptIdGui = @idGui
    ORDER BY Id;
END
GO
