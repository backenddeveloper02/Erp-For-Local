import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Store = sequelize.define(
  "Store",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    store_code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "store_code",
    },

    store_name: {
      type: DataTypes.STRING,
      // allowNull: false,
      field: "store_name",
    },

    organizationlevel: {
      type: DataTypes.ENUM("head_office", "State", "District", "Retail"),
      allowNull: false,
      defaultValue: "Retail",
      field: "organization_level",
    },

    state: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    district: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    district_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    phone_number: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "phone_number",
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
  },
  {
    tableName: "stores",
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  }
);

export default Store;