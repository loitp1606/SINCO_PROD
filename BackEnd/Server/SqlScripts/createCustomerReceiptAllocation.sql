/*
    Bảng phân bổ tiền thu theo hóa đơn (AR)
    - Dùng cho receiptV2 loại CUSTOMER
    - Phân bổ trực tiếp theo phiếu xuất, không dùng detail hóa đơn cũ
*/
drop table CustomerReceiptAllocation

IF OBJECT_ID('dbo.CustomerReceiptAllocation', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CustomerReceiptAllocation
    (
        Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UnitCode NVARCHAR(50) NOT NULL,
        CustomerId NVARCHAR(50) NOT NULL,

        ReceiptIdGui NVARCHAR(50) NOT NULL,
        ReceiptLineNbr INT NULL,

        RefIdGuiDN NVARCHAR(50) NOT NULL,
        RefLineNbrDN INT NULL,

        InvoiceNumber NVARCHAR(100) NULL,
        InvoiceDate DATE NULL,
        InvoiceAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_CustomerReceiptAllocation_InvoiceAmount DEFAULT(0),
        OutstandingAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_CustomerReceiptAllocation_OutstandingAmount DEFAULT(0),
        AllocatedAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_CustomerReceiptAllocation_AllocatedAmount DEFAULT(0),

        Note NVARCHAR(500) NULL,
        CreatedBy NVARCHAR(50) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CustomerReceiptAllocation_CreatedAt DEFAULT(SYSDATETIME()),
        ModifiedBy NVARCHAR(50) NULL,
        ModifiedAt DATETIME2(0) NULL
    );

    CREATE INDEX IX_CustomerReceiptAllocation_Receipt
        ON dbo.CustomerReceiptAllocation(ReceiptIdGui);

    CREATE INDEX IX_CustomerReceiptAllocation_UnitCustomerRef
        ON dbo.CustomerReceiptAllocation(UnitCode, CustomerId, RefIdGuiDN);
END
GO
