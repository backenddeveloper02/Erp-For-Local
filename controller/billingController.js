import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { Op } from "sequelize";
import crypto from "crypto";
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
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const normalizePhone = (phone) => {
  if (!phone) return null;
  return String(phone).replace(/\D/g, "").trim() || null;
};

const resolveUserScope = (user) => {
  const organization_id =
    user?.organization_id ??
    user?.organizationId ??
    user?.org_id ??
    user?.orgId ??
    user?.branch_id ??
    user?.branchId ??
    user?.store_id ??
    user?.store?.id ??
    null;

  const store_code =
    user?.store_code ??
    user?.storeCode ??
    user?.code ??
    user?.store?.store_code ??
    user?.store?.code ??
    null;

  const organization_level =
    user?.organization_level ??
    user?.organizationLevel ??
    user?.level ??
    user?.store?.organization_level ??
    null;

  return {
    organization_id: organization_id ? Number(organization_id) : null,
    store_code: store_code ? String(store_code).trim().toUpperCase() : null,
    organization_level: organization_level || null,
  };
};

const generateInvoiceNumber = (storeCode = "STORE") => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return `INV-${storeCode}-${yyyy}${mm}${dd}${hh}${mi}${ss}`;
};

const generateBillNumber = (storeCode = "STORE") => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return `BILL-${storeCode}-${yyyy}${mm}${dd}${hh}${mi}${ss}`;
};

