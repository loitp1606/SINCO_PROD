CREATE OR ALTER PROCEDURE [dbo].[SyncFromgoodsReceipt]
    @Ids NVARCHAR(MAX),
    @Unit NVARCHAR(50),
    @UserId NVARCHAR(50),
    @Language NVARCHAR(10),
    @FormConfig NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @newid VARCHAR(64) = REPLACE(LOWER(NEWID()), '-', '');

    SELECT
        idGui = LTRIM(RTRIM(value)),
        Unit = @Unit,
        UserId = @UserId,
        [Language] = @Language
    INTO #ds_phieu_nhap
    FROM STRING_SPLIT(@Ids, ',')
    WHERE LTRIM(RTRIM(value)) <> '';

    IF NOT EXISTS (SELECT 1 FROM #ds_phieu_nhap)
    BEGIN
        SELECT 0 AS type, N'Không có phiếu nhập để kế thừa.' AS message;
        RETURN;
    END;

    DECLARE @dfrom SMALLDATETIME, @dTo SMALLDATETIME, @dTmp SMALLDATETIME, @q NVARCHAR(MAX), @sync VARCHAR(6);
    SELECT @dfrom = MIN(voucherDate), @dTo = MAX(voucherDate)
    FROM goodsReceipt$000000 a
    JOIN #ds_phieu_nhap b ON a.idGui = b.idGui;

    SELECT TOP 0 a.*, CAST('' AS VARCHAR(50)) AS idGuiPN
    INTO #master
    FROM goodsReceipt$000000 a;

    SELECT TOP 0 a.*, CAST('' AS VARCHAR(50)) AS idGuiPN
    INTO #detail
    FROM goodsReceiptDetail$000000 a;

    SELECT @dfrom = '20250101' WHERE @dfrom IS NULL;
    SELECT @dTo = GETDATE() WHERE @dTo IS NULL;

    SELECT @q = N'', @dTmp = DATEFROMPARTS(YEAR(@dfrom), MONTH(@dfrom), 1);
    WHILE @dTmp <= @dTo
    BEGIN
        SELECT @sync = CONVERT(VARCHAR(6), @dTmp, 112);
        SELECT @q = N'
IF OBJECT_ID(N''dbo.goodsReceipt$' + @sync + N''', N''U'') IS NOT NULL
BEGIN
    INSERT INTO #master
    SELECT a.*, CAST('''' AS VARCHAR(50)) AS idGuiPN
    FROM goodsReceipt$' + @sync + N' a
    JOIN #ds_phieu_nhap b ON a.idGui = b.idGui;
END

IF OBJECT_ID(N''dbo.goodsReceiptDetail$' + @sync + N''', N''U'') IS NOT NULL
BEGIN
    INSERT INTO #detail
    SELECT a.*, CAST('''' AS VARCHAR(50)) AS idGuiPN
    FROM goodsReceiptDetail$' + @sync + N' a
    JOIN #ds_phieu_nhap b ON a.idGui = b.idGui;
END
';
        EXEC (@q);
        SELECT @dTmp = DATEADD(MONTH, 1, @dTmp);
    END;

    IF NOT EXISTS (SELECT 1 FROM #master)
    BEGIN
        SELECT 0 AS type, N'Không tìm thấy dữ liệu phiếu nhập.' AS message;
        RETURN;
    END;

    IF EXISTS (SELECT 1 FROM #master a JOIN #master b ON 1=1 WHERE ISNULL(a.supplierCode, '') <> ISNULL(b.supplierCode, ''))
    BEGIN
        SELECT 0 AS type,
               CASE WHEN @Language = 'V'
                    THEN N'Có mã nhà cung cấp khác nhau giữa các phiếu nhập, vui lòng xem lại!!!'
                    ELSE N'There are different supplier codes between selected goods receipts, please check again!!!'
               END AS message;
        RETURN;
    END;

    EXEC [sp_UpdateNullsToDefault] '#master';
    EXEC [sp_UpdateNullsToDefault] '#detail';

    IF @FormConfig = 'paymentSlip.page.json'
    BEGIN
        SELECT TOP 0
            idGui, voucherCode, voucherNumber, voucherDate, createdDate,
            supplierCode, supplierAddress, receiptCode, invoiceNumber, cashier,
            spentMoney, paymentType, reason, employeeCode, amountTransfer, amountCash, note,
            datetime0, datetime2, user_id0, user_id2, status, total_amount, unitCode
        INTO #paymentmt
        FROM paymentslip$000000;

        SELECT TOP 0
            idGui, line_nbr, invoiceNumber, invoiceDate, invoiceAmount, paidAmount, debtAmount,
            accountPaymentCode, amountCur, amount, note, idGuiPN, lnPN
        INTO #paymentdt
        FROM paymentslipDetail$000000;

        INSERT INTO #paymentmt
        (
            idGui, voucherCode, voucherNumber, voucherDate, createdDate,
            supplierCode, supplierAddress, receiptCode, invoiceNumber, cashier,
            spentMoney, paymentType, reason, employeeCode, amountTransfer, amountCash, note,
            datetime0, datetime2, user_id0, user_id2, status, total_amount, unitCode
        )
        SELECT
            @newid,
            'Z06' AS voucherCode,
            '' AS voucherNumber,
            CONVERT(SMALLDATETIME, GETDATE(), 103) AS voucherDate,
            CONVERT(SMALLDATETIME, GETDATE(), 103) AS createdDate,
            a.supplierCode,
            MAX(a.addressSupplier) AS supplierAddress,
            MAX(a.voucherNumber) AS receiptCode,
            MAX(a.number_invoice) AS invoiceNumber,
            MAX(a.employeeCode) AS cashier,
            1 AS spentMoney,
            'INVOICE' AS paymentType,
            N'' AS reason,
            MAX(a.employeeCode) AS employeeCode,
            0 AS amountTransfer,
            0 AS amountCash,
            N'' AS note,
            GETDATE() AS datetime0,
            GETDATE() AS datetime2,
            TRY_CONVERT(INT, @UserId) AS user_id0,
            TRY_CONVERT(INT, @UserId) AS user_id2,
            '0' AS status,
            SUM(ISNULL(a.totalPayment, 0)) AS total_amount,
            @Unit AS unitCode
        FROM #master a
        GROUP BY a.supplierCode;

        DECLARE @amountExpr NVARCHAR(400), @invoiceExpr NVARCHAR(400), @paidExpr NVARCHAR(400);
        SET @invoiceExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'payment') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.payment), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'amount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
            ELSE N'0'
        END;
        SET @paidExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'sl_payment') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.sl_payment), 0)'
            ELSE N'0'
        END;
        SET @amountExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'payment') IS NOT NULL AND COL_LENGTH('tempdb..#detail', 'sl_payment') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.payment), 0) - ISNULL(TRY_CONVERT(decimal(24,6), d.sl_payment), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'amount') IS NOT NULL AND COL_LENGTH('tempdb..#detail', 'sl_payment') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0) - ISNULL(TRY_CONVERT(decimal(24,6), d.sl_payment), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'payment') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.payment), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'amount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
            ELSE N'0'
        END;

        SET @q = N'
            INSERT INTO #paymentdt (idGui, line_nbr, invoiceNumber, invoiceDate, invoiceAmount, paidAmount, debtAmount, accountPaymentCode, amountCur, amount, note, idGuiPN, lnPN)
            SELECT
                @p_newid,
                ROW_NUMBER() OVER(ORDER BY MIN(d.item_id), MIN(d.line_nbr)),
                MAX(m.voucherNumber) AS invoiceNumber,
                MAX(m.voucherDate) AS invoiceDate,
                SUM(' + @invoiceExpr + N') AS invoiceAmount,
                SUM(' + @paidExpr + N') AS paidAmount,
                SUM(' + @amountExpr + N') AS debtAmount,
                '''' AS accountPaymentCode,
                SUM(' + @amountExpr + N') AS amountCur,
                SUM(' + @amountExpr + N') AS amount,
                MAX(d.note) AS note,
                MAX(d.idGui) AS idGuiPN,
                1 AS lnPN
            FROM #detail d
            JOIN #master m ON d.idGui = m.idGui
            GROUP BY d.idGui;
        ';
        EXEC sp_executesql @q, N'@p_newid varchar(64)', @p_newid = @newid;

        UPDATE #paymentmt
        SET total_amount = b.amount
        FROM #paymentmt a
        JOIN (
            SELECT idGui, SUM(amount) AS amount
            FROM #paymentdt
            GROUP BY idGui
        ) b ON a.idGui = b.idGui;

        DELETE FROM #paymentdt WHERE ISNULL(amount, 0) = 0;

        IF NOT EXISTS (SELECT 1 FROM #paymentdt)
        BEGIN
            SELECT 0 AS type, N'Phiếu nhập đã kế thừa hết sang phiếu chi!!' AS message;
            RETURN;
        END;

        UPDATE m
        SET total_amount = x.total_amount
        FROM #paymentmt m
        JOIN (
            SELECT idGui, SUM(ISNULL(amount, 0)) AS total_amount
            FROM #paymentdt
            GROUP BY idGui
        ) x ON m.idGui = x.idGui;

        EXEC [sp_UpdateNullsToDefault] '#paymentmt';
        EXEC [sp_UpdateNullsToDefault] '#paymentdt';

        SELECT 1 AS type, '' AS message;
        SELECT * FROM #paymentmt;
        SELECT * FROM #paymentdt;
        RETURN;
    END;

    IF @FormConfig = 'orderReturn.page.json'
    BEGIN
        IF OBJECT_ID('dbo.orderReturn$000000', 'U') IS NULL
           OR OBJECT_ID('dbo.orderReturnDetail$000000', 'U') IS NULL
        BEGIN
            SELECT 0 AS type, N'Chưa có bảng orderReturn/orderReturnDetail.' AS message;
            RETURN;
        END;

        SELECT TOP 0
            idGui, voucherNumber, voucherDate, voucherCode,
            customerGroupCode, customerCode, addressCustomer, phoneCustomer,
            employeeCode, note, number_delivery,
            totalQuantity, totalAmount, totalTax, totalDiscount, totalPayment,
            status, user_id0, user_id2, datetime0, datetime2, unitCode
        INTO #orderReturnMt
        FROM orderReturn$000000;

        SELECT TOP 0
            idGui, line_nbr, stt, item_id, uom,
            quantity, price, ratioDiscount, amount, discount, tax, payment,
            note, tax_rate, taxCode, siteCode, idGuiDN, vcNumberDN, lnDN
        INTO #orderReturnDt
        FROM orderReturnDetail$000000;

        INSERT INTO #orderReturnMt
        (
            idGui, voucherNumber, voucherDate, voucherCode,
            customerGroupCode, customerCode, addressCustomer, phoneCustomer,
            employeeCode, note, number_delivery,
            totalQuantity, totalAmount, totalTax, totalDiscount, totalPayment,
            status, user_id0, user_id2, datetime0, datetime2, unitCode
        )
        SELECT
            @newid,
            '' AS voucherNumber,
            CONVERT(SMALLDATETIME, GETDATE(), 103) AS voucherDate,
            'Z09' AS voucherCode,
            '' AS customerGroupCode,
            MAX(ISNULL(a.supplierCode, '')) AS customerCode,
            MAX(ISNULL(a.addressSupplier, '')) AS addressCustomer,
            MAX(ISNULL(a.phoneSupplier, '')) AS phoneCustomer,
            MAX(ISNULL(a.employeeCode, '')) AS employeeCode,
            N'' AS note,
            MAX(ISNULL(a.voucherNumber, '')) AS number_delivery,
            0, 0, 0, 0, 0,
            '0' AS status,
            TRY_CONVERT(INT, @UserId) AS user_id0,
            TRY_CONVERT(INT, @UserId) AS user_id2,
            GETDATE() AS datetime0,
            GETDATE() AS datetime2,
            @Unit AS unitCode
        FROM #master a;

        DECLARE @exprLine NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'line_nbr') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(int, d.line_nbr), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'lineNbr') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(int, d.lineNbr), 0)'
            ELSE N'ROW_NUMBER() OVER(ORDER BY d.idGui)'
        END;
        DECLARE @exprQty NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'quantity') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,4), d.quantity), 0)'
            ELSE N'0'
        END;
        DECLARE @exprPrice NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'price') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,4), d.price), 0)'
            ELSE N'0'
        END;
        DECLARE @exprAmount NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,4), d.amount), 0)'
            ELSE N'(' + @exprQty + N' * ' + @exprPrice + N')'
        END;
        DECLARE @exprDiscount NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'discount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,4), d.discount), 0)'
            ELSE N'0'
        END;
        DECLARE @exprTax NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'tax') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,4), d.tax), 0)'
            ELSE N'0'
        END;
        DECLARE @exprPayment NVARCHAR(220) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'payment') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,4), d.payment), 0)'
            ELSE N'(' + @exprAmount + N' - ' + @exprDiscount + N' + ' + @exprTax + N')'
        END;
        DECLARE @exprTaxRate NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'tax_rate') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(5,2), d.tax_rate), 0)'
            ELSE N'0'
        END;
        DECLARE @exprSite NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'siteCode') IS NOT NULL THEN N'ISNULL(d.siteCode, '''')'
            WHEN COL_LENGTH('tempdb..#detail', 'locationCode') IS NOT NULL THEN N'ISNULL(d.locationCode, '''')'
            ELSE N''''''''
        END;
        DECLARE @exprLnDN NVARCHAR(200) = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'line_nbr') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(12,4), d.line_nbr), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'lineNbr') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(12,4), d.lineNbr), 0)'
            ELSE N'0'
        END;

        SET @q = N'
            INSERT INTO #orderReturnDt
            (
                idGui, line_nbr, stt, item_id, uom,
                quantity, price, ratioDiscount, amount, discount, tax, payment,
                note, tax_rate, taxCode, siteCode, idGuiDN, vcNumberDN, lnDN
            )
            SELECT
                @p_newid,
                ROW_NUMBER() OVER (ORDER BY d.idGui, ' + @exprLine + N') AS line_nbr,
                ' + @exprLine + N' AS stt,
                ISNULL(d.item_id, '''') AS item_id,
                ISNULL(d.uom, '''') AS uom,
                ' + @exprQty + N' AS quantity,
                ' + @exprPrice + N' AS price,
                ISNULL(TRY_CONVERT(decimal(24,4), d.ratioDiscount), 0) AS ratioDiscount,
                ' + @exprAmount + N' AS amount,
                ' + @exprDiscount + N' AS discount,
                ' + @exprTax + N' AS tax,
                ' + @exprPayment + N' AS payment,
                ISNULL(d.note, '''') AS note,
                ' + @exprTaxRate + N' AS tax_rate,
                ISNULL(d.taxCode, '''') AS taxCode,
                ' + @exprSite + N' AS siteCode,
                ISNULL(d.idGui, '''') AS idGuiDN,
                ISNULL(m.voucherNumber, '''') AS vcNumberDN,
                ' + @exprLnDN + N' AS lnDN
            FROM #detail d
            JOIN #master m ON d.idGui = m.idGui;
        ';
        EXEC sp_executesql @q, N'@p_newid varchar(64)', @p_newid = @newid;

        IF NOT EXISTS (SELECT 1 FROM #orderReturnDt)
        BEGIN
            SELECT 0 AS type, N'Không có chi tiết phiếu nhập để kế thừa.' AS message;
            RETURN;
        END;

        UPDATE mt
        SET
            totalQuantity = x.totalQuantity,
            totalAmount = x.totalAmount,
            totalTax = x.totalTax,
            totalDiscount = x.totalDiscount,
            totalPayment = x.totalPayment
        FROM #orderReturnMt mt
        JOIN
        (
            SELECT
                idGui,
                SUM(ISNULL(quantity, 0)) AS totalQuantity,
                SUM(ISNULL(amount, 0)) AS totalAmount,
                SUM(ISNULL(tax, 0)) AS totalTax,
                SUM(ISNULL(discount, 0)) AS totalDiscount,
                SUM(ISNULL(payment, 0)) AS totalPayment
            FROM #orderReturnDt
            GROUP BY idGui
        ) x ON mt.idGui = x.idGui;

        EXEC [sp_UpdateNullsToDefault] '#orderReturnMt';
        EXEC [sp_UpdateNullsToDefault] '#orderReturnDt';

        SELECT 1 AS type, '' AS message;
        SELECT * FROM #orderReturnMt;
        SELECT * FROM #orderReturnDt;
        RETURN;
    END;

    SELECT 0 AS type,
           CASE WHEN @Language = 'V'
                THEN N'Chưa hỗ trợ cấu hình kế thừa này.'
                ELSE N'This inheritance configuration is not supported yet.'
           END AS message;
END
GO
