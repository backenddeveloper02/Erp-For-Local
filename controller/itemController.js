import Item from "../model/item.js";
// import Item from "../model/item.js";
import { Op } from "sequelize";
// 🔹 ADD ITEM (ALL LEVELS)
export const addItem = async (req, res) => {
  try {
    const {
      article_code,
      sku_code,
      item_name,
      metal_type,
      category,
      details,
      purity,
      gross_weight,
      net_weight,
      stone_weight,
      stone_amount,
      making_charge,
      purchase_rate,
      sale_rate,
      hsn_code,
      unit,
    } = req.body;

    const { role, reference_id } = req.user;

    // 🔥 Validation
    if (!article_code || !item_name || !metal_type || !category || !purity || !gross_weight || !making_charge) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing",
      });
    }

    // 🔥 Check duplicate article_code
    const existingItem = await Item.findOne({
      where: { article_code },
    });

    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: "Article code already exists",
      });
    }

    const newItem = await Item.create({
      article_code,
      sku_code,
      item_name,
      metal_type,
      category,
      details,
      purity,
      gross_weight,
      net_weight,
      stone_weight,
      stone_amount,
      making_charge,
      purchase_rate,
      sale_rate,
      hsn_code,
      unit,

      added_from_level: role.toLowerCase(), // CAPITAL → central
      reference_id: reference_id,
    });

    return res.status(201).json({
      success: true,
      message: "Item added successfully",
      data: newItem,
    });
  } catch (error) {
    console.error("Add Item Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};




export const getItems = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: req.user not found",
      });
    }

    const {
      role,
      organization_level,
      state_code,
      district_code,
      store_code,
    } = req.user;

    let whereClause = {};

    // 🔥 SUPER / CAPITAL LEVEL
    if (
      role === "super_admin" ||
      role === "capital" ||
      organization_level === "capital"
    ) {
      whereClause = {};
    }

    // 🔥 STATE LEVEL
    else if (
      role === "state_manager" ||
      organization_level === "state"
    ) {
      if (!state_code) {
        return res.status(400).json({
          success: false,
          message: "state_code missing in logged-in user",
        });
      }

      whereClause = { state_code };
    }

    // 🔥 DISTRICT LEVEL
    else if (
      role === "district_manager" ||
      organization_level === "district"
    ) {
      if (!district_code) {
        return res.status(400).json({
          success: false,
          message: "district_code missing in logged-in user",
        });
      }

      whereClause = { district_code };
    }

    // 🔥 STORE LEVEL
    else if (
      role === "manager" ||
      role === "admin" ||
      role === "sales_girl" ||
      organization_level === "store"
    ) {
      if (!store_code) {
        return res.status(400).json({
          success: false,
          message: "store_code missing in logged-in user",
        });
      }

      whereClause = { store_code };
    }

    // 🔥 DEFAULT DENY
    else {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view items",
      });
    }

    const items = await Item.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error("Get Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch items",
      error: error.message,
    });
  }
};



// 🔹 GET ITEMS BY LEVEL (CAPITAL USE)


