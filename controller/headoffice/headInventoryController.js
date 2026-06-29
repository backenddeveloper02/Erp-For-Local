import { Op } from "sequelize";
import Item from "../../model/item.js";
import Stock from "../../model/stockrecord.js";
export const getHeadOfficeStock = async (req, res) => {
  try {
    const user = req.user || {};

    const {
      search,
      category,
      metal_type,
      page = 1,
      limit = 1000,
    } = req.query;

    // =================================================
    // USER / STORE CODE
    // =================================================

    const role = String(user.role || "").toLowerCase();

    const storeCode = String(
      user.store_code ||
        user.storeCode ||
        req.headers.store_code ||
        req.headers.storecode ||
        req.headers["store-code"] ||
        ""
    )
      .trim()
      .toUpperCase();

    if (!storeCode && role !== "super_admin") {
      return res.status(400).json({
        success: false,
        message: "Store code missing in login user",
      });
    }

    // =================================================
    // PAGINATION
    // =================================================

    const pageNumber = Number(page) || 1;
    const pageLimit = Number(limit) || 1000;
    const offset = (pageNumber - 1) * pageLimit;

    // =================================================
    // COMMON WHERE
    // =================================================

    let whereClause = `WHERE 1=1`;
    const replacements = {
      limit: pageLimit,
      offset,
    };

    if (role !== "super_admin") {
      whereClause += ` AND UPPER(s.store_code) = :store_code`;
      replacements.store_code = storeCode;
    }

    if (category) {
      whereClause += ` AND i.category = :category`;
      replacements.category = category;
    }

    if (metal_type) {
      whereClause += ` AND i.metal_type = :metal_type`;
      replacements.metal_type = metal_type;
    }

    if (search) {
      whereClause += `
        AND (
          i.item_name ILIKE :search
          OR i.article_code ILIKE :search
          OR i.sku_code ILIKE :search
          OR i.purity ILIKE :search
        )
      `;
      replacements.search = `%${search}%`;
    }

    // =================================================
    // FETCH ITEMS
    // =================================================

    const items = await sequelize.query(
      `
      SELECT
        i.id,
        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,
        i.net_weight,
        i.stone_weight,
        i.gross_weight,
        i.sale_rate,
        i.making_charge,
        i.current_status,
        i."storeCode",
        i.organization_id,
        i."createdAt",
        i.image_url,

        s.id AS stock_id,
        s.item_id AS stock_item_id,
        s.store_code AS stock_store_code,
        COALESCE(s.available_qty, 0) AS available_qty,
        COALESCE(s.available_weight, 0) AS available_weight,
        COALESCE(s.reserved_qty, 0) AS reserved_qty,
        COALESCE(s.reserved_weight, 0) AS reserved_weight,
        COALESCE(s.transit_qty, 0) AS transit_qty,
        COALESCE(s.transit_weight, 0) AS transit_weight,
        COALESCE(s.dead_qty, 0) AS dead_qty,
        COALESCE(s.dead_weight, 0) AS dead_weight

      FROM items i

      LEFT JOIN stocks s
      ON s.item_id = i.id

      ${whereClause}

      ORDER BY i.id DESC

      LIMIT :limit OFFSET :offset
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =================================================
    // SUMMARY
    // =================================================

    let transitGoods = 0;
    let lowStock = 0;

    const categoryCounts = {};
    const categoryQuantityMap = {};

    items.forEach((item) => {
      const key = item.category || "Others";

      const categoryKey = String(item.category || "Others")
        .trim()
        .toLowerCase();

      const availableQty = Number(item.available_qty || 0);

      categoryCounts[key] = (categoryCounts[key] || 0) + 1;

      categoryQuantityMap[categoryKey] =
        (categoryQuantityMap[categoryKey] || 0) + availableQty;
    });

    items.forEach((item) => {
      const availableQty = Number(item.available_qty || 0);
      const transitQty = Number(item.transit_qty || 0);

      transitGoods += transitQty;

      if (availableQty > 0 && availableQty <= 5) {
        lowStock++;
      }
    });

    // =================================================
    // CATEGORY DUPLICACY REMOVE ONLY FOR RESPONSE DATA
    // =================================================

    const seenCategories = new Set();

    const filteredItems = items.filter((item) => {
      const categoryKey = String(item.category || "Others")
        .trim()
        .toLowerCase();

      if (seenCategories.has(categoryKey)) {
        return false;
      }

      seenCategories.add(categoryKey);
      return true;
    });

    // =================================================
    // BATCH MAP
    // =================================================

    const batchMap = {};

    const batches = await sequelize.query(
      `
      SELECT
        item_id,
        id AS parent_batch_id,
        root_batch_id,
        batch_no
      FROM inventory_batches
      WHERE
        parent_batch_id IS NULL
        OR parent_batch_id = root_batch_id
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    for (const batch of batches) {
      if (!batchMap[batch.item_id]) {
        batchMap[batch.item_id] = batch;
      }
    }

    // =================================================
    // RESPONSE DATA
    // =================================================

    const data = filteredItems.map((item) => {
      const categoryKey = String(item.category || "Others")
        .trim()
        .toLowerCase();

      return {
        id: item.id,

        item_name: item.item_name,

        article_code: item.article_code,

        sku_code: item.sku_code,

        parent_batch_id: batchMap[item.id]?.parent_batch_id || null,

        root_batch_id: batchMap[item.id]?.root_batch_id || null,

        batch_id: batchMap[item.id]?.parent_batch_id || null,

        batch_no: batchMap[item.id]?.batch_no || null,

        category: item.category,

        image_url: item.image_url,

        total_category_items: categoryCounts[item.category || "Others"] || 0,

        metal_type: item.metal_type,

        purity: item.purity,

        quantity: categoryQuantityMap[categoryKey] || 0,

        available_qty: categoryQuantityMap[categoryKey] || 0,

        available_weight: Number(item.available_weight || 0),

        reserved_qty: Number(item.reserved_qty || 0),

        transit_qty: Number(item.transit_qty || 0),

        dead_qty: Number(item.dead_qty || 0),

        net_weight: Number(item.net_weight || 0),

        gross_weight: Number(item.gross_weight || 0),

        stone_weight: Number(item.stone_weight || 0),

        selling_price: Number(item.sale_rate || 0),

        making_charge: Number(item.making_charge || 0),

        current_status: item.current_status,

        storeCode: item.storeCode || null,

        organization_id: item.organization_id,

        stocks: [
          {
            id: item.stock_id,
            item_id: item.stock_item_id,
            store_code: item.stock_store_code,
            available_qty: Number(item.available_qty || 0),
            available_weight: Number(item.available_weight || 0),
            reserved_qty: Number(item.reserved_qty || 0),
            reserved_weight: Number(item.reserved_weight || 0),
            transit_qty: Number(item.transit_qty || 0),
            transit_weight: Number(item.transit_weight || 0),
            dead_qty: Number(item.dead_qty || 0),
            dead_weight: Number(item.dead_weight || 0),
          },
        ],
      };
    });

    // =================================================
    // TOTAL STOCK - SAME AS RETAIL DASHBOARD
    // =================================================

    let totalStockWhere = `WHERE 1=1`;
    const totalStockReplacements = {};

    if (role !== "super_admin") {
      totalStockWhere += ` AND UPPER(s.store_code) = :store_code`;
      totalStockReplacements.store_code = storeCode;
    }

    const totalStockResult = await sequelize.query(
      `
      SELECT
        COALESCE(SUM(s.available_qty), 0) AS total
      FROM stocks s
      INNER JOIN items i
      ON i.id = s.item_id
      ${totalStockWhere}
      `,
      {
        replacements: totalStockReplacements,
        type: QueryTypes.SELECT,
      }
    );

    const totalStock = Number(totalStockResult?.[0]?.total || 0);

    // =================================================
    // DEAD STOCK - SAME AS RETAIL DASHBOARD
    // =================================================

    const deadStockResult = await sequelize.query(
      `
      SELECT
        COUNT(
          DISTINCT CASE
            WHEN
              s.available_qty > 0
              AND i."createdAt" < NOW() - INTERVAL '30 days'
              AND NOT EXISTS (
                SELECT 1
                FROM invoice_items ii
                JOIN invoices inv
                ON inv.id = ii.invoice_id
                WHERE ii.item_id = i.id
                AND inv."createdAt" > NOW() - INTERVAL '30 days'
              )
            THEN i.id
          END
        )::int AS dead_stock_items

      FROM stocks s

      INNER JOIN items i
      ON i.id = s.item_id

      ${totalStockWhere}
      `,
      {
        replacements: totalStockReplacements,
        type: QueryTypes.SELECT,
      }
    );

    const deadStock = Number(deadStockResult?.[0]?.dead_stock_items || 0);

    return res.status(200).json({
      success: true,

      message: "Head office inventory fetched successfully",

      summary: {
        total_stock_items: totalStock,

        dead_stock_items: deadStock,

        low_stock_items: lowStock,

        transit_goods: transitGoods,
      },

      pagination: {
        page: pageNumber,

        limit: pageLimit,
      },

      count: data.length,

      data,
    });
  } catch (error) {
    console.error("getHeadOfficeStock error:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch head office inventory",

      error: error.message,
    });
  }
};




import sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";

// ================= COMMON FILTER HELPER =================
const buildStockFilter = (query) => {
  const { organization_id, store_code } = query;

  const replacements = {};

  if (organization_id) {
    replacements.organization_id = organization_id;
    return {
      where: `WHERE s.organization_id = :organization_id`,
      and: `AND s.organization_id = :organization_id`,
      replacements,
    };
  }

  if (store_code) {
    replacements.store_code = store_code;
    return {
      where: `WHERE s.store_code = :store_code`,
      and: `AND s.store_code = :store_code`,
      replacements,
    };
  }

  return {
    where: "",
    and: "",
    replacements,
  };
};

// ================= GET DISTRICT / RETAIL LIST =================
export const getInventoryOrganizations = async (req, res) => {
  try {
    const { type } = req.query;

    if (!type || !["district", "retail"].includes(type.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "type is required: district or retail",
      });
    }

    const level = type.toLowerCase() === "district" ? "District" : "Retail";

    const data = await sequelize.query(
      `
      SELECT
        id AS organization_id,
        store_code,
        store_name,
        organization_level
      FROM stores
      WHERE organization_level = :level
      AND is_active = true
      ORDER BY store_name ASC
      `,
      {
        replacements: { level },
        type: QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Inventory Organizations Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= OVERALL INVENTORY DASHBOARD =================
export const getOverallInventoryDashboard = async (req, res) => {
  try {
    const filter = buildStockFilter(req.query);

    const [cards] = await sequelize.query(
      `
      SELECT 
        COALESCE(SUM(s.available_qty), 0) AS total_stock_items,

        COUNT(
          DISTINCT CASE
            WHEN s.available_qty > 0
            AND i."createdAt" < NOW() - INTERVAL '30 days'
            AND NOT EXISTS (
              SELECT 1
              FROM invoice_items ii
              JOIN invoices inv ON inv.id = ii.invoice_id
              WHERE ii.item_id = i.id
              AND inv."createdAt" > NOW() - INTERVAL '30 days'
            )
            THEN i.id
          END
        ) AS dead_stock_items,

        COUNT(
          DISTINCT CASE
            WHEN s.available_qty < 5
            AND s.available_qty > 0
            THEN i.id
          END
        ) AS low_stock,

        COALESCE(SUM(s.transit_qty), 0) AS transit_goods

      FROM items i
      LEFT JOIN stocks s ON s.item_id = i.id
      ${filter.where}
      `,
      {
        replacements: filter.replacements,
        type: QueryTypes.SELECT,
      }
    );

    const tableData = await sequelize.query(
      `
      SELECT 
        MIN(i.id) AS id,

        i.category AS category,

        i.category AS item,

        COUNT(DISTINCT i.id) AS total_items,

        COALESCE(SUM(s.available_qty), 0) AS quantity,

        COALESCE(SUM(s.transit_qty), 0) AS transit_quantity,

        AVG(i.purchase_rate) AS purchase_rate,

        AVG(i.sale_rate) AS selling_price,

        AVG(i.making_charge) AS making_charge,

        ROUND(SUM(i.net_weight)::numeric, 3) AS net_weight,

        ROUND(SUM(i.stone_weight)::numeric, 3) AS stone_weight,

        ROUND(SUM(i.gross_weight)::numeric, 3) AS gross_weight,

        CASE
          WHEN COALESCE(SUM(s.available_qty), 0) < 5
          AND COALESCE(SUM(s.available_qty), 0) > 0
          THEN 'LOW STOCK'

          WHEN COALESCE(SUM(s.available_qty), 0) = 0
          THEN 'OUT OF STOCK'

          ELSE 'IN STOCK'
        END AS stock_status

      FROM items i
      LEFT JOIN stocks s ON s.item_id = i.id
      ${filter.where}

      GROUP BY i.category

      ORDER BY MAX(i."createdAt") DESC
      `,
      {
        replacements: filter.replacements,
        type: QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      data: {
        cards: {
          totalStocksItems: Number(cards.total_stock_items),
          deadStockItems: Number(cards.dead_stock_items),
          lowStock: Number(cards.low_stock),
          transitGoods: Number(cards.transit_goods),
        },
        table: tableData,
      },
    });
  } catch (error) {
    console.error("Dashboard Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= OVERALL CATEGORY ITEMS =================
export const getOverallCategoryItems = async (req, res) => {
  try {
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const filter = buildStockFilter(req.query);

    const data = await sequelize.query(
      `
      SELECT 
        i.id AS item_id,
        i.item_name AS article,
        i.sku_code AS code,

        i.image_url AS image,
        i.image_url AS image_url,

        COALESCE(SUM(s.available_qty), 0) AS quantity,

        AVG(i.purchase_rate) AS purchase_price,
        AVG(i.sale_rate) AS selling_price,
        AVG(i.making_charge) AS making_charge,

        i.purity,

        ROUND(AVG(i.net_weight)::numeric, 3) AS net_weight,
        ROUND(AVG(i.stone_weight)::numeric, 3) AS stone_weight,
        ROUND(AVG(i.gross_weight)::numeric, 3) AS gross_weight

      FROM items i

      LEFT JOIN stocks s 
        ON s.item_id = i.id

      WHERE i.category = :category
      ${filter.and}

      GROUP BY 
        i.id,
        i.item_name,
        i.sku_code,
        i.image_url,
        i.purity

      ORDER BY i.item_name ASC
      `,
      {
        replacements: {
          category,
          ...filter.replacements,
        },
        type: QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Overall Category Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= UPDATE STOCK PRICING =================
export const updateStockPricing = async (req, res) => {
  try {
    const { item_id, selling_price, making_charge } = req.body;

    if (!item_id) {
      return res.status(400).json({
        success: false,
        message: "item_id is required",
      });
    }

    const itemExists = await sequelize.query(
      `
      SELECT id, item_name, sale_rate, making_charge
      FROM items
      WHERE id = :item_id
      `,
      {
        replacements: { item_id },
        type: QueryTypes.SELECT,
      }
    );

    if (itemExists.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    await sequelize.query(
      `
      UPDATE items
      SET
        sale_rate = COALESCE(:selling_price, sale_rate),
        making_charge = COALESCE(:making_charge, making_charge),
        "updatedAt" = NOW()
      WHERE id = :item_id
      `,
      {
        replacements: {
          item_id,
          selling_price: selling_price ?? null,
          making_charge: making_charge ?? null,
        },
        type: QueryTypes.UPDATE,
      }
    );

    const updatedItem = await sequelize.query(
      `
      SELECT
        id,
        item_name,
        sku_code,
        sale_rate AS selling_price,
        making_charge
      FROM items
      WHERE id = :item_id
      `,
      {
        replacements: { item_id },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Stock pricing updated successfully",
      data: updatedItem[0],
    });
  } catch (error) {
    console.error("Update Stock Pricing Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
export const getHeadStockItemsByCategory = async (req, res) => {
  try {
    const user = req.user;

    const { category } = req.params;
    const { search, metal_type } = req.query;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const organizationId = Number(user.organization_id);
    const storeCode = String(user.store_code || user.storeCode || "")
      .trim()
      .toUpperCase();

    if (!organizationId || !storeCode) {
      return res.status(400).json({
        success: false,
        message: "Head organization id or store code not found",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const itemWhere = {
      organization_id: organizationId,
      storeCode,
      category,
    };

    const stockWhere = {
      organization_id: organizationId,
      store_code: storeCode,
    };

    if (metal_type) {
      itemWhere.metal_type = metal_type;
    }

    if (search) {
      itemWhere[Op.or] = [
        { item_name: { [Op.iLike]: `%${search}%` } },
        { article_code: { [Op.iLike]: `%${search}%` } },
        { sku_code: { [Op.iLike]: `%${search}%` } },
        { purity: { [Op.iLike]: `%${search}%` } },
        { category: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const items = await Item.findAll({
      attributes: [
        "id",
        "article_code",
        "sku_code",
        "item_name",
        "metal_type",
        "category",
        "details",
        "purity",
        "gross_weight",
        "net_weight",
        "stone_weight",
        "stone_amount",
        "making_charge",
        "purchase_rate",
        "sale_rate",
        "hsn_code",
        "unit",
        "current_status",
        "store_id",
        "storeCode",
        "storeName",
        "organization_id",
        "createdAt",
        "updatedAt",
        "image_url",
      ],

      where: itemWhere,

      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          attributes: [
            "id",
            "organization_id",
            "item_id",
            "store_code",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
          where: stockWhere,
        },
      ],

      order: [["id", "DESC"]],
    });

    const data = items.map((item, index) => {
      const stock =
        Array.isArray(item.stocks) && item.stocks.length > 0
          ? item.stocks[0]
          : null;

      return {
        idx: index + 1,

        id: Number(item.id || 0),

        article_code: item.article_code || "",

        sku_code: item.sku_code || "",

        item_name: item.item_name || "",

        metal_type: item.metal_type || "",

        category: item.category || "",

        image_url: item.image_url || null,

        details: item.details || "",

        purity: item.purity || "",

        gross_weight: Number(item.gross_weight || 0),

        net_weight: Number(item.net_weight || 0),

        stone_weight: Number(item.stone_weight || 0),

        stone_amount: Number(item.stone_amount || 0),

        making_charge: Number(item.making_charge || 0),

        purchase_rate: Number(item.purchase_rate || 0),

        sale_rate: Number(item.sale_rate || 0),

        hsn_code: item.hsn_code || "",

        unit: item.unit || "",

        current_status: item.current_status || "",

        stock_id: stock ? Number(stock.id || 0) : null,

        quantity: Number(stock?.available_qty || 0),

        available_qty: Number(stock?.available_qty || 0),

        available_weight: Number(stock?.available_weight || 0),

        reserved_qty: Number(stock?.reserved_qty || 0),

        reserved_weight: Number(stock?.reserved_weight || 0),

        transit_qty: Number(stock?.transit_qty || 0),

        transit_weight: Number(stock?.transit_weight || 0),

        damaged_qty: Number(stock?.damaged_qty || 0),

        damaged_weight: Number(stock?.damaged_weight || 0),

        dead_qty: Number(stock?.dead_qty || 0),

        dead_weight: Number(stock?.dead_weight || 0),

        store_id: Number(item.store_id || 0),

        storeCode: item.storeCode || storeCode,

        storeName: item.storeName || null,

        organization_id: Number(item.organization_id || 0),

        createdAt: item.createdAt || null,

        updatedAt: item.updatedAt || null,

        action: "View",
      };
    });

    return res.status(200).json({
      success: true,

      message: `Head ${category} items fetched successfully`,

      organization_id: organizationId,

      store_code: storeCode,

      category,

      count: data.length,

      data,
    });
  } catch (error) {
    console.error("getHeadStockItemsByCategory error:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch head category items",

      error: error.message,
    });
  }
};
