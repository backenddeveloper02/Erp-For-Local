import express from "express";
import {
  getTodayAuditItems,
  createDailyAudit,
  getMyAuditHistory,
  getAuditDetails,
  getPendingAuditReminders,
  submitMissingItemReason,
  getReviewAudits,
  reviewAudit,
} from "../controller/inventoryAuditController.js";

import { auth } from "../middlewares/authMiddleware.js"; // apna auth middleware path lagao

const router = express.Router();


router.get("/today-items", auth, getTodayAuditItems);


router.post("/create", auth, createDailyAudit);


router.get("/history", auth, getMyAuditHistory);


router.get(
  "/pending-reminders",
  auth,
  getPendingAuditReminders
);


router.get("/review-list", auth, getReviewAudits);


router.get("/:id", auth, getAuditDetails);


router.patch(
  "/reason/:audit_item_id",
  auth,
  submitMissingItemReason
);


router.patch("/review/:id", auth, reviewAudit);

export default router;
