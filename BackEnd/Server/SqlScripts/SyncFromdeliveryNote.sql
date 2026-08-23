CREATE OR ALTER PROCEDURE dbo.SyncFromdeliveryNote
    @Ids NVARCHAR(MAX),
    @Unit NVARCHAR(50),
    @UserId NVARCHAR(50),
    @Language NVARCHAR(10),
    @FormConfig NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF ISNULL(@FormConfig, N'') <> N'receiptV2.page.json'
    BEGIN
        SELECT 0 AS type, N'Cấu hình kế thừa này chưa được hỗ trợ.' AS message;
        RETURN;
    END;

    CREATE TABLE #selectedIds
    (
        idGui NVARCHAR(64) NOT NULL PRIMARY KEY,
        sync CHAR(6) NULL
    );

    INSERT INTO #selectedIds(idGui)
    SELECT DISTINCT LTRIM(RTRIM(value))
    FROM STRING_SPLIT(ISNULL(@Ids, N''), N',')
    WHERE LTRIM(RTRIM(value)) <> N'';

    IF NOT EXISTS (SELECT 1 FROM #selectedIds)
    BEGIN
        SELECT 0 AS type, N'Vui lòng chọn ít nhất một phiếu xuất.' AS message;
        RETURN;
    END;

    UPDATE s
       SET sync = CONVERT(CHAR(6), d.voucherDate, 112)
    FROM #selectedIds s
    JOIN dbo.deliveryNote$000000 d ON d.idGui = s.idGui;

    IF EXISTS (SELECT 1 FROM #selectedIds WHERE sync IS NULL)
    BEGIN
        SELECT 0 AS type, N'Không tìm thấy một hoặc nhiều phiếu xuất đã chọn.' AS message;
        RETURN;
    END;

    CREATE TABLE #dn
    (
        idGui NVARCHAR(64) NOT NULL PRIMARY KEY,
        voucherNumber NVARCHAR(100) NULL,
        voucherDate DATE NULL,
        customer_id NVARCHAR(50) NULL,
        customerAddress NVARCHAR(500) NULL,
        totalPayment DECIMAL(24,6) NULL,
        paidAmount DECIMAL(24,6) NULL,
        debtAmount DECIMAL(24,6) NULL,
        unitCode NVARCHAR(50) NULL
    );

    DECLARE @sync CHAR(6), @sql NVARCHAR(MAX);
    DECLARE sync_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT sync FROM #selectedIds ORDER BY sync;

    OPEN sync_cursor;
    FETCH NEXT FROM sync_cursor INTO @sync;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF OBJECT_ID(N'dbo.deliveryNote$' + @sync, N'U') IS NOT NULL
        BEGIN
            SET @sql = N'
                INSERT INTO #dn
                (
                    idGui, voucherNumber, voucherDate, customer_id, customerAddress,
                    totalPayment, paidAmount, debtAmount, unitCode
                )
                SELECT
                    d.idGui,
                    d.voucherNumber,
                    TRY_CONVERT(date, d.voucherDate),
                    d.customer_id,
                    ISNULL(c.address, N''''),
                    ISNULL(TRY_CONVERT(decimal(24,6), d.totalPayment), 0),
                    ISNULL(TRY_CONVERT(decimal(24,6), d.paidAmount), 0),
                    ISNULL(TRY_CONVERT(decimal(24,6), d.debtAmount), 0),
                    d.unitCode
                FROM dbo.deliveryNote$' + @sync + N' d
                JOIN #selectedIds s ON s.idGui = d.idGui AND s.sync = @p_sync
                LEFT JOIN dbo.customer c ON c.customer_id = d.customer_id;';

            EXEC sp_executesql @sql, N'@p_sync char(6)', @p_sync = @sync;
        END;

        FETCH NEXT FROM sync_cursor INTO @sync;
    END;
    CLOSE sync_cursor;
    DEALLOCATE sync_cursor;

    IF (SELECT COUNT(*) FROM #dn) <> (SELECT COUNT(*) FROM #selectedIds)
    BEGIN
        SELECT 0 AS type, N'Không đọc được đầy đủ dữ liệu phiếu xuất đã chọn.' AS message;
        RETURN;
    END;

    IF (SELECT COUNT(DISTINCT ISNULL(customer_id, N'')) FROM #dn) <> 1
    BEGIN
        SELECT 0 AS type, N'Chỉ được tạo chung phiếu thu cho các phiếu xuất cùng khách hàng.' AS message;
        RETURN;
    END;

    IF EXISTS
    (
        SELECT 1 FROM #dn
        WHERE NULLIF(LTRIM(RTRIM(customer_id)), N'') IS NULL
           OR (NULLIF(LTRIM(RTRIM(@Unit)), N'') IS NOT NULL AND ISNULL(unitCode, N'') <> @Unit)
    )
    BEGIN
        SELECT 0 AS type, N'Phiếu xuất không thuộc khách hàng hoặc đơn vị đang thao tác.' AS message;
        RETURN;
    END;

    CREATE TABLE #allocation
    (
        refIdGuiDN NVARCHAR(64) NOT NULL PRIMARY KEY,
        voucherNumber NVARCHAR(100) NULL,
        voucherDate DATE NULL,
        receivableAmount DECIMAL(24,6) NOT NULL,
        collectedAmount DECIMAL(24,6) NOT NULL,
        outstandingAmount DECIMAL(24,6) NOT NULL,
        allocatedAmount DECIMAL(24,6) NOT NULL,
        invoiceNumber NVARCHAR(100) NULL,
        invoiceDate DATE NULL,
        invoiceAmount DECIMAL(24,6) NOT NULL,
        note NVARCHAR(500) NULL
    );

    INSERT INTO #allocation
    (
        refIdGuiDN, voucherNumber, voucherDate, receivableAmount, collectedAmount,
        outstandingAmount, allocatedAmount, invoiceNumber, invoiceDate, invoiceAmount, note
    )
    SELECT
        d.idGui,
        d.voucherNumber,
        d.voucherDate,
        calc.receivableAmount,
        calc.collectedAmount,
        calc.outstandingAmount,
        calc.outstandingAmount,
        d.voucherNumber,
        d.voucherDate,
        calc.receivableAmount,
        N''
    FROM #dn d
    OUTER APPLY
    (
        SELECT
            receivableAmount = CASE
                WHEN ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), l.ReceivableAmount), 0)), 0) > 0
                    THEN ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), l.ReceivableAmount), 0)), 0)
                ELSE ISNULL(d.totalPayment, 0)
            END,
            collectedAmount = ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), l.CollectedAmount), 0)), ISNULL(d.paidAmount, 0)),
            outstandingAmount = CASE
                WHEN COUNT(l.RefIdGui) > 0 THEN
                    ISNULL(SUM(
                        ISNULL(TRY_CONVERT(decimal(24,6), l.ReceivableAmount), 0)
                        + ISNULL(TRY_CONVERT(decimal(24,6), l.DebitAmount), 0)
                        - ISNULL(TRY_CONVERT(decimal(24,6), l.CreditAmount), 0)
                        - ISNULL(TRY_CONVERT(decimal(24,6), l.CollectedAmount), 0)
                    ), 0)
                WHEN ISNULL(d.debtAmount, 0) > 0 THEN ISNULL(d.debtAmount, 0)
                ELSE ISNULL(d.totalPayment, 0) - ISNULL(d.paidAmount, 0)
            END
        FROM dbo.CustomerDebtLedger l
        WHERE l.CustomerId = d.customer_id
          AND l.UnitCode = d.unitCode
          AND l.RefIdGui = d.idGui
          AND
          (
                l.RefController = N'deliveryNote'
                OR (
                    l.RefController = N'receiptV2'
                    AND UPPER(ISNULL(l.ReceiptType, N'')) IN (N'RECEIPT_CUSTOMER', N'RECEIPT_INVOICE', N'RECEIPT_DEPOSIT_OFFSET')
                )
          )
    ) calc
    WHERE calc.outstandingAmount > 0;

    IF NOT EXISTS (SELECT 1 FROM #allocation)
    BEGIN
        SELECT 0 AS type, N'Các phiếu xuất đã chọn không còn công nợ phải thu.' AS message;
        RETURN;
    END;

    IF (SELECT COUNT(*) FROM #allocation) <> (SELECT COUNT(*) FROM #dn)
    BEGIN
        SELECT 0 AS type, N'Có phiếu xuất đã thanh toán đủ. Vui lòng chỉ chọn các phiếu còn nợ.' AS message;
        RETURN;
    END;

    DECLARE @newId NVARCHAR(64) = REPLACE(LOWER(CONVERT(NVARCHAR(36), NEWID())), N'-', N'');
    DECLARE @customerCode NVARCHAR(50) = (SELECT TOP 1 customer_id FROM #dn);
    DECLARE @customerAddress NVARCHAR(500) = (SELECT TOP 1 customerAddress FROM #dn);
    DECLARE @deliveryNoteNo NVARCHAR(50) = LEFT(
        (SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), voucherNumber), N', ') WITHIN GROUP (ORDER BY voucherDate, voucherNumber) FROM #dn),
        50
    );
    DECLARE @allocationJson NVARCHAR(MAX) =
    (
        SELECT
            refIdGuiDN, voucherNumber, voucherDate, receivableAmount, collectedAmount,
            outstandingAmount, allocatedAmount, invoiceNumber, invoiceDate, invoiceAmount, note
        FROM #allocation
        ORDER BY voucherDate, voucherNumber
        FOR JSON PATH
    );

    SELECT 1 AS type, N'' AS message;
    SELECT
        idGui = @newId,
        voucherCode = N'Z07',
        voucherNumber = N'',
        voucherDate = CONVERT(date, GETDATE()),
        createdDate = GETDATE(),
        customerCode = @customerCode,
        customerAddress = ISNULL(@customerAddress, N''),
        collectorCode = N'',
        receiptType = N'CUSTOMER',
        deliveryNoteNo = @deliveryNoteNo,
        allocationJson = @allocationJson,
        depositReceiptNo = N'',
        reason = N'',
        accountReceiveCode = N'',
        invoiceNumber = N'',
        paymentType = N'CK',
        amountTransfer = CAST(0 AS DECIMAL(24,6)),
        amountCash = CAST(0 AS DECIMAL(24,6)),
        total_amount = (SELECT SUM(allocatedAmount) FROM #allocation),
        isReceived = 0,
        dien_giai = N'',
        status = N'0',
        unitCode = @Unit,
        datetime0 = GETDATE(),
        datetime2 = GETDATE(),
        user_id0 = TRY_CONVERT(INT, @UserId),
        user_id2 = TRY_CONVERT(INT, @UserId);
END
GO
