CREATE OR ALTER PROCEDURE [dbo].[OOT$beforeDelete$paymentSlip]
    @idGui VARCHAR(50),
    @action NVARCHAR(20),
    @type NVARCHAR(50),
    @userId NVARCHAR(50),
    @unit NVARCHAR(50),
    @language NVARCHAR(10),
    @Result INT OUTPUT,
    @Message NVARCHAR(4000) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        IF NULLIF(LTRIM(RTRIM(ISNULL(@idGui, ''))), '') IS NULL
        BEGIN
            SELECT @Result = 0, @Message = N'Không xác định được phiếu chi cần xóa.';
            RETURN;
        END;

        IF OBJECT_ID('dbo.beforeUpdatePaymentSlip', 'P') IS NOT NULL
            EXEC dbo.beforeUpdatePaymentSlip @idGui, '', '';

        IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NOT NULL
        BEGIN
            DELETE dbo.SupplierDebtLedger
            WHERE ISNULL(RefController, N'') = N'paymentSlip'
              AND ReceiptIdGui = @idGui;
        END;

        IF OBJECT_ID('dbo.SupplierPaymentAllocation', 'U') IS NOT NULL
        BEGIN
            DELETE dbo.SupplierPaymentAllocation
            WHERE PaymentIdGui = @idGui;
        END;

        SELECT @Result = 1, @Message = N'Dữ liệu hợp lệ.';
    END TRY
    BEGIN CATCH
        SELECT @Result = 0, @Message = ERROR_MESSAGE();
    END CATCH;
END
