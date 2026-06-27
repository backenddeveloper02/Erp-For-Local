import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Transaction = sequelize.define(
  "Transaction",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    transaction_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    transaction_type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    organization_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    reference_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reference_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    remarks: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "transactions",
    timestamps: true,
  }
);

export default Transaction;