import { Op } from "sequelize";
import sequelize from "../config/db.js";

import Item from "../model/item.js";
import Stock from "../model/stockrecord.js";
import Store from "../model/Store.js";

import InventoryAudit  from "../model/inventoryAudit.js";
import InventoryAuditItem from "../model/inventoryAuditItem.js";
import {
    createAuditSession,
    validateAuditSession,
    updateAuditHeartbeat,
    completeAuditSession,
} from "../service/auditSession.service.js";
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

  // =========================================
  // RETAIL USER
  // =========================================
  if (level === "retail" || level === "store") {
    const store = await Store.findOne({
      where: {
        [Op.or]: [
          { id: organizationId },
          { store_code: storeCode },
        ],
      },
      attributes: [
        "id",
        "store_code",
        "store_name",
        "district_id",
      ],
    });

    if (!store) {
      throw new Error("Store record not found");
    }

    return {
      organization_id: safeNum(store.id),
      organization_level: "retail",
      store_id: safeNum(store.id),
      store_code: store.store_code,
      store_name: store.store_name,
      district_id: safeNum(store.district_id, null),
      visible_to_organization_id: safeNum(store.district_id, null),
      parent_organization_id: safeNum(store.district_id, null),
    };
  }

  // =========================================
  // DISTRICT USER
  // =========================================
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

  // =========================================
  // STATE USER
  // =========================================
  if (level === "state") {
    return {
      organization_id: organizationId,
      organization_level: "state",
      store_id: null,
      store_code: storeCode,
      store_name: null,
      district_id: null,
      visible_to_organization_id: organizationId,
      parent_organization_id: null,
    };
  }

  throw new Error(
    "Only Retail, District or State user can do audit"
  );
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

    const sessionToken =
    req.headers["audit-session"] ||
    req.body.session_token ||
    null;
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

const session = await createAuditSession({
    audit_id: audit.id,
    user,
});
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

    session_token: session.session_token,

    socket_room: session.socket_room,

    summary,
},
      });
    }

    // =====================================================
    // SCAN QR
    // =====================================================
   if (action === "scan") {

  await validateAuditSession(sessionToken);

  await updateAuditHeartbeat(sessionToken);

  if (!qr_code) {
    await t.rollback();

    return res.status(400).json({
      success: false,
      message: "QR code is required",
    });
  }

  // =====================================================
  // PARSE QR CODE
  // =====================================================

  let parsedQR;

  try {
    parsedQR =
      typeof qr_code === "string"
        ? JSON.parse(qr_code)
        : qr_code;
  } catch (error) {
    await t.rollback();

    return res.status(400).json({
      success: false,
      message: "Invalid QR code format",
    });
  }

  const qrPayload = parsedQR?.payload;

  if (!qrPayload) {
    await t.rollback();

    return res.status(400).json({
      success: false,
      message: "Invalid QR payload",
    });
  }

  const qrItemId = qrPayload.item_id;
  const qrCode = qrPayload.code;
  const qrOrganizationId = qrPayload.organization_id;

  console.log("========== QR DEBUG ==========");
  console.log("QR Item ID:", qrItemId);
  console.log("QR Code:", qrCode);
  console.log("QR Organization ID:", qrOrganizationId);
  console.log("User Organization ID:", scope.organization_id);
  console.log("User Store Code:", scope.store_code);
  console.log("User Level:", scope.organization_level);
  console.log("==============================");

  if (!qrItemId && !qrCode) {
    await t.rollback();

    return res.status(400).json({
      success: false,
      message: "Invalid QR code payload",
    });
  }

  // =====================================================
  // FIND ITEM
  // =====================================================

  const itemWhere = {
    is_active: true,

    [Op.or]: [
      ...(qrItemId ? [{ id: qrItemId }] : []),
      ...(qrCode ? [{ sku_code: qrCode }] : []),
      ...(qrCode ? [{ article_code: qrCode }] : []),
    ],
  };

  // Organization filter
  if (scope.organization_id) {
    itemWhere.organization_id = scope.organization_id;
  }

  // Retail store filter
  if (
    scope.organization_level === "retail" &&
    scope.store_code &&
    hasAttr(Item, "storeCode")
  ) {
    itemWhere.storeCode = scope.store_code;
  }

  console.log(
    "Final Item Query:",
    JSON.stringify(itemWhere, null, 2)
  );

  const item = await Item.findOne({
    where: itemWhere,

    include: [
      {
        model: Stock,
        as: "stocks",
        required: false,

        where: {
          organization_id: scope.organization_id,
        },

        attributes: [
          "id",
          "available_qty",
          "available_weight",
        ],
      },
    ],

    transaction: t,
  });

  if (!item) {
    await t.rollback();

    return res.status(404).json({
      success: false,
      message: "Item not found for this QR code",

      debug: {
        qr_item_id: qrItemId,
        qr_code: qrCode,
        qr_organization_id: qrOrganizationId,
        user_organization_id: scope.organization_id,
        store_code: scope.store_code,
      },
    });
  }

  console.log(
    "✅ ITEM FOUND:",
    item.id,
    item.sku_code
  );

  // =====================================================
  // REST OF YOUR EXISTING SCAN CODE
  // =====================================================

      // =====================================================
      // 24 HOURS DUPLICATE AUDIT CHECK
      // Same item audited within 24 hours => block
      // After 24 hours => allow audit again
      // =====================================================
      const lastCompletedAuditItem = await InventoryAuditItem.findOne({
        where: {
          item_id: item.id,
          audit_result: "present",
        },
        order: [["updated_at", "DESC"]],
        transaction: t,
      });

      if (lastCompletedAuditItem) {
        const lastAuditTime = new Date(
          lastCompletedAuditItem.updated_at ||
            lastCompletedAuditItem.created_at
        );

        const now = new Date();
        const diffHours = (now - lastAuditTime) / (1000 * 60 * 60);

        if (diffHours < 24) {
          await t.rollback();

          return res.status(400).json({
            success: false,
            message: "Item audit is already completed",
          });
        }
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

    await validateAuditSession(sessionToken);

    await updateAuditHeartbeat(sessionToken);
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

    await validateAuditSession(sessionToken);
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

await completeAuditSession(sessionToken);
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
  try {
    if (!t.finished) {
      await t.rollback();
    }
  } catch (rollbackError) {
    console.error("Rollback Error:", rollbackError.message);
  }

  console.error("auditController error:", error);

  return res.status(500).json({
    success: false,
    message: "Audit operation failed",
    error: error.message,
  });
}
};
import crypto from "crypto";

