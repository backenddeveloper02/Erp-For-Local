// // controllers/headOfficeController.js

// import sequelize from "../config/db.js";
// import { QueryTypes } from "sequelize";

// export const getHeadOfficeStock = async (req, res) => {
//   try {
//     const { search = "", category = "" } = req.query;

//     const user = {
//       organization_level: req.headers.organization_level,
//       store_code: req.headers.store_code, 
//     };

    
//     if (user.organization_level !== "head_office") {
//       return res.status(403).json({ message: "Access denied" });
//     }

    

//     const summary = await sequelize.query(
//       `
//       SELECT
//         COUNT(i.id) AS total_items,

//         COUNT(
//           CASE 
//             WHEN i."createdAt" < NOW() - INTERVAL '90 days'
//             THEN 1
//           END
//         ) AS dead_stock,

//         COUNT(
//           CASE 
//             WHEN s.available_qty < 25
//             THEN 1
//           END
//         ) AS low_stock,

//         COALESCE(SUM(s.transit_qty), 0) AS transit_stock

//       FROM items i

//       LEFT JOIN stocks s 
//         ON i.id = s.item_id

//       LEFT JOIN stores st 
//         ON st.id = s.organization_id

//       WHERE st.store_code = :storeCode;
//       `,
//       {
//         replacements: {
//           storeCode: user.store_code, 
//         },
//         type: QueryTypes.SELECT,
//       }
//     );

   

//     const inventory = await sequelize.query(
//       `
//       SELECT 
//         i.id,
//         i.item_name AS item,
//         i.article_code AS code,

//         COALESCE(s.available_qty, 0) AS quantity,

//         i.purchase_rate AS purchase_price,
//         i.sale_rate AS selling_price,
//         i.making_charge,
//         i.purity,

//         ROUND(i.net_weight::numeric, 3) AS net_weight,
//         ROUND(i.stone_weight::numeric, 3) AS stone_weight,
//         ROUND(i.gross_weight::numeric, 3) AS gross_weight

//       FROM items i

//       LEFT JOIN stocks s 
//         ON i.id = s.item_id

//       LEFT JOIN stores st 
//         ON st.id = s.organization_id

//       WHERE 
//         st.store_code = :storeCode
//         AND (:search = '' OR i.item_name ILIKE '%' || :search || '%')
//         AND (:category = '' OR i.category = :category)

//       ORDER BY i."createdAt" DESC;
//       `,
//       {
//         replacements: {
//           storeCode: user.store_code,
//           search,
//           category,
//         },
//         type: QueryTypes.SELECT,
//       }
//     );

//     return res.json({
//       success: true,
//       data: {
//         summary: {
//           total_items: Number(summary[0]?.total_items || 0),
//           dead_stock: Number(summary[0]?.dead_stock || 0),
//           low_stock: Number(summary[0]?.low_stock || 0),
//           transit_stock: Number(summary[0]?.transit_stock || 0),
//         },
//         inventory,
//       },
//     });

//   } catch (error) {
//     console.error("Head Office Stock Error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong",
//     });
//   }
// };




import sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";

export const getOverallInventoryDashboard = async (req, res) => {
  try {
    // ================= CARDS =================
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
      `,
      { type: QueryTypes.SELECT }
    );

    // ================= TABLE DATA =================
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

      GROUP BY i.category

      ORDER BY MAX(i."createdAt") DESC
      `,
      { type: QueryTypes.SELECT }
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

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


export const getOverallCategoryItems = async (req, res) => {
  try {
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

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

      GROUP BY 
        i.id,
        i.item_name,
        i.sku_code,
        i.image_url,
        i.purity

      ORDER BY i.item_name ASC
      `,
      {
        replacements: { category },
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
export const updateStockPricing = async (req, res) => {
  try {
    const { item_id, selling_price, making_charge } = req.body;

    // ================= VALIDATION =================
    if (!item_id) {
      return res.status(400).json({
        success: false,
        message: "item_id is required",
      });
    }

    // ================= CHECK ITEM EXISTS =================
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

    // ================= UPDATE QUERY =================
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
    // ================= UPDATED DATA =================
    const updatedItem = await sequelize.query(
      `
      SELECT
        id,
        item_name,
        sku_code,
        sale_rate as selling_price,
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
