import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const StockTransferItem = sequelize.define(
  "StockTransferItem",
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

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
    },

    weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    rate: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    },

    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "stock_transfer_items",
    timestamps: false,
    indexes: [
      { fields: ["transfer_id"] },
      { fields: ["item_id"] },
    ],
  }
);

export default StockTransferItem;