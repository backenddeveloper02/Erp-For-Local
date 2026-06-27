import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const StockRequestItem = sequelize.define(
  "StockRequestItem", // ✅ IMPORTANT (name change)
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    request_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    item_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    request_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    approved_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.ENUM(
        "pending",
        "approved",
        "partially_approved",
        "rejected"
      ),
      allowNull: false,
      defaultValue: "pending",
    },
  },
  {
    tableName: "stock_request_items", // ✅ MUST CHANGE
    timestamps: true,
    underscored: true,
  }
);

export default StockRequestItem;