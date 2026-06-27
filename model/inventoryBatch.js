import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const InventoryBatch = sequelize.define(
  "InventoryBatch",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    batch_no: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    stock_record_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    current_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    total_qty: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },

    available_qty: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },

    total_weight: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },

    available_weight: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "created",
      validate: {
        isIn: [
          [
            "created",
            "in_transit",
            "partial",
            "delivered",
            "sold",
            "dead",
            "damaged",
          ],
        ],
      },
    },

    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    root_batch_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    parent_batch_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    split_level: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    is_leaf: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    source_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    source_reference_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    tableName: "inventory_batches",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

export default InventoryBatch;