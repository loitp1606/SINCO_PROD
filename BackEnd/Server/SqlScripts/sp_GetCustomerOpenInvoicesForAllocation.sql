CREATE OR ALTER PROCEDURE dbo.sp_GetCustomerOpenInvoicesForAllocation
    @customerCode NVARCHAR(50),
    @unitCode NVARCHAR(50) = NULL,
    @keyword NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    EXEC dbo.sp_GetCustomerReceiptAllocation
        @mode = N'OPEN',
        @customerCode = @customerCode,
        @unitCode = @unitCode,
        @keyword = @keyword;
END
GO
