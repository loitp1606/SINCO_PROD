CREATE OR ALTER PROCEDURE [dbo].[oot$exportVat]
    @list_guiid NVARCHAR(MAX),
    @listVoucherDate NVARCHAR(MAX),
    @userID NVARCHAR(50) = NULL,
    @unit NVARCHAR(50) = NULL,
    @language NVARCHAR(10) = N'vi'
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID('tempdb..#Ids') IS NOT NULL DROP TABLE #Ids;
    CREATE TABLE #Ids
    (
        rn INT IDENTITY(1,1) PRIMARY KEY,
        idGui VARCHAR(50) NOT NULL
    );

    DECLARE @xmlIds XML =
        TRY_CAST(N'<r><v>' + REPLACE(ISNULL(@list_guiid, N''), ',', '</v><v>') + N'</v></r>' AS XML);

    INSERT INTO #Ids(idGui)
    SELECT LTRIM(RTRIM(T.c.value('.', 'varchar(50)')))
    FROM @xmlIds.nodes('/r/v') AS T(c)
    WHERE LTRIM(RTRIM(T.c.value('.', 'varchar(50)'))) <> '';

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
        idGui VARCHAR(50) NOT NULL,
        vcDate DATE NULL,
        suffix CHAR(6) NOT NULL
    );

    INSERT INTO #Req(idGui, vcDate, suffix)
    SELECT
        i.idGui,
        d.d,
        CASE WHEN d.d IS NULL THEN '000000' ELSE CONVERT(CHAR(6), d.d, 112) END
    FROM #Ids i
    LEFT JOIN #Dates d ON d.rn = i.rn;

    IF OBJECT_ID('tempdb..#Raw') IS NOT NULL DROP TABLE #Raw;
    CREATE TABLE #Raw
    (
        idGui VARCHAR(50),
        line_nbr INT,
        voucherNumber VARCHAR(32),
        invoiceVAT NVARCHAR(256),
        voucherDate DATETIME,
        customer_id VARCHAR(50),
        contactPerson NVARCHAR(128),
        customerVAT NVARCHAR(128),
        customerNameVAT NVARCHAR(1024),
        orderAddress NVARCHAR(256),
        phonePerson NVARCHAR(128),
        emailPerson NVARCHAR(128),
        masterNote NVARCHAR(256),
        item_id VARCHAR(50),
        itemNameCustomer NVARCHAR(512),
        uomCustomer NVARCHAR(256),
        uom NVARCHAR(256),
        quantity NUMERIC(24,4),
        price NUMERIC(24,4),
        amount NUMERIC(24,4),
        tax_rate NUMERIC(5,2),
        detailNote NVARCHAR(256),
        ma_so_thue NVARCHAR(50),
        stt INT
    );

    DECLARE @suffix CHAR(6);
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT suffix FROM #Req;

    OPEN cur;
    FETCH NEXT FROM cur INTO @suffix;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @masterName SYSNAME = N'deliveryNote$' + @suffix;
        DECLARE @detailName SYSNAME = N'deliveryNoteDetail$' + @suffix;
        DECLARE @masterTable SYSNAME = QUOTENAME(@masterName);
        DECLARE @detailTable SYSNAME = QUOTENAME(@detailName);

        IF OBJECT_ID(N'dbo.' + @masterName, 'U') IS NOT NULL
           AND OBJECT_ID(N'dbo.' + @detailName, 'U') IS NOT NULL
        BEGIN
            DECLARE @sql NVARCHAR(MAX) = N'
                INSERT INTO #Raw
                (
                    stt, idGui, line_nbr, voucherNumber, invoiceVAT, voucherDate, customer_id,
                    contactPerson, customerVAT, customerNameVAT, orderAddress, phonePerson,
                    emailPerson, masterNote, item_id, itemNameCustomer, uomCustomer, uom,
                    quantity, price, amount, tax_rate, detailNote, ma_so_thue
                )
                SELECT
                    0,
                    m.idGui,
                    d.line_nbr,
                    m.voucherNumber,
                    m.invoiceVAT,
                    m.voucherDate,
                    m.customer_id,
                    m.contactPerson,
                    COALESCE(NULLIF(m.customerVAT, ''''), m.customer_id),
                    ISNULL(c.customer_name, ''''),
                    m.orderAddress,
                    m.phonePerson,
                    m.emailPerson,
                    m.note,
                    d.item_id,
                    COALESCE(NULLIF(i.item_name, ''''), NULLIF(d.itemNameCustomer, ''''), ''''),
                    d.uomCustomer,
                    COALESCE(NULLIF(u.uomName, ''''), NULLIF(d.uomCustomer, ''''), NULLIF(d.uom, ''''), ''''),
                    d.quantity,
                    d.price,
                    d.amount,
                    d.tax_rate,
                    d.note,
                    ISNULL(c.ma_so_thue, '''')
                FROM ' + @masterTable + N' m
                INNER JOIN ' + @detailTable + N' d ON d.idGui = m.idGui
                INNER JOIN #Req r ON r.idGui = m.idGui AND r.suffix = @suffix
                LEFT JOIN dbo.customer c
                    ON c.customer_id = COALESCE(NULLIF(m.customerVAT, ''''), m.customer_id)
                LEFT JOIN dbo.item i ON i.item_id = d.item_id
                LEFT JOIN dbo.uom u
                    ON u.uomCode = COALESCE(NULLIF(d.uom, ''''), i.uom);';

            EXEC sp_executesql
                @sql,
                N'@suffix char(6)',
                @suffix = @suffix;
        END;

        FETCH NEXT FROM cur INTO @suffix;
    END;

    CLOSE cur;
    DEALLOCATE cur;

    UPDATE rawData
    SET stt = invoiceData.stt
    FROM #Raw rawData
    INNER JOIN
    (
        SELECT
            r.idGui,
            r.customerVAT,
            r.tax_rate,
            ROW_NUMBER() OVER
            (
                ORDER BY MIN(r.line_nbr), r.idGui, r.customerVAT, r.tax_rate
            ) AS stt
        FROM #Raw r
        GROUP BY r.idGui, r.customerVAT, r.tax_rate
    ) invoiceData
        ON rawData.idGui = invoiceData.idGui
       AND rawData.customerVAT = invoiceData.customerVAT
       AND rawData.tax_rate = invoiceData.tax_rate;

    SELECT
        MaHD = 'HD' + RTRIM(r.stt),
        NgayHoaDon = CONVERT(VARCHAR(10), r.voucherDate, 103),
        MaKhachHang = r.customerVAT,
        TenNguoiMua = CAST('' AS NVARCHAR(128)),
        TenDonVi = r.customerNameVAT,
        MaSoThue = r.ma_so_thue,
        DiaChiKhachHang = r.orderAddress,
        SoDienThoai = CAST('' AS NVARCHAR(128)),
        SoBangKe = CAST('' AS NVARCHAR(50)),
        NgayBangKe = CAST('' AS NVARCHAR(50)),
        SOTKKHACH = CAST('' AS NVARCHAR(50)),
        TENNHKHACH = CAST('' AS NVARCHAR(255)),
        HinhThucThanhToan = N'Chuyển khoản',
        ThueSuat = r.tax_rate,
        ThueSuatKhac = CAST('' AS NVARCHAR(50)),
        MaHang = r.item_id,
        TenHangHoa = r.itemNameCustomer,
        DVT = r.uom,
        SoLuong = r.quantity,
        DonGia = r.price,
        ThanhTien = r.amount,
        TienTe = N'VND',
        SoTT = ROW_NUMBER() OVER
        (
            PARTITION BY r.stt
            ORDER BY r.line_nbr, r.item_id
        ),
        TinhChat = 1,
        Email = r.emailPerson,
        Ghichu = r.detailNote
    FROM #Raw r
    ORDER BY r.stt, r.line_nbr, r.item_id;
END
GO
