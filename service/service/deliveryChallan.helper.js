import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const cleanText = (value) => {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
};

const formatMoney = (value) => {
  const n = Number(value || 0);
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatDateIN = (value) => {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleDateString("en-IN");
  } catch {
    return "-";
  }
};

const drawCell = (doc, text, x, y, w, h, options = {}) => {
  doc.rect(x, y, w, h).stroke();

  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica");
  doc.fontSize(options.fontSize || 7);

  doc.text(String(text ?? ""), x + 3, y + 4, {
    width: w - 6,
    height: h - 8,
    align: options.align || "left",
    lineGap: options.lineGap || 0,
    ellipsis: options.ellipsis ?? false,
  });
};

const getTextHeight = (doc, text, width, fontSize = 7, bold = false) => {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  doc.fontSize(fontSize);

  return doc.heightOfString(String(text ?? ""), {
    width: width - 6,
    lineGap: 0,
  });
};

const ensurePageSpace = (doc, y, neededHeight, resetY = 24) => {
  const bottomLimit = doc.page.height - 28;

  if (y + neededHeight > bottomLimit) {
    doc.addPage();
    return resetY;
  }

  return y;
};

export const generateDeliveryChallanPdf = async ({
  transfer,
  request,
  fromStore,
  toStore,
  challanItems,
  driver,
}) => {
  const uploadDir = path.join(process.cwd(), "uploads", "delivery-challans");
  ensureDir(uploadDir);

  const fileName = `delivery-challan-${transfer.transfer_no}.pdf`;
  const filePath = path.join(uploadDir, fileName);
  const publicPath = `/uploads/delivery-challans/${fileName}`;

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 18,
    bufferPages: true,
  });

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const left = 18;
  const pageWidth = doc.page.width;
  const right = pageWidth - 18;
  const usableWidth = right - left;
  const half = usableWidth / 2;

  let y = 15;

  doc.lineWidth(0.7);

  // Header
  doc.rect(left, y, usableWidth, 18).stroke();
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Delivery Challan", left, y + 4, {
    width: usableWidth,
    align: "center",
  });

  doc.font("Helvetica").fontSize(7);
  doc.text("Original Copy", left, y + 5, {
    width: usableWidth - 8,
    align: "right",
  });

  y += 22;

  // Company
  doc.rect(left, y, usableWidth, 42).stroke();
  doc.font("Helvetica-Bold").fontSize(18);
  doc.text("VIBHUSHNAM PRIVATE LIMITED", left, y + 9, {
    width: usableWidth,
    align: "center",
  });

  doc.font("Helvetica").fontSize(7);
  doc.text(
    "H. No. 999 / C/o Ranvir, Bhim Kheri, Near Railway Station, Gurgaon, Sadar Bazar, Haryana, India",
    left,
    y + 31,
    {
      width: usableWidth,
      align: "center",
    }
  );

  y += 48;

  // Info rows
  drawCell(doc, "Billing From", left, y, 90, 24, { bold: true });
  drawCell(
    doc,
    `${fromStore?.store_name || "N/A"}\n${fromStore?.address || ""}`,
    left + 90,
    y,
    half - 90,
    24
  );

  drawCell(doc, "CIN No", left + half, y, 95, 12, { bold: true });
  drawCell(doc, "U51909DL2017PTC22836", left + half + 95, y, half - 95, 12);

  drawCell(doc, "Email", left + half, y + 12, 95, 12, { bold: true });
  drawCell(
    doc,
    "contact@vibhushnam.com",
    left + half + 95,
    y + 12,
    half - 95,
    12
  );

  y += 24;

  drawCell(doc, "Customer Name", left, y, 90, 18, { bold: true });
  drawCell(doc, toStore?.store_name || "N/A", left + 90, y, half - 90, 18);

  drawCell(doc, "Delivery Challan No", left + half, y, 95, 18, {
    bold: true,
  });
  drawCell(doc, transfer.transfer_no, left + half + 95, y, half - 95, 18);

  y += 18;

  drawCell(doc, "Billing To", left, y, 90, 38, { bold: true });
  drawCell(
    doc,
    `${toStore?.store_name || "N/A"}\nAddress: ${
      toStore?.address || driver?.delivery_address || ""
    }\nMobile No: ${toStore?.phone_number || ""}`,
    left + 90,
    y,
    half - 90,
    38
  );

  drawCell(doc, "Delivery Challan Date", left + half, y, 95, 19, {
    bold: true,
  });
  drawCell(
    doc,
    formatDateIN(transfer.dispatch_date || new Date()),
    left + half + 95,
    y,
    half - 95,
    19
  );

  drawCell(doc, "Request No", left + half, y + 19, 95, 19, { bold: true });
  drawCell(
    doc,
    request?.request_no || "-",
    left + half + 95,
    y + 19,
    half - 95,
    19
  );

  y += 38;

  drawCell(doc, "Delivery / Shipping To", left, y, 90, 38, { bold: true });
  drawCell(
    doc,
    `${toStore?.store_name || "N/A"}\nAddress: ${
      driver?.delivery_address || toStore?.address || ""
    }`,
    left + 90,
    y,
    half - 90,
    38
  );

  drawCell(doc, "Transporter Name", left + half, y, 95, 13, { bold: true });
  drawCell(
    doc,
    cleanText(driver?.driver_name) || "-",
    left + half + 95,
    y,
    half - 95,
    13
  );

  drawCell(doc, "Driver Phone", left + half, y + 13, 95, 13, { bold: true });
  drawCell(
    doc,
    cleanText(driver?.driver_phone) || "-",
    left + half + 95,
    y + 13,
    half - 95,
    13
  );

  drawCell(doc, "Vehicle No", left + half, y + 26, 95, 12, { bold: true });
  drawCell(
    doc,
    cleanText(driver?.vehicle_number) || "-",
    left + half + 95,
    y + 26,
    half - 95,
    12
  );

  y += 45;

  // Landscape table widths. Total = 806, fits A4 landscape usable width.
  const cols = [
    { key: "sno", label: "S.No", w: 30, align: "center" },
    { key: "item_name", label: "Material Description", w: 145, align: "left" },
    { key: "product_code", label: "Product Code", w: 115, align: "left" },
    { key: "qty", label: "Qty", w: 36, align: "center" },
    { key: "hsn_code", label: "HSN Code", w: 70, align: "center" },
    { key: "purity", label: "Purity/Karat", w: 72, align: "center" },
    { key: "weight", label: "Net Weight (g)", w: 76, align: "right" },
    { key: "rate", label: "Rate/Gram", w: 68, align: "right" },
    { key: "making", label: "Making Charges", w: 78, align: "right" },
    { key: "huid", label: "HUID Code", w: 58, align: "center" },
    { key: "base", label: "Base Value", w: 58, align: "right" },
  ];

  // Table header
  y = ensurePageSpace(doc, y, 26);

  let x = left;

  cols.forEach((c) => {
    drawCell(doc, c.label, x, y, c.w, 24, {
      bold: true,
      align: "center",
      fontSize: 6.2,
    });
    x += c.w;
  });

  y += 24;

  let totalQty = 0;
  let totalWeight = 0;
  let totalBaseValue = 0;

  challanItems.forEach((item, index) => {
    const qty = Number(item.qty || 0);
    const weight = Number(item.weight || 0);
    const rate = Number(item.rate || 0);
    const making = Number(item.making_charge || 0);
    const baseValue = Number(item.base_value || 0);

    totalQty += qty;
    totalWeight += weight;
    totalBaseValue += baseValue;

    const rowValues = [
      index + 1,
      item.item_name || "-",
      item.product_code || "-",
      qty,
      item.hsn_code || "-",
      item.purity || "-",
      weight.toFixed(3),
      formatMoney(rate),
      formatMoney(making),
      item.huid_code || "-",
      formatMoney(baseValue),
    ];

    let rowHeight = 22;

    rowValues.forEach((value, colIndex) => {
      const h = getTextHeight(
        doc,
        value,
        cols[colIndex].w,
        colIndex === 1 || colIndex === 2 ? 6.5 : 6.2
      );

      rowHeight = Math.max(rowHeight, h + 10);
    });

    rowHeight = Math.min(Math.max(rowHeight, 22), 42);
    y = ensurePageSpace(doc, y, rowHeight + 10);

    x = left;

    rowValues.forEach((value, colIndex) => {
      drawCell(doc, value, x, y, cols[colIndex].w, rowHeight, {
        fontSize: colIndex === 1 || colIndex === 2 ? 6.5 : 6.2,
        align: cols[colIndex].align,
      });

      x += cols[colIndex].w;
    });

    y += rowHeight;
  });

  // Total row
  y = ensurePageSpace(doc, y, 24);

  x = left;

  drawCell(doc, "Total", x, y, cols[0].w + cols[1].w + cols[2].w, 22, {
    bold: true,
    align: "right",
  });

  x += cols[0].w + cols[1].w + cols[2].w;

  drawCell(doc, totalQty, x, y, cols[3].w, 22, {
    bold: true,
    align: "center",
  });

  x += cols[3].w;

  drawCell(doc, "", x, y, cols[4].w + cols[5].w, 22);
  x += cols[4].w + cols[5].w;

  drawCell(doc, totalWeight.toFixed(3), x, y, cols[6].w, 22, {
    bold: true,
    align: "right",
  });

  x += cols[6].w;

  drawCell(doc, "", x, y, cols[7].w + cols[8].w + cols[9].w, 22);
  x += cols[7].w + cols[8].w + cols[9].w;

  drawCell(doc, formatMoney(totalBaseValue), x, y, cols[10].w, 22, {
    bold: true,
    align: "right",
  });

  y += 28;

  const taxableValue = totalBaseValue;
  const gstValue = taxableValue * 0.03;
  const freightValue = 0;
  const roundOff = 0;
  const totalValue = taxableValue + gstValue + freightValue + roundOff;

  y = ensurePageSpace(doc, y, 112);

  // Summary section: use Rs. instead of rupee symbol to avoid PDFKit glyph issue.
  drawCell(doc, "Remarks", left, y, usableWidth - 230, 20, { bold: true });
  drawCell(doc, "Total Taxable Value", right - 230, y, 130, 20, {
    bold: true,
  });
  drawCell(doc, `Rs. ${formatMoney(taxableValue)}`, right - 100, y, 100, 20, {
    align: "right",
  });

  y += 20;

  drawCell(doc, "Total value in words", left, y, usableWidth - 230, 20, {
    bold: true,
  });
  drawCell(doc, "3% GST Value", right - 230, y, 130, 20, { bold: true });
  drawCell(doc, `Rs. ${formatMoney(gstValue)}`, right - 100, y, 100, 20, {
    align: "right",
  });

  y += 20;

  drawCell(doc, "", left, y, usableWidth - 230, 20);
  drawCell(doc, "Freight Value", right - 230, y, 130, 20, { bold: true });
  drawCell(doc, `Rs. ${formatMoney(freightValue)}`, right - 100, y, 100, 20, {
    align: "right",
  });

  y += 20;

  drawCell(doc, "", left, y, usableWidth - 230, 20);
  drawCell(doc, "Round Off", right - 230, y, 130, 20, { bold: true });
  drawCell(doc, `Rs. ${formatMoney(roundOff)}`, right - 100, y, 100, 20, {
    align: "right",
  });

  y += 20;

  drawCell(doc, "", left, y, usableWidth - 230, 20);
  drawCell(doc, "Total Value", right - 230, y, 130, 20, { bold: true });
  drawCell(doc, `Rs. ${formatMoney(totalValue)}`, right - 100, y, 100, 20, {
    bold: true,
    align: "right",
  });

  y += 28;

  y = ensurePageSpace(doc, y, 130);

  // Declaration
  doc.rect(left, y, usableWidth, 52).stroke();

  doc.font("Helvetica-Bold").fontSize(7);
  doc.text("Declaration", left, y + 5, {
    width: usableWidth,
    align: "center",
  });

  doc.font("Helvetica").fontSize(6.5);
  doc.text(
    [
      "1. This is computer Generated Document No need to Signature.",
      "2. Any dispute shall be settled subject to Jurisdiction only.",
      "3. The ownership consignment shall not be transferred till receipt of the full payment.",
      "4. Warranty on burnt & Physical damage.",
      "5. All Return/Rejection/Discount if any pertaining to this invoice shall be accounted through debit/credit note.",
    ].join("\n"),
    left + 5,
    y + 17,
    {
      width: usableWidth - 10,
    }
  );

  y += 70;

  y = ensurePageSpace(doc, y, 60);

  doc.rect(left, y, usableWidth / 2, 50).stroke();
  doc.rect(left + usableWidth / 2, y, usableWidth / 2, 50).stroke();

  doc.font("Helvetica-Bold").fontSize(7);
  doc.text("E Invoice Details:-", left + 5, y + 5);
  doc.text(
    "For Vibhushnam Private Limited",
    left + usableWidth / 2 + 5,
    y + 5
  );

  doc.text("Authorised Signatory", left + usableWidth / 2 + 5, y + 36, {
    width: usableWidth / 2 - 10,
    align: "center",
  });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return {
    fileName,
    filePath,
    publicPath,
  };
};