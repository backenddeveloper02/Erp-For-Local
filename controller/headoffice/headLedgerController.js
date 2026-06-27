import  sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Invoice } from "../../model/index.js";
import Customer from "../../model/Customer.js";
import fs from "fs";
import path from "path";

export const exportLedgerExcel = async (req, res) => {
  try {
    const { store_code } = req.params;

    //  Store Info
    const store = await sequelize.query(`
      SELECT id, store_name, store_code, organization_level
      FROM stores
      WHERE store_code = :store_code
    `, {
      replacements: { store_code },
      type: QueryTypes.SELECT
    });

    const storeData = store[0];

    //  Customer Ledger Data
    const customers = await sequelize.query(`
      SELECT 
        c.id AS customer_id,
        c.name,
        c.phone,
        c.address,
        c.store_code,

        COUNT(inv.id) AS total_deals,
        COALESCE(SUM(inv.total_amount),0) AS total_amount,
        COALESCE(SUM(inv.received_amount),0) AS received_amount,
        COALESCE(SUM(inv.pending_amount),0) AS pending_amount

      FROM customers c
      LEFT JOIN invoices inv 
        ON c.id = inv.customer_id
        AND inv.store_code = :store_code

      WHERE c.store_code = :store_code
      GROUP BY c.id
    `, {
      replacements: { store_code },
      type: QueryTypes.SELECT
    });

    //  Create Workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Ledger Report");

    //  TITLE
    sheet.mergeCells("A1:J1");
    sheet.getCell("A1").value = "Ledger Dashboard Report";
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    //  STORE DETAILS
    sheet.addRow([]);
    sheet.addRow(["Store Name", storeData.store_name]);
    sheet.addRow(["Store Code", storeData.store_code]);
    sheet.addRow(["Organization ID", storeData.id]);
    sheet.addRow(["Organization Level", storeData.organization_level]);
    sheet.addRow(["Generated At", new Date().toLocaleString()]);

    sheet.addRow([]);

    //  TABLE HEADER
    const header = [
      "Customer ID",
      "Client Name",
      "Phone",
      "Address",
      "Customer Store Code",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount"
    ];

    sheet.addRow(header);

    //  STYLE HEADER
    const headerRow = sheet.getRow(8);
    headerRow.font = { bold: true };

    //  DATA ROWS
    customers.forEach((c) => {
      sheet.addRow([
        c.customer_id,
        c.name,
        c.phone,
        c.address,
        c.store_code,
        c.total_deals,
        c.total_amount,
        c.received_amount,
        c.pending_amount
      ]);
    });

    //  AUTO WIDTH
    sheet.columns.forEach(col => {
      col.width = 20;
    });

    //  RESPONSE
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=ledger-${store_code}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * @desc Dashboard + All Stores Ledger (Combined API)
 * @route GET /api/dashboard/complete
 */
export const getCompleteDashboard = async (req, res) => {
  try {

    // ================= PERCENT CALC (FINAL FIX) =================
    const calcPercent = (curr, prev) => {
      curr = Number(curr) || 0;
      prev = Number(prev) || 0;

      if (prev === 0 && curr === 0) return 0;
      if (prev === 0) return "N/A";

      return Number((((curr - prev) / prev) * 100).toFixed(1));
    };

   // ================= CURRENT DATA =================
const current = await sequelize.query(`
  SELECT 
      COALESCE(SUM(ii.quantity),0) AS total_sales,

      COALESCE(SUM(i.purchase_rate * ii.quantity),0) AS total_cost,

      COALESCE(
          SUM(ii.total_amount - (i.purchase_rate * ii.quantity)),
      0) AS total_profit,

      COALESCE(SUM(inv.received_amount),0) AS received,

      COALESCE(SUM(inv.pending_amount),0) AS pending

  FROM invoices inv

  LEFT JOIN invoice_items ii
      ON inv.id = ii.invoice_id

  LEFT JOIN items i
      ON ii.item_id = i.id

  WHERE inv.status IN ('PAID', 'PARTIAL')
  AND COALESCE(ii.is_active, true) = true
`, { type: QueryTypes.SELECT });
   const previous = [{
  total_sales: 0,
  total_cost: 0,
  total_profit: 0,
  received: 0,
  pending: 0
}];
    const curr = current[0] || {};
    const prev = previous[0] || {};

    // ================= SAFE NUMBER CAST =================
    const currSales = Number(curr.total_sales) || 0;
    const prevSales = Number(prev.total_sales) || 0;

    const currProfit = Number(curr.total_profit) || 0;
    const prevProfit = Number(prev.total_profit) || 0;

    const currRevenue = Number(curr.received) || 0;
    const prevRevenue = Number(prev.received) || 0;

    const currPending = Number(curr.pending) || 0;
    const prevPending = Number(prev.pending) || 0;

    // ================= LOSS =================
    const lossCurrent = currProfit < 0 ? Math.abs(currProfit) : 0;
    const lossPrevious = prevProfit < 0 ? Math.abs(prevProfit) : 0;

    // ================= DASHBOARD =================
    const dashboard = {
      totalSales: {
        value: currSales,
        change: calcPercent(currSales, prevSales)
      },
      loss: {
        value: lossCurrent,
        change: calcPercent(lossCurrent, lossPrevious)
      },
      totalProfit: {
        value: currProfit,
        change: calcPercent(currProfit, prevProfit)
      },
      totalRevenue: {
        value: currRevenue,
        change: calcPercent(currRevenue, prevRevenue)
      },
      collectableAmount: {
        value: currPending,
        change: calcPercent(currPending, prevPending)
      }
    };

    // ================= LEDGER (UNCHANGED) =================
    const ledger = await sequelize.query(`
  SELECT 
    st.id,
    st.store_code,
    st.store_name,
    st.organization_level,

   MAX(u.username) AS store_manager,

    COUNT(DISTINCT inv.id) AS total_deals,

    COALESCE(SUM(inv.total_amount), 0) AS total_amount,

    COALESCE(SUM(inv.received_amount), 0) AS received_amount,

    COALESCE(SUM(inv.pending_amount), 0) AS pending_amount

  FROM stores st

  LEFT JOIN users u
    ON st.store_code = u.store_code

  LEFT JOIN invoices inv 
    ON st.store_code = inv.store_code

  WHERE st.organization_level IN ('District', 'Retail')

  GROUP BY 
    st.id,
    st.store_code,
    st.store_name,
    st.organization_level

  ORDER BY 
    st.organization_level DESC,
    st.store_name
`, { type: QueryTypes.SELECT });

    // ================= FINAL RESPONSE =================
    res.json({
      success: true,
      data: {
        dashboard,
        ledger
      }
    });

  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ error: error.message });
  }
};
/**
 * @desc Get Customer Ledger by Store Code
 * @route GET /api/ledger/store/:store_code/customers
 * @access All
 */
