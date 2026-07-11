import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const StockTransferComplaint = sequelize.define(
  "StockTransferComplaint",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    complaint_no: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },

    transfer_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: "stock_transfers",
        key: "id",
      },
      onDelete: "CASCADE",
    },

    from_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    to_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    complaint_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "quantity_shortage",
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    /*
      Example:

      [
        {
          "transfer_item_id": 15,
          "item_id": 1260,
          "sent_qty": 10,
          "received_qty": 5,
          "shortage_qty": 5,
          "sent_weight": 100,
          "received_weight": 50,
          "shortage_weight": 50,
          "note": "5 pieces missing"
        }
      ]
    */
    items: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },

    image_1_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    image_2_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    video_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "open",
      validate: {
        isIn: [
          [
            "open",
            "under_review",
            "resolved",
            "rejected",
            "cancelled",
          ],
        ],
      },
    },

    raised_by: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    resolution_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    resolved_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "stock_transfer_complaints",

    timestamps: true,

    createdAt: "created_at",

    updatedAt: "updated_at",

    indexes: [
      {
        fields: ["transfer_id"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["raised_by"],
      },
    ],
  }
);

export default StockTransferComplaint;