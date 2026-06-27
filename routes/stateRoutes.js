import express from "express";
import {
  addDistrict,
  getDistricts,
  getDistrictItems,
} from "../controllers/stateController.js";

import { fakeAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

//  STATE ROUTES
router.post("/add-district", fakeAuth, addDistrict);
router.get("/districts", fakeAuth, getDistricts);
router.get("/items", fakeAuth, getDistrictItems);

export default router;