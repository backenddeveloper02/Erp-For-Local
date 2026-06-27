import express from "express";
import {
  getCompleteDashboard,
  getStoreCustomerLedger,
  getCustomerInvoices,
  getInvoicePayments,
  exportDashboardAndLedgerExcel,
  exportLedgerExcel,
  downloadInvoicePdf,
} from "../controller/headoffice/headLedgerController.js";

const router = express.Router();

// 🔹 Ledger Main (All Stores)
router.get("/stores", getCompleteDashboard);

// 🔹 Store → Customers
router.get("/store/:store_code/customers", getStoreCustomerLedger);

// 🔹 Customer → Invoices
router.get("/customer/:customer_id/invoices", getCustomerInvoices);

// 🔹 Invoice → Payment History
router.get("/invoice/:invoice_id/payments", getInvoicePayments);
router.get("/ledger/:store_code", exportLedgerExcel);
router.get(
  "/invoice/:invoice_id/download-pdf",
  downloadInvoicePdf
);
router.get("/dashboard/export-complete", exportDashboardAndLedgerExcel);
export default router;
