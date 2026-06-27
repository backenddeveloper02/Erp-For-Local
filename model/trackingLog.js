import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const TrackingLog = sequelize.define(
  "TrackingLog",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    transfer_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    lat: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },

    lng: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
  },
  {
    tableName: "tracking_logs",
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  }
);

export default TrackingLog;