const generateInvoicePdf = async ({
  invoice,
  bill,
  customer,
  billItems,
  summary,
}) => {
  return new Promise((resolve, reject) => {
    try {
      const invoicesDir = path.join(process.cwd(), "uploads", "invoices");
      ensureDir(invoicesDir);

      const fileName = `${invoice.invoice_number || `invoice-${invoice.id}`}.pdf`;
      const filePath = path.join(invoicesDir, fileName);

      const doc = new PDFDocument({
        margin: 40,
        size: "A4",
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.fontSize(18).font("Helvetica-Bold").text("TAX INVOICE", {
        align: "center",
      });

      doc.moveDown(0.5);

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text("Merxenta Global Private Limited");

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("H.No. 999/9, Gurgaon, Haryana")
        .text("Phone: 0120-2562111")
        .text("GSTIN: XXXXXXXXXX");

      doc.moveDown(1);

      const leftX = 40;
      const rightX = 330;
      let y = doc.y;

      doc.fontSize(11).font("Helvetica-Bold").text("Bill To:", leftX, y);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Name: ${customer.name || "-"}`, leftX, y + 18)
        .text(`Phone: ${customer.phone || "-"}`, leftX, y + 34)
        .text(`Address: ${customer.address || "-"}`, leftX, y + 50)
        .text(`Pincode: ${customer.pincode || "-"}`, leftX, y + 66);

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Invoice Details:", rightX, y);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          `Invoice No: ${invoice.invoice_number || invoice.id}`,
          rightX,
          y + 18
        )
        .text(
          `Invoice Date: ${
            new Date(invoice.createdAt || Date.now())
              .toISOString()
              .split("T")[0]
          }`,
          rightX,
          y + 34
        )
        .text(`Bill No: ${bill.bill_number || bill.id}`, rightX, y + 50)
        .text(`Store Code: ${bill.store_code || "-"}`, rightX, y + 66);

      doc.moveDown(5);

      const tableTop = doc.y + 10;
      const cols = {
        sno: 40,
        code: 70,
        desc: 150,
        wt: 300,
        rate: 360,
        mc: 420,
        amt: 480,
      };

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("S.No", cols.sno, tableTop)
        .text("Code", cols.code, tableTop)
        .text("Description", cols.desc, tableTop)
        .text("Net Wt", cols.wt, tableTop, { width: 45, align: "right" })
        .text("Rate", cols.rate, tableTop, { width: 45, align: "right" })
        .text("MC", cols.mc, tableTop, { width: 45, align: "right" })
        .text("Amount", cols.amt, tableTop, { width: 60, align: "right" });

      doc.moveTo(40, tableTop + 14).lineTo(555, tableTop + 14).stroke();

      let rowY = tableTop + 22;
      doc.font("Helvetica").fontSize(9);

      billItems.forEach((item, index) => {
        if (rowY > 730) {
          doc.addPage();
          rowY = 50;
        }

        doc
          .text(String(index + 1), cols.sno, rowY)
          .text(item.product_code || "-", cols.code, rowY, { width: 70 })
          .text(item.description || "-", cols.desc, rowY, { width: 120 })
          .text(toNumber(item.net_weight).toFixed(3), cols.wt, rowY, {
            width: 45,
            align: "right",
          })
          .text(toNumber(item.rate).toFixed(2), cols.rate, rowY, {
            width: 45,
            align: "right",
          })
          .text(
            `${toNumber(item.making_charge_percent).toFixed(2)}%`,
            cols.mc,
            rowY,
            {
              width: 45,
              align: "right",
            }
          )
          .text(toNumber(item.total_amount).toFixed(2), cols.amt, rowY, {
            width: 60,
            align: "right",
          });

        rowY += 22;
      });

      doc.moveTo(40, rowY).lineTo(555, rowY).stroke();

      rowY += 15;

      doc.font("Helvetica-Bold").fontSize(10).text("Summary", 360, rowY);

      rowY += 18;
      doc.font("Helvetica").fontSize(10);
      doc.text(`Subtotal: ${summary.subtotal.toFixed(2)}`, 360, rowY);
      rowY += 16;
      doc.text(`CGST: ${summary.cgst.toFixed(2)}`, 360, rowY);
      rowY += 16;
      doc.text(`SGST: ${summary.sgst.toFixed(2)}`, 360, rowY);
      rowY += 16;
      doc.text(`Round Off: ${summary.round_off.toFixed(2)}`, 360, rowY);
      rowY += 16;
      doc
        .font("Helvetica-Bold")
        .text(`Final Amount: ${summary.final_amount.toFixed(2)}`, 360, rowY);

      rowY += 35;

      doc
        .font("Helvetica")
        .fontSize(9)
        .text("Note: This is computer generated invoice", 40, rowY)
        .text("Terms:", 40, rowY + 18)
        .text("1. No warranty on physical damage", 55, rowY + 34)
        .text("2. Goods once sold not returnable", 55, rowY + 48);

      doc.end();

      stream.on("finish", () => {
        resolve({
          fileName,
          filePath,
          relativePath: `/uploads/invoices/${fileName}`,
        });
      });

      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
};

export const createInvoiceFromBill = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { bill_id, customer } = req.body;

    if (!bill_id) throw new Error("bill_id is required");
    if (!customer || !customer.phone || !customer.name) {
      throw new Error("Customer name and phone are required");
    }

    const bill = await Bill.findByPk(bill_id, { transaction: t });
    if (!bill) throw new Error("Bill not found");

    const billItems = await BillItem.findAll({
      where: { bill_id },
      transaction: t,
      raw: true,
    });
    if (!billItems.length) throw new Error("No items found in this bill");

    const cleanPhone = normalizePhone(customer.phone);

    const [cust] = await Customer.findOrCreate({
      where: {
        phone: cleanPhone,
        store_code: bill.store_code,
      },
      defaults: {
        name: String(customer.name).trim(),
        phone: cleanPhone,
        address: customer.address || "",
        pincode: customer.pincode || "",
        pan_card_number: customer.pan_card_number || "",
        store_code: bill.store_code,
        organization_id: bill.organization_id,
      },
      transaction: t,
    });

    await cust.update(
      {
        name: customer.name || cust.name,
        address: customer.address || cust.address,
        pincode: customer.pincode || cust.pincode,
        pan_card_number: customer.pan_card_number || cust.pan_card_number,
      },
      { transaction: t }
    );

    let subtotal = 0;
    billItems.forEach((item) => {
      subtotal += toNumber(item.total_amount);
    });

    const cgst = subtotal * 0.015;
    const sgst = subtotal * 0.015;
    const totalWithTax = subtotal + cgst + sgst;
    const roundOff = Math.round(totalWithTax) - totalWithTax;
    const finalAmount = totalWithTax + roundOff;

    const invoiceNumber = generateInvoiceNumber(bill.store_code);

    const invoice = await Invoice.create(
      {
        invoice_number: invoiceNumber,
        bill_id,
        customer_id: cust.id,
        total_amount: Number(finalAmount.toFixed(2)),
        received_amount: 0,
        pending_amount: Number(finalAmount.toFixed(2)),
        status: "UNPAID",
        store_code: bill.store_code,
        organization_id: bill.organization_id,
      },
      { transaction: t }
    );

    for (const item of billItems) {
      await InvoiceItem.create(
        {
          invoice_id: invoice.id,
          item_id: item.item_id,
          product_code: item.product_code,
          description: item.description,
          net_weight: item.net_weight,
          rate: item.rate,
          making_charge_percent: item.making_charge_percent,
          making_charge_value: item.making_charge_value,
          total_amount: item.total_amount,
        },
        { transaction: t }
      );
    }

    await LedgerEntry.create(
      {
        customer_id: cust.id,
        type: "DEBIT",
        amount: Number(finalAmount.toFixed(2)),
        reference_type: "INVOICE",
        reference_id: invoice.id,
        description: `Invoice #${invoice.invoice_number} created`,
        organization_id: bill.organization_id,
        store_code: bill.store_code,
      },
      { transaction: t }
    );

    const summary = {
      subtotal: Number(subtotal.toFixed(2)),
      cgst: Number(cgst.toFixed(2)),
      sgst: Number(sgst.toFixed(2)),
      total_with_tax: Number(totalWithTax.toFixed(2)),
      round_off: Number(roundOff.toFixed(2)),
      final_amount: Number(finalAmount.toFixed(2)),
    };

    const pdfResult = await generateInvoicePdf({
      invoice,
      bill,
      customer: cust,
      billItems,
      summary,
    });

    await invoice.update(
      {
        pdf_path: pdfResult.relativePath,
      },
      { transaction: t }
    );

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      data: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        pdf_path: pdfResult.relativePath,
        header: {
          company_name: "Merxenta Global Private Limited",
          address: "H.No. 999/9, Gurgaon, Haryana",
          phone: "0120-2562111",
          gstin: "XXXXXXXX",
        },
        customer_details: {
          name: cust.name,
          phone: cust.phone,
          address: cust.address,
          invoice_no: invoice.invoice_number,
          invoice_date: new Date().toISOString().split("T")[0],
        },
        items: billItems.map((item, index) => ({
          sno: index + 1,
          product_code: item.product_code,
          description: item.description,
          hsn_code: "71131913",
          purity: "18KT",
          gross_weight: item.net_weight,
          net_weight: item.net_weight,
          rate: item.rate,
          value: Number(
            (toNumber(item.net_weight) * toNumber(item.rate)).toFixed(2)
          ),
          making_charge_percent: item.making_charge_percent,
          making_charge_value: item.making_charge_value,
          amount: item.total_amount,
        })),
        summary,
        footer: {
          note: "This is computer generated invoice",
          terms: [
            "No warranty on physical damage",
            "Goods once sold not returnable",
          ],
        },
      },
    });
  } catch (error) {
    await t.rollback();
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const createBill = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const {
      organization_id,
      store_code: loginStoreCode,
      organization_level,
    } = resolveUserScope(req.user);

    if (!organization_id || !loginStoreCode) {
      await t.rollback();
      return res.status(401).json({
        success: false,
        message: "Unable to resolve logged-in user entity",
        debug_user: req.user || null,
      });
    }

    const {
      items = [],
      customer_id = null,
      customer = null,
      store_code,
      paid_amount = 0,
      notes = null,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "At least one item is required",
      });
    }

    const cleanStoreCode = String(store_code || loginStoreCode || "")
      .trim()
      .toUpperCase();

    if (!cleanStoreCode) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "store_code is required",
      });
    }

    const itemIds = items.map((i) => i.item_id).filter(Boolean);

    if (itemIds.length !== new Set(itemIds).size) {
      throw new Error("Duplicate item found in bill items");
    }

    let finalCustomer = null;

    if (customer_id) {
      finalCustomer = await Customer.findOne({
        where: {
          id: customer_id,
          organization_id,
          store_code: cleanStoreCode,
        },
        transaction: t,
      });

      if (!finalCustomer) {
        throw new Error("Customer not found for this entity");
      }
    } else if (
      customer &&
      (customer.phone || customer.pan_card_number || customer.name)
    ) {
      const cleanPhone = normalizePhone(customer.phone);

      const cleanPan = customer.pan_card_number
        ? String(customer.pan_card_number).trim().toUpperCase()
        : null;

      const orConditions = [];

      if (cleanPhone) orConditions.push({ phone: cleanPhone });
      if (cleanPan) orConditions.push({ pan_card_number: cleanPan });

      if (orConditions.length > 0) {
        finalCustomer = await Customer.findOne({
          where: {
            organization_id,
            store_code: cleanStoreCode,
            [Op.or]: orConditions,
          },
          transaction: t,
        });
      }

      if (!finalCustomer) {
        if (!customer.name || !String(customer.name).trim()) {
          throw new Error("Customer name is required for new customer");
        }

        finalCustomer = await Customer.create(
          {
            name: String(customer.name).trim(),
            phone: cleanPhone,
            address: customer.address ? String(customer.address).trim() : null,
            pan_card_number: cleanPan,
            pincode: customer.pincode ? String(customer.pincode).trim() : null,
            organization_id,
            organization_level,
            store_code: cleanStoreCode,
          },
          { transaction: t }
        );
      }
    }

    const preparedItems = [];

    let subtotalAmount = 0;
    let totalMakingDeduction = 0;
    let totalOtherDiscount = 0;
    let totalGstAmount = 0;
    let grandTotal = 0;

    for (const row of items) {
      const item_id = row.item_id;

      const qty =
        row.qty === undefined || row.qty === null || row.qty === ""
          ? 1
          : toNumber(row.qty);

      const net_weight = toNumber(row.net_weight);

      if (!item_id) {
        throw new Error("item_id is required for each item");
      }

      if (qty <= 0) {
        throw new Error(`Invalid qty for item ${item_id}`);
      }

      const dbItem = await Item.findOne({
        where: {
          id: item_id,
          organization_id,
          current_status: "in_stock",
          is_active: true,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!dbItem) {
        throw new Error(`Item not found or not available for item_id ${item_id}`);
      }

      const unit = String(dbItem.unit || row.unit || "").toLowerCase();
      const isPieceItem = ["pcs", "pc", "piece", "pieces"].includes(unit);

      if (!isPieceItem && qty !== 1) {
        throw new Error(`Qty must be 1 for weight-based item ${item_id}`);
      }

      if (!isPieceItem && net_weight <= 0) {
        throw new Error(`Invalid net_weight for item ${item_id}`);
      }

      const stock = await Stock.findOne({
        where: {
          item_id,
          organization_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!stock) {
        throw new Error(`Stock not found for item ${item_id}`);
      }

      const openingQty = toNumber(stock.available_qty);
      const openingWeight = toNumber(stock.available_weight);

      if (openingQty < qty) {
        throw new Error(`Insufficient stock qty for item ${item_id}`);
      }

      /*
        NEW PRICING STRUCTURE

        selling_price                = item ka selling price
        old_making_charge            = original making charge
        making_charge_value          = editable/new making charge
        making_charge_deduction      = old - new
        other_discount               = optional, default 0
        net_taxable_amount           = selling_price + new making - other discount
        gst_amount                   = 3% of net taxable amount
        total_amount                 = net taxable + gst
      */

      const sellingPrice = toNumber(
        row.selling_price ||
          row.sellingPrice ||
          row.total_value ||
          row.totalValue ||
          row.rate ||
          0
      );

      const oldMakingCharge = toNumber(
        row.old_making_charge ||
          row.oldMakingCharge ||
          row.original_making_charge ||
          row.originalMakingCharge ||
          dbItem.making_charge_value ||
          dbItem.making_charge ||
          dbItem.making_charges ||
          0
      );

      const makingChargeDeduction = toNumber(
  row.making_charge_deduction ||
    row.makingChargeDeduction ||
    row.making_deduction ||
    row.makingDeduction ||
    0
);

if (makingChargeDeduction < 0) {
  throw new Error(
    `Making charge deduction cannot be negative for item ${item_id}`
  );
}

if (makingChargeDeduction > oldMakingCharge) {
  throw new Error(
    `Making charge deduction cannot be greater than old making charge for item ${item_id}`
  );
}

const newMakingCharge = oldMakingCharge - makingChargeDeduction;
      const otherDiscount = toNumber(
        row.other_discount ||
          row.otherDiscount ||
          row.any_other_discount ||
          row.anyOtherDiscount ||
          0
      );

      if (sellingPrice <= 0) {
        throw new Error(`Invalid selling price for item ${item_id}`);
      }

      if (oldMakingCharge < 0) {
        throw new Error(`Old making charge cannot be negative for item ${item_id}`);
      }

      if (newMakingCharge < 0) {
        throw new Error(`Making charge cannot be negative for item ${item_id}`);
      }

      // if (oldMakingCharge > 0 && newMakingCharge > oldMakingCharge) {
      //   throw new Error(
      //     `New making charge cannot be greater than old making charge for item ${item_id}`
      //   );
      // }

      // const makingChargeDeduction = Math.max(
      //   oldMakingCharge - newMakingCharge,
      //   0
      // );

      const taxableAmount = sellingPrice + newMakingCharge;

      if (otherDiscount < 0) {
        throw new Error(`Other discount cannot be negative for item ${item_id}`);
      }

      if (otherDiscount > taxableAmount) {
        throw new Error(
          `Other discount cannot be greater than taxable amount for item ${item_id}`
        );
      }

      const netTaxableAmount = taxableAmount - otherDiscount;

      const gstPercent = 3;
      const gstAmount = (netTaxableAmount * gstPercent) / 100;

      const totalAmount = netTaxableAmount + gstAmount;

      subtotalAmount += taxableAmount;
      totalMakingDeduction += makingChargeDeduction;
      totalOtherDiscount += otherDiscount;
      totalGstAmount += gstAmount;
      grandTotal += totalAmount;

      preparedItems.push({
        dbItem,
        stock,
        item_id,
        qty,
        unit,
        isPieceItem,

        product_code:
          row.product_code ||
          dbItem.article_code ||
          dbItem.sku_code ||
          null,

        description:
          row.description ||
          dbItem.details ||
          dbItem.item_name ||
          null,

        item_name: dbItem.item_name || row.description || null,
        metal_type: dbItem.metal_type || row.metal_type || null,
        category: dbItem.category || row.category || null,
        purity: dbItem.purity || row.purity || null,

        gross_weight: isPieceItem
          ? 0
          : toNumber(row.gross_weight || dbItem.gross_weight || net_weight),

        net_weight: isPieceItem ? 0 : net_weight,

        stone_weight: isPieceItem
          ? 0
          : toNumber(row.stone_weight || dbItem.stone_weight || 0),

        selling_price: sellingPrice,

        old_making_charge: oldMakingCharge,
        making_charge_value: newMakingCharge,
        making_charge_after_deduction: newMakingCharge,
        making_charge_deduction: makingChargeDeduction,

        other_discount: otherDiscount,

        taxable_amount: taxableAmount,
        net_taxable_amount: netTaxableAmount,

        gst_percent: gstPercent,
        gst_amount: gstAmount,

        total_amount: totalAmount,

        openingQty,
        openingWeight,
      });
    }

    const paidAmount = toNumber(paid_amount);
    const dueAmount = grandTotal - paidAmount;

    if (paidAmount < 0) {
      throw new Error("paid_amount cannot be negative");
    }

    if (paidAmount > grandTotal) {
      throw new Error("paid_amount cannot be greater than total amount");
    }

    const billNumber = generateBillNumber(cleanStoreCode);

    const bill = await Bill.create(
      {
        bill_number: billNumber,
        store_code: cleanStoreCode,
        organization_id: Number(organization_id),
        customer_id: finalCustomer?.id || null,

        total_amount: Number(grandTotal.toFixed(2)),
        paid_amount: Number(paidAmount.toFixed(2)),
        due_amount: Number(dueAmount.toFixed(2)),

        notes,
      },
      { transaction: t }
    );

    const invoiceNumber =
      typeof generateInvoiceNumber === "function"
        ? generateInvoiceNumber(cleanStoreCode)
        : `INV-${cleanStoreCode}-${Date.now()}`;

    const invoice = await Invoice.create(
      {
        invoice_number: invoiceNumber,
        bill_id: bill.id,

        customer_id: finalCustomer?.id || null,
        organization_id: Number(organization_id),
        organization_level,
        store_code: cleanStoreCode,

        invoice_date: new Date(),

        total_amount: Number(grandTotal.toFixed(2)),
        received_amount: Number(paidAmount.toFixed(2)),
        pending_amount: Number(dueAmount.toFixed(2)),

        status:
          dueAmount <= 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID",

        payment_status:
          dueAmount <= 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID",

        notes,
        created_by: req.user?.id || null,
      },
      { transaction: t }
    );

    for (const row of preparedItems) {
      const updatedQty = row.openingQty - row.qty;

      const updatedWeight = row.isPieceItem
        ? row.openingWeight
        : row.openingWeight - row.net_weight;

      await BillItem.create(
        {
          bill_id: bill.id,
          item_id: row.item_id,

          product_code: row.product_code,
          description: row.description,

          net_weight: row.net_weight,

          rate: Number(row.selling_price.toFixed(2)),
          selling_price: Number(row.selling_price.toFixed(2)),

          old_making_charge: Number(row.old_making_charge.toFixed(2)),
          making_charge_value: Number(row.making_charge_value.toFixed(2)),
          making_charge_after_deduction: Number(
            row.making_charge_after_deduction.toFixed(2)
          ),
          making_charge_deduction: Number(
            row.making_charge_deduction.toFixed(2)
          ),

          other_discount: Number(row.other_discount.toFixed(2)),

          taxable_amount: Number(row.taxable_amount.toFixed(2)),
          net_taxable_amount: Number(row.net_taxable_amount.toFixed(2)),

          gst_percent: Number(row.gst_percent.toFixed(2)),
          gst_amount: Number(row.gst_amount.toFixed(2)),

          total_amount: Number(row.total_amount.toFixed(2)),
        },
        { transaction: t }
      );

      await InvoiceItem.create(
        {
          invoice_id: invoice.id,
          item_id: row.item_id,

          product_code: row.product_code,

          product_name:
            row.item_name ||
            row.description ||
            row.product_code ||
            "Product",

          description: row.description,

          purity: row.purity,

          gross_weight: row.gross_weight,
          net_weight: row.net_weight,
          stone_weight: row.stone_weight,

          rate: Number(row.selling_price.toFixed(2)),
          selling_price: Number(row.selling_price.toFixed(2)),

          old_making_charge: Number(row.old_making_charge.toFixed(2)),
          making_charge_value: Number(row.making_charge_value.toFixed(2)),
          making_charge_after_deduction: Number(
            row.making_charge_after_deduction.toFixed(2)
          ),
          making_charge_deduction: Number(
            row.making_charge_deduction.toFixed(2)
          ),

          other_discount: Number(row.other_discount.toFixed(2)),

          taxable_amount: Number(row.taxable_amount.toFixed(2)),
          net_taxable_amount: Number(row.net_taxable_amount.toFixed(2)),

          gst_percent: Number(row.gst_percent.toFixed(2)),
          gst_amount: Number(row.gst_amount.toFixed(2)),

          total_amount: Number(row.total_amount.toFixed(2)),
        },
        { transaction: t }
      );

      await row.stock.update(
        {
          available_qty: updatedQty,
          available_weight: updatedWeight,
        },
        { transaction: t }
      );

      await StockMovement.create(
        {
          organization_id,
          item_id: row.item_id,
          movement_type: "sale",
          reference_type: "BILL",
          reference_id: bill.id,
          qty: row.qty,
          weight: row.net_weight,
          opening_available_qty: row.openingQty,
          closing_available_qty: updatedQty,
          opening_available_weight: row.openingWeight,
          closing_available_weight: updatedWeight,
          remarks: `Item sold via billing (${billNumber})`,
          created_by: req.user?.id || null,
        },
        { transaction: t }
      );

     if (updatedQty <= 0) {
  await Item.update(
    {
      current_status: "sold",
    },
    {
      where: {
        id: row.item_id,
      },
      transaction: t,
    }
  );
}}

    if (finalCustomer) {
      await LedgerEntry.create(
        {
          customer_id: finalCustomer.id,
          organization_id,
          store_code: cleanStoreCode,
          bill_id: bill.id,
          invoice_id: invoice.id,
          type: "DEBIT",
          amount: Number(grandTotal.toFixed(2)),
          remarks: `Bill created: ${billNumber}`,
          entry_date: new Date(),
        },
        { transaction: t }
      );

      if (paidAmount > 0) {
        await LedgerEntry.create(
          {
            customer_id: finalCustomer.id,
            organization_id,
            store_code: cleanStoreCode,
            bill_id: bill.id,
            invoice_id: invoice.id,
            type: "CREDIT",
            amount: Number(paidAmount.toFixed(2)),
            remarks: `Payment received against bill: ${billNumber}`,
            entry_date: new Date(),
          },
          { transaction: t }
        );
      }
    }

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Bill and invoice created successfully",
      data: {
        bill_id: bill.id,
        bill_number: bill.bill_number,

        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,

        customer_id: finalCustomer?.id || null,
        customer_name: finalCustomer?.name || null,

        total_items: preparedItems.length,

        subtotal_amount: Number(subtotalAmount.toFixed(2)),
        total_making_deduction: Number(totalMakingDeduction.toFixed(2)),
        total_other_discount: Number(totalOtherDiscount.toFixed(2)),
        total_gst_amount: Number(totalGstAmount.toFixed(2)),

        total_amount: Number(grandTotal.toFixed(2)),
        paid_amount: Number(paidAmount.toFixed(2)),
        due_amount: Number(dueAmount.toFixed(2)),

        payment_status:
          dueAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid",

        items: preparedItems.map((item) => ({
          item_id: item.item_id,
          product_code: item.product_code,
          item_name: item.item_name,

          selling_price: Number(item.selling_price.toFixed(2)),

          old_making_charge: Number(item.old_making_charge.toFixed(2)),
          making_charge_value: Number(item.making_charge_value.toFixed(2)),
          making_charge_after_deduction: Number(
            item.making_charge_after_deduction.toFixed(2)
          ),
          making_charge_deduction: Number(
            item.making_charge_deduction.toFixed(2)
          ),

          other_discount: Number(item.other_discount.toFixed(2)),

          taxable_amount: Number(item.taxable_amount.toFixed(2)),
          net_taxable_amount: Number(item.net_taxable_amount.toFixed(2)),

          gst_percent: item.gst_percent,
          gst_amount: Number(item.gst_amount.toFixed(2)),

          total_amount: Number(item.total_amount.toFixed(2)),
        })),
      },
    });
  } catch (error) {
    await t.rollback();

    console.error("Create Bill Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create bill",
      error: error.message,
    });
  }
};
// export const scanBillItemQR = async (req, res) => {
//   try {
//     const {
//       organization_id,
//       store_code: loginStoreCode,
//     } = resolveUserScope(req.user);

