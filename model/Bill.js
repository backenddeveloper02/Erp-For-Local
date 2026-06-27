import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Bill = sequelize.define(
  "Bill",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    bill_number: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },

    store_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    total_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  },
  {
    tableName: "bills",
    freezeTableName: true,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  }
);

export default Bill;