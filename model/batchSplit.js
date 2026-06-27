import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const BatchSplit = sequelize.define(
  "BatchSplit",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    root_batch_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    parent_batch_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    child_batch_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    from_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    to_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    quantity: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0.0001,
      },
    },

    weight: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },

    reference_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    reference_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "batch_splits",
    timestamps: false,
  }
);

export default BatchSplit;