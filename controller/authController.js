import User from "../model/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import cloudinary from "../utils/cloudinary.js";

// Generate User Code
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

// REGISTER
export const register = async (req, res) => {
  try {
    const {
      email,
      username,
      phoneNumber,
      role,
      organizationLevel, // USE STRING (HEAD / DISTRICT / STORE)
      storeName,
      storeCode,
      password,
      isPoliceVerified,
    } = req.body;
    //  Required fields
    if (!email || !username || !role || !password || !organizationLevel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    //  VALID LOCATION TYPES
    const validLocations = ["HEAD", "DISTRICT", "STORE"];
     
    if (!validLocations.includes(organizationLevel)) {
      return res.status(400).json({
        error: "Invalid organization level",
      });
    }

    //  ROLE VALIDATION (FINAL LOGIC)
    if (role === "SUPER_ADMIN" && organizationLevel !== "HEAD") {
      return res.status(400).json({
        error: "Super Admin only allowed at HEAD",
      });
    }

    const allowedRoles = ["ADMIN", "INVENTORY_MANAGER", "SALES_MANAGER"];

    if (!["SUPER_ADMIN", ...allowedRoles].includes(role)) {
      return res.status(400).json({
        error: "Invalid role",
      });
    }

    //  Email check
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    //  Phone check
    if (phoneNumber) {
      const existingPhone = await User.findOne({
        where: { phoneNumber },
      });
      if (existingPhone) {
        return res.status(400).json({
          error: "Phone number already exists",
        });
      }
    }

    // Police Verification Validation
    if (isPoliceVerified === "true") {
      if (!req.files?.aadhaar || !req.files?.pan || !req.files?.policeDoc) {
        return res.status(400).json({
          error: "All documents required",
        });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userCode = await generateUserCode();

    //  File URLs
    let aadhaarUrl = null;
    let panUrl = null;
    let policeDocUrl = null;

    //  Upload to Cloudinary
    if (isPoliceVerified === "true") {
      const aadhaarRes = await cloudinary.uploader.upload(
        req.files.aadhaar[0].path,
        { resource_type: "auto" }
      );

      const panRes = await cloudinary.uploader.upload(
        req.files.pan[0].path,
        { resource_type: "auto" }
      );

      const policeDocRes = await cloudinary.uploader.upload(
        req.files.policeDoc[0].path,
        { resource_type: "auto" }
      );

      aadhaarUrl = aadhaarRes.secure_url;
      panUrl = panRes.secure_url;
      policeDocUrl = policeDocRes.secure_url;
    }

    //  JWT Token
    const token = jwt.sign(
      { email, role, userCode },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    //  Create User
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
      token,
      isPoliceVerified: isPoliceVerified === "true",
      aadhaarUrl,
      panUrl,
      policeDocUrl,
    });

    res.status(201).json({
      message: "User Registered",
      token,
      user,
    });

  } catch (err) {
    console.log("REGISTER ERROR:", err);
    res.status(500).json({
      error: err.message,
    });
  }
};

// LOGIN
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
    // if (!user.isActive) {
    //   return res.status(403).json({
    //     error: "Account is inactive",
    //   });
    // }

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