/*
    Bảng tổng hợp công nợ khách hàng
    - Lưu số tiền cọc, đã thu, phải thu, còn nợ theo khách hàng
    - Dùng cho nghiệp vụ đối soát công nợ và dashboard
*/

IF OBJECT_ID('dbo.customerDebtBalance', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.customerDebtBalance
    (
        id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_customerDebtBalance_id DEFAULT NEWID(),

        unitCode NVARCHAR(50) NOT NULL,
        customer_id NVARCHAR(50) NOT NULL,

        -- Tổng tiền đặt cọc đã nhận
        depositAmount DECIMAL(18, 2) NOT NULL
            CONSTRAINT DF_customerDebtBalance_depositAmount DEFAULT (0),

        -- Tổng tiền đã thu từ khách (không bao gồm cọc, trừ khi team nghiệp vụ muốn gộp)
        collectedAmount DECIMAL(18, 2) NOT NULL
            CONSTRAINT DF_customerDebtBalance_collectedAmount DEFAULT (0),

        -- Tổng phải thu theo chứng từ bán hàng / hóa đơn
        receivableAmount DECIMAL(18, 2) NOT NULL
            CONSTRAINT DF_customerDebtBalance_receivableAmount DEFAULT (0),

        -- Còn nợ = phải thu - đã thu (mặc định chưa cấn trừ cọc)
        outstandingAmount DECIMAL(18, 2) NOT NULL
            CONSTRAINT DF_customerDebtBalance_outstandingAmount DEFAULT (0),

        note NVARCHAR(500) NULL,
        lastSource NVARCHAR(50) NULL,       -- ví dụ: receiptV2, deliveryNote, invoice
        lastRefNo NVARCHAR(100) NULL,       -- số chứng từ cuối cùng tác động

        user_id0 INT NULL,
        user_id2 INT NULL,
        datetime0 DATETIME2(0) NOT NULL
            CONSTRAINT DF_customerDebtBalance_datetime0 DEFAULT (GETDATE()),
        datetime2 DATETIME2(0) NOT NULL
            CONSTRAINT DF_customerDebtBalance_datetime2 DEFAULT (GETDATE()),

        CONSTRAINT PK_customerDebtBalance PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_customerDebtBalance_unit_customer UNIQUE (unitCode, customer_id),
        CONSTRAINT CK_customerDebtBalance_nonnegative CHECK
        (
            depositAmount >= 0
            AND collectedAmount >= 0
            AND receivableAmount >= 0
            AND outstandingAmount >= 0
        )
    );
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.customerDebtBalance')
      AND name = 'IX_customerDebtBalance_customer'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_customerDebtBalance_customer
        ON dbo.customerDebtBalance(customer_id, unitCode)
        INCLUDE (depositAmount, collectedAmount, receivableAmount, outstandingAmount, datetime2);
END;
GO

