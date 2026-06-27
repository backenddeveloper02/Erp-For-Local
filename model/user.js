// models/User.js

import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    storeCode: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "store_code",
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },

    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "username", 
    },

    phoneNumber: {
      type: DataTypes.STRING,
      unique: true,
      field: "phone_number",
    },

    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "user",
    },

    isPoliceVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: "is_police_verified",
    },

    policeDocUrl: {
      type: DataTypes.STRING,
      field: "police_doc_url",
    },

    aadhaarUrl: {
      type: DataTypes.STRING,
      field: "aadhaar_url",
    },

    panUrl: {
      type: DataTypes.STRING,
      field: "pan_url",
    },
address: {
  type: DataTypes.TEXT,
  allowNull: true,
  field: "address",
},
    storeName: {
      type: DataTypes.STRING,
      field: "store_name",
    },

    organizationLevel: {
      type: DataTypes.STRING,
      field: "organization_level",
    },

    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    userCode: {
      type: DataTypes.STRING,
      unique: true,
      field: "user_code",
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: "is_active",
    },

organization_id: {
  type: DataTypes.BIGINT,
  allowNull: true,
  field: "organization_id",
},
    resetOtp: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "reset_otp",
    },

    resetOtpExpire: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "reset_otp_expire",
    },

    otpAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: "otp_attempts",
    },
    profile_image: {
  type: DataTypes.STRING,
  allowNull: true,
},

is_profile_set: {
  type: DataTypes.BOOLEAN,
  defaultValue: false,
},
  },
  {
  tableName: "users",
  schema: "public", 
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at"
});

export default User;