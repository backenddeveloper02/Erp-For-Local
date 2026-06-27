import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const BatchTimeline = sequelize.define(
  "BatchTimeline",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    batch_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    event_type: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [
          [
            "created",
            "approved",
            "dispatched",
            "in_transit",
            "received",
            "delivered",
            "sold",
            "returned",
            "damaged",
            "dead_stock",
          ],
        ],
      },
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

    handled_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    event_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "batch_timelines",
    timestamps: false,
  }
);

export default BatchTimeline;