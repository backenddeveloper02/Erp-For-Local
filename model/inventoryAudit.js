import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const InventoryAudit = sequelize.define(
  "InventoryAudit",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    audit_no: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    organization_level: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },

    audit_scope: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "self",
    },

    audit_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    audit_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "daily",
    },

    parent_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    visible_to_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    store_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    store_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    store_name: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },

    district_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    district_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    district_name: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },

    total_items: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    checked_items: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    present_items: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    missing_items: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    pending_items: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "draft",
    },

    remark: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    submitted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    closed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    reviewed_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    closed_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    tableName: "inventory_audits",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { unique: true, fields: ["audit_no"] },
      { fields: ["organization_id"] },
      { fields: ["audit_date"] },
      { fields: ["status"] },
      { fields: ["store_id"] },
      { fields: ["district_id"] },
      { fields: ["visible_to_organization_id"] },
      {
        unique: true,
        fields: ["organization_id", "audit_date", "audit_type"],
        name: "uq_inventory_audit_daily",
      },
    ],
  }
);

export default InventoryAudit;