import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Stock = sequelize.define(
  "Stock",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    // organization_id = Store.id
    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    // ✅ FIX: manual stock-in / upload stock-in dono ke liye store code
    store_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    available_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    available_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    reserved_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    reserved_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    transit_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    transit_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    damaged_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    damaged_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    dead_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    dead_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "stocks",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["organization_id", "item_id"],
      },
      { fields: ["organization_id"] },
      { fields: ["item_id"] },

      // ✅ optional but useful for store-wise inventory filtering
      { fields: ["store_code"] },
    ],
  }
);

export default Stock;
