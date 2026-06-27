// routes/tracker.routes.js

import express from "express";
import {auth} from "../middlewares/authMiddleware.js";

import {
  getTrackerItems,
  getItemTrackerBatches,
  distributeBatch,
  getBatchFinalDestinations,
  getBatchNodeRoute,searchBatchTracker,getAllTrackerBatches,getBatchMovementHistory,getBatchMovementHistoryByBatchNo,getItemFinalDestinations
} from "../controller/headoffice/itemtrackker.js";
const router = express.Router();

// router.use(authMiddleware);

// item list/search
router.get("/items", auth,getTrackerItems);

// item ke root batches
router.get("/items/:item_id/batches", auth,getItemTrackerBatches);

// manual/test distribution
router.post("/batches/distribute",auth, distributeBatch);

// batch final current locations  use this - for get 
router.get("/batches/:batch_id/final-destinations",auth, getBatchFinalDestinations);

// batch route/timeline
router.get("/batches/:batch_id/route",auth, getBatchNodeRoute);


//this is for finding all batche according to 
router.get("/batches", getAllTrackerBatches);
router.get("/batches/search", searchBatchTracker);

router.get("/batches/:batch_id/history", getBatchMovementHistory);
router.get("/history", getBatchMovementHistoryByBatchNo);





router.get("/items/:item_id/final-destinations", getItemFinalDestinations);
export default router;
