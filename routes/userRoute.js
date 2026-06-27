import express from "express";
import { getMyProfile, updateMyProfile } from "../controller/user.controller.js";
import { auth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// GET Profile
router.get("/GetMy", auth, getMyProfile);

// UPDATE Profile
router.put("/UpdateMy", auth, updateMyProfile);

export default router;