ALTER PROCEDURE [dbo].[SyncFromDeliveryNote]
  @Ids NVARCHAR(MAX),
  @Unit NVARCHAR(50),
  @UserId NVARCHAR(50),
  @Language NVARCHAR(10),
  @FormConfig NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

	/*
		@FormConfig: receipt.page.json => Tạo phiếu thu
		@FormConfig: purchaseReturnReceipt.page.json => Tạo phiếu nhập hàng trả lại
	*/

    -- Split @Ids thành table variable nếu cần
    -- SELECT * FROM dbo.StringSplit(@Ids, ',')
	declare @newid varchar (64)
	select @newid = replace (LOWER(NEWID()), '-', '')
    SELECT
        idGui = value,
        Unit = @Unit,
        UserId = @UserId,
        Language = @Language
    into #ds_phieu_xuat FROM STRING_SPLIT(@Ids, ',')

	declare @dfrom smalldatetime, @dTo smalldatetime, @dTmp smalldatetime, @q nvarchar (max), @sync varchar (33)
	select @dfrom = min (voucherDate), @dTo = max (voucherDate) from deliveryNote$000000 a join #ds_phieu_xuat b on a.idGui = b.idGui
	select top 0 a.*, cast('' as varchar(50)) as idGuiPX into #master from deliveryNote$202507 a join #ds_phieu_xuat b on a.idGui = b.idGui
	select top 0 a.*, cast('' as varchar(50)) as idGuiPX into #detail from deliveryNoteDetail$202507 a join #ds_phieu_xuat b on a.idGui = b.idGui

	select @dfrom = '20250101' where @dfrom is null
	select @dTo = getdate() where @dTo is null

	select @q = '', @dTmp = @dfrom
	WHILE @dTmp <= @dTo
	BEGIN
		SELECT @sync = ''
		SELECT @sync = convert (varchar(6), @dTmp, 112)
		select @q = '
		insert into #master select a.*, cast('''' as varchar(50)) as idGuiPX from deliveryNote$'+@sync+' a join #ds_phieu_xuat b on a.idGui = b.idGui
		insert into #detail
		select a.*, cast('''' as varchar(50)) as idGuiPX from deliveryNoteDetail$'+@sync+' a join #ds_phieu_xuat b on a.idGui = b.idGui
		'
		exec(@q)
		print @q

		SELECT @dTmp = dateadd (month, 1, @dTmp)
	END


	IF exists (SELECT  1 FROM #master a join #master b on 1=1 where a.customer_id <> b.customer_id)
	BEGIN
		SELECT 0 as type, case when @Language = 'V' then N'Có mã khách khác nhau giữa 2 phiếu xuất, vui lòng xem lại!!!' else N'There are different customer codes between the 2 delivery orders, please check again!!!' end as message
		return
	END
	exec [sp_UpdateNullsToDefault] '#master'
	exec [sp_UpdateNullsToDefault] '#detail'

	if @FormConfig = 'receipt.page.json' begin
		select top 0 idGui, customerCode, voucherDate, voucherNumber, collectorCode, collectorName, customerAddress, reason, note, status, total_amount
			into #receiptmt FROM receipt$000000

		select top 0 idGui, line_nbr, accountReceiveCode, amountCur, amount, note, idGuiDN, lnDN, vcNumberDN
		into #receiptdt FROM receiptdetail$000000

		insert into #receiptmt select @newid, a.customer_id, convert (smalldatetime, getdate(), 103) voucherDate, '' as voucherNumber, max(a.employee_id), max(c.full_name) as collectorName
			, max(a.orderAddress) as customerAddress, '' as reason, '' as note, '0' as status, sum(a.totalPayment)
			from #master a left join customer b on a.customer_id = b.customer_id left join employee c on a.employee_id = c.employee_id
			group by a.customer_id

		insert into #receiptdt (idGui, line_nbr, accountReceiveCode, amountCur, amount, note, idGuiDN, lnDN, vcNumberDN)
			select @newid, ROW_NUMBER() over(order by min(item_id)), '' as accountReceiveCode, 0 as amountCur, sum(payment) - SUM(sl_receipt), max(a.note), a.idGui, 1, max(b.voucherNumber)
			from #detail a join #master b on a.idGui = b.idGui group by a.idGui


		delete #receiptdt where amount = 0
		if not exists (select 1 from #receiptdt)
		BEGIN
			SELECT 0 as type, N'Phiếu xuất đã kế thừa hết sang phiếu thu!!' as message
			return
		END

		exec sp_UpdateNullsToDefault '#receiptmt'
		exec sp_UpdateNullsToDefault '#receiptdt'

		select 1 as type, '' message
		select * from #receiptmt
		select * from #receiptdt
		return
	end

	IF @FormConfig = 'receiptV2.page.json'
	BEGIN
		IF OBJECT_ID('dbo.CustomerDebtLedger', 'U') IS NULL
		BEGIN
			SELECT 0 AS type, N'Chưa có bảng CustomerDebtLedger để xác định công nợ phiếu xuất.' AS message;
			RETURN;
		END

		IF EXISTS
		(
			SELECT 1
			FROM #master
			WHERE NULLIF(LTRIM(RTRIM(customer_id)), '') IS NULL
			   OR (NULLIF(LTRIM(RTRIM(@Unit)), '') IS NOT NULL AND ISNULL(unitCode, '') <> @Unit)
		)
		BEGIN
			SELECT 0 AS type, N'Phiếu xuất không thuộc khách hàng hoặc đơn vị đang thao tác.' AS message;
			RETURN;
		END

		CREATE TABLE #receiptAllocation
		(
			refIdGuiDN NVARCHAR(64) NOT NULL PRIMARY KEY,
			voucherNumber NVARCHAR(100) NULL,
			voucherDate DATE NULL,
			receivableAmount DECIMAL(24,6) NOT NULL,
			collectedAmount DECIMAL(24,6) NOT NULL,
			outstandingAmount DECIMAL(24,6) NOT NULL,
			allocatedAmount DECIMAL(24,6) NOT NULL,
			invoiceNumber NVARCHAR(100) NULL,
			invoiceDate DATE NULL,
			invoiceAmount DECIMAL(24,6) NOT NULL,
			note NVARCHAR(500) NULL
		);

		INSERT INTO #receiptAllocation
		(
			refIdGuiDN, voucherNumber, voucherDate,
			receivableAmount, collectedAmount, outstandingAmount, allocatedAmount,
			invoiceNumber, invoiceDate, invoiceAmount, note
		)
		SELECT
			a.idGui,
			a.voucherNumber,
			TRY_CONVERT(date, a.voucherDate),
			calc.receivableAmount,
			calc.collectedAmount,
			calc.outstandingAmount,
			calc.outstandingAmount,
			a.voucherNumber,
			TRY_CONVERT(date, a.voucherDate),
			calc.receivableAmount,
			ISNULL(a.note, N'')
		FROM #master a
		OUTER APPLY
		(
			SELECT
				receivableAmount = CASE
					WHEN ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), l.ReceivableAmount), 0)), 0) > 0
						THEN ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), l.ReceivableAmount), 0)), 0)
					ELSE ISNULL(TRY_CONVERT(decimal(24,6), a.totalPayment), 0)
				END,
				collectedAmount = CASE
					WHEN COUNT(l.RefIdGui) > 0
						THEN ISNULL(SUM(ISNULL(TRY_CONVERT(decimal(24,6), l.CollectedAmount), 0)), 0)
					ELSE ISNULL(TRY_CONVERT(decimal(24,6), a.paidAmount), 0)
				END,
				outstandingAmount = CASE
					WHEN COUNT(l.RefIdGui) > 0 THEN ISNULL(SUM(
						ISNULL(TRY_CONVERT(decimal(24,6), l.ReceivableAmount), 0)
						+ ISNULL(TRY_CONVERT(decimal(24,6), l.DebitAmount), 0)
						- ISNULL(TRY_CONVERT(decimal(24,6), l.CreditAmount), 0)
						- ISNULL(TRY_CONVERT(decimal(24,6), l.CollectedAmount), 0)
					), 0)
					WHEN ISNULL(TRY_CONVERT(decimal(24,6), a.debtAmount), 0) > 0
						THEN ISNULL(TRY_CONVERT(decimal(24,6), a.debtAmount), 0)
					ELSE ISNULL(TRY_CONVERT(decimal(24,6), a.totalPayment), 0)
						- ISNULL(TRY_CONVERT(decimal(24,6), a.paidAmount), 0)
				END
			FROM dbo.CustomerDebtLedger l
			WHERE l.CustomerId = a.customer_id
			  AND l.UnitCode = a.unitCode
			  AND l.RefIdGui = a.idGui
			  AND
			  (
				l.RefController = N'deliveryNote'
				OR
				(
					l.RefController = N'receiptV2'
					AND UPPER(ISNULL(l.ReceiptType, N'')) IN
						(N'RECEIPT_CUSTOMER', N'RECEIPT_DEPOSIT_OFFSET')
				)
			  )
		) calc
		WHERE calc.outstandingAmount > 0;

		IF NOT EXISTS (SELECT 1 FROM #receiptAllocation)
		BEGIN
			SELECT 0 AS type, N'Các phiếu xuất đã chọn không còn công nợ phải thu.' AS message;
			RETURN;
		END

		IF (SELECT COUNT(*) FROM #receiptAllocation) <> (SELECT COUNT(DISTINCT idGui) FROM #master)
		BEGIN
			SELECT 0 AS type, N'Có phiếu xuất đã thanh toán đủ. Vui lòng chỉ chọn các phiếu còn nợ.' AS message;
			RETURN;
		END

		DECLARE @allocationJson NVARCHAR(MAX) =
		(
			SELECT
				refIdGuiDN, voucherNumber, voucherDate,
				receivableAmount, collectedAmount, outstandingAmount, allocatedAmount,
				invoiceNumber, invoiceDate, invoiceAmount, note
			FROM #receiptAllocation
			ORDER BY voucherDate, voucherNumber
			FOR JSON PATH
		);

		DECLARE @deliveryNoteNo NVARCHAR(50) = LEFT
		(
			STUFF
			(
				(
					SELECT N', ' + CONVERT(NVARCHAR(100), x.voucherNumber)
					FROM #receiptAllocation x
					ORDER BY x.voucherDate, x.voucherNumber
					FOR XML PATH(''), TYPE
				).value('.', 'nvarchar(max)'),
				1, 2, N''
			),
			50
		);

		SELECT 1 AS type, '' AS message;
		SELECT
			idGui = @newid,
			voucherCode = 'Z07',
			voucherNumber = '',
			voucherDate = CONVERT(date, GETDATE()),
			createdDate = GETDATE(),
			customerCode = MAX(a.customer_id),
			customerAddress = MAX(CASE WHEN ISNULL(a.orderAddress, '') = '' THEN ISNULL(c.address, '') ELSE a.orderAddress END),
			collectorCode = MAX(a.employee_id),
			receiptType = 'CUSTOMER',
			deliveryNoteNo = @deliveryNoteNo,
			allocationJson = @allocationJson,
			depositReceiptNo = '',
			reason = '',
			accountReceiveCode = '',
			invoiceNumber = '',
			paymentType = 'CK',
			amountTransfer = CAST(0 AS DECIMAL(24,6)),
			amountCash = CAST(0 AS DECIMAL(24,6)),
			total_amount = (SELECT SUM(allocatedAmount) FROM #receiptAllocation),
			isReceived = 0,
			dien_giai = '',
			status = '0',
			unitCode = @Unit,
			datetime0 = GETDATE(),
			datetime2 = GETDATE(),
			user_id0 = TRY_CONVERT(INT, @UserId),
			user_id2 = TRY_CONVERT(INT, @UserId)
		FROM #master a
		LEFT JOIN customer c ON c.customer_id = a.customer_id;
		RETURN;
	END


	if @FormConfig = 'purchaseReturnReceipt.page.json' begin
		declare @spn varchar(50), @up_i int; select @up_i = 0, @spn = prefix + rtrim(year(getdate())) + right('00' + month(getdate()), 2) + right('0000000000'+ rtrim(currentNumber+1), NumberLength)
			from VoucherSequence
		where Controller = 'PurchaseReturnReceipt' and Field = 'voucherNumber';

		update VoucherSequence set currentNumber = currentNumber + 1 from VoucherSequence
			where Controller = 'PurchaseReturnReceipt' and Field = 'voucherNumber';

		select top 0 idGui, customerCode, voucherDate, voucherNumber, number_delivery, customerGroupCode, addressCustomer, phoneCustomer, employeeCode, note
			, totalQuantity, totalAmount, totalTax, totalDiscount, totalPayment, status
			into #dnmt FROM purchaseReturn$000000

		select top 0 idGui, line_nbr, item_id, uom, quantity, price, ratioDiscount, discount, amount, tax, tax_rate, taxCode, siteCode, payment
			, note, idGuiDN, lnDN, vcNumberDN
			into #dndt FROM purchaseReturnDetail$000000

		insert into #dnmt select @newid, a.customer_id, convert (smalldatetime, getdate(), 103) voucherDate, @spn as voucherNumber,  max(voucherNumber) number_delivery, max(b.customer_group_id) as customerGroupCode
			, case when  max(a.orderAddress) = '' then  max(b.address) else max(a.orderAddress) end
			, case when  max(phonePerson) = '' then  max(b.phone_number) else max(phonePerson) end, max(employee_id), max(a.note), sum(a.totalQuantity), sum(a.totalAmount), sum(a.totalTax), 0 as  totalDiscount, sum(totalPayment), '0' as status
			from #master a left join customer b on a.customer_id = b.customer_id
			group by a.customer_id

		insert into #dndt (idGui, line_nbr, item_id, uom, quantity, price, ratioDiscount, discount, amount, tax, tax_rate, taxCode, siteCode, payment, note, idGuiDN, lnDN, vcNumberDN)
			select @newid, ROW_NUMBER() over(order by a.idGui, a.line_nbr), item_id, a.uom, quantity - sl_PRR, price, 0 as ratioDiscount, 0 as discount
				, amount, tax, tax_rate, taxCode, '' as siteCode, payment, a.note, a.idGui, a.line_nbr, b.voucherNumber
			from #detail a join #master b on a.idGui = b.idGui


		update #dndt set [amount] = [quantity] * [price]
		update #dndt set [tax] = [amount] * [tax_rate] / 100
		update #dndt set [payment] = [amount] + [tax]

		update #dnmt set totalQuantity = b.[quantity],totalAmount = b.[amount],totalTax = b.[tax],totalPayment = b.[payment]
			from #dnmt a join (select idGui, sum ([quantity]) [quantity], sum ([tax]) [tax], sum ([amount]) [amount], sum ([payment]) [payment] from #dndt group by idGui)  b on a.idGui = b.idGui


		delete #dndt where quantity = 0
		if not exists (select 1 from #dndt)
		BEGIN
			SELECT 0 as type, N'Phiếu xuất đã kế thừa hết sang phiếu nhập trả lại!!' as message
			return
		END

		exec sp_UpdateNullsToDefault '#dnmt'
		exec sp_UpdateNullsToDefault '#dndt'

		select 1 as type, '' message
		select * from #dnmt
		select * from #dndt order by line_nbr



		return
	end
END
