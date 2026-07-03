import { Op } from "sequelize";
import sequelize from "../config/db.js";

import Item from "../model/item.js";
import Stock from "../model/stockrecord.js";
import Store from "../model/Store.js";

import InventoryAudit from "../model/inventoryAudit.js";
import InventoryAuditItem from "../model/inventoryAuditItem.js";

const safeNum = (val, def = 0) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
};

const hasAttr = (model, attr) => !!model?.rawAttributes?.[attr];

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const generateAuditNo = (orgId) => {
  const now = new Date();
  return `AUD-${orgId}-${now.getTime()}`;
};

const normalizeLevel = (level) => String(level || "").toLowerCase();

const emitAuditEvent = (req, auditId, eventName, payload) => {
  const io = req.app.get("io");

  if (!io) return;

  io.to(`audit_${auditId}`).emit(eventName, payload);
};

const getUserScope = async (user) => {
  const level = normalizeLevel(user?.organization_level);
  const organizationId = safeNum(user?.organization_id, null);
  const storeCode = user?.store_code || user?.storeCode || null;

  if (!user?.id || !organizationId) {
    throw new Error("Unauthorized user");
  }

  if (level === "retail" || level === "store") {
    const store = await Store.findOne({
      where: {
        [Op.or]: [{ id: organizationId }, { store_code: storeCode }],
      },
      attributes: ["id", "store_code", "store_name", "district_id"],
    });

    if (!store) throw new Error("Store record not found");

    return {
      organization_id: safeNum(store.id),
      organization_level: "retail",
      store_id: safeNum(store.id),
      store_code: store.store_code || storeCode,
      store_name: store.store_name || null,
      district_id: safeNum(store.district_id, null),
      visible_to_organization_id: safeNum(store.district_id, null),
      parent_organization_id: safeNum(store.district_id, null),
    };
  }

  if (level === "district") {
    return {
      organization_id: organizationId,
      organization_level: "district",
      store_id: null,
      store_code: storeCode,
      store_name: null,
      district_id: organizationId,
      visible_to_organization_id: organizationId,
      parent_organization_id: null,
    };
  }

  throw new Error("Only retail or district user can do audit");
};

