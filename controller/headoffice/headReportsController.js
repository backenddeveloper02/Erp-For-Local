import sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";

// ✅ Currency Formatter
const formatCurrency = (num) => {
  if (!num) return "₹0";

  if (num >= 10000000) return "₹" + (num / 10000000).toFixed(1) + "Cr";
  if (num >= 100000) return "₹" + (num / 100000).toFixed(1) + "L";
  if (num >= 1000) return "₹" + (num / 1000).toFixed(1) + "K";

  return "₹" + num;
};

// ✅ Growth Calculator
const calcGrowth = (current, previous) => {
  if (!previous || previous === 0) return 0;
  return (((current - previous) / previous) * 100).toFixed(1);
};

export const getHeadOfficeReports = async (req, res) => {
  try {
    // ================= TOTAL REVENUE =================
    const [revenue] = await sequelize.query(`
      SELECT COALESCE(SUM(total_amount),0) AS value
      FROM invoices
      WHERE status IN ('PAID','PARTIAL')
    `, { type: QueryTypes.SELECT });

    // ================= TOTAL PROFIT =================
    const [profit] = await sequelize.query(`
      SELECT COALESCE(SUM(
        COALESCE(ii.total_amount,0) - (
          COALESCE(i.purchase_rate,0) * COALESCE(ii.quantity,1)
        )
      ),0) AS value
      FROM invoice_items ii
      JOIN items i ON i.id = ii.item_id
      JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE inv.status IN ('PAID','PARTIAL')
    `, { type: QueryTypes.SELECT });

    // ================= INVENTORY =================
    const [inventory] = await sequelize.query(`
      SELECT COALESCE(SUM(available_qty),0) AS value
      FROM stocks
    `, { type: QueryTypes.SELECT });

    // ================= AVG MONTHLY SALES =================
    const [avgSales] = await sequelize.query(`
  WITH months AS (
    SELECT generate_series(
      DATE_TRUNC(
        'month',
        (SELECT MIN(invoice_date) FROM invoices)
      ),
      DATE_TRUNC('month', CURRENT_DATE),
      INTERVAL '1 month'
    ) AS month
  ),

  monthly_sales AS (
    SELECT
      DATE_TRUNC('month', invoice_date) AS month,

      SUM(total_amount) AS sales

    FROM invoices

    WHERE status IN ('PAID','PARTIAL')

    GROUP BY month
  )

  SELECT COALESCE(
    AVG(
      COALESCE(ms.sales, 0)
    ),
    0
  ) AS value

  FROM months m

  LEFT JOIN monthly_sales ms
  ON ms.month = m.month
`, { type: QueryTypes.SELECT });

    // ================= LAST MONTH =================
    const [currMonth] = await sequelize.query(`
      SELECT COALESCE(SUM(total_amount),0) AS value
      FROM invoices
      WHERE status IN ('PAID','PARTIAL')
      AND DATE_TRUNC('month', invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
    `, { type: QueryTypes.SELECT });

    const [prevMonth] = await sequelize.query(`
      SELECT COALESCE(SUM(total_amount),0) AS value
      FROM invoices
      WHERE status IN ('PAID','PARTIAL')
      AND DATE_TRUNC('month', invoice_date) =
      DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
    `, { type: QueryTypes.SELECT });

    const growth = calcGrowth(currMonth.value, prevMonth.value);

    // ================= MONTHLY TREND =================
    // ================= MONTHLY TREND =================
const monthlyRaw = await sequelize.query(`
  SELECT 
    TO_CHAR(inv.invoice_date, 'Mon') AS label,

    DATE_TRUNC('month', inv.invoice_date) AS sort_date,

    SUM(inv.total_amount) AS sales,

    SUM(
      COALESCE(ii.total_amount,0) - (
        COALESCE(i.purchase_rate,0) *
        COALESCE(ii.quantity,1)
      )
    ) AS profit

  FROM invoices inv

  JOIN invoice_items ii
  ON ii.invoice_id = inv.id

  JOIN items i
  ON i.id = ii.item_id

  WHERE inv.status IN ('PAID','PARTIAL')

  GROUP BY label, sort_date

  ORDER BY sort_date
`, { type: QueryTypes.SELECT });

const monthlyTrend = monthlyRaw.map(m => ({
  label: m.label,
  sales: Number(m.sales || 0),
  profit: Number(m.profit || 0)
}));
    // ================= CATEGORY =================
    const categoryRaw = await sequelize.query(`
      SELECT i.category, SUM(ii.total_amount) AS value
      FROM invoice_items ii
      JOIN items i ON i.id = ii.item_id
      JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE inv.status IN ('PAID','PARTIAL')
      GROUP BY i.category
    `, { type: QueryTypes.SELECT });

    const categorySales = categoryRaw.map(c => ({
      label: c.category,
      value: Number(c.value || 0)
    }));

    // ================= METAL =================
    const metalRaw = await sequelize.query(`
      SELECT 
        CONCAT(i.metal_type::text, ' ', COALESCE(i.purity::text, '')) AS label,
        SUM(ii.total_amount) AS value
      FROM invoice_items ii
      JOIN items i ON i.id = ii.item_id
      JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE inv.status IN ('PAID', 'PARTIAL')
      GROUP BY i.metal_type, i.purity
      ORDER BY value DESC
    `, { type: QueryTypes.SELECT });

    const metalDistribution = metalRaw.map(m => ({
      label: m.label,
      value: Number(m.value || 0)
    }));

    // ================= DAILY =================
    const dailyRaw = await sequelize.query(`
      SELECT DATE(invoice_date) AS d, SUM(total_amount) AS sales
      FROM invoices
      WHERE invoice_date >= CURRENT_DATE - INTERVAL '30 days'
      AND status IN ('PAID','PARTIAL')
      GROUP BY d
      ORDER BY d
    `, { type: QueryTypes.SELECT });

    const dailyTrend = dailyRaw.map(d => ({
      label: d.d,
      sales: Number(d.sales || 0)
    }));

    // ================= INVENTORY AUDIT REPORT =================
    const auditRaw = await sequelize.query(`
      SELECT
        i.id,
        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,
        COALESCE(i.net_weight,0) AS net_weight,
        COALESCE(i.stone_weight,0) AS stone_weight,
        COALESCE(i.gross_weight,0) AS gross_weight,
        COALESCE(i.is_item_audit,false) AS checklist,
        i.last_audit_status,
        i.last_audit_reason
      FROM items i
      ORDER BY i.id DESC
    `, { type: QueryTypes.SELECT });

    const inventoryAuditReport = auditRaw.map(i => ({
      id: i.id,
      item: i.item_name,
      code: i.article_code,
      sku_code: i.sku_code,
      category: i.category,
      metal_type: i.metal_type,
      purity: i.purity,
      netWt: `${Number(i.net_weight || 0)}g`,
      stoneWt: `${Number(i.stone_weight || 0)}g`,
      grossWt: `${Number(i.gross_weight || 0)}g`,
      checklist: Boolean(i.checklist),
      audit_status: i.last_audit_status || "pending",
      audit_reason: i.last_audit_reason || null
    }));

    // ================= FINAL RESPONSE =================
    return res.json({
      success: true,
      data: {
        cards: {
          totalRevenue: formatCurrency(revenue.value),
          totalProfit: formatCurrency(profit.value),
          totalInventory: Number(inventory.value || 0),
          avgMonthlySales: formatCurrency(avgSales.value),
          growth: growth + "%"
        },
        monthlyTrend,
        categorySales,
        metalDistribution,
        dailyTrend,

        // ✅ only new added
        // inventoryAuditReport
      }
    });

  } catch (err) {
    console.error("❌ Dashboard Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
