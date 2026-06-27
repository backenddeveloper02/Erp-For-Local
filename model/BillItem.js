import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const BillItem = sequelize.define(
  "BillItem",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    bill_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    product_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    purity: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 1,
    },

    gross_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: true,
      defaultValue: 0,
    },

    net_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },

    making_charge_percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    },

    making_charge_value: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },

    total_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "bill_items",
    freezeTableName: true,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  }
);

export default BillItem;