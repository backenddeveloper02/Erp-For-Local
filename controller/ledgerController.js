// controllers/LedgerEntry.js
// controllers/LedgerEntry.js
import { QueryTypes } from "sequelize";
import sequelize from "../config/db.js";
import axios from "axios";
import Customer from "../model/Customer.js";
import LedgerEntry from "../model/LedgerEntry.js";
import Bill from "../model/Bill.js"
import PDFDocument from "pdfkit";
import InvoiceItem from "../model/InvoiceItem.js"
// import Customer from "../model/Customer.js";
import Store from "../model/Store.js";
import Invoice from "../model/invoices.js"; // if available in your project
import ExcelJS from "exceljs";
// import { resolveDistrictOrganization } from "../utils/resolveDistrictOrganization.js"
import { Op, fn,col, literal } from "sequelize";


/**
 * @desc    Get ledger dashboard summary + client wise ledger
 * @route   GET /api/ledger
 */
export const getLedger = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { organization_id } = req.user;
    const { search = "" } = req.query;

    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: "organization_id is missing in req.user",
      });
    }

    const cleanSearch = String(search || "").trim();

    const ledgerWhere = {
      organization_id,
    };

    const customerWhere = {
      organization_id,
    };

    if (cleanSearch) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${cleanSearch}%` } },
        { phone: { [Op.iLike]: `%${cleanSearch}%` } },
      ];
    }

    // ===============================
    // SUMMARY RAW
    // ===============================
    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    // ===============================
    // CLIENT WISE TABLE
    // ===============================
    const clientRows = await LedgerEntry.findAll({
      where: ledgerWhere,
      attributes: [
        "customer_id",
        [
          fn(
            "COUNT",
            literal(
              `DISTINCT CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."reference_id" END`
            )
          ),
          "total_deals",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "total_amount",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "received_amount",
        ],
        [
          literal(`
            COALESCE(
              SUM(
                CASE 
                  WHEN "LedgerEntry"."type" = 'DEBIT' 
                  THEN "LedgerEntry"."amount" 
                  ELSE 0 
                END
              ), 
              0
            )
            -
            COALESCE(
              SUM(
                CASE 
                  WHEN "LedgerEntry"."type" = 'CREDIT' 
                  THEN "LedgerEntry"."amount" 
                  ELSE 0 
                END
              ), 
              0
            )
          `),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Customer,
          as: "customer",
          attributes: ["id", "name", "phone", "address", "store_code"],
          where: customerWhere,
          required: true,
        },
      ],
      group: ["LedgerEntry.customer_id", "customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    // ===============================
    // TOTAL DEALS FROM INVOICE TABLE
    // 1 Invoice = 1 Deal
    // ===============================
    const invoiceCounts = await Invoice.findAll({
      where: {
        organization_id,
      },
      attributes: [
        "customer_id",
        [fn("COUNT", col("id")), "total_deals"],
      ],
      group: ["customer_id"],
      raw: true,
    });

    const invoiceMap = {};

    invoiceCounts.forEach((item) => {
      invoiceMap[Number(item.customer_id)] = Number(item.total_deals || 0);
    });

    const clients = clientRows.map((row) => {
      const totalAmount = Number(row.get("total_amount") || 0);
      const receivedAmount = Number(row.get("received_amount") || 0);
      const pendingAmount = Number(row.get("pending_amount") || 0);

      return {
        customer_id: Number(row.customer_id),
        client_name: row.customer?.name || "",
        phone: row.customer?.phone || "",
        address: row.customer?.address || "",
        store_code: row.customer?.store_code || "",
        total_deals: invoiceMap[Number(row.customer_id)] || 0,
        total_amount: Number(totalAmount.toFixed(2)),
        received_amount: Number(receivedAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
      };
    });

    const totalAmount = clients.reduce(
      (sum, item) => sum + Number(item.total_amount || 0),
      0
    );

    const receivedAmount = clients.reduce(
      (sum, item) => sum + Number(item.received_amount || 0),
      0
    );

    const pendingAmount = clients.reduce(
      (sum, item) => sum + Number(item.pending_amount || 0),
      0
    );

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),

      // UI me Total Loss ke liye
      loss: 0,

      // Purana key backward compatibility ke liye rakha hai
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),

      // New proper dashboard keys
      total_clients: clients.length,
      total_amount: Number(totalAmount.toFixed(2)),
      received_amount: Number(receivedAmount.toFixed(2)),
      pending_amount: Number(pendingAmount.toFixed(2)),

      // UI me Collectable Amount ke liye ye use karo
      collectable_amount: Number(pendingAmount.toFixed(2)),
    };

    return res.status(200).json({
      success: true,
      message: "Ledger dashboard fetched successfully",
      data: {
        summary,
        clients,
      },
    });
  } catch (error) {
    console.error("Ledger Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch ledger",
      error: error.message,
    });
  }
};
export const downloadLedgerExcel = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { organization_id } = req.user;
    const { search = "" } = req.query;

    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: "organization_id is missing in req.user",
      });
    }

    const cleanSearch = String(search || "").trim();

    const ledgerWhere = { organization_id };
    const customerWhere = { organization_id };

    if (cleanSearch) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${cleanSearch}%` } },
        { phone: { [Op.iLike]: `%${cleanSearch}%` } },
      ];
    }

    const store = await Store.findOne({
      where: { id: organization_id },
      attributes: ["id", "store_name", "store_code", "organization_level"],
      raw: true,
    });

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await LedgerEntry.findAll({
      where: ledgerWhere,
      attributes: [
        "customer_id",
        [
          fn(
            "COUNT",
            literal(
              `DISTINCT CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."reference_id" END`
            )
          ),
          "total_deals",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "total_amount",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "received_amount",
        ],
        [
          literal(`
            COALESCE(SUM(CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END), 0)
            -
            COALESCE(SUM(CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END), 0)
          `),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Customer,
          as: "customer",
          attributes: ["id", "name", "phone", "address", "store_code"],
          where: customerWhere,
          required: true,
        },
      ],
      group: ["LedgerEntry.customer_id", "customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const clients = clientRows.map((row) => ({
      customer_id: Number(row.customer_id),
      client_name: row.customer?.name || "",
      phone: row.customer?.phone || "",
      address: row.customer?.address || "",
      store_code: row.customer?.store_code || "",
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: clients.length,
      total_amount: clients.reduce(
        (sum, item) => sum + Number(item.total_amount || 0),
        0
      ),
      received_amount: clients.reduce(
        (sum, item) => sum + Number(item.received_amount || 0),
        0
      ),
      pending_amount: clients.reduce(
        (sum, item) => sum + Number(item.pending_amount || 0),
        0
      ),
    };

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "ERP System";
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet("Ledger Report", {
      views: [{ state: "frozen", ySplit: 12 }],
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    worksheet.properties.defaultRowHeight = 22;

    worksheet.columns = [
      { key: "customer_name", width: 26 },
      { key: "phone", width: 16 },
      { key: "store_code", width: 16 },
      { key: "address", width: 34 },
      { key: "total_deals", width: 14 },
      { key: "total_amount", width: 18 },
      { key: "received_amount", width: 20 },
      { key: "pending_amount", width: 20 },
    ];

    const titleFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111827" },
    };

    const sectionFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };

    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };

    const cardFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF9FAFB" },
    };

    const border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };

    const moneyFormat = '₹#,##0.00;[Red]-₹#,##0.00';
    const numberFormat = '#,##0';

    // =========================
    // TITLE
    // =========================
    worksheet.mergeCells("A1:H1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "Dashboard & Ledger Report";
    titleCell.font = {
      bold: true,
      size: 18,
      color: { argb: "FFFFFFFF" },
    };
    titleCell.fill = titleFill;
    titleCell.alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    worksheet.getRow(1).height = 34;

    // =========================
    // STORE INFO
    // =========================
    worksheet.mergeCells("A3:B3");
    worksheet.getCell("A3").value = "Store / Organization";
    worksheet.getCell("A3").font = { bold: true };

    worksheet.mergeCells("C3:D3");
    worksheet.getCell("C3").value =
      store?.store_name || req.user?.store_name || "N/A";

    worksheet.mergeCells("E3:F3");
    worksheet.getCell("E3").value = "Store Code";
    worksheet.getCell("E3").font = { bold: true };

    worksheet.mergeCells("G3:H3");
    worksheet.getCell("G3").value =
      store?.store_code || req.user?.store_code || "N/A";

    worksheet.mergeCells("A4:B4");
    worksheet.getCell("A4").value = "Organization ID";
    worksheet.getCell("A4").font = { bold: true };

    worksheet.mergeCells("C4:D4");
    worksheet.getCell("C4").value = organization_id;

    worksheet.mergeCells("E4:F4");
    worksheet.getCell("E4").value = "Generated At";
    worksheet.getCell("E4").font = { bold: true };

    worksheet.mergeCells("G4:H4");
    worksheet.getCell("G4").value = new Date().toLocaleString("en-IN");

    ["A3", "C3", "E3", "G3", "A4", "C4", "E4", "G4"].forEach((cell) => {
      worksheet.getCell(cell).border = border;
      worksheet.getCell(cell).alignment = {
        vertical: "middle",
        horizontal: "left",
      };
    });

    // =========================
    // DASHBOARD CARDS
    // =========================
    worksheet.mergeCells("A6:H6");
    worksheet.getCell("A6").value = "Dashboard Cards";
    worksheet.getCell("A6").font = { bold: true, size: 13 };
    worksheet.getCell("A6").fill = sectionFill;
    worksheet.getCell("A6").border = border;

    const cards = [
      ["A7:B8", "Total Sales", summary.total_sales, numberFormat],
      ["C7:D8", "Goods Receipt", summary.goods_receipt, numberFormat],
      ["E7:F8", "Total Clients", summary.total_clients, numberFormat],
      ["G7:H8", "Loss", summary.loss, moneyFormat],
      ["A9:B10", "Total Amount", summary.total_amount, moneyFormat],
      ["C9:D10", "Received Amount", summary.received_amount, moneyFormat],
      ["E9:F10", "Pending Amount", summary.pending_amount, moneyFormat],
      ["G9:H10", "Collectable", summary.pending_amount, moneyFormat],
    ];

    cards.forEach(([range, label, value, format]) => {
      worksheet.mergeCells(range);

      const startCell = range.split(":")[0];
      const cell = worksheet.getCell(startCell);

      cell.value = {
        richText: [
          {
            text: `${label}\n`,
            font: {
              bold: true,
              size: 10,
              color: { argb: "FF6B7280" },
            },
          },
          {
            text: String(value),
            font: {
              bold: true,
              size: 15,
              color: { argb: "FF111827" },
            },
          },
        ],
      };

      cell.fill = cardFill;
      cell.border = border;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      if (typeof value === "number") {
        cell.numFmt = format;
      }
    });

    worksheet.getRow(7).height = 25;
    worksheet.getRow(8).height = 25;
    worksheet.getRow(9).height = 25;
    worksheet.getRow(10).height = 25;

    // =========================
    // CUSTOMER LEDGER TABLE
    // =========================
    worksheet.mergeCells("A12:H12");
    worksheet.getCell("A12").value = "Customer Ledger";
    worksheet.getCell("A12").font = { bold: true, size: 13 };
    worksheet.getCell("A12").fill = sectionFill;
    worksheet.getCell("A12").border = border;

    const headerRowIndex = 13;
    const headerRow = worksheet.getRow(headerRowIndex);

    headerRow.values = [
      "Customer Name",
      "Phone",
      "Store Code",
      "Address",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount",
    ];

    headerRow.height = 26;

    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = headerFill;
      cell.border = border;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });

    clients.forEach((item) => {
      const row = worksheet.addRow({
        customer_name: item.client_name,
        phone: item.phone,
        store_code: item.store_code,
        address: item.address,
        total_deals: item.total_deals,
        total_amount: item.total_amount,
        received_amount: item.received_amount,
        pending_amount: item.pending_amount,
      });

      row.eachCell((cell, colNumber) => {
        cell.border = border;
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber >= 5 ? "right" : "left",
          wrapText: true,
        };
      });

      row.getCell(2).numFmt = "@";
      row.getCell(3).numFmt = "@";
      row.getCell(5).numFmt = numberFormat;
      row.getCell(6).numFmt = moneyFormat;
      row.getCell(7).numFmt = moneyFormat;
      row.getCell(8).numFmt = moneyFormat;
    });

    const lastRow = worksheet.rowCount;

    if (clients.length > 0) {
      const totalRow = worksheet.addRow({
        customer_name: "Grand Total",
        phone: "",
        store_code: "",
        address: "",
        total_deals: clients.reduce(
          (sum, item) => sum + Number(item.total_deals || 0),
          0
        ),
        total_amount: summary.total_amount,
        received_amount: summary.received_amount,
        pending_amount: summary.pending_amount,
      });

      totalRow.height = 26;

      totalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true };
        cell.fill = sectionFill;
        cell.border = border;
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber >= 5 ? "right" : "left",
        };
      });

      totalRow.getCell(5).numFmt = numberFormat;
      totalRow.getCell(6).numFmt = moneyFormat;
      totalRow.getCell(7).numFmt = moneyFormat;
      totalRow.getCell(8).numFmt = moneyFormat;
    }

    worksheet.autoFilter = {
      from: {
        row: headerRowIndex,
        column: 1,
      },
      to: {
        row: headerRowIndex,
        column: 8,
      },
    };

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.font = {
          name: "Calibri",
          size: cell.font?.size || 11,
          bold: cell.font?.bold || false,
          color: cell.font?.color,
        };
      });
    });

    worksheet.getRow(1).font = {
      name: "Calibri",
      bold: true,
      size: 18,
      color: { argb: "FFFFFFFF" },
    };

    const fileName = `ledger_report_${
      store?.store_code || req.user?.store_code || organization_id
    }_${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("Download Ledger Excel Error:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to download ledger excel",
        error: error.message,
      });
    }

    return res.end();
  }
};
/**
 * @desc    Get detailed ledger for one customer
 * @route   GET /api/ledger/customer/:customer_id
 */

export const getCustomerLedgerDetail = async (req, res) => {
  try {
    const customer_id = Number(req.params.customer_id);

    if (isNaN(customer_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer_id",
      });
    }

    const organization_id = req.user?.organization_id || null;

    const customerWhere = { id: customer_id };
    if (organization_id) customerWhere.organization_id = organization_id;

    const customer = await Customer.findOne({ where: customerWhere });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const ledgerWhere = { customer_id };
    if (organization_id) ledgerWhere.organization_id = organization_id;

    const entries = await LedgerEntry.findAll({
      where: ledgerWhere,
      order: [["createdAt", "ASC"]],
      raw: true,
    });

    const debitEntries = entries.filter((e) => e.type === "DEBIT");
    const creditEntries = entries.filter((e) => e.type === "CREDIT");

    let totalCreditPool = creditEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const rows = [];

    for (const entry of debitEntries) {
      const debitAmount = parseFloat(entry.amount || 0);

      let receivedAmount = 0;

      if (totalCreditPool > 0) {
        receivedAmount = Math.min(totalCreditPool, debitAmount);
        totalCreditPool -= receivedAmount;
      }

      const pendingAmount = debitAmount - receivedAmount;

      let invoiceId = null;
      let invoiceNumber = "-";

      if (
        entry.reference_type === "INVOICE" &&
        entry.reference_id
      ) {
        const invoiceWhere = { id: entry.reference_id };
        if (organization_id) invoiceWhere.organization_id = organization_id;

        const invoice = await Invoice.findOne({
          where: invoiceWhere,
          attributes: ["id", "invoice_number", "bill_id", "createdAt"],
          raw: true,
        });

        if (invoice) {
          invoiceId = invoice.id;
          invoiceNumber = invoice.invoice_number || "-";
        }
      }

      if (
        entry.reference_type === "BILL" &&
        entry.reference_id
      ) {
        const invoiceWhere = { bill_id: entry.reference_id };
        if (organization_id) invoiceWhere.organization_id = organization_id;

        const invoice = await Invoice.findOne({
          where: invoiceWhere,
          attributes: ["id", "invoice_number", "bill_id", "createdAt"],
          raw: true,
        });

        if (invoice) {
          invoiceId = invoice.id;
          invoiceNumber = invoice.invoice_number || "-";
        } else {
          const billWhere = { id: entry.reference_id };
          if (organization_id) billWhere.organization_id = organization_id;

          const bill = await Bill.findOne({
            where: billWhere,
            attributes: ["id", "bill_number", "createdAt"],
            raw: true,
          });

          if (bill) {
            invoiceId = bill.id;
            invoiceNumber = bill.bill_number || "-";
          }
        }
      }

      if (!invoiceId) {
        const invoiceWhere = {
          customer_id,
          total_amount: debitAmount,
        };

        if (organization_id) invoiceWhere.organization_id = organization_id;

        const invoice = await Invoice.findOne({
          where: invoiceWhere,
          attributes: ["id", "invoice_number", "bill_id", "createdAt"],
          order: [["createdAt", "DESC"]],
          raw: true,
        });

        if (invoice) {
          invoiceId = invoice.id;
          invoiceNumber = invoice.invoice_number || "-";
        }
      }

      rows.push({
        ledger_id: entry.id,
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        date: entry.createdAt,
        total_amount: Number(debitAmount.toFixed(2)),
        received_amount: Number(receivedAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
        reference_type: entry.reference_type,
        reference_id: entry.reference_id,
        action: "View",
      });
    }

    const totalAmount = debitEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const totalReceived = creditEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const totalPending = totalAmount - totalReceived;

    return res.status(200).json({
      success: true,
      message: "Customer ledger detail fetched successfully",
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          pan_card_number: customer.pan_card_number,
          store_code: customer.store_code,
        },
        summary: {
          total_amount: Number(totalAmount.toFixed(2)),
          received_amount: Number(totalReceived.toFixed(2)),
          pending_amount: Number(totalPending.toFixed(2)),
        },
        deals: rows.reverse(),
      },
    });
  } catch (err) {
    console.error("Ledger Detail Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer ledger detail",
      error: err.message,
    });
  }
};
const DISTRICT_LEVELS = ["district", "District", "DISTRICT"];

const getStoreNameField = () => {
  if (Store.rawAttributes?.store_name) return "store_name";
  if (Store.rawAttributes?.name) return "name";
  return "store_name";
};

const getStoreCodeField = () => {
  if (Store.rawAttributes?.store_code) return "store_code";
  if (Store.rawAttributes?.code) return "code";
  return "store_code";
};

const getInvoiceNoField = () => {
  if (Invoice?.rawAttributes?.invoice_number) return "invoice_number";
  if (Invoice?.rawAttributes?.invoice_no) return "invoice_no";
  if (Invoice?.rawAttributes?.bill_no) return "bill_no";
  return "invoice_number";
};

const getInvoiceDateField = () => {
  if (Invoice?.rawAttributes?.invoice_date) return "invoice_date";
  if (Invoice?.rawAttributes?.date) return "date";
  if (Invoice?.rawAttributes?.createdAt) return "createdAt";
  return "invoice_date";
};

const resolveDistrictOrganization = async (user) => {
  if (!user) {
    throw new Error("User not authenticated");
  }

  if (!DISTRICT_LEVELS.includes(user.organization_level)) {
    throw new Error("Only district users can access this ledger");
  }

  let districtOrg = null;

  if (user.store_code) {
    districtOrg = await Store.findOne({
      where: {
        store_code: user.store_code,
      },
      raw: true,
    });

    if (districtOrg) return districtOrg;
  }

  districtOrg = await Store.findOne({
    where: {
      id: user.organization_id,
    },
    raw: true,
  });

  if (districtOrg) return districtOrg;

  throw new Error("District office organization not found");
};

const getDistrictScope = async (user) => {
  const districtOrg = await resolveDistrictOrganization(user);

  return {
    districtOrg,
    districtStoreCode: user.store_code || districtOrg[getStoreCodeField()],
    districtOrgId: user.organization_id || districtOrg.id,
  };
};

export const getDistrictLedger = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { search = "" } = req.query;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this ledger",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customerWhere = {
      store_code: districtStoreCode,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    const ledgerWhere = {
      store_code: districtStoreCode,
    };

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await Customer.findAll({
      where: customerWhere,
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
        [fn("COUNT", literal(`DISTINCT "invoices"."id"`)), "total_deals"],
        [
          fn("COALESCE", fn("SUM", col(`invoices.total_amount`)), 0),
          "total_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.received_amount`)), 0),
          "received_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.pending_amount`)), 0),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Invoice,
          as: "invoices",
          attributes: [],
          required: false,
          where: {
            store_code: districtStoreCode,
          },
        },
      ],
      group: ["Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const clients = clientRows.map((row) => ({
      customer_id: row.id,
      client_name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      store_code: row.store_code || "",
      source_type: "district",
      source_name: districtOrg[getStoreNameField()] || "District Office",
      source_store_code: districtStoreCode,
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: clients.length,
      total_amount: clients.reduce(
        (sum, item) => sum + Number(item.total_amount || 0),
        0
      ),
      total_received: clients.reduce(
        (sum, item) => sum + Number(item.received_amount || 0),
        0
      ),
      total_pending: clients.reduce(
        (sum, item) => sum + Number(item.pending_amount || 0),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      message: "District ledger dashboard fetched successfully",
      data: {
        district: {
          organization_id: districtOrgId,
          district_id: districtOrg.district_id || districtOrgId,
          store_code: districtStoreCode,
          store_name: districtOrg[getStoreNameField()] || "District Office",
          organization_level: req.user.organization_level,
        },
        summary,
        clients,
      },
    });
  } catch (error) {
    console.error("District Ledger Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district ledger",
      error: error.message,
    });
  }
};

