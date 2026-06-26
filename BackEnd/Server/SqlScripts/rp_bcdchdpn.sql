CREATE OR ALTER PROCEDURE dbo.rp_bcdchdpn
(
    @dateFrom smalldatetime,
    @dateTo smalldatetime,
    @supplier varchar(50) = '',
    @invoiceNo varchar(100) = '',
    @receiptNo varchar(100) = '',
    @userId int = 0,
    @unit varchar(50) = '',
    @language char(2) = 'Vi'
)
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID(N'dbo.goodsReceipt$000000', N'U') IS NULL
       OR OBJECT_ID(N'dbo.goodsReceiptDetail$000000', N'U') IS NULL
    BEGIN
        SELECT TOP 0
            CAST(NULL AS date) AS invoice_date,
            CAST(N'' AS nvarchar(100)) AS invoice_no,
            CAST(NULL AS date) AS receipt_date,
            CAST(N'' AS nvarchar(100)) AS receipt_no,
            CAST(N'' AS nvarchar(255)) AS supplier_name,
            CAST(0 AS numeric(24,6)) AS invoice_amount,
            CAST(0 AS numeric(24,6)) AS receipt_amount,
            CAST(0 AS numeric(24,6)) AS amount_diff,
            CAST(N'' AS nvarchar(100)) AS reconcile_status;
        RETURN;
    END;

    DECLARE @q nvarchar(max), @key nvarchar(max);

    CREATE TABLE #report
    (
        invoice_no nvarchar(100) NULL,
        invoice_date date NULL,
        receipt_no nvarchar(100) NULL,
        receipt_date date NULL,
        supplier_code nvarchar(50) NULL,
        invoice_amount numeric(24,6) NOT NULL DEFAULT(0),
        receipt_amount numeric(24,6) NOT NULL DEFAULT(0)
    );

    SET @key = N'1=1';
    IF ISNULL(@supplier, '') <> ''
        SET @key = @key + N' and ISNULL(CONVERT(nvarchar(50), a.supplierCode), N'''') like N''' + REPLACE(RTRIM(@supplier), '''', '''''') + N'%''';
    IF ISNULL(@invoiceNo, '') <> ''
        SET @key = @key + N' and ISNULL(CONVERT(nvarchar(100), b.invoiceNumber), N'''') like N''%' + REPLACE(RTRIM(@invoiceNo), '''', '''''') + N'%''';
    IF ISNULL(@receiptNo, '') <> ''
        SET @key = @key + N' and ISNULL(CONVERT(nvarchar(100), a.voucherNumber), N'''') like N''%' + REPLACE(RTRIM(@receiptNo), '''', '''''') + N'%''';

    SET @q = N'
        INSERT INTO #report(invoice_no, invoice_date, receipt_no, receipt_date, supplier_code, invoice_amount, receipt_amount)
        SELECT
            ISNULL(CONVERT(nvarchar(100), b.invoiceNumber), N'''') AS invoice_no,
            TRY_CONVERT(date, b.invoiceDate) AS invoice_date,
            ISNULL(CONVERT(nvarchar(100), a.voucherNumber), N'''') AS receipt_no,
            TRY_CONVERT(date, a.voucherDate) AS receipt_date,
            ISNULL(CONVERT(nvarchar(50), a.supplierCode), N'''') AS supplier_code,
            ISNULL(TRY_CONVERT(numeric(24,6), b.amount), 0) AS invoice_amount,
            ISNULL(TRY_CONVERT(numeric(24,6), b.payment), 0) AS receipt_amount
        FROM goodsReceipt$$partition a
        JOIN goodsReceiptDetail$$partition b ON a.idGui = b.idGui
        WHERE ' + @key + N'
    ';

    EXEC sp_Execute_ByDateRange @q, @dateFrom, @dateTo, 'a.voucherDate', @userId, 1;

    SELECT
        invoice_date,
        invoice_no,
        receipt_date,
        receipt_no,
        supplier_name = COALESCE(NULLIF(s.supplier_name, N''), r.supplier_code),
        invoice_amount = SUM(invoice_amount),
        receipt_amount = SUM(receipt_amount),
        amount_diff = SUM(receipt_amount) - SUM(invoice_amount),
        reconcile_status = N'Đã gắn phiếu nhập'
    FROM #report r
    LEFT JOIN supplier s ON s.supplier_id = r.supplier_code
    WHERE ISNULL(invoice_no, N'') <> N''
    GROUP BY
        invoice_date,
        invoice_no,
        receipt_date,
        receipt_no,
        COALESCE(NULLIF(s.supplier_name, N''), r.supplier_code)
    ORDER BY
        invoice_date DESC,
        invoice_no DESC,
        receipt_date DESC,
        receipt_no DESC;
END
GO
