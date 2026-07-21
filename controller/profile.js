import User from "../model/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendEmail } from "../utils/sendEmail.js";
import sequelize from "../config/db.js";
import cloudinary from "../utils/cloudinary.js";
import { Op } from "sequelize";

// ================= GENERATE USER CODE =================
const generateUserCode = async () => {
  const year = new Date().getFullYear();

  const lastUser = await User.findOne({
    where: {
      userCode: {
        [Op.like]: `USR/${year}/%`,
      },
    },
    order: [["created_at", "DESC"]],
  });

  let nextNumber = 1;

  if (lastUser) {
    const lastPart = lastUser.userCode.split("/")[2];
    const lastNumber = parseInt(lastPart) || 0;
    nextNumber = lastNumber + 1;
  }

  return `USR/${year}/${String(nextNumber).padStart(3, "0")}`;
};

// ================= REGISTER =================
export const register = async (req, res) => {
  try {
    const {
      email,
      username,
      phoneNumber,
      role,
      organizationLevel,
      storeName,
      storeCode,
      password,
      isPoliceVerified,
    } = req.body;

    if (!email || !username || !role || !password || !organizationLevel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const validLocations = ["HEAD", "DISTRICT", "STORE"];
    if (!validLocations.includes(organizationLevel)) {
      return res.status(400).json({ error: "Invalid organization level" });
    }

    if (role === "SUPER_ADMIN" && organizationLevel !== "HEAD") {
      return res.status(400).json({
        error: "Super Admin only allowed at HEAD",
      });
    }

    const allowedRoles = ["ADMIN", "INVENTORY_MANAGER", "SALES_MANAGER"];
    if (!["SUPER_ADMIN", ...allowedRoles].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    if (phoneNumber) {
      const existingPhone = await User.findOne({ where: { phoneNumber } });
      if (existingPhone) {
        return res.status(400).json({ error: "Phone already exists" });
      }
    }

    if (isPoliceVerified === "true") {
      if (!req.files?.aadhaar || !req.files?.pan || !req.files?.policeDoc) {
        return res.status(400).json({ error: "All documents required" });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userCode = await generateUserCode();

    let aadhaarUrl = null;
    let panUrl = null;
    let policeDocUrl = null;

    if (isPoliceVerified === "true") {
      const aadhaarRes = await cloudinary.uploader.upload(req.files.aadhaar[0].path);
      const panRes = await cloudinary.uploader.upload(req.files.pan[0].path);
      const policeRes = await cloudinary.uploader.upload(req.files.policeDoc[0].path);

      aadhaarUrl = aadhaarRes.secure_url;
      panUrl = panRes.secure_url;
      policeDocUrl = policeRes.secure_url;
    }

    const user = await User.create({
      email,
      username,
      phoneNumber,
      role,
      organizationLevel,
      storeName,
      storeCode,
      password: hashedPassword,
      userCode,
      isPoliceVerified: isPoliceVerified === "true",
      aadhaarUrl,
      panUrl,
      policeDocUrl,
      isActive: true, 
    });

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        store_code: user.storeCode,
        organization_level: user.organizationLevel,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "User Registered",
      token,
      user,
    });

  } catch (err) {
    console.log("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};

// ================= LOGIN =================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    // Password check (ENABLE THIS)
    // const isMatch = await bcrypt.compare(password, user.password);
    // if (!isMatch) {
    //   return res.status(400).json({ error: "Invalid password" });
    // }

    //  FIXED FIELD NAME
    if (!user.isActive) {
      return res.status(403).json({
        error: "Account is inactive",
      });
    }

    //  CORRECT TOKEN
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        store_code: user.storeCode, 
        organization_level: user.organizationLevel,
        organization_id: user.organization_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        store_code: user.storeCode, 
        organization_level: user.organizationLevel,
        organization_id: user.organization_id,
      },
    });

  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};

// ================= FORGOT PASSWORD =================


export const forgotPassword = async (req, res) => {
  try {
    console.log("FORGOT PASSWORD CONTROLLER CALLED");

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate OTP
    const otp = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    console.log("Generated OTP:", otp);

    // Hash OTP
    const hashedOtp = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    // OTP Expiry (10 minutes)
    const otpExpire = new Date(Date.now() + 10 * 60 * 1000);

    // Save in DB
    await user.update({
      resetOtp: hashedOtp,
      resetOtpExpire: otpExpire,
      otpAttempts: 0,
    });

    console.log("OTP Saved Successfully");

    // TODO: Send OTP via email here

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      otp, // Remove this in production
    });

  } catch (error) {
    console.error("FORGOT PASSWORD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Forgot password failed",
      error: error.message,
    });
  }
};

// ================= VERIFY OTP =================
export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const hashedOtp = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    if (
      user.resetOtp !== hashedOtp ||
      !user.resetOtpExpire ||
      new Date() > new Date(user.resetOtpExpire)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });

  } catch (error) {
    console.error("VERIFY OTP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
      error: error.message,
    });
  }
};

// ================= RESET PASSWORD =================
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and new password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const hashedOtp = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    if (
      user.resetOtp !== hashedOtp ||
      !user.resetOtpExpire ||
      new Date() > new Date(user.resetOtpExpire)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await user.update({
      password: hashedPassword,
      resetOtp: null,
      resetOtpExpire: null,
      otpAttempts: 0,
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successful",
    });

  } catch (error) {
    console.error("RESET PASSWORD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Password reset failed",
      error: error.message,
    });
  }
};
// ================= PROFILE HELPER =================
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: "user_profiles",
        transformation: [
          { width: 500, height: 500, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    ).end(buffer);
  });
};

export const setProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 🚫 Prevent multiple profile set
    if (user.is_profile_set) {
      return res.status(400).json({
        error: "Profile already set. Use update profile API."
      });
    }

    const { name, phone } = req.body;

    let imageUrl = null;

    // ✅ File upload (diskStorage → path)
    if (req.file) {
      if (!req.file.path) {
        return res.status(400).json({
          error: "File upload failed. Path missing."
        });
      }

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "user_profiles",
        transformation: [
          { width: 500, height: 500, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" }
        ]
      });

      imageUrl = result.secure_url;
    }

    // ✅ Update fields
    user.username = name;
    user.phoneNumber = phone;
    user.profile_image = imageUrl;
    user.is_profile_set = true;

    await user.save();

    // ✅ Clean response
    return res.status(200).json({
      message: "Profile set successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.username,
        phone: user.phoneNumber,
        profile_image: user.profile_image,
        store_code: user.storeCode,
        organization_level: user.organizationLevel,
        role: user.role,
      }
    });

  } catch (err) {
    console.log("SET PROFILE ERROR:", err);

    return res.status(500).json({
      error: err.message || "Internal server error"
    });
  }
};

// ================= UPDATE PROFILE =================
export const updateProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ❌ image required
    if (!req.file || !req.file.path) {
      return res.status(400).json({
        success: false,
        message: "Profile image is required",
      });
    }

    // ✅ Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "user_profiles",
    });

    // ✅ Save only image
    user.profile_image = result.secure_url;

    // optional (first time profile set)
    user.is_profile_set = true;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile image updated successfully",
      data: {
        id: user.id,
        profile_image: user.profile_image,
      },
    });

  } catch (err) {
    console.log("UPDATE PROFILE IMAGE ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};
// ================= GET PROFILE =================
export const getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ["password"] }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      user,
      last_password_change: null   
    });

  } catch (err) {
    console.log("GET PROFILE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};
