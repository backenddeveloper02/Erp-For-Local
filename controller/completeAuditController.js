import { Op } from "sequelize";
import fs from "fs";
import path from "path";
import os from "os";
import ExcelJS from "exceljs";
import InventoryAudit from "../model/inventoryAudit.js";
import InventoryAuditItem from "../model/inventoryAuditItem.js";
import Store from "../model/Store.js";
const safeNum = (val, def = 0) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
};

const normalizeLevel = (level) => String(level || "").toLowerCase();

const getUserScope = async (user) => {
  const organizationId = safeNum(user?.organization_id, null);
  const level = normalizeLevel(user?.organization_level);

  if (!user?.id) {
    throw new Error("Unauthorized user");
  }

  if (level === "district") {
    return {
      organization_id: organizationId,
      organization_level: "district",
    };
  }

  if (level === "retail" || level === "store") {
    return {
      organization_id: organizationId,
      organization_level: "retail",
    };
  }

  return {
    organization_id: organizationId,
    organization_level: level,
  };
};
export const getDistrictRetailAudits = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (scope.organization_level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district user can view retail audits",
      });
    }

    const { date_from, date_to, status, store_id } = req.query;

    const whereClause = {
      organization_level: "retail",
      visible_to_organization_id: scope.organization_id,
    };

    if (status) whereClause.status = status;
    if (store_id) whereClause.store_id = store_id;

    if (date_from || date_to) {
      whereClause.audit_date = {};
      if (date_from) whereClause.audit_date[Op.gte] = date_from;
      if (date_to) whereClause.audit_date[Op.lte] = date_to;
    }

    const audits = await InventoryAudit.findAll({
      where: whereClause,
      order: [["audit_date", "DESC"], ["id", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      message: "Retail audits fetched successfully",
      count: audits.length,
      data: audits,
    });
  } catch (error) {
    console.error("getDistrictRetailAudits error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch retail audits",
      error: error.message,
    });
  }
};
export const getDistrictRetailAuditDetails = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (scope.organization_level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district user can view retail audit details",
      });
    }

    const { id } = req.params;

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "retail",
        visible_to_organization_id: scope.organization_id,
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "Audit not found under your district",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Retail audit details fetched successfully",
      data: {
        ...audit.toJSON(),
        audit_items: auditItems,
      },
    });
  } catch (error) {
    console.error("getDistrictRetailAuditDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch audit details",
      error: error.message,
    });
  }
};
export const downloadDistrictRetailAudit = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (scope.organization_level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district user can download retail audits",
      });
    }

    const { id } = req.params;

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "retail",
        visible_to_organization_id: scope.organization_id,
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "Audit not found under your district",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Audit Report");

    worksheet.columns = [
      { header: "Audit No", key: "audit_no", width: 28 },
      { header: "Audit Date", key: "audit_date", width: 15 },
      { header: "Store Code", key: "store_code", width: 15 },
      { header: "Store Name", key: "store_name", width: 30 },
      { header: "Item ID", key: "item_id", width: 12 },
      { header: "Article Code", key: "article_code", width: 22 },
      { header: "SKU Code", key: "sku_code", width: 22 },
      { header: "Item Name", key: "item_name", width: 30 },
      { header: "Category", key: "category", width: 18 },
      { header: "System Qty", key: "system_qty", width: 15 },
      { header: "Physical Qty", key: "physical_qty", width: 15 },
      { header: "System Weight", key: "system_weight", width: 18 },
      { header: "Physical Weight", key: "physical_weight", width: 18 },
      { header: "Audit Result", key: "audit_result", width: 16 },
      { header: "Missing Reason", key: "missing_reason", width: 30 },
      { header: "Note", key: "note", width: 30 },
    ];

    auditItems.forEach((item) => {
      worksheet.addRow({
        audit_no: audit.audit_no,
        audit_date: audit.audit_date,
        store_code: audit.store_code || "",
        store_name: audit.store_name || "",
        item_id: item.item_id || "",
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        item_name: item.item_name || "",
        category: item.category || "",
        system_qty: item.system_qty || 0,
        physical_qty: item.physical_qty || 0,
        system_weight: item.system_weight || 0,
        physical_weight: item.physical_weight || 0,
        audit_result: item.audit_result || "",
        missing_reason: item.missing_reason || "",
        note: item.checklist_note || "",
      });
    });

    worksheet.getRow(1).font = { bold: true };

    worksheet.getRow(1).eachCell((cell) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
    });

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    const fileName = `${audit.audit_no || "audit-report"}.xlsx`;

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
    console.error("downloadDistrictRetailAudit error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download audit",
      error: error.message,
    });
  }
};
export const getHeadDistrictAudits = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (
      scope.organization_level !== "head" &&
      scope.organization_level !== "head_office" &&
      req.user?.role !== "super_admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only head user can view district audits",
      });
    }

    const {
      district_id,
      district_store_code,
      status,
      date_from,
      date_to,
    } = req.query;

    const whereClause = {
      organization_level: "district",
    };

    if (district_id) {
      whereClause.organization_id = Number(district_id);
    }

    if (district_store_code) {
      whereClause.store_code = String(district_store_code).trim().toUpperCase();
    }

    if (status) {
      whereClause.status = status;
    }

    if (date_from || date_to) {
      whereClause.audit_date = {};

      if (date_from) {
        whereClause.audit_date[Op.gte] = date_from;
      }

      if (date_to) {
        whereClause.audit_date[Op.lte] = date_to;
      }
    }

    const audits = await InventoryAudit.findAll({
      where: whereClause,
      order: [
        ["audit_date", "DESC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message: district_id || district_store_code
        ? "Selected district audits fetched successfully"
        : "All district audits fetched successfully",
      count: audits.length,
      filters: {
        district_id: district_id || null,
        district_store_code: district_store_code || null,
        status: status || null,
        date_from: date_from || null,
        date_to: date_to || null,
      },
      data: audits,
    });
  } catch (error) {
    console.error("getHeadDistrictAudits error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch district audits",
      error: error.message,
    });
  }
};

