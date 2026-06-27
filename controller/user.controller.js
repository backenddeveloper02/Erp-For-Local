import User from "../model/user.js";


export const getMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const user = await User.findByPk(userId, {
      attributes: [
        "id",
        "name",
        "email",
        "username",
        "phone_number",
        "role",
        "organization_id",
        "store_code",
        "store_name",
        "district_code",
        "state_code",
        "organization_level",
        "user_code",
        "is_police_verified",
        "police_doc_url",
        "aadhaar_url",
        "pan_url",
        "is_active",
      ],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error("getMyProfile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
    });
  }
};

// ==============================
// UPDATE MY PROFILE
// ==============================
export const updateMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const {
      name,
      username,
      phone_number,
      aadhaar_url,
      pan_url,
      police_doc_url,
    } = req.body;

    const existingUser = await User.findByPk(userId);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    // ==============================
    // Check username uniqueness
    // ==============================
    if (username && username !== existingUser.username) {
      const usernameExists = await User.findOne({
        where: { username },
      });

      if (usernameExists) {
        return res.status(400).json({
          success: false,
          message: "Username already exists",
        });
      }
    }

    // ==============================
    // Check phone uniqueness
    // ==============================
    if (phone_number && phone_number !== existingUser.phone_number) {
      const phoneExists = await User.findOne({
        where: { phone_number },
      });

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: "Phone number already exists",
        });
      }
    }

    // ==============================
    // Update only allowed fields
    // ==============================
    existingUser.name = name ?? existingUser.name;
    existingUser.username = username ?? existingUser.username;
    existingUser.phone_number = phone_number ?? existingUser.phone_number;
    existingUser.aadhaar_url = aadhaar_url ?? existingUser.aadhaar_url;
    existingUser.pan_url = pan_url ?? existingUser.pan_url;
    existingUser.police_doc_url = police_doc_url ?? existingUser.police_doc_url;

    await existingUser.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        username: existingUser.username,
        phone_number: existingUser.phone_number,
        role: existingUser.role,
        organization_id: existingUser.organization_id,
        store_code: existingUser.store_code,
        store_name: existingUser.store_name,
        district_code: existingUser.district_code,
        state_code: existingUser.state_code,
        organization_level: existingUser.organization_level,
        user_code: existingUser.user_code,
        is_police_verified: existingUser.is_police_verified,
        police_doc_url: existingUser.police_doc_url,
        aadhaar_url: existingUser.aadhaar_url,
        pan_url: existingUser.pan_url,
        is_active: existingUser.is_active,
      },
    });
  } catch (error) {
    console.error("updateMyProfile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message,
    });
  }
};