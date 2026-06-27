import express from "express";
import {
  getDistrictRetailStores,
  getDistrictStoreDetail,
  getDistrictStoreCategoryItems,getDistrictReportsAnalytics
} from "../controller/districtController.js";

import { auth } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * 1) District -> All Connected Retail Stores
 * GET /api/district/store-management
 */
router.get(
  "/district/store-management",
  auth,
  getDistrictRetailStores
);

/**
 * 2) Click Store -> Store Detail + Stock Summary + Categories
 * GET /api/district/store-management/:storeId
 */
router.get(
  "/district/store-management/:storeId",
  auth,
  getDistrictStoreDetail
);

/**
 * 3) Click Category -> All Items of Selected Store Category
 * GET /api/district/store-management/:storeId/categories/:category/items
 */
router.get(
  "/district/store-management/:storeId/categories/:category/items",
  auth,
  getDistrictStoreCategoryItems
);
router.get('/report-analysis',auth,getDistrictReportsAnalytics)

export default router;