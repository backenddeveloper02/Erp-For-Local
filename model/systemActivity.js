import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const SystemActivity = sequelize.define(
  "SystemActivity",
  {
    title: { type: DataTypes.STRING, allowNull: false },
    description: DataTypes.TEXT,
    activity_type: DataTypes.STRING,
    module_name: DataTypes.STRING,
    reference_id: DataTypes.INTEGER,
    reference_no: DataTypes.STRING,
    state_code: DataTypes.STRING,
    district_code: DataTypes.STRING,
    store_code: DataTypes.STRING,
    store_name: DataTypes.STRING,
    created_by: DataTypes.INTEGER,
    created_at: DataTypes.DATE,
  },
  {
    tableName: "system_activities",
    timestamps: false,
  }
);

export default SystemActivity;