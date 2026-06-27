import express from "express";
import { auth } from "../middlewares/authMiddleware.js";

import {
  getDistrictRetailAudits,
  getDistrictRetailAuditDetails,
  downloadDistrictRetailAudit,
  getHeadDistrictAudits,
  getHeadDistrictAuditDetails,
  downloadHeadDistrictAudit,
  getHeadDistrictStoreAudits,
  getHeadDistrictStoreAuditDetails,
  downloadHeadDistrictStoreAudit,
  getHeadRetailAudits,
} from "../controller/completeAuditController.js";

const router = express.Router();

/* =========================================================
   DISTRICT - RETAIL AUDIT REVIEW
========================================================= */

// District apne aligned retail stores ke audits ki list dekhega
router.get(
  "/district/retail-audits",
  auth,
  getDistrictRetailAudits
);

// District kisi ek retail audit ka full detail dekhega
router.get(
  "/district/retail-audits/:id",
  auth,
  getDistrictRetailAuditDetails
);

// District audit report download karega
router.get(
  "/district/retail-audits/:id/download",
  auth,
  downloadDistrictRetailAudit
);
router.get("/head/district-audits", auth, getHeadDistrictAudits);

router.get("/head/district-audits/:id", auth, getHeadDistrictAuditDetails);

router.get("/head/district-audits/:id/download", auth, downloadHeadDistrictAudit);
router.get(
  "/head/district/:district_id/store-audits",
  auth,
  getHeadDistrictStoreAudits
);

router.get(
  "/head/district/:district_id/store-audits/:id",
  auth,
  getHeadDistrictStoreAuditDetails
);

router.get(
  "/head/district/:district_id/store-audits/:id/download",
  auth,
  downloadHeadDistrictStoreAudit
);
router.get(
  "/head/district/:district_code/store-audits",
  auth,
  getHeadDistrictStoreAudits
);

router.get(
  "/head/district/:district_code/store-audits/:id",
  auth,
  getHeadDistrictStoreAuditDetails
);

router.get(
  "/head/district/:district_code/store-audits/:id/download",
  auth,
  downloadHeadDistrictStoreAudit
);
router.get("/head/retail-audits", auth, getHeadRetailAudits);
export default router;