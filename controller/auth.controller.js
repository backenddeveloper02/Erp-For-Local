// // const { User, Role } = require("../../model/SQL_Model"); 
// const jwt = require("jsonwebtoken");
// const bcrypt = require("bcrypt");
// const { Op, fn, col, where } = require("sequelize");
// const sgMail = require("@sendgrid/mail");
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);
// const { User, Role, Branch,Notification,
//   PasswordReset,
//    SecurityActivity } = require("../../model/SQL_Model");
//   const RecentActivity = require("../../model/SQL_Model/recentactivity");

// const axios = require("axios");

// async function getLocationFromIP(ip) {
//   try {
//     if (!ip || ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") {
//       return "Localhost";
//     }

//     const cleanIp = ip.startsWith("::ffff:") ? ip.replace("::ffff:", "") : ip;

//     const { data } = await axios.get(`http://ip-api.com/json/${cleanIp}`);

//     if (data && data.status === "success") {
//       return `${data.city || ""}${data.regionName ? ", " + data.regionName : ""}${data.country ? ", " + data.country : ""}`.trim();
//     }

//     return "Unknown Location";
//   } catch (error) {
//     console.error("IP location fetch error:", error.message);
//     return "Unknown Location";
//   }
// }

// exports.register = async (req, res) => {
//   try {
//     const { name, email, password, role_name, branch_id } = req.body;

//     if (!name || !email || !password || !role_name) {
//       return res.status(400).json({ error: "All fields required" });
//     }

//     const role = await Role.findOne({ where: { name: role_name } });
//     if (!role) return res.status(400).json({ error: "Invalid role" });

//     if (role_name !== "super_admin") {
//       if (!branch_id) {
//         return res.status(400).json({ error: "Branch required" });
//       }

//       const branchExists = await Branch.findByPk(branch_id);
//       if (!branchExists) {
//         return res.status(400).json({ error: "Invalid branch" });
//       }
//     }

//     const exists = await User.findOne({ where: { email } });
//     if (exists) return res.status(400).json({ error: "Email exists" });

//     // HASH PASSWORD
//     const hashedPassword = await bcrypt.hash(password, 10);

//     const user = await User.create({
//       name,
//       email,
//       password: hashedPassword,
//       role_id: role.id,
//       branch_id: branch_id || null
//     });

//     res.status(201).json({
//       message: "User registered",
//       user
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };
// exports.login = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     if (!email || !password) {
//       return res.status(400).json({ error: "Email & password required" });
//     }

//     const user = await User.findOne({
//       where: { email },
//       include: {
//         model: Role,
//         as: "role",
//         attributes: ["name"],
//       },
//     });

//     if (!user) {
//       return res.status(401).json({ error: "User not found" });
//     }

//     if (!user.is_active) {
//       return res.status(403).json({ error: "Account not active" });
//     }

//     // const match = await user.validatePassword(password);
//     // if (!match) {
//     //   return res.status(401).json({ error: "Invalid password" });
//     // }

//     const roleName = user.role?.name;

//     const superRoles = [
//       "super_admin",
//       "super_stock",
//       "super_sales_manager",
//       "super_inventory_manager"
//     ];

//     let branchIds = [];

//     if (superRoles.includes(roleName)) {
//       branchIds = ["ALL"];
//     } else {
//       try {
//         const userBranches = await UserBranch.findAll({
//           where: { user_id: user.id },
//           attributes: ["branch_id"],
//         });

//         branchIds = userBranches.map((b) => b.branch_id);
//       } catch (err) {
//         if (user.branch_id) {
//           branchIds = [user.branch_id];
//         }
//       }

//       if (!branchIds.length) {
//         return res.status(403).json({
//           error: "No branch assigned to user",
//         });
//       }
//     }

//     const loginTime = new Date();

//     const deviceName = req.headers["user-agent"] || "Unknown Device";
//     const ipAddress =
//       req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
//       req.socket?.remoteAddress ||
//       req.ip ||
//       null;

//     const location = await getLocationFromIP(ipAddress);

//     await user.update({
//       last_login: loginTime
//     });

