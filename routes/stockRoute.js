import express from "express";
import multer from "multer";

import {
  getRetailInventory,
  getSingleStock,
  updateStockStatus,
  stockSummary,
  addStockIn,
  getStockItemsByCategory,
  getDistrictInventory,
  getDistrictStockItemsByCategory,
  uploadStockInItems,
  getItemQR,
  updateItemImage,
} from "../controller/stock.controller.js";

import {
  getOverallInventoryDashboard,
  getOverallCategoryItems,
  updateStockPricing,
  getHeadOfficeStock,
} from "../controller/headoffice/headInventoryController.js";

import { uploadInventoryFile } from "../middlewares/uploadchallan.js";

import { auth } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * ==========================================
 * MULTER
 * ==========================================
 */

const storage = multer.memoryStorage();

const upload = multer({
  storage,
});

/**
 * ==========================================
 * RETAIL INVENTORY
 * ==========================================
 */
router.get("/list", auth, getRetailInventory);

/**
 * ==========================================
 * DISTRICT INVENTORY
 * ==========================================
 */
router.get("/getdistrict", auth, getDistrictInventory);

/**
 * ==========================================
 * STOCK SUMMARY
 * ==========================================
 */
router.get("/summary", auth, stockSummary);

/**
 * ==========================================
 * CATEGORY ITEMS
 * ==========================================
 */
router.get("/category/:category", auth, getStockItemsByCategory);

/**
 * ==========================================
 * DISTRICT CATEGORY
 * ==========================================
 */
router.get(
  "/district/inventory/category/:category",
  auth,
  getDistrictStockItemsByCategory
);

/**
 * ==========================================
 * HEAD OFFICE
 * ==========================================
 */
router.get("/headoffice", auth, getHeadOfficeStock);
router.get("/inventory/dashboard", getOverallInventoryDashboard);

router.get(
  "/inventory/overall/category",
  getOverallCategoryItems
);

/**
 * ==========================================
 * ITEM QR
 * ==========================================
 */
router.get("/items/:itemId/qr", auth, getItemQR);

/**
 * ==========================================
 * UPDATE IMAGE
 * ==========================================
 */
router.patch(
  "/item/:itemId/image",
  upload.single("image"),
  updateItemImage
);

/**
 * ==========================================
 * STOCK IN
 * ==========================================
 */
router.post(
  "/stock-in",
  auth,
  upload.array("images"),
  addStockIn
);

router.post(
  "/inventory/stock-in/upload",
  auth,
  uploadInventoryFile.single("file"),
  uploadStockInItems
);

router.put(
  "/update-stock-pricing",
  updateStockPricing
);

/**
 * ==========================================
 * UPDATE STATUS
 * ==========================================
 */
router.put("/:id/status", auth, updateStockStatus);

/**
 * ==========================================
 * SINGLE STOCK - ALWAYS LAST
 * ==========================================
 */
router.get("/:id", auth, getSingleStock);
export default router;