export const getHeadDistrictAuditDetails = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (
      scope.organization_level !== "head" &&
      scope.organization_level !== "head_office" &&
      req.user?.role !== "super_admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only head user can view district audit details",
      });
    }

    const { id } = req.params;

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "district",
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "District audit not found",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message: "District audit details fetched successfully",
      data: {
        ...audit.toJSON(),
        audit_items: auditItems,
      },
    });
  } catch (error) {
    console.error("getHeadDistrictAuditDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district audit details",
      error: error.message,
    });
  }
};

export const downloadHeadDistrictAudit = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (
      scope.organization_level !== "head" &&
      scope.organization_level !== "head_office" &&
      req.user?.role !== "super_admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only head user can download district audits",
      });
    }

    const { id } = req.params;

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "district",
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "District audit not found",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("District Audit Report");

    worksheet.columns = [
      { header: "Audit No", key: "audit_no", width: 28 },
      { header: "Audit Date", key: "audit_date", width: 15 },
      { header: "District ID", key: "district_id", width: 15 },
      { header: "District Code", key: "district_code", width: 18 },
      { header: "District Name", key: "district_name", width: 30 },
      { header: "Item ID", key: "item_id", width: 12 },
      { header: "Article Code", key: "article_code", width: 22 },
      { header: "SKU Code", key: "sku_code", width: 22 },
      { header: "Item Name", key: "item_name", width: 30 },
      { header: "Category", key: "category", width: 18 },
      { header: "System Qty", key: "system_qty", width: 15 },
      { header: "Physical Qty", key: "physical_qty", width: 15 },
      { header: "System Weight", key: "system_weight", width: 18 },
      { header: "Physical Weight", key: "physical_weight", width: 18 },
      { header: "Audit Result", key: "audit_result", width: 16 },
      { header: "Missing Reason", key: "missing_reason", width: 30 },
      { header: "Note", key: "note", width: 30 },
    ];

    auditItems.forEach((item) => {
      worksheet.addRow({
        audit_no: audit.audit_no || "",
        audit_date: audit.audit_date
          ? new Date(audit.audit_date).toISOString().split("T")[0]
          : "",
        district_id: audit.organization_id || "",
        district_code: audit.district_code || audit.store_code || "",
        district_name: audit.district_name || audit.store_name || "",
        item_id: item.item_id || "",
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        item_name: item.item_name || "",
        category: item.category || "",
        system_qty: item.system_qty || 0,
        physical_qty: item.physical_qty || 0,
        system_weight: item.system_weight || 0,
        physical_weight: item.physical_weight || 0,
        audit_result: item.audit_result || "",
        missing_reason: item.missing_reason || "",
        note: item.checklist_note || "",
      });
    });

    worksheet.getRow(1).font = { bold: true };

    worksheet.getRow(1).eachCell((cell) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
    });

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    const safeAuditNo = String(audit.audit_no || "district-audit-report")
      .replace(/[^\w.-]/g, "_");

    const fileName = `${safeAuditNo}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    res.setHeader("Content-Length", buffer.length);

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("downloadHeadDistrictAudit error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download district audit",
      error: error.message,
    });
  }
};
/* ================= HELPERS ================= */

const isHeadUser = (user, scope) => {
  const role = String(user?.role || "").toLowerCase();

  const level = String(
    scope?.organization_level ||
      user?.organization_level ||
      ""
  ).toLowerCase();

  return (
    role === "super_admin" ||
    level === "head" ||
    level === "head_office"
  );
};

const getParamDistrictCode = (req) => {
  const fromParams =
    req.params.district_code ||
    req.params.districtCode ||
    req.params.store_code ||
    req.params.storeCode;

  if (fromParams) {
    return String(fromParams).trim().toUpperCase();
  }

  const parts = req.originalUrl.split("/");

  const districtIndex = parts.findIndex(
    (p) => p === "district"
  );

  if (districtIndex !== -1 && parts[districtIndex + 1]) {
    return String(parts[districtIndex + 1])
      .trim()
      .toUpperCase();
  }

  return "";
};

const getDistrictByCode = async (districtCode) => {
  const cleanCode = String(districtCode || "")
    .trim()
    .toUpperCase();

  console.log("DISTRICT CODE RECEIVED:", cleanCode);
  
  if (!cleanCode) return null;
  return await Store.findOne({
    where: {
      store_code: cleanCode,
      organization_level: "District",
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
};

/* =====================================================
   1) HEAD - DISTRICT KE SAARE RETAIL STORE AUDITS
===================================================== */

export const getHeadDistrictStoreAudits = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);
    console.log("REQ PARAMS:", req.params);
  console.log("REQ URL:", req.originalUrl);
    if (!isHeadUser(req.user, scope)) {
      return res.status(403).json({
        success: false,
        message: "Only head user can view district store audits",
      });
    }

    const district_code = getParamDistrictCode(req);

    const {
      date_from,
      date_to,
      status,
      store_id,
      store_code,
    } = req.query;

    const districtStore = await getDistrictByCode(district_code);

    if (!districtStore) {
      return res.status(404).json({
        success: false,
        message: "District not found with this store code",
      });
    }

    const whereClause = {
      organization_level: "retail",
      visible_to_organization_id: districtStore.id,
    };

    if (status && status !== "all") {
      whereClause.status = status;
    }

    if (store_id) {
      whereClause.store_id = store_id;
    }

    if (store_code) {
      whereClause.store_code = String(store_code)
        .trim()
        .toUpperCase();
    }

    if (date_from || date_to) {
      whereClause.audit_date = {};

      if (date_from) {
        whereClause.audit_date[Op.gte] = date_from;
      }

      if (date_to) {
        whereClause.audit_date[Op.lte] = date_to;
      }
    }

    const audits = await InventoryAudit.findAll({
      where: whereClause,
      order: [
        ["audit_date", "DESC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message: "District store audits fetched successfully",
      district: {
        id: districtStore.id,
        store_code: districtStore.store_code,
        store_name: districtStore.store_name,
      },
      count: audits.length,
      data: audits,
    });
  } catch (error) {
    console.error("getHeadDistrictStoreAudits error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch district store audits",
      error: error.message,
    });
  }
};

/* =====================================================
   2) HEAD - RETAIL AUDIT PREVIEW
===================================================== */

export const getHeadDistrictStoreAuditDetails = async (
  req,
  res
) => {
  try {
    const scope = await getUserScope(req.user);

    if (!isHeadUser(req.user, scope)) {
      return res.status(403).json({
        success: false,
        message: "Only head user can view retail audit details",
      });
    }

    const district_code = getParamDistrictCode(req);
    const { id } = req.params;

    const districtStore = await getDistrictByCode(district_code);

    if (!districtStore) {
      return res.status(404).json({
        success: false,
        message: "District not found with this store code",
      });
    }

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "retail",
        visible_to_organization_id: districtStore.id,
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "Retail audit not found under this district",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Retail audit details fetched successfully",
      district: {
        id: districtStore.id,
        store_code: districtStore.store_code,
        store_name: districtStore.store_name,
      },
      data: {
        ...audit.toJSON(),
        audit_items: auditItems,
      },
    });
  } catch (error) {
    console.error(
      "getHeadDistrictStoreAuditDetails error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch retail audit details",
      error: error.message,
    });
  }
};

/* =====================================================
   3) HEAD - RETAIL AUDIT DOWNLOAD
===================================================== */

export const downloadHeadDistrictStoreAudit = async (
  req,
  res
) => {
  try {
    const scope = await getUserScope(req.user);

    if (!isHeadUser(req.user, scope)) {
      return res.status(403).json({
        success: false,
        message: "Only head user can download retail audits",
      });
    }

    const district_code = getParamDistrictCode(req);
    const { id } = req.params;

    const districtStore = await getDistrictByCode(district_code);

    if (!districtStore) {
      return res.status(404).json({
        success: false,
        message: "District not found with this store code",
      });
    }

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "retail",
        visible_to_organization_id: districtStore.id,
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "Retail audit not found under this district",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      "Retail Audit Report"
    );

    worksheet.columns = [
      { header: "Audit No", key: "audit_no", width: 28 },
      { header: "Audit Date", key: "audit_date", width: 15 },
      {
        header: "District Code",
        key: "district_code",
        width: 18,
      },
      {
        header: "District Name",
        key: "district_name",
        width: 30,
      },
      { header: "Store Code", key: "store_code", width: 18 },
      { header: "Store Name", key: "store_name", width: 30 },
      { header: "Item ID", key: "item_id", width: 12 },
      {
        header: "Article Code",
        key: "article_code",
        width: 22,
      },
      { header: "SKU Code", key: "sku_code", width: 22 },
      { header: "Item Name", key: "item_name", width: 30 },
      { header: "Category", key: "category", width: 18 },
      { header: "System Qty", key: "system_qty", width: 15 },
      {
        header: "Physical Qty",
        key: "physical_qty",
        width: 15,
      },
      {
        header: "System Weight",
        key: "system_weight",
        width: 18,
      },
      {
        header: "Physical Weight",
        key: "physical_weight",
        width: 18,
      },
      {
        header: "Audit Result",
        key: "audit_result",
        width: 16,
      },
      {
        header: "Missing Reason",
        key: "missing_reason",
        width: 30,
      },
      { header: "Note", key: "note", width: 30 },
    ];

    auditItems.forEach((item) => {
      worksheet.addRow({
        audit_no: audit.audit_no,
        audit_date: audit.audit_date,

        district_code:
          audit.district_code ||
          districtStore.store_code ||
          "",

        district_name:
          audit.district_name ||
          districtStore.store_name ||
          "",

        store_code: audit.store_code || "",
        store_name: audit.store_name || "",

        item_id: item.item_id || "",
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        item_name: item.item_name || "",
        category: item.category || "",

        system_qty: item.system_qty || 0,
        physical_qty: item.physical_qty || 0,
        system_weight: item.system_weight || 0,
        physical_weight: item.physical_weight || 0,

        audit_result: item.audit_result || "",
        missing_reason: item.missing_reason || "",
        note: item.checklist_note || "",
      });
    });

    worksheet.getRow(1).font = {
      bold: true,
    };

    worksheet.getRow(1).eachCell((cell) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
    });

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    const fileName = `${
      audit.audit_no || "retail-audit-report"
    }.xlsx`;

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
    console.error(
      "downloadHeadDistrictStoreAudit error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to download retail audit",
      error: error.message,
    });
  }
};
export const getHeadRetailAudits = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

   if (
  scope.organization_level !== "head" &&
  scope.organization_level !== "head_office" &&
  scope.organization_level !== "district" &&
  req.user?.role !== "super_admin" &&
  req.user?.role !== "District-Manager" &&
  req.user?.role !== "District-Tl"
) {
  return res.status(403).json({
    success: false,
    message: "Only Head or District users can view retail audits",
  });
}


    const {
      retail_store_code,
      retail_id,
      status,
      date_from,
      date_to,
    } = req.query;

    const whereClause = {
      organization_level: "retail",
    };

    if (retail_id) {
      whereClause.organization_id = Number(retail_id);
    }

    if (retail_store_code) {
      whereClause.store_code = String(retail_store_code)
        .trim()
        .toUpperCase();
    }

    if (status) {
      whereClause.status = status;
    }

    if (date_from || date_to) {
      whereClause.audit_date = {};

      if (date_from) {
        whereClause.audit_date[Op.gte] = date_from;
      }

      if (date_to) {
        whereClause.audit_date[Op.lte] = date_to;
      }
    }

    const audits = await InventoryAudit.findAll({
      where: whereClause,
      order: [
        ["audit_date", "DESC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message:
        retail_store_code || retail_id
          ? "Selected retail audits fetched successfully"
          : "All retail audits fetched successfully",
      count: audits.length,
      filters: {
        retail_id: retail_id || null,
        retail_store_code: retail_store_code || null,
        status: status || null,
        date_from: date_from || null,
        date_to: date_to || null,
      },
      data: audits,
    });
  } catch (error) {
    console.error("getHeadRetailAudits error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch retail audits",
      error: error.message,
    });
  }
};
