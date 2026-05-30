-- Chạy sp_AddColumnToPartitionTables.sql trước
DECLARE @StartYear INT = 2025;
DECLARE @EndYear INT = 2027;

-- Master paymentslip: bổ sung loại chi
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslip', N'paymentType', N'NVARCHAR(20) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslip', N'dien_giai', N'NVARCHAR(1000) NULL', @StartYear, @EndYear;

-- Detail paymentslipDetail: chi theo hóa đơn
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslipDetail', N'invoiceNumber', N'NVARCHAR(100) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslipDetail', N'invoiceDate', N'DATE NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslipDetail', N'invoiceAmount', N'DECIMAL(24,6) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslipDetail', N'paidAmount', N'DECIMAL(24,6) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslipDetail', N'debtAmount', N'DECIMAL(24,6) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslipDetail', N'idGuiPN', N'NVARCHAR(64) NULL', @StartYear, @EndYear;
EXEC dbo.sp_AddColumnToPartitionTables N'paymentslipDetail', N'lnPN', N'INT NULL', @StartYear, @EndYear;
