import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const InventoryInvestigation = sequelize.define(
  "InventoryInvestigation",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    case_no: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },

    audit_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    audit_item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    organization_level: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },

    case_status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "open",
    },

    severity: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "medium",
    },

    investigator_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    investigator_name: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },

    issue_summary: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    preliminary_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    final_report: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    police_case_no: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    police_station: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },

    legal_reference: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    opened_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    closed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    closed_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    tableName: "inventory_investigations",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { unique: true, fields: ["case_no"] },
      { fields: ["audit_id"] },
      { fields: ["audit_item_id"] },
      { fields: ["item_id"] },
      { fields: ["organization_id"] },
      { fields: ["case_status"] },
      { fields: ["severity"] },
    ],
  }
);

export default InventoryInvestigation;