//     const token = jwt.sign(
//       {
//         id: user.id,
//         role: roleName,
//         branches: branchIds,
//       },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     await SecurityActivity.update(
//       {
//         is_active: false,
//         logout_at: loginTime
//       },
//       {
//         where: {
//           user_id: user.id,
//           activity_type: "login",
//           is_active: true,
//           device_name: deviceName,
//           ip_address: ipAddress
//         }
//       }
//     );

//     await SecurityActivity.create({
//       user_id: user.id,
//       activity_type: "login",
//       device_name: deviceName,
//       ip_address: ipAddress,
//       location,
//       logged_in_at: loginTime,
//       session_token: token,
//       is_active: true,
//       logout_at: null
//     });

//     res.json({
//       token,
//       user: {
//         id: user.id,
//         name: user.name,
//         email: user.email,
//         role: roleName,
//         branches: branchIds,
//         lastLogin: loginTime,
//       },
//     });

//   } catch (err) {
//     console.error("LOGIN ERROR:", err);
//     res.status(500).json({ error: err.message });
//   }
// };


// function generateOTP(length = 6) {
//   let otp = "";
//   for (let i = 0; i < length; i++) {
//     otp += Math.floor(Math.random() * 10);
//   }
//   return otp;
// }

// function generateOTP(length = 6) {
//   let otp = "";
//   for (let i = 0; i < length; i++) {
//     otp += Math.floor(Math.random() * 10);
//   }
//   return otp;
// }

// function getApproverType(roleName) {
//   if (roleName === "admin") {
//     return "super_admin";
//   }
//   return "branch_admin";
// }

// async function getActiveSuperAdmins() {
//   return User.findAll({
//     where: { is_active: true },
//     include: [
//       {
//         model: Role,
//         as: "role",
//         where: { name: "super_admin" },
//         attributes: ["id", "name"]
//       }
//     ]
//   });
// }

// async function getActiveBranchAdmins(branchId, excludeUserId = null) {
//   const where = {
//     is_active: true,
//     branch_id: branchId
//   };

//   if (excludeUserId) {
//     where.id = { [Op.ne]: excludeUserId };
//   }

//   return User.findAll({
//     where,
//     include: [
//       {
//         model: Role,
//         as: "role",
//         where: { name: "admin" },
//         attributes: ["id", "name"]
//       }
//     ]
//   });
// }

// async function createNotificationsForUsers(users, payloadBuilder) {
//   if (!users || !users.length) return;

//   const rows = users.map((user) => ({
//     user_id: user.id,
//     ...payloadBuilder(user)
//   }));

//   await Notification.bulkCreate(rows);
// }

// function uniqueUsersById(users = []) {
//   const map = new Map();
//   for (const user of users) {
//     if (user && user.id) {
//       map.set(user.id, user);
//     }
//   }
//   return [...map.values()];
// }

// // =========================
// // REQUEST PASSWORD RESET
// // =========================
// exports.requestPasswordReset = async (req, res) => {
//   try {
//     const email = req.body.email?.trim();

//     if (!email) {
//       return res.status(400).json({
//         success: false,
//         message: "Email is required"
//       });
//     }

//     const user = await User.findOne({
//       where: {
//         email: {
//           [Op.iLike]: email
//         }
//       },
//       include: [
//         {
//           model: Role,
//           as: "role",
//           attributes: ["id", "name"]
//         },
//         {
//           model: Branch,
//           as: "branch",
//           attributes: ["id", "name"]
//         }
//       ]
//     });

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found"
//       });
//     }

//     if (!user.is_active) {
//       return res.status(403).json({
//         success: false,
//         message: "User account is inactive"
//       });
//     }

//     const otp = generateOTP(6);
//     const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

//     // =========================
//     // 🔥 SUPER ADMIN FLOW
//     // =========================
//     if (user.role?.name === "super_admin") {

//       await PasswordReset.update(
//         { status: "used" },
//         {
//           where: {
//             user_id: user.id,
//             status: "pending"
//           }
//         }
//       );

//       await PasswordReset.create({
//         user_id: user.id,
//         branch_id: null,
//         otp,
//         status: "pending",
//         expires_at: expiresAt
//       });

//       // EMAIL SEND
//       await sgMail.send({
//         to: user.email,
//         from: process.env.SENDGRID_FROM_EMAIL,
//         subject: "Super Admin Password Reset OTP",
//         html: `<h2>Your OTP: ${otp}</h2><p>Valid for 10 minutes</p>`
//       });

