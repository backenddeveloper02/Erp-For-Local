import express from "express";
import {
  register,
  login,
  forgotPassword,
  verifyOtp,
  resetPassword,

  //  PROFILE APIs (ADD KIYA)
  setProfile,
  updateProfile,
  getProfile,

} from "../controller/profile.js";

import { upload2 } from "../middlewares/upload2.js";

//  AUTH MIDDLEWARE 
import { auth } from "../middlewares/authMiddleware.js";

const router = express.Router();

/*
  ================= AUTH APIs =================
*/

/*
  @desc    Register a new user
  @route   POST /api/auth/register
  @access  Public
*/
router.post(
  "/register",
  upload2.fields([
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

/*
  @desc    Send OTP to email
  @route   POST /api/auth/forgot-password
  @access  Public
*/
router.post("/forgot-password", forgotPassword);

/*
  @desc    Verify OTP
  @route   POST /api/auth/verify-otp
  @access  Public
*/
router.post("/verify-otp", verifyOtp);

/*
  @desc    Reset password
  @route   POST /api/auth/reset-password
  @access  Public
*/
router.post("/reset-password", resetPassword);


/*
  ================= PROFILE APIs =================
*/

/*
  @desc    Set profile (ONLY ONCE)
  @route   POST /api/auth/set-profile
  @access  Private
*/
router.post(
  "/set-profile",
  auth,
  upload2.single("file"),   
  setProfile
);

/*
  @desc    Update profile
  @route   PUT /api/auth/update-profile
  @access  Private
*/
router.put(
  "/update-profile",
  auth,
  upload2.single("file"),
  updateProfile
);

/*
  @desc    Get profile
  @route   GET /api/auth/profile
  @access  Private
*/
router.get(
  "/profile",
  auth,
  getProfile
);

export default router;