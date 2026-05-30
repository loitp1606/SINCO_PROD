/*
    Bảng ledger công nợ nhà cung cấp (AP)
    - Tách riêng khỏi CustomerDebtLedger để tránh lẫn AR/AP
*/
IF OBJECT_ID('dbo.SupplierDebtLedger', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SupplierDebtLedger
    (
        Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UnitCode NVARCHAR(50) NOT NULL,
        SupplierId NVARCHAR(50) NOT NULL,
        ReceiptIdGui NVARCHAR(50) NULL,
        VoucherNumber NVARCHAR(100) NULL,
        VoucherDate DATE NULL,
        ReceiptType NVARCHAR(30) NULL,

        DebitAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierDebtLedger_DebitAmount DEFAULT(0),
        CreditAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierDebtLedger_CreditAmount DEFAULT(0),
        AdvanceAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierDebtLedger_AdvanceAmount DEFAULT(0),
        PaidAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierDebtLedger_PaidAmount DEFAULT(0),
        PayableAmount DECIMAL(24,6) NOT NULL CONSTRAINT DF_SupplierDebtLedger_PayableAmount DEFAULT(0),

        RefController NVARCHAR(50) NULL,
        RefIdGui NVARCHAR(50) NULL,
        RefLineNbr INT NULL,
        Note NVARCHAR(500) NULL,
        CreatedBy NVARCHAR(50) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_SupplierDebtLedger_CreatedAt DEFAULT(SYSDATETIME())
    );

    CREATE INDEX IX_SupplierDebtLedger_Unit_Supplier_Date
        ON dbo.SupplierDebtLedger(UnitCode, SupplierId, VoucherDate);

    CREATE INDEX IX_SupplierDebtLedger_Ref
        ON dbo.SupplierDebtLedger(RefController, ReceiptIdGui);
END
GO

