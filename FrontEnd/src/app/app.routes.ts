import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { UserManagementComponent } from './components/user-management/user-management.component';
import { UserPermissionComponent } from './components/user-permission/user-permission.component';
import { authGuard } from './guards/auth.guard';
import { CustomerOrderComponent } from './customer-order/customer-order.component';
import { DynamicFormComponent } from './dynamic-form/dynamic-form.component';
import { CustomerGridComponent } from './customer/customer-list.component';
import { CustomerPopupComponent } from './customer/customer-popup.component';
import { ItemGridComponent } from './item/item-list.component';
import { ItemPopupComponent } from './item/item-popup.component';
import { UomGridComponent } from './uom/uom-list.component';
import { UomPopupComponent } from './uom/uom-popup.component';
import { JobGridComponent } from './job/job-list.component';
import { JobPopupComponent } from './job/job-popup.component';
import { manufacturerGridComponent } from './manufacturer/manufacturer-list.component';
import { manufacturerPopupComponent } from './manufacturer/manufacturer-popup.component';
import { FileAttachmentComponent } from './components/file-attachment/file-attachment.component';
import { FileHandleComponent } from './file-handle/file-handle.component';
import { CustomerGroupGridComponent } from './customer-group/customer-group-list.component';
import { CustomerGroupPopupComponent } from './customer-group/customer-group-popup.component';
import { CompanyGridComponent } from './company/company-list.component';
import { CompanyPopupComponent } from './company/company-popup.component';
import { IndustryGroupGridComponent } from './industry-group/industry-group-list.component';
import { IndustryGroupPopupComponent } from './industry-group/industry-group-popup.component';
import { DeliveryLocationGridComponent } from './delivery-location/delivery-location-group-list.component';
import { DeliveryLocationPopupComponent } from './delivery-location/delivery-location-group-popup.component';
import { quotationPaperGridComponent } from './quotationPaper/quotationPaper-list.component';
import { quotationPaperPopupComponent } from './quotationPaper/quotationPaper-popup.component';
import { TaxGridComponent } from './tax/tax-list.component';
import { TaxPopupComponent } from './tax/tax-popup.component';
import { PriceGridComponent } from './price/price-list.component';
import { PricePopupComponent } from './price/price-popup.component';
import { TranslateComponent } from './translate/translate.component';
import { ReportExampleComponent } from './report/report.component';
import { EmployeePopupComponent } from './employee/employee-popup.component';
import { EmployeeGridComponent } from './employee/employee-list.component';
import { SupplierPopupComponent } from './supplier/supplier-popup.component';
import { SupplierGridComponent } from './supplier/supplier-list.component';
import { PurchaseGridComponent } from './purchase/purchase-list.component';
import { PurchasePopupComponent } from './purchase/purchase-popup.component';
import { NoteGridComponent } from './note/note-list.component';
import { NotePopupComponent } from './note/note-popup.component';
import { OrderGridComponent } from './order/Order-list.component';
import { OrderPopupComponent } from './order/Order-popup.component';
import { ItemGroupGridComponent } from './item-group/item-group-list.component';
import { ItemGroupPopupComponent } from './item-group/item-group-popup.component';
import { ContractGridComponent } from './contract/contract-list.component';
import { ContractPopupComponent } from './contract/contract-popup.component';
import { PositionPopupComponent } from './position/position-popup.component';
import { PositionGridComponent } from './position/position-list.component';
import { AccountSincoGridComponent } from './account-sinco/account-sinco-list.component';
import { AccountSincoPopupComponent } from './account-sinco/account-sinco-popup.component';
import { DeliveryNoteGridComponent } from './deliveryNote/deliveryNote-list.component';
import { DeliveryNotePopupComponent } from './deliveryNote/deliveryNote-popup.component';
import { IncomeExpenditureComponent } from './income-expenditure/income-expenditure-list.component';
import { IncomeExpenditurePopupComponent } from './income-expenditure/income-expenditure-popup.component';
import { PaymentSlipGridComponent } from './paymentSlip/paymentSlip-list.component';
import { PaymentSlipPopupComponent } from './paymentSlip/paymentSlip-popup.component';
import { PoinGridComponent } from './poin/poin-list.component';
import { PoinPopupComponent } from './poin/poin-popup.component';
import { ReceiptV2GridComponent } from './receiptV2/receiptV2.component';
import { ReceiptV2PopupComponent } from './receiptV2/receiptV2-popup.component';

