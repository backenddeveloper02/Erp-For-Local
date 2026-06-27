import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const InventoryAuditFollowup = sequelize.define(
  "InventoryAuditFollowup",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
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

    followup_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    followup_type: {
      type: DataTypes.STRING(30),
      allowNull: false, // reason_request / audit_pending
    },

    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "open",
    },

    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    response_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    responded_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    responded_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  },
  {
    tableName: "inventory_audit_followups",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["audit_id"] },
      { fields: ["audit_item_id"] },
      { fields: ["item_id"] },
      { fields: ["followup_date"] },
      { fields: ["status"] },
      { fields: ["followup_type"] },
    ],
  }
);

export default InventoryAuditFollowup;