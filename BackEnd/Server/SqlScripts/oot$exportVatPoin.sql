CREATE OR ALTER PROCEDURE [dbo].[oot$exportVatPoin]
    @list_guiid       NVARCHAR(MAX),   -- ví dụ: 'GUID1,GUID2,GUID3'
    @listVoucherDate  NVARCHAR(MAX),   -- ví dụ: '2026-03-01,2026-03-05,2026-03-10' (có thể rỗng)
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
            TRY_CONVERT(date, LTRIM(RTRIM(T.c.value('.', 'nvarchar(100)'))), 23), -- yyyy-mm-dd
            TRY_CONVERT(date, LTRIM(RTRIM(T.c.value('.', 'nvarchar(100)'))), 103), -- dd/mm/yyyy
            TRY_CONVERT(date, LTRIM(RTRIM(T.c.value('.', 'nvarchar(100)'))))       -- auto
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
        vendorCode NVARCHAR(64),
        vendorName NVARCHAR(256),
        vendorAddress NVARCHAR(512),
        note NVARCHAR(512),
        paymentMethod NVARCHAR(64),
        invoiceForm NVARCHAR(64),
        invoiceSerial NVARCHAR(64),
        invoiceDate DATE,
        invoiceNumber NVARCHAR(128),
        taxCode NVARCHAR(64),
        totalAmount DECIMAL(24,6),
        totalTax DECIMAL(24,6),
        taxRate DECIMAL(18,6),
        itemCode NVARCHAR(64),
        itemName NVARCHAR(512),
        quantity DECIMAL(24,6),
        price DECIMAL(24,6),
        amount DECIMAL(24,6),
        warehouseCode NVARCHAR(64)
    );
    
    DECLARE @suffix CHAR(6);
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT suffix FROM #Req;

    OPEN cur;
    FETCH NEXT FROM cur INTO @suffix;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @masterName SYSNAME = N'poin$' + @suffix;
        DECLARE @detailName SYSNAME = N'poindetail$' + @suffix;
        DECLARE @masterTable SYSNAME = QUOTENAME(@masterName);
        DECLARE @detailTable SYSNAME = QUOTENAME(@detailName);

        IF OBJECT_ID(N'dbo.' + @masterName, 'U') IS NOT NULL
           AND OBJECT_ID(N'dbo.' + @detailName, 'U') IS NOT NULL
        BEGIN
            DECLARE @exprVendorCode NVARCHAR(200) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'vendorCode') IS NOT NULL THEN N'm.vendorCode'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'supplierCode') IS NOT NULL THEN N'm.supplierCode'
                ELSE N''''''
            END;
            DECLARE @exprVendorName NVARCHAR(200) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'vendorName') IS NOT NULL THEN N'm.vendorName'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'supplierName') IS NOT NULL THEN N'm.supplierName'
                ELSE N''''''
            END;
            DECLARE @exprVendorAddress NVARCHAR(250) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'vendorAddress') IS NOT NULL THEN N'm.vendorAddress'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'addressSupplier') IS NOT NULL THEN N'm.addressSupplier'
                ELSE N''''''
            END;
            DECLARE @exprPaymentMethod NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'paymentMethod') IS NOT NULL THEN N'm.paymentMethod'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'payMethodCode') IS NOT NULL THEN N'm.payMethodCode'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'payTermCode') IS NOT NULL THEN N'm.payTermCode'
                ELSE N''''''
            END;
            DECLARE @exprInvoiceForm NVARCHAR(200) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceForm') IS NOT NULL THEN N'm.invoiceForm'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'mauHd') IS NOT NULL THEN N'm.mauHd'
                ELSE N''''''
            END;
            DECLARE @exprInvoiceSerial NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceSerial') IS NOT NULL THEN N'm.invoiceSerial'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'kyHieuHd') IS NOT NULL THEN N'm.kyHieuHd'
                ELSE N''''''
            END;
            DECLARE @exprInvoiceDate NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceDate') IS NOT NULL THEN N'TRY_CONVERT(date, m.invoiceDate)'
                ELSE N'NULL'
            END;
            DECLARE @exprInvoiceNumber NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceNumber') IS NOT NULL THEN N'm.invoiceNumber'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'invoiceVAT') IS NOT NULL THEN N'm.invoiceVAT'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'number_invoice') IS NOT NULL THEN N'm.number_invoice'
                ELSE N''''''
            END;
            DECLARE @exprTotalAmount NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'total_amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.total_amount), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'total_payment') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.total_payment), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'totalAmount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.totalAmount), 0)'
                ELSE N'0'
            END;
            DECLARE @exprTotalTax NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'total_tax') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.total_tax), 0)'
                WHEN COL_LENGTH(N'dbo.' + @masterName, 'totalTax') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), m.totalTax), 0)'
                ELSE N'0'
            END;

            DECLARE @exprItemCode NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'itemCode') IS NOT NULL THEN N'd.itemCode'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'item_id') IS NOT NULL THEN N'd.item_id'
                ELSE N''''''
            END;
            DECLARE @exprItemName NVARCHAR(300) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'itemNameVAT') IS NOT NULL THEN N'd.itemNameVAT'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'itemName') IS NOT NULL THEN N'd.itemName'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'item_name') IS NOT NULL THEN N'd.item_name'
                ELSE N''''''
            END;
            DECLARE @exprQty NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'quantity') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.quantity), 0)'
                ELSE N'0'
            END;
            DECLARE @exprPrice NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'price') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.price), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'unitPrice') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.unitPrice), 0)'
                ELSE N'0'
            END;
            DECLARE @exprAmount NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'lineAmount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.lineAmount), 0)'
                ELSE N'(' + @exprQty + N' * ' + @exprPrice + N')'
            END;
            DECLARE @exprTaxRate NVARCHAR(260) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'tax_rate') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), d.tax_rate), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'taxRate') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), d.taxRate), 0)'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'taxPercent') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(18,6), d.taxPercent), 0)'
                ELSE N'0'
            END;
            DECLARE @exprWarehouse NVARCHAR(220) = CASE
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'warehouseCode') IS NOT NULL THEN N'd.warehouseCode'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'locationCode') IS NOT NULL THEN N'd.locationCode'
                WHEN COL_LENGTH(N'dbo.' + @detailName, 'warehouse') IS NOT NULL THEN N'd.warehouse'
                ELSE N''''''
            END;

            DECLARE @exprSuppTax NVARCHAR(220) = CASE
                WHEN COL_LENGTH('dbo.supplier', 'ma_so_thue') IS NOT NULL THEN N'ISNULL(s.ma_so_thue, N'''')'
                WHEN COL_LENGTH('dbo.supplier', 'masothue') IS NOT NULL THEN N'ISNULL(s.masothue, N'''')'
                WHEN COL_LENGTH('dbo.supplier', 'mst') IS NOT NULL THEN N'ISNULL(s.mst, N'''')'
                WHEN COL_LENGTH('dbo.supplier', 'taxCode') IS NOT NULL THEN N'ISNULL(s.taxCode, N'''')'
                WHEN COL_LENGTH('dbo.supplier', 'tax_code') IS NOT NULL THEN N'ISNULL(s.tax_code, N'''')'
                ELSE N'N'''''
            END;

            DECLARE @sql NVARCHAR(MAX) = N'
                INSERT INTO #Raw
                (
                    idGui, line_nbr, voucherDate, voucherNumber, vendorCode, vendorName, vendorAddress, note,
                    paymentMethod, invoiceForm, invoiceSerial, invoiceDate, invoiceNumber, taxCode,
                    totalAmount, totalTax, taxRate, itemCode, itemName, quantity, price, amount, warehouseCode
                )
                SELECT
                    m.idGui,
                    ISNULL(TRY_CONVERT(int, d.line_nbr), 0) AS line_nbr,
                    TRY_CONVERT(date, m.voucherDate) AS voucherDate,
                    ISNULL(m.voucherNumber, N'''') AS voucherNumber,
                    ' + @exprVendorCode + N' AS vendorCode,
                    ' + @exprVendorName + N' AS vendorName,
                    ' + @exprVendorAddress + N' AS vendorAddress,
                    ISNULL(m.note, N'''') AS note,
                    ' + @exprPaymentMethod + N' AS paymentMethod,
                    ' + @exprInvoiceForm + N' AS invoiceForm,
                    ' + @exprInvoiceSerial + N' AS invoiceSerial,
                    ' + @exprInvoiceDate + N' AS invoiceDate,
                    ' + @exprInvoiceNumber + N' AS invoiceNumber,
                    ' + @exprSuppTax + N' AS taxCode,
                    ' + @exprTotalAmount + N' AS totalAmount,
                    ' + @exprTotalTax + N' AS totalTax,
                    ' + @exprTaxRate + N' AS taxRate,
                    ' + @exprItemCode + N' AS itemCode,
                    ' + @exprItemName + N' AS itemName,
                    ' + @exprQty + N' AS quantity,
                    ' + @exprPrice + N' AS price,
                    ' + @exprAmount + N' AS amount,
                    ' + @exprWarehouse + N' AS warehouseCode
                FROM ' + @masterTable + N' m
                INNER JOIN ' + @detailTable + N' d ON d.idGui = m.idGui
                INNER JOIN #Req r ON r.idGui = m.idGui AND r.suffix = @suffix
                LEFT JOIN dbo.supplier s ON s.supplier_id = ' + @exprVendorCode + N';
            ';
         
            EXEC sp_executesql
                @sql,
                N'@suffix char(6)',
                @suffix = @suffix;
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
        vendorCode,
        vendorName,
        vendorAddress,
        note,
        paymentMethod,
        invoiceForm,
        invoiceSerial,
        invoiceDate,
        invoiceNumber,
        taxCode,
        totalAmount,
        totalTax,
        taxRate,
        itemCode,
        itemName,
        quantity,
        price,
        amount,
        warehouseCode
    FROM #Raw
    ORDER BY idGui, line_nbr;
END
GO
