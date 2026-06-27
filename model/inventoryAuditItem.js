import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const InventoryAuditItem = sequelize.define(
  "InventoryAuditItem",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    audit_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: "inventory_audits",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    article_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    sku_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    item_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    metal_type: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },

    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    purity: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },

    system_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    system_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    physical_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    physical_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    audit_result: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "pending",
    },

    is_checked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    is_available: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    is_matched: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    is_missing: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    is_extra: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    variance_qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    variance_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    checklist_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    missing_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    reason_submitted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    reason_submitted_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    escalation_status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "none",
    },

    image_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    attachment_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "inventory_audit_items",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["audit_id"] },
      { fields: ["item_id"] },
      { fields: ["audit_result"] },
      { fields: ["escalation_status"] },
      {
        unique: true,
        fields: ["audit_id", "item_id"],
        name: "uq_inventory_audit_item",
      },
    ],
  }
);

export default InventoryAuditItem;