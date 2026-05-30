CREATE OR ALTER PROCEDURE dbo.afterUpdateGoodsReceipt
    @idGui NVARCHAR(50),
    @vcNum NVARCHAR(50),
    @VCDate NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- Đồng bộ trạng thái nhận hàng / thanh toán trên master
    EXEC dbo.sp_SyncGoodsReceiptStatus @idGui;

    -- Post lại AP ledger theo dữ liệu mới sau update
    EXEC dbo.sp_PostDebtFromGoodsReceipt @idGui, NULL, NULL;
END
GO

