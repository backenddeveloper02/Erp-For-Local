import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const State = sequelize.define(
  "State",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    state_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    state_code: {
      type: DataTypes.STRING,
      unique: true,
    },

    // 🔥 IMPORTANT (ADD THIS)
    capital_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "states",
  }
);

export default State;