export const getDistrictLedgerClientDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { customerId } = req.params;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this ledger detail",
      });
    }

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customer = await Customer.findOne({
      where: {
        id: customerId,
        store_code: districtStoreCode,
      },
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
      ],
      raw: true,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "District client not found",
      });
    }

    const invoiceNoField = getInvoiceNoField();
    const invoiceDateField = getInvoiceDateField();

    const invoices = await Invoice.findAll({
      where: {
        customer_id: customer.id,
        store_code: districtStoreCode,
      },
      attributes: [
        "id",
        ...(invoiceNoField ? [invoiceNoField] : []),
        ...(invoiceDateField ? [invoiceDateField] : []),
        "total_amount",
        "received_amount",
        "pending_amount",
      ],
      order: [
        [invoiceDateField, "DESC"],
        ["id", "DESC"],
      ],
      raw: true,
    });

    const rows = invoices.map((inv) => ({
      invoice_id: inv.id,
      invoice_number: inv[invoiceNoField] || `INV-${inv.id}`,
      date: inv[invoiceDateField]
        ? new Date(inv[invoiceDateField]).toISOString().split("T")[0]
        : null,
      total_amount: Number(inv.total_amount || 0),
      received_amount: Number(inv.received_amount || 0),
      pending_amount: Number(inv.pending_amount || 0),
      action: "View",
    }));

    return res.status(200).json({
      success: true,
      message: "District client ledger detail fetched successfully",
      data: {
        district: {
          organization_id: districtOrgId,
          district_id: districtOrg.district_id || districtOrgId,
          store_code: districtStoreCode,
          store_name: districtOrg[getStoreNameField()] || "District Office",
        },
        client: {
          id: customer.id,
          name: customer.name || "",
          phone: customer.phone || "",
          address: customer.address || "",
          store_code: customer.store_code || "",
          source_type: "district",
          source_name: districtOrg[getStoreNameField()] || "District Office",
        },
        summary: {
          total_deals: rows.length,
          total_amount: rows.reduce((sum, item) => sum + item.total_amount, 0),
          received_amount: rows.reduce(
            (sum, item) => sum + item.received_amount,
            0
          ),
          pending_amount: rows.reduce(
            (sum, item) => sum + item.pending_amount,
            0
          ),
        },
        rows,
      },
    });
  } catch (error) {
    console.error("District Ledger Client Detail Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district client ledger detail",
      error: error.message,
    });
  }
};

