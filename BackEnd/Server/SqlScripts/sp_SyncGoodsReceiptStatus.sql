CREATE OR ALTER PROCEDURE dbo.sp_SyncGoodsReceiptStatus
    @idGui NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        DECLARE @sync VARCHAR(6);
        DECLARE @q NVARCHAR(MAX);

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.goodsReceipt$000000
        WHERE idGui = @idGui;

        IF @sync IS NULL
            RETURN;

        IF OBJECT_ID('tempdb..#agg') IS NOT NULL DROP TABLE #agg;
        CREATE TABLE #agg
        (
            totalRows INT NOT NULL,
            receivedRows INT NOT NULL
        );

        SET @q = N'
            INSERT INTO #agg(totalRows, receivedRows)
            SELECT
                COUNT(1) AS totalRows,
                SUM(CASE WHEN ISNULL(TRY_CONVERT(INT, isReceived), 0) = 1 THEN 1 ELSE 0 END) AS receivedRows
            FROM dbo.goodsReceiptDetail$' + @sync + N'
            WHERE idGui = @p_idGui;
        ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50)',
            @p_idGui = @idGui;

        DECLARE @totalRows INT = 0, @receivedRows INT = 0;
        SELECT TOP 1 @totalRows = totalRows, @receivedRows = receivedRows FROM #agg;

        DECLARE @receiptValue NVARCHAR(10) = CASE WHEN @receivedRows >= @totalRows AND @totalRows > 0 THEN N'1' ELSE N'0' END;
        DECLARE @receiveStatus NVARCHAR(30) = CASE
            WHEN @totalRows = 0 OR @receivedRows = 0 THEN N'NOT_RECEIVED'
            WHEN @receivedRows < @totalRows THEN N'PARTIAL'
            ELSE N'RECEIVED'
        END;

        DECLARE @setClause NVARCHAR(MAX) = N'';

        IF COL_LENGTH('goodsReceipt$000000', 'receipt') IS NOT NULL
            SET @setClause += N', receipt = @p_receipt';
        IF COL_LENGTH('goodsReceipt$000000', 'receiveStatus') IS NOT NULL
            SET @setClause += N', receiveStatus = @p_receiveStatus';
        IF COL_LENGTH('goodsReceipt$000000', 'debtAmount') IS NOT NULL
            SET @setClause += N', debtAmount = ISNULL(totalPayment, 0) - ISNULL(paidAmount, 0)';
        IF COL_LENGTH('goodsReceipt$000000', 'paymentStatus') IS NOT NULL
            SET @setClause += N', paymentStatus = CASE
                    WHEN ISNULL(totalPayment, 0) <= 0 THEN ''UNPAID''
                    WHEN ISNULL(paidAmount, 0) <= 0 THEN ''UNPAID''
                    WHEN ISNULL(paidAmount, 0) >= ISNULL(totalPayment, 0) THEN ''PAID''
                    ELSE ''PARTIAL''
                END';

        IF LEN(@setClause) = 0
            RETURN;

        SET @q = N'
            UPDATE dbo.goodsReceipt$000000
            SET ' + STUFF(@setClause, 1, 2, N'') + N'
            WHERE idGui = @p_idGui;
        ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50), @p_receipt NVARCHAR(10), @p_receiveStatus NVARCHAR(30)',
            @p_idGui = @idGui,
            @p_receipt = @receiptValue,
            @p_receiveStatus = @receiveStatus;

        SET @q = N'
            IF OBJECT_ID(N''dbo.goodsReceipt$' + @sync + N''', N''U'') IS NOT NULL
            BEGIN
                UPDATE dbo.goodsReceipt$' + @sync + N'
                SET ' + STUFF(@setClause, 1, 2, N'') + N'
                WHERE idGui = @p_idGui;
            END
        ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50), @p_receipt NVARCHAR(10), @p_receiveStatus NVARCHAR(30)',
            @p_idGui = @idGui,
            @p_receipt = @receiptValue,
            @p_receiveStatus = @receiveStatus;
    END TRY
    BEGIN CATCH
        DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@err, 16, 1);
    END CATCH
END
GO

