CREATE OR ALTER PROCEDURE dbo.sp_SaveCustomerReceiptAllocation
    @idGui NVARCHAR(50),
    @allocationJson NVARCHAR(MAX),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF OBJECT_ID('dbo.CustomerReceiptAllocation', 'U') IS NULL
        BEGIN
            RAISERROR(N'Chưa có bảng CustomerReceiptAllocation.', 16, 1);
            RETURN;
        END;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @customerCode NVARCHAR(50),
            @receiptType NVARCHAR(30),
            @masterAmount DECIMAL(24,6),
            @resolvedUnitCode NVARCHAR(50),
            @status NVARCHAR(10),
            @isReceived INT,
            @clearAllocationOnly BIT,
            @deleteAllocationRequested BIT;

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.receiptV2$000000
        WHERE idGui = @idGui;

        IF @sync IS NULL
            RETURN;

        IF OBJECT_ID('tempdb..#mt') IS NOT NULL DROP TABLE #mt;
        CREATE TABLE #mt
        (
            customerCode NVARCHAR(50) NULL,
            receiptType NVARCHAR(30) NULL,
            total_amount DECIMAL(24,6) NULL,
            unitCode NVARCHAR(50) NULL,
            status NVARCHAR(10) NULL,
            isReceived INT NULL
        );

        SET @q = N'
            INSERT INTO #mt(customerCode, receiptType, total_amount, unitCode, status, isReceived)
            SELECT TOP 1
                customerCode,
                ISNULL(receiptType, N''CUSTOMER''),
                TRY_CONVERT(decimal(24,6), total_amount),
                unitCode,
                status,
                TRY_CONVERT(int, isReceived)
            FROM dbo.receiptV2$' + @sync + N'
            WHERE idGui = @p_idGui;';

        EXEC sp_executesql
            @q,
            N'@p_idGui nvarchar(50)',
            @p_idGui = @idGui;

        SELECT TOP 1
            @customerCode = customerCode,
            @receiptType = UPPER(ISNULL(receiptType, N'CUSTOMER')),
            @masterAmount = ISNULL(total_amount, 0),
            @resolvedUnitCode = unitCode,
            @status = status,
            @isReceived = ISNULL(isReceived, 0)
        FROM #mt;

        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> N''
            SET @resolvedUnitCode = @unitCode;
        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = N''
            SET @resolvedUnitCode = N'CTY';

        SET @clearAllocationOnly = CASE
            WHEN @receiptType IN (N'DEPOSIT', N'OTHER') THEN 1
            ELSE 0
        END;
        SET @deleteAllocationRequested = CASE
            WHEN ISNULL(LTRIM(RTRIM(@allocationJson)), N'') = N'[]' THEN 1
            ELSE 0
        END;

        IF OBJECT_ID('tempdb..#alloc') IS NOT NULL DROP TABLE #alloc;
        CREATE TABLE #alloc
        (
            refIdGuiDN NVARCHAR(50) NULL,
            refLineNbrDN INT NULL,
            receiptLineNbr INT NULL,
            invoiceNumber NVARCHAR(100) NULL,
            invoiceDate DATE NULL,
            invoiceAmount DECIMAL(24,6) NULL,
            outstandingAmount DECIMAL(24,6) NULL,
            allocatedAmount DECIMAL(24,6) NULL,
            note NVARCHAR(500) NULL
        );

        IF @clearAllocationOnly = 0
           AND ISNULL(LTRIM(RTRIM(@allocationJson)), N'') <> N''
        BEGIN
            INSERT INTO #alloc
            (
                refIdGuiDN, refLineNbrDN, receiptLineNbr, invoiceNumber, invoiceDate, invoiceAmount, outstandingAmount, allocatedAmount, note
            )
            SELECT
                refIdGuiDN, refLineNbrDN, receiptLineNbr, invoiceNumber, invoiceDate, invoiceAmount, outstandingAmount, allocatedAmount, note
            FROM OPENJSON(@allocationJson)
            WITH
            (
                refIdGuiDN NVARCHAR(50) '$.refIdGuiDN',
                refLineNbrDN INT '$.refLineNbrDN',
                receiptLineNbr INT '$.receiptLineNbr',
                invoiceNumber NVARCHAR(100) '$.invoiceNumber',
                invoiceDate DATE '$.invoiceDate',
                invoiceAmount DECIMAL(24,6) '$.invoiceAmount',
                outstandingAmount DECIMAL(24,6) '$.outstandingAmount',
                allocatedAmount DECIMAL(24,6) '$.allocatedAmount',
                note NVARCHAR(500) '$.note'
            );
        END;

        IF EXISTS
        (
            SELECT 1
            FROM #alloc
            WHERE ISNULL(allocatedAmount, 0) < 0
        )
        BEGIN
            RAISERROR(N'Không cho phép phân bổ âm.', 16, 1);
            RETURN;
        END;

        DECLARE @sumAlloc DECIMAL(24,6) =
            ISNULL((SELECT SUM(ISNULL(allocatedAmount, 0)) FROM #alloc), 0);

        DECLARE @shouldValidateAllocation BIT = CASE
            WHEN @clearAllocationOnly = 0 THEN 1
            ELSE 0
        END;

        IF @shouldValidateAllocation = 1 AND @deleteAllocationRequested = 0 AND @sumAlloc <= 0
        BEGIN
            RAISERROR(N'Phiếu thu công nợ phải phân bổ ít nhất một phiếu xuất.', 16, 1);
            RETURN;
        END;

        IF @sumAlloc > ISNULL(@masterAmount, 0)
        BEGIN
            RAISERROR(N'Tổng phân bổ vượt quá số tiền chứng từ.', 16, 1);
            RETURN;
        END;

        IF @deleteAllocationRequested = 0 AND @receiptType = N'DEPOSIT_OFFSET' AND @sumAlloc <> ISNULL(@masterAmount, 0)
        BEGIN
            RAISERROR(N'Thu công nợ từ tiền đặt cọc phải phân bổ hết số tiền cấn trừ.', 16, 1);
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#open') IS NOT NULL DROP TABLE #open;
        CREATE TABLE #open
        (
            refIdGuiDN NVARCHAR(50) NOT NULL PRIMARY KEY,
            outstandingAmount DECIMAL(24,6) NOT NULL
        );

        DECLARE @sql NVARCHAR(MAX);
        DECLARE @exprOutstanding NVARCHAR(300) = N'
            ISNULL(TRY_CONVERT(decimal(24,6), ReceivableAmount), 0)
            + ISNULL(TRY_CONVERT(decimal(24,6), DebitAmount), 0)
            - ISNULL(TRY_CONVERT(decimal(24,6), CreditAmount), 0)
            - ISNULL(TRY_CONVERT(decimal(24,6), CollectedAmount), 0)';

        SET @sql = N'
            INSERT INTO #open(refIdGuiDN, outstandingAmount)
            SELECT
                RefIdGui,
                SUM(' + @exprOutstanding + N') AS outstandingAmount
            FROM dbo.CustomerDebtLedger
            WHERE CustomerId = @p_customerCode
              AND UnitCode = @p_unitCode
              AND ISNULL(ReceiptIdGui, N'''') <> @p_idGui
              AND ISNULL(RefIdGui, N'''') <> N''''
              AND
              (
                    ISNULL(RefController, N'''') = N''deliveryNote''
                    OR (
                        ISNULL(RefController, N'''') = N''receiptV2''
                        AND UPPER(ISNULL(ReceiptType, N'''')) IN (N''RECEIPT_CUSTOMER'', N''RECEIPT_DEPOSIT_OFFSET'')
                    )
              )
            GROUP BY RefIdGui;';

        IF @clearAllocationOnly = 0
        BEGIN
            EXEC sp_executesql
                @sql,
                N'@p_customerCode nvarchar(50), @p_unitCode nvarchar(50), @p_idGui nvarchar(50)',
                @p_customerCode = @customerCode,
                @p_unitCode = @resolvedUnitCode,
                @p_idGui = @idGui;
        END;

        IF EXISTS
        (
            SELECT 1
            FROM
            (
                SELECT refIdGuiDN, SUM(ISNULL(allocatedAmount, 0)) AS allocatedAmount
                FROM #alloc
                WHERE ISNULL(refIdGuiDN, N'') <> N''
                GROUP BY refIdGuiDN
            ) a
            LEFT JOIN #open o ON o.refIdGuiDN = a.refIdGuiDN
            WHERE a.allocatedAmount > ISNULL(o.outstandingAmount, 0)
        )
        BEGIN
            RAISERROR(N'Số phân bổ vượt nợ còn lại của ít nhất một phiếu xuất.', 16, 1);
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#affectedDn') IS NOT NULL DROP TABLE #affectedDn;
        CREATE TABLE #affectedDn
        (
            refIdGuiDN NVARCHAR(50) NOT NULL PRIMARY KEY
        );

        INSERT INTO #affectedDn(refIdGuiDN)
        SELECT DISTINCT RefIdGuiDN
        FROM dbo.CustomerReceiptAllocation
        WHERE ReceiptIdGui = @idGui
          AND ISNULL(RefIdGuiDN, N'') <> N'';

        BEGIN TRAN;

        DELETE dbo.CustomerReceiptAllocation
        WHERE ReceiptIdGui = @idGui;

        INSERT INTO dbo.CustomerReceiptAllocation
        (
            UnitCode,
            CustomerId,
            ReceiptIdGui,
            ReceiptLineNbr,
            RefIdGuiDN,
            RefLineNbrDN,
            InvoiceNumber,
            InvoiceDate,
            InvoiceAmount,
            OutstandingAmount,
            AllocatedAmount,
            Note,
            CreatedBy,
            CreatedAt
        )
        SELECT
            @resolvedUnitCode,
            @customerCode,
            @idGui,
            receiptLineNbr,
            refIdGuiDN,
            refLineNbrDN,
            invoiceNumber,
            invoiceDate,
            ISNULL(invoiceAmount, 0),
            ISNULL(outstandingAmount, 0),
            ISNULL(allocatedAmount, 0),
            note,
            @userId,
            SYSDATETIME()
        FROM #alloc
        WHERE ISNULL(allocatedAmount, 0) > 0
          AND ISNULL(refIdGuiDN, N'') <> N'';

        INSERT INTO #affectedDn(refIdGuiDN)
        SELECT DISTINCT al.refIdGuiDN
        FROM #alloc al
        WHERE ISNULL(al.refIdGuiDN, N'') <> N''
          AND NOT EXISTS (SELECT 1 FROM #affectedDn a WHERE a.refIdGuiDN = al.refIdGuiDN);

        COMMIT;

        -- Đồng bộ ledger ngay sau khi lưu phân bổ
        IF @clearAllocationOnly = 0
           AND OBJECT_ID('dbo.sp_ApplyCustomerReceiptAllocationFromReceiptV2', 'P') IS NOT NULL
        BEGIN
            EXEC dbo.sp_ApplyCustomerReceiptAllocationFromReceiptV2
                @idGui = @idGui,
                @unitCode = @resolvedUnitCode,
                @userId = @userId;
        END;

        -- Đồng bộ lại trạng thái thanh toán trên deliveryNote
        IF EXISTS (SELECT 1 FROM #affectedDn)
           AND OBJECT_ID('dbo.deliveryNote$000000', 'U') IS NOT NULL
        BEGIN
            IF OBJECT_ID('tempdb..#dnSync') IS NOT NULL DROP TABLE #dnSync;
            CREATE TABLE #dnSync
            (
                refIdGuiDN NVARCHAR(50) NOT NULL PRIMARY KEY,
                sync CHAR(6) NOT NULL
            );

            INSERT INTO #dnSync(refIdGuiDN, sync)
            SELECT d.idGui, CONVERT(CHAR(6), d.voucherDate, 112)
            FROM dbo.deliveryNote$000000 d
            JOIN #affectedDn a ON a.refIdGuiDN = d.idGui;

            IF EXISTS (SELECT 1 FROM #dnSync)
            BEGIN
                DECLARE @setClause NVARCHAR(MAX) = N'';
                DECLARE @paidExpr NVARCHAR(600) = CASE
                    WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'CollectedAmount') IS NOT NULL
                         AND COL_LENGTH('dbo.CustomerDebtLedger', 'CreditAmount') IS NOT NULL
                        THEN N'CASE
                                    WHEN ISNULL(TRY_CONVERT(decimal(24,6), l.CollectedAmount), 0) <> 0
                                        THEN ISNULL(TRY_CONVERT(decimal(24,6), l.CollectedAmount), 0)
                                    ELSE ISNULL(TRY_CONVERT(decimal(24,6), l.CreditAmount), 0)
                                END'
                    WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'CollectedAmount') IS NOT NULL
                        THEN N'ISNULL(TRY_CONVERT(decimal(24,6), l.CollectedAmount), 0)'
                    WHEN COL_LENGTH('dbo.CustomerDebtLedger', 'CreditAmount') IS NOT NULL
                        THEN N'ISNULL(TRY_CONVERT(decimal(24,6), l.CreditAmount), 0)'
                    ELSE N'0'
                END;
                DECLARE @receiptTypeFilter NVARCHAR(400) = N'';
                IF COL_LENGTH('dbo.CustomerDebtLedger', 'ReceiptType') IS NOT NULL
                    SET @receiptTypeFilter = N'
                                      AND UPPER(ISNULL(l.ReceiptType, N'''')) IN (N''RECEIPT_CUSTOMER'', N''RECEIPT_DEPOSIT_OFFSET'')';
                DECLARE @hasAppointment BIT = CASE WHEN COL_LENGTH('dbo.deliveryNote$000000', 'appointmentDate') IS NOT NULL THEN 1 ELSE 0 END;

                IF COL_LENGTH('dbo.deliveryNote$000000', 'paidAmount') IS NOT NULL
                    SET @setClause = @setClause + N', paidAmount = ISNULL(agg.paidAmount, 0)';

                IF COL_LENGTH('dbo.deliveryNote$000000', 'debtAmount') IS NOT NULL
                    SET @setClause = @setClause + N', debtAmount = ISNULL(TRY_CONVERT(decimal(24,6), dn.totalPayment), 0) - ISNULL(agg.paidAmount, 0)';

                IF COL_LENGTH('dbo.deliveryNote$000000', 'paymentStatus') IS NOT NULL
                BEGIN
                    IF @hasAppointment = 1
                        SET @setClause = @setClause + N',
                            paymentStatus = CASE
                                WHEN ISNULL(TRY_CONVERT(decimal(24,6), dn.totalPayment), 0) <= 0 THEN N''UNPAID''
                                WHEN ISNULL(agg.paidAmount, 0) <= 0 THEN
                                    CASE
                                        WHEN dn.appointmentDate IS NOT NULL
                                             AND CONVERT(date, dn.appointmentDate) < CONVERT(date, GETDATE()) THEN N''OVERDUE''
                                        ELSE N''UNPAID''
                                    END
                                WHEN ISNULL(agg.paidAmount, 0) >= ISNULL(TRY_CONVERT(decimal(24,6), dn.totalPayment), 0) THEN N''PAID''
                                WHEN (ISNULL(TRY_CONVERT(decimal(24,6), dn.totalPayment), 0) - ISNULL(agg.paidAmount, 0)) > 0
                                     AND dn.appointmentDate IS NOT NULL
                                     AND CONVERT(date, dn.appointmentDate) < CONVERT(date, GETDATE()) THEN N''OVERDUE''
                                ELSE N''PARTIAL''
                            END';
                    ELSE
                        SET @setClause = @setClause + N',
                            paymentStatus = CASE
                                WHEN ISNULL(TRY_CONVERT(decimal(24,6), dn.totalPayment), 0) <= 0 THEN N''UNPAID''
                                WHEN ISNULL(agg.paidAmount, 0) <= 0 THEN N''UNPAID''
                                WHEN ISNULL(agg.paidAmount, 0) >= ISNULL(TRY_CONVERT(decimal(24,6), dn.totalPayment), 0) THEN N''PAID''
                                ELSE N''PARTIAL''
                            END';
                END;

                IF LEN(@setClause) > 0
                BEGIN
                    DECLARE @syncDn CHAR(6);
                    DECLARE @sqlDn NVARCHAR(MAX);

                    DECLARE cur_sync CURSOR LOCAL FAST_FORWARD FOR
                        SELECT DISTINCT sync FROM #dnSync;

                    OPEN cur_sync;
                    FETCH NEXT FROM cur_sync INTO @syncDn;
                    WHILE @@FETCH_STATUS = 0
                    BEGIN
                        IF OBJECT_ID(N'dbo.deliveryNote$' + @syncDn, 'U') IS NOT NULL
                        BEGIN
                            SET @sqlDn = N'
                                UPDATE dn
                                   SET ' + STUFF(@setClause, 1, 2, N'') + N'
                                FROM dbo.deliveryNote$' + @syncDn + N' dn
                                JOIN #dnSync k ON k.refIdGuiDN = dn.idGui AND k.sync = @p_sync
                                OUTER APPLY
                                (
                                    SELECT SUM(' + @paidExpr + N') AS paidAmount
                                    FROM dbo.CustomerDebtLedger l
                                    WHERE ISNULL(l.RefController, N'''') = N''receiptV2''
                                      ' + @receiptTypeFilter + N'
                                      AND ISNULL(l.RefIdGui, N'''') = dn.idGui
                                      AND ISNULL(l.CustomerId, N'''') = @p_customerCode
                                      AND ISNULL(l.UnitCode, N'''') = @p_unitCode
                                ) agg;';

                            EXEC sp_executesql
                                @sqlDn,
                                N'@p_sync char(6), @p_customerCode nvarchar(50), @p_unitCode nvarchar(50)',
                                @p_sync = @syncDn,
                                @p_customerCode = @customerCode,
                                @p_unitCode = @resolvedUnitCode;
                        END;

                        FETCH NEXT FROM cur_sync INTO @syncDn;
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
