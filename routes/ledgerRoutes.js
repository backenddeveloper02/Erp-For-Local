import express from "express";
import { auth } from "../middlewares/authMiddleware.js";

import {
  createCustomer,
  searchCustomers,
  getCustomer,
} from "../controller/customerController.js";

// import {
//   createInvoice,
//   getInvoiceDetail,
//   getCustomerInvoices,
//   getPendingInvoices,
// } from "../controller/invoiceController.js";

import {
  createPayment,
  getPaymentsByInvoice,
  getPaymentsByCustomer,
  getPaymentInvoiceList,
  getPaymentTracker,getDistrictPaymentsByInvoice
} from "../controller/paymentController.js";

import {
  getLedger,
  getCustomerLedgerDetail,
  downloadLedgerExcel,getDistrictLedger,getDistrictLedgerClientDetail, downloadDistrictLedgerExcel,downloadInvoiceById
} from "../controller/ledgerController.js";

const router = express.Router();

// ==================== CUSTOMER ROUTES ====================
router.post("/customer", auth, createCustomer);
router.get("/customer/search", auth, searchCustomers);
router.get("/customer/:id", auth, getCustomer);

// ==================== INVOICE ROUTES ====================
// router.post("/invoice", auth, createInvoice);
// router.get("/invoice/detail/:invoice_id", auth, getInvoiceDetail);
// router.get("/invoice/customer/:customer_id", auth, getCustomerInvoices);
// router.get("/invoice/pending", auth, getPendingInvoices);

// ==================== PAYMENT ROUTES ====================
router.post("/payment", auth, createPayment);
router.get("/payment/list", auth, getPaymentInvoiceList);
router.get("/payment/invoice/:invoice_id", auth, getPaymentsByInvoice);

router.get("/payment/customer/:customer_id", auth, getPaymentsByCustomer);
router.get("/payment/tracker/:customer_id", auth, getPaymentTracker);

// ==================== LEDGER ROUTES ====================
router.get("/ledger", auth, getLedger);
router.get("/ledger/customer/:customer_id", auth, getCustomerLedgerDetail);
router.get("/ledger/download-excel", auth, downloadLedgerExcel);


router.get("/payment/invoice-dis/:invoice_id", auth, getDistrictPaymentsByInvoice);
router.get("/ledger/download-excel-district", auth,  downloadDistrictLedgerExcel);
router.get("/district", auth, getDistrictLedger);
router.get("/district/:customerId", auth, getDistrictLedgerClientDetail);



router.get("/invoice/:invoice_id/download",auth, downloadInvoiceById);
export default router;
