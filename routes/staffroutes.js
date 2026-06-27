import express from "express";
import {
  getStaffWithStats,
  getStaffByLevel,
  addEmployee,
  deleteEmployee,
  toggleEmployeeStatus,
  exportStaffExcel,getOrganizationsByLevel,updateEmployee
} from "../controller/headoffice/staffController.js";

import { upload2 } from "../middlewares/upload2.js";

const router = express.Router();



//  Combined API
router.get("/get", getStaffWithStats);

// Level filter
router.get("/by-level", getStaffByLevel);

// Export (static route)
router.get("/export", exportStaffExcel);

// ADD EMPLOYEE (WITH MULTER FIX)
router.post(
  "/add-emp",
  upload2.fields([
    { name: "aadhaar", maxCount: 1 },
    { name: "pan", maxCount: 1 },
    { name: "policeDoc", maxCount: 1 },
  ]),
  addEmployee
);

// Update
router.put("/:id", updateEmployee);

//  Delete
router.delete("/:id", deleteEmployee);

// Toggle Status
router.patch("/:id/status", toggleEmployeeStatus);

// Get by ID (ALWAYS LAST)
// router.get("/:id", getStaffById);
router.get("/organizations-by-level", getOrganizationsByLevel);
export default router;
