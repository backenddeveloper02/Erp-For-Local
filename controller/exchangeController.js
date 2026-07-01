// import sequelize from "../config/db.js";
import { QueryTypes } from "sequelize";
// import SystemActivity from "../model/systemActivity.js";
// import ActivityLog from "../model/activityLog.js";
import { Op } from "sequelize";
// import Item from "../model/Item.js";
// import Stock from "../model/Stock.js";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
// import { Op } from "sequelize";
// import crypto from "crypto";
import Bill from "../model/Bill.js";
import BillItem from "../model/BillItem.js";
import Customer from "../model/Customer.js";
import Invoice from "../model/invoices.js";
import InvoiceItem from "../model/InvoiceItem.js";
import LedgerEntry from "../model/LedgerEntry.js";
import Store from "../model/Store.js";
import Stock from "../model/stockrecord.js";
import StockMovement from "../model/stockmovement.js"
import Item from "../model/item.js";
import sequelize from "../config/db.js";
import { emitBillingScan } from "../socket/billingSocket.js";
import exchangeLogs from "../model/exchangemodel.js";
// ==============================
//  GET INVOICE FOR EXCHANGE
// ==============================
export const getInvoiceForExchange = async (req, res) => {
  try {
    const { invoice_number } = req.params;

    if (!invoice_number || !String(invoice_number).trim()) {
      return res.status(400).json({
        success: false,
        message: "invoice_number is required",
      });
    }

    const data = await sequelize.query(
      `
      SELECT 
        i.id AS invoice_id,
        i.invoice_number,

        c.name AS customer_name,
        c.phone AS customer_phone,

        e.old_product_code,
        e.old_product_name,
        e.old_purity,
        e.old_gross_weight,
        e.old_net_weight,
        e.old_stone_weight,
        e.old_value,

        ii.product_code,
        ii.description,
        it.metal_type AS item_metal_type,
        ii.purity,
        ii.gross_weight,
        ii.net_weight,
        ii.stone_weight,
        ii.total_amount

      FROM invoices i

      LEFT JOIN customers c 
        ON i.customer_id = c.id

      LEFT JOIN LATERAL (
        SELECT *
        FROM exchange_logs 
        WHERE invoice_id = i.id
        ORDER BY id DESC
        LIMIT 1
      ) e ON true

      LEFT JOIN invoice_items ii
        ON ii.invoice_id = i.id
       AND ii.is_active = true

      LEFT JOIN items it
        ON it.id = ii.item_id

      WHERE i.invoice_number = :invoice_number

      ORDER BY ii.id ASC
      `,
      {
        replacements: {
          invoice_number: String(invoice_number).trim(),
        },
        type: QueryTypes.SELECT,
      }
    );

    if (!data.length) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const invoice = data[0];

    const items = data
      .filter((row) => row.product_code)
      .map((row) => ({
        invoice_id: row.invoice_id,
        product_code: row.product_code,
        product_name: row.description,
        metal_type: row.item_metal_type,
        purity: row.purity,
        gross_weight: row.gross_weight,
        net_weight: row.net_weight,
        stone_weight: row.stone_weight,
        value: row.total_amount,
      }));

    const latest_exchange_product = invoice.old_product_code
      ? {
          product_code: invoice.old_product_code,
          product_name: invoice.old_product_name,
          metal_type: invoice.item_metal_type,
          purity: invoice.old_purity,
          gross_weight: invoice.old_gross_weight,
          net_weight: invoice.old_net_weight,
          stone_weight: invoice.old_stone_weight,
          value: invoice.old_value,
        }
      : null;

    return res.status(200).json({
      success: true,
      message: "Invoice fetched successfully",
      data: {
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        phone: invoice.customer_phone,
        total_items: items.length,
        items,
        latest_exchange_product,
      },
    });
  } catch (err) {
    console.error("getInvoiceForExchange error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invoice for exchange",
      error: err.message,
    });
  }
};

