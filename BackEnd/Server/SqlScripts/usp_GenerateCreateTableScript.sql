CREATE OR ALTER PROCEDURE [dbo].[usp_GenerateCreateTableScript]
    @SchemaName NVARCHAR(128) = 'dbo',
    @TableName  NVARCHAR(128)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ObjectId INT;
    DECLARE @SQL NVARCHAR(MAX) = N'';
    DECLARE @CRLF NVARCHAR(2) = CHAR(13) + CHAR(10);

    SET @ObjectId = OBJECT_ID(QUOTENAME(@SchemaName) + '.' + QUOTENAME(@TableName));

    IF @ObjectId IS NULL
    BEGIN
        RAISERROR(N'Bảng %s.%s không tồn tại.', 16, 1, @SchemaName, @TableName);
        RETURN;
    END;

    SET @SQL = 'CREATE TABLE ' + QUOTENAME(@SchemaName) + '.' + QUOTENAME(@TableName) + ' (' + @CRLF;

    ;WITH ColumnInfo AS
    (
        SELECT
            c.column_id,
            c.name AS ColumnName,
            t.name AS DataType,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable,
            c.is_identity,
            dc.definition AS DefaultDefinition
        FROM sys.columns c
        INNER JOIN sys.types t
            ON c.user_type_id = t.user_type_id
        LEFT JOIN sys.default_constraints dc
            ON c.default_object_id = dc.object_id
        WHERE c.object_id = @ObjectId
    )
    SELECT
        @SQL = @SQL +
            '    ' + QUOTENAME(ColumnName) + ' ' +
            CASE
                WHEN DataType IN ('varchar', 'char', 'varbinary', 'binary')
                    THEN DataType + '(' + CASE WHEN max_length = -1 THEN 'MAX' ELSE CAST(max_length AS VARCHAR(10)) END + ')'
                WHEN DataType IN ('nvarchar', 'nchar')
                    THEN DataType + '(' + CASE WHEN max_length = -1 THEN 'MAX' ELSE CAST(max_length / 2 AS VARCHAR(10)) END + ')'
                WHEN DataType IN ('decimal', 'numeric')
                    THEN DataType + '(' + CAST([precision] AS VARCHAR(10)) + ',' + CAST(scale AS VARCHAR(10)) + ')'
                WHEN DataType IN ('datetime2', 'datetimeoffset', 'time')
                    THEN DataType + '(' + CAST(scale AS VARCHAR(10)) + ')'
                ELSE DataType
            END +
            CASE
                WHEN is_identity = 1 THEN ' IDENTITY(1,1)'
                ELSE ''
            END +
            CASE
                WHEN DefaultDefinition IS NOT NULL THEN ' DEFAULT ' + DefaultDefinition
                ELSE ''
            END +
            CASE
                WHEN is_nullable = 1 THEN ' NULL'
                ELSE ' NOT NULL'
            END + ',' + @CRLF
    FROM ColumnInfo
    ORDER BY column_id;

    DECLARE @PKName NVARCHAR(128);
    DECLARE @PKCols NVARCHAR(MAX);

    SELECT @PKName = kc.name
    FROM sys.key_constraints kc
    WHERE kc.parent_object_id = @ObjectId
      AND kc.[type] = 'PK';

    SELECT @PKCols =
        STUFF((
            SELECT ', ' + QUOTENAME(c.name)
            FROM sys.index_columns ic
            INNER JOIN sys.columns c
                ON ic.object_id = c.object_id
               AND ic.column_id = c.column_id
            INNER JOIN sys.key_constraints kc
                ON ic.object_id = kc.parent_object_id
               AND ic.index_id = kc.unique_index_id
            WHERE kc.parent_object_id = @ObjectId
              AND kc.[type] = 'PK'
            ORDER BY ic.key_ordinal
            FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '');

    IF @PKCols IS NOT NULL
    BEGIN
        SET @SQL = @SQL +
            '    CONSTRAINT ' + QUOTENAME(@PKName) + ' PRIMARY KEY (' + @PKCols + ')' + @CRLF;
    END
    ELSE
    BEGIN
        -- bỏ dấu phẩy cuối nếu không có PK
        SET @SQL = LEFT(@SQL, LEN(@SQL) - 3) + @CRLF;
    END

    SET @SQL = @SQL + ');';

    SELECT @SQL AS CreateTableScript;
END
GO