const getOrCreateTodayAudit = async ({ user, scope, auditDate, transaction }) => {
  let audit = await InventoryAudit.findOne({
    where: {
      organization_id: scope.organization_id,
      audit_date: auditDate,
      audit_type: "daily",
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (audit) return audit;

  const itemWhere = {
    organization_id: scope.organization_id,
    is_active: true,
  };

  if (
    scope.organization_level === "retail" &&
    scope.store_code &&
    hasAttr(Item, "storeCode")
  ) {
    itemWhere.storeCode = scope.store_code;
  }

  const totalItems = await Item.count({
    where: itemWhere,
    transaction,
  });

  audit = await InventoryAudit.create(
    {
      audit_no: generateAuditNo(scope.organization_id),
      organization_id: scope.organization_id,
      organization_level: scope.organization_level,
      audit_scope: "self",
      audit_date: auditDate,
      audit_type: "daily",

      parent_organization_id: scope.parent_organization_id,
      visible_to_organization_id:
        scope.visible_to_organization_id || scope.organization_id,

      store_id: scope.store_id,
      store_code: scope.store_code,
      store_name: scope.store_name,
      district_id: scope.district_id,

      total_items: totalItems,
      checked_items: 0,
      present_items: 0,
      missing_items: 0,
      pending_items: totalItems,

      status: "draft",
      verification_status: "draft",
      created_by: user.id,
    },
    { transaction }
  );

  return audit;
};

const recalculateAuditSummary = async ({ audit, transaction }) => {
  const rows = await InventoryAuditItem.findAll({
    where: { audit_id: audit.id },
    transaction,
  });

  const scannedItems = rows.filter((x) => x.audit_result === "present").length;
  const notDoneItems = rows.filter(
    (x) => x.audit_result === "not_audited"
  ).length;

  const completedItems = scannedItems + notDoneItems;
  const pendingItems = Math.max(safeNum(audit.total_items) - completedItems, 0);

  await audit.update(
    {
      checked_items: scannedItems,
      present_items: scannedItems,
      missing_items: notDoneItems,
      pending_items: pendingItems,
    },
    { transaction }
  );

  return {
    total_items: safeNum(audit.total_items),
    scanned_items: scannedItems,
    not_done_items: notDoneItems,
    pending_items: pendingItems,
  };
};

export const auditController = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const user = req.user;

    const {
      action,
      qr_code,
      item_id,
      reason,
      audit_id,
      audit_date,
      remark,
    } = req.body;

    if (!action) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Action is required",
      });
    }

    const scope = await getUserScope(user);
    const finalAuditDate = audit_date || getTodayDate();

    const audit = await getOrCreateTodayAudit({
      user,
      scope,
      auditDate: finalAuditDate,
      transaction: t,
    });

    if (
      ["submitted", "verified", "closed"].includes(audit.status) &&
      !["today", "details"].includes(action)
    ) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Audit already submitted/locked",
      });
    }

    // =====================================================
    // START
    // =====================================================
    if (action === "start") {
      const summary = await recalculateAuditSummary({
        audit,
        transaction: t,
      });

      await t.commit();

      emitAuditEvent(req, audit.id, "audit:started", {
        audit_id: audit.id,
        audit_no: audit.audit_no,
        status: audit.status,
        verification_status: audit.verification_status,
        summary,
      });

      return res.status(200).json({
        success: true,
        message: "Audit started successfully",
        data: {
          audit_id: audit.id,
          audit_no: audit.audit_no,
          status: audit.status,
          verification_status: audit.verification_status,
          summary,
        },
      });
    }

    // =====================================================
    // SCAN QR
    // =====================================================
    if (action === "scan") {
      if (!qr_code) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "QR code is required",
        });
      }

      const itemWhere = {
        organization_id: scope.organization_id,
        is_active: true,
        [Op.or]: [{ sku_code: qr_code }, { article_code: qr_code }],
      };

      if (hasAttr(Item, "qr_code_value")) {
        itemWhere[Op.or].push({ qr_code_value: qr_code });
      }

      if (
        scope.organization_level === "retail" &&
        scope.store_code &&
        hasAttr(Item, "storeCode")
      ) {
        itemWhere.storeCode = scope.store_code;
      }

      const item = await Item.findOne({
        where: itemWhere,
        include: [
          {
            model: Stock,
            as: "stocks",
            required: false,
            where: { organization_id: scope.organization_id },
            attributes: ["id", "available_qty", "available_weight"],
          },
        ],
        transaction: t,
      });

      if (!item) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: "Item not found for this QR code",
        });
      }

      const stock = Array.isArray(item.stocks) ? item.stocks[0] : null;

      const systemQty = safeNum(stock?.available_qty);
      const systemWeight = safeNum(stock?.available_weight);

      const payload = {
        audit_id: audit.id,
        item_id: item.id,

        article_code: item.article_code,
        sku_code: item.sku_code,
        item_name: item.item_name,
        metal_type: item.metal_type,
        category: item.category,
        purity: item.purity,

        system_qty: systemQty,
        system_weight: systemWeight,
        physical_qty: systemQty,
        physical_weight: systemWeight,

        audit_result: "present",
        is_checked: true,
        is_available: true,
        is_matched: true,
        is_missing: false,
        is_extra: false,

        variance_qty: 0,
        variance_weight: 0,

        missing_reason: null,
        checklist_note: "QR scanned successfully",
        escalation_status: "none",
      };

      const existing = await InventoryAuditItem.findOne({
        where: {
          audit_id: audit.id,
          item_id: item.id,
        },
        transaction: t,
      });

      let auditItem;

      if (existing) {
        await existing.update(payload, { transaction: t });
        auditItem = existing;
      } else {
        auditItem = await InventoryAuditItem.create(payload, {
          transaction: t,
        });
      }

      await Item.update(
        {
          isItemAudit: true,
          itemAuditAt: new Date(),
          lastAuditStatus: "audit_done",
          lastAuditReason: "QR scanned successfully",
        },
        {
          where: { id: item.id },
          transaction: t,
        }
      );

      const summary = await recalculateAuditSummary({
        audit,
        transaction: t,
      });

      await t.commit();

      const socketPayload = {
        audit_id: audit.id,
        audit_no: audit.audit_no,
        audit_item_id: auditItem.id,
        item_id: item.id,
        article_code: item.article_code,
        sku_code: item.sku_code,
        item_name: item.item_name,
        category: item.category,
        metal_type: item.metal_type,
        purity: item.purity,
        audit_result: "present",
        is_checked: true,
        reason: null,
        summary,
      };

      emitAuditEvent(req, audit.id, "audit:item_scanned", socketPayload);
      emitAuditEvent(req, audit.id, "audit:summary_updated", summary);

      return res.status(200).json({
        success: true,
        message: "Item audited successfully",
        data: socketPayload,
      });
    }

    // =====================================================
    // NOT DONE
    // =====================================================
    if (action === "not_done") {
      if (!item_id) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Item id is required",
        });
      }

      if (!reason) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Reason is required",
        });
      }

      const itemWhere = {
        id: item_id,
        organization_id: scope.organization_id,
        is_active: true,
      };

      if (
        scope.organization_level === "retail" &&
        scope.store_code &&
        hasAttr(Item, "storeCode")
      ) {
        itemWhere.storeCode = scope.store_code;
      }

      const item = await Item.findOne({
        where: itemWhere,
        include: [
          {
            model: Stock,
            as: "stocks",
            required: false,
            where: { organization_id: scope.organization_id },
            attributes: ["id", "available_qty", "available_weight"],
          },
        ],
        transaction: t,
      });

      if (!item) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: "Item not found",
        });
      }

      const stock = Array.isArray(item.stocks) ? item.stocks[0] : null;

      const systemQty = safeNum(stock?.available_qty);
      const systemWeight = safeNum(stock?.available_weight);

      const payload = {
        audit_id: audit.id,
        item_id: item.id,

        article_code: item.article_code,
        sku_code: item.sku_code,
        item_name: item.item_name,
        metal_type: item.metal_type,
        category: item.category,
        purity: item.purity,

        system_qty: systemQty,
        system_weight: systemWeight,
        physical_qty: 0,
        physical_weight: 0,

        audit_result: "not_audited",
        is_checked: false,
        is_available: false,
        is_matched: false,
        is_missing: true,
        is_extra: false,

        variance_qty: Number((0 - systemQty).toFixed(3)),
        variance_weight: Number((0 - systemWeight).toFixed(3)),

        missing_reason: reason,
        checklist_note: reason,
        reason_submitted_at: new Date(),
        reason_submitted_by: user.id,
        escalation_status: "audit_pending",
      };

      const existing = await InventoryAuditItem.findOne({
        where: {
          audit_id: audit.id,
          item_id: item.id,
        },
        transaction: t,
      });

      let auditItem;

      if (existing) {
        await existing.update(payload, { transaction: t });
        auditItem = existing;
      } else {
        auditItem = await InventoryAuditItem.create(payload, {
          transaction: t,
        });
      }

      await Item.update(
        {
          isItemAudit: false,
          itemAuditAt: new Date(),
          lastAuditStatus: "not_audited",
          lastAuditReason: reason,
        },
        {
          where: { id: item.id },
          transaction: t,
        }
      );

      const summary = await recalculateAuditSummary({
        audit,
        transaction: t,
      });

      await t.commit();

      const socketPayload = {
        audit_id: audit.id,
        audit_no: audit.audit_no,
        audit_item_id: auditItem.id,
        item_id: item.id,
        article_code: item.article_code,
        sku_code: item.sku_code,
        item_name: item.item_name,
        category: item.category,
        metal_type: item.metal_type,
        purity: item.purity,
        audit_result: "not_audited",
        is_checked: false,
        reason,
        summary,
      };

      emitAuditEvent(req, audit.id, "audit:item_not_done", socketPayload);
      emitAuditEvent(req, audit.id, "audit:summary_updated", summary);

      return res.status(200).json({
        success: true,
        message: "Item marked as not done",
        data: socketPayload,
      });
    }

    // =====================================================
    // SUBMIT
    // =====================================================
    if (action === "submit") {
      const itemWhere = {
        organization_id: scope.organization_id,
        is_active: true,
      };

      if (
        scope.organization_level === "retail" &&
        scope.store_code &&
        hasAttr(Item, "storeCode")
      ) {
        itemWhere.storeCode = scope.store_code;
      }

      const allItems = await Item.findAll({
        where: itemWhere,
        attributes: ["id", "article_code", "sku_code", "item_name", "category"],
        transaction: t,
      });

      const auditItems = await InventoryAuditItem.findAll({
        where: { audit_id: audit.id },
        transaction: t,
      });

      const auditMap = new Map(
        auditItems.map((row) => [Number(row.item_id), row])
      );

      const pendingItems = [];

      for (const item of allItems) {
        const auditItem = auditMap.get(Number(item.id));

        if (!auditItem) {
          pendingItems.push({
            item_id: item.id,
            article_code: item.article_code,
            sku_code: item.sku_code,
            item_name: item.item_name,
            category: item.category,
            message: "Item not scanned or not marked as not done",
          });
          continue;
        }

        if (
          auditItem.audit_result === "not_audited" &&
          !auditItem.missing_reason
        ) {
          pendingItems.push({
            item_id: item.id,
            article_code: item.article_code,
            sku_code: item.sku_code,
            item_name: item.item_name,
            category: item.category,
            message: "Reason required for not done item",
          });
        }
      }

      if (pendingItems.length) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Audit cannot be submitted. Some items are pending or reason missing.",
          count: pendingItems.length,
          data: pendingItems,
        });
      }

      const summary = await recalculateAuditSummary({
        audit,
        transaction: t,
      });

      await audit.update(
        {
          status: "submitted",
          verification_status: "pending",
          submitted_at: new Date(),
          remark: remark || audit.remark || null,
        },
        { transaction: t }
      );

      await t.commit();

      const socketPayload = {
        audit_id: audit.id,
        audit_no: audit.audit_no,
        status: "submitted",
        verification_status: "pending",
        summary,
      };

      emitAuditEvent(req, audit.id, "audit:submitted", socketPayload);

      return res.status(200).json({
        success: true,
        message: "Audit submitted successfully",
        data: socketPayload,
      });
    }

    // =====================================================
    // TODAY
    // =====================================================
    if (action === "today") {
      const itemWhere = {
        organization_id: scope.organization_id,
        is_active: true,
      };

      if (
        scope.organization_level === "retail" &&
        scope.store_code &&
        hasAttr(Item, "storeCode")
      ) {
        itemWhere.storeCode = scope.store_code;
      }

      const items = await Item.findAll({
        where: itemWhere,
        include: [
          {
            model: Stock,
            as: "stocks",
            required: false,
            where: { organization_id: scope.organization_id },
            attributes: ["available_qty", "available_weight"],
          },
        ],
        order: [["id", "DESC"]],
        transaction: t,
      });

      const auditItems = await InventoryAuditItem.findAll({
        where: { audit_id: audit.id },
        transaction: t,
      });

      const auditMap = new Map(
        auditItems.map((row) => [Number(row.item_id), row])
      );

      const data = items.map((item, index) => {
        const stock = Array.isArray(item.stocks) ? item.stocks[0] : null;
        const auditItem = auditMap.get(Number(item.id));

        return {
          idx: index + 1,
          item_id: item.id,
          article_code: item.article_code,
          sku_code: item.sku_code,
          item_name: item.item_name,
          category: item.category,
          metal_type: item.metal_type,
          purity: item.purity,

          system_qty: safeNum(stock?.available_qty),
          system_weight: safeNum(stock?.available_weight),

          audit_item_id: auditItem?.id || null,
          audit_result: auditItem?.audit_result || "pending",
          is_checked: auditItem?.is_checked || false,
          reason: auditItem?.missing_reason || null,
        };
      });

      await t.commit();

      return res.status(200).json({
        success: true,
        message: "Today audit fetched successfully",
        audit_id: audit.id,
        audit_no: audit.audit_no,
        status: audit.status,
        verification_status: audit.verification_status,
        summary: {
          total_items: data.length,
          scanned_items: data.filter((x) => x.audit_result === "present")
            .length,
          not_done_items: data.filter((x) => x.audit_result === "not_audited")
            .length,
          pending_items: data.filter((x) => x.audit_result === "pending")
            .length,
        },
        data,
      });
    }

    // =====================================================
    // DETAILS
    // =====================================================
    if (action === "details") {
      const finalAuditId = audit_id || audit.id;

      const details = await InventoryAudit.findOne({
        where: {
          id: finalAuditId,
          organization_id: scope.organization_id,
        },
        include: [
          {
            model: InventoryAuditItem,
            as: "audit_items",
            required: false,
          },
        ],
        transaction: t,
      });

      if (!details) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: "Audit not found",
        });
      }

      await t.commit();

      return res.status(200).json({
        success: true,
        message: "Audit details fetched successfully",
        data: details,
      });
    }

    await t.rollback();

    return res.status(400).json({
      success: false,
      message: "Invalid audit action",
    });
  } catch (error) {
    await t.rollback();

    console.error("auditController error:", error);

    return res.status(500).json({
      success: false,
      message: "Audit operation failed",
      error: error.message,
    });
  }
};