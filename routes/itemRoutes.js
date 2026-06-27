import express from "express";
import {
  addItem,
  getItems,
  getItemsByLevel,
  getChildItems,
} from "../controller/itemController.js";

import { auth } from "../middlewares/authMiddleware.js";
import { checkRole } from "../middlewares/roleCheck.js";

const router = express.Router();

router.post("/add", auth, checkRole(["admin", "manager"]), addItem);
router.get("/", auth, checkRole(["admin", "manager", "sales_girl"]), getItems);
router.get("/level/:level", auth, checkRole(["admin"]), getItemsByLevel);
// router.get("/child", auth, checkRole(["admin", "manager"]), getChildItems);

export default router;