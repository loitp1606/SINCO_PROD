CREATE OR ALTER PROCEDURE [dbo].[afterUpdateOrderReturn]
    @idGui NVARCHAR(50),
    @voucherNumber NVARCHAR(50),
    @voucherDate NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    -- Hook sau khi lưu phiếu xuất trả hàng.
END
GO
