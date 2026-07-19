CREATE OR ALTER PROCEDURE [dbo].[syncCustomer]
    @customer_id NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @customer_id = NULLIF(LTRIM(RTRIM(@customer_id)), N'');
    IF @customer_id IS NULL RETURN;

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.supplier
        (
            supplier_id,
            supplier_name,
            phone_number,
            email,
            address,
            province,
            district,
            status,
            customer_id
        )
        SELECT
            c.customer_id,
            c.customer_name,
            c.phone_number,
            c.email,
            c.address,
            c.city,
            c.district,
            ISNULL(c.status, '1'),
            c.customer_id
        FROM dbo.customer AS c
        WHERE c.customer_id = @customer_id
          AND NOT EXISTS
          (
              SELECT 1
              FROM dbo.supplier AS s WITH (UPDLOCK, HOLDLOCK)
              WHERE s.supplier_id = c.customer_id
          );

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END
GO
