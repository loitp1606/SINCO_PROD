CREATE OR ALTER PROCEDURE [dbo].[sp_GetSupplierOpenInvoicesForAllocation]
    @supplierCode NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @keyword NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.sp_GetSupplierPaymentAllocation
        @mode = N'OPEN',
        @idGui = NULL,
        @supplierCode = @supplierCode,
        @unitCode = @unitCode,
        @keyword = @keyword;
END
GO
