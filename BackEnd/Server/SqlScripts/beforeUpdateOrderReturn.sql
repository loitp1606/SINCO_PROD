CREATE OR ALTER PROCEDURE [dbo].[beforeUpdateOrderReturn]
    @idGui NVARCHAR(50),
    @voucherNumber NVARCHAR(50),
    @voucherDate NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    -- Hook trước khi lưu phiếu xuất trả hàng.
END
GO
