import express from "express";
import { register, login } from "../controller/authController.js";
import { upload } from "../middlewares/upload.js"; 

const router = express.Router();

/*
    @desc    Register a new user
    @route   POST /api/auth/register
    @access  Public
*/
router.post(
  "/register",
  upload.fields([
    { name: "policeDoc", maxCount: 1 },
    { name: "aadhaar", maxCount: 1 },
    { name: "pan", maxCount: 1 },
    
  ]),
  register
);

/*
  @desc    Login user
  @route   POST /api/auth/login
  @access  Public
*/
router.post("/login", login);

export default router;