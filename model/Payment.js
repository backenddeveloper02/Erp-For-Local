import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Payment = sequelize.define(
  "Payment",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    invoice_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    amount: {
      type: DataTypes.DECIMAL(12,2),
      allowNull: false,
    },

    payment_method: {
      type: DataTypes.ENUM(
        "CASH",
        "BANK_TRANSFER",
        "CARD",
        "UPI",
        "CHEQUE"
      ),
      defaultValue: "CASH",
    },

    financier: {
      type: DataTypes.ENUM("Self", "Financier"),
      defaultValue: "Self",
    },

    txn_id: DataTypes.STRING,

    payment_date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    operator: DataTypes.STRING,

    organization_id: DataTypes.INTEGER,

    store_code: DataTypes.STRING,
  },
  {
    tableName: "payments",
    timestamps: true,
  }
);

export default Payment;