//       return res.status(200).json({
//         success: true,
//         message: "OTP sent to your email (Super Admin)"
//       });
//     }
 

//     const roleName = user.role?.name || "";
//     const approverType = getApproverType(roleName);

//     let approvers = [];
//     let superAdmins = [];

//     if (approverType === "super_admin") {
//       approvers = await getActiveSuperAdmins();
//       superAdmins = approvers;
//     } else {
//       approvers = await getActiveBranchAdmins(user.branch_id, user.id);
//       superAdmins = await getActiveSuperAdmins();
//     }

//     if (!approvers.length) {
//       return res.status(404).json({
//         success: false,
//         message: "No approver found"
//       });
//     }

//     const resetRequest = await PasswordReset.create({
//       user_id: user.id,
//       branch_id: user.branch_id || null,
//       otp,
//       expires_at: expiresAt,
//       status: "pending"
//     });

//     await createNotificationsForUsers(approvers, () => ({
//       title: "Password Reset OTP Request",
//       message: `${user.name} (${user.email}) | OTP: ${otp}`,
//       type: "password_reset_request"
//     }));

//     return res.status(200).json({
//       success: true,
//       message: "OTP sent to admin. Contact admin for OTP."
//     });

//   } catch (error) {
//     console.error("requestPasswordReset error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong",
//       error: error.message
//     });
//   }
// };
// // =========================
// // VERIFY OTP
// // =========================
// exports.verifyPasswordResetOTP = async (req, res) => {
//   try {
//     const { email, otp } = req.body;

//     if (!email || !otp) {
//       return res.status(400).json({
//         success: false,
//         message: "Email and OTP are required"
//       });
//     }

//     const user = await User.findOne({
//       where: {
//         email: {
//           [Op.iLike]: email.trim()
//         }
//       }
//     });

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found"
//       });
//     }

//     if (!user.is_active) {
//       return res.status(403).json({
//         success: false,
//         message: "User account is inactive"
//       });
//     }

//     const resetRequest = await PasswordReset.findOne({
//       where: {
//         user_id: user.id,
//         otp: String(otp).trim(),
//         status: "pending"
//       },
//       order: [["createdAt", "DESC"]]
//     });

//     if (!resetRequest) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid OTP"
//       });
//     }

//     if (new Date(resetRequest.expires_at) < new Date()) {
//       resetRequest.status = "expired";
//       await resetRequest.save();

//       return res.status(400).json({
//         success: false,
//         message: "OTP expired"
//       });
//     }

//     resetRequest.status = "verified";
//     resetRequest.verified_at = new Date();
//     await resetRequest.save();

//     return res.status(200).json({
//       success: true,
//       message: "OTP verified successfully",
//       reset_id: resetRequest.id
//     });
//   } catch (error) {
//     console.error("verifyPasswordResetOTP error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong",
//       error: error.message
//     });
//   }
// };

// // =========================
// // RESET PASSWORD
// // =========================
// exports.resetPasswordWithOTP = async (req, res) => {
//   try {
//     const { email, otp, newPassword } = req.body;

//     if (!email || !otp || !newPassword) {
//       return res.status(400).json({
//         success: false,
//         message: "Email, OTP and newPassword are required"
//       });
//     }

//     if (String(newPassword).trim().length < 6) {
//       return res.status(400).json({
//         success: false,
//         message: "New password must be at least 6 characters"
//       });
//     }

//     const user = await User.findOne({
//       where: {
//         email: {
//           [Op.iLike]: email.trim()
//         }
//       },
//       include: [
//         {
//           model: Role,
//           as: "role",
//           attributes: ["name"],
//           required: false
//         },
//         {
//           model: Branch,
//           as: "branch",
//           attributes: ["id", "name"],
//           required: false
//         }
//       ]
//     });

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found"
//       });
//     }

//     if (!user.is_active) {
//       return res.status(403).json({
//         success: false,
//         message: "User account is inactive"
//       });
//     }

