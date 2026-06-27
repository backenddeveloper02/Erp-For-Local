import express from "express";
import {

  getDistrictInventory,
  getRetailStores,
  getStoreInventory,
  getStoreDashboard,createStore,mapStoresToDistrict,getStoreCategoryItems,getDistrictCategoryItems
} from "../controller/headoffice/storeManagementFlowController.js";
import { auth } from "../middlewares/authMiddleware.js";
const router = express.Router();
router.get("/district/:store_code/inventory", getDistrictInventory);
router.get("/district/:store_code/stores", getRetailStores);
router.get(
  "/district/:store_code/category-items",
  getDistrictCategoryItems
);

// Store inventory
router.get("/store/:store_code/inventory", getStoreInventory);
router.get(
  "/store/:store_code/category-items",
  getStoreCategoryItems
);

// Summary
router.get("/dashboard", getStoreDashboard);

// ================= NEW ROUTES (ADDED) =================

//  Create Store (Retail + District)
router.post("/create", createStore);

// Get Unassigned Retail Stores (for dropdown)
router.post("/map-stores-to-district", mapStoresToDistrict);

export default router;