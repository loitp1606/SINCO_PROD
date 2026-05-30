CREATE OR ALTER PROCEDURE dbo.sp_PostDebtFromGoodsReceipt
    @idGui NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @userId NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        DECLARE
            @sync VARCHAR(6),
            @q NVARCHAR(MAX),
            @supplierCode NVARCHAR(50),
            @voucherNumber NVARCHAR(100),
            @voucherDate DATE,
            @resolvedUnitCode NVARCHAR(50),
            @amountExpr NVARCHAR(200),
            @refLineExpr NVARCHAR(200);

        SELECT @sync = CONVERT(VARCHAR(6), voucherDate, 112)
        FROM dbo.goodsReceipt$000000
        WHERE idGui = @idGui;

        IF @sync IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF OBJECT_ID('tempdb..#gr') IS NOT NULL DROP TABLE #gr;
        CREATE TABLE #gr
        (
            supplierCode NVARCHAR(50) NULL,
            voucherNumber NVARCHAR(100) NULL,
            voucherDate DATE NULL,
            unitCode NVARCHAR(50) NULL
        );

        SET @q = N'
            INSERT INTO #gr(supplierCode, voucherNumber, voucherDate, unitCode)
            SELECT TOP 1 supplierCode, voucherNumber, TRY_CONVERT(date, voucherDate), unitCode
            FROM dbo.goodsReceipt$' + @sync + N'
            WHERE idGui = @p_idGui;
        ';
        EXEC sp_executesql
            @q,
            N'@p_idGui NVARCHAR(50)',
            @p_idGui = @idGui;

        SELECT TOP 1
            @supplierCode = supplierCode,
            @voucherNumber = voucherNumber,
            @voucherDate = voucherDate,
            @resolvedUnitCode = unitCode
        FROM #gr;

        IF @supplierCode IS NULL
        BEGIN
            COMMIT;
            RETURN;
        END;

        IF @unitCode IS NOT NULL AND LTRIM(RTRIM(@unitCode)) <> ''
            SET @resolvedUnitCode = @unitCode;
        IF @resolvedUnitCode IS NULL OR LTRIM(RTRIM(@resolvedUnitCode)) = ''
            SET @resolvedUnitCode = 'CTY';

        DELETE dbo.SupplierDebtLedger
        WHERE RefController = N'goodsReceipt'
          AND ReceiptIdGui = @idGui;

        IF OBJECT_ID('tempdb..#detail') IS NOT NULL DROP TABLE #detail;
        SELECT TOP 0 d.* INTO #detail FROM dbo.goodsReceiptDetail$000000 d WHERE 1 = 0;

        SET @q = N'
            INSERT INTO #detail
            SELECT d.*
            FROM dbo.goodsReceiptDetail$' + @sync + N' d
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

        SET @refLineExpr = CASE
            WHEN COL_LENGTH('tempdb..#detail', 'line_nbr') IS NOT NULL
                THEN N'TRY_CONVERT(int, d.line_nbr)'
            ELSE N'NULL'
        END;

        SET @q = N'
            INSERT dbo.SupplierDebtLedger
            (
                UnitCode,
                SupplierId,
                ReceiptIdGui,
                VoucherNumber,
                VoucherDate,
                ReceiptType,
                DebitAmount,
                CreditAmount,
                AdvanceAmount,
                PaidAmount,
                PayableAmount,
                RefController,
                RefIdGui,
                RefLineNbr,
                Note,
                CreatedBy,
                CreatedAt
            )
            SELECT
                @p_unitCode,
                @p_supplierCode,
                @p_idGui,
                @p_voucherNumber,
                @p_voucherDate,
                N''GOODS_RECEIPT'',
                0,
                0,
                0,
                0,
                ' + @amountExpr + N',
                N''goodsReceipt'',
                CONVERT(nvarchar(50), d.idGui),
                ' + @refLineExpr + N',
                N''Tăng phải trả NCC từ phiếu nhập hàng'',
                @p_userId,
                SYSDATETIME()
            FROM #detail d
            WHERE ' + @amountExpr + N' > 0;
        ';

        EXEC sp_executesql
            @q,
            N'@p_unitCode NVARCHAR(50), @p_supplierCode NVARCHAR(50), @p_idGui NVARCHAR(50), @p_voucherNumber NVARCHAR(100), @p_voucherDate DATE, @p_userId NVARCHAR(50)',
            @p_unitCode = @resolvedUnitCode,
            @p_supplierCode = @supplierCode,
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
