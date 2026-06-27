import State from "../model/State.js";
import Item from "../models/Item.js";

//  ADD STATE (Only Capital)
export const addState = async (req, res) => {
  try {
    const { state_name, state_code } = req.body;
    const { role, reference_id } = req.user;

    if (role !== "CAPITAL") {
      return res.status(403).json({
        success: false,
        message: "Only Capital allowed",
      });
    }

    const state = await State.create({
      state_name,
      state_code,
      capital_id: reference_id, //  LINK
    });

    res.status(201).json({
      success: true,
      message: "State added successfully",
      data: state,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error adding state",
    });
  }
};


//  GET ALL ITEMS (Capital Power )
export const getAllItems = async (req, res) => {
  try {
    const items = await Item.findAll({
      order: [["createdAt", "DESC"]],
    });
if (req.user.role !== "CAPITAL") {
  return res.status(403).json({
    success: false,
    message: "Access denied. Only Capital allowed",
  });
}
    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error("Get All Items Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching items",
    });
  }
};