import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Task = sequelize.define(
  "Task",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    priority: {
      type: DataTypes.STRING,
      defaultValue: "medium",
    },

    status: {
      type: DataTypes.STRING,
      defaultValue: "pending",
    },

    task_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    reference_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    reference_no: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    state_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    district_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    store_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    store_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    assigned_to: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "tasks",
    timestamps: true,
    underscored: true,
  }
);

export default Task;