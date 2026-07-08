import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const CodeSequence = sequelize.define(
  "CodeSequence",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    organization_level: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    store_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    code_type: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },

    category_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    sub_category_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    month_year: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    last_number: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "code_sequences",
    timestamps: true,
    underscored: true,
  }
);

export default CodeSequence;