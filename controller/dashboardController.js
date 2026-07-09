import { Op, fn, col, literal, QueryTypes } from "sequelize";
import sequelize from "../config/db.js";
import Item from "../model/item.js";
import Stock from "../model/stockrecord.js";
import StockMovement from "../model/stockmovement.js";
import SystemActivity from "../model/systemActivity.js";
import Task from "../model/task.js";
import MetalRate from "../model/metalRate.js";
import Customer from "../model/Customer.js";
import axios from "axios";
// import Invoice from "../model/Invoice.js";

const hasAttr = (model, attr) => !!model?.rawAttributes?.[attr];

const pickAttr = (model, attrs = []) => {
  for (const attr of attrs) {
    if (hasAttr(model, attr)) return attr;
  }
  return null;
};

const normalize = (v) => String(v || "").toLowerCase().trim();

const getCreatedKey = (model) =>
  pickAttr(model, ["created_at", "createdAt", "updated_at", "updatedAt"]) ||
  "createdAt";

const buildScopedWhere = (model, user = {}, extra = {}) => {
  const role = normalize(user.role);
  const level = normalize(user.organization_level);

  const where = { ...extra };

  // Full access
  if (
    role === "super_admin" ||
    role === "capital" ||
    level === "central" ||
    level === "head_office"
  ) {
    return where;
  }

  const orgKey = pickAttr(model, [
    "organization_id",
    "organizationId",
    "branch_id",
    "branchId",
  ]);
  const stateKey = pickAttr(model, ["state_code", "stateCode"]);
  const districtKey = pickAttr(model, ["district_code", "districtCode"]);
  const storeKey = pickAttr(model, ["store_code", "storeCode"]);

  // State
  if (level === "state" || role === "state_manager") {
    if (stateKey && user.state_code) {
      where[stateKey] = user.state_code;
      return where;
    }
    if (orgKey && user.organization_id) {
      where[orgKey] = user.organization_id;
      return where;
    }
    return null;
  }

  // District
  if (level === "district" || role === "district_manager") {
    if (districtKey && user.district_code) {
      where[districtKey] = user.district_code;
      return where;
    }
    if (orgKey && user.organization_id) {
      where[orgKey] = user.organization_id;
      return where;
    }
    return null;
  }

  // Store / Retail
  if (
    [
      "manager",
      "admin",
      "sales_girl",
      "tl",
      "store_manager",
      "inventory_manager",
      "retail-manager",
      "retail_manager",
      "cashier",
      "salesman",
      "salesperson",
    ].includes(role) ||
    level === "retail" ||
    level === "store"
  ) {
    if (storeKey && user.store_code) {
      where[storeKey] = user.store_code;
      return where;
    }
    if (orgKey && user.organization_id) {
      where[orgKey] = user.organization_id;
      return where;
    }
    return null;
  }

  // fallback
  if (orgKey && user.organization_id) {
    where[orgKey] = user.organization_id;
    return where;
  }

  return where;
};

const getSafeWhere = (model, user, extra = {}) => {
  const scoped = buildScopedWhere(model, user, extra);
  return scoped === null ? null : scoped;
};

const num = (v) => Number(v || 0);

// ✅ ONLY ADDED: Same live Gold/Silver logic as Head Dashboard
const getLiveGoldSilverPrice = async () => {
  let goldPrice = 0;
  let silverPrice = 0;

  try {
    const [goldRes, silverRes, rateRes] = await Promise.all([
      axios.get("https://api.gold-api.com/price/XAU", { timeout: 8000 }),
      axios.get("https://api.gold-api.com/price/XAG", { timeout: 8000 }),
      axios.get("https://open.er-api.com/v6/latest/USD", { timeout: 8000 }),
    ]);

    const usdToInr = Number(rateRes?.data?.rates?.INR || 0);
    const ounceToGram = 31.1035;

    const goldUsdPerOunce = Number(goldRes?.data?.price || 0);
    const silverUsdPerOunce = Number(silverRes?.data?.price || 0);

    if (usdToInr > 0 && goldUsdPerOunce > 0) {
      // 24K gold per gram INR
      goldPrice = (goldUsdPerOunce / ounceToGram) * usdToInr;
    }

    if (usdToInr > 0 && silverUsdPerOunce > 0) {
      // Silver 925 per gram INR
      const silver999 = (silverUsdPerOunce / ounceToGram) * usdToInr;
      silverPrice = silver999 * 0.925;
    }
  } catch (error) {
    console.log("Gold/Silver live price API error:", error.message);
  }

  return {
    goldPrice: Number(goldPrice.toFixed(2)),
    silverPrice: Number(silverPrice.toFixed(2)),
  };
};

