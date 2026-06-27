import express from "express";
import {
  startLiveTracking,
  updateLiveLocation,
  getTransferRoute,
  stopLiveTracking,getTransferLiveLocation
} from "../controller/transferTracking.controller.js";

const router = express.Router();

router.post("/:id/start", startLiveTracking);
router.patch("/:id/location", updateLiveLocation);
router.get("/:id/route", getTransferRoute);
router.post("/:id/stop", stopLiveTracking);
router.get("/:id/live-location", getTransferLiveLocation);
export default router;