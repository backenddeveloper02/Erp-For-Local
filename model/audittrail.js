import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const AuditTrail = sequelize.define(
  "AuditTrail",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    module: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    entity_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    entity_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    parent_entity_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    parent_entity_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    action: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    status: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    organization_level: {
      type: DataTypes.STRING(30),
      allowNull: true,
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

    district_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    district_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    user_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    reference_no: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    title: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    audit_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
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
      allowNull: true,
    },

    old_values: {
      type: DataTypes.JSONB,
      allowNull: true,
    },

    new_values: {
      type: DataTypes.JSONB,
      allowNull: true,
    },

    meta: {
      type: DataTypes.JSONB,
      allowNull: true,
    },

    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    ip_address: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    event_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "audit_trails",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

export default AuditTrail;