const getUserScopeSql = (user, alias = "") => {
  const p = alias ? `${alias}.` : "";
  const role = String(user?.role || "").toLowerCase();

  if (role.startsWith("super_") || role === "super_admin") {
    return { sql: "", replacements: {} };
  }

  if (user?.organization_id && user?.store_code) {
    return {
      sql: ` AND ${p}organization_id = :organization_id AND ${p}store_code = :store_code`,
      replacements: {
        organization_id: user.organization_id,
        store_code: user.store_code,
      },
    };
  }

  if (user?.organization_id) {
    return {
      sql: ` AND ${p}organization_id = :organization_id`,
      replacements: {
        organization_id: user.organization_id,
      },
    };
  }

  if (user?.store_code) {
    return {
      sql: ` AND ${p}store_code = :store_code`,
      replacements: {
        store_code: user.store_code,
      },
    };
  }

  return { sql: " AND 1=0", replacements: {} };
};

// INDIA LOCAL DATE LABELS (IMPORTANT FIX)
const getLast7DaysLabelsIndia = () => {
  const labels = [];
  const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);

    // India local yyyy-mm-dd
    const indiaDate = new Date(
      d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );

    const yyyy = indiaDate.getFullYear();
    const mm = String(indiaDate.getMonth() + 1).padStart(2, "0");
    const dd = String(indiaDate.getDate()).padStart(2, "0");

    labels.push({
      label: dayMap[indiaDate.getDay()],
      fullDate: `${yyyy}-${mm}-${dd}`,
    });
  }

  return labels;
};

