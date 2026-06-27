import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const StockRequest = sequelize.define(
  "StockRequest",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    request_no: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    from_organization_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    from_store_code: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    from_store_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    to_organization_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    to_district_code: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    to_district_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    priority: {
      type: DataTypes.ENUM("low", "medium", "high", "critical"),
      allowNull: false,
      defaultValue: "medium",
    },

    category: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM(
        "pending",
        "approved",
        "partially_approved",
        "rejected",
        "completed"
      ),
      allowNull: false,
      defaultValue: "pending",
    },

    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    approved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    rejected_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    rejected_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "stock_requests",
    timestamps: true,
    underscored: true,
  }
);

export default StockRequest;