import sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";
import axios from "axios";

export const getFullDashboard = async (req, res) => {
  try {

    let goldPrice = 0;
    let silverPrice = 0;

    // ================= GOLD & SILVER PRICE =================
    try {

      // Gold & Silver (USD per ounce)
      const goldRes = await axios.get(
        "https://api.gold-api.com/price/XAU"
      );

      const silverRes = await axios.get(
        "https://api.gold-api.com/price/XAG"
      );

      // USD → INR
      const rateRes = await axios.get(
        "https://open.er-api.com/v6/latest/USD"
      );

      const usdToInr = rateRes.data.rates.INR;

      const ounceToGram = 31.1035;

      // Gold 24K per gram INR
      const gold24K =
        ((goldRes.data.price || 0) / ounceToGram) *
        usdToInr;

      // Silver 925 per gram INR
      const silver999 =
        ((silverRes.data.price || 0) / ounceToGram) *
        usdToInr;

      const silver925 = silver999 * 0.925;

      goldPrice = gold24K;
      silverPrice = silver925;

    } catch (err) {

      console.log(
        "API Error:",
        err.message
      );
    }

    // ================= CARDS =================

    // LIVE AVAILABLE STOCK
    const [totalStock] = await sequelize.query(
      `
      SELECT 
        COALESCE(SUM(s.available_qty), 0) as total
      FROM stocks s
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    // STOCK VALUE
    const [stockValue] = await sequelize.query(
      `
      SELECT 
        COALESCE(
          SUM(s.available_qty * i.purchase_rate),
          0
        ) as total

      FROM stocks s

      JOIN items i
      ON i.id = s.item_id
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    // ================= DEAD STOCK =================

    const [deadStockData] = await sequelize.query(
      `
      SELECT 
  COUNT(DISTINCT i.id) AS dead_stock

FROM items i

JOIN stocks s
ON s.item_id = i.id

WHERE s.available_qty > 0

AND i."createdAt"
< NOW() - INTERVAL '30 days'

AND NOT EXISTS (

  SELECT 1

  FROM invoice_items ii

  JOIN invoices inv
  ON inv.id = ii.invoice_id

  WHERE ii.item_id = i.id

  AND inv."createdAt"
  > NOW() - INTERVAL '30 days'
)
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const deadPercent =
      Number(deadStockData.total_stock) > 0
        ? (
            (
              Number(deadStockData.dead_stock) /
              Number(deadStockData.total_stock)
            ) * 100
          ).toFixed(2)
        : 0;

    // ================= TRANSIT STOCK =================

    const [transitStock] = await sequelize.query(
      `
      SELECT 
        COALESCE(SUM(transit_qty), 0) as total

      FROM stocks
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    // ================= SALES TREND =================

    const salesTrend = await sequelize.query(
      `
      SELECT 
        TO_CHAR(inv."createdAt", 'Mon') as label,

        SUM(ii.total_amount) as sales

      FROM invoice_items ii

      JOIN invoices inv
      ON inv.id = ii.invoice_id

      GROUP BY label
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    // ================= PURCHASE TREND =================

    const purchaseTrend = await sequelize.query(
      `
      SELECT 
        TO_CHAR(sm.created_at,'Mon') as label,

        ROUND(
          SUM(sm.qty * i.purchase_rate)::numeric,
          2
        ) as purchase

      FROM stock_movements sm

      JOIN items i
      ON i.id = sm.item_id

      WHERE sm.movement_type IN (
        'purchase',
        'adjustment_in',
        'return_in'
      )

      GROUP BY label

      ORDER BY MIN(sm.created_at)
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const trendMap = {};

    salesTrend.forEach((s) => {

      trendMap[s.label] = {
        label: s.label,
        sales: Number(s.sales),
        purchase: 0,
      };
    });

    purchaseTrend.forEach((p) => {

      if (!trendMap[p.label]) {

        trendMap[p.label] = {
          label: p.label,
          sales: 0,
          purchase: Number(p.purchase),
        };

      } else {

        trendMap[p.label].purchase =
          Number(p.purchase);
      }
    });

    const salesPurchaseTrend =
      Object.values(trendMap);

    // ================= PROFIT LOSS =================

    const profitLossRaw = await sequelize.query(
      `
      SELECT 
        TO_CHAR(
          inv."createdAt",
          'YYYY-MM'
        ) as label,

        SUM(ii.total_amount) as revenue,

        SUM(
          i.purchase_rate * ii.quantity
        ) as cost

      FROM invoice_items ii

      JOIN invoices inv
      ON inv.id = ii.invoice_id

      JOIN items i
      ON i.id = ii.item_id

      GROUP BY label

      ORDER BY label
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const profitLoss = profitLossRaw.map(
      (row) => {

        const profit =
          Number(row.revenue) -
          Number(row.cost);

        return {
          label: row.label,
          profit:
            profit > 0 ? profit : 0,
          loss:
            profit < 0
              ? Math.abs(profit)
              : 0,
        };
      }
    );

    // ================= REVENUE TREND =================

    const revenueTrendRaw = await sequelize.query(
      `
      SELECT 
        TO_CHAR(invoice_date, 'Mon') as label,

        SUM(total_amount) as revenue

      FROM invoices

      WHERE status IN (
        'PAID',
        'PARTIAL'
      )

      GROUP BY label

      ORDER BY MIN(invoice_date)
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const revenueTrend =
      revenueTrendRaw.map((r) => ({
        label: r.label,
        revenue: Number(r.revenue),
      }));

    // ================= TOP PRODUCTS =================

    const topProducts = await sequelize.query(
      `
      SELECT 
        i.item_name,

        SUM(ii.quantity) as units_sold,

        SUM(ii.total_amount) as revenue

      FROM invoice_items ii

      JOIN items i
      ON i.id = ii.item_id

      GROUP BY i.item_name

      ORDER BY revenue DESC

      LIMIT 5
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    // ================= RECENT ACTIVITIES =================

    const salesAct = await sequelize.query(
      `
      SELECT 
        'Sales Transaction' as title,

        CONCAT(
          'Sale completed - ₹',
          total_amount
        ) as description,

        "createdAt" as time

      FROM invoices

      ORDER BY "createdAt" DESC

      LIMIT 3
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const stockAct = await sequelize.query(
      `
      SELECT 
        'Stock Updated' as title,

        'Inventory updated' as description,

        updated_at as time

      FROM stocks

      ORDER BY updated_at DESC

      LIMIT 2
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const transitAct = await sequelize.query(
      `
      SELECT 
        'Transit Item' as title,

        'Items moved between stores'
        as description,

        created_at as time

      FROM stock_transfers

      ORDER BY created_at DESC

      LIMIT 2
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const activities = [
      ...salesAct,
      ...stockAct,
      ...transitAct,
    ]
      .sort(
        (a, b) =>
          new Date(b.time) -
          new Date(a.time)
      )
      .slice(0, 5);

    // ================= FINAL RESPONSE =================

    res.json({
      success: true,

      data: {

        cards: {

          // LIVE STOCK
          totalStock:
            Number(totalStock.total),

          stockValue:
            Number(stockValue.total),

          deadStock: {
            count: Number(
              deadStockData.dead_stock
            ),

            percentage:
              deadPercent + "%",
          },

          transitStock:
            Number(transitStock.total),

          goldPrice: Number(
            goldPrice.toFixed(2)
          ),

          silverPrice: Number(
            silverPrice.toFixed(2)
          ),
        },

        salesPurchaseTrend,

        profitLoss,

        revenueTrend,

        topProducts,

        recentActivities: activities,
      },
    });

  } catch (error) {

    console.error(
      "Dashboard Error:",
      error
    );

    res.status(500).json({
      error: error.message,
    });
  }
};
