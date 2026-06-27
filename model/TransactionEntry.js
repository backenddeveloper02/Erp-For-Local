import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const TransactionEntry = sequelize.define(
  "TransactionEntry",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    transaction_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    account_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    debit: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    credit: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "transaction_entries",
    timestamps: true,
  }
);

export default TransactionEntry;