// 🔹 GET ITEMS BY LEVEL
export const getItemsByLevel = async (req, res) => {
  try {
    const { level } = req.params;

    const validLevels = ["central", "state", "district", "store"];

    if (!validLevels.includes(level)) {
      return res.status(400).json({
        success: false,
        message: "Invalid level",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      role,
      organization_level,
      state_code,
      district_code,
      store_code,
    } = req.user;

    let whereClause = {
      added_from_level: level,
    };

    // super / capital sab dekh sakta hai
    if (
      role === "super_admin" ||
      role === "capital" ||
      organization_level === "central"
    ) {
      // no extra filter
    }

    // state level user
    else if (organization_level === "state" || role === "state_manager") {
      whereClause.state_code = state_code;
    }

    // district level user
    else if (organization_level === "district" || role === "district_manager") {
      whereClause.district_code = district_code;
    }

    // store level user
    else if (
      organization_level === "store" ||
      ["manager", "admin", "sales_girl"].includes(role)
    ) {
      whereClause.store_code = store_code;
    }

    else {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    const items = await Item.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error("Get Items By Level Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching items",
      error: error.message,
    });
  }
};

//  GET CHILD ITEMS
export const getChildItems = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      role,
      organization_level,
      state_code,
      district_code,
      store_code,
    } = req.user;

    let whereClause = {};

    // central / capital → sab child items
    if (
      role === "super_admin" ||
      role === "capital" ||
      organization_level === "central"
    ) {
      whereClause = {
        added_from_level: {
          [Op.in]: ["state", "district", "store"],
        },
      };
    }

    // state → district + store apne state ke
    else if (organization_level === "state" || role === "state_manager") {
      whereClause = {
        state_code,
        added_from_level: {
          [Op.in]: ["district", "store"],
        },
      };
    }

    // district → store apne district ke
    else if (organization_level === "district" || role === "district_manager") {
      whereClause = {
        district_code,
        added_from_level: "store",
      };
    }

    // store / manager / admin / sales_girl → apne store ke items
    else if (
      organization_level === "store" ||
      ["manager", "admin", "sales_girl"].includes(role)
    ) {
      whereClause = {
        store_code,
      };
    }

    else {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    const items = await Item.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error("Get Child Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching child items",
      error: error.message,
    });
  }
};

//  GET SINGLE ITEM
export const getItemById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      role,
      organization_level,
      state_code,
      district_code,
      store_code,
    } = req.user;

    const item = await Item.findByPk(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    // access check
    let allowed = false;

    if (
      role === "super_admin" ||
      role === "capital" ||
      organization_level === "central"
    ) {
      allowed = true;
    } else if (
      organization_level === "state" ||
      role === "state_manager"
    ) {
      allowed = item.state_code === state_code;
    } else if (
      organization_level === "district" ||
      role === "district_manager"
    ) {
      allowed = item.district_code === district_code;
    } else if (
      organization_level === "store" ||
      ["manager", "admin", "sales_girl"].includes(role)
    ) {
      allowed = item.store_code === store_code;
    }

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this item",
      });
    }

    return res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error("Get Item By ID Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching item",
      error: error.message,
    });
  }
};

//  UPDATE ITEM
export const updateItem = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      role,
      organization_level,
      state_code,
      district_code,
      store_code,
    } = req.user;

    const item = await Item.findByPk(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    let allowed = false;

    if (
      role === "super_admin" ||
      role === "capital" ||
      organization_level === "central"
    ) {
      allowed = true;
    } else if (
      organization_level === "state" ||
      role === "state_manager"
    ) {
      allowed = item.state_code === state_code;
    } else if (
      organization_level === "district" ||
      role === "district_manager"
    ) {
      allowed = item.district_code === district_code;
    } else if (
      organization_level === "store" ||
      ["manager", "admin"].includes(role)
    ) {
      allowed = item.store_code === store_code;
    }

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to update this item",
      });
    }

    await item.update(req.body);

    return res.status(200).json({
      success: true,
      message: "Item updated successfully",
      data: item,
    });
  } catch (error) {
    console.error("Update Item Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating item",
      error: error.message,
    });
  }
};

//  DELETE ITEM
export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      role,
      organization_level,
      state_code,
      district_code,
      store_code,
    } = req.user;

    const item = await Item.findByPk(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    let allowed = false;

    if (
      role === "super_admin" ||
      role === "capital" ||
      organization_level === "central"
    ) {
      allowed = true;
    } else if (
      organization_level === "state" ||
      role === "state_manager"
    ) {
      allowed = item.state_code === state_code;
    } else if (
      organization_level === "district" ||
      role === "district_manager"
    ) {
      allowed = item.district_code === district_code;
    } else if (
      organization_level === "store" ||
      ["manager", "admin"].includes(role)
    ) {
      allowed = item.store_code === store_code;
    }

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to delete this item",
      });
    }

    await item.destroy();

    return res.status(200).json({
      success: true,
      message: "Item deleted successfully",
    });
  } catch (error) {
    console.error("Delete Item Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting item",
      error: error.message,
    });
  }
};