//     const resetRequest = await PasswordReset.findOne({
//       where: {
//         user_id: user.id,
//         otp: String(otp).trim(),
//         status: "verified"
//       },
//       order: [["createdAt", "DESC"]]
//     });

//     if (!resetRequest) {
//       return res.status(400).json({
//         success: false,
//         message: "OTP not verified or invalid"
//       });
//     }

//     if (new Date(resetRequest.expires_at) < new Date()) {
//       resetRequest.status = "expired";
//       await resetRequest.save();

//       return res.status(400).json({
//         success: false,
//         message: "OTP expired"
//       });
//     }

//     // password hash: model hook ya yahan bcrypt
//     const hashedPassword = await bcrypt.hash(String(newPassword).trim(), 10);
//     user.password = hashedPassword;

//     // optional secure password update, only if your project uses encrypted/plain backup logic
//     if ("secure_password" in user) {
//       user.secure_password = null;
//     }

//     await user.save();

//     resetRequest.status = "used";
//     resetRequest.used_at = new Date();
//     await resetRequest.save();

//     const roleName = user.role?.name || "";
//     const approverType = getApproverType(roleName);

//     let approvers = [];
//     let superAdmins = [];

//     if (approverType === "super_admin") {
//       approvers = await getActiveSuperAdmins();
//       superAdmins = approvers;
//     } else {
//       approvers = await getActiveBranchAdmins(user.branch_id, user.id);
//       superAdmins = await getActiveSuperAdmins();
//     }

//     // Completion notification to actual approver
//     await createNotificationsForUsers(approvers, () => ({
//       title: "Password Reset Completed",
//       message: `${user.name} (${user.email}) | Role: ${
//         user.role?.name || "N/A"
//       } | Branch: ${user.branch?.name || "N/A"} has successfully reset password.`,
//       type: "password_reset_done"
//     }));

//     // Super admin visibility always
//     const visibilityUsers = uniqueUsersById(superAdmins).filter(
//       (sa) => !approvers.some((ap) => ap.id === sa.id)
//     );

//     await createNotificationsForUsers(visibilityUsers, () => ({
//       title: "Password Reset Completed",
//       message: `${user.name} (${user.email}) | Role: ${
//         user.role?.name || "N/A"
//       } | Branch: ${user.branch?.name || "N/A"} has successfully reset password.`,
//       type: "password_reset_done_visibility"
//     }));

//     await RecentActivity.create({
//       user_id: user.id,
//       action: "PASSWORD_RESET_COMPLETED",
//       details: `${user.name} (${user.email}) reset password successfully.`,
//       ref_id: resetRequest.id,
//       ref_type: "password_reset"
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Password reset successful"
//     });
//   } catch (error) {
//     console.error("resetPasswordWithOTP error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong",
//       error: error.message
//     });
//   }
// };

// // =========================
// // MY NOTIFICATIONS
// // =========================
// exports.getMyNotifications = async (req, res) => {
//   try {
//     const notifications = await Notification.findAll({
//       where: { user_id: req.user.id },
//       order: [["createdAt", "DESC"]],
//       limit: 20
//     });

//     return res.status(200).json({
//       success: true,
//       data: notifications
//     });
//   } catch (error) {
//     console.error("getMyNotifications error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch notifications",
//       error: error.message
//     });
//   }
// };

// exports.getRecentActivities = async (req, res) => {
//   try {
//     const activities = await RecentActivity.findAll({
//       order: [["createdAt", "DESC"]],
//       limit: 20
//     });

//     return res.status(200).json({
//       success: true,
//       data: activities
//     });
//   } catch (error) {
//     console.error("getRecentActivities error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch recent activities",
//       error: error.message
//     });
//   }
// };

// // =========================
// // MARK NOTIFICATION READ
// // =========================
// exports.markNotificationRead = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const notification = await Notification.findOne({
//       where: {
//         id,
//         user_id: req.user.id
//       }
//     });

//     if (!notification) {
//       return res.status(404).json({
//         success: false,
//         message: "Notification not found"
//       });
//     }

//     notification.is_read = true;
//     await notification.save();

//     return res.status(200).json({
//       success: true,
//       message: "Notification marked as read"
//     });
//   } catch (error) {
//     console.error("markNotificationRead error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to update notification",
//       error: error.message
//     });
//   }
// };