// ==============================
//  CREATE EXCHANGE
// ==============================
export const createExchange = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const {
      invoice_number,
      original_products = [],
      new_products = [],
      making_charge = 0,
      stone_amount = 0,
    } = req.body;

    const storeCode =
      req.user?.store_code || req.user?.storeCode || req.headers.store_code;

    if (!storeCode) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "Store code missing in token",
      });
    }

    if (!invoice_number) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "invoice_number is required",
      });
    }

    if (!original_products.length) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "At least one original product is required",
      });
    }

    if (!new_products.length) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "At least one new product is required",
      });
    }

    // ================= FETCH INVOICE =================
    const inv = await Invoice.findOne({
      where: {
        invoice_number,
        store_code: storeCode,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!inv) {
      await t.rollback();

      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    // ================= FETCH INVOICE ITEMS =================
    const invoiceItems = await InvoiceItem.findAll({
      where: {
        invoice_id: inv.id,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!invoiceItems.length) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "No items found for this invoice",
      });
    }

    const normalize = (str) =>
      String(str || "").trim().toLowerCase().replace(/\s+/g, " ");

    // ================= MATCH OLD PRODUCTS =================
    let oldValue = 0;
    const matchedItems = [];

    for (const original of original_products) {
      const matched = invoiceItems.find((item) => {
        return (
          normalize(item.product_code) === normalize(original.product_code) ||
          normalize(item.article_code) === normalize(original.product_code) ||
          normalize(item.sku_code) === normalize(original.product_code)
        );
      });

      if (!matched) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message: `Invalid product in invoice: ${original.product_code}`,
        });
      }

      matchedItems.push({
        matched,
        original,
      });

      oldValue += Number(matched.total_amount || original.value || 0);
    }

    // ================= NEW VALUE =================
    let newValue = 0;

    for (const np of new_products) {
      newValue += Number(np.value || np.total_amount || 0);
    }

    // ================= CALCULATION =================
    const diffDays = Math.floor(
      (new Date() - new Date(inv.invoice_date)) / (1000 * 60 * 60 * 24)
    );

    const isFreeExchange = diffDays <= 7;

    const makingCharges = isFreeExchange
      ? 0
      : Number(making_charge || 0) + Number(stone_amount || 0);

    const oldInvoiceTotal = Number(inv.total_amount || 0);
    const receivedAmount = Number(inv.received_amount || 0);

    const exchangeDifference = newValue + makingCharges - oldValue;

    const finalAmount = oldInvoiceTotal + exchangeDifference;

    const pendingAmount = Math.max(finalAmount - receivedAmount, 0);

    const status =
      pendingAmount <= 0
        ? "PAID"
        : receivedAmount > 0
        ? "PARTIAL"
        : "UNPAID";

    // ================= UPDATE INVOICE =================
    await inv.update(
      {
        total_amount: Number(finalAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
        status,
      },
      { transaction: t }
    );

    // ================= LEDGER ENTRY FOR EXCHANGE =================
    if (exchangeDifference !== 0) {
      await LedgerEntry.create(
        {
          customer_id: inv.customer_id,

          type: exchangeDifference > 0 ? "DEBIT" : "CREDIT",

          amount: Number(Math.abs(exchangeDifference).toFixed(2)),

          reference_type: "EXCHANGE",

          reference_id: inv.id,

          description:
            exchangeDifference > 0
              ? `Exchange extra payable for invoice ${inv.invoice_number}`
              : `Exchange credit adjustment for invoice ${inv.invoice_number}`,

          organization_id: inv.organization_id,
        },
        { transaction: t }
      );
    }

    // ================= CREATE EXCHANGE LOGS =================
    for (let i = 0; i < matchedItems.length; i++) {
      const old = matchedItems[i].matched;
      const oldPayload = matchedItems[i].original;
      const newP = new_products[i] || {};

      await ExchangeLog.create(
        {
          invoice_id: inv.id,

          old_product_code:
            old.product_code || old.article_code || old.sku_code || oldPayload.product_code,

          old_product_name:
            old.product_name || old.description || oldPayload.product_name,

          old_purity: old.purity || oldPayload.purity || null,

          old_condition: oldPayload.condition || "EXCHANGED",

          old_gross_weight: Number(old.gross_weight || oldPayload.gross_weight || 0),

          old_net_weight: Number(old.net_weight || oldPayload.net_weight || 0),

          old_stone_weight: Number(old.stone_weight || oldPayload.stone_weight || 0),

          old_value: Number(old.total_amount || oldPayload.value || 0),

          new_product_code: newP.product_code || newP.article_code || newP.sku_code || null,

          new_product_name:
            newP.product_name || newP.description || newP.product_code || "Product",

          new_purity: newP.purity || null,

          new_condition: newP.condition || "NEW",

          new_gross_weight: Number(newP.gross_weight || 0),

          new_net_weight: Number(newP.net_weight || 0),

          new_stone_weight: Number(newP.stone_weight || 0),

          new_value: Number(newP.value || newP.total_amount || 0),

          difference:
            Number(newP.value || newP.total_amount || 0) -
            Number(old.total_amount || oldPayload.value || 0),

          making_charges: Number(makingCharges || 0),
        },
        { transaction: t }
      );
    }

    // ================= REMOVE OLD INVOICE ITEMS =================
    // InvoiceItem model me is_active/status field nahi hai,
    // isliye old exchanged items ko invoice_items se remove kar rahe hain.
    for (const m of matchedItems) {
      await InvoiceItem.destroy({
        where: {
          id: m.matched.id,
          invoice_id: inv.id,
        },
        transaction: t,
      });
    }

    // ================= INSERT NEW INVOICE ITEMS =================
    for (const newItem of new_products) {
      const code =
        newItem.product_code || newItem.article_code || newItem.sku_code || null;

      const item = code
        ? await Item.findOne({
            where: {
              [Op.or]: [
                { article_code: code },
                { sku_code: code },
              ],
            },
            transaction: t,
          })
        : null;

      const totalAmount = Number(newItem.value || newItem.total_amount || 0);
      const netWeight = Number(newItem.net_weight || 0);

      await InvoiceItem.create(
        {
          invoice_id: inv.id,
          item_id: item?.id || newItem.item_id || null,

          organization_id: inv.organization_id,

          product_code: code,
          article_code: newItem.article_code || item?.article_code || code,
          sku_code: newItem.sku_code || item?.sku_code || null,

          product_name:
            newItem.product_name ||
            newItem.description ||
            item?.item_name ||
            "Product",

          description:
            newItem.description ||
            newItem.product_name ||
            item?.details ||
            "Exchange Product",

          metal_type: newItem.metal_type || item?.metal_type || null,
          purity: newItem.purity || item?.purity || null,
          category: newItem.category || item?.category || null,
          hsn_code: newItem.hsn_code || item?.hsn_code || null,
          unit: newItem.unit || item?.unit || "piece",

          qty: Number(newItem.qty || 1),

          gross_weight: Number(newItem.gross_weight || 0),
          net_weight: netWeight,
          stone_weight: Number(newItem.stone_weight || 0),

          rate: newItem.rate
            ? Number(newItem.rate)
            : netWeight > 0
            ? Number((totalAmount / netWeight).toFixed(2))
            : 0,

          making_charge_percent: Number(newItem.making_charge_percent || 0),
          making_charge_amount: Number(newItem.making_charge_amount || 0),
          stone_amount: Number(newItem.stone_amount || 0),

          wastage_percent: Number(newItem.wastage_percent || 0),
          wastage_amount: Number(newItem.wastage_amount || 0),

          discount_percent: Number(newItem.discount_percent || 0),
          discount_amount: Number(newItem.discount_amount || 0),

          tax_percent: Number(newItem.tax_percent || 0),
          tax_amount: Number(newItem.tax_amount || 0),

          line_total: totalAmount,
          total_amount: totalAmount,

          remarks: `Added through exchange for invoice ${inv.invoice_number}`,
        },
        { transaction: t }
      );
    }

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Exchange created successfully",
      data: {
        invoice_number: inv.invoice_number,
        total_old_value: Number(oldValue.toFixed(2)),
        total_new_value: Number(newValue.toFixed(2)),
        making_charges: Number(makingCharges.toFixed(2)),
        exchange_difference: Number(exchangeDifference.toFixed(2)),
        final_amount: Number(finalAmount.toFixed(2)),
        received_amount: Number(receivedAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
        status,
      },
    });
  } catch (err) {
    await t.rollback();

    console.error("createExchange error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to create exchange",
      error: err.message,
    });
  }
};

