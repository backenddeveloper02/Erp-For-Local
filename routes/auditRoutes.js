import express from "express";
import { auth } from "../middlewares/authMiddleware.js";
import { auditController } from "../controller/auditController.js";

const router = express.Router();

router.post("/audit", auth, auditController);

export default router;