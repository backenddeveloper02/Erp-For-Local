import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const MetalRate = sequelize.define(
  "MetalRate",
  {
    metal_type: { type: DataTypes.STRING, allowNull: false },
    purity: DataTypes.STRING,
    rate: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    unit: { type: DataTypes.STRING, defaultValue: "gram" },
    state_code: DataTypes.STRING,
    district_code: DataTypes.STRING,
    store_code: DataTypes.STRING,
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    created_at: DataTypes.DATE,
  },
  {
    tableName: "metal_rates",
    timestamps: false,
  }
);

export default MetalRate;