IF OBJECT_ID('dbo.orderReturn$000000', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[orderReturn$000000]
    (
        [idGui] [varchar](50) NOT NULL,
        [voucherNumber] [varchar](32) NULL,
        [voucherDate] [datetime] NULL,
        [voucherCode] [varchar](3) NULL,
        [customerGroupCode] [varchar](50) NULL,
        [customerCode] [varchar](50) NULL,
        [addressCustomer] [nvarchar](432) NULL,
        [phoneCustomer] [nvarchar](432) NULL,
        [employeeCode] [varchar](50) NULL,
        [note] [nvarchar](432) NULL,
        [number_delivery] [varchar](50) NULL,
        [totalQuantity] [numeric](24, 4) NULL,
        [totalAmount] [numeric](20, 4) NULL,
        [totalTax] [numeric](20, 4) NULL,
        [totalDiscount] [numeric](20, 4) NULL,
        [totalPayment] [numeric](20, 4) NULL,
        [status] [char](1) NULL,
        [user_id0] [int] NULL,
        [user_id2] [int] NULL,
        [datetime0] [datetime] NULL,
        [datetime2] [datetime] NULL,
        [unitCode] [varchar](50) NULL,
        CONSTRAINT [PK_orderReturn$000000] PRIMARY KEY CLUSTERED ([idGui] ASC)
    );
END;
GO

IF OBJECT_ID('dbo.orderReturnDetail$000000', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[orderReturnDetail$000000]
    (
        [idGui] [varchar](50) NOT NULL,
        [line_nbr] [int] NOT NULL,
        [stt] [int] NULL,
        [item_id] [varchar](50) NULL,
        [uom] [nvarchar](16) NULL,
        [quantity] [numeric](24, 4) NULL,
        [price] [numeric](24, 4) NULL,
        [ratioDiscount] [numeric](24, 4) NULL,
        [amount] [numeric](24, 4) NULL,
        [discount] [numeric](24, 4) NULL,
        [tax] [numeric](24, 4) NULL,
        [payment] [numeric](24, 4) NULL,
        [note] [nvarchar](256) NULL,
        [tax_rate] [numeric](5, 2) NULL,
        [taxCode] [varchar](8) NULL,
        [siteCode] [varchar](50) NULL,
        [idGuiDN] [varchar](50) NULL,
        [vcNumberDN] [varchar](50) NULL,
        [lnDN] [numeric](12, 4) NULL,
        CONSTRAINT [PK_orderReturnDetail$000000] PRIMARY KEY CLUSTERED ([idGui] ASC, [line_nbr] ASC)
    );
END;
GO
exec sp_create_periods_range_nofk 'orderReturn$000000','orderReturn', 'idGui', 'voucherDate', 1, '202501','202612'
exec sp_create_periods_range_nofk 'orderReturnDetail$000000','orderReturnDetail', 'idGui,line_nbr', 'voucherDate', 1, '202501','202612'
go
