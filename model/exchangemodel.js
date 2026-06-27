import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const ExchangeLog = sequelize.define("ExchangeLog", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  invoice_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },


  old_product_code: {
    type: DataTypes.STRING
  },
  old_product_name: {
    type: DataTypes.STRING
  },
  old_purity: {
    type: DataTypes.STRING
  },
  old_gross_weight: {
    type: DataTypes.DECIMAL(10,3)
  },
  old_net_weight: {
    type: DataTypes.DECIMAL(10,3)
  },
  old_stone_weight: {
    type: DataTypes.DECIMAL(10,3)
  },
  old_value: {
    type: DataTypes.DECIMAL(15,2)
  },

  
  new_product_code: {
    type: DataTypes.STRING
  },
  new_product_name: {
    type: DataTypes.STRING
  },
  new_purity: {
    type: DataTypes.STRING
  },
  new_gross_weight: {
    type: DataTypes.DECIMAL(10,3)
  },
  new_net_weight: {
    type: DataTypes.DECIMAL(10,3)
  },
  new_stone_weight: {
    type: DataTypes.DECIMAL(10,3)
  },
  new_value: {
    type: DataTypes.DECIMAL(15,2)
  },

  
  difference: {
    type: DataTypes.DECIMAL(15,2)
  },
  making_charges: {
    type: DataTypes.DECIMAL(15,2)
  }

}, {
  tableName: "exchange_logs",
  timestamps: true // createdAt, updatedAt
});

export default ExchangeLog;