export const getStoreCustomerLedger = async (req, res) => {
  try {
    const { store_code } = req.params;

    if (!store_code) {
      return res.status(400).json({
        error: "store_code is required"
      });
    }

    const data = await sequelize.query(`
      SELECT 
        c.id AS customer_id,

        c.name AS client_name,

        COUNT(DISTINCT inv.id) AS total_deals,

        COALESCE(SUM(inv.total_amount), 0) AS total_amount,

        COALESCE(SUM(inv.received_amount), 0) AS received_amount,

        COALESCE(SUM(inv.pending_amount), 0) AS pending_amount

      FROM customers c

      LEFT JOIN invoices inv 
        ON c.id = inv.customer_id

      WHERE c.store_code = :store_code

      GROUP BY 
        c.id,
        c.name

      ORDER BY c.name ASC
    `, {
      replacements: { store_code },
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};
/**
 * @desc Get Customer Invoices
 * @route GET /api/ledger/customer/:customer_id/invoices
 */
export const getCustomerInvoices = async (req, res) => {
  try {
    const { customer_id } = req.params;

    const data = await sequelize.query(`
      SELECT 
        id,
        invoice_number,
        invoice_date,
        total_amount,
        received_amount,
        pending_amount

      FROM invoices
      WHERE customer_id = :customer_id
      ORDER BY invoice_date DESC
    `, {
      replacements: { customer_id },
      type: QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/**
 * @desc Get Payment History (READ ONLY for HO)
 * @route GET /api/ledger/invoice/:invoice_id/payments
 */
export const getInvoicePayments = async (req, res) => {
  try {
    const { invoice_id } = req.params;

    const data = await sequelize.query(`
      SELECT 
        payment_date AS date,
        amount AS received_amount,
        payment_method,
        txn_id,
        operator

      FROM payments
      WHERE invoice_id = :invoice_id
      ORDER BY payment_date DESC
    `, {
      replacements: { invoice_id },
      type: QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * @desc Export Dashboard + All Stores Ledger (Single Sheet)
 * @route GET /api/head-ledger/dashboard/export-complete
 */
export const exportDashboardAndLedgerExcel = async (req, res) => {
  try {

    // ================= DASHBOARD DATA =================
    const dashboardData = await sequelize.query(`
      SELECT 
        COALESCE(SUM(total_amount),0) AS total_sales,
        COALESCE(SUM(received_amount),0) AS received,
        COALESCE(SUM(pending_amount),0) AS pending
      FROM invoices
    `, { type: QueryTypes.SELECT });

    const dashboard = dashboardData[0];

    // ================= LEDGER DATA =================
    const ledger = await sequelize.query(`
      SELECT 
        st.store_code,
        st.store_name,
        st.organization_level,

        COUNT(DISTINCT inv.id) AS total_deals,
        COALESCE(SUM(inv.total_amount), 0) AS total_amount,
        COALESCE(SUM(inv.received_amount), 0) AS received_amount,
        COALESCE(SUM(inv.pending_amount), 0) AS pending_amount

      FROM stores st
      LEFT JOIN invoices inv 
        ON st.store_code = inv.store_code

     
      WHERE LOWER(st.organization_level::text) IN ('district', 'retail')

      GROUP BY st.id
      ORDER BY st.organization_level DESC, st.store_name
    `, { type: QueryTypes.SELECT });

    // ================= EXCEL =================
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dashboard Report");

    // -------- TITLE --------
    sheet.mergeCells("A1:G1");
    sheet.getCell("A1").value = "Dashboard & Ledger Report";
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    // -------- DASHBOARD SECTION --------
    sheet.addRow([]);
    sheet.addRow(["Dashboard Cards"]);
    sheet.getRow(3).font = { bold: true };

    const dashHeader = sheet.addRow(["Metric", "Value"]);
    dashHeader.font = { bold: true };

    sheet.addRow(["Total Sales", dashboard.total_sales]);
    sheet.addRow(["Total Revenue", dashboard.received]);
    sheet.addRow(["Total Profit", dashboard.received]);
    sheet.addRow(["Loss", dashboard.pending]);
    sheet.addRow(["Collectable Amount", dashboard.pending]);

    // -------- GAP --------
    sheet.addRow([]);
    sheet.addRow([]);

    // -------- LEDGER SECTION --------
    sheet.addRow(["All Stores Ledger"]);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };

    const ledgerHeader = sheet.addRow([
      "Store Code",
      "Store Name",
      "Organization Level",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount"
    ]);

    ledgerHeader.font = { bold: true };

    // DATA
    ledger.forEach((l) => {
      sheet.addRow([
        l.store_code,
        l.store_name,
        l.organization_level,
        l.total_deals,
        l.total_amount,
        l.received_amount,
        l.pending_amount
      ]);
    });

    // -------- AUTO WIDTH --------
    sheet.columns.forEach(col => col.width = 22);

    // ================= RESPONSE =================
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=dashboard-ledger.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error("EXPORT ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};



export const downloadInvoicePdf = async (req, res) => {
  try {
    const invoice_id = Number(req.params.invoice_id);

    if (isNaN(invoice_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice id",
      });
    }

    const invoice = await Invoice.findByPk(invoice_id, {
      raw: true,
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const customer = invoice.customer_id
      ? await Customer.findOne({
          where: { id: invoice.customer_id },
          raw: true,
        })
      : null;

    const items = await sequelize.query(
      `
      SELECT *
      FROM invoice_items
      WHERE invoice_id = :invoice_id
      ORDER BY id ASC
      `,
      {
        replacements: { invoice_id },
        type: QueryTypes.SELECT,
      }
    );

    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
    });

    const fileName = `invoice-${invoice.invoice_number || invoice.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    doc.pipe(res);

    const logoPath = path.join(process.cwd(), "public", "logo.png");

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
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(size)
        .text(String(text ?? ""), x, y, {
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
      doc.fillColor(fill).roundedRect(x, y, w, h, radius).fill();

      doc
        .strokeColor(border)
        .lineWidth(1)
        .roundedRect(x, y, w, h, radius)
        .stroke();
    };

    doc.fillColor(COLORS.bg).rect(0, 0, 595, 842).fill();

    roundedBox(25, 25, 545, 150, COLORS.white, COLORS.border, 18);

    doc.fillColor(COLORS.accent).roundedRect(25, 25, 8, 150, 10).fill();

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 45, 48, {
        fit: [70, 70],
      });
    }

    drawText("TAX INVOICE", 0, 38, 30, COLORS.primary, true, "center", 595);

    doc
      .strokeColor(COLORS.accent)
      .lineWidth(2)
      .moveTo(255, 82)
      .lineTo(340, 82)
      .stroke();

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

    doc.fillColor("#D9C2A8").roundedRect(25, 192, 380, 6, 5).fill();

    doc
      .fillColor("#B08968")
      .polygon([405, 192], [570, 192], [545, 198], [385, 198])
      .fill();

    const infoCard = (x, y, w, h, title, value) => {
      roundedBox(x, y, w, h, COLORS.white, COLORS.border, 16);

      doc.fillColor(COLORS.accentLight).roundedRect(x, y, 8, h, 16).fill();

      drawText(title, x + 24, y + 15, 9, COLORS.secondary, true);
      drawText(value, x + 24, y + 38, 13, COLORS.primary, true, "left", w - 35);
    };

    const infoY = 225;

    infoCard(
      30,
      infoY,
      255,
      70,
      "Customer Name",
      customer?.name || customer?.customer_name || "-"
    );

    infoCard(
      310,
      infoY,
      255,
      70,
      "Invoice Number",
      invoice.invoice_number || invoice.id
    );

    infoCard(
      30,
      infoY + 85,
      255,
      70,
      "Customer ID",
      invoice.customer_id || "-"
    );

    infoCard(
      310,
      infoY + 85,
      255,
      70,
      "Invoice Date",
      new Date(invoice.invoice_date || invoice.createdAt || Date.now())
        .toLocaleDateString("en-IN")
    );

    infoCard(
      30,
      infoY + 170,
      255,
      70,
      "Store Code",
      invoice.store_code || "-"
    );

    infoCard(
      310,
      infoY + 170,
      255,
      70,
      "Status",
      invoice.status || "-"
    );

    let y = 500;

    const columns = [
      { title: "S.No", x: 30, width: 50 },
      { title: "Product", x: 80, width: 145 },
      { title: "Qty", x: 225, width: 55 },
      { title: "Rate", x: 280, width: 75 },
      { title: "Making", x: 355, width: 75 },
      { title: "GST", x: 430, width: 60 },
      { title: "Amount", x: 490, width: 75 },
    ];

    columns.forEach((col) => {
      doc.fillColor(COLORS.tableHead).rect(col.x, y, col.width, 42).fill();

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

    let totalQty = 0;
    let totalAmount = 0;

    items.forEach((item, index) => {
      const bg = index % 2 === 0 ? "#FFFFFF" : "#FAF7F4";

      const qty = Number(item.quantity || 0);
      const rate = Number(item.rate || item.sale_rate || 0);
      const making = Number(item.making_charge || item.making_charge_value || 0);
      const gst = Number(item.gst_amount || 0);
      const amount = Number(item.total_amount || 0);

      totalQty += qty;
      totalAmount += amount;

      const row = [
        index + 1,
        item.product_name || item.description || item.item_name || "-",
        qty,
        rate.toFixed(2),
        making.toFixed(2),
        gst.toFixed(2),
        amount.toFixed(2),
      ];

      columns.forEach((col, i) => {
        doc.fillColor(bg).rect(col.x, y, col.width, 44).fill();

        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .rect(col.x, y, col.width, 44)
          .stroke();

        drawText(
          row[i],
          col.x,
          y + 15,
          9,
          COLORS.primary,
          i === 1,
          "center",
          col.width
        );
      });

      y += 44;
    });

    doc.fillColor(COLORS.accentLight).roundedRect(30, y, 535, 50, 12).fill();

    drawText("TOTAL", 50, y + 17, 12, COLORS.secondary, true);
    drawText(String(totalQty), 235, y + 17, 11, COLORS.primary, true);
    drawText(totalAmount.toFixed(2), 500, y + 17, 11, COLORS.primary, true);

    const summaryX = 330;
    const summaryY = y + 80;

    roundedBox(summaryX, summaryY, 235, 165, COLORS.white, COLORS.border, 16);

    const summaryRows = [
      ["Total Amount", Number(invoice.total_amount || totalAmount).toFixed(2)],
      ["Received Amount", Number(invoice.received_amount || 0).toFixed(2)],
      ["Pending Amount", Number(invoice.pending_amount || 0).toFixed(2)],
      ["Grand Total", Number(invoice.total_amount || totalAmount).toFixed(2)],
    ];

    summaryRows.forEach(([label, value], index) => {
      const rowY = summaryY + index * 41;

      const fill = label === "Grand Total" ? COLORS.accentLight : COLORS.white;

      doc.fillColor(fill).rect(summaryX, rowY, 235, 41).fill();

      doc
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .rect(summaryX, rowY, 235, 41)
        .stroke();

      drawText(label, summaryX + 18, rowY + 14, 11, COLORS.primary, true);

      drawText(value, summaryX + 135, rowY + 14, 11, COLORS.primary, true);
    });

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

    doc.end();
  } catch (error) {
    console.error("Download Invoice PDF Error:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to download invoice PDF",
        error: error.message,
      });
    }

    return res.end();
  }
};
