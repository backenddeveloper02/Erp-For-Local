import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const InvoiceItem = sequelize.define(
  "InvoiceItem",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    invoice_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: "invoices",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "items",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    product_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    article_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    sku_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    product_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    metal_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    purity: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    hsn_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    unit: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "piece",
    },

    qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 1,
    },

    gross_weight: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true,
      defaultValue: 0,
    },

    net_weight: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true,
      defaultValue: 0,
    },

    stone_weight: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true,
      defaultValue: 0,
    },

    rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },

    making_charge_percent: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      defaultValue: 0,
    },

    making_charge_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0,
    },

    stone_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0,
    },

    wastage_percent: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      defaultValue: 0,
    },

    wastage_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0,
    },

    discount_percent: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      defaultValue: 0,
    },

    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0,
    },

    tax_percent: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      defaultValue: 0,
    },

    tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0,
    },

    line_total: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0,
    },

    total_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },

    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "invoice_items",
    timestamps: true,
    underscored: false,
  }
);

export default InvoiceItem;