export const getDashboardSummary = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const role = String(
      req.user?.role || ""
    ).toLowerCase();

    const isSuper =
      role === "super_admin" ||
      role.startsWith("super_");

    const organizationId =
      req.user?.organization_id;

    const storeCode = String(
      req.user?.store_code || ""
    )
      .trim()
      .toUpperCase();

    if (!isSuper && !storeCode) {
      return res.status(403).json({
        success: false,
        message:
          "Store code missing in token",
      });
    }

    const replacements = {
      organization_id:
        organizationId,

      store_code: storeCode,
    };

    // =====================================================
    // SAME FILTER EVERYWHERE
    // =====================================================

    const stockWhere = isSuper
      ? ""
      : `
        AND s.store_code = :store_code
      `;

    const movementWhere = isSuper
      ? ""
      : `
        AND sm.organization_id = :organization_id
      `;

    const taskWhere = isSuper
      ? ""
      : `
        AND t.store_code = :store_code
      `;

    const activityWhere = isSuper
      ? ""
      : `
        AND sa.store_code = :store_code
      `;

    // =====================================================
    // CENTRALIZED STOCK SUMMARY
    // =====================================================

    const stockSummary =
      await sequelize.query(
        `
        SELECT
          COALESCE(
            SUM(s.available_qty),
            0
          )::numeric AS total_stock,

          COALESCE(
            SUM(s.transit_qty),
            0
          )::numeric AS transit_goods,

          COUNT(
            DISTINCT CASE
              WHEN
                s.available_qty > 0

                AND s.available_qty <= 5

              THEN s.item_id
            END
          )::int AS low_stock_items,

          COUNT(
            DISTINCT CASE
              WHEN
                s.available_qty > 0

                AND i."createdAt"
                < NOW() - INTERVAL '30 days'

                AND NOT EXISTS (

                  SELECT 1

                  FROM invoice_items ii

                  INNER JOIN invoices inv
                  ON inv.id = ii.invoice_id

                  WHERE ii.item_id = i.id

                  AND inv."createdAt"
                  > NOW() - INTERVAL '30 days'
                )

              THEN i.id
            END
          )::int AS dead_stock_items

        FROM stocks s

        INNER JOIN items i
        ON i.id = s.item_id

        WHERE 1=1

        ${stockWhere}
        `,
        {
          replacements,

          type:
            QueryTypes.SELECT,
        }
      );

    const stock =
      stockSummary?.[0] || {};

    // =====================================================
    // LIVE GOLD / SILVER RATE
    // =====================================================

    const {
      goldPrice,
      silverPrice,
    } =
      await getLiveGoldSilverPrice();

    // =====================================================
    // LAST 7 DAYS SALES TREND
    // =====================================================

    const labels =
      getLast7DaysLabelsIndia();

    const startDate =
      labels[0].fullDate;

    const endDate =
      labels[
        labels.length - 1
      ].fullDate;

    const salesTrendRaw =
      await sequelize.query(
        `
        SELECT
          DATE(
            sm.created_at
            AT TIME ZONE 'Asia/Kolkata'
          ) AS date,

          COUNT(sm.id)::int AS count

        FROM stock_movements sm

        WHERE
          sm.movement_type = 'sale'

          ${movementWhere}

          AND DATE(
            sm.created_at
            AT TIME ZONE 'Asia/Kolkata'
          )
          BETWEEN :startDate
          AND :endDate

        GROUP BY
          DATE(
            sm.created_at
            AT TIME ZONE 'Asia/Kolkata'
          )

        ORDER BY
          DATE(
            sm.created_at
            AT TIME ZONE 'Asia/Kolkata'
          ) ASC
        `,
        {
          replacements: {
            ...replacements,

            startDate,

            endDate,
          },

          type:
            QueryTypes.SELECT,
        }
      );

    const salesMap = new Map(
      salesTrendRaw.map(
        (row) => [
          String(row.date),

          Number(
            row.count || 0
          ),
        ]
      )
    );

    const salesTrends =
      labels.map((d) => ({
        day: d.label,

        date: d.fullDate,

        sales_count:
          salesMap.get(
            d.fullDate
          ) || 0,
      }));

    // =====================================================
    // SALES BY CATEGORY
    // =====================================================

    const salesByCategoryRaw =
      await sequelize.query(
        `
        SELECT
          COALESCE(
            i.category::text,
            'Other'
          ) AS category,

          COUNT(sm.id)::int AS count

        FROM stock_movements sm

        INNER JOIN items i
        ON i.id = sm.item_id

        WHERE
          sm.movement_type = 'sale'

          ${movementWhere}

        GROUP BY i.category

        ORDER BY count DESC
        `,
        {
          replacements,

          type:
            QueryTypes.SELECT,
        }
      );

    const totalCategoryCount =
      salesByCategoryRaw.reduce(
        (sum, row) =>
          sum +
          Number(
            row.count || 0
          ),
        0
      );

    const salesByCategory =
      salesByCategoryRaw.map(
        (row) => ({
          category:
            row.category ||
            "Other",

          count: Number(
            row.count || 0
          ),

          percentage:
            totalCategoryCount > 0
              ? Number(
                  (
                    (Number(
                      row.count || 0
                    ) /
                      totalCategoryCount) *
                    100
                  ).toFixed(2)
                )
              : 0,
        })
      );

    // =====================================================
    // PENDING TASKS
    // =====================================================

    const pendingTasks =
      await sequelize.query(
        `
        SELECT t.*

        FROM tasks t

        WHERE
          LOWER(
            t.status::text
          ) = 'pending'

          ${taskWhere}

        ORDER BY t.created_at DESC

        LIMIT 5
        `,
        {
          replacements,

          type:
            QueryTypes.SELECT,
        }
      );

    // =====================================================
    // RECENT ACTIVITIES
    // =====================================================

    const recentActivities =
      await sequelize.query(
        `
        SELECT sa.*

        FROM system_activities sa

        WHERE 1=1

        ${activityWhere}

        ORDER BY sa.created_at DESC

        LIMIT 5
        `,
        {
          replacements,

          type:
            QueryTypes.SELECT,
        }
      );

    // =====================================================
    // FINAL RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      message:
        "Dashboard fetched successfully",

      data: {
        cards: {
          // ✅ TOTAL STOCK QTY
          total_stock: Number(
            stock.total_stock || 0
          ),

          // ✅ DEAD STOCK
          dead_stock_items:
            Number(
              stock.dead_stock_items ||
                0
            ),

          // ✅ LOW STOCK
          low_stock_items:
            Number(
              stock.low_stock_items ||
                0
            ),

          // ✅ TRANSIT QTY SUM
          transit_goods:
            Number(
              stock.transit_goods ||
                0
            ),

          // ✅ LIVE RATE
          gold_price:
            goldPrice,

          silver_price:
            silverPrice,
        },

        charts: {
          sales_trends:
            salesTrends,

          sales_by_category:
            salesByCategory,
        },

        pending_tasks:
          pendingTasks,

        recent_activities:
          recentActivities,
      },
    });
  } catch (error) {
    console.error(
      "Dashboard Summary Error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to fetch dashboard",

      error: error.message,
    });
  }
};
export const getAllReports = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const role = String(req.user?.role || "").toLowerCase();
    const isSuper = role === "super_admin" || role.startsWith("super_");

    const organizationId = req.user?.organization_id; // retail store id
    const storeCode = req.user?.store_code;

    if (!isSuper && !organizationId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view reports",
      });
    }

    const salesWhere = isSuper
      ? ""
      : ` AND sm.organization_id = :organization_id`;

    const invoiceWhere = isSuper
      ? ""
      : ` AND inv.store_code = :store_code`;

    const itemWhere = isSuper
      ? ""
      : ` AND i."storeCode" = :store_code`;

    const replacements = {
      organization_id: organizationId,
      store_code: storeCode,
    };

    // =====================================================
    // CUSTOMER COUNT
    // =====================================================
    const customerWhere = {};
    if (!isSuper && storeCode) {
      customerWhere.store_code = storeCode;
    }

    const totalCustomers = await Customer.count({
      where: customerWhere,
    });

    // =====================================================
    // SALES FROM STOCK_MOVEMENTS
    // =====================================================
    const salesSummary = await sequelize.query(
      `
      SELECT
        COALESCE(SUM(sm.total_amount),0) AS total_revenue,
        COUNT(sm.id)::int AS total_sales
      FROM stock_movements sm
      WHERE sm.movement_type = 'sale'
      ${salesWhere}
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // CASH / PENDING FROM INVOICES
    // =====================================================
    const paymentSummary = await sequelize.query(
      `
      SELECT
        COALESCE(SUM(inv.received_amount),0) AS total_cash_received,
        COALESCE(SUM(inv.pending_amount),0) AS account_transfer
      FROM invoices inv
      WHERE 1=1
      ${invoiceWhere}
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // METAL RATES - ONLY ADDED FOR DISTRICT REPORT DASHBOARD
    // =====================================================
    //  ONLY MODIFIED: DB metal_rates ki jagah live Head Dashboard wali value
    const { goldPrice, silverPrice } = await getLiveGoldSilverPrice();

    const s = salesSummary[0] || {};
    const p = paymentSummary[0] || {};

    const dashboardSummary = {
      totalCustomers: num(totalCustomers),
      totalRevenue: num(s.total_revenue),
      totalSales: num(s.total_sales),
      totalCashReceived: num(p.total_cash_received),
      accountTransfer: num(p.account_transfer),

      //  ONLY MODIFIED
      gold_price: goldPrice,
      silver_price: silverPrice,
    };

    // =====================================================
// LAST 7 DAYS CASH FLOW
// =====================================================
const labels = getLast7DaysLabelsIndia();
const startDate = labels[0].fullDate;
const endDate = labels[labels.length - 1].fullDate;

const cashRaw = await sequelize.query(
  `
  SELECT
      DATE(inv.invoice_date AT TIME ZONE 'Asia/Kolkata') AS date,

      COALESCE(
          SUM(
              CASE
                  WHEN UPPER(pay.payment_method) = 'CASH'
                  THEN pay.amount
                  ELSE 0
              END
          ),
      0) AS cash,

      COALESCE(
          SUM(
              CASE
                  WHEN pay.payment_method IS NOT NULL
                       AND UPPER(pay.payment_method) <> 'CASH'
                  THEN pay.amount
                  ELSE 0
              END
          ),
      0) AS account_transfer,

      COALESCE(SUM(inv.pending_amount),0) AS pending,
      COALESCE(SUM(inv.total_amount),0) AS total

  FROM invoices inv

  LEFT JOIN payments pay
      ON pay.invoice_id = inv.id

  WHERE DATE(inv.invoice_date AT TIME ZONE 'Asia/Kolkata')
        BETWEEN :startDate AND :endDate
        ${invoiceWhere}

  GROUP BY DATE(inv.invoice_date AT TIME ZONE 'Asia/Kolkata')
  ORDER BY DATE(inv.invoice_date AT TIME ZONE 'Asia/Kolkata')
  `,
  {
    replacements: {
      ...replacements,
      startDate,
      endDate,
    },
    type: QueryTypes.SELECT,
  }
);

const cashMap = new Map(cashRaw.map((r) => [String(r.date), r]));

const cashVsAccount = labels.map((d) => {
  const row = cashMap.get(d.fullDate) || {};

  return {
    date: d.fullDate,
    day: d.label,
    cash: num(row.cash),
    accountTransfer: num(row.account_transfer),
    pending: num(row.pending),
    total: num(row.total),
  };
});

    // =====================================================
    // CATEGORY SALES FROM STOCK_MOVEMENTS
    // =====================================================
    const categoryRaw = await sequelize.query(
      `
      SELECT
        COALESCE(i.category::text, 'Others') AS category,
        COUNT(sm.id)::int AS total_items
      FROM stock_movements sm
      LEFT JOIN items i ON i.id = sm.item_id
      WHERE sm.movement_type = 'sale'
      ${salesWhere}
      GROUP BY i.category
      ORDER BY total_items DESC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const totalCategoryItems = categoryRaw.reduce(
      (sum, item) => sum + num(item.total_items),
      0
    );

    const categorySales = categoryRaw.map((item) => ({
      category: item.category,
      revenue: num(item.total_items),
      percentage: totalCategoryItems
        ? Number(((num(item.total_items) / totalCategoryItems) * 100).toFixed(0))
        : 0,
    }));

    // =====================================================
    // TYPE DISTRIBUTION FROM ITEMS
    // =====================================================
    const typeDistributionRaw = await sequelize.query(
      `
      SELECT
        CASE
          WHEN TRIM(
            CONCAT(
              COALESCE(i.metal_type::text, ''),
              CASE
                WHEN i.purity IS NOT NULL AND i.purity::text <> ''
                THEN ' ' || i.purity::text
                ELSE ''
              END
            )
          ) = ''
          THEN 'Unknown'
          ELSE TRIM(
            CONCAT(
              COALESCE(i.metal_type::text, ''),
              CASE
                WHEN i.purity IS NOT NULL AND i.purity::text <> ''
                THEN ' ' || i.purity::text
                ELSE ''
              END
            )
          )
        END AS label,
        COUNT(i.id)::int AS value
      FROM items i
      WHERE 1=1
      ${itemWhere}
      GROUP BY i.metal_type, i.purity
      ORDER BY value DESC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const typeDistribution = typeDistributionRaw.map((item) => ({
      label: item.label || "Unknown",
      value: num(item.value),
    }));

    // =====================================================
    // TOP PRODUCTS FROM STOCK_MOVEMENTS
    // =====================================================
    const topProductsRaw = await sequelize.query(
      `
      SELECT
        i.id,
        i.item_name,
        COALESCE(i.category::text, 'Others') AS category,
        COALESCE(SUM(sm.qty),0) AS units_sold,
        COALESCE(SUM(sm.total_amount),0) AS total_revenue
      FROM stock_movements sm
      LEFT JOIN items i ON i.id = sm.item_id
      WHERE sm.movement_type = 'sale'
      ${salesWhere}
      GROUP BY i.id, i.item_name, i.category
      ORDER BY total_revenue DESC, units_sold DESC
      LIMIT 5
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const maxRevenue =
      topProductsRaw.length > 0 ? num(topProductsRaw[0].total_revenue) : 0;

    const topProducts = topProductsRaw.map((item, index) => ({
      rank: index + 1,
      product_name: item.item_name,
      category: item.category,
      units_sold: num(item.units_sold),
      total_revenue: num(item.total_revenue),
      performance: maxRevenue
        ? Math.round((num(item.total_revenue) / maxRevenue) * 100)
        : 0,
    }));

    return res.status(200).json({
      success: true,
      message: "Reports fetched successfully",
      data: {
        dashboardSummary,
        cashVsAccount,
        categorySales,
        typeDistribution,
        topProducts,
      },
    });
  } catch (error) {
    console.error("getAllReports error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reports",
      error: error.message,
    });
  }
};

export const getStoreReports = async (req, res) => {
  try {
    const storeCode = req.headers.store_code;

    if (!storeCode) {
      return res.status(400).json({
        success: false,
        message: "store_code is required",
      });
    }

    // ================= DASHBOARD =================
    const totalCustomers = await sequelize.query(
      `
      SELECT COUNT(*) as count 
      FROM customers 
      WHERE store_code = '${storeCode}'
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    const totalRevenue = await sequelize.query(
      `
      SELECT COALESCE(SUM(total_amount),0) as total
      FROM invoices
      WHERE store_code = '${storeCode}'
      AND status IN ('PAID','PARTIAL')
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    const totalSales = await sequelize.query(
      `
      SELECT COUNT(*) as count
      FROM invoices
      WHERE store_code = '${storeCode}'
      AND status IN ('PAID','PARTIAL')
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    const dashboardSummary = {
      totalCustomers: Number(totalCustomers[0].count),
      totalRevenue: Number(totalRevenue[0].total),
      totalSales: Number(totalSales[0].count),
    };

    // ================= CASH VS ACCOUNT =================
    const cashVsAccount = await sequelize.query(
      `
      SELECT 
        DATE(p.payment_date) as date,
        TO_CHAR(p.payment_date, 'Dy') as day,

        SUM(CASE WHEN p.payment_method = 'CASH' THEN p.amount ELSE 0 END) as cash,
        SUM(CASE WHEN p.payment_method != 'CASH' THEN p.amount ELSE 0 END) as online,
        SUM(p.amount) as total

      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      WHERE inv.store_code = '${storeCode}'
      AND inv.status IN ('PAID','PARTIAL')

      GROUP BY DATE(p.payment_date), TO_CHAR(p.payment_date, 'Dy')
      ORDER BY DATE(p.payment_date)
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    // ================= CATEGORY SALES =================
    const categoryRaw = await sequelize.query(
      `
      SELECT 
        i.category,
        SUM(ii.total_amount) as total_revenue
      FROM invoice_items ii
      JOIN items i ON i.id = ii.item_id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE inv.store_code = '${storeCode}'
      AND inv.status IN ('PAID','PARTIAL')
      GROUP BY i.category
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    const totalCategoryRevenue = categoryRaw.reduce(
      (sum, item) => sum + Number(item.total_revenue),
      0
    );

    const categorySales = categoryRaw.map((item) => ({
      category: item.category,
      percentage: totalCategoryRevenue
        ? Math.round((item.total_revenue / totalCategoryRevenue) * 100)
        : 0,
    }));

    // ================= TYPE DISTRIBUTION =================
    const typeDistribution = await sequelize.query(
      `
      SELECT 
        CONCAT(i.metal_type, ' ', i.purity) as label,
        SUM(ii.total_amount) as value
      FROM invoice_items ii
      JOIN items i ON i.id = ii.item_id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE inv.store_code = '${storeCode}'
      AND inv.status IN ('PAID','PARTIAL')
      GROUP BY i.metal_type, i.purity
      ORDER BY value DESC
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    // ================= TOP PRODUCTS =================
    const topProductsRaw = await sequelize.query(
      `
      SELECT 
        i.item_name,
        i.category,
        COUNT(ii.id) as units_sold,
        COALESCE(SUM(ii.total_amount), 0) as total_revenue
      FROM invoice_items ii
      JOIN items i ON i.id = ii.item_id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE inv.store_code = '${storeCode}'
      AND inv.status IN ('PAID','PARTIAL')
      GROUP BY i.id, i.item_name, i.category
      ORDER BY total_revenue DESC
      LIMIT 5
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    const maxRevenue = topProductsRaw.length
      ? Number(topProductsRaw[0].total_revenue)
      : 0;

    const topProducts = topProductsRaw.map((item, index) => ({
      rank: index + 1,
      product_name: item.item_name,
      category: item.category,
      units_sold: Number(item.units_sold),
      total_revenue: Number(item.total_revenue),
      performance: maxRevenue
        ? Math.round((item.total_revenue / maxRevenue) * 100)
        : 0,
    }));

    // ================= FINAL RESPONSE =================
    res.json({
      success: true,
      store_code: storeCode,
      data: {
        dashboardSummary,
        cashVsAccount,
        categorySales,
        typeDistribution,
        topProducts,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
