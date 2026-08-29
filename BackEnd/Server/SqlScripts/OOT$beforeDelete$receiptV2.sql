CREATE OR ALTER PROCEDURE [dbo].[OOT$beforeDelete$receiptV2]
    @idGui VARCHAR(50),
    @action NVARCHAR(20),
    @type NVARCHAR(50),
    @userId NVARCHAR(50),
    @unit NVARCHAR(50),
    @language NVARCHAR(10),
    @Result INT OUTPUT,
    @Message NVARCHAR(4000) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        IF NULLIF(LTRIM(RTRIM(ISNULL(@idGui, ''))), '') IS NULL
        BEGIN
            SELECT @Result = 0, @Message = N'Không xác định được phiếu thu cần xóa.';
            RETURN;
        END;

        IF OBJECT_ID('dbo.beforeUpdateReceiptV2', 'P') IS NOT NULL
            EXEC dbo.beforeUpdateReceiptV2 @idGui, '', '';

        IF OBJECT_ID('tempdb..#affectedDn') IS NOT NULL DROP TABLE #affectedDn;
        CREATE TABLE #affectedDn
        (
            refIdGuiDN NVARCHAR(50) NOT NULL PRIMARY KEY
        );

        IF OBJECT_ID('dbo.CustomerReceiptAllocation', 'U') IS NOT NULL
        BEGIN
            INSERT INTO #affectedDn(refIdGuiDN)
            SELECT DISTINCT RefIdGuiDN
            FROM dbo.CustomerReceiptAllocation
            WHERE ReceiptIdGui = @idGui
              AND ISNULL(RefIdGuiDN, N'') <> N'';
        END;

        IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NOT NULL
        BEGIN
            INSERT INTO #affectedDn(refIdGuiDN)
            SELECT DISTINCT RefIdGui
            FROM dbo.CustomerDebtLedger l
            WHERE ISNULL(l.RefController, N'') = N'receiptV2'
              AND l.ReceiptIdGui = @idGui
              AND ISNULL(l.RefIdGui, N'') <> N''
              AND NOT EXISTS
              (
                  SELECT 1
                  FROM #affectedDn a
                  WHERE a.refIdGuiDN = l.RefIdGui
              );

            DELETE dbo.CustomerDebtLedger
            WHERE ISNULL(RefController, N'') = N'receiptV2'
              AND ReceiptIdGui = @idGui;
        END;

        IF OBJECT_ID('dbo.CustomerReceiptAllocation', 'U') IS NOT NULL
        BEGIN
            DELETE dbo.CustomerReceiptAllocation
            WHERE ReceiptIdGui = @idGui;
        END;

        IF EXISTS (SELECT 1 FROM #affectedDn)
           AND OBJECT_ID('dbo.deliveryNote$000000', 'U') IS NOT NULL
           AND OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NOT NULL
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
            JOIN #affectedDn a ON a.refIdGuiDN = d.idGui
            WHERE d.voucherDate IS NOT NULL;

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
                DECLARE @hasAppointment BIT = CASE WHEN COL_LENGTH('dbo.deliveryNote$000000', 'appointmentDate') IS NOT NULL THEN 1 ELSE 0 END;

                IF COL_LENGTH('dbo.CustomerDebtLedger', 'ReceiptType') IS NOT NULL
                    SET @receiptTypeFilter = N'
                                      AND UPPER(ISNULL(l.ReceiptType, N'''')) IN (N''RECEIPT_CUSTOMER'', N''RECEIPT_DEPOSIT_OFFSET'')';

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
                                ) agg;';

                            EXEC sp_executesql
                                @sqlDn,
                                N'@p_sync char(6)',
                                @p_sync = @syncDn;
                        END;

                        FETCH NEXT FROM cur_sync INTO @syncDn;
                    END;

                    CLOSE cur_sync;
                    DEALLOCATE cur_sync;
                END;
            END;
        END;

        SELECT @Result = 1, @Message = N'Dữ liệu hợp lệ.';
    END TRY
    BEGIN CATCH
        IF CURSOR_STATUS('local', 'cur_sync') >= -1
        BEGIN
            CLOSE cur_sync;
            DEALLOCATE cur_sync;
        END;

        SELECT @Result = 0, @Message = ERROR_MESSAGE();
    END CATCH;
END
