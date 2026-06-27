import District from "../model/District.js";
import Item from "../models/Item.js";
import { Op } from "sequelize";

// 🔹 ADD DISTRICT (Only State)
export const addDistrict = async (req, res) => {
  try {
    const { district_name, district_code } = req.body;
    const { role, reference_id } = req.user;

    if (role !== "STATE") {
      return res.status(403).json({
        success: false,
        message: "Only State can add district",
      });
    }

    const existing = await District.findOne({
      where: { district_code },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "District code already exists",
      });
    }

    const district = await District.create({
      district_name,
      district_code,
      state_id: reference_id, // 🔥 important link
    });

    res.status(201).json({
      success: true,
      message: "District added successfully",
      data: district,
    });
  } catch (error) {
    console.error("Add District Error:", error);
    res.status(500).json({
      success: false,
      message: "Error adding district",
    });
  }
};



// 🔹 GET ALL DISTRICTS (OF THAT STATE)
export const getDistricts = async (req, res) => {
  try {
    const { role, reference_id } = req.user;

    if (role !== "STATE") {
      return res.status(403).json({
        success: false,
        message: "Only State allowed",
      });
    }

    const districts = await District.findAll({
      where: { state_id: reference_id },
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      count: districts.length,
      data: districts,
    });
  } catch (error) {
    console.error("Get Districts Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching districts",
    });
  }
};



// 🔹 GET DISTRICT + STORE ITEMS (STATE LEVEL VIEW)
export const getDistrictItems = async (req, res) => {
  try {
    const { role } = req.user;

    if (role !== "STATE") {
      return res.status(403).json({
        success: false,
        message: "Only State allowed",
      });
    }

    const items = await Item.findAll({
      where: {
        added_from_level: {
          [Op.in]: ["district", "store"],
        },
      },
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error("State Items Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching items",
    });
  }
};