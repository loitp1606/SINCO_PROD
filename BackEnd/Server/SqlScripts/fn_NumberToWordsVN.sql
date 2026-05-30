CREATE OR ALTER FUNCTION dbo.fn_NumberToWordsVN
(
    @amount DECIMAL(38, 2)
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    DECLARE @result NVARCHAR(MAX) = N'';
    DECLARE @sign NVARCHAR(10) = N'';

    IF @amount IS NULL
        RETURN NULL;

    IF @amount < 0
    BEGIN
        SET @sign = N'Âm ';
        SET @amount = ABS(@amount);
    END

    -- Hệ thống hiện tại in tiền VND, làm tròn về đồng.
    DECLARE @n DECIMAL(38, 0) = ROUND(@amount, 0);

    IF @n = 0
        RETURN N'Không đồng';

    DECLARE @groups TABLE
    (
        idx INT PRIMARY KEY,
        grp INT NOT NULL
    );

    DECLARE @idx INT = 0;
    WHILE @n > 0
    BEGIN
        INSERT INTO @groups(idx, grp)
        VALUES (@idx, CONVERT(INT, @n % 1000));

        SET @n = FLOOR(@n / 1000);
        SET @idx += 1;
    END

    DECLARE @maxIdx INT = (SELECT MAX(idx) FROM @groups);
    DECLARE @i INT = @maxIdx;
    DECLARE @hasHigher BIT = 0;

    WHILE @i >= 0
    BEGIN
        DECLARE @g INT = ISNULL((SELECT grp FROM @groups WHERE idx = @i), 0);
        DECLARE @segment NVARCHAR(200) = N'';

        IF @g > 0
        BEGIN
            DECLARE @hundreds INT = @g / 100;
            DECLARE @remain INT = @g % 100;
            DECLARE @tens INT = @remain / 10;
            DECLARE @ones INT = @remain % 10;

            DECLARE @wHundreds NVARCHAR(20) = CASE @hundreds
                WHEN 1 THEN N'một' WHEN 2 THEN N'hai' WHEN 3 THEN N'ba'
                WHEN 4 THEN N'bốn' WHEN 5 THEN N'năm' WHEN 6 THEN N'sáu'
                WHEN 7 THEN N'bảy' WHEN 8 THEN N'tám' WHEN 9 THEN N'chín'
                ELSE N'' END;

            DECLARE @wTens NVARCHAR(20) = CASE @tens
                WHEN 1 THEN N'một' WHEN 2 THEN N'hai' WHEN 3 THEN N'ba'
                WHEN 4 THEN N'bốn' WHEN 5 THEN N'năm' WHEN 6 THEN N'sáu'
                WHEN 7 THEN N'bảy' WHEN 8 THEN N'tám' WHEN 9 THEN N'chín'
                ELSE N'' END;

            DECLARE @wOnes NVARCHAR(20) = CASE @ones
                WHEN 1 THEN N'một' WHEN 2 THEN N'hai' WHEN 3 THEN N'ba'
                WHEN 4 THEN N'bốn' WHEN 5 THEN N'năm' WHEN 6 THEN N'sáu'
                WHEN 7 THEN N'bảy' WHEN 8 THEN N'tám' WHEN 9 THEN N'chín'
                ELSE N'' END;

            IF @hundreds > 0
            BEGIN
                SET @segment = @segment + @wHundreds + N' trăm';
                IF @remain > 0 SET @segment = @segment + N' ';
            END
            ELSE IF @hasHigher = 1 AND @remain > 0
            BEGIN
                -- Ví dụ: 1.005 => "một nghìn không trăm lẻ năm"
                SET @segment = @segment + N'không trăm';
                IF @remain > 0 SET @segment = @segment + N' ';
            END

            IF @remain > 0
            BEGIN
                IF @tens = 0
                BEGIN
                    IF @hundreds > 0 OR @hasHigher = 1
                        SET @segment = @segment + N'lẻ ';

                    SET @segment = @segment + @wOnes;
                END
                ELSE IF @tens = 1
                BEGIN
                    SET @segment = @segment + N'mười';
                    IF @ones > 0
                    BEGIN
                        SET @segment = @segment + N' ';
                        IF @ones = 5
                            SET @segment = @segment + N'lăm';
                        ELSE
                            SET @segment = @segment + @wOnes;
                    END
                END
                ELSE
                BEGIN
                    SET @segment = @segment + @wTens + N' mươi';
                    IF @ones > 0
                    BEGIN
                        SET @segment = @segment + N' ';
                        IF @ones = 1
                            SET @segment = @segment + N'mốt';
                        ELSE IF @ones = 4
                            SET @segment = @segment + N'tư';
                        ELSE IF @ones = 5
                            SET @segment = @segment + N'lăm';
                        ELSE
                            SET @segment = @segment + @wOnes;
                    END
                END
            END

            DECLARE @suffix NVARCHAR(20) = CASE @i
                WHEN 0 THEN N''
                WHEN 1 THEN N'nghìn'
                WHEN 2 THEN N'triệu'
                WHEN 3 THEN N'tỷ'
                WHEN 4 THEN N'nghìn tỷ'
                WHEN 5 THEN N'triệu tỷ'
                WHEN 6 THEN N'tỷ tỷ'
                ELSE N'' END;

            IF @suffix <> N''
                SET @segment = @segment + N' ' + @suffix;

            SET @result = LTRIM(RTRIM(@result + N' ' + @segment));
            SET @hasHigher = 1;
        END

        SET @i -= 1;
    END

    WHILE CHARINDEX(N'  ', @result) > 0
        SET @result = REPLACE(@result, N'  ', N' ');

    SET @result = LTRIM(RTRIM(@result));

    IF LEN(@result) > 0
        SET @result = UPPER(LEFT(@result, 1)) + SUBSTRING(@result, 2, LEN(@result));

    RETURN @sign + @result + N' đồng';
END
GO