// ==============================
//  EXCHANGE DASHBOARD
// ==============================
// ==============================
export const getExchangeDashboard = async (req, res) => {
  try {
    const { filter = "all" } = req.query;

    const storeCode =
      req.user?.store_code ||
      req.user?.storeCode ||
      req.headers.store_code;

    if (!storeCode) {
      return res.status(400).json({
        success: false,
        message: "Store code missing (token ya header me bhejo)"
      });
    }

    let dateFilter = "";

    if (filter === "day") {
      dateFilter = `AND DATE(e.createdat) = CURRENT_DATE`;
    } else if (filter === "week") {
      dateFilter = `AND e.createdat >= NOW() - INTERVAL '7 days'`;
    } else if (filter === "month") {
      dateFilter = `AND DATE_TRUNC('month', e.createdat) = DATE_TRUNC('month', CURRENT_DATE)`;
    }

    const list = await sequelize.query(
      `
      SELECT 
        e.id,

        CONCAT(
          'EXG-',
          TO_CHAR(e.createdat, 'YYYY-MM'),
          '-',
          LPAD(
            ROW_NUMBER() OVER (
              PARTITION BY DATE_TRUNC('month', e.createdat)
              ORDER BY e.createdat
            )::text,
            3,
            '0'
          )
        ) AS exchange_number,

        i.invoice_number,
        c.name,
        c.phone,
        i.invoice_date,
        e.createdat AS exchange_date,

        FLOOR(DATE_PART('day', e.createdat - i.invoice_date)) AS days_since_purchase,

        e.old_product_code,
        e.old_product_name,
        e.old_purity,
        e.old_gross_weight,
        e.old_net_weight,
        e.old_stone_weight,
        e.old_value,

        e.new_product_code,
        e.new_product_name,
        e.new_purity,
        e.new_gross_weight,
        e.new_net_weight,
        e.new_stone_weight,
        e.new_value,

        e.making_charges,
        e.difference

      FROM exchange_logs e
      JOIN invoices i ON e.invoice_id = i.id
      LEFT JOIN customers c ON i.customer_id = c.id

      WHERE 1=1
      AND i.store_code = :store_code   
      ${dateFilter}

      ORDER BY e.createdat DESC
      `,
      {
        replacements: { store_code: storeCode },
        type: QueryTypes.SELECT
      }
    );

    const stats = await sequelize.query(
      `
      SELECT 
        COUNT(*) AS total_exchanges,

        COUNT(
          CASE 
            WHEN DATE_PART('day', e.createdat - i.invoice_date) <= 7 
            THEN 1 
          END
        ) AS within_7_days,

        COUNT(
          CASE 
            WHEN DATE_PART('day', e.createdat - i.invoice_date) > 7 
            THEN 1 
          END
        ) AS after_7_days,

        COALESCE(
          SUM(
            CASE 
              WHEN DATE_PART('day', e.createdat - i.invoice_date) > 7 
              THEN e.making_charges
              ELSE 0
            END
          ), 
        0) AS making_charges

      FROM exchange_logs e
      JOIN invoices i ON e.invoice_id = i.id

      WHERE 1=1
      AND i.store_code = :store_code   
      ${dateFilter}
      `,
      {
        replacements: { store_code: storeCode },
        type: QueryTypes.SELECT
      }
    );

    return res.json({
      success: true,
      stats: {
        total_exchanges: parseInt(stats[0].total_exchanges),
        within_7_days: parseInt(stats[0].within_7_days),
        after_7_days: parseInt(stats[0].after_7_days),
        making_charges: parseFloat(stats[0].making_charges)
      },
      count: list.length,
      data: list
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
import crypto from "crypto";
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const QR_SECRET = process.env.QR_SECRET || "change-this-secret";

const verifyQRPayload = (qrText) => {
  try {
    const parsed = JSON.parse(qrText);

    if (!parsed?.payload || !parsed?.signature) {
      return {
        isSecure: false,
        code: qrText,
      };
    }

    const expectedSignature = crypto
      .createHmac("sha256", QR_SECRET)
      .update(JSON.stringify(parsed.payload))
      .digest("hex");

    if (parsed.signature !== expectedSignature) {
      return {
        isSecure: true,
        valid: false,
        message: "Invalid QR signature",
      };
    }

    return {
      isSecure: true,
      valid: true,
      payload: parsed.payload,
      code: parsed.payload.code,
      item_id: parsed.payload.item_id,
      organization_id: parsed.payload.organization_id,
    };
  } catch (error) {
    return {
      isSecure: false,
      code: qrText,
    };
  }
};
export const scanBillingItem = async (req, res) => {
  try {
    const rawCode = String(req.params.code || "").trim();
    const organizationId = req.user?.organization_id;

    if (!rawCode) {
      return res.status(400).json({
        success: false,
        message: "QR/Barcode code is required",
      });
    }

    if (!organizationId) {
      return res.status(401).json({
        success: false,
        message: "organization_id missing in token",
      });
    }

    // Verify QR / Barcode
    const qr = verifyQRPayload(rawCode);

    if (qr.isSecure && qr.valid === false) {
      return res.status(400).json({
        success: false,
        message: qr.message || "Invalid QR",
      });
    }

    // Organization validation
    if (
      qr.isSecure &&
      qr.organization_id &&
      String(qr.organization_id) !== String(organizationId)
    ) {
      return res.status(403).json({
        success: false,
        message: "This QR does not belong to your organization",
      });
    }

    // Item search condition
    const whereCondition = {
      organization_id: organizationId,
      current_status: "in_stock",
      is_active: true,
    };

    if (qr.item_id) {
      whereCondition.id = qr.item_id;
    } else {
      whereCondition[Op.or] = [
        { sku_code: qr.code },
        { article_code: qr.code },
      ];
    }

    // Find Item
    const item = await Item.findOne({
      where: whereCondition,
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found for this QR code",
      });
    }

    // Find Stock
    const stock = await Stock.findOne({
      where: {
        item_id: item.id,
        organization_id: organizationId,
      },
    });

    if (!stock) {
      return res.status(404).json({
        success: false,
        message: "Stock not found for this item in your store",
      });
    }

    if (toNumber(stock.available_qty) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Item is out of stock",
      });
    }

    // Price Calculation
    const netWeight = toNumber(item.net_weight);
    const rate = toNumber(item.sale_rate);
    const makingPercent = toNumber(item.making_charge);

    const metalValue = netWeight * rate;
    const makingValue = (metalValue * makingPercent) / 100;
    const totalAmount = metalValue + makingValue;

    // Response Object
    const scannedItem = {
      item_id: item.id,

      sku_code: item.sku_code,
      article_code: item.article_code,
      product_code: item.article_code || item.sku_code,

      item_name: item.item_name,
      description: item.details || item.item_name,

      metal_type: item.metal_type,
      category: item.category,
      purity: item.purity,

      gross_weight: toNumber(item.gross_weight),
      net_weight: netWeight,
      stone_weight: toNumber(item.stone_weight),
      stone_amount: toNumber(item.stone_amount),

      rate,
      purchase_rate: toNumber(item.purchase_rate),
      sale_rate: toNumber(item.sale_rate),

      making_charge_percent: makingPercent,
      making_charge_value: Number(makingValue.toFixed(2)),
      total_amount: Number(totalAmount.toFixed(2)),

      hsn_code: item.hsn_code,
      unit: item.unit,
      current_status: item.current_status,

      qty: 1,

      available_qty: toNumber(stock.available_qty),
      available_weight: toNumber(stock.available_weight),

      reserved_qty: toNumber(stock.reserved_qty),
      reserved_weight: toNumber(stock.reserved_weight),

      transit_qty: toNumber(stock.transit_qty),
      transit_weight: toNumber(stock.transit_weight),

      damaged_qty: toNumber(stock.damaged_qty),
      damaged_weight: toNumber(stock.damaged_weight),

      qr_type: qr.isSecure ? "secure" : "plain",
      qr_code_url: item.qr_code_url,

      scanned_at: new Date(),
    };

    return res.status(200).json({
      success: true,
      message: "Item fetched successfully",
      data: scannedItem,
    });
  } catch (error) {
    console.error("Scan Billing Item Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch scanned item",
      error: error.message,
    });
  }
};
