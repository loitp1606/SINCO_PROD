CREATE OR ALTER PROCEDURE dbo.sp_ReverseDebtFromGoodsReceipt
    @idGui NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NULL
        RETURN;

    DELETE dbo.SupplierDebtLedger
    WHERE RefController = N'goodsReceipt'
      AND ReceiptIdGui = @idGui;
END
GO

