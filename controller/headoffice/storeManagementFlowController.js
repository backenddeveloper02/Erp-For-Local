import Store from "../../model/Store.js";
import sequelize from "../../config/db.js";
import { Op } from "sequelize";

// ================= SUMMARY CARDS  =================
export const getStoreDashboard = async (req, res) => {
  try {
    // ================= SUMMARY =================
    const summaryData = await sequelize.query(`
      SELECT 
        COUNT(DISTINCT st.id) AS total_stores,

        COUNT(DISTINCT CASE 
          WHEN st.is_active = true THEN st.id 
        END) AS active_stores,

        COUNT(DISTINCT u.id) AS total_employees,

        COALESCE(SUM(inv.total_amount), 0) AS total_revenue

      FROM stores st

      LEFT JOIN users u 
        ON u.store_code = st.store_code

      LEFT JOIN invoices inv 
        ON inv.store_code = st.store_code
    `);

    const summary = summaryData[0][0];

    // ================= DISTRICTS =================
    const districts = await Store.findAll({
      where: { organization_level: "District" },
      attributes: ["id", "store_name", "store_code"]
    });

    // ================= FINAL RESPONSE =================
    res.json({
      success: true,
      data: {
        summary: {
          totalStores: Number(summary.total_stores),
          activeStores: Number(summary.active_stores),
          totalEmployees: Number(summary.total_employees),
          totalRevenue: Number(summary.total_revenue),
        },
        districts
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ================= DISTRICT INVENTORY =================
export const getDistrictInventory = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    let condition = `
      WHERE st.store_code = :store_code
      AND COALESCE(s.available_qty, 0) > 0
    `;

    if (category) {
      condition += ` AND i.category = :category`;
    }

    // ================= CATEGORY VIEW =================
    if (!category) {
      const data = await sequelize.query(
        `
        SELECT 
          i.category,

          MIN(i.sku_code) as code,

          MIN(i.image_url) AS image,
          MIN(i.image_url) AS image_url,

          COALESCE(SUM(s.available_qty), 0) as quantity,

          AVG(i.sale_rate)::numeric(10,2) as selling_price,

          AVG(i.making_charge)::numeric(10,2) as making_charge,

          MIN(i.purity) as purity,

          COALESCE(SUM(i.net_weight), 0) as net_weight,

          COALESCE(SUM(i.stone_weight), 0) as stone_weight,

          COALESCE(SUM(i.gross_weight), 0) as gross_weight

        FROM stocks s

        JOIN items i
          ON i.id = s.item_id

        JOIN stores st
          ON st.id = s.organization_id

        ${condition}

        GROUP BY i.category

        ORDER BY i.category
        `,
        {
          replacements: { store_code, category },
          type: sequelize.QueryTypes.SELECT,
        }
      );

      return res.json({
        success: true,
        data,
      });
    }

    // ================= ITEM VIEW =================
    const data = await sequelize.query(
      `
      SELECT 
        i.id as item_id,

        i.item_name as article,

        i.article_code,

        i.sku_code as code,

        i.image_url AS image,
        i.image_url AS image_url,

        COALESCE(s.available_qty, 0) as quantity,

        i.sale_rate as selling_price,

        i.purchase_rate,

        i.making_charge,

        i.purity,

        i.metal_type,

        i.net_weight,

        i.stone_weight,

        i.gross_weight,

        i.hsn_code,

        i.current_status,

        s.available_weight,

        s.reserved_qty,

        s.reserved_weight,

        s.transit_qty,

        s.transit_weight,

        s.damaged_qty,

        s.damaged_weight

      FROM stocks s

      JOIN items i
        ON i.id = s.item_id

      JOIN stores st
        ON st.id = s.organization_id

      ${condition}

      ORDER BY i."createdAt" DESC
      `,
      {
        replacements: { store_code, category },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.log("getDistrictInventory error =>", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= DISTRICT CATEGORY ITEMS =================
export const getDistrictCategoryItems = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const data = await sequelize.query(`
      SELECT       
        i.id as item_id,

        i.item_name as article,

        i.article_code,

        i.sku_code as code,

        COALESCE(s.available_qty, 0) as quantity,

        i.sale_rate as selling_price,

        i.purchase_rate,

        i.making_charge,

        i.purity,

        i.metal_type,

        i.net_weight,

        i.stone_weight,

        i.gross_weight,

        i.hsn_code,

        i.current_status,

        s.available_weight,

        s.reserved_qty,

        s.reserved_weight,

        s.transit_qty,

        s.transit_weight,

        s.damaged_qty,

        s.damaged_weight

      FROM stocks s

      JOIN items i
        ON i.id = s.item_id

      JOIN stores st
        ON st.id = s.organization_id

      WHERE st.store_code = :store_code
      AND i.category = :category

      ORDER BY i."createdAt" DESC
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.log("getDistrictCategoryItems error =>", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ================= RETAIL STORES =================
export const getRetailStores = async (req, res) => {
  try {
    const { store_code } = req.params;

    const data = await sequelize.query(`
      SELECT id, store_name, store_code
      FROM stores
      WHERE district_id = (
        SELECT id FROM stores WHERE store_code = :store_code
      )
      AND organization_level = 'Retail' 
    `, {
      replacements: { store_code },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ================= STORE INVENTORY =================
export const getStoreInventory = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    // ================= CATEGORY VIEW =================
    if (!category) {
      const data = await sequelize.query(`
        SELECT 
          i.category,

          MIN(i.sku_code) as code,

          COALESCE(SUM(s.available_qty), 0) as quantity,

          AVG(i.sale_rate)::numeric(10,2) as selling_price,

          AVG(i.making_charge)::numeric(10,2) as making_charge,

          MIN(i.purity) as purity,

          COALESCE(SUM(i.net_weight), 0) as net_weight,

          COALESCE(SUM(i.stone_weight), 0) as stone_weight,

          COALESCE(SUM(i.gross_weight), 0) as gross_weight

        FROM stocks s

        JOIN items i
          ON i.id = s.item_id

        JOIN stores st
          ON st.id = s.organization_id

        WHERE st.store_code = :store_code
        AND COALESCE(s.available_qty, 0) > 0

        GROUP BY i.category

        ORDER BY i.category
      `, {
        replacements: { store_code },
        type: sequelize.QueryTypes.SELECT
      });

      return res.json({
        success: true,
        data
      });
    }

    // ================= ITEM VIEW =================
    const data = await sequelize.query(`
      SELECT 
        i.id as item_id,

        i.item_name as article,

        i.article_code,

        i.sku_code as code,

        COALESCE(s.available_qty, 0) as quantity,

        i.sale_rate as selling_price,

        i.purchase_rate,

        i.making_charge,

        i.purity,

        i.metal_type,

        i.net_weight,

        i.stone_weight,

        i.gross_weight,

        i.hsn_code,

        i.current_status,

        s.available_weight,

        s.reserved_qty,

        s.reserved_weight,

        s.transit_qty,

        s.transit_weight,

        s.damaged_qty,

        s.damaged_weight

      FROM stocks s

      JOIN items i
        ON i.id = s.item_id

      JOIN stores st
        ON st.id = s.organization_id

      WHERE st.store_code = :store_code
      AND i.category = :category

      ORDER BY i."createdAt" DESC
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.log("getStoreInventory error =>", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ================= STORE CATEGORY ITEMS =================
export const getStoreCategoryItems = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const data = await sequelize.query(`
      SELECT 
        i.id as item_id,

        i.item_name as article,

        i.article_code,

        i.sku_code as code,

        COALESCE(s.available_qty, 0) as quantity,

        i.sale_rate as selling_price,

        i.purchase_rate,

        i.making_charge,

        i.purity,

        i.metal_type,

        i.net_weight,

        i.stone_weight,

        i.gross_weight,

        i.hsn_code,

        i.current_status,

        s.available_weight,

        s.reserved_qty,

        s.reserved_weight,

        s.transit_qty,

        s.transit_weight,

        s.damaged_qty,

        s.damaged_weight

      FROM stocks s

      JOIN items i
        ON i.id = s.item_id

      JOIN stores st
        ON st.id = s.organization_id

      WHERE st.store_code = :store_code
      AND i.category = :category

      ORDER BY i."createdAt" DESC
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.log("getStoreCategoryItems error =>", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ================= CREATE STORE =================
export const createStore = async (req, res) => {
  let t;

  try {
    const {
      store_name,
      level,
      address,
      pincode,
      store_code,
      district_store_code,
    } = req.body;

    const normalizedLevel = level?.trim();

    const allowedLevels = ["Retail", "District", "head_office"];

    if (!store_name || !normalizedLevel || !store_code) {
      return res.status(400).json({
        success: false,
        message: "store_name, level, store_code required",
      });
    }

    if (!allowedLevels.includes(normalizedLevel)) {
      return res.status(400).json({
        success: false,
        message: "Invalid organization level",
      });
    }

    if (
      store_name.toLowerCase().includes("district") &&
      normalizedLevel !== "District"
    ) {
      return res.status(400).json({
        success: false,
        message: "Store name indicates District but level is incorrect",
      });
    }

    if (normalizedLevel === "Retail" && !district_store_code) {
      return res.status(400).json({
        success: false,
        message: "district_store_code required for Retail store",
      });
    }

    let districtStore = null;

    if (normalizedLevel === "Retail") {
      districtStore = await Store.findOne({
        where: {
          store_code: district_store_code,
          organizationlevel: "District",
          is_active: true,
        },
        attributes: [
          "id",
          "store_name",
          "store_code",
          "organizationlevel",
          "address",
        ],
      });

      if (!districtStore) {
        return res.status(404).json({
          success: false,
          message: "Selected district store not found",
        });
      }
    }

    const finalAddress = `${address || ""} - ${pincode || ""}`;

    t = await sequelize.transaction();

    const newStore = await Store.create(
      {
        store_name,
        organizationlevel: normalizedLevel,
        store_code,
        address: finalAddress,
        district_id:
          normalizedLevel === "Retail"
            ? districtStore.id
            : null,
        is_active: true,
      },
      { transaction: t }
    );

    await t.commit();

    if (normalizedLevel === "Retail") {
      return res.json({
        success: true,
        message: "Retail Store Created And Assigned To District",
        data: {
          retail_store: newStore,
          assigned_district: districtStore,
        },
      });
    }

    if (normalizedLevel === "District") {
      return res.json({
        success: true,
        message: "District Created Successfully",
        data: {
          district: newStore,
        },
      });
    }

    if (normalizedLevel === "head_office") {
      return res.json({
        success: true,
        message: "Head Office Created Successfully",
        data: newStore,
      });
    }
  } catch (error) {
    if (t && !t.finished) {
      await t.rollback();
    }

    return res.status(500).json({
      success: false,
      message: error.errors?.[0]?.message || error.message,
    });
  }
};

// ================= MAP STORES TO DISTRICT =================
export const mapStoresToDistrict = async (req, res) => {
  let t;

  try {
    let { district_id, storeIds = [] } = req.body;

    if (!district_id || !Array.isArray(storeIds) || storeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "district_id and storeIds required",
      });
    }

    const districtId = Number(district_id);

    if (isNaN(districtId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid district_id",
      });
    }

    const district = await Store.findOne({
      where: {
        id: districtId,
        organization_level: "District",
      },
    });

    if (!district) {
      return res.status(400).json({
        success: false,
        message: "Invalid district_id",
      });
    }

    const validStores = await Store.findAll({
      where: {
        id: { [Op.in]: storeIds },
        organization_level: "Retail",
        district_id: null,
      },
    });

    if (validStores.length !== storeIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some stores already assigned or invalid",
      });
    }

    t = await sequelize.transaction();

    await sequelize.query(
      `
      UPDATE stores
      SET district_id = :districtId
      WHERE id IN (:storeIds)
      `,
      {
        replacements: { districtId, storeIds },
        transaction: t,
      }
    );

    const updatedStores = await Store.findAll({
      where: {
        id: { [Op.in]: storeIds },
      },
      attributes: [
        "id",
        "store_name",
        "store_code",
        "organization_level",
        "district_id",
      ],
      transaction: t,
    });

    await t.commit();

    return res.json({
      success: true,
      message: "Stores mapped successfully",
      data: updatedStores,
    });

  } catch (error) {
    if (t && !t.finished) {
      await t.rollback();
    }

    console.log(" MAP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
