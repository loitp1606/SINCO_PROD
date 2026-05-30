CREATE OR ALTER PROCEDURE [dbo].[oot$exportVatReceiptV2]
    @list_guiid       NVARCHAR(MAX),
    @listVoucherDate  NVARCHAR(MAX),
    @userID           NVARCHAR(50) = NULL,
    @unit             NVARCHAR(50) = NULL,
    @language         NVARCHAR(10) = N'vi'
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID('tempdb..#Ids') IS NOT NULL DROP TABLE #Ids;
    CREATE TABLE #Ids
    (
        rn INT IDENTITY(1,1) PRIMARY KEY,
        idGui VARCHAR(64) NOT NULL
    );

    DECLARE @xmlIds XML =
        TRY_CAST(N'<r><v>' + REPLACE(ISNULL(@list_guiid, N''), ',', '</v><v>') + N'</v></r>' AS XML);

    INSERT INTO #Ids(idGui)
    SELECT LTRIM(RTRIM(T.c.value('.', 'varchar(64)')))
    FROM @xmlIds.nodes('/r/v') AS T(c)
    WHERE LTRIM(RTRIM(T.c.value('.', 'varchar(64)'))) <> '';

    IF OBJECT_ID('tempdb..#Dates') IS NOT NULL DROP TABLE #Dates;
    CREATE TABLE #Dates
    (
        rn INT IDENTITY(1,1) PRIMARY KEY,
        rawDate NVARCHAR(100) NULL,
        d DATE NULL
    );

    DECLARE @xmlDates XML =
        TRY_CAST(N'<r><v>' + REPLACE(ISNULL(@listVoucherDate, N''), ',', '</v><v>') + N'</v></r>' AS XML);

    INSERT INTO #Dates(rawDate, d)
    SELECT
        LTRIM(RTRIM(T.c.value('.', 'nvarchar(100)'))),
        COALESCE(
            TRY_CONVERT(date, LTRIM(RTRIM(T.c.value('.', 'nvarchar(100)'))), 23),
            TRY_CONVERT(date, LTRIM(RTRIM(T.c.value('.', 'nvarchar(100)'))), 103),
            TRY_CONVERT(date, LTRIM(RTRIM(T.c.value('.', 'nvarchar(100)'))))
        )
    FROM @xmlDates.nodes('/r/v') AS T(c);

    IF OBJECT_ID('tempdb..#Req') IS NOT NULL DROP TABLE #Req;
    CREATE TABLE #Req
    (
        idGui VARCHAR(64) NOT NULL,
        vcDate DATE NULL,
        suffix CHAR(6) NOT NULL
    );

    INSERT INTO #Req(idGui, vcDate, suffix)
    SELECT
        i.idGui,
        d.d,
        CASE
            WHEN d.d IS NULL THEN '000000'
            ELSE CONVERT(CHAR(6), d.d, 112)
        END
    FROM #Ids i
    LEFT JOIN #Dates d ON d.rn = i.rn;

    IF OBJECT_ID('tempdb..#Raw') IS NOT NULL DROP TABLE #Raw;
    CREATE TABLE #Raw
    (
        idGui VARCHAR(64),
        line_nbr INT,
        voucherDate DATE,
        voucherNumber NVARCHAR(64),
        customerCode NVARCHAR(64),
        collectorName NVARCHAR(256),
        reason NVARCHAR(512),
        note NVARCHAR(512),
        detailNote NVARCHAR(512),
        cashAccount NVARCHAR(64),
        offsetAccount NVARCHAR(64),
        amountVnd DECIMAL(24,6),
        amountCur DECIMAL(24,6),
        exchangeRate DECIMAL(24,6),
        costCode NVARCHAR(64),
        unitCode NVARCHAR(64),
        currencyCode NVARCHAR(32)
    );

    DECLARE @suffix CHAR(6);
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT suffix FROM #Req;

    OPEN cur;
    FETCH NEXT FROM cur INTO @suffix;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @masterName SYSNAME = N'receiptV2$' + @suffix;
        DECLARE @detailName SYSNAME = N'receiptdetailV2$' + @suffix;
        DECLARE @masterTable SYSNAME = QUOTENAME(@masterName);
        DECLARE @detailTable SYSNAME = QUOTENAME(@detailName);

        IF OBJECT_ID(N'dbo.' + @masterName, 'U') IS NOT NULL
           AND OBJECT_ID(N'dbo.' + @detailName, 'U') IS NOT NULL
        BEGIN
            DECLARE @exprCustomerCode NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'customerCode') IS NOT NULL THEN N'm.customerCode'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'customer_id') IS NOT NULL THEN N'm.customer_id'
                ELSE N''''''
            END;
            DECLARE @exprCollectorName NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'collectorName') IS NOT NULL THEN N'm.collectorName'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'collector_name') IS NOT NULL THEN N'm.collector_name'
                ELSE N''''''
            END;
            DECLARE @exprReason NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'reason') IS NOT NULL THEN N'm.reason'
                ELSE N''''''
            END;
            DECLARE @exprNote NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'note') IS NOT NULL THEN N'm.note'
                ELSE N''''''
            END;
            DECLARE @exprMasterAccount NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'accountReceiveCode') IS NOT NULL THEN N'm.accountReceiveCode'
                ELSE N''''''
            END;
            DECLARE @exprUnitCode NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'unitCode') IS NOT NULL THEN N'm.unitCode'
                ELSE N''''''
            END;
            DECLARE @exprTotalAmount NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'total_amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.total_amount), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'totalAmount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.totalAmount), 0)'
                ELSE N'0'
            END;

            DECLARE @exprLineNbr NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'line_nbr') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(int, d.line_nbr), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'lineNbr') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(int, d.lineNbr), 0)'
                ELSE N'0'
            END;
            DECLARE @exprDetailNote NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'note') IS NOT NULL THEN N'd.note'
                ELSE N''''''
            END;
            DECLARE @exprOffsetAccount NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'accountReceiveCode') IS NOT NULL THEN N'd.accountReceiveCode'
                ELSE N''''''
            END;
            DECLARE @exprAmountVnd NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
                ELSE @exprTotalAmount
            END;
            DECLARE @exprAmountCur NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'amountCur') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amountCur), 0)'
                ELSE N'0'
            END;
            DECLARE @exprExchangeRate NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'exchangeRate') IS NOT NULL THEN N'ISNULL(NULLIF(TRY_CONVERT(decimal(24,6), d.exchangeRate), 0), 1)'
                ELSE N'1'
            END;
            DECLARE @exprCostCode NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'ma_vv') IS NOT NULL THEN N'd.ma_vv'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'costCode') IS NOT NULL THEN N'd.costCode'
                ELSE N''''''
            END;
            DECLARE @exprCurrencyCode NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'ma_nt') IS NOT NULL THEN N'd.ma_nt'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'currencyCode') IS NOT NULL THEN N'd.currencyCode'
                ELSE N'N''VND'''
            END;

            DECLARE @sql NVARCHAR(MAX) = N'
                INSERT INTO #Raw
                (
                    idGui, line_nbr, voucherDate, voucherNumber, customerCode, collectorName,
                    reason, note, detailNote, cashAccount, offsetAccount,
                    amountVnd, amountCur, exchangeRate, costCode, unitCode, currencyCode
                )
                SELECT
                    m.idGui,
                    ' + @exprLineNbr + N' AS line_nbr,
                    TRY_CONVERT(date, m.voucherDate) AS voucherDate,
                    ISNULL(m.voucherNumber, N'''') AS voucherNumber,
                    ' + @exprCustomerCode + N' AS customerCode,
                    ' + @exprCollectorName + N' AS collectorName,
                    ' + @exprReason + N' AS reason,
                    ' + @exprNote + N' AS note,
                    ' + @exprDetailNote + N' AS detailNote,
                    ' + @exprMasterAccount + N' AS cashAccount,
                    ' + @exprOffsetAccount + N' AS offsetAccount,
                    ' + @exprAmountVnd + N' AS amountVnd,
                    ' + @exprAmountCur + N' AS amountCur,
                    ' + @exprExchangeRate + N' AS exchangeRate,
                    ' + @exprCostCode + N' AS costCode,
                    ' + @exprUnitCode + N' AS unitCode,
                    ' + @exprCurrencyCode + N' AS currencyCode
                FROM ' + @masterTable + N' m
                LEFT JOIN ' + @detailTable + N' d ON d.idGui = m.idGui
                INNER JOIN #Req r ON r.idGui = m.idGui AND r.suffix = @suffix
                WHERE @p_unit IS NULL OR @p_unit = N'''' OR ISNULL(' + @exprUnitCode + N', N'''') = @p_unit;
            ';

            EXEC sp_executesql
                @sql,
                N'@suffix char(6), @p_unit nvarchar(50)',
                @suffix = @suffix,
                @p_unit = @unit;
        END

        FETCH NEXT FROM cur INTO @suffix;
    END

    CLOSE cur;
    DEALLOCATE cur;

    SELECT
        idGui,
        line_nbr,
        voucherDate,
        voucherNumber,
        customerCode,
        collectorName,
        reason,
        note,
        detailNote,
        cashAccount,
        offsetAccount,
        amountVnd,
        amountCur,
        exchangeRate,
        costCode,
        unitCode,
        currencyCode
    FROM #Raw
    ORDER BY idGui, line_nbr;
END
GO
