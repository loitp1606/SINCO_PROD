-- Yêu cầu:
-- 1) Chạy file sp_AddColumnToPartitionTables.sql trước
-- 2) Sau đó chạy file này để tạo các cột mới cho goodsReceipt/goodsReceiptDetail theo partition

DECLARE @StartYear INT = 2025;
DECLARE @EndYear INT = 2027;

-- Master: goodsReceipt
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceipt', N'receiveStatus', N'NVARCHAR(30) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceipt', N'paidAmount', N'DECIMAL(24,6) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceipt', N'debtAmount', N'DECIMAL(24,6) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceipt', N'paymentStatus', N'NVARCHAR(30) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceipt', N'invoiceCustomerCode', N'NVARCHAR(50) NULL', @StartYear, @EndYear;

-- Detail: goodsReceiptDetail
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceiptDetail', N'invoiceCustomerCode', N'NVARCHAR(50) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceiptDetail', N'itemNameVAT', N'NVARCHAR(500) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceiptDetail', N'invoiceNumber', N'NVARCHAR(100) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceiptDetail', N'invoiceDate', N'DATE NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceiptDetail', N'isReceived', N'INT NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'goodsReceiptDetail', N'sl_payment', N'DECIMAL(24,6) NULL', @StartYear, @EndYear;
