-- Chạy sp_AddColumnToPartitionTables.sql trước
DECLARE @StartYear INT = 2025;
DECLARE @EndYear INT = 2027;

-- Master receiptV2: tham chiếu phiếu thu đặt cọc để cấn trừ công nợ
EXEC dbo.sp_AddColumnToPartitionTables N'receiptV2', N'depositReceiptNo', N'NVARCHAR(50) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'receiptV2', N'dien_giai', N'NVARCHAR(1000) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'receiptV2', N'allocationJson', N'NVARCHAR(MAX) NULL', @StartYear, @EndYear;
