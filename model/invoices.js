import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Invoice = sequelize.define(
  "Invoice",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    invoice_number: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    bill_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    organization_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    store_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    total_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
    },

    received_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
    },

    pending_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
    },

    status: {
      type: DataTypes.ENUM("PAID", "PARTIAL", "UNPAID"),
      allowNull: false,
      defaultValue: "UNPAID",
    },

    invoice_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "invoices",
    timestamps: true,
    indexes: [
      { fields: ["invoice_number"], unique: true },
      { fields: ["customer_id"] },
      { fields: ["organization_id"] },
      { fields: ["status"] },
      { fields: ["store_code"] },
    ],
  }
);

export default Invoice;