import express from "express";
import {auth} from "../middlewares/authMiddleware.js";
import {
  getDistrictOwnRecentActivities,
  getHeadOwnRecentActivities,getRetailOwnRecentActivities
} from "../controller/activityController.js";

const router = express.Router();

router.get(
  "/district/own",
  auth,
  getDistrictOwnRecentActivities
);

router.get(
  "/head/own",
  auth,
  getHeadOwnRecentActivities
);
router.get(
  "/retail/own",
  auth,
  getRetailOwnRecentActivities
);

export default router;