import AuditSession from "../model/auditSession.js";

const SESSION_TIMEOUT = 30; // Minutes

export const auditSessionController = async (req, res) => {
  try {
    const user = req.user;

    const {
      action,
      audit_id,
      session_token,
    } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        message: "Action is required",
      });
    }

    // =====================================================
    // CREATE SESSION
    // =====================================================

    if (action === "create") {

      if (!audit_id) {
        return res.status(400).json({
          success: false,
          message: "audit_id is required",
        });
      }

      const existing = await AuditSession.findOne({
        where: {
          audit_id,
          status: "active",
        },
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: "Audit session already active",
          data: existing,
        });
      }

      const token = crypto.randomUUID();

      const session = await AuditSession.create({
        audit_id,

        user_id: user.id,

        organization_id: user.organization_id,

        session_token: token,

        socket_room: `audit_session_${token}`,

        status: "active",

        started_at: new Date(),

        last_activity_at: new Date(),

        expires_at: new Date(
          Date.now() + SESSION_TIMEOUT * 60 * 1000
        ),

        device_info: req.headers["user-agent"] || "",
      });

      return res.json({
        success: true,
        message: "Session created",
        data: session,
      });
    }

    // =====================================================
    // VALIDATE SESSION
    // =====================================================

    if (action === "validate") {

      const session = await AuditSession.findOne({
        where: {
          session_token,
        },
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Session not found",
        });
      }

      if (session.status !== "active") {
        return res.status(401).json({
          success: false,
          message: "Session inactive",
        });
      }

      if (new Date() > session.expires_at) {

        await session.update({
          status: "expired",
        });

        return res.status(401).json({
          success: false,
          message: "Session expired",
        });
      }

      return res.json({
        success: true,
        data: session,
      });

    }

    // =====================================================
    // HEARTBEAT
    // =====================================================

    if (action === "heartbeat") {

      const session = await AuditSession.findOne({
        where: {
          session_token,
          status: "active",
        },
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Session not found",
        });
      }

      await session.update({

        last_activity_at: new Date(),

        expires_at: new Date(
          Date.now() + SESSION_TIMEOUT * 60 * 1000
        ),

      });

      return res.json({
        success: true,
        message: "Heartbeat updated",
      });

    }

    // =====================================================
    // CURRENT SESSION
    // =====================================================

    if (action === "current") {

      const session = await AuditSession.findOne({

        where: {

          user_id: user.id,

          status: "active",

        },

        order: [["createdAt", "DESC"]],

      });

      if (!session) {

        return res.status(404).json({

          success: false,

          message: "No active session",

        });

      }

      return res.json({

        success: true,

        data: session,

      });

    }

    // =====================================================
    // END SESSION
    // =====================================================

    if (action === "end") {

      const session = await AuditSession.findOne({

        where: {

          session_token,

          status: "active",

        },

      });

      if (!session) {

        return res.status(404).json({

          success: false,

          message: "Session not found",

        });

      }

      await session.update({

        status: "completed",

        ended_at: new Date(),

      });

      return res.json({

        success: true,

        message: "Session completed",

      });

    }

    // =====================================================
    // EXPIRE ALL OLD SESSIONS
    // =====================================================

    if (action === "expire") {

      const count = await AuditSession.update(

        {

          status: "expired",

        },

        {

          where: {

            status: "active",

            expires_at: {

              [Op.lt]: new Date(),

            },

          },

        }

      );

      return res.json({

        success: true,

        message: "Expired sessions updated",

        data: count,

      });

    }

    return res.status(400).json({

      success: false,

      message: "Invalid action",

    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      success: false,

      message: error.message,

    });

  }
};