export const downloadDistrictLedgerExcel = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { search = "" } = req.query;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can download this ledger excel",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customerWhere = {
      store_code: districtStoreCode,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    const ledgerWhere = {
      store_code: districtStoreCode,
    };

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await Customer.findAll({
      where: customerWhere,
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
        [fn("COUNT", literal(`DISTINCT "invoices"."id"`)), "total_deals"],
        [
          fn("COALESCE", fn("SUM", col(`invoices.total_amount`)), 0),
          "total_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.received_amount`)), 0),
          "received_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.pending_amount`)), 0),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Invoice,
          as: "invoices",
          attributes: [],
          required: false,
          where: {
            store_code: districtStoreCode,
          },
        },
      ],
      group: ["Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const data = clientRows.map((row) => ({
      customer_id: row.id,
      client_name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      customer_store_code: row.store_code || "",
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: data.length,
      total_amount: data.reduce((sum, item) => sum + item.total_amount, 0),
      total_received: data.reduce((sum, item) => sum + item.received_amount, 0),
      total_pending: data.reduce((sum, item) => sum + item.pending_amount, 0),
    };

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("District Ledger");

    worksheet.mergeCells("A1:I1");
    worksheet.getCell("A1").value = "District Ledger Dashboard Report";
    worksheet.getCell("A1").font = { bold: true, size: 16 };
    worksheet.getCell("A1").alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    worksheet.getCell("A3").value = "District Office Name";
    worksheet.getCell("B3").value =
      districtOrg[getStoreNameField()] || "District Office";

    worksheet.getCell("A4").value = "District Office Code";
    worksheet.getCell("B4").value = districtStoreCode;

    worksheet.getCell("A5").value = "Organization ID";
    worksheet.getCell("B5").value = districtOrgId;

    worksheet.getCell("A6").value = "District ID";
    worksheet.getCell("B6").value = districtOrg.district_id || districtOrgId;

    worksheet.getCell("A7").value = "Organization Level";
    worksheet.getCell("B7").value = req.user.organization_level || "District";

    worksheet.getCell("A8").value = "Generated At";
    worksheet.getCell("B8").value = new Date().toLocaleString();

    ["A3", "A4", "A5", "A6", "A7", "A8"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    worksheet.getCell("D3").value = "Total Sales";
    worksheet.getCell("E3").value = summary.total_sales;

    worksheet.getCell("D4").value = "Loss";
    worksheet.getCell("E4").value = summary.loss;

    worksheet.getCell("D5").value = "Goods Receipt";
    worksheet.getCell("E5").value = summary.goods_receipt;

    worksheet.getCell("D6").value = "Total Clients";
    worksheet.getCell("E6").value = summary.total_clients;

    worksheet.getCell("D7").value = "Total Amount";
    worksheet.getCell("E7").value = summary.total_amount;

    worksheet.getCell("D8").value = "Received Amount";
    worksheet.getCell("E8").value = summary.total_received;

    worksheet.getCell("D9").value = "Pending Amount";
    worksheet.getCell("E9").value = summary.total_pending;

    ["D3", "D4", "D5", "D6", "D7", "D8", "D9"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    const headerRowIndex = 11;

    worksheet.getRow(headerRowIndex).values = [
      "Customer ID",
      "Client Name",
      "Phone",
      "Address",
      "District Store Code",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount",
    ];

    worksheet.getRow(headerRowIndex).font = { bold: true };

    data.forEach((item) => {
      worksheet.addRow([
        item.customer_id,
        item.client_name,
        item.phone,
        item.address,
        item.customer_store_code,
        item.total_deals,
        item.total_amount,
        item.received_amount,
        item.pending_amount,
      ]);
    });

    worksheet.columns = [
      { width: 15 },
      { width: 25 },
      { width: 18 },
      { width: 30 },
      { width: 20 },
      { width: 15 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
    ];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= headerRowIndex) {
        row.getCell(6).alignment = { horizontal: "center" };
        row.getCell(7).alignment = { horizontal: "right" };
        row.getCell(8).alignment = { horizontal: "right" };
        row.getCell(9).alignment = { horizontal: "right" };
      }
    });

    const fileName = `district_ledger_${districtStoreCode}_${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("Download District Ledger Excel Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download district ledger excel",
      error: error.message,
    });
  }
};


// =========================
// MODERN PROFESSIONAL PDF INVOICE
// =========================

// =========================
// IMPORTS
// =========================

// import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

// =========================
// DOWNLOAD INVOICE
// =========================

export const downloadInvoiceById = async (
  req,
  res
) => {
  try {
    // =========================
    // VALIDATION
    // =========================

    const invoice_id = Number(
      req.params.invoice_id
    );

    if (isNaN(invoice_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice id",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const organization_id =
      req.user.organization_id;

    // =========================
    // FETCH INVOICE
    // =========================

    const invoice = await Invoice.findOne({
      where: {
        id: invoice_id,
        organization_id,
      },
      raw: true,
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    // =========================
    // FETCH CUSTOMER
    // =========================

    const customer =
      await Customer.findOne({
        where: {
          id: invoice.customer_id,
        },
        raw: true,
      });

    // =========================
    // FETCH ITEMS
    // =========================

    const items = await sequelize.query(
      `
      SELECT *
      FROM invoice_items
      WHERE invoice_id = :invoice_id
      ORDER BY id ASC
      `,
      {
        replacements: {
          invoice_id,
        },
        type: QueryTypes.SELECT,
      }
    );

    // =========================
    // PDF CONFIG
    // =========================

    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
    });

    const fileName = `invoice_${invoice.id}.pdf`;

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    doc.pipe(res);

    // =========================
    // LOGO
    // =========================

    const logoPath = path.join(
      process.cwd(),
      "public",
      "logo.png"
    );

    // =========================
    // COLORS
    // =========================

    const COLORS = {
      bg: "#F8F6F3",
      white: "#FFFFFF",
      primary: "#2C3E50",
      secondary: "#7B6D62",
      accent: "#C7A17A",
      accentLight: "#EFE5DA",
      border: "#E7DED5",
      tableHead: "#A27B5C",
      text: "#6B7280",
    };

    // =========================
    // HELPERS
    // =========================

    const drawText = (
      text,
      x,
      y,
      size = 10,
      color = COLORS.primary,
      bold = false,
      align = "left",
      width = 100
    ) => {
      doc
        .fillColor(color)
        .font(
          bold
            ? "Helvetica-Bold"
            : "Helvetica"
        )
        .fontSize(size)
        .text(String(text || ""), x, y, {
          width,
          align,
        });
    };

    const roundedBox = (
      x,
      y,
      w,
      h,
      fill = COLORS.white,
      border = COLORS.border,
      radius = 12
    ) => {
      doc
        .fillColor(fill)
        .roundedRect(
          x,
          y,
          w,
          h,
          radius
        )
        .fill();

      doc
        .strokeColor(border)
        .lineWidth(1)
        .roundedRect(
          x,
          y,
          w,
          h,
          radius
        )
        .stroke();
    };

    // =========================
    // PAGE BG
    // =========================

    doc
      .fillColor(COLORS.bg)
      .rect(0, 0, 595, 842)
      .fill();

    // =========================
    // HEADER CARD
    // =========================

    roundedBox(
      25,
      25,
      545,
      150,
      COLORS.white,
      COLORS.border,
      18
    );

    // LEFT ACCENT

    doc
      .fillColor(COLORS.accent)
      .roundedRect(25, 25, 8, 150, 10)
      .fill();

    // LOGO

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 45, 48, {
        fit: [70, 70],
      });
    }

    // TITLE

    drawText(
      "TAX INVOICE",
      0,
      38,
      30,
      COLORS.primary,
      true,
      "center",
      595
    );

    // UNDERLINE

    doc
      .strokeColor(COLORS.accent)
      .lineWidth(2)
      .moveTo(255, 82)
      .lineTo(340, 82)
      .stroke();

    // COMPANY NAME

    drawText(
      "Merxenta Global Private Limited",
      0,
      102,
      18,
      COLORS.primary,
      true,
      "center",
      595
    );

    drawText(
      "H. No. 999/9, Gurugram, Haryana, India",
      0,
      130,
      10,
      COLORS.text,
      false,
      "center",
      595
    );

    drawText(
      "PH: 0120-256211",
      0,
      146,
      10,
      COLORS.text,
      false,
      "center",
      595
    );

    // DECORATIVE STRIP

    doc
      .fillColor("#D9C2A8")
      .roundedRect(25, 192, 380, 6, 5)
      .fill();

    doc
      .fillColor("#B08968")
      .polygon(
        [405, 192],
        [570, 192],
        [545, 198],
        [385, 198]
      )
      .fill();

    // =========================
    // INFO CARD
    // =========================

    const infoCard = (
      x,
      y,
      w,
      h,
      title,
      value
    ) => {
      roundedBox(
        x,
        y,
        w,
        h,
        COLORS.white,
        COLORS.border,
        16
      );

      // LEFT STRIP

      doc
        .fillColor(COLORS.accentLight)
        .roundedRect(
          x,
          y,
          8,
          h,
          16
        )
        .fill();

      // LABEL

      drawText(
        title,
        x + 24,
        y + 15,
        9,
        COLORS.secondary,
        true
      );

      // VALUE

      drawText(
        value,
        x + 24,
        y + 38,
        13,
        COLORS.primary,
        true
      );
    };

    // =========================
    // CUSTOMER INFO
    // =========================

    let infoY = 225;

    infoCard(
      30,
      infoY,
      255,
      70,
      "Customer Name",
      customer?.name || "-"
    );

    infoCard(
      310,
      infoY,
      255,
      70,
      "Invoice Number",
      String(
        invoice.invoice_number ||
          invoice.id
      )
    );

    infoCard(
      30,
      infoY + 85,
      255,
      70,
      "Customer Address",
      customer?.address || "-"
    );

    infoCard(
      310,
      infoY + 85,
      255,
      70,
      "Invoice Date",
      new Date(
        invoice.invoice_date ||
          invoice.createdAt
      ).toLocaleDateString("en-IN")
    );

    infoCard(
      30,
      infoY + 170,
      255,
      70,
      "State",
      customer?.state || "Haryana"
    );

    infoCard(
      310,
      infoY + 170,
      255,
      70,
      "State Code",
      customer?.state_code ||
        "STR004"
    );

    // =========================
    // TABLE START
    // =========================

    let y = 500;

    const columns = [
      {
        title: "S.No",
        x: 30,
        width: 50,
      },
      {
        title: "Product",
        x: 80,
        width: 145,
      },
      {
        title: "Purity",
        x: 225,
        width: 70,
      },
      {
        title: "Gross",
        x: 295,
        width: 70,
      },
      {
        title: "Less",
        x: 365,
        width: 70,
      },
      {
        title: "Net",
        x: 435,
        width: 70,
      },
      {
        title: "Rate",
        x: 505,
        width: 60,
      },
    ];

    // =========================
    // TABLE HEADER
    // =========================

    columns.forEach((col) => {
      doc
        .fillColor(COLORS.tableHead)
        .roundedRect(
          col.x,
          y,
          col.width,
          42,
          0
        )
        .fill();

      drawText(
        col.title,
        col.x,
        y + 14,
        10,
        COLORS.white,
        true,
        "center",
        col.width
      );
    });

    y += 42;

    // =========================
    // TOTALS
    // =========================

    let totalNet = 0;
    let totalRate = 0;
    let totalAmount = 0;

    // =========================
    // TABLE ROWS
    // =========================

    items.forEach((item, index) => {
      const bg =
        index % 2 === 0
          ? "#FFFFFF"
          : "#FAF7F4";

      const gross = Number(
        item.gross_weight || 0
      );

      const less = Number(
        item.less_weight || 0
      );

      const net = Number(
        item.net_weight || 0
      );

      const rate = Number(
        item.rate || 0
      );

      const amount = Number(
        item.total_amount || 0
      );

      totalNet += net;
      totalRate += rate;
      totalAmount += amount;

      const row = [
        index + 1,
        item.description || "-",
        item.purity || "-",
        gross.toFixed(3),
        less.toFixed(3),
        net.toFixed(3),
        rate.toFixed(2),
      ];

      columns.forEach((col, i) => {
        doc
          .fillColor(bg)
          .rect(
            col.x,
            y,
            col.width,
            44
          )
          .fill();

        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .rect(
            col.x,
            y,
            col.width,
            44
          )
          .stroke();

        drawText(
          row[i],
          col.x,
          y + 15,
          10,
          COLORS.primary,
          i === 1,
          "center",
          col.width
        );
      });

      y += 44;
    });

    // =========================
    // TOTAL ROW
    // =========================

    doc
      .fillColor(COLORS.accentLight)
      .roundedRect(
        30,
        y,
        535,
        50,
        12
      )
      .fill();

    drawText(
      "TOTAL",
      50,
      y + 17,
      12,
      COLORS.secondary,
      true
    );

    drawText(
      totalNet.toFixed(3),
      438,
      y + 17,
      11,
      COLORS.primary,
      true
    );

    drawText(
      totalRate.toFixed(2),
      510,
      y + 17,
      11,
      COLORS.primary,
      true
    );

    // =========================
    // TAX
    // =========================

    const sgst =
      totalAmount * 0.015;

    const cgst =
      totalAmount * 0.015;

    const grandTotal =
      totalAmount + sgst + cgst;

    // =========================
    // SUMMARY BOX
    // =========================

    const summaryX = 330;
    const summaryY = y + 80;

    roundedBox(
      summaryX,
      summaryY,
      235,
      125,
      COLORS.white,
      COLORS.border,
      16
    );

    const summaryRows = [
      [
        "SGST 1.5%",
        sgst.toFixed(2),
      ],
      [
        "CGST 1.5%",
        cgst.toFixed(2),
      ],
      [
        "Grand Total",
        grandTotal.toFixed(2),
      ],
    ];

    summaryRows.forEach(
      ([label, value], index) => {
        const rowY =
          summaryY + index * 41;

        const fill =
          label === "Grand Total"
            ? COLORS.accentLight
            : COLORS.white;

        doc
          .fillColor(fill)
          .rect(
            summaryX,
            rowY,
            235,
            41
          )
          .fill();

        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .rect(
            summaryX,
            rowY,
            235,
            41
          )
          .stroke();

        drawText(
          label,
          summaryX + 18,
          rowY + 14,
          11,
          COLORS.primary,
          true
        );

        drawText(
          value,
          summaryX + 145,
          rowY + 14,
          11,
          COLORS.primary,
          true
        );
      }
    );

    // =========================
    // FOOTER
    // =========================

    doc
      .strokeColor("#D9C2A8")
      .lineWidth(1.5)
      .moveTo(220, 800)
      .lineTo(370, 800)
      .stroke();

    drawText(
      "This is a computer generated invoice.",
      0,
      812,
      10,
      COLORS.text,
      false,
      "center",
      595
    );

    // =========================
    // END PDF
    // =========================

    doc.end();
  } catch (err) {
    console.error(
      "Download Invoice Error:",
      err
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          "Failed to download invoice",
        error: err.message,
      });
    }

    return res.end();
  }
};
