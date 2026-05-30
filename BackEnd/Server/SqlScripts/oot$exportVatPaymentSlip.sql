CREATE OR ALTER PROCEDURE [dbo].[oot$exportVatPaymentSlip]
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
        supplierCode NVARCHAR(64),
        reason NVARCHAR(512),
        note NVARCHAR(512),
        detailNote NVARCHAR(512),
        amountVnd DECIMAL(24,6),
        invoiceSerial NVARCHAR(64),
        invoiceNumber NVARCHAR(128),
        invoiceDate DATE,
        maKhVat NVARCHAR(64),
        supplierName NVARCHAR(512),
        supplierAddress NVARCHAR(512),
        taxCode NVARCHAR(64),
        tienVndVat DECIMAL(24,6),
        taxRate DECIMAL(18,6),
        taxAmount DECIMAL(24,6),
        unitCode NVARCHAR(64)
    );

    DECLARE @suffix CHAR(6);
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT suffix FROM #Req;

    OPEN cur;
    FETCH NEXT FROM cur INTO @suffix;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @masterName SYSNAME = N'paymentslip$' + @suffix;
        DECLARE @detailName SYSNAME = N'paymentslipdetail$' + @suffix;
        DECLARE @masterTable SYSNAME = QUOTENAME(@masterName);
        DECLARE @detailTable SYSNAME = QUOTENAME(@detailName);

        IF OBJECT_ID(N'dbo.' + @masterName, 'U') IS NOT NULL
           AND OBJECT_ID(N'dbo.' + @detailName, 'U') IS NOT NULL
        BEGIN
            DECLARE @exprSupplierCode NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'supplierCode') IS NOT NULL THEN N'm.supplierCode'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'vendorCode') IS NOT NULL THEN N'm.vendorCode'
                ELSE N'N'''''''
            END;
            DECLARE @exprReason NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'reason') IS NOT NULL THEN N'm.reason'
                ELSE N'N'''''''
            END;
            DECLARE @exprNote NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'note') IS NOT NULL THEN N'm.note'
                ELSE N'N'''''''
            END;
            DECLARE @exprUnitCode NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'unitCode') IS NOT NULL THEN N'm.unitCode'
                ELSE N'N'''''''
            END;
            DECLARE @exprMasterAmount NVARCHAR(260) = CASE
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
                ELSE N'N'''''''
            END;
            DECLARE @exprAmountVnd NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
                ELSE @exprMasterAmount
            END;
            DECLARE @exprInvoiceSerial NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceSerial') IS NOT NULL THEN N'm.invoiceSerial'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'kyHieuHd') IS NOT NULL THEN N'm.kyHieuHd'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'serialNumber') IS NOT NULL THEN N'm.serialNumber'
                ELSE N'N'''''''
            END;
            DECLARE @exprInvoiceNumber NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceNumber') IS NOT NULL THEN N'm.invoiceNumber'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'number_invoice') IS NOT NULL THEN N'm.number_invoice'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceVAT') IS NOT NULL THEN N'm.invoiceVAT'
                ELSE N'N'''''''
            END;
            DECLARE @exprInvoiceDate NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceDate') IS NOT NULL THEN N'TRY_CONVERT(date, m.invoiceDate)'
                ELSE N'NULL'
            END;
            DECLARE @exprTaxRate NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'tax_rate') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), d.tax_rate), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'taxRate') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), d.taxRate), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'taxPercent') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), d.taxPercent), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'tax_rate') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), m.tax_rate), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'taxRate') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), m.taxRate), 0)'
                ELSE N'0'
            END;
            DECLARE @exprTaxAmount NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'tax') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.tax), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'taxAmount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.taxAmount), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'total_tax') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.total_tax), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'totalTax') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.totalTax), 0)'
                ELSE N'(' + @exprAmountVnd + N' * ' + @exprTaxRate + N' / 100.0)'
            END;
            DECLARE @exprSuppName NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.supplier', 'supplier_name') IS NOT NULL THEN N'ISNULL(s.supplier_name, N'''')'
                WHEN COL_LENGTH(N'dbo.supplier', 'supplierName') IS NOT NULL THEN N'ISNULL(s.supplierName, N'''')'
                ELSE N'N'''''
            END;
            DECLARE @exprSuppAddress NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.supplier', 'address') IS NOT NULL THEN N'ISNULL(s.address, N'''')'
                WHEN COL_LENGTH(N'dbo.supplier', 'supplier_address') IS NOT NULL THEN N'ISNULL(s.supplier_address, N'''')'
                WHEN COL_LENGTH(N'dbo.supplier', 'address1') IS NOT NULL THEN N'ISNULL(s.address1, N'''')'
                ELSE N'N'''''
            END;
            DECLARE @exprSuppTax NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.supplier', 'ma_so_thue') IS NOT NULL THEN N'ISNULL(s.ma_so_thue, N'''')'
                WHEN COL_LENGTH(N'dbo.supplier', 'masothue') IS NOT NULL THEN N'ISNULL(s.masothue, N'''')'
                WHEN COL_LENGTH(N'dbo.supplier', 'mst') IS NOT NULL THEN N'ISNULL(s.mst, N'''')'
                WHEN COL_LENGTH(N'dbo.supplier', 'taxCode') IS NOT NULL THEN N'ISNULL(s.taxCode, N'''')'
                ELSE N'N'''''
            END;

            DECLARE @sql NVARCHAR(MAX) = N'
                INSERT INTO #Raw
                (
                    idGui, line_nbr, voucherDate, voucherNumber, supplierCode, reason, note, detailNote,
                    amountVnd, invoiceSerial, invoiceNumber, invoiceDate,
                    maKhVat, supplierName, supplierAddress, taxCode,
                    tienVndVat, taxRate, taxAmount, unitCode
                )
                SELECT
                    m.idGui,
                    ' + @exprLineNbr + N' AS line_nbr,
                    TRY_CONVERT(date, m.voucherDate) AS voucherDate,
                    ISNULL(m.voucherNumber, N'''') AS voucherNumber,
                    ' + @exprSupplierCode + N' AS supplierCode,
                    ' + @exprReason + N' AS reason,
                    ' + @exprNote + N' AS note,
                    ' + @exprDetailNote + N' AS detailNote,
                    ' + @exprAmountVnd + N' AS amountVnd,
                    ' + @exprInvoiceSerial + N' AS invoiceSerial,
                    ' + @exprInvoiceNumber + N' AS invoiceNumber,
                    ' + @exprInvoiceDate + N' AS invoiceDate,
                    ' + @exprSupplierCode + N' AS maKhVat,
                    ' + @exprSuppName + N' AS supplierName,
                    ' + @exprSuppAddress + N' AS supplierAddress,
                    ' + @exprSuppTax + N' AS taxCode,
                    ' + @exprAmountVnd + N' AS tienVndVat,
                    ' + @exprTaxRate + N' AS taxRate,
                    ' + @exprTaxAmount + N' AS taxAmount,
                    ' + @exprUnitCode + N' AS unitCode
                FROM ' + @masterTable + N' m
                LEFT JOIN ' + @detailTable + N' d ON d.idGui = m.idGui
                LEFT JOIN dbo.supplier s ON s.supplier_id = ' + @exprSupplierCode + N'
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
        supplierCode,
        reason,
        note,
        detailNote,
        amountVnd,
        invoiceSerial,
        invoiceNumber,
        invoiceDate,
        maKhVat,
        supplierName,
        supplierAddress,
        taxCode,
        tienVndVat,
        taxRate,
        taxAmount,
        unitCode
    FROM #Raw
    ORDER BY idGui, line_nbr;
END
GO

