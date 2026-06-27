import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const TransferLocation = sequelize.define(
  "TransferLocation",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    transfer_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: false,
      validate: { min: -90, max: 90 },
    },
    longitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: false,
      validate: { min: -180, max: 180 },
    },
    speed: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    accuracy: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "fake",
    },
  },
  {
    tableName: "transfer_locations",
    timestamps: true,
    createdAt: "recorded_at",
    updatedAt: false,
  }
);

export default TransferLocation;