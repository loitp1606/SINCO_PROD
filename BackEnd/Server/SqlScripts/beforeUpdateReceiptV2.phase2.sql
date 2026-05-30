ALTER PROCEDURE [dbo].[beforeUpdateReceiptV2]
  @idGui NVARCHAR(50),
  @vcNum NVARCHAR(50),
  @VCDate NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @q NVARCHAR(4000), @sync VARCHAR(6), @partition VARCHAR(6);
    SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112) FROM receiptV2$000000 WHERE idgui = @idGui;

    SELECT TOP 0 a.*, @sync AS sync INTO #detail FROM receiptdetailV2$000000 a WHERE idGui = @idGui;
    SELECT @q = '
    insert into #detail select *, '''' from receiptdetailV2$' + @sync + ' a where idGui = ''' + @idGui + '''
    ';
    EXEC (@q);

    UPDATE #detail SET sync = @sync;
    UPDATE #detail SET sync = CONVERT(VARCHAR(6), a.voucherDate, 112) FROM deliveryNote$000000 a JOIN #detail b ON a.idGui = b.idGuiDN;

    SELECT TOP 0 idGui, voucherDate, CAST('' AS VARCHAR(6)) AS p INTO #partitionDeliveryNote FROM deliveryNote$000000;
    INSERT INTO #partitionDeliveryNote
    SELECT idGui, voucherDate, CONVERT(VARCHAR(6), voucherDate, 112) AS p
    FROM deliveryNote$000000 a
    WHERE EXISTS (SELECT 1 FROM #detail z WHERE a.idGui = z.idGuiDN);

    SELECT @partition = MIN(p) FROM #partitionDeliveryNote;
    WHILE @partition IS NOT NULL
    BEGIN
        SELECT @q = '
            update deliveryNoteDetail$' + @partition + '
                set sl_receipt = sl_receipt - b.amount from deliveryNoteDetail$' + @partition + ' a join #detail b on a.idGui = b.idGuiDN and a.line_nbr = b.lnDN
        ';
        EXEC (@q);
        SELECT @partition = MIN(p) FROM #partitionDeliveryNote WHERE p > @partition;
    END;

    DECLARE @idSL VARCHAR(50);
    DECLARE @setPhase2 NVARCHAR(MAX) = N'';
    DECLARE @sqlPhase2 NVARCHAR(MAX);
    DECLARE @targetTable SYSNAME;
    SELECT DISTINCT idGuiDN, sync INTO #keys FROM #detail;

    IF COL_LENGTH('deliveryNote$000000', 'receiptCount') IS NOT NULL
        SET @setPhase2 = @setPhase2 + N', receiptCount = ISNULL(agg.receiptCount, 0)';
    IF COL_LENGTH('deliveryNote$000000', 'paidAmount') IS NOT NULL
        SET @setPhase2 = @setPhase2 + N', paidAmount = ISNULL(agg.paidAmount, 0)';
    IF COL_LENGTH('deliveryNote$000000', 'debtAmount') IS NOT NULL
        SET @setPhase2 = @setPhase2 + N', debtAmount = ISNULL(dn.totalPayment, 0) - ISNULL(agg.paidAmount, 0)';
    IF COL_LENGTH('deliveryNote$000000', 'paymentStatus') IS NOT NULL
        SET @setPhase2 = @setPhase2 + N',
            paymentStatus = CASE
                WHEN ISNULL(dn.totalPayment, 0) <= 0 THEN ''UNPAID''
                WHEN ISNULL(agg.paidAmount, 0) <= 0 THEN
                    CASE WHEN dn.appointmentDate IS NOT NULL AND CONVERT(date, dn.appointmentDate) < CONVERT(date, GETDATE()) THEN ''OVERDUE'' ELSE ''UNPAID'' END
                WHEN ISNULL(agg.paidAmount, 0) >= ISNULL(dn.totalPayment, 0) THEN ''PAID''
                WHEN (ISNULL(dn.totalPayment, 0) - ISNULL(agg.paidAmount, 0)) > 0
                     AND dn.appointmentDate IS NOT NULL
                     AND CONVERT(date, dn.appointmentDate) < CONVERT(date, GETDATE()) THEN ''OVERDUE''
                ELSE ''PARTIAL''
            END';
    WHILE EXISTS (SELECT 1 FROM #keys)
    BEGIN
        SELECT TOP 1 @idSL = idGuiDN, @sync = sync FROM #keys;
        SELECT @q = N'
        update deliveryNote$' + @sync + N' set status = ''0'', status_name = N''Đang chờ giao'', deliveryStatus = ''NOT_DELIVERED'',trang_thai_duyet2 = ''0'', ten_trang_thai2 = N''Chưa chuyển phiếu thu'' where idGui = ''' + @idSL + '''
        if exists (select 1 from deliveryNoteDetail$' + @sync + ' where sl_receipt <> 0 and idGui = ''' + @idSL + ''')
            update deliveryNote$' + @sync + N' set trang_thai_duyet2 = ''1'', ten_trang_thai2 = N''Đang chuyển phiếu thu'', deliveryStatus = ''PARTIAL'' where idGui = ''' + @idSL + '''
        ';
        SELECT @q = @q + N'
        if not exists (select 1 from deliveryNoteDetail$' + @sync + ' where amount > sl_receipt and idGui = ''' + @idSL + ''')
            update deliveryNote$' + @sync + N' set trang_thai_duyet2 = ''2'', ten_trang_thai2 = N''Hoàn thành chuyển phiếu thu'', deliveryStatus = ''DELIVERED''  where idGui = ''' + @idSL + '''
        ';
        EXEC (@q);

        EXEC UpdateDeliveyNoteFromReceipt @idSL, 'REV';

        IF LEN(@setPhase2) > 0
        BEGIN
            
            SET @targetTable = N'deliveryNote$' + @sync;
            IF OBJECT_ID(@targetTable, 'U') IS NOT NULL
            BEGIN
                SET @sqlPhase2 = N'
                update dn
                   set ' + STUFF(@setPhase2, 1, 2, N'') + N'
                from ' + QUOTENAME(@targetTable) + N' dn
                outer apply (
                    select
                        count(distinct d.idGui) as receiptCount,
                        sum(isnull(d.amount, 0)) as paidAmount
                    from #detail d
                    where d.idGuiDN = @p_idSL
                      and d.idGui <> @p_currentIdGui
                ) agg
                where dn.idGui = @p_idSL;';
                EXEC sp_executesql
                    @sqlPhase2,
                    N'@p_idSL varchar(50), @p_currentIdGui nvarchar(50)',
                    @p_idSL = @idSL,
                    @p_currentIdGui = @idGui;
            END;
        END;

        DELETE #keys WHERE idGuiDN = @idSL;
    END;
    EXEC (@q);
END;

