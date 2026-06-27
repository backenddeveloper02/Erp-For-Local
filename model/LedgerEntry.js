import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const LedgerEntry = sequelize.define(
  "LedgerEntry",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    customer_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    type: {
      type: DataTypes.ENUM("DEBIT", "CREDIT"),
      allowNull: false,
    },

    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },

    reference_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    reference_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  },
  {
    tableName: "ledger_entries",
    timestamps: true,

    // ✅ IMPORTANT FIX
    createdAt: "createdAt",
    updatedAt: "updatedAt",

    freezeTableName: true,
  }
);

export default LedgerEntry;