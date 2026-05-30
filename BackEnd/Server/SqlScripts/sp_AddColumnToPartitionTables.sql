CREATE OR ALTER PROCEDURE dbo.sp_AddColumnToPartitionTables
    @BaseTablePrefix NVARCHAR(128),
    @ColumnName NVARCHAR(128),
    @ColumnDefinition NVARCHAR(400),
    @StartYear INT,
    @EndYear INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @sql NVARCHAR(MAX);
    DECLARE @tableName NVARCHAR(256);
    DECLARE @year INT = @StartYear;
    DECLARE @month INT;
    DECLARE @ym CHAR(6);
    DECLARE @baseTableName NVARCHAR(256);

    SET @baseTableName = @BaseTablePrefix + N'$000000';
    SET @tableName = QUOTENAME(@baseTableName);

    SET @sql = N'
IF OBJECT_ID(N''' + @tableName + N''', N''U'') IS NOT NULL
BEGIN
    IF COL_LENGTH(N''' + REPLACE(@baseTableName, '''', '''''') + N''', N''' + REPLACE(@ColumnName, '''', '''''') + N''') IS NULL
        ALTER TABLE ' + @tableName + N' ADD ' + QUOTENAME(@ColumnName) + N' ' + @ColumnDefinition + N';
END';
    EXEC sp_executesql @sql;

    WHILE @year <= @EndYear
    BEGIN
        SET @month = 1;
        WHILE @month <= 12
        BEGIN
            SET @ym = CONVERT(CHAR(4), @year) + RIGHT('0' + CAST(@month AS VARCHAR(2)), 2);
            SET @baseTableName = @BaseTablePrefix + N'$' + @ym;
            SET @tableName = QUOTENAME(@baseTableName);

            SET @sql = N'
IF OBJECT_ID(N''' + @tableName + N''', N''U'') IS NOT NULL
BEGIN
    IF COL_LENGTH(N''' + REPLACE(@baseTableName, '''', '''''') + N''', N''' + REPLACE(@ColumnName, '''', '''''') + N''') IS NULL
        ALTER TABLE ' + @tableName + N' ADD ' + QUOTENAME(@ColumnName) + N' ' + @ColumnDefinition + N';
END';
            EXEC sp_executesql @sql;

            SET @month = @month + 1;
        END;
        SET @year = @year + 1;
    END;
END
GO

