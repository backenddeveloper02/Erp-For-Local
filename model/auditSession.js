import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import InventoryAudit from "./inventoryAudit.js";
const AuditSession = sequelize.define(
  "AuditSession",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    audit_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    organization_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    session_token: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    socket_room: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM(
        "active",
        "paused",
        "completed",
        "expired"
      ),
      defaultValue: "active",
    },

    last_activity_at: {
      type: DataTypes.DATE,
    },

    started_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    ended_at: {
      type: DataTypes.DATE,
    },

    expires_at: {
      type: DataTypes.DATE,
    },

    device_info: {
      type: DataTypes.TEXT,
    },
  },
  {
    tableName: "audit_sessions",
    underscored: true,
  }
);
InventoryAudit.hasMany(AuditSession, {
    foreignKey: "audit_id",
    as: "sessions",
});

AuditSession.belongsTo(InventoryAudit, {
    foreignKey: "audit_id",
    as: "audit",
});
export default AuditSession;