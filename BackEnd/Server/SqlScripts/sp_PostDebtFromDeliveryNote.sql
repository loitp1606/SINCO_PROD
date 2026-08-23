CREATE OR ALTER PROCEDURE dbo.sp_PostDebtFromDeliveryNote
    @idGui NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @customer_id NVARCHAR(50),
            @voucherNumber NVARCHAR(100),
            @voucherDate DATE,
            @resolvedUnitCode NVARCHAR(50),
            @userIdInt INT,
            @amountExpr NVARCHAR(200),
            @refIdExpr NVARCHAR(400),
            @refLineExpr NVARCHAR(200);

        IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.deliveryNote$000000
        WHERE idGui = @idGui;

        IF @sync IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#dn') IS NOT NULL DROP TABLE #dn;
        CREATE TABLE #dn
        (
            customer_id NVARCHAR(50) NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            unitCode NVARCHAR(50) NULL
        );

        SET @q = N'
            INSERT INTO #dn(customer_id, voucherNumber, voucherDate, unitCode)
            SELECT TOP 1 customer_id, voucherNumber, TRY_CONVERT(date, voucherDate), unitCode
            FROM dbo.deliveryNote$' + @sync + N'
            WHERE idGui = @p_idGui;
        ';

        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50)',
            @p_idGui = @idGui;

        SELECT TOP 1
            @customer_id = customer_id,
            @voucherNumber = voucherNumber,
            @voucherDate = voucherDate,
            @resolvedUnitCode = unitCode
        FROM #dn;

        IF @customer_id IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> ''
            SET @resolvedUnitCode = @unitCode;

        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = ''
            SET @resolvedUnitCode = 'CTY';

        SET @userIdInt = TRY_CAST(@userId AS INT);

        -- Re-post an toàn: xóa bút toán cũ của chính delivery note này trước khi ghi lại
        DELETE dbo.CustomerDebtLedger
        WHERE RefController = N'deliveryNote'
          AND ReceiptIdGui = @idGui;

        IF OBJECT_ID('tempdb..#detail') IS NOT NULL DROP TABLE #detail;

        SELECT TOP 0 d.*
        INTO #detail
        FROM dbo.deliveryNoteDetail$000000 d
        WHERE 1 = 0;

        SET @q = N'
            INSERT INTO #detail
            SELECT d.*
            FROM dbo.deliveryNoteDetail$' + @sync + N' d
            WHERE d.idGui = @p_idGui;
        ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50)',
            @p_idGui = @idGui;

        IF NOT EXISTS (SELECT 1 FROM #detail)
        BEGIN
            COMMIT;
            RETURN;
        END;

        SET @amountExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'payment') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.payment), 0)'
            WHEN COL_LENGTH('tempdb..#detail', 'amount') IS NOT NULL THEN N'ISNULL(TRY_CONVERT(decimal(24,6), d.amount), 0)'
            ELSE N'0'
        END;

        -- Công nợ được quản lý theo phiếu xuất, không theo mã hóa đơn VAT.
        -- Giữ RefIdGui ổn định là idGui phiếu xuất để mọi phiếu thu phân bổ
        -- về đúng một chứng từ nguồn.
        SET @refIdExpr = N'CONVERT(nvarchar(50), d.idGui)';

        SET @refLineExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'lnHD') IS NOT NULL
                THEN N'TRY_CONVERT(int, COALESCE(d.lnHD, d.line_nbr))'
            ELSE N'TRY_CONVERT(int, d.line_nbr)'
        END;

        SET @q = N'
            INSERT dbo.CustomerDebtLedger
            (
                UnitCode,
                CustomerId,
                ReceiptIdGui,
                VoucherNumber,
                VoucherDate,
                ReceiptType,
                DebitAmount,
                CreditAmount,
                DepositAmount,
                CollectedAmount,
                ReceivableAmount,
                RefController,
                RefIdGui,
                RefLineNbr,
                Note,
                CreatedBy,
                CreatedAt
            )
            SELECT
                @p_unitCode,
                @p_customerId,
                @p_idGui,
                @p_voucherNumber,
                @p_voucherDate,
                N''DELIVERY_NOTE'',
                0,
                0,
                0,
                0,
                ' + @amountExpr + N',
                N''deliveryNote'',
                ' + @refIdExpr + N',
                ' + @refLineExpr + N',
                N''Tăng phải thu từ phiếu xuất hàng'',
                @p_userId,
                SYSDATETIME()
            FROM #detail d
            WHERE ' + @amountExpr + N' > 0;
        ';

        EXEC sp_executesql
            @q,
            N'@p_unitCode NVARCHAR(50), @p_customerId NVARCHAR(50), @p_idGui NVARCHAR(50), @p_voucherNumber NVARCHAR(100), @p_voucherDate DATE, @p_userId NVARCHAR(50)',
            @p_unitCode = @resolvedUnitCode,
            @p_customerId = @customer_id,
            @p_idGui = @idGui,
            @p_voucherNumber = @voucherNumber,
            @p_voucherDate = @voucherDate,
            @p_userId = @userId;

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@err, 16, 1);
    END CATCH
END
GO
