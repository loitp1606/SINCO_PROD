CREATE OR ALTER PROCEDURE dbo.sp_SaveSupplierPaymentAllocation
    @idGui NVARCHAR(50),
    @allocationJson NVARCHAR(MAX),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF OBJECT_ID('dbo.SupplierPaymentAllocation', 'U') IS NULL
        BEGIN
            RAISERROR(N'Chưa có bảng SupplierPaymentAllocation.', 16, 1);
            RETURN;
        END;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @supplierCode NVARCHAR(50),
            @paymentType NVARCHAR(30),
            @masterAmount DECIMAL(24,6),
            @resolvedUnitCode NVARCHAR(50),
            @clearAllocationOnly BIT,
            @deleteAllocationRequested BIT;

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.paymentslip$000000
        WHERE idGui = @idGui;

        IF @sync IS NULL
            RETURN;

        IF OBJECT_ID('tempdb..#mt') IS NOT NULL DROP TABLE #mt;
        CREATE TABLE #mt
        (
            supplierCode NVARCHAR(50) NULL,
            paymentType NVARCHAR(30) NULL,
            total_amount DECIMAL(24,6) NULL,
            unitCode NVARCHAR(50) NULL
        );

        IF COL_LENGTH('dbo.paymentslip$000000', 'paymentType') IS NOT NULL
            SET @q = N'
                INSERT INTO #mt(supplierCode, paymentType, total_amount, unitCode)
                SELECT TOP 1
                    supplierCode,
                    ISNULL(paymentType, N''SUPPLIER''),
                    TRY_CONVERT(decimal(24,6), total_amount),
                    unitCode
                FROM dbo.paymentslip$' + @sync + N'
                WHERE idGui = @p_idGui;';
        ELSE
            SET @q = N'
                INSERT INTO #mt(supplierCode, paymentType, total_amount, unitCode)
                SELECT TOP 1
                    supplierCode,
                    N''SUPPLIER'',
                    TRY_CONVERT(decimal(24,6), total_amount),
                    unitCode
                FROM dbo.paymentslip$' + @sync + N'
                WHERE idGui = @p_idGui;';
        EXEC sp_executesql @q, N'@p_idGui nvarchar(50)', @p_idGui = @idGui;

        SELECT TOP 1
            @supplierCode = supplierCode,
            @paymentType = UPPER(ISNULL(paymentType, N'SUPPLIER')),
            @masterAmount = ISNULL(total_amount, 0),
            @resolvedUnitCode = unitCode
        FROM #mt;

        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> N''
            SET @resolvedUnitCode = @unitCode;
        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = N''
            SET @resolvedUnitCode = N'CTY';

        SET @clearAllocationOnly = CASE
            WHEN @paymentType = N'DEPOSIT' THEN 1
            ELSE 0
        END;
        SET @deleteAllocationRequested = CASE
            WHEN ISNULL(LTRIM(RTRIM(@allocationJson)), N'') = N'[]' THEN 1
            ELSE 0
        END;

        IF @clearAllocationOnly = 1
        BEGIN
            DELETE dbo.SupplierPaymentAllocation WHERE PaymentIdGui = @idGui;
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#alloc') IS NOT NULL DROP TABLE #alloc;
        CREATE TABLE #alloc
        (
            refIdGuiPN NVARCHAR(50) NULL,
            refLineNbrPN INT NULL,
            paymentLineNbr INT NULL,
            invoiceNumber NVARCHAR(100) NULL,
            invoiceDate DATE NULL,
            invoiceAmount DECIMAL(24,6) NULL,
            outstandingAmount DECIMAL(24,6) NULL,
            allocatedAmount DECIMAL(24,6) NULL,
            note NVARCHAR(500) NULL
        );

        IF ISNULL(LTRIM(RTRIM(@allocationJson)), N'') <> N''
        BEGIN
            INSERT INTO #alloc
            (
                refIdGuiPN, refLineNbrPN, paymentLineNbr, invoiceNumber, invoiceDate, invoiceAmount, outstandingAmount, allocatedAmount, note
            )
            SELECT
                COALESCE(NULLIF(refIdGuiDN, N''), NULLIF(refIdGuiPN, N'')),
                COALESCE(refLineNbrDN, refLineNbrPN),
                COALESCE(receiptLineNbr, paymentLineNbr),
                invoiceNumber,
                invoiceDate,
                invoiceAmount,
                outstandingAmount,
                allocatedAmount,
                note
            FROM OPENJSON(@allocationJson)
            WITH
            (
                refIdGuiDN NVARCHAR(50) '$.refIdGuiDN',
                refIdGuiPN NVARCHAR(50) '$.refIdGuiPN',
                refLineNbrDN INT '$.refLineNbrDN',
                refLineNbrPN INT '$.refLineNbrPN',
                receiptLineNbr INT '$.receiptLineNbr',
                paymentLineNbr INT '$.paymentLineNbr',
                invoiceNumber NVARCHAR(100) '$.invoiceNumber',
                invoiceDate DATE '$.invoiceDate',
                invoiceAmount DECIMAL(24,6) '$.invoiceAmount',
                outstandingAmount DECIMAL(24,6) '$.outstandingAmount',
                allocatedAmount DECIMAL(24,6) '$.allocatedAmount',
                note NVARCHAR(500) '$.note'
            );
        END;

        IF EXISTS (SELECT 1 FROM #alloc WHERE ISNULL(allocatedAmount, 0) < 0)
        BEGIN
            RAISERROR(N'Không cho phép phân bổ âm.', 16, 1);
            RETURN;
        END;

        DECLARE @sumAlloc DECIMAL(24,6) = ISNULL((SELECT SUM(ISNULL(allocatedAmount, 0)) FROM #alloc), 0);

        IF @clearAllocationOnly = 0 AND @deleteAllocationRequested = 0 AND @sumAlloc <= 0
        BEGIN
            RAISERROR(N'Phiếu chi công nợ phải phân bổ ít nhất một phiếu nhập.', 16, 1);
            RETURN;
        END;

        IF @sumAlloc > ISNULL(@masterAmount, 0)
        BEGIN
            RAISERROR(N'Tổng phân bổ vượt quá số tiền chứng từ.', 16, 1);
            RETURN;
        END;

        IF @deleteAllocationRequested = 0 AND @paymentType = N'DEPOSIT_OFFSET' AND @sumAlloc <> ISNULL(@masterAmount, 0)
        BEGIN
            RAISERROR(N'Chi công nợ từ tiền đặt cọc phải phân bổ hết số tiền cấn trừ.', 16, 1);
            RETURN;
        END;

        IF @paymentType = N'DEPOSIT_OFFSET'
        BEGIN
            DECLARE @depositBalance DECIMAL(24,6);

            SELECT @depositBalance = ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), AdvanceAmount), 0)), 0)
            FROM dbo.SupplierDebtLedger
            WHERE SupplierId = @supplierCode
              AND UnitCode = @resolvedUnitCode
              AND ISNULL(ReceiptIdGui, N'') <> @idGui
              AND UPPER(ISNULL(ReceiptType, N'')) IN (N'DEPOSIT', N'PAYMENT_DEPOSIT', N'PAYMENT_DEPOSIT_OFFSET', N'SUPPLIER_ADVANCE');

            IF @masterAmount > @depositBalance
            BEGIN
                RAISERROR(N'Số tiền cấn trừ vượt quá tiền đặt cọc hiện có của nhà cung cấp.', 16, 1);
                RETURN;
            END;
        END;

        IF OBJECT_ID('tempdb..#open') IS NOT NULL DROP TABLE #open;
        CREATE TABLE #open
        (
            refIdGuiPN NVARCHAR(50) NOT NULL PRIMARY KEY,
            outstandingAmount DECIMAL(24,6) NOT NULL
        );

        DECLARE @sql NVARCHAR(MAX);
        DECLARE @exprOutstanding NVARCHAR(300) = CASE
            WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'PayableAmount') IS NOT NULL
                THEN N'ISNULL(TRY_CONVERT(decimal(24,6), PayableAmount), 0)
                     + ISNULL(TRY_CONVERT(decimal(24,6), DebitAmount), 0)
                     - ISNULL(TRY_CONVERT(decimal(24,6), CreditAmount), 0)
                     - ISNULL(TRY_CONVERT(decimal(24,6), PaidAmount), 0)'
            ELSE N'0'
        END;

        SET @sql = N'
            INSERT INTO #open(refIdGuiPN, outstandingAmount)
            SELECT RefIdGui, SUM(' + @exprOutstanding + N')
            FROM dbo.SupplierDebtLedger
            WHERE SupplierId = @p_supplierCode
              AND UnitCode = @p_unitCode
              AND ISNULL(ReceiptIdGui, N'''') <> @p_idGui
              AND ISNULL(RefIdGui, N'''') <> N''''
              AND (
                    ISNULL(RefController, N'''') = N''goodsReceipt''
                    OR (
                        ISNULL(RefController, N'''') = N''paymentSlip''
                        AND UPPER(ISNULL(ReceiptType, N'''')) IN (N''PAYMENT_SUPPLIER'', N''PAYMENT_DEPOSIT_OFFSET'')
                    )
                  )
            GROUP BY RefIdGui;';
        EXEC sp_executesql
            @sql,
            N'@p_supplierCode nvarchar(50), @p_unitCode nvarchar(50), @p_idGui nvarchar(50)',
            @p_supplierCode = @supplierCode,
            @p_unitCode = @resolvedUnitCode,
            @p_idGui = @idGui;

        IF EXISTS
        (
            SELECT 1
            FROM
            (
                SELECT refIdGuiPN, SUM(ISNULL(allocatedAmount, 0)) AS allocatedAmount
                FROM #alloc
                WHERE ISNULL(refIdGuiPN, N'') <> N''
                GROUP BY refIdGuiPN
            ) a
            LEFT JOIN #open o ON o.refIdGuiPN = a.refIdGuiPN
            WHERE a.allocatedAmount > ISNULL(o.outstandingAmount, 0)
        )
        BEGIN
            RAISERROR(N'Số phân bổ vượt nợ còn lại của ít nhất một hóa đơn.', 16, 1);
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#affectedPN') IS NOT NULL DROP TABLE #affectedPN;
        CREATE TABLE #affectedPN
        (
            refIdGuiPN NVARCHAR(50) NOT NULL PRIMARY KEY
        );

        INSERT INTO #affectedPN(refIdGuiPN)
        SELECT DISTINCT RefIdGuiPN
        FROM dbo.SupplierPaymentAllocation
        WHERE PaymentIdGui = @idGui
          AND ISNULL(RefIdGuiPN, N'') <> N'';

        BEGIN TRAN;
        DELETE dbo.SupplierPaymentAllocation WHERE PaymentIdGui = @idGui;

        INSERT INTO dbo.SupplierPaymentAllocation
        (
            UnitCode, SupplierId, PaymentIdGui, PaymentLineNbr,
            RefIdGuiPN, RefLineNbrPN, InvoiceNumber, InvoiceDate,
            InvoiceAmount, OutstandingAmount, AllocatedAmount, Note, CreatedBy, CreatedAt
        )
        SELECT
            @resolvedUnitCode, @supplierCode, @idGui, paymentLineNbr,
            refIdGuiPN, refLineNbrPN, invoiceNumber, invoiceDate,
            ISNULL(invoiceAmount, 0), ISNULL(outstandingAmount, 0), ISNULL(allocatedAmount, 0),
            note, @userId, SYSDATETIME()
        FROM #alloc
        WHERE ISNULL(allocatedAmount, 0) > 0
          AND ISNULL(refIdGuiPN, N'') <> N'';

        INSERT INTO #affectedPN(refIdGuiPN)
        SELECT DISTINCT al.refIdGuiPN
        FROM #alloc al
        WHERE ISNULL(al.refIdGuiPN, N'') <> N''
          AND NOT EXISTS (SELECT 1 FROM #affectedPN a WHERE a.refIdGuiPN = al.refIdGuiPN);

        COMMIT;

        -- Đồng bộ ledger ngay sau khi lưu phân bổ (không cần đợi submit form)
        IF OBJECT_ID('dbo.sp_ApplySupplierPaymentAllocationFromPaymentSlip', 'P') IS NOT NULL
        BEGIN
            EXEC dbo.sp_ApplySupplierPaymentAllocationFromPaymentSlip
                @idGui = @idGui,
                @unitCode = @resolvedUnitCode,
                @userId = @userId;
        END

        -- Đồng bộ lại trạng thái thanh toán trên goodsReceipt
        IF EXISTS (SELECT 1 FROM #affectedPN)
           AND OBJECT_ID('dbo.goodsReceipt$000000', 'U') IS NOT NULL
        BEGIN
            IF OBJECT_ID('tempdb..#grSync') IS NOT NULL DROP TABLE #grSync;
            CREATE TABLE #grSync
            (
                refIdGuiPN NVARCHAR(50) NOT NULL PRIMARY KEY,
                sync CHAR(6) NOT NULL
            );

            INSERT INTO #grSync(refIdGuiPN, sync)
            SELECT gr.idGui, CONVERT(CHAR(6), gr.voucherDate, 112)
            FROM dbo.goodsReceipt$000000 gr
            JOIN #affectedPN a ON a.refIdGuiPN = gr.idGui;

            IF EXISTS (SELECT 1 FROM #grSync)
            BEGIN
                DECLARE @setClause NVARCHAR(MAX) = N'';
                DECLARE @paidExpr NVARCHAR(600) = CASE
                    WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'PaidAmount') IS NOT NULL
                         AND COL_LENGTH('dbo.SupplierDebtLedger', 'CreditAmount') IS NOT NULL
                        THEN N'CASE
                                    WHEN ISNULL(TRY_CONVERT(decimal(24,6), l.PaidAmount), 0) <> 0
                                        THEN ISNULL(TRY_CONVERT(decimal(24,6), l.PaidAmount), 0)
                                    ELSE ISNULL(TRY_CONVERT(decimal(24,6), l.CreditAmount), 0)
                                END'
                    WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'PaidAmount') IS NOT NULL
                        THEN N'ISNULL(TRY_CONVERT(decimal(24,6), l.PaidAmount), 0)'
                    WHEN COL_LENGTH('dbo.SupplierDebtLedger', 'CreditAmount') IS NOT NULL
                        THEN N'ISNULL(TRY_CONVERT(decimal(24,6), l.CreditAmount), 0)'
                    ELSE N'0'
                END;
                DECLARE @receiptTypeFilter NVARCHAR(400) = N'';
                IF COL_LENGTH('dbo.SupplierDebtLedger', 'ReceiptType') IS NOT NULL
                    SET @receiptTypeFilter = N'
                                      AND UPPER(ISNULL(l.ReceiptType, N'''')) IN (N''PAYMENT_SUPPLIER'', N''PAYMENT_DEPOSIT_OFFSET'', N''SUPPLIER_PAYMENT'')';

                IF COL_LENGTH('dbo.goodsReceipt$000000', 'paidAmount') IS NOT NULL
                    SET @setClause = @setClause + N', paidAmount = ISNULL(agg.paidAmount, 0)';

                IF COL_LENGTH('dbo.goodsReceipt$000000', 'debtAmount') IS NOT NULL
                    SET @setClause = @setClause + N', debtAmount = ISNULL(TRY_CONVERT(decimal(24,6), gr.totalPayment), 0) - ISNULL(agg.paidAmount, 0)';

                IF COL_LENGTH('dbo.goodsReceipt$000000', 'paymentStatus') IS NOT NULL
                    SET @setClause = @setClause + N',
                        paymentStatus = CASE
                            WHEN ISNULL(TRY_CONVERT(decimal(24,6), gr.totalPayment), 0) <= 0 THEN N''UNPAID''
                            WHEN ISNULL(agg.paidAmount, 0) <= 0 THEN N''UNPAID''
                            WHEN ISNULL(agg.paidAmount, 0) >= ISNULL(TRY_CONVERT(decimal(24,6), gr.totalPayment), 0) THEN N''PAID''
                            ELSE N''PARTIAL''
                        END';

                IF LEN(@setClause) > 0
                BEGIN
                    DECLARE @syncGr CHAR(6);
                    DECLARE @sqlGr NVARCHAR(MAX);

                    DECLARE cur_sync CURSOR LOCAL FAST_FORWARD FOR
                        SELECT DISTINCT sync FROM #grSync;

                    OPEN cur_sync;
                    FETCH NEXT FROM cur_sync INTO @syncGr;
                    WHILE @@FETCH_STATUS = 0
                    BEGIN
                        IF OBJECT_ID(N'dbo.goodsReceipt$' + @syncGr, 'U') IS NOT NULL
                        BEGIN
                            SET @sqlGr = N'
                                UPDATE gr
                                   SET ' + STUFF(@setClause, 1, 2, N'') + N'
                                FROM dbo.goodsReceipt$' + @syncGr + N' gr
                                JOIN #grSync k ON k.refIdGuiPN = gr.idGui AND k.sync = @p_sync
                                OUTER APPLY
                                (
                                    SELECT SUM(' + @paidExpr + N') AS paidAmount
                                    FROM dbo.SupplierDebtLedger l
                                    WHERE ISNULL(l.RefController, N'''') = N''paymentSlip''
                                      ' + @receiptTypeFilter + N'
                                      AND ISNULL(l.RefIdGui, N'''') = gr.idGui
                                      AND ISNULL(l.SupplierId, N'''') = @p_supplierCode
                                      AND ISNULL(l.UnitCode, N'''') = @p_unitCode
                                ) agg;';

                            EXEC sp_executesql
                                @sqlGr,
                                N'@p_sync char(6), @p_supplierCode nvarchar(50), @p_unitCode nvarchar(50)',
                                @p_sync = @syncGr,
                                @p_supplierCode = @supplierCode,
                                @p_unitCode = @resolvedUnitCode;
                        END;

                        FETCH NEXT FROM cur_sync INTO @syncGr;
                    END;
                    CLOSE cur_sync;
                    DEALLOCATE cur_sync;
                END;
            END;
        END;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@err, 16, 1);
    END CATCH
END
GO