//     const { qr_value, qrValue, article_code, sku_code, item_id } = req.body;

//     const scanValue = qr_value || qrValue || article_code || sku_code || item_id;

//     if (!scanValue) {
//       return res.status(400).json({
//         success: false,
//         message: "QR value is required",
//       });
//     }

//     let parsed = null;
//     try {
//       parsed = JSON.parse(scanValue);
//     } catch (e) {}

//     const where = {};

//     if (parsed?.item_id) where.id = parsed.item_id;
//     else if (parsed?.article_code) where.article_code = parsed.article_code;
//     else if (parsed?.sku_code) where.sku_code = parsed.sku_code;
//     else if (item_id) where.id = item_id;
//     else if (article_code) where.article_code = article_code;
//     else if (sku_code) where.sku_code = sku_code;
//     else {
//       where[Op.or] = [
//         { qr_value: scanValue },
//         { article_code: scanValue },
//         { sku_code: scanValue },
//       ];
//     }

//     const item = await Item.findOne({ where });

//     if (!item) {
//       return res.status(404).json({
//         success: false,
//         message: "Item not found",
//       });
//     }

//     const stock = await Stock.findOne({
//       where: {
//         item_id: item.id,
//         organization_id,
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       data: {
//         item_id: item.id,
//         product_code:
//           item.product_code || item.article_code || item.sku_code || null,
//         article_code: item.article_code || null,
//         sku_code: item.sku_code || null,
//         description: item.description || item.item_name || null,
//         item_name: item.item_name || null,
//         category: item.category || null,
//         metal_type: item.metal_type || null,
//         purity: item.purity || null,
//         net_weight: item.net_weight || 0,
//         gross_weight: item.gross_weight || 0,
//         rate: item.sale_rate || item.rate || 0,
//         making_charge_percent: item.making_charge_percent || 0,
//         available_qty: stock?.available_qty || 0,
//         available_weight: stock?.available_weight || 0,
//         store_code: loginStoreCode,
//       },
//     });
//   } catch (error) {
//     console.error("scanBillItemQR error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "QR scan failed",
//       error: error.message,
//     });
//   }
// };



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
  } catch {
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

    const session_id =
      req.headers["x-billing-session-id"] ||
      req.body?.session_id ||
      req.query?.session_id ||
      null;

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

    const qr = verifyQRPayload(rawCode);

    if (qr.isSecure && qr.valid === false) {
      return res.status(400).json({
        success: false,
        message: qr.message || "Invalid QR",
      });
    }

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

    const item = await Item.findOne({
      where: whereCondition,
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found for this QR code",
      });
    }

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

    const netWeight = toNumber(item.net_weight);
    const saleRate = toNumber(item.sale_rate);

    /*
      NEW SCAN PRICING STRUCTURE

      selling_price       = item selling value
      old_making_charge   = original making charge
      making_charge_value = editable making charge initially same as old
      other_discount      = optional, default 0
      taxable_amount      = selling_price + making_charge_value
      net_taxable_amount  = taxable_amount - other_discount
      gst_amount          = 3%
      total_amount        = net_taxable_amount + gst
    */

    const sellingPrice = toNumber(
      item.selling_price ||
        item.total_value ||
        item.sale_price ||
        item.sale_rate ||
        0
    );

    const oldMakingCharge = toNumber(
      item.making_charge_value ||
        item.making_charges ||
        item.making_charge ||
        0
    );

    const makingChargeValue = oldMakingCharge;
    const makingChargeDeduction = 0;
    const otherDiscount = 0;

    const taxableAmount = sellingPrice + makingChargeValue;
    const netTaxableAmount = taxableAmount - otherDiscount;

    const gstPercent = 3;
    const gstAmount = (netTaxableAmount * gstPercent) / 100;

    const totalAmount = netTaxableAmount + gstAmount;

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

      rate: Number(saleRate.toFixed(2)),
      purchase_rate: toNumber(item.purchase_rate),
      sale_rate: Number(saleRate.toFixed(2)),

      selling_price: Number(sellingPrice.toFixed(2)),

      old_making_charge: Number(oldMakingCharge.toFixed(2)),
      making_charge_value: Number(makingChargeValue.toFixed(2)),
      making_charge_after_deduction: Number(makingChargeValue.toFixed(2)),
      making_charge_deduction: Number(makingChargeDeduction.toFixed(2)),

      other_discount: Number(otherDiscount.toFixed(2)),

      taxable_amount: Number(taxableAmount.toFixed(2)),
      net_taxable_amount: Number(netTaxableAmount.toFixed(2)),

      gst_percent: Number(gstPercent.toFixed(2)),
      gst_amount: Number(gstAmount.toFixed(2)),

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

    try {
      if (session_id) {
        emitBillingScan({
          organization_id: organizationId,
          store_code:
            req.user?.store_code ||
            req.user?.store?.store_code ||
            null,
          session_id,
          item: scannedItem,
        });
      }
    } catch (socketError) {
      console.error("Billing socket emit error:", socketError.message);
    }

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
export const createManualBillingEntry = async (req, res) => {
  try {
    const userScope = resolveUserScope(req.user);

    let organization_id = userScope.organization_id;
    let loginStoreCode = userScope.store_code;

    /**
     * Token me organization_id missing ho to store_code se Store.id resolve karo
     */
    if ((!organization_id || !loginStoreCode) && req.user?.store_code) {
      const store = await Store.findOne({
        where: {
          store_code: String(req.user.store_code).trim().toUpperCase(),
          is_active: true,
        },
        attributes: [
          "id",
          "store_code",
          "store_name",
          "organization_level",
          "is_active",
        ],
      });

      if (store) {
        organization_id = Number(store.id);
        loginStoreCode = String(store.store_code).trim().toUpperCase();
      }
    }

    if (!organization_id) {
      organization_id = Number(
        req.headers["x-organization-id"] ||
          req.headers.organization_id ||
          req.body.organization_id ||
          0
      );
    }

    if (!loginStoreCode) {
      loginStoreCode = String(
        req.headers["x-store-code"] ||
          req.headers.store_code ||
          req.body.store_code ||
          ""
      )
        .trim()
        .toUpperCase();
    }

    if (!organization_id || !loginStoreCode) {
      return res.status(401).json({
        success: false,
        message:
          "Unable to resolve logged-in user entity. Token must contain organization_id or valid store_code.",
        debug_user: req.user || null,
      });
    }

    const {
      product_code,
      product_name,
      purity,
      net_weight,
      gross_weight,
      making_charges,
      total_value,
      rate,
    } = req.body;

    const cleanProductCode = String(product_code || "").trim();
    const cleanProductName = String(product_name || "").trim();
    const cleanPurity = String(purity || "").trim();

    const inputNetWeight = toNumber(net_weight);
    const inputGrossWeight = toNumber(gross_weight);
    const inputMakingCharges = toNumber(making_charges);
    const inputTotalValue = toNumber(total_value);
    const inputRate = toNumber(rate);

    if (!cleanProductCode) {
      return res.status(400).json({
        success: false,
        message: "Product Code is required",
      });
    }

    if (!cleanProductName) {
      return res.status(400).json({
        success: false,
        message: "Product Name is required",
      });
    }

    if (!cleanPurity) {
      return res.status(400).json({
        success: false,
        message: "Purity is required",
      });
    }

    if (inputNetWeight <= 0) {
      return res.status(400).json({
        success: false,
        message: "Net Weight must be greater than 0",
      });
    }

    if (inputGrossWeight <= 0) {
      return res.status(400).json({
        success: false,
        message: "Gross Weight must be greater than 0",
      });
    }

    if (inputGrossWeight < inputNetWeight) {
      return res.status(400).json({
        success: false,
        message: "Gross Weight cannot be less than Net Weight",
      });
    }

    if (inputMakingCharges < 0) {
      return res.status(400).json({
        success: false,
        message: "Making Charges cannot be negative",
      });
    }

    /**
     * ✅ Existing item lookup only
     * Product Code ko article_code ya sku_code se match karenge.
     */
    const item = await Item.findOne({
      where: {
        organization_id: Number(organization_id),
        current_status: "in_stock",
        is_active: true,
        [Op.or]: [
          { article_code: cleanProductCode },
          { sku_code: cleanProductCode },
        ],
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message:
          "Item not found in stock for this Product Code. Manual billing can only be done for existing in-stock items.",
        data: {
          product_code: cleanProductCode,
          organization_id: Number(organization_id),
          store_code: loginStoreCode,
        },
      });
    }

    /**
     *  Stock check
     */
    const stock = await Stock.findOne({
      where: {
        item_id: item.id,
        organization_id: Number(organization_id),
      },
    });

    if (!stock) {
      return res.status(404).json({
        success: false,
        message: "Stock record not found for this item",
        data: {
          item_id: item.id,
          product_code: cleanProductCode,
          organization_id: Number(organization_id),
        },
      });
    }

    if (toNumber(stock.available_qty) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Item is out of stock",
        data: {
          item_id: item.id,
          product_code: cleanProductCode,
          available_qty: toNumber(stock.available_qty),
        },
      });
    }

    if (toNumber(stock.available_weight) < inputNetWeight) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock weight for this item",
        data: {
          item_id: item.id,
          product_code: cleanProductCode,
          requested_weight: inputNetWeight,
          available_weight: toNumber(stock.available_weight),
        },
      });
    }

    /**
     *  UI values ko billing values ke liye use karenge
     * Lekin item_id existing DB item ki hogi.
     */
    let finalRate = inputRate;
    let metalValue = 0;
    let finalTotalAmount = 0;

    if (inputTotalValue > 0) {
      finalTotalAmount = inputTotalValue;
      metalValue = Math.max(inputTotalValue - inputMakingCharges, 0);
      finalRate = inputNetWeight > 0 ? metalValue / inputNetWeight : 0;
    } else {
      finalRate = inputRate || toNumber(item.sale_rate);

      if (finalRate <= 0) {
        return res.status(400).json({
          success: false,
          message: "Either total_value, rate, or item sale_rate is required",
        });
      }

      metalValue = inputNetWeight * finalRate;
      finalTotalAmount = metalValue + inputMakingCharges;
    }

    if (finalRate <= 0) {
      return res.status(400).json({
        success: false,
        message: "Calculated rate must be greater than 0",
      });
    }

    /**
     * Important:
     * Existing createBill making_charge_percent use karta hai.
     * UI me making_charges absolute value hai.
     * Isliye absolute making_charges ko percent me convert kar rahe hain,
     * taaki final createBill API same total calculate kare.
     */
    const makingChargePercent =
      metalValue > 0 ? (inputMakingCharges / metalValue) * 100 : 0;

    return res.status(200).json({
      success: true,
      message: "Manual billing item fetched successfully",
      data: {
        item_id: item.id,
        is_manual_entry: true,

        product_code: item.article_code || item.sku_code || cleanProductCode,
        sku_code: item.sku_code,
        article_code: item.article_code,

        item_name: item.item_name,
        description: item.details || item.item_name || cleanProductName,

        metal_type: item.metal_type,
        category: item.category,
        purity: item.purity || cleanPurity,

        gross_weight: Number(inputGrossWeight.toFixed(3)),
        net_weight: Number(inputNetWeight.toFixed(3)),

        rate: Number(finalRate.toFixed(2)),
        sale_rate: Number(finalRate.toFixed(2)),

        /**
         * createBill compatible fields
         */
        making_charge_percent: Number(makingChargePercent.toFixed(6)),
        making_charge_value: Number(inputMakingCharges.toFixed(2)),
        making_charges: Number(inputMakingCharges.toFixed(2)),

        metal_value: Number(metalValue.toFixed(2)),
        total_value: Number(finalTotalAmount.toFixed(2)),
        total_amount: Number(finalTotalAmount.toFixed(2)),

        qty: 1,
        unit: item.unit || "gm",

        available_qty: toNumber(stock.available_qty),
        available_weight: toNumber(stock.available_weight),

        current_status: item.current_status,
        qr_type: "manual",

        organization_id: Number(organization_id),
        store_code: loginStoreCode,
      },
    });
  } catch (error) {
    console.error("Create Manual Billing Entry Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch manual billing item",
      error: error.message,
    });
  }
};
