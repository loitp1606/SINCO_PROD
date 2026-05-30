CREATE OR ALTER PROCEDURE dbo.beforeUpdateGoodsReceipt
    @idGui NVARCHAR(50),
    @vcNum NVARCHAR(50),
    @VCDate NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- Reverse AP ledger hiện tại của phiếu nhập trước khi update
    EXEC dbo.sp_ReverseDebtFromGoodsReceipt @idGui;
END
GO