import { LocationGridComponent } from './location/location-list.component';
import { LocationPopupComponent } from './location/location-popup.component';

import { PurchaseReturnReceiptGridComponent } from './purchaseReturnReceipt/purchaseReturnReceipt-list.component';
import { PurchaseReturnReceiptPopupComponent } from './purchaseReturnReceipt/purchaseReturnReceipt-popup.component';
import { OrderReturnGridComponent } from './orderReturn/orderReturn-list.component';
import { OrderReturnPopupComponent } from './orderReturn/orderReturn-popup.component';
import { GoodsReceiptGridComponent } from './goodsReceipt/goodsReceipt-list.component';
import { GoodsReceiptPopupComponent } from './goodsReceipt/goodsReceipt-popup.component';
import { TaxcodeComponent } from './tax/taxcode.component';
import { RoleEmployeeGridComponent } from './role/role-employee-list.component';
import { RoleEmployeePopupComponent } from './role/role-employee-popup.component';
import { ReportBthcnkhComponent } from './bthcnkh/bthcnkh.component';
import { ReportBccnttgComponent } from './bccnttg/bccnttg.component';
import { ReportBcdsbgktcComponent } from './bcdsbgktc/bcdsbgktc.component';
import { ReportBclndktbgComponent } from './bclndktbg/bclndktbg.component';
import { ReportDsnnkhctnComponent } from './dsnnkhctn/dsnnkhctn.component';
import { ReportSksnkhttComponent } from './sksnkhtt/sksnkhtt.component';
import { ReportBctltcbgnvkdComponent } from './bctltcbgnvkd/bctltcbgnvkd.component';
import { ReportNtlctkhttComponent } from './ntlctkhtt/ntlctkhtt.component';
import { ReportKhmgdldComponent } from './khmgdld/khmgdld.component';
import { ReportKhpsgdgnComponent } from './khpsgdgn/khpsgdgn.component';
import { ReportLsgdbghdComponent } from './lsgdbghd/lsgdbghd.component';
import { ReportBctdccnComponent } from './bctdccn/bctdccn.component';
import { ReportQllsqtComponent } from './qllsqt/qllsqt.component';
import { ReportQlptvcComponent } from './qlptvc/qlptvc.component';
import { ReportBcthspdmnccttg91Component } from './bcthspdmnccttg91/bcthspdmnccttg91.component';
import { ReportBcghdkgh135792Component } from './bcghdkgh135792/bcghdkgh135792.component';
import { ReportBcthekho94Component } from './bcthekho94/bcthekho94.component';
import { ReportBcthnxt95Component } from './bcthnxt95/bcthnxt95.component';
import { ReportBcthuchi81Component } from './bcthuchi81/bcthuchi81.component';
import { ReportBccntheongay61Component } from './bccntheongay61/bccntheongay61.component';
import { ReportBcdtlnComponent } from './bcdtln/bcdtln.component';
import { ReportBcdtlnctComponent } from './bcdtlnct/bcdtlnct.component';
import { ReportBcdsthComponent } from './bcdsth/bcdsth.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard],
  },
  {
    path: 'users',
    component: UserManagementComponent,
    canActivate: [authGuard],
  },
  {
    path: 'userGroups',
    loadComponent: () =>
      import('./components/user-group-management/user-group-management.component').then(
        (m) => m.UserGroupManagementComponent
      ),
    canActivate: [authGuard],
  },
  {
    path: 'user-permissions',
    component: UserPermissionComponent,
    canActivate: [authGuard],
  },
  {
    path: 'userGroup-permissions',
    loadComponent: () =>
      import('./components/user-group-permissions/user-group-permissions.component').then(
        (m) => m.UserGroupPermissionsComponent
      ),
    canActivate: [authGuard],
  },
  {
    path: 'sales-process',
    loadComponent: () =>
      import('./sales-process/sales-process.component').then(
        (m) => m.SalesProcessComponent
      ),
  },
  { path: 'file-handle', component: FileHandleComponent },
  { path: 'dynamic-data-grid', component: CustomerGridComponent },
  { path: 'dynamic-data-grid', component: CustomerGridComponent },
  {
    path: 'dynamic-form',
    component: DynamicFormComponent,
    canActivate: [authGuard],
  },
  {
    path: 'grid-master',
    component: CustomerGridComponent,
    canActivate: [authGuard],
  },
  { path: 'file-attachment', component: FileAttachmentComponent },
  {
    path: 'customer',
    component: CustomerGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'customer/popup',
    component: CustomerPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'customer-group',
    component: CustomerGroupGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'customer-group/popup',
    component: CustomerGroupPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'company',
    component: CompanyGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'company/popup',
    component: CompanyPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'employee',
    component: EmployeeGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'employee/popup',
    component: EmployeePopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'supplier',
    component: SupplierGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'supplier/popup',
    component: SupplierPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'industry-group',
    component: IndustryGroupGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'industry-group/popup',
    component: IndustryGroupPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'delivery-location',
    component: DeliveryLocationGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'delivery-location/popup',
    component: DeliveryLocationPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'order', // Add missing order route
    component: OrderGridComponent, // Or create OrderListComponent if needed
    canActivate: [authGuard],
  },
  {
    path: 'order/popup', // Add missing order route
    component: OrderPopupComponent, // Or create OrderListComponent if needed
    canActivate: [authGuard],
  },
  {
    path: 'item',
    component: ItemGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'item/popup',
    component: ItemPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'item-group',
    component: ItemGroupGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'item-group/popup',
    component: ItemGroupPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'uom',
    component: UomGridComponent,
    canActivate: [authGuard],
  },

  {
    path: 'uom/popup',
    component: UomPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'job',
    component: JobGridComponent,
    canActivate: [authGuard],
  },
  
  {
    path: 'job/popup',
    component: JobPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'manufacturer',
    component: manufacturerGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'manufacturer/popup',
    component: manufacturerPopupComponent,
    canActivate: [authGuard],
  },
   {
    path: 'position',
    component: PositionGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'position/popup',
    component: PositionPopupComponent,
    canActivate: [authGuard],
  },
     {
    path: 'account-sinco',
    component: AccountSincoGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'account-sinco/popup',
    component: AccountSincoPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'quotationPaper',
    component: quotationPaperGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'quotationPaper/popup',
    component: quotationPaperPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'tax',
    component: TaxGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'tax/popup',
    component: TaxPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'price',
    component: PriceGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'price/popup',
    component: PricePopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'purchase',
    component: PurchaseGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'purchase/popup',
    component: PurchasePopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'contract',
    component: ContractGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'contract/popup',
    component: ContractPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'paymentslip',
    component: PaymentSlipGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'paymentslip/popup',
    component: PaymentSlipPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'poin',
    component: PoinGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'poin/popup',
    component: PoinPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'note',
    component: NoteGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'note/popup',
    component: NotePopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'deliveryNote',
    component: DeliveryNoteGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'deliveryNote/popup',
    component: DeliveryNotePopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'income-expenditure',
    component: IncomeExpenditureComponent,
    canActivate: [authGuard],
  },
  {
    path: 'income-expenditure/popup',
    component: IncomeExpenditurePopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'receiptV2',
    component: ReceiptV2GridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'receiptV2/popup',
    component: ReceiptV2PopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'location',
    component: LocationGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'location/popup',
    component: LocationPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'purchaseReturnReceipt',
    component: PurchaseReturnReceiptGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'purchaseReturnReceipt/popup',
    component: PurchaseReturnReceiptPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'orderReturn',
    component: OrderReturnGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'orderReturn/popup',
    component: OrderReturnPopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'goodsReceipt',
    component: GoodsReceiptGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'goodsReceipt/popup',
    component: GoodsReceiptPopupComponent,
    canActivate: [authGuard],
  }, 
  {
    path: 'roleEmployee',
    component: RoleEmployeeGridComponent,
    canActivate: [authGuard],
  },
  {
    path: 'roleEmployee/popup',
    component: RoleEmployeePopupComponent,
    canActivate: [authGuard],
  },
  {
    path: 'screen/:screenId/popup',
    loadComponent: () =>
      import('./dynamic-screen/dynamic-screen-popup.component').then(
        (m) => m.DynamicScreenPopupComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'screen/:screenId',
    loadComponent: () =>
      import('./dynamic-screen/dynamic-screen-list.component').then(
        (m) => m.DynamicScreenListComponent,
      ),
    canActivate: [authGuard],
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'taxcode', component: TaxcodeComponent, pathMatch: 'full' },
  { path: 'lang', component: TranslateComponent, pathMatch: 'full' },
  { path: 'report', component: ReportExampleComponent, pathMatch: 'full' },
  { path: 'bthcnkh', component: ReportBthcnkhComponent, pathMatch: 'full' },
  { path: 'bccnttg', component: ReportBccnttgComponent, pathMatch: 'full' },
  { path: 'bcdsbgktc', component: ReportBcdsbgktcComponent, pathMatch: 'full' },
  { path: 'bclndktbg', component: ReportBclndktbgComponent, pathMatch: 'full' },
  { path: 'dsnnkhctn', component: ReportDsnnkhctnComponent, pathMatch: 'full' },
  { path: 'sksnkhtt', component: ReportSksnkhttComponent, pathMatch: 'full' },
  { path: 'bctltcbgnvkd', component: ReportBctltcbgnvkdComponent, pathMatch: 'full' },
  { path: 'ntlctkhtt', component: ReportNtlctkhttComponent, pathMatch: 'full' },
  { path: 'khmgdld', component: ReportKhmgdldComponent, pathMatch: 'full' },
  { path: 'khpsgdgn', component: ReportKhpsgdgnComponent, pathMatch: 'full' },
  { path: 'lsgdbghd', component: ReportLsgdbghdComponent, pathMatch: 'full' },     
  { path: 'bctdccn', component: ReportBctdccnComponent, pathMatch: 'full' },
  { path: 'lsgdbghd', component: ReportLsgdbghdComponent, pathMatch: 'full' },
  { path: 'qllsqt', component: ReportQllsqtComponent, pathMatch: 'full' },  
  { path: 'qlptvc', component: ReportQlptvcComponent, pathMatch: 'full' },   
  { path: 'bcthspdmnccttg91', component: ReportBcthspdmnccttg91Component, pathMatch: 'full' },
  { path: 'bcghdkgh135792', component: ReportBcghdkgh135792Component, pathMatch: 'full' },
  { path: 'bcthekho94', component: ReportBcthekho94Component, pathMatch: 'full' },
  { path: 'bcthnxt95', component: ReportBcthnxt95Component, pathMatch: 'full' },
  { path: 'bcthuchi81', component: ReportBcthuchi81Component, pathMatch: 'full' },
  { path: 'bccntheongay61', component: ReportBccntheongay61Component, pathMatch: 'full' },
  { path: 'bcdtln', component: ReportBcdtlnComponent, pathMatch: 'full' },
  { path: 'bcdtlnct', component: ReportBcdtlnctComponent, pathMatch: 'full' },
  { path: 'bcdsth', component: ReportBcdsthComponent, pathMatch: 'full' },
];
