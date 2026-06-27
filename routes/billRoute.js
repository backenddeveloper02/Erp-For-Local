import express from "express";
import { createInvoiceFromBill,createBill ,scanBillingItem,createManualBillingEntry} from "../controller/billingController.js";
import { auth } from "../middlewares/authMiddleware.js"; // apna auth middleware path lagao
const router = express.Router();
router.post("/create-bill",auth, createBill);
router.get("/billing/scan-item/:code", auth, scanBillingItem);
router.post("/manual-entry", auth, createManualBillingEntry);
export default router;
