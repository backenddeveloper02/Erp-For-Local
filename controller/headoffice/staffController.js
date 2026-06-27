import sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";
import User from "../../model/user.js";
import bcrypt from "bcrypt";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import cloudinary from "../../utils/cloudinary.js";



/**
 *  GET STAFF + STATS 
 */
export const getStaffWithStats = async (req, res) => {
  try {
    const {
      search = "",
      role,
      status,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const offset = (pageNum - 1) * limitNum;

    let whereClause = `WHERE 1=1`;
    const replacements = {
      limit: limitNum,
      offset,
    };

    if (search) {
      whereClause += `
        AND (
          LOWER(name) LIKE LOWER(:search)
          OR LOWER(email) LIKE LOWER(:search)
          OR LOWER(user_code) LIKE LOWER(:search)
          OR LOWER(address) LIKE LOWER(:search)
        )
      `;
      replacements.search = `%${search}%`;
    }

    if (role) {
      whereClause += ` AND role = :role`;
      replacements.role = role;
    }

    if (status === "active") {
      whereClause += ` AND is_active = true`;
    } else if (status === "inactive") {
      whereClause += ` AND is_active = false`;
    }

    const data = await sequelize.query(
      `
      SELECT 
        id,
        username,
        email,
        address,
        phone_number,
        store_name,
        user_code,
        role,
        is_police_verified,
        aadhaar_url,
        pan_url,
        police_doc_url,
        store_code,
        is_active,
        created_at
      FROM public.users
      ${whereClause}
      ORDER BY id DESC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const countResult = await sequelize.query(
      `
      SELECT COUNT(*) FROM public.users
      ${whereClause}
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const total = parseInt(countResult[0].count);

    const stats = await sequelize.query(
      `
      SELECT 
        COUNT(*) AS total_staff,
        COUNT(*) FILTER (WHERE is_active = true) AS active,
        COUNT(*) FILTER (WHERE is_active = false) AS on_leave,
        COUNT(DISTINCT role) AS departments
      FROM public.users
      ${whereClause}
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    res.json({
      success: true,
      stats: stats[0],
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 *  EXPORT STAFF (EXCEL)
 */
export const exportStaffExcel = async (req, res) => {
  try {
    const staff = await sequelize.query(`
      SELECT 
        id,
        name AS username,
        email,
        phone_number,
        store_name,
        user_code,
        role,
        is_police_verified,
        store_code,
        is_active,
        created_at
      FROM public.users   
      ORDER BY id DESC
    `, { type: QueryTypes.SELECT });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Staff Report");

    //  TITLE
    sheet.mergeCells("A1:K1");
    sheet.getCell("A1").value = "Staff Management Report";
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.addRow([]);

    //  HEADER
    const header = [
      "ID",
      "Name",
      "Email",
      "Phone",
      "Store",
      "Employee Code",
      "Role",
      "Police Verified",
      "Store Code",
      "Status",
      "Created At"
    ];

    sheet.addRow(header);
    sheet.getRow(3).font = { bold: true };

    //  DATA
    staff.forEach((s) => {
      sheet.addRow([
        s.id,
        s.username,
        s.email,
        s.phone_number,
        s.store_name,
        s.user_code,
        s.role,
        s.is_police_verified ? "Yes" : "No",
        s.store_code,
        s.is_active ? "Active" : "On Leave",
        s.created_at ? new Date(s.created_at).toLocaleString() : ""
      ]);
    });

    sheet.columns.forEach(col => col.width = 20);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=staff-report.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 *  GET STAFF BY ORGANIZATION LEVEL (DISTRICT / STORE)
 */
export const getStaffByLevel = async (req, res) => {
  try {
    const {
      level,        // DISTRICT / STORE / HEAD
      search = "",
      page = 1,
      limit = 10,
    } = req.query;

    if (!level) {
      return res.status(400).json({
        error: "Level is required (DISTRICT / STORE / HEAD)",
      });
    }

    const offset = (page - 1) * limit;

    // ================= WHERE CLAUSE =================
    let whereClause = `WHERE 1=1`;

    const lvl = level.toLowerCase();

    //  LEVEL FILTER (SMART MAPPING)
    if (lvl === "store") {
      whereClause += `
        AND LOWER(organization_level) IN ('store', 'retail')
      `;
    } else if (lvl === "district") {
      whereClause += `
        AND LOWER(organization_level) = 'district'
      `;
    } else if (lvl === "head") {
      whereClause += `
        AND LOWER(organization_level) IN ('head', 'head_office')
      `;
    } else {
      return res.status(400).json({
        error: "Invalid level. Use DISTRICT / STORE / HEAD",
      });
    }

    // 🔍 SEARCH FILTER
    if (search) {
      whereClause += `
        AND (
          LOWER(name) LIKE LOWER('%${search}%')
          OR LOWER(email) LIKE LOWER('%${search}%')
          OR LOWER(user_code) LIKE LOWER('%${search}%')
        )
      `;
    }

    // ================= DATA QUERY =================
    const data = await sequelize.query(`
      SELECT 
        id,
        username,
        email,
        phone_number,
        store_name,
        user_code,
        role,
        is_police_verified,
        store_code,
        is_active,
        created_at,
        organization_level
      FROM public.users
      ${whereClause}
      ORDER BY id DESC
      LIMIT ${limit} OFFSET ${offset}
    `, { type: QueryTypes.SELECT });

    // ================= COUNT QUERY =================
    const countResult = await sequelize.query(`
      SELECT COUNT(*) FROM public.users
      ${whereClause}
    `, { type: QueryTypes.SELECT });

    const total = parseInt(countResult[0].count);

    // ================= RESPONSE =================
    res.json({
      success: true,
      data,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    });

  } catch (err) {
    console.error("GET STAFF BY LEVEL ERROR:", err);
    res.status(500).json({
      error: err.message,
    });
  }
};
/**
 *  GET SINGLE STAFF
 */
// export const getStaffById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const user = await User.findByPk(id);

//     if (!user) {
//       return res.status(404).json({ error: "Staff not found" });
//     }

//     res.json({ success: true, data: user });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };


/**
 *  ADD EMPLOYEE
 */

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

export const getOrganizationsByLevel = async (req, res) => {
  try {
    const { level } = req.query;

    if (!level) {
      return res.status(400).json({
        success: false,
        message: "level is required",
      });
    }

    let organizationLevel = "";

    if (level === "retail") organizationLevel = "Retail";
    else if (level === "district") organizationLevel = "District";
    else if (level === "head") organizationLevel = "Head";
    else {
      return res.status(400).json({
        success: false,
        message: "Invalid level",
      });
    }

    const data = await sequelize.query(
      `
      SELECT
        id,
        store_name,
        store_code,
        organization_level,
        state,
        district,
        district_id,
        address,
        phone_number
      FROM public.stores
      WHERE organization_level = :organizationLevel
      AND is_active = true
      ORDER BY store_name ASC
      `,
      {
        replacements: { organizationLevel },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};




export const addEmployee = async (req, res) => {
  try {
    // ================= BODY =================
    const {
      email,
      username,
      password,
      role,
      phoneNumber,
      organization_id,
      address,
    } = req.body;

    // ================= FILES =================
    const { aadhaar, pan, policeDoc } = req.files || {};

    // ================= VALIDATION =================
    if (!email || !username || !password || !role || !organization_id) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    const allowedRoles = [
      "ADMIN",
      "INVENTORY_MANAGER",
      "SALES_MANAGER",
      "SUPER_ADMIN",
    ];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        error: "Invalid role",
      });
    }

    // FILE VALIDATION (MANDATORY)
    if (!aadhaar || !pan || !policeDoc) {
      return res.status(400).json({
        error: "Aadhaar, PAN, and Police document are required",
      });
    }

    // ================= STORE FETCH =================
    const selectedStoreResult = await sequelize.query(
      `
      SELECT id, store_code, store_name, organization_level, address
      FROM public.stores
      WHERE id = :organization_id
      AND is_active = true
      LIMIT 1
      `,
      {
        replacements: { organization_id },
        type: QueryTypes.SELECT,
      }
    );

    const selectedStore = selectedStoreResult[0];

    if (!selectedStore) {
      return res.status(404).json({
        error: "Selected store/district not found",
      });
    }

    // SUPER ADMIN CHECK
    if (
      role === "SUPER_ADMIN" &&
      selectedStore.organization_level !== "Head"
    ) {
      return res.status(400).json({
        error: "Super Admin only allowed at HEAD",
      });
    }

    // ================= DUPLICATE CHECK =================
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        error: "Email already exists",
      });
    }

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

    // ================= FILE UPLOAD =================
    const aadhaarRes = await cloudinary.uploader.upload(
      aadhaar[0].path,
      { resource_type: "auto" }
    );

    const panRes = await cloudinary.uploader.upload(
      pan[0].path,
      { resource_type: "auto" }
    );

    const policeRes = await cloudinary.uploader.upload(
      policeDoc[0].path,
      { resource_type: "auto" }
    );

    // ================= PASSWORD HASH =================
    const hashedPassword = await bcrypt.hash(password, 10);
    const userCode = await generateUserCode();

    // ================= TOKEN =================
    const token = jwt.sign(
      {
        email,
        role,
        userCode,
        organization_id: selectedStore.id,
        store_code: selectedStore.store_code,
        organization_level: selectedStore.organization_level,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // ================= CREATE USER =================
    const user = await User.create({
      email,
      username,
      password: hashedPassword,
      role,

      storeCode: selectedStore.store_code,
      storeName: selectedStore.store_name,
      organizationLevel: selectedStore.organization_level,
      organization_id: selectedStore.id,

      phoneNumber,
      address: address || selectedStore.address || null,
      userCode,

      // ALWAYS TRUE
      isPoliceVerified: true,

      aadhaarUrl: aadhaarRes.secure_url,
      panUrl: panRes.secure_url,
      policeDocUrl: policeRes.secure_url,

      isActive: true,
    });

    // ================= RESPONSE =================
    return res.status(201).json({
      success: true,
      message: "Employee added successfully",
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        storeCode: user.storeCode,
        phoneNumber: user.phoneNumber,
        address: user.address,
        storeName: user.storeName,
        organizationLevel: user.organizationLevel,
        organization_id: user.organization_id,
        userCode: user.userCode,
        isPoliceVerified: user.isPoliceVerified,
        aadhaarUrl: user.aadhaarUrl,
        panUrl: user.panUrl,
        policeDocUrl: user.policeDocUrl,
        isActive: user.isActive,
      },
      token,
    });
  } catch (err) {
    console.log("ADD EMPLOYEE ERROR:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
};


// /**
//  *  UPDATE EMPLOYEE
//  */
export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({
        error: "Staff not found",
      });
    }

    // ================= ALLOWED FIELDS =================
    const allowedFields = [
      "username",
      "phoneNumber",
      "address",
      "role",
      "isActive",
    ];

    const updates = {};

    // ================= PICK ONLY SENT FIELDS =================
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // ================= OPTIONAL: PASSWORD UPDATE =================
    if (req.body.password) {
      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      updates.password = hashedPassword;
    }

    // ================= OPTIONAL: FILE UPDATE =================
    if (req.files) {
      const { aadhaar, pan, policeDoc } = req.files;

      if (aadhaar) {
        const resUpload = await cloudinary.uploader.upload(
          aadhaar[0].path,
          { resource_type: "auto" }
        );
        updates.aadhaarUrl = resUpload.secure_url;
      }

      if (pan) {
        const resUpload = await cloudinary.uploader.upload(
          pan[0].path,
          { resource_type: "auto" }
        );
        updates.panUrl = resUpload.secure_url;
      }

      if (policeDoc) {
        const resUpload = await cloudinary.uploader.upload(
          policeDoc[0].path,
          { resource_type: "auto" }
        );
        updates.policeDocUrl = resUpload.secure_url;
      }
    }

    // ================= UPDATE ONLY PROVIDED FIELDS =================
    await user.update(updates);

    res.json({
      success: true,
      message: "Employee updated successfully",
      data: user,
    });
  } catch (err) {
    console.log("UPDATE EMPLOYEE ERROR:", err);
    res.status(500).json({
      error: err.message,
    });
  }
};

/**
 *  DELETE EMPLOYEE
 */
export const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "Staff not found" });
    }

    await user.destroy();

    res.json({
      success: true,
      message: "Employee deleted"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/**
 *  TOGGLE ACTIVE / LEAVE
 */
export const toggleEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "Staff not found" });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: "Status updated",
      isActive: user.isActive
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
