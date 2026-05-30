/*
    Bảng phân bổ tiền chi theo hóa đơn NCC (AP)
    - Dùng cho paymentSlip loại SUPPLIER
*/
IF OBJECT_ID('dbo.SupplierPaymentAllocation', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SupplierPaymentAllocation
    (
        Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UnitCode NVARCHAR(50) NOT NULL,
        SupplierId NVARCHAR(50) NOT NULL,

        PaymentIdGui NVARCHAR(50) NOT NULL,
        PaymentLineNbr INT NULL,

        RefIdGuiPN NVARCHAR(50) NOT NULL,
        RefLineNbrPN INT NULL,

        InvoiceNumber NVARCHAR(100) NULL,
        InvoiceDate DATE NULL,
        InvoiceAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierPaymentAllocation_InvoiceAmount DEFAULT(0),
        OutstandingAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierPaymentAllocation_OutstandingAmount DEFAULT(0),
        AllocatedAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierPaymentAllocation_AllocatedAmount DEFAULT(0),

        Note NVARCHAR(500) NULL,
        CreatedBy NVARCHAR(50) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_SupplierPaymentAllocation_CreatedAt DEFAULT(SYSDATETIME()),
        ModifiedBy NVARCHAR(50) NULL,
        ModifiedAt DATETIME2(0) NULL
    );

    CREATE INDEX IX_SupplierPaymentAllocation_Payment
        ON dbo.SupplierPaymentAllocation(PaymentIdGui);

    CREATE INDEX IX_SupplierPaymentAllocation_UnitSupplierRef
        ON dbo.SupplierPaymentAllocation(UnitCode, SupplierId, RefIdGuiPN);
END
GO

