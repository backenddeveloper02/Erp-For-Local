import sequelize from "../config/db.js";
import { Op, where, cast, col, QueryTypes } from "sequelize";
import StockTransferComplaint from "../model/StockTransferComplaint.js";
import Store from "../model/Store.js";
import StockTransfer from "../model/stockTransfer.js";
import StockTransferItem from "../model/stockTransferItem.js";
import Stock from "../model/stockrecord.js";
import StockMovement from "../model/stockmovement.js";
import ActivityLog from "../model/activityLog.js";
import SystemActivity from "../model/systemActivity.js";
import Item from "../model/item.js";
import Task from "../model/task.js";
import StockRequest from "../model/StockRequest.js";
import StockRequestItem from "../model/stockRequestItem.js";
import District from "../model/District.js";
import cloudinary from "../utils/cloudinary.js";
import User from "../model/user.js";
import { generateDeliveryChallanPdf } from "../service/deliveryChallan.helper.js";
import { InventoryTrackingService } from "../service/inventoryTracking.service.js";
import InventoryBatch from "../model/inventoryBatch.js";

// import Store from "../model/Store.js";
// import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";
const generateTransferNo = () => {
  return `TRF-${Date.now()}`;
};

const generateRequestNo = () => {
  return `REQ-${Date.now()}`;
};

const toNumber = (val) => {
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
};

const getOrCreateStock = async (organization_id, item_id, transaction) => {
  let stock = await Stock.findOne({
    where: { organization_id, item_id },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!stock) {
    stock = await Stock.create(
      {
        organization_id,
        item_id,
        available_qty: 0,
        available_weight: 0,
        reserved_qty: 0,
        reserved_weight: 0,
        transit_qty: 0,
        transit_weight: 0,
        damaged_qty: 0,
        damaged_weight: 0,
      },
      { transaction }
    );
  }

  return stock;
};

const createMovement = async ({
  organization_id,
  item_id,
  movement_type,
  reference_type,
  reference_id,
  qty = 0,
  weight = 0,
  stockBefore,
  stockAfter,
  remarks = null,
  created_by = null,
  transaction,
}) => {
  await StockMovement.create(
    {
      organization_id,
      item_id,
      movement_type,
      reference_type,
      reference_id,
      qty,
      weight,

      opening_available_qty: toNumber(stockBefore.available_qty),
      closing_available_qty: toNumber(stockAfter.available_qty),

      opening_reserved_qty: toNumber(stockBefore.reserved_qty),
      closing_reserved_qty: toNumber(stockAfter.reserved_qty),

      opening_transit_qty: toNumber(stockBefore.transit_qty),
      closing_transit_qty: toNumber(stockAfter.transit_qty),

      opening_damaged_qty: toNumber(stockBefore.damaged_qty),
      closing_damaged_qty: toNumber(stockAfter.damaged_qty),

      opening_available_weight: toNumber(stockBefore.available_weight),
      closing_available_weight: toNumber(stockAfter.available_weight),

      opening_reserved_weight: toNumber(stockBefore.reserved_weight),
      closing_reserved_weight: toNumber(stockAfter.reserved_weight),

      opening_transit_weight: toNumber(stockBefore.transit_weight),
      closing_transit_weight: toNumber(stockAfter.transit_weight),

      opening_damaged_weight: toNumber(stockBefore.damaged_weight),
      closing_damaged_weight: toNumber(stockAfter.damaged_weight),

      remarks,
      created_by,
    },
    { transaction }
  );
};

const createActivity = async ({
  user_id,
  action,
  title,
  description,
  meta = {},
  transaction,
}) => {
  await ActivityLog.create(
    {
      user_id,
      action,
      title,
      description,
      meta,
      icon: "activity",
      color: "blue",
    },
    { transaction }
  );
};

const safeUnlink = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("File delete error:", error.message);
  }
};

const uploadToCloudinary = async (
  filePath,
  folder,
  resourceType = "image"
) => {
  return cloudinary.uploader.upload(filePath, {
    folder,
    resource_type: resourceType,

    //  Important fix
    type: "upload",
    access_mode: "public",

    use_filename: true,
    unique_filename: true,
    overwrite: false,
  });
};

const tryJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const normalizeItemRow = (row = {}) => {
  return {
    item_id: toNumber(row.item_id ?? row.id ?? row.itemId),
    qty: toNumber(row.qty ?? row.approved_qty ?? row.approve_qty ?? row.quantity),
    weight: toNumber(row.weight ?? row.approved_weight ?? row.total_weight),
    rate: toNumber(row.rate ?? row.item_rate ?? row.price),
    remarks: row.remarks || row.note || null,
  };
};

const parseItemsFromBody = (body = {}) => {
  const normalizeItem = (item = {}) => ({
    item_id: toNumber(item.item_id),
    parent_batch_id: toNumber(item.parent_batch_id || item.batch_id),
    batch_id: toNumber(item.batch_id || item.parent_batch_id),
    qty: toNumber(item.qty || item.approved_qty),
    weight: toNumber(item.weight || item.approved_weight),
    rate: toNumber(item.rate),
    remarks: item.remarks || null,
  });

  const rawItems = body.items;

  if (Array.isArray(rawItems)) {
    return rawItems.map(normalizeItem);
  }

  if (typeof rawItems === "string") {
    const text = rawItems.trim();

    if (!text) return [];

    try {
      const parsed = JSON.parse(text);

      if (!Array.isArray(parsed)) return [];

      return parsed.map(normalizeItem);
    } catch (error) {
      console.error("parseItemsFromBody JSON parse error:", error.message);
      return [];
    }
  }

  const indexedItems = [];

  Object.keys(body || {}).forEach((key) => { 
    const match = key.match(/^items\[(\d+)\]\[(.+)\]$/);

    if (!match) return;

    const index = Number(match[1]);
    const field = match[2];

    if (!indexedItems[index]) indexedItems[index] = {};

    indexedItems[index][field] = body[key];
  });

  return indexedItems.filter(Boolean).map(normalizeItem);
};

export const getAvailableStockForRequest = async (req, res) => {
  try {
    const user = req.user;
    const { category, search, metal_type } = req.query;

    if (!user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const orgId = Number(user.organization_id);

    const itemWhere = {
      organization_id: orgId,
      current_status: "in_stock",
    };

    const stockWhere = {
      organization_id: orgId,
      available_qty: {
        [Op.gt]: 0,
      },
    };

    if (category) {
      itemWhere.category = category;
    }

    if (metal_type) {
      itemWhere.metal_type = metal_type;
    }

    if (search) {
      itemWhere[Op.or] = [
        { item_name: { [Op.iLike]: `%${search}%` } },
        { article_code: { [Op.iLike]: `%${search}%` } },
        { sku_code: { [Op.iLike]: `%${search}%` } },
        { purity: { [Op.iLike]: `%${search}%` } },
        { category: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const items = await Item.findAll({
      attributes: [
        "id",
        "item_name",
        "article_code",
        "sku_code",
        "metal_type",
        "category",
        "purity",
        "unit",
        "organization_id",
      ],
      where: itemWhere,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: true,
          where: stockWhere,
          attributes: [
            "id",
            "item_id",
            "organization_id",
            "available_qty",
            "available_weight",
          ],
        },
      ],
      order: [["id", "DESC"]],
    });

    const data = items.map((item) => {
      const stock =
        Array.isArray(item.stocks) && item.stocks.length > 0
          ? item.stocks[0]
          : null;

      const availableQty = Number(stock?.available_qty || 0);

      let statusLabel = "medium";
      if (availableQty <= 2) {
        statusLabel = "critical";
      } else if (availableQty <= 12) {
        statusLabel = "medium";
      } else {
        statusLabel = "optimum";
      }

      return {
        item_id: Number(item.id),
        item_name: item.item_name || "",
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        category: item.category || "",
        metal_type: item.metal_type || "",
        purity: item.purity || "",
        unit: item.unit || "",
        available_qty: availableQty,
        available_weight: Number(stock?.available_weight || 0),
        status_label: statusLabel,
        request_qty: 0,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Available stock fetched successfully",
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getAvailableStockForRequest error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch available stock items",
      error: error.message,
    });
  }
};
// helper


export const createStockRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const user = req.user;
    const { store_id, items, priority, category, notes } = req.body;

    // ================= VALIDATION =================
    if (!store_id || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "store_id and items are required",
      });
    }

    // ================= GET RETAIL STORE =================
    const store = await Store.findOne({
      where: {
        id: store_id,
        is_active: true,
      },
      transaction,
    });

    if (!store) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    // ================= DISTRICT STORE RESOLUTION =================
    let districtStore = null;

    if (store.district_id) {
      districtStore = await Store.findOne({
        where: {
          id: store.district_id,
          organizationlevel: "District",
          is_active: true,
        },
        transaction,
      });
    }

    if (!districtStore) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Cannot resolve district for this store",
        debug: {
          store_id: store.id,
          store_code: store.store_code,
          store_name: store.store_name,
          district_id: store.district_id,
        },
      });
    }

    // ================= VALID ITEMS FORMAT =================
    const validItems = items
      .filter(
        (item) =>
          item.item_id &&
          Number.isFinite(Number(item.request_qty)) &&
          Number(item.request_qty) > 0
      )
      .map((item) => ({
        item_id: Number(item.item_id),
        request_qty: Number(item.request_qty),
        approved_qty: 0,
        status: "pending",
      }));

    if (validItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No valid items found",
      });
    }

    // ================= MERGE SAME ITEMS =================
    const itemMap = new Map();

    for (const item of validItems) {
      if (itemMap.has(item.item_id)) {
        itemMap.get(item.item_id).request_qty += item.request_qty;
      } else {
        itemMap.set(item.item_id, item);
      }
    }

    const finalItems = Array.from(itemMap.values());

    // ================= ITEM EXISTENCE CHECK =================
    const itemIds = finalItems.map((item) => item.item_id);

    const existingItems = await Item.findAll({
      where: {
        id: {
          [Op.in]: itemIds,
        },
        is_active: true,
      },
      attributes: [
        "id",
        "item_name",
        "article_code",
        "sku_code",
        "store_id",
        "storeCode",
        "organization_id",
      ],
      transaction,
      raw: true,
    });

    const existingItemIds = existingItems.map((item) => Number(item.id));

    const invalidItemIds = itemIds.filter(
      (id) => !existingItemIds.includes(Number(id))
    );

    if (invalidItemIds.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid item_id found",
        invalid_item_ids: invalidItemIds,
      });
    }

    // ================= ITEM STORE VALIDATION =================
    const invalidStoreItems = existingItems.filter((item) => {
      const itemStoreId = Number(item.store_id || 0);
      const itemOrgId = Number(item.organization_id || 0);
      const itemStoreCode = String(item.storeCode || "").trim().toUpperCase();

      return (
        itemStoreId !== Number(store.id) &&
        itemOrgId !== Number(store.id) &&
        itemStoreCode !== String(store.store_code).trim().toUpperCase()
      );
    });

    if (invalidStoreItems.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Some items do not belong to selected store",
        invalid_items: invalidStoreItems.map((item) => ({
          id: item.id,
          item_name: item.item_name,
          article_code: item.article_code,
          sku_code: item.sku_code,
          store_id: item.store_id,
          storeCode: item.storeCode,
          organization_id: item.organization_id,
        })),
      });
    }

    // ================= REQUEST NO =================
    const request_no = `REQ-${store.id}-${Date.now()}`;

    const finalDistrictId = districtStore.id;
    const finalDistrictCode = districtStore.store_code;
    const finalDistrictName = districtStore.store_name;

    // ================= CREATE REQUEST =================
    const stockRequest = await StockRequest.create(
      {
        request_no,

        from_organization_id: store.id,
        from_store_code: store.store_code,
        from_store_name: store.store_name,

        to_organization_id: finalDistrictId,
        to_store_code: finalDistrictCode,
        to_store_name: finalDistrictName,

        to_district_code: finalDistrictCode,
        to_district_name: finalDistrictName,

        priority: priority || "medium",
        category: category || null,
        notes: notes || null,
        status: "pending",
        created_by: user?.id || null,
      },
      { transaction }
    );

    // ================= ITEMS =================
    const requestItemsPayload = finalItems.map((item) => ({
      request_id: stockRequest.id,
      item_id: item.item_id,
      request_qty: item.request_qty,
      approved_qty: 0,
      status: "pending",
    }));

    await StockRequestItem.bulkCreate(requestItemsPayload, {
      transaction,
    });

    // ================= TASK =================
    await Task.create(
      {
        title: "Stock request approval required",
        description: `${store.store_name} sent request ${stockRequest.request_no} to ${finalDistrictName}`,
        priority: priority || "medium",
        status: "pending",
        task_type: "stock_request_approval",
        reference_id: stockRequest.id,
        reference_no: stockRequest.request_no,

        district_code: finalDistrictCode,
        store_code: store.store_code,
        store_name: store.store_name,

        created_by: user?.id || null,
      },
      { transaction }
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Stock request created successfully",
      data: {
        request_id: stockRequest.id,
        request_no: stockRequest.request_no,
        total_items: requestItemsPayload.length,

        from_store: {
          id: store.id,
          store_code: store.store_code,
          store_name: store.store_name,
        },

        district: {
          id: finalDistrictId,
          store_code: finalDistrictCode,
          store_name: finalDistrictName,
        },

        items: requestItemsPayload.map((item) => ({
          item_id: item.item_id,
          request_qty: item.request_qty,
          status: item.status,
        })),
      },
    });
  } catch (error) {
    await transaction.rollback();

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
/*
Request flow:
Store -> District (Request creation, approval, dispatch)
  */
const TRANSFER_ACTIVE_STATUSES = [
  "approved",
  "dispatched",
  "in_transit",
  "received",
];

const APPROVED_REQUEST_STATUSES = [
  "approved",
  "partially_approved",
  "completed",
];

const LOW_STOCK_THRESHOLD = 5;

const calculateStockRequestSummary = (requests = []) => {
  let totalRequests = requests.length;
  let approvedRequests = 0;
  let transitGoods = 0;
  let lowStockItems = 0;

  for (const reqRow of requests) {
    const row = reqRow.toJSON ? reqRow.toJSON() : reqRow;

    const requestStatus = String(row.status || "").toLowerCase();
    const transferStatus = String(row.transfer?.status || "").toLowerCase();

    if (APPROVED_REQUEST_STATUSES.includes(requestStatus)) {
      approvedRequests += 1;
    }

    const requestItems = Array.isArray(row.request_items)
      ? row.request_items
      : [];

    for (const itemRow of requestItems) {
      const qty = Number(
        itemRow.approved_qty ||
          itemRow.request_qty ||
          itemRow.qty ||
          itemRow.quantity ||
          0
      );

      if (row.transfer && TRANSFER_ACTIVE_STATUSES.includes(transferStatus)) {
        transitGoods += qty;
      }

      if (qty > 0 && qty <= LOW_STOCK_THRESHOLD) {
        lowStockItems += 1;
      }
    }
  }

  return {
    total_requests: totalRequests,
    approved_requests: approvedRequests,
    low_stock_items: lowStockItems,
    transit_goods: transitGoods,
  };
};

const addTransferDirection = (rows = [], user) => {
  return rows.map((row) => {
    const item = row.toJSON ? row.toJSON() : row;

    const transferStatus = String(item.transfer?.status || "").toLowerCase();

    const isSender =
      Number(item.from_organization_id) === Number(user.organization_id);

    const isReceiver =
      Number(item.to_organization_id) === Number(user.organization_id);

    let movement_type = "unknown";

    if (isSender && transferStatus === "in_transit") {
      movement_type = "in_transit_send";
    } else if (isReceiver && transferStatus === "in_transit") {
      movement_type = "in_transit_receive";
    } else if (isSender) {
      movement_type = "send";
    } else if (isReceiver) {
      movement_type = "receive";
    }

    return {
      ...item,
      movement_type,
      is_sent: isSender,
      is_received: isReceiver,
    };
  });
};

export const getMyStockRequests = async (req, res) => {
  try {
    const user = req.user;

    const userOrgId = Number(user.organization_id);
    const userStoreCode = String(user.store_code || user.storeCode || "")
      .trim()
      .toUpperCase();

    // ==========================================
    // BATCH MAP (ADDED)
    // ==========================================

    const batchRows = await sequelize.query(
      `
      SELECT
        item_id,
        id AS parent_batch_id,
        root_batch_id,
        batch_no
      FROM inventory_batches
      WHERE
        parent_batch_id IS NULL
        OR parent_batch_id = root_batch_id
      `,
      {
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const batchMap = new Map();

    for (const batch of batchRows) {
      if (!batchMap.has(Number(batch.item_id))) {
        batchMap.set(Number(batch.item_id), batch);
      }
    }

    const whereCondition = {
      [Op.or]: [
        {
          created_by: user.id,
        },

        {
          to_organization_id: userOrgId,
        },

        {
          to_district_code: userStoreCode,
        },
      ],
    };

    const requests = await StockRequest.findAll({
      where: whereCondition,
      include: [
        {
          model: StockRequestItem,
          as: "request_items",
          include: [
            {
              model: Item,
              as: "item",
              attributes: [
                "id",
                "item_name",
                "article_code",
                "sku_code",
                "category",
                "metal_type",
                "purity",
                "unit",
                "gross_weight",
                "net_weight",
              ],
              required: false,
            },
          ],
        },
        {
          model: StockTransfer,
          as: "transfer",
          required: false,
          attributes: [
            "id",
            "request_id",
            "transfer_no",
            "status",
            "dispatch_date",
            "receive_date",
            "created_at",
          ],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const finalData = addTransferDirection(requests, user);

    // ==========================================
    // PARENT BATCH DETAILS ADDED
    // ==========================================

    const updatedData = finalData.map((request) => ({
      ...request,
      request_items: (request.request_items || []).map((reqItem) => ({
        ...reqItem,

        parent_batch_id:
          batchMap.get(Number(reqItem.item_id))
            ?.parent_batch_id || null,

        root_batch_id:
          batchMap.get(Number(reqItem.item_id))
            ?.root_batch_id || null,

        batch_id:
          batchMap.get(Number(reqItem.item_id))
            ?.parent_batch_id || null,

        batch_no:
          batchMap.get(Number(reqItem.item_id))
            ?.batch_no || null,
      })),
    }));

    const createdRequests = updatedData.filter(
      (reqItem) =>
        Number(reqItem.created_by) === Number(user.id)
    );

    const receivedRequests = updatedData.filter(
      (reqItem) =>
        Number(reqItem.to_organization_id) === userOrgId ||
        String(reqItem.to_district_code || "").toUpperCase() ===
          userStoreCode
    );

    const approvedRequests = updatedData.filter((reqItem) =>
      ["approved", "partially_approved", "completed"].includes(
        reqItem.status
      )
    );

    const transitGoods = updatedData.filter(
      (reqItem) =>
        reqItem.transfer &&
        ["dispatched", "in_transit"].includes(
          reqItem.transfer.status
        )
    );

    const summary = {
      total_requests: updatedData.length,
      created_requests: createdRequests.length,
      received_requests: receivedRequests.length,
      approved_requests: approvedRequests.length,
      low_stock_items: 0,
      transit_goods: transitGoods.length,
    };

    return res.status(200).json({
      success: true,
      summary,
      count: updatedData.length,
      data: updatedData,
    });
  } catch (error) {
    console.error("getMyStockRequests error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch my stock requests",
      error: error.message,
    });
  }
};
export const getReceivedStockRequests = async (req, res) => {
  try {
    const user = req.user;

    // ==========================================
    // BATCH MAP (ADDED ONLY)
    // ==========================================

    const batchRows = await sequelize.query(
      `
      SELECT
        item_id,
        id AS parent_batch_id,
        root_batch_id,
        batch_no
      FROM inventory_batches
      WHERE
        parent_batch_id IS NULL
        OR parent_batch_id = root_batch_id
      `,
      {
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const batchMap = new Map();

    for (const batch of batchRows) {
      if (!batchMap.has(Number(batch.item_id))) {
        batchMap.set(Number(batch.item_id), batch);
      }
    }

    const requests = await StockRequest.findAll({
      where: {
        to_organization_id: user.organization_id,
      },
      include: [
        {
          model: StockRequestItem,
          as: "request_items",
          include: [
            {
              model: Item,
              as: "item",
              attributes: [
                "id",
                "item_name",
                "article_code",
                "sku_code",
                "category",
                "metal_type",
                "purity",
                "unit",
                "gross_weight",
                "net_weight",
              ],
              required: false,
            },
          ],
        },
        {
          model: StockTransfer,
          as: "transfer",
          required: false,
          attributes: [
            "id",
            "request_id",
            "transfer_no",
            "status",
            "dispatch_date",
            "receive_date",
            "created_at",
          ],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const finalData = addTransferDirection(requests, user)
      .map((row) => {
        const plainRow = row.toJSON?.() || row;

        return {
          ...plainRow,
          request_type: "received",

          request_items: (
            plainRow.request_items || []
          ).map((reqItem) => ({
            ...reqItem,

            parent_batch_id:
              batchMap.get(Number(reqItem.item_id))
                ?.parent_batch_id || null,

            root_batch_id:
              batchMap.get(Number(reqItem.item_id))
                ?.root_batch_id || null,

            batch_id:
              batchMap.get(Number(reqItem.item_id))
                ?.parent_batch_id || null,

            batch_no:
              batchMap.get(Number(reqItem.item_id))
                ?.batch_no || null,
          })),
        };
      });

    const summary = calculateStockRequestSummary(finalData);

    const lowStockAlert = {
      show_alert: summary.low_stock_items > 0,
      message:
        summary.low_stock_items > 0
          ? `${summary.low_stock_items} low-quantity requested item(s) found.`
          : "No low stock items.",
      request_button_text: "Review Requests",
    };

    return res.status(200).json({
      success: true,
      summary,
      low_stock_alert: lowStockAlert,
      count: finalData.length,
      data: finalData,
    });
  } catch (error) {
    console.error("getReceivedStockRequests error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch received stock requests",
      error: error.message,
    });
  }
};
// ==========================================
// GET SINGLE REQUEST
// ==========================================
export const getStockRequestById = async (req, res) => {
  try {
    const { requestId } = req.params;
    const user = req.user;

    const request = await StockRequest.findByPk(requestId, {
      include: [
        {
          model: StockRequestItem,
          as: "request_items",
          include: [
            {
              model: Item,
              as: "item",
              attributes: [
                "id",
                "item_name",
                "article_code",
                "sku_code",
                "category",
                "metal_type",
                "purity",
                "unit",
                "gross_weight",
                "net_weight",
              ],
              required: false,
            },
          ],
        },
        {
          model: StockTransfer,
          as: "transfer",
          include: [
            {
              model: StockTransferItem,
              as: "transfer_items",
            },
          ],
        },
      ],
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Stock request not found",
      });
    }

    const allowed =
      Number(request.from_organization_id) === Number(user.organization_id) ||
      Number(request.to_organization_id) === Number(user.organization_id);

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this request",
      });
    }

    return res.status(200).json({
      success: true,
      data: request,
    });
  } catch (error) {
    console.error("getStockRequestById error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch stock request details",
      error: error.message,
    });
  }
};


// ==========================================
// STORE -> CANCEL PENDING REQUEST
// ==========================================
export const cancelStockRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { requestId } = req.params;
    const user = req.user;

    const request = await StockRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!request) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Stock request not found",
      });
    }

    if (Number(request.from_organization_id) !== Number(user.organization_id)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to cancel this request",
      });
    }

    if (request.status !== "pending") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only pending request can be cancelled",
      });
    }

    await request.update(
      {
        status: "cancelled",
      },
      { transaction }
    );

    await createActivity({
      user_id: user.id,
      action: "stock_request_cancelled",
      title: "Stock request cancelled",
      description: `Stock request ${request.request_no} cancelled`,
      meta: {
        request_id: request.id,
        request_no: request.request_no,
      },
      transaction,
    });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Stock request cancelled successfully",
    });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to cancel stock request",
      error: error.message,
    });
  }
};



// ==========================================
// PARENT ORG -> REJECT REQUEST
// ==========================================
export const rejectStockRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { requestId } = req.params;
    const { remarks } = req.body;
    const user = req.user;

    const request = await StockRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!request) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Stock request not found",
      });
    }

    if (Number(request.to_organization_id) !== Number(user.organization_id)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reject this request",
      });
    }

    if (request.status !== "pending") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only pending request can be rejected",
      });
    }

    await request.update(
      {
        status: "rejected",
        remarks: remarks || request.remarks,
      },
      { transaction }
    );

    await createActivity({
      user_id: user.id,
      action: "stock_request_rejected",
      title: "Stock request rejected",
      description: `Stock request ${request.request_no} rejected`,
      meta: {
        request_id: request.id,
        request_no: request.request_no,
      },
      transaction,
    });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Stock request rejected successfully",
    });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to reject stock request",
      error: error.message,
    });
  }
};

const canApproveDispatch = (user, allowedLevels = []) => {
  const userLevel = String(user?.organization_level || "").toLowerCase();
  return allowedLevels.includes(userLevel);
};

export const approveAndDispatchHeadRequest = async (req, res) => {
  req.allowedApproveLevels = ["head"];
  return approveAndDispatchRequest(req, res);
};







//this is 
export const approveAndDispatchRequestfromretail = async (req, res) => {
  const transaction = await sequelize.transaction();
  const uploadedLocalPaths = [];

  try {
    const { requestId } = req.params;

    const {
      remarks,
      driver_name,
      driver_phone,
      vehicle_number,
      tracking_number,
      pickup_address,
      delivery_address,
      expected_delivery_date,
      expected_delivery_time,
      additional_notes,
    } = req.body;

    const user = req.user;
    const parsedItems = parseItemsFromBody(req.body);

    console.log("approveAndDispatchRequest req.body keys:", Object.keys(req.body || {}));
    console.log("approveAndDispatchRequest raw items:", req.body?.items);
    console.log("approveAndDispatchRequest parsedItems:", parsedItems);
    console.log("approveAndDispatchRequest files:", {
      driver_photo: req.files?.driver_photo?.length || 0,
      dispatch_images: req.files?.dispatch_images?.length || 0,
      dispatch_video: req.files?.dispatch_video?.length || 0,
      e_way_bill: req.files?.e_way_bill?.length || 0,
    });

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Approved items are required. Send items as JSON string or items[0][item_id], items[0][qty] format.",
      });
    }

    if (!driver_name || !driver_phone || !vehicle_number) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Driver name, driver phone, and vehicle number are required",
      });
    }

    const approvedRows = parsedItems.filter((row) => Number(row.qty || 0) > 0);

    if (approvedRows.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "At least one item must have qty greater than 0 for approval",
      });
    }

    if (!pickup_address || !delivery_address) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Pickup and delivery address are required",
      });
    }

    if (!expected_delivery_date || !expected_delivery_time) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Expected delivery date and time are required",
      });
    }

    const driverPhotoFile = req.files?.driver_photo?.[0] || null;
    const dispatchImageFiles = req.files?.dispatch_images || [];
    const dispatchVideoFile = req.files?.dispatch_video?.[0] || null;
    const eWayBillFile = req.files?.e_way_bill?.[0] || null;

    if (dispatchImageFiles.length > 3) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Maximum 3 dispatch images allowed",
      });
    }

    if (driverPhotoFile?.path) uploadedLocalPaths.push(driverPhotoFile.path);

    for (const file of dispatchImageFiles) {
      if (file?.path) uploadedLocalPaths.push(file.path);
    }

    if (dispatchVideoFile?.path) uploadedLocalPaths.push(dispatchVideoFile.path);
    if (eWayBillFile?.path) uploadedLocalPaths.push(eWayBillFile.path);

    const request = await StockRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!request) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Stock request not found",
      });
    }

    const requestItems = await StockRequestItem.findAll({
      where: { request_id: request.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const allowedLevels = req.allowedApproveLevels || ["retail", "district"];

    if (!canApproveDispatch(user, allowedLevels)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: allowedLevels.includes("head")
          ? "Only head can approve this request"
          : "Only retail or district can approve this request",
      });
    }

    if (Number(request.to_organization_id) !== Number(user.organization_id)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to approve this request",
      });
    }

    if (request.status !== "pending") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only pending request can be approved",
      });
    }

    const existingTransfer = await StockTransfer.findOne({
      where: { request_id: request.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingTransfer) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Transfer already created for this request",
      });
    }

    const requestItemMap = new Map(
      requestItems.map((x) => [Number(x.item_id), x])
    );

    for (const row of parsedItems) {
      const item_id = toNumber(row.item_id);
      const qty = toNumber(row.qty);
      const parent_batch_id = toNumber(row.parent_batch_id || row.batch_id);

      if (!item_id || qty < 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Each item must have valid item_id and qty",
        });
      }

      if (qty > 0 && !parent_batch_id) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `parent_batch_id is required for item ${item_id}`,
        });
      }

      const requestItem = requestItemMap.get(item_id);

      if (!requestItem) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Requested item not found for item_id ${item_id}`,
        });
      }

      const requestedQty = toNumber(requestItem.request_qty);

      if (qty > requestedQty) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Approved qty cannot exceed requested qty for item ${item_id}`,
        });
      }
    }

    let driver_photo_url = null;
    let dispatch_image_urls = [];
    let dispatch_video_url = null;
    let e_way_bill_url = null;

    if (driverPhotoFile?.path) {
      const uploadedDriverPhoto = await uploadToCloudinary(
        driverPhotoFile.path,
        "stock-transfer/driver-photo",
        "image"
      );
      driver_photo_url = uploadedDriverPhoto.secure_url;
    }

    if (dispatchImageFiles.length > 0) {
      for (const file of dispatchImageFiles) {
        const uploadedImage = await uploadToCloudinary(
          file.path,
          "stock-transfer/dispatch-images",
          "image"
        );
        dispatch_image_urls.push(uploadedImage.secure_url);
      }
    }

    if (dispatchVideoFile?.path) {
      const uploadedVideo = await uploadToCloudinary(
        dispatchVideoFile.path,
        "stock-transfer/dispatch-video",
        "video"
      );
      dispatch_video_url = uploadedVideo.secure_url;
    }

    if (eWayBillFile?.path) {
      const isPdf =
        eWayBillFile.mimetype === "application/pdf" ||
        eWayBillFile.originalname?.toLowerCase().endsWith(".pdf");

      const uploadedEWayBill = await uploadToCloudinary(
        eWayBillFile.path,
        "stock-transfer/e-way-bills",
        isPdf ? "raw" : "image"
      );

      e_way_bill_url = uploadedEWayBill.secure_url;
    }

    const transfer = await StockTransfer.create(
      {
        transfer_no: generateTransferNo(),
        request_id: request.id,

        from_organization_id: user.organization_id,
        to_organization_id: request.from_organization_id,

        transfer_date: new Date(),
        dispatch_date: new Date(),
        status: "in_transit",

        approved_by: user.id,
        dispatched_by: user.id,
        created_by: user.id,

        remarks: remarks || null,

        driver_name: driver_name || null,
        driver_phone: driver_phone || null,
        vehicle_number: vehicle_number || null,
        tracking_number: tracking_number || null,

        driver_photo_url: driver_photo_url || null,
        dispatch_image_url:
          dispatch_image_urls.length > 0
            ? JSON.stringify(dispatch_image_urls)
            : null,
        dispatch_video_url: dispatch_video_url || null,
        e_way_bill_url: e_way_bill_url || null,

        pickup_address: pickup_address || null,
        delivery_address: delivery_address || null,
        expected_delivery_date: expected_delivery_date || null,
        expected_delivery_time: expected_delivery_time || null,
        additional_notes: additional_notes || null,
      },
      { transaction }
    );

    let totalRequested = 0;
    let totalApproved = 0;
    let totalWeight = 0;
    let estimatedValue = 0;
    let approvedItemsCount = 0;

    const dispatchedBatches = [];
    const challanItems = [];

    for (const row of parsedItems) {
      const item_id = toNumber(row.item_id);
      const qty = toNumber(row.qty);
      const weight = toNumber(row.weight);
      const rate = toNumber(row.rate);
      const parent_batch_id = toNumber(row.parent_batch_id || row.batch_id);

      const requestItem = requestItemMap.get(item_id);
      const requestedQty = toNumber(requestItem.request_qty);

      totalRequested += requestedQty;
      totalApproved += qty;

      if (qty === 0) {
        await requestItem.update(
          {
            approved_qty: 0,
            approved_weight: 0,
            status: "rejected",
          },
          { transaction }
        );
        continue;
      }

      // Replace only Item.findOne block in your controller with this

const itemDetails = await Item.findOne({
  where: {
    id: item_id,
    organization_id: request.to_organization_id, // ✅ FIXED
    is_active: true,
  },
  transaction,
  lock: transaction.LOCK.UPDATE,
});

if (!itemDetails) {
  await transaction.rollback();
  return res.status(404).json({
    success: false,
    message: `Item not found in source organization for item_id ${item_id}`,
  });
}

if (String(itemDetails.current_status || "").toLowerCase() === "sold") {
  await transaction.rollback();
  return res.status(409).json({
    success: false,
    message: `Item ${item_id} is already sold and cannot be dispatched`,
  });
}
      const batchRows = await sequelize.query(
        `
        SELECT
          id,
          batch_no,
          item_id,
          organization_id,
          current_organization_id,
          available_qty,
          available_weight,
          status
        FROM public.inventory_batches
        WHERE id = :parent_batch_id
        FOR UPDATE
        `,
        {
          replacements: { parent_batch_id },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      const parentBatch = batchRows?.[0];

      if (!parentBatch) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: `Parent batch not found for item ${item_id}`,
        });
      }

      if (Number(parentBatch.item_id) !== Number(item_id)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Parent batch ${parent_batch_id} does not belong to item ${item_id}`,
        });
      }

      const parentBatchOrgId = Number(
        parentBatch.current_organization_id || parentBatch.organization_id || 0
      );

      if (parentBatchOrgId !== Number(user.organization_id)) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: `Parent batch ${parent_batch_id} does not belong to your organization`,
        });
      }

      if (
        ["sold", "damaged", "dead"].includes(
          String(parentBatch.status || "").toLowerCase()
        )
      ) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: `Parent batch ${parent_batch_id} is already ${parentBatch.status}`,
        });
      }

      if (Number(parentBatch.available_qty || 0) < qty) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: `Insufficient batch qty for item ${item_id}`,
        });
      }

      if (weight > 0 && Number(parentBatch.available_weight || 0) < weight) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: `Insufficient batch weight for item ${item_id}`,
        });
      }

      approvedItemsCount += 1;
      totalWeight += weight;
      estimatedValue += weight * rate;

      const fromStock = await getOrCreateStock(
        user.organization_id,
        item_id,
        transaction
      );

      const availableQty = toNumber(fromStock.available_qty);
      const availableWeight = toNumber(fromStock.available_weight);
      const reservedQty = toNumber(fromStock.reserved_qty);
      const reservedWeight = toNumber(fromStock.reserved_weight);
      const transitQty = toNumber(fromStock.transit_qty);
      const transitWeight = toNumber(fromStock.transit_weight);
      const damagedQty = toNumber(fromStock.damaged_qty);
      const damagedWeight = toNumber(fromStock.damaged_weight);

      if (availableQty < qty) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient available qty for item ${item_id}`,
        });
      }

      if (weight > 0 && availableWeight < weight) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient available weight for item ${item_id}`,
        });
      }

      const transferItem = await StockTransferItem.create(
        {
          transfer_id: transfer.id,
          item_id,
          parent_batch_id,
          qty,
          weight,
          rate,
          remarks: row.remarks || null,
        },
        { transaction }
      );

      await requestItem.update(
        {
          approved_qty: qty,
          approved_weight: weight,
          status: qty < requestedQty ? "partially_approved" : "approved",
        },
        { transaction }
      );

      const newAvailableQty = availableQty - qty;
      const newAvailableWeight = availableWeight - weight;
      const newTransitQty = transitQty + qty;
      const newTransitWeight = transitWeight + weight;

      await fromStock.update(
        {
          available_qty: newAvailableQty,
          available_weight: newAvailableWeight,
          transit_qty: newTransitQty,
          transit_weight: newTransitWeight,
        },
        { transaction }
      );

      await createMovement({
        organization_id: user.organization_id,
        item_id,
        movement_type: "dispatch",
        reference_type: "stock_transfer",
        reference_id: transfer.id,
        qty,
        weight,
        stockBefore: {
          available_qty: availableQty,
          reserved_qty: reservedQty,
          transit_qty: transitQty,
          damaged_qty: damagedQty,
          available_weight: availableWeight,
          reserved_weight: reservedWeight,
          transit_weight: transitWeight,
          damaged_weight: damagedWeight,
        },
        stockAfter: {
          available_qty: newAvailableQty,
          reserved_qty: reservedQty,
          transit_qty: newTransitQty,
          damaged_qty: damagedQty,
          available_weight: newAvailableWeight,
          reserved_weight: reservedWeight,
          transit_weight: newTransitWeight,
          damaged_weight: damagedWeight,
        },
        remarks: `Dispatched via ${transfer.transfer_no}`,
        created_by: user.id,
        transaction,
      });

      const childBatch = await InventoryTrackingService.distributeBatch(
        {
          parent_batch_id,
          to_organization_id: request.from_organization_id,

          quantity: qty,
          weight,

          reference_type: "STOCK_TRANSFER",
          reference_id: transfer.id,

          remarks: `Dispatched via ${transfer.transfer_no}`,
          handled_by: user.id,

          batch_status: "in_transit",
        },
        { transaction }
      );

      await transferItem.update(
        {
          child_batch_id: childBatch.id,
        },
        { transaction }
      );

      dispatchedBatches.push({
        item_id,
        parent_batch_id,
        parent_batch_no: parentBatch.batch_no,
        child_batch_id: childBatch.id,
        child_batch_no: childBatch.batch_no,
        dispatched_qty: Number(childBatch.total_qty || 0),
        dispatched_weight: Number(childBatch.total_weight || 0),
        status: childBatch.status,
      });

      challanItems.push({
        item_id,
        item_name: itemDetails.item_name,
        product_code: itemDetails.article_code || itemDetails.sku_code,
        hsn_code: itemDetails.hsn_code,
        purity: itemDetails.purity,
        qty,
        weight,
        rate,
        making_charge: itemDetails.making_charge || 0,
        huid_code: itemDetails.huid_code || "-",
        base_value: weight > 0 ? weight * rate : qty * rate,
      });
    }

    let finalStatus = "approved";

    if (approvedItemsCount === 0) {
      finalStatus = "rejected";
    } else if (totalApproved < totalRequested) {
      finalStatus = "partially_approved";
    }

    await request.update(
      {
        status: finalStatus,
        approved_by: user.id,
        approved_at: new Date(),
      },
      { transaction }
    );

    await Task.update(
      { status: finalStatus },
      {
        where: {
          reference_id: request.id,
          task_type: {
            [Op.in]: [
              "stock_request_approval",
              "district_to_head_stock_request",
              "district_to_retail_stock_request",
              "head_to_district_stock_request",
              "head_to_retail_stock_request",
              "retail_to_district_stock_request",
            ],
          },
        },
        transaction,
      }
    );

    await SystemActivity.create(
      {
        title:
          finalStatus === "approved"
            ? "Stock request approved and dispatched"
            : finalStatus === "partially_approved"
            ? "Stock request partially approved and dispatched"
            : "Stock request rejected",
        description:
          finalStatus === "rejected"
            ? `Request ${request.request_no} was rejected by receiving organization`
            : `Request ${request.request_no} processed via ${transfer.transfer_no}`,
        activity_type: "stock_request_dispatch",
        module_name: "stock_transfer",
        reference_id: transfer.id,
        reference_no: transfer.transfer_no,
        district_code: request.to_district_code || null,
        store_code: request.from_store_code || null,
        store_name: request.from_store_name || null,
        created_by: user.id,
        created_at: new Date(),
      },
      { transaction }
    );

    await createActivity({
      user_id: user.id,
      action: "stock_request_dispatch",
      title:
        finalStatus === "approved"
          ? "Stock request approved and dispatched"
          : finalStatus === "partially_approved"
          ? "Stock request partially approved and dispatched"
          : "Stock request rejected",
      description:
        finalStatus === "rejected"
          ? `Request ${request.request_no} rejected`
          : `Request ${request.request_no} dispatched via ${transfer.transfer_no}`,
      meta: {
        request_id: request.id,
        request_no: request.request_no,
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        final_status: finalStatus,
        driver_photo_url,
        dispatch_image_urls,
        dispatch_video_url,
        e_way_bill_url,
        dispatched_batches: dispatchedBatches,
      },
      transaction,
    });

    const fromStore = await Store.findOne({
      where: { id: user.organization_id },
      transaction,
    });

    const toStore = await Store.findOne({
      where: { id: request.from_organization_id },
      transaction,
    });

    const challanPdf =
      finalStatus === "rejected"
        ? null
        : await generateDeliveryChallanPdf({
            transfer,
            request,
            fromStore,
            toStore,
            challanItems,
            driver: {
              driver_name,
              driver_phone,
              vehicle_number,
              pickup_address,
              delivery_address,
            },
          });

    if (challanPdf) {
      await transfer.update(
        {
          delivery_challan_url: challanPdf.publicPath,
          delivery_challan_file: challanPdf.fileName,
        },
        { transaction }
      );
    }

    await transaction.commit();

    for (const filePath of uploadedLocalPaths) {
      safeUnlink(filePath);
    }

    if (challanPdf && String(req.query.download_challan || "") === "true") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${challanPdf.fileName}"`
      );

      return res.sendFile(challanPdf.filePath);
    }

    return res.status(200).json({
      success: true,
      message:
        finalStatus === "rejected"
          ? "Request rejected successfully"
          : "Request approved and stock dispatched successfully",
      data: {
        transfer: {
          ...transfer.toJSON(),
          dispatch_image_url: dispatch_image_urls,
          e_way_bill_url,
          delivery_challan_url: challanPdf?.publicPath || null,
          delivery_challan_file: challanPdf?.fileName || null,
        },
        delivery_challan: challanPdf
          ? {
              file_name: challanPdf.fileName,
              url: challanPdf.publicPath,
              download_url: challanPdf.publicPath,
            }
          : null,
        dispatched_batches: dispatchedBatches,
        uploaded_files: {
          driver_photo_url,
          dispatch_image_urls,
          dispatch_video_url,
          e_way_bill_url,
        },
        summary: {
          request_id: request.id,
          request_no: request.request_no,
          total_requested: totalRequested,
          total_approved: totalApproved,
          total_weight: totalWeight,
          estimated_value: estimatedValue,
          final_status: finalStatus,
        },
      },
    });
  } catch (error) {
    await transaction.rollback();

    for (const filePath of uploadedLocalPaths) {
      safeUnlink(filePath);
    }

    console.error("approveAndDispatchRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to approve and dispatch request",
      error: error.message,
    });
  }
};

// ==========================================
// PARENT ORG -> APPROVE & DISPATCH for district
// ==========================================
export const approveAndDispatchRequest = async (req, res) => {
  const transaction = await sequelize.transaction();
  const uploadedLocalPaths = [];
  let challanPdf = null;

  try {
    const { requestId } = req.params;

    const {
      remarks,
      driver_name,
      driver_phone,
      vehicle_number,
      tracking_number,
      pickup_address,
      delivery_address,
      expected_delivery_date,
      expected_delivery_time,
      additional_notes,
    } = req.body;

    const user = req.user;
    const parsedItems = parseItemsFromBody(req.body);

    console.log(
      "approveAndDispatchRequest req.body keys:",
      Object.keys(req.body || {})
    );
    console.log("approveAndDispatchRequest raw items:", req.body?.items);
    console.log("approveAndDispatchRequest parsedItems:", parsedItems);
    console.log("approveAndDispatchRequest files:", {
      driver_photo: req.files?.driver_photo?.length || 0,
      dispatch_images: req.files?.dispatch_images?.length || 0,
      dispatch_video: req.files?.dispatch_video?.length || 0,
      e_way_bill: req.files?.e_way_bill?.length || 0,
    });

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Approved items are required. Send items as JSON string or items[0][item_id], items[0][qty] format.",
      });
    }

    if (!driver_name || !driver_phone || !vehicle_number) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Driver name, driver phone, and vehicle number are required",
      });
    }

    const approvedRows = parsedItems.filter((row) => Number(row.qty || 0) > 0);

    if (approvedRows.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "At least one item must have qty greater than 0 for approval",
      });
    }

    if (!pickup_address || !delivery_address) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Pickup and delivery address are required",
      });
    }

    if (!expected_delivery_date || !expected_delivery_time) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Expected delivery date and time are required",
      });
    }

    const driverPhotoFile = req.files?.driver_photo?.[0] || null;
    const dispatchImageFiles = req.files?.dispatch_images || [];
    const dispatchVideoFile = req.files?.dispatch_video?.[0] || null;
    const eWayBillFile = req.files?.e_way_bill?.[0] || null;

    if (dispatchImageFiles.length > 3) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Maximum 3 dispatch images allowed",
      });
    }

    if (driverPhotoFile?.path) uploadedLocalPaths.push(driverPhotoFile.path);

    for (const file of dispatchImageFiles) {
      if (file?.path) uploadedLocalPaths.push(file.path);
    }

    if (dispatchVideoFile?.path) uploadedLocalPaths.push(dispatchVideoFile.path);
    if (eWayBillFile?.path) uploadedLocalPaths.push(eWayBillFile.path);

    const request = await StockRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!request) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Stock request not found",
      });
    }

    const requestItems = await StockRequestItem.findAll({
      where: { request_id: request.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (Number(request.to_organization_id) !== Number(user.organization_id)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to approve this request",
      });
    }

    if (request.status !== "pending") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only pending request can be approved",
      });
    }

    const existingTransfer = await StockTransfer.findOne({
      where: { request_id: request.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingTransfer) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Transfer already created for this request",
      });
    }

    const requestItemMap = new Map(
      requestItems.map((x) => [Number(x.item_id), x])
    );

    for (const row of parsedItems) {
      const item_id = toNumber(row.item_id);
      const qty = toNumber(row.qty);
      const parent_batch_id = toNumber(row.parent_batch_id || row.batch_id);

      if (!item_id || qty < 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Each item must have valid item_id and qty",
        });
      }

      if (qty > 0 && !parent_batch_id) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `parent_batch_id is required for item ${item_id}`,
        });
      }

      const requestItem = requestItemMap.get(item_id);

      if (!requestItem) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Requested item not found for item_id ${item_id}`,
        });
      }

      const requestedQty = toNumber(requestItem.request_qty);

      if (qty > requestedQty) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Approved qty cannot exceed requested qty for item ${item_id}`,
        });
      }
    }

    let driver_photo_url = null;
    let dispatch_image_urls = [];
    let dispatch_video_url = null;
    let e_way_bill_url = null;

    if (driverPhotoFile?.path) {
      const uploadedDriverPhoto = await uploadToCloudinary(
        driverPhotoFile.path,
        "stock-transfer/driver-photo",
        "image"
      );
      driver_photo_url = uploadedDriverPhoto.secure_url;
    }

    if (dispatchImageFiles.length > 0) {
      for (const file of dispatchImageFiles) {
        const uploadedImage = await uploadToCloudinary(
          file.path,
          "stock-transfer/dispatch-images",
          "image"
        );
        dispatch_image_urls.push(uploadedImage.secure_url);
      }
    }

    if (dispatchVideoFile?.path) {
      const uploadedVideo = await uploadToCloudinary(
        dispatchVideoFile.path,
        "stock-transfer/dispatch-video",
        "video"
      );
      dispatch_video_url = uploadedVideo.secure_url;
    }

    if (eWayBillFile?.path) {
      const isPdf =
        eWayBillFile.mimetype === "application/pdf" ||
        eWayBillFile.originalname?.toLowerCase().endsWith(".pdf");

      const uploadedEWayBill = await uploadToCloudinary(
        eWayBillFile.path,
        "stock-transfer/e-way-bills",
        isPdf ? "raw" : "image"
      );

      e_way_bill_url = uploadedEWayBill.secure_url;
    }

    const transfer = await StockTransfer.create(
      {
        transfer_no: generateTransferNo(),
        request_id: request.id,
        from_organization_id: user.organization_id,
        to_organization_id: request.from_organization_id,
        transfer_date: new Date(),
        dispatch_date: new Date(),
        status: "in_transit",
        approved_by: user.id,
        dispatched_by: user.id,
        created_by: user.id,
        remarks: remarks || null,
        driver_name: driver_name || null,
        driver_phone: driver_phone || null,
        vehicle_number: vehicle_number || null,
        tracking_number: tracking_number || null,
        driver_photo_url: driver_photo_url || null,
        dispatch_image_url:
          dispatch_image_urls.length > 0
            ? JSON.stringify(dispatch_image_urls)
            : null,
        dispatch_video_url: dispatch_video_url || null,
        e_way_bill_url: e_way_bill_url || null,
        pickup_address: pickup_address || null,
        delivery_address: delivery_address || null,
        expected_delivery_date: expected_delivery_date || null,
        expected_delivery_time: expected_delivery_time || null,
        additional_notes: additional_notes || null,
      },
      { transaction }
    );

    let totalRequested = 0;
    let totalApproved = 0;
    let totalWeight = 0;
    let estimatedValue = 0;
    let approvedItemsCount = 0;

    const challanItems = [];
    const dispatchedBatches = [];

    for (const row of parsedItems) {
      const item_id = toNumber(row.item_id);
      const qty = toNumber(row.qty);
      const weight = toNumber(row.weight);
      const rate = toNumber(row.rate);
      const parent_batch_id = toNumber(row.parent_batch_id || row.batch_id);

      const requestItem = requestItemMap.get(item_id);
      const requestedQty = toNumber(requestItem.request_qty);

      totalRequested += requestedQty;
      totalApproved += qty;

      if (qty === 0) {
        await requestItem.update(
          {
            approved_qty: 0,
            approved_weight: 0,
            status: "rejected",
          },
          { transaction }
        );
        continue;
      }

      const itemDetails = await Item.findOne({
        where: {
          id: item_id,
          organization_id: user.organization_id,
          is_active: true,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!itemDetails) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: `Item not found for item_id ${item_id}`,
        });
      }

      const batchRows = await sequelize.query(
        `
        SELECT
          id,
          batch_no,
          item_id,
          organization_id,
          current_organization_id,
          available_qty,
          available_weight,
          status
        FROM public.inventory_batches
        WHERE id = :parent_batch_id
        FOR UPDATE
        `,
        {
          replacements: { parent_batch_id },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      const parentBatch = batchRows?.[0];

      if (!parentBatch) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: `Parent batch not found for item ${item_id}`,
        });
      }

      if (Number(parentBatch.item_id) !== Number(item_id)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Parent batch ${parent_batch_id} does not belong to item ${item_id}`,
        });
      }

      const parentBatchOrgId = Number(
        parentBatch.current_organization_id || parentBatch.organization_id || 0
      );

      if (parentBatchOrgId !== Number(user.organization_id)) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: `Parent batch ${parent_batch_id} does not belong to your organization`,
        });
      }

      if (
        ["sold", "damaged", "dead"].includes(
          String(parentBatch.status || "").toLowerCase()
        )
      ) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: `Parent batch ${parent_batch_id} is already ${parentBatch.status}`,
        });
      }

      if (Number(parentBatch.available_qty || 0) < qty) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: `Insufficient batch qty for item ${item_id}`,
        });
      }

      if (weight > 0 && Number(parentBatch.available_weight || 0) < weight) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: `Insufficient batch weight for item ${item_id}`,
        });
      }

      approvedItemsCount += 1;
      totalWeight += weight;
      estimatedValue += weight * rate;

      const fromStock = await getOrCreateStock(
        user.organization_id,
        item_id,
        transaction
      );

      const availableQty = toNumber(fromStock.available_qty);
      const availableWeight = toNumber(fromStock.available_weight);
      const reservedQty = toNumber(fromStock.reserved_qty);
      const reservedWeight = toNumber(fromStock.reserved_weight);
      const transitQty = toNumber(fromStock.transit_qty);
      const transitWeight = toNumber(fromStock.transit_weight);
      const damagedQty = toNumber(fromStock.damaged_qty);
      const damagedWeight = toNumber(fromStock.damaged_weight);

      if (availableQty < qty) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient available qty for item ${item_id}`,
        });
      }

      if (weight > 0 && availableWeight < weight) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient available weight for item ${item_id}`,
        });
      }

      await StockTransferItem.create(
        {
          transfer_id: transfer.id,
          item_id,
          qty,
          weight,
          rate,
          remarks: row.remarks || null,
        },
        { transaction }
      );

      await requestItem.update(
        {
          approved_qty: qty,
          approved_weight: weight,
          status: qty < requestedQty ? "partially_approved" : "approved",
        },
        { transaction }
      );

      const newAvailableQty = availableQty - qty;
      const newAvailableWeight = availableWeight - weight;
      const newTransitQty = transitQty + qty;
      const newTransitWeight = transitWeight + weight;

      await fromStock.update(
        {
          available_qty: newAvailableQty,
          available_weight: newAvailableWeight,
          transit_qty: newTransitQty,
          transit_weight: newTransitWeight,
        },
        { transaction }
      );

      await createMovement({
        organization_id: user.organization_id,
        item_id,
        movement_type: "dispatch",
        reference_type: "stock_transfer",
        reference_id: transfer.id,
        qty,
        weight,
        stockBefore: {
          available_qty: availableQty,
          reserved_qty: reservedQty,
          transit_qty: transitQty,
          damaged_qty: damagedQty,
          available_weight: availableWeight,
          reserved_weight: reservedWeight,
          transit_weight: transitWeight,
          damaged_weight: damagedWeight,
        },
        stockAfter: {
          available_qty: newAvailableQty,
          reserved_qty: reservedQty,
          transit_qty: newTransitQty,
          damaged_qty: damagedQty,
          available_weight: newAvailableWeight,
          reserved_weight: reservedWeight,
          transit_weight: newTransitWeight,
          damaged_weight: damagedWeight,
        },
        remarks: `Dispatched via ${transfer.transfer_no}`,
        created_by: user.id,
        transaction,
      });

      const childBatch = await InventoryTrackingService.distributeBatch(
        {
          parent_batch_id,
          to_organization_id: request.from_organization_id,
          quantity: qty,
          weight,
          reference_type: "STOCK_TRANSFER",
          reference_id: transfer.id,
          remarks: `Dispatched via ${transfer.transfer_no}`,
          handled_by: user.id,
          batch_status: "in_transit",
        },
        { transaction }
      );

      dispatchedBatches.push({
        item_id,
        parent_batch_id,
        parent_batch_no: parentBatch.batch_no,
        child_batch_id: childBatch.id,
        child_batch_no: childBatch.batch_no,
        dispatched_qty: Number(childBatch.total_qty || 0),
        dispatched_weight: Number(childBatch.total_weight || 0),
        status: childBatch.status,
      });

      challanItems.push({
        item_id,
        item_name: itemDetails.item_name,
        product_code: itemDetails.article_code || itemDetails.sku_code,
        hsn_code: itemDetails.hsn_code,
        purity: itemDetails.purity,
        qty,
        weight,
        rate,
        making_charge: itemDetails.making_charge || 0,
        huid_code: itemDetails.huid_code || "-",
        base_value: weight > 0 ? weight * rate : qty * rate,
      });
    }

    let finalStatus = "approved";

    if (approvedItemsCount === 0) {
      finalStatus = "rejected";
    } else if (totalApproved < totalRequested) {
      finalStatus = "partially_approved";
    }

    await request.update(
      {
        status: finalStatus,
        approved_by: user.id,
        approved_at: new Date(),
      },
      { transaction }
    );

    await Task.update(
      { status: finalStatus },
      {
        where: {
          task_type: "stock_request_approval",
          reference_id: request.id,
        },
        transaction,
      }
    );

    await SystemActivity.create(
      {
        title:
          finalStatus === "approved"
            ? "Stock request approved and dispatched"
            : finalStatus === "partially_approved"
            ? "Stock request partially approved and dispatched"
            : "Stock request rejected",
        description:
          finalStatus === "rejected"
            ? `Request ${request.request_no} was rejected by receiving organization`
            : `Request ${request.request_no} processed via ${transfer.transfer_no}`,
        activity_type: "stock_request_dispatch",
        module_name: "stock_transfer",
        reference_id: transfer.id,
        reference_no: transfer.transfer_no,
        district_code: request.to_district_code || null,
        store_code: request.from_store_code || null,
        store_name: request.from_store_name || null,
        created_by: user.id,
        created_at: new Date(),
      },
      { transaction }
    );

    await createActivity({
      user_id: user.id,
      action: "stock_request_dispatch",
      title:
        finalStatus === "approved"
          ? "Stock request approved and dispatched"
          : finalStatus === "partially_approved"
          ? "Stock request partially approved and dispatched"
          : "Stock request rejected",
      description:
        finalStatus === "rejected"
          ? `Request ${request.request_no} rejected`
          : `Request ${request.request_no} dispatched via ${transfer.transfer_no}`,
      meta: {
        request_id: request.id,
        request_no: request.request_no,
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        final_status: finalStatus,
        driver_photo_url,
        dispatch_image_urls,
        dispatch_video_url,
        e_way_bill_url,
        dispatched_batches: dispatchedBatches,
      },
      transaction,
    });

    if (finalStatus !== "rejected") {
      const fromStore = await Store.findOne({
        where: { id: user.organization_id },
        transaction,
      });

      const toStore = await Store.findOne({
        where: { id: request.from_organization_id },
        transaction,
      });

      challanPdf = await generateDeliveryChallanPdf({
        transfer,
        request,
        fromStore,
        toStore,
        challanItems,
        driver: {
          driver_name,
          driver_phone,
          vehicle_number,
          pickup_address,
          delivery_address,
        },
      });
    }

    await transaction.commit();

    for (const filePath of uploadedLocalPaths) {
      safeUnlink(filePath);
    }

    if (challanPdf && String(req.query.download_challan || "") === "true") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${challanPdf.fileName}"`
      );

      return res.sendFile(challanPdf.filePath);
    }

    return res.status(200).json({
      success: true,
      message:
        finalStatus === "rejected"
          ? "Request rejected successfully"
          : "Request approved and stock dispatched successfully",
      data: {
        transfer: {
          ...transfer.toJSON(),
          dispatch_image_url: dispatch_image_urls,
          e_way_bill_url,
        },
        uploaded_files: {
          driver_photo_url,
          dispatch_image_urls,
          dispatch_video_url,
          e_way_bill_url,
        },
        summary: {
          request_id: request.id,
          request_no: request.request_no,
          total_requested: totalRequested,
          total_approved: totalApproved,
          total_weight: totalWeight,
          estimated_value: estimatedValue,
          final_status: finalStatus,
        },
      },
    });
  } catch (error) {
    await transaction.rollback();

    for (const filePath of uploadedLocalPaths) {
      safeUnlink(filePath);
    }

    console.error("approveAndDispatchRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to approve and dispatch request",
      error: error.message,
    });
  }
};




// ==========================================
// STORE -> RECEIVE TRANSFER
// ==========================================

export const receiveTransfer = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { transferId } = req.params;
    const { remarks } = req.body;
    const user = req.user;

    if (!user?.id || !user?.organization_id) {
      await transaction.rollback();

      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const receiverStoreCode = String(
      user.store_code || user.storeCode || ""
    )
      .trim()
      .toUpperCase();

    if (!receiverStoreCode) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Receiver store code is missing",
      });
    }

    // =====================================================
    // FETCH AND LOCK TRANSFER
    // =====================================================

    const transfer = await StockTransfer.findByPk(transferId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!transfer) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    // =====================================================
    // RECEIVER VALIDATION
    // =====================================================

    if (
      Number(transfer.to_organization_id) !==
      Number(user.organization_id)
    ) {
      await transaction.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not allowed to receive this transfer",
      });
    }

    if (
      String(transfer.status || "").toLowerCase() !==
      "in_transit"
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Only in_transit transfer can be received",
      });
    }

    // =====================================================
    // FETCH TRANSFER ITEMS
    // =====================================================

    const transferItems = await StockTransferItem.findAll({
      where: {
        transfer_id: transfer.id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!transferItems.length) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "No items found in this transfer",
      });
    }

    const receivedItems = [];

    // =====================================================
    // PROCESS EACH TRANSFER ITEM
    // =====================================================

    for (const trItem of transferItems) {
      const itemId = Number(trItem.item_id);
      const qty = toNumber(trItem.qty);
      const weight = toNumber(trItem.weight);

      if (!itemId) {
        throw new Error(
          `Invalid item_id found in transfer item ${trItem.id}`
        );
      }

      if (qty <= 0 && weight <= 0) {
        throw new Error(
          `Invalid transfer quantity for item ${itemId}`
        );
      }

      // ===================================================
      // VERIFY ITEM
      // ===================================================

      const item = await Item.findByPk(itemId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!item) {
        throw new Error(`Item not found for item_id ${itemId}`);
      }

      // ===================================================
      // SOURCE STOCK
      // Source ki transit quantity clear hogi
      // ===================================================

      const sourceStock = await getOrCreateStock(
        transfer.from_organization_id,
        itemId,
        transaction
      );

      const sourceTransitQty = toNumber(
        sourceStock.transit_qty
      );

      const sourceTransitWeight = toNumber(
        sourceStock.transit_weight
      );

      if (sourceTransitQty < qty) {
        throw new Error(
          `Insufficient transit quantity for item ${itemId}. ` +
            `Transit: ${sourceTransitQty}, Receiving: ${qty}`
        );
      }

      if (
        weight > 0 &&
        sourceTransitWeight < weight
      ) {
        throw new Error(
          `Insufficient transit weight for item ${itemId}. ` +
            `Transit weight: ${sourceTransitWeight}, Receiving: ${weight}`
        );
      }

      const sourceBefore = {
        available_qty: toNumber(
          sourceStock.available_qty
        ),

        reserved_qty: toNumber(
          sourceStock.reserved_qty
        ),

        transit_qty: sourceTransitQty,

        damaged_qty: toNumber(
          sourceStock.damaged_qty
        ),

        available_weight: toNumber(
          sourceStock.available_weight
        ),

        reserved_weight: toNumber(
          sourceStock.reserved_weight
        ),

        transit_weight: sourceTransitWeight,

        damaged_weight: toNumber(
          sourceStock.damaged_weight
        ),
      };

      await sourceStock.update(
        {
          transit_qty: Math.max(
            0,
            sourceTransitQty - qty
          ),

          transit_weight: Math.max(
            0,
            sourceTransitWeight - weight
          ),
        },
        {
          transaction,
        }
      );

      await sourceStock.reload({
        transaction,
      });

      const sourceAfter = {
        available_qty: toNumber(
          sourceStock.available_qty
        ),

        reserved_qty: toNumber(
          sourceStock.reserved_qty
        ),

        transit_qty: toNumber(
          sourceStock.transit_qty
        ),

        damaged_qty: toNumber(
          sourceStock.damaged_qty
        ),

        available_weight: toNumber(
          sourceStock.available_weight
        ),

        reserved_weight: toNumber(
          sourceStock.reserved_weight
        ),

        transit_weight: toNumber(
          sourceStock.transit_weight
        ),

        damaged_weight: toNumber(
          sourceStock.damaged_weight
        ),
      };

      await createMovement({
        organization_id:
          transfer.from_organization_id,

        item_id: itemId,

        movement_type: "dispatch",

        reference_type:
          "stock_transfer_transit_clear",

        reference_id: transfer.id,

        qty: 0,

        weight: 0,

        stockBefore: sourceBefore,

        stockAfter: sourceAfter,

        remarks:
          `Transit cleared after receive for ` +
          `${transfer.transfer_no}`,

        created_by: user.id,

        transaction,
      });

      // ===================================================
      // DESTINATION STOCK
      //
      // Important:
      // Same item_id destination stock me use hoga.
      // Inventory visibility stocks.store_code se hogi.
      // ===================================================

      const destinationStock =
        await getOrCreateStock(
          transfer.to_organization_id,
          itemId,
          transaction,
          receiverStoreCode
        );

      const destinationBefore = {
        available_qty: toNumber(
          destinationStock.available_qty
        ),

        reserved_qty: toNumber(
          destinationStock.reserved_qty
        ),

        transit_qty: toNumber(
          destinationStock.transit_qty
        ),

        damaged_qty: toNumber(
          destinationStock.damaged_qty
        ),

        available_weight: toNumber(
          destinationStock.available_weight
        ),

        reserved_weight: toNumber(
          destinationStock.reserved_weight
        ),

        transit_weight: toNumber(
          destinationStock.transit_weight
        ),

        damaged_weight: toNumber(
          destinationStock.damaged_weight
        ),
      };

      await destinationStock.update(
        {
          available_qty:
            toNumber(
              destinationStock.available_qty
            ) + qty,

          available_weight:
            toNumber(
              destinationStock.available_weight
            ) + weight,

          store_code: receiverStoreCode,

          organization_id:
            transfer.to_organization_id,
        },
        {
          transaction,
        }
      );

      await destinationStock.reload({
        transaction,
      });

      const destinationAfter = {
        available_qty: toNumber(
          destinationStock.available_qty
        ),

        reserved_qty: toNumber(
          destinationStock.reserved_qty
        ),

        transit_qty: toNumber(
          destinationStock.transit_qty
        ),

        damaged_qty: toNumber(
          destinationStock.damaged_qty
        ),

        available_weight: toNumber(
          destinationStock.available_weight
        ),

        reserved_weight: toNumber(
          destinationStock.reserved_weight
        ),

        transit_weight: toNumber(
          destinationStock.transit_weight
        ),

        damaged_weight: toNumber(
          destinationStock.damaged_weight
        ),
      };

      // ===================================================
      // IMPORTANT ITEM FIX
      //
      // organization_id aur storeCode change nahi karenge.
      // Ek item multiple stores ke stock me ho sakta hai.
      // Store ownership stocks table decide karegi.
      // ===================================================

      const totalItemStockResult =
        await Stock.findAll({
          where: {
            item_id: itemId,
          },

          attributes: [
            "available_qty",
            "reserved_qty",
            "transit_qty",
          ],

          transaction,
        });

      const totalAvailableQty =
        totalItemStockResult.reduce(
          (sum, stock) =>
            sum +
            toNumber(stock.available_qty),
          0
        );

      const totalReservedQty =
        totalItemStockResult.reduce(
          (sum, stock) =>
            sum +
            toNumber(stock.reserved_qty),
          0
        );

      const totalTransitQty =
        totalItemStockResult.reduce(
          (sum, stock) =>
            sum +
            toNumber(stock.transit_qty),
          0
        );

      const totalActiveQty =
        totalAvailableQty +
        totalReservedQty +
        totalTransitQty;

      await item.update(
        {
          current_status:
            totalActiveQty > 0
              ? "in_stock"
              : "sold",
        },
        {
          transaction,
        }
      );

      // ===================================================
      // BATCH UPDATE
      //
      // Sirf transferred batch update karna best hai.
      // Agar transfer item me batch_id available hai to wahi use hoga.
      // ===================================================

      const transferBatchId =
        trItem.batch_id ||
        trItem.inventory_batch_id ||
        null;

      if (transferBatchId) {
        await InventoryBatch.update(
          {
            current_organization_id:
              transfer.to_organization_id,

            status: "delivered",
          },
          {
            where: {
              id: transferBatchId,
              item_id: itemId,
            },
            transaction,
          }
        );
      } else {
        /*
         * Fallback:
         * Agar transfer item me batch_id store nahi ho raha,
         * to active in_transit batch update hoga.
         *
         * Sabhi batches ko item_id se update nahi karna,
         * warna source ke purane batches bhi destination me shift ho jayenge.
         */

        const inTransitBatch =
          await InventoryBatch.findOne({
            where: {
              item_id: itemId,
              status: "in_transit",
            },

            order: [["id", "DESC"]],

            transaction,
            lock: transaction.LOCK.UPDATE,
          });

        if (inTransitBatch) {
          await inTransitBatch.update(
            {
              current_organization_id:
                transfer.to_organization_id,

              status: "delivered",
            },
            {
              transaction,
            }
          );
        }
      }

      // ===================================================
      // DESTINATION MOVEMENT
      // ===================================================

      await createMovement({
        organization_id:
          transfer.to_organization_id,

        item_id: itemId,

        movement_type: "receive",

        reference_type: "stock_transfer",

        reference_id: transfer.id,

        qty,

        weight,

        stockBefore: destinationBefore,

        stockAfter: destinationAfter,

        remarks:
          `Received via ${transfer.transfer_no}`,

        created_by: user.id,

        transaction,
      });

      receivedItems.push({
        transfer_item_id: trItem.id,
        item_id: itemId,
        item_name: item.item_name,
        article_code: item.article_code,
        sku_code: item.sku_code,
        received_qty: qty,
        received_weight: weight,
        destination_available_qty:
          destinationAfter.available_qty,
        destination_available_weight:
          destinationAfter.available_weight,
        store_code: receiverStoreCode,
      });
    }

    // =====================================================
    // UPDATE TRANSFER
    // =====================================================

    await transfer.update(
      {
        receive_date: new Date(),

        status: "received",

        received_by: user.id,

        remarks:
          remarks || transfer.remarks,
      },
      {
        transaction,
      }
    );

    // =====================================================
    // UPDATE REQUEST
    // =====================================================

    if (transfer.request_id) {
      const request =
        await StockRequest.findByPk(
          transfer.request_id,
          {
            transaction,
            lock: transaction.LOCK.UPDATE,
          }
        );

      if (request) {
        await request.update(
          {
            status: "completed",
          },
          {
            transaction,
          }
        );
      }
    }

    // =====================================================
    // SYSTEM ACTIVITY
    // =====================================================

    await SystemActivity.create(
      {
        title: "Stock transfer received",

        description:
          `Transfer ${transfer.transfer_no} ` +
          `received successfully`,

        activity_type:
          "stock_transfer_received",

        module_name: "stock_transfer",

        reference_id: transfer.id,

        reference_no:
          transfer.transfer_no,

        district_code:
          user.district_code || null,

        store_code:
          receiverStoreCode,

        store_name:
          user.store_name || null,

        created_by: user.id,

        created_at: new Date(),
      },
      {
        transaction,
      }
    );

    // =====================================================
    // ACTIVITY LOG
    // =====================================================

    await ActivityLog.create(
      {
        organization_id:
          user.organization_id || null,

        user_id: user.id,

        action:
          "stock_transfer_received",

        module_name: "stock_transfer",

        reference_id: transfer.id,

        reference_no:
          transfer.transfer_no,

        title: "Stock transfer received",

        description:
          `Transfer ${transfer.transfer_no} ` +
          `received successfully`,

        meta: {
          transfer_id: transfer.id,

          transfer_no:
            transfer.transfer_no,

          from_organization_id:
            transfer.from_organization_id,

          to_organization_id:
            transfer.to_organization_id,

          store_code:
            receiverStoreCode,

          status: "received",

          remarks: remarks || null,

          received_items:
            receivedItems,
        },

        icon: "activity",

        color: "green",
      },
      {
        transaction,
      }
    );

    await transaction.commit();

    // Updated transfer response
    const updatedTransfer =
      await StockTransfer.findByPk(
        transfer.id,
        {
          include: [
            {
              model: StockTransferItem,
              as: "items",
              required: false,
            },
          ],
        }
      );

    return res.status(200).json({
      success: true,

      message:
        "Stock received successfully",

      data: {
        transfer: updatedTransfer,
        received_items: receivedItems,
      },
    });
  } catch (error) {
    if (
      transaction &&
      !transaction.finished
    ) {
      await transaction.rollback();
    }

    console.error(
      "receiveTransfer error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to receive transfer",

      error: error.message,
    });
  }
};


const pickStoreName = (store) => {
  if (!store) return null;

  return (
    store.store_name ||
    store.storeName ||
    store.organization_name ||
    store.organizationName ||
    store.district_name ||
    store.districtName ||
    store.name ||
    store.store_code ||
    store.storeCode ||
    null
  );
};

const pickUserName = (user) => {
  if (!user) return null;

  return (
    user.username ||
    user.name ||
    user.full_name ||
    user.fullName ||
    user.email ||
    null
  );
};

const buildDeliveryDetails = (plain, storeMap) => {
  const toStore = storeMap?.get(
    Number(plain.to_organization_id)
  );

  const lat =
    plain.delivery_latitude ||
    toStore?.latitude ||
    null;

  const lng =
    plain.delivery_longitude ||
    toStore?.longitude ||
    null;

  return {
    delivery_address:
      plain.delivery_address ||
      toStore?.address ||
      toStore?.store_address ||
      null,

    latitude: lat,
    longitude: lng,

    destination_name:
      toStore?.store_name ||
      toStore?.organization_name ||
      null,

    google_map_url:
      lat && lng
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : null,
  };
};

const buildTransferResponse = (
  transfers,
  storeMap,
  userMap,
  complaintMap = new Map()
) => {
  return transfers.map((t) => {
    const plain =
      typeof t.toJSON === "function"
        ? t.toJSON()
        : t;

    const complaint =
      complaintMap.get(Number(plain.id)) ||
      null;

    return {
      id: plain.id,

      transfer_no: plain.transfer_no,

      tracking_number:
        plain.tracking_number ||
        plain.transfer_no,

      request_id:
        plain.request_id,

      from_organization_id:
        plain.from_organization_id,

      from_organization_name:
        pickStoreName(
          storeMap.get(
            Number(
              plain.from_organization_id
            )
          )
        ) || null,

      to_organization_id:
        plain.to_organization_id,

      to_organization_name:
        pickStoreName(
          storeMap.get(
            Number(
              plain.to_organization_id
            )
          )
        ) || null,

      delivery_details:
        buildDeliveryDetails(
          plain,
          storeMap
        ),

      transfer_date:
        plain.transfer_date,

      dispatch_date:
        plain.dispatch_date,

      receive_date:
        plain.receive_date,

      expected_delivery_date:
        plain.expected_delivery_date ||
        null,

      expected_delivery_time:
        plain.expected_delivery_time ||
        null,

      status:
        plain.status,

      remarks:
        plain.remarks,

      approved_by:
        plain.approved_by,

      approved_by_name:
        pickUserName(
          userMap.get(
            Number(
              plain.approved_by
            )
          )
        ) || null,

      dispatched_by:
        plain.dispatched_by,

      dispatched_by_name:
        pickUserName(
          userMap.get(
            Number(
              plain.dispatched_by
            )
          )
        ) || null,

      received_by:
        plain.received_by,

      received_by_name:
        pickUserName(
          userMap.get(
            Number(
              plain.received_by
            )
          )
        ) || null,

      created_by:
        plain.created_by,

      created_by_name:
        pickUserName(
          userMap.get(
            Number(
              plain.created_by
            )
          )
        ) || null,

      driver_details: {
        driver_name:
          plain.driver_name ||
          null,

        driver_phone:
          plain.driver_phone ||
          null,

        vehicle_number:
          plain.vehicle_number ||
          null,

        tracking_number:
          plain.tracking_number ||
          null,

        driver_photo_url:
          plain.driver_photo_url ||
          null,
      },

      media: {
        dispatch_image_url:
          plain.dispatch_image_url ||
          null,

        dispatch_video_url:
          plain.dispatch_video_url ||
          null,

        receive_image_url:
          plain.receive_image_url ||
          null,

        e_way_bill_url:
          plain.e_way_bill_url ||
          null,
      },

      // ===================================================
      // COMPLAINT DETAILS
      // ===================================================

      complaint: complaint
        ? {
            complaint_exists: true,

            complaint_id:
              complaint.id,

            complaint_no:
              complaint.complaint_no,

            complaint_type:
              complaint.complaint_type,

            complaint_status:
              complaint.status,

            complaint_created_at:
              complaint.created_at,
          }
        : {
            complaint_exists:
              false,

            complaint_id:
              null,

            complaint_no:
              null,

            complaint_type:
              null,

            complaint_status:
              null,

            complaint_created_at:
              null,
          },

      created_at:
        plain.created_at,

      updated_at:
        plain.updated_at,

      transfer_items:
        plain.transfer_items ||
        [],
    };
  });
};

const buildTransferSummary = (transfers = []) => {
  let inTransit = 0;
  let shipments = 0;
  let goodsReceipt = 0;

  for (const row of transfers) {
    const status = String(row.status || "").toLowerCase();

    if (["approved", "dispatched", "in_transit"].includes(status)) {
      inTransit += 1;
    }

    if (["approved", "dispatched", "in_transit", "received"].includes(status)) {
      shipments += 1;
    }

    if (status === "received") {
      goodsReceipt += 1;
    }
  }

  return {
    in_transit: inTransit,
    shipments,
    goods_receipt: goodsReceipt,
  };
};

const loadTransferMeta = async (transfers = []) => {
  const orgIds = [
    ...new Set(
      transfers
        .flatMap((t) => [
          Number(t.from_organization_id || 0),
          Number(t.to_organization_id || 0),
        ])
        .filter(Boolean)
    ),
  ];

  const userIds = [
    ...new Set(
      transfers
        .flatMap((t) => [
          Number(t.created_by || 0),
          Number(t.approved_by || 0),
          Number(t.dispatched_by || 0),
          Number(t.received_by || 0),
        ])
        .filter(Boolean)
    ),
  ];

  const stores = orgIds.length
    ? await Store.findAll({
        where: { id: { [Op.in]: orgIds } },
      })
    : [];

  const users = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ["id", "username", "email"],
      })
    : [];

  return {
    storeMap: new Map(stores.map((s) => [Number(s.id), s])),
    userMap: new Map(users.map((u) => [Number(u.id), u])),
  };
};

// ==========================================
// INCOMING TRANSFERS


/* =====================================================
   COMMON HELPERS
===================================================== */

const normalizeRole = (role = "") =>
  String(role || "").trim().toLowerCase();

const normalizeLevel = (level = "") =>
  String(level || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const normalizeStatus = (status = "") =>
  String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const TRANSFER_STATUS = Object.freeze({
  APPROVED: "approved",
  DISPATCHED: "dispatched",
  IN_TRANSIT: "in_transit",
  RECEIVED: "received",
});

const ACTIVE_TRANSFER_STATUSES = Object.freeze([
  TRANSFER_STATUS.APPROVED,
  TRANSFER_STATUS.DISPATCHED,
  TRANSFER_STATUS.IN_TRANSIT,
  TRANSFER_STATUS.RECEIVED,
]);

const SHIPMENT_STATUSES = Object.freeze([
  TRANSFER_STATUS.APPROVED,
  TRANSFER_STATUS.DISPATCHED,
]);

const IN_TRANSIT_STATUSES = Object.freeze([
  TRANSFER_STATUS.IN_TRANSIT,
]);

const GOODS_RECEIPT_STATUSES = Object.freeze([
  TRANSFER_STATUS.RECEIVED,
]);

const RECEIVED_STATUSES = Object.freeze([
  TRANSFER_STATUS.RECEIVED,
]);

const getCurrentOrganizationId = (user) => {
  const id =
    user?.organization_id ||
    user?.organizationId;

  const parsed = Number(id);

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : null;
};

const getPositiveNumber = (value) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : null;
};

/* =====================================================
   ACCESS HELPERS
===================================================== */

/**
 * ONLY SUPER ADMIN SHOULD HAVE GLOBAL ACCESS
 */
const isGlobalUser = (user) => {
  const role = normalizeRole(user?.role);

  return ["super_admin"].includes(role);
};

const isHeadUser = (user) => {
  const level = normalizeLevel(
    user?.organization_level
  );

  return [
    "head",
    "head_office",
    "corporate",
  ].includes(level);
};

const isDistrictUser = (user) => {
  const level = normalizeLevel(
    user?.organization_level
  );

  return [
    "district",
    "district_office",
    "district_admin",
  ].includes(level);
};

const isRetailUser = (user) => {
  const level = normalizeLevel(
    user?.organization_level
  );

  return [
    "retail",
    "store",
    "store_admin",
    "branch",
  ].includes(level);
};

const getRequestedStoreId = (
  query = {},
  direction = "incoming"
) => {
  if (direction === "outgoing") {
    return (
      getPositiveNumber(query.store_id) ||
      getPositiveNumber(
        query.organization_id
      ) ||
      getPositiveNumber(
        query.from_organization_id
      )
    );
  }

  return (
    getPositiveNumber(query.store_id) ||
    getPositiveNumber(
      query.organization_id
    ) ||
    getPositiveNumber(
      query.to_organization_id
    )
  );
};

/* =====================================================
   SUMMARY BUILDER
===================================================== */

const buildCardSummary = (
  transfers = [],
  totalKey = "incoming"
) => {
  const summary = {
    [totalKey]: 0,

    in_transit: 0,
    shipment: 0,
    goods_receipt: 0,

    pending_receive: 0,
    received: 0,

    totalIncoming: 0,
    totalOutgoing: 0,
    inTransit: 0,
    shipments: 0,
    goodsReceipt: 0,
    pendingReceive: 0,
    receivedTransfers: 0,
  };

  for (const transfer of transfers) {
    const status = normalizeStatus(
      transfer?.status
    );

    if (
      !ACTIVE_TRANSFER_STATUSES.includes(
        status
      )
    ) {
      continue;
    }

    summary[totalKey] += 1;

    if (
      IN_TRANSIT_STATUSES.includes(status)
    ) {
      summary.in_transit += 1;
    }

    if (
      SHIPMENT_STATUSES.includes(status)
    ) {
      summary.shipment += 1;
    }

    if (
      GOODS_RECEIPT_STATUSES.includes(
        status
      )
    ) {
      summary.goods_receipt += 1;
      summary.received += 1;
    }

    if (
      !RECEIVED_STATUSES.includes(status)
    ) {
      summary.pending_receive += 1;
    }
  }

  summary.totalIncoming =
    totalKey === "incoming"
      ? summary.incoming
      : 0;

  summary.totalOutgoing =
    totalKey === "outgoing"
      ? summary.outgoing
      : 0;

  summary.inTransit =
    summary.in_transit;

  summary.shipments =
    summary.shipment;

  summary.goodsReceipt =
    summary.goods_receipt;

  summary.pendingReceive =
    summary.pending_receive;

  summary.receivedTransfers =
    summary.received;

  return summary;
};

/* =====================================================
   INCOMING HELPERS
===================================================== */

const getIncomingTransferWhereCondition = (
  user,
  query = {}
) => {
  const loginOrganizationId =
    getCurrentOrganizationId(user);

  const requestedStoreId =
    getRequestedStoreId(
      query,
      "incoming"
    );

  if (
    !loginOrganizationId &&
    !isGlobalUser(user)
  ) {
    return { id: null };
  }

  const where = {};

  /**
   * SUPER ADMIN
   * Can see everything
   */
  if (isGlobalUser(user)) {
    if (requestedStoreId) {
      where.to_organization_id =
        requestedStoreId;
    }

    return where;
  }

  /**
   * HEAD OFFICE
   * Can see all
   * Optional filter support
   */
  if (isHeadUser(user)) {
    if (requestedStoreId) {
      where.to_organization_id =
        requestedStoreId;
    }

    return where;
  }

  /**
   * DISTRICT USER
   * Only own organization
   */
  if (isDistrictUser(user)) {
    where.to_organization_id =
      loginOrganizationId;

    /**
     * Prevent URL tampering
     */
    if (
      requestedStoreId &&
      requestedStoreId !==
        loginOrganizationId
    ) {
      return { id: null };
    }

    return where;
  }

  /**
   * RETAIL USER
   * Only own organization
   */
  if (isRetailUser(user)) {
    where.to_organization_id =
      loginOrganizationId;

    /**
     * Prevent URL tampering
     */
    if (
      requestedStoreId &&
      requestedStoreId !==
        loginOrganizationId
    ) {
      return { id: null };
    }

    return where;
  }

  /**
   * Fallback security
   */
  where.to_organization_id =
    loginOrganizationId;

  return where;
};

const getIncomingListWhereCondition = (
  user,
  query = {}
) => {
  const where =
    getIncomingTransferWhereCondition(
      user,
      query
    );

  const status = normalizeStatus(
    query?.status
  );

  if (status) {
    where.status = status;
  } else {
    where.status = {
      [Op.in]:
        ACTIVE_TRANSFER_STATUSES,
    };
  }

  return where;
};

/* =====================================================
   OUTGOING HELPERS
===================================================== */

const getOutgoingTransferWhereCondition = (
  user,
  query = {}
) => {
  const loginOrganizationId =
    getCurrentOrganizationId(user);

  const requestedStoreId =
    getRequestedStoreId(
      query,
      "outgoing"
    );

  if (
    !loginOrganizationId &&
    !isGlobalUser(user)
  ) {
    return { id: null };
  }

  const where = {};

  /**
   * SUPER ADMIN
   */
  if (isGlobalUser(user)) {
    if (requestedStoreId) {
      where.from_organization_id =
        requestedStoreId;
    }

    return where;
  }

  /**
   * HEAD OFFICE
   * Can see all
   */
  if (isHeadUser(user)) {
    if (requestedStoreId) {
      where.from_organization_id =
        requestedStoreId;
    }

    return where;
  }

  /**
   * DISTRICT USER
   */
  if (isDistrictUser(user)) {
    where.from_organization_id =
      loginOrganizationId;

    if (
      requestedStoreId &&
      requestedStoreId !==
        loginOrganizationId
    ) {
      return { id: null };
    }

    return where;
  }

  /**
   * RETAIL USER
   */
  if (isRetailUser(user)) {
    where.from_organization_id =
      loginOrganizationId;

    if (
      requestedStoreId &&
      requestedStoreId !==
        loginOrganizationId
    ) {
      return { id: null };
    }

    return where;
  }

  /**
   * Fallback security
   */
  where.from_organization_id =
    loginOrganizationId;

  return where;
};

const getOutgoingListWhereCondition = (
  user,
  query = {}
) => {
  const where =
    getOutgoingTransferWhereCondition(
      user,
      query
    );

  const status = normalizeStatus(
    query?.status
  );

  if (status) {
    where.status = status;
  } else {
    where.status = {
      [Op.in]:
        ACTIVE_TRANSFER_STATUSES,
    };
  }

  return where;
};
/* =====================================================
   INCOMING TRANSFERS
===================================================== */

export const getIncomingTransfers = async (
  req,
  res
) => {
  try {
    const user = req.user;

    // =====================================================
    // AUTHORIZATION
    // =====================================================

    if (
      !user?.organization_id &&
      !user?.organizationId &&
      !isGlobalUser(user)
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    // =====================================================
    // FILTERS
    // =====================================================

    const listWhere =
      getIncomingListWhereCondition(
        user,
        req.query
      );

    const summaryWhere =
      getIncomingTransferWhereCondition(
        user,
        req.query
      );

    summaryWhere.status = {
      [Op.in]:
        ACTIVE_TRANSFER_STATUSES,
    };

    // =====================================================
    // FETCH TRANSFERS
    // =====================================================

    const [
      transfers,
      summaryTransfers,
    ] = await Promise.all([
      StockTransfer.findAll({
        where: listWhere,

        include: [
          {
            model: StockTransferItem,
            as: "transfer_items",
            required: false,
          },
        ],

        order: [
          ["created_at", "DESC"],
        ],
      }),

      StockTransfer.findAll({
        where: summaryWhere,

        attributes: [
          "id",
          "status",
          "from_organization_id",
          "to_organization_id",
          "created_at",
        ],

        order: [
          ["created_at", "DESC"],
        ],
      }),
    ]);

    // =====================================================
    // LOAD STORE & USER META
    // =====================================================

    const { storeMap, userMap } =
      await loadTransferMeta(
        transfers
      );

    // =====================================================
    // LOAD COMPLAINTS
    // =====================================================

    const transferIds =
      transfers
        .map((transfer) =>
          Number(transfer.id)
        )
        .filter(Boolean);

    let complaintMap =
      new Map();

    if (transferIds.length) {
      const complaints =
        await StockTransferComplaint.findAll(
          {
            where: {
              transfer_id: {
                [Op.in]:
                  transferIds,
              },
            },

            attributes: [
              "id",
              "transfer_id",
              "complaint_no",
              "complaint_type",
              "status",
              "created_at",
            ],

            order: [
              [
                "created_at",
                "DESC",
              ],
            ],

            raw: true,
          }
        );

      complaintMap =
        new Map();

      for (const complaint of complaints) {
        const transferId =
          Number(
            complaint.transfer_id
          );

        /**
         * Agar multiple complaints hain
         * toh latest complaint hi lenge.
         */

        if (
          !complaintMap.has(
            transferId
          )
        ) {
          complaintMap.set(
            transferId,
            complaint
          );
        }
      }
    }

    // =====================================================
    // BUILD RESPONSE
    // =====================================================

    const responseData =
      buildTransferResponse(
        transfers,
        storeMap,
        userMap,
        complaintMap
      );

    // =====================================================
    // ADD DIRECTION
    // =====================================================

    const data =
      addTransferDirection(
        responseData,
        user
      );

    // =====================================================
    // SUMMARY
    // =====================================================

    const summary =
      buildCardSummary(
        summaryTransfers,
        "incoming"
      );

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      summary,

      count:
        summary.incoming,

      data,
    });
  } catch (error) {
    console.error(
      "getIncomingTransfers error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to fetch incoming transfers",

      error:
        error.message,
    });
  }
};

/* =====================================================
   OUTGOING TRANSFERS
===================================================== */

export const getOutgoingTransfers = async (
  req,
  res
) => {
  try {
    const user = req.user;

    if (
      !user?.organization_id &&
      !user?.organizationId &&
      !isGlobalUser(user)
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const listWhere =
      getOutgoingListWhereCondition(
        user,
        req.query
      );

    const summaryWhere =
      getOutgoingTransferWhereCondition(
        user,
        req.query
      );

    summaryWhere.status = {
      [Op.in]:
        ACTIVE_TRANSFER_STATUSES,
    };

    const [
      transfers,
      summaryTransfers,
    ] = await Promise.all([
      StockTransfer.findAll({
        where: listWhere,

        include: [
          {
            model: StockTransferItem,
            as: "transfer_items",
            required: false,
          },
        ],

        order: [
          ["created_at", "DESC"],
        ],
      }),

      StockTransfer.findAll({
        where: summaryWhere,

        attributes: [
          "id",
          "status",
          "from_organization_id",
          "to_organization_id",
          "created_at",
        ],

        order: [
          ["created_at", "DESC"],
        ],
      }),
    ]);

    const { storeMap, userMap } =
      await loadTransferMeta(
        transfers
      );

    const responseData =
      buildTransferResponse(
        transfers,
        storeMap,
        userMap
      );

    const data =
      addTransferDirection(
        responseData,
        user
      );

    const summary =
      buildCardSummary(
        summaryTransfers,
        "outgoing"
      );

    return res.status(200).json({
      success: true,
      summary,
      count: summary.outgoing,
      data,
      
    });
  } catch (error) {
    console.error(
      "getOutgoingTransfers error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch outgoing transfers",
      error: error.message,
    });
  }
};
// ==========================================
// SINGLE TRANSFER DETAILS
// ==========================================
export const getTransferDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const transfer = await StockTransfer.findByPk(id, {
      include: [
        {
          model: StockTransferItem,
          as: "transfer_items",
          include: [
            {
              model: Item,
              as: "item",
              attributes: [
                "id",
                "item_name",
                "article_code",
                "category",
                "sale_rate",
                "gross_weight",
                "net_weight",
              ],
            },
          ],
        },
      ],
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    const plainTransfer = transfer.get({ plain: true });

    if (
      Number(user.organization_id) !== Number(plainTransfer.from_organization_id) &&
      Number(user.organization_id) !== Number(plainTransfer.to_organization_id) &&
      String(user.role || "").toLowerCase() !== "super_admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this transfer",
      });
    }

    const stores = await Store.findAll({
      where: {
        id: {
          [Op.in]: [
            Number(plainTransfer.from_organization_id),
            Number(plainTransfer.to_organization_id),
          ],
        },
      },
    });

    const storeMap = new Map(stores.map((s) => [Number(s.id), s]));

    const userIds = [
      Number(plainTransfer.created_by || 0),
      Number(plainTransfer.approved_by || 0),
      Number(plainTransfer.dispatched_by || 0),
      Number(plainTransfer.received_by || 0),
    ].filter(Boolean);

    const users = userIds.length
      ? await User.findAll({
          where: {
            id: {
              [Op.in]: userIds,
            },
          },
          attributes: ["id", "username", "email"],
        })
      : [];

    const userMap = new Map(users.map((u) => [Number(u.id), u]));

    const data = {
      id: plainTransfer.id,
      transfer_no: plainTransfer.transfer_no,
      tracking_number:
        plainTransfer.tracking_number || plainTransfer.transfer_no,

      status: plainTransfer.status,
      remarks: plainTransfer.remarks,

      from_organization_id: plainTransfer.from_organization_id,
      from_organization_name: pickStoreName(
        storeMap.get(Number(plainTransfer.from_organization_id))
      ),

      to_organization_id: plainTransfer.to_organization_id,
      to_organization_name: pickStoreName(
        storeMap.get(Number(plainTransfer.to_organization_id))
      ),

      transfer_date: plainTransfer.transfer_date,
      dispatch_date: plainTransfer.dispatch_date,
      receive_date: plainTransfer.receive_date,

      expected_delivery_date:
        plainTransfer.expected_delivery_date || null,
      expected_delivery_time:
        plainTransfer.expected_delivery_time || null,

      e_way_bill_url: plainTransfer.e_way_bill_url || null,

      driver_details: {
        driver_name: plainTransfer.driver_name || null,
        driver_phone: plainTransfer.driver_phone || null,
        vehicle_number: plainTransfer.vehicle_number || null,
        tracking_number: plainTransfer.tracking_number || null,
        driver_photo_url: plainTransfer.driver_photo_url || null,
      },

      media: {
        dispatch_image_url: plainTransfer.dispatch_image_url || null,
        dispatch_video_url: plainTransfer.dispatch_video_url || null,
        receive_image_url: plainTransfer.receive_image_url || null,
        e_way_bill_url: plainTransfer.e_way_bill_url || null,
      },

      created_by: {
        id: plainTransfer.created_by,
        name: pickUserName(userMap.get(Number(plainTransfer.created_by))),
      },

      approved_by: {
        id: plainTransfer.approved_by,
        name: pickUserName(userMap.get(Number(plainTransfer.approved_by))),
      },

      dispatched_by: {
        id: plainTransfer.dispatched_by,
        name: pickUserName(userMap.get(Number(plainTransfer.dispatched_by))),
      },

      received_by: {
        id: plainTransfer.received_by,
        name: pickUserName(userMap.get(Number(plainTransfer.received_by))),
      },

      products: (plainTransfer.transfer_items || []).map((row) => ({
  id: row.id,
  item_id: row.item_id,

  // ✅ Requested Quantity (same as qty)
  requested_qty: Number(row.qty || 0),

  // ✅ Existing Quantity
  qty: Number(row.qty || 0),

  weight: Number(row.weight || 0),
  remarks: row.remarks || null,

  item_name: row.item?.item_name || null,
  article_code: row.item?.article_code || null,
  category: row.item?.category || null,
  rate: Number(row.item?.sale_rate || 0),
  gross_weight: Number(row.item?.gross_weight || 0),
  net_weight: Number(row.item?.net_weight || 0),
})),
    };

    return res.status(200).json({
      success: true,
      message: "Transfer details fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getTransferDetails error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch transfer details",
      error: error.message,
    });
  }
};


export const getEWayBillByTransferId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        success: false,
        message: "Valid transfer id is required",
      });
    }

    const user = req.user;

    const transfer = await StockTransfer.findOne({
      where: { id: Number(id) },
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: `Transfer not found for id ${id}`,
      });
    }

    if (
      Number(user.organization_id) !== Number(transfer.from_organization_id) &&
      Number(user.organization_id) !== Number(transfer.to_organization_id) &&
      String(user.role || "").toLowerCase() !== "super_admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this e-way bill",
      });
    }

    if (!transfer.e_way_bill_url) {
      return res.status(404).json({
        success: false,
        message: "E-way bill not uploaded",
      });
    }

    return res.status(200).json({
      success: true,
      message: "E-way bill fetched successfully",
      data: {
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        e_way_bill_url: transfer.e_way_bill_url,
      },
    });
  } catch (error) {
    console.error("getEWayBillByTransferId error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch e-way bill",
      error: error.message,
    });
  }
};




export const estimateDispatchRequestValue = async (req, res) => {
  try {
    const { requestId } = req.params;
    const user = req.user;
    const parsedItems = parseItemsFromBody(req.body);

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items are required",
      });
    }

    const request = await StockRequest.findByPk(requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Stock request not found",
      });
    }

    if (Number(request.to_organization_id) !== Number(user.organization_id)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to estimate this request",
      });
    }

    const requestItems = await StockRequestItem.findAll({
      where: { request_id: request.id },
      raw: true,
    });

    const requestItemMap = new Map(
      requestItems.map((x) => [Number(x.item_id), x])
    );

    let totalRequested = 0;
    let totalSelectedQty = 0;
    let totalWeight = 0;
    let estimatedValue = 0;

    const items = [];

    for (const row of parsedItems) {
      const itemId = toNumber(row.item_id);
      const qty = toNumber(row.qty);

      if (!itemId || qty < 0) {
        return res.status(400).json({
          success: false,
          message: "Each item must have valid item_id and qty",
        });
      }

      const requestItem = requestItemMap.get(itemId);

      if (!requestItem) {
        return res.status(400).json({
          success: false,
          message: `Requested item not found for item_id ${itemId}`,
        });
      }

      const requestedQty = toNumber(requestItem.request_qty);

      if (qty > requestedQty) {
        return res.status(400).json({
          success: false,
          message: `Qty cannot exceed requested qty for item ${itemId}`,
        });
      }

      const [itemData] = await sequelize.query(
        `
        SELECT 
          i.id,
          i.item_name,
          i.article_code,
          i.sku_code,
          i.category,
          i.metal_type,
          i.purity,
          i.unit,
          COALESCE(i.gross_weight, 0) AS gross_weight,
          COALESCE(i.net_weight, i.gross_weight, 0) AS net_weight,
          COALESCE(i.net_weight, i.gross_weight, 0) AS per_item_weight,
          COALESCE(i.sale_rate, i.purchase_rate, 0) AS rate
        FROM items i
        WHERE i.id = :itemId
        LIMIT 1
        `,
        {
          replacements: { itemId },
          type: QueryTypes.SELECT,
        }
      );

      if (!itemData) {
        return res.status(404).json({
          success: false,
          message: `Item not found for item_id ${itemId}`,
        });
      }

      const [stock] = await sequelize.query(
        `
        SELECT 
          COALESCE(available_qty, 0) AS available_qty,
          COALESCE(available_weight, 0) AS available_weight
        FROM stocks
        WHERE organization_id = :organizationId
          AND item_id = :itemId
        LIMIT 1
        `,
        {
          replacements: {
            organizationId: user.organization_id,
            itemId,
          },
          type: QueryTypes.SELECT,
        }
      );

      const availableQty = toNumber(stock?.available_qty);
      const availableWeight = toNumber(stock?.available_weight);

      const perItemWeight = toNumber(itemData.per_item_weight);
      const rate = toNumber(itemData.rate);

      const totalItemWeight = qty * perItemWeight;
      const itemEstimatedValue = totalItemWeight * rate;

      const isAvailable =
        availableQty >= qty &&
        (totalItemWeight <= 0 || availableWeight >= totalItemWeight);

      totalRequested += requestedQty;
      totalSelectedQty += qty;
      totalWeight += totalItemWeight;
      estimatedValue += itemEstimatedValue;

      items.push({
        item_id: itemId,
        item_name: itemData.item_name,
        article_code: itemData.article_code,
        sku_code: itemData.sku_code,
        category: itemData.category,
        metal_type: itemData.metal_type,
        purity: itemData.purity,
        unit: itemData.unit,

        requested_qty: requestedQty,
        selected_qty: qty,

        available_qty: availableQty,
        available_weight: availableWeight,

        gross_weight: toNumber(itemData.gross_weight),
        net_weight: toNumber(itemData.net_weight),
        per_item_weight: perItemWeight,
        total_weight: Number(totalItemWeight.toFixed(3)),

        rate,
        estimated_value: Number(itemEstimatedValue.toFixed(2)),

        is_available: isAvailable,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Dispatch estimate calculated successfully",
      data: {
        request_id: request.id,
        request_no: request.request_no,
        total_requested: totalRequested,
        total_selected_qty: totalSelectedQty,
        total_weight: Number(totalWeight.toFixed(3)),
        estimated_value: Number(estimatedValue.toFixed(2)),
        items,
      },
    });
  } catch (error) {
    console.error("estimateDispatchRequestValue error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to calculate dispatch estimate",
      error: error.message,
    });
  }
};

const orgLevelTextLike = (level) =>
  where(cast(col("organization_level"), "TEXT"), {
    [Op.iLike]: `%${level}%`,
  });












// district create request 
export const createDistrictStockRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const user = req.user;

    const {
      target_type, // "head" OR "retail"
      to_store_id,
      to_store_code,
      items,
      priority,
      category,
      notes,
    } = req.body;

    const userLevel = String(user.organization_level || "").toLowerCase();

    if (userLevel !== "district") {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "Only district can create this stock request",
      });
    }

    const receiverType = String(target_type || "").toLowerCase();

    if (!["head", "retail"].includes(receiverType)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "target_type must be head or retail",
      });
    }

    if (!to_store_code) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "to_store_code is required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "items are required",
      });
    }

    let districtStore = await Store.findOne({
      where: {
        store_code: String(user.store_code || "").trim(),
        is_active: true,
        [Op.and]: [orgLevelTextLike("district")],
      },
      transaction,
    });

    if (!districtStore && user.district_code) {
      districtStore = await Store.findOne({
        where: {
          store_code: String(user.district_code).trim(),
          is_active: true,
          [Op.and]: [orgLevelTextLike("district")],
        },
        transaction,
      });
    }

    if (!districtStore && user.organization_id) {
      districtStore = await Store.findOne({
        where: {
          id: Number(user.organization_id),
          is_active: true,
          [Op.and]: [orgLevelTextLike("district")],
        },
        transaction,
      });
    }

    if (!districtStore) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message:
          "District store not found. Token organization_id/store_code is not mapped to a District store",
        debug: {
          token_organization_id: user.organization_id,
          token_store_code: user.store_code,
          token_district_code: user.district_code || null,
        },
      });
    }

    let receiverWhere;

    if (receiverType === "head") {
      receiverWhere = {
        store_code: String(to_store_code).trim(),
        is_active: true,
        [Op.and]: [orgLevelTextLike("head")],
      };
    } else {
      //  retail ka existing flow same rakha hai
      receiverWhere = {
        store_code: String(to_store_code).trim(),
        organization_level: "Retail",
        is_active: true,
        district_id: districtStore.id,
      };
    }

    if (to_store_id) {
      receiverWhere.id = Number(to_store_id);
    }

    const receiverStore = await Store.findOne({
      where: receiverWhere,
      transaction,
    });

    if (!receiverStore) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message:
          receiverType === "head"
            ? "Head store not found"
            : "Retail store not found under this district",
        debug: {
          district_id: districtStore.id,
          district_store_code: districtStore.store_code,
          to_store_id: to_store_id || null,
          to_store_code,
        },
      });
    }

    const validItems = items
      .filter((i) => i.item_id && Number(i.request_qty) > 0)
      .map((i) => ({
        item_id: Number(i.item_id),
        request_qty: Number(i.request_qty),
        approved_qty: 0,
        status: "pending",
      }));

    if (validItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No valid items found",
      });
    }

    const itemIds = validItems.map((i) => i.item_id);

    const receiverStocks = await Stock.findAll({
      where: {
        organization_id: receiverStore.id,
        item_id: { [Op.in]: itemIds },
      },
      attributes: ["item_id", "available_qty"],
      transaction,
    });

    const stockMap = new Map();

    receiverStocks.forEach((stock) => {
      stockMap.set(Number(stock.item_id), Number(stock.available_qty || 0));
    });

    const unavailableItems = validItems
      .map((item) => {
        const availableQty = stockMap.get(item.item_id) || 0;

        if (availableQty < item.request_qty) {
          return {
            item_id: item.item_id,
            requested_qty: item.request_qty,
            available_qty: availableQty,
          };
        }

        return null;
      })
      .filter(Boolean);
    if(target_type=="retail"){
    if (unavailableItems.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Selected store does not have enough stock for requested items",
        unavailable_items: unavailableItems,
      });
    }
  }
    const request_no = `REQ-DIST-${districtStore.id}-${Date.now()}`;

    const stockRequest = await StockRequest.create(
      {
        request_no,

        from_organization_id: districtStore.id,
        from_store_code: districtStore.store_code,
        from_store_name: districtStore.store_name,

        to_organization_id: receiverStore.id,
        to_store_code: receiverStore.store_code,
        to_store_name: receiverStore.store_name,

       to_district_code:
  receiverType === "retail"
    ? districtStore.store_code
    : receiverStore.store_code,

to_district_name:
  receiverType === "retail"
    ? districtStore.store_name
    : receiverStore.store_name,

        priority: priority || "medium",
        category: category || null,
        notes: notes || null,
        status: "pending",
        created_by: user.id,
      },
      { transaction }
    );

    const requestItemsPayload = validItems.map((item) => ({
      request_id: stockRequest.id,
      item_id: item.item_id,
      request_qty: item.request_qty,
      approved_qty: 0,
      status: "pending",
    }));

    await StockRequestItem.bulkCreate(requestItemsPayload, { transaction });

    await Task.create(
      {
        title: "Stock request approval required",
        description: `${districtStore.store_name} submitted stock request ${stockRequest.request_no} to ${receiverStore.store_name}`,
        priority: priority || "medium",
        status: "pending",
        task_type:
          receiverType === "head"
            ? "district_to_head_stock_request"
            : "district_to_retail_stock_request",

        reference_id: stockRequest.id,
        reference_no: stockRequest.request_no,

        district_code: districtStore.store_code,
        store_code: receiverStore.store_code,
        store_name: receiverStore.store_name,

        assigned_to: null,
        created_by: user.id,
      },
      { transaction }
    );

    await ActivityLog.create(
      {
        organization_id: districtStore.id,
        user_id: user.id,
        action: "stock_request_created",
        module_name: "stock_request",
        reference_id: stockRequest.id,
        reference_no: stockRequest.request_no,
        title: "Stock request created",
        description: `You created stock request ${stockRequest.request_no} for ${receiverStore.store_name}`,
        meta: {
          total_items: requestItemsPayload.length,
          from_store_name: districtStore.store_name,
          from_store_code: districtStore.store_code,
          to_store_name: receiverStore.store_name,
          to_store_code: receiverStore.store_code,
          target_type: receiverType,
        },
        icon: "request",
        color: "blue",
      },
      { transaction }
    );

    await SystemActivity.create(
      {
        title: "New district stock request submitted",
        description: `${districtStore.store_name} submitted request ${stockRequest.request_no} to ${receiverStore.store_name}`,
        activity_type: "stock_request_created",
        module_name: "stock_request",
        reference_id: stockRequest.id,
        reference_no: stockRequest.request_no,
        district_code: districtStore.store_code,
        store_code: receiverStore.store_code,
        store_name: receiverStore.store_name,
        created_by: user.id,
        created_at: new Date(),
      },
      { transaction }
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Stock request created successfully",
      data: {
        request_id: stockRequest.id,
        request_no: stockRequest.request_no,
        total_items: requestItemsPayload.length,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("createDistrictStockRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


export const getHeadStore = async (req, res) => {
  try {
    const data = await Store.findOne({
      where: {
        organization_level: "Head",
        is_active: true,
      },
      attributes: ["id", "store_name", "store_code"],
    });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Head store not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// import Store from "../models/Store.js";

export const getRetailStoresUnderDistrict = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const organizationId = Number(
      user.organization_id || user.organizationId || 0
    );

    const storeCode = String(user.store_code || "")
      .trim()
      .toUpperCase();

    if (!organizationId && !storeCode) {
      return res.status(400).json({
        success: false,
        message: "District organization_id or store_code missing in token",
      });
    }

    const districtWhere = {
      is_active: true,
      organization_level: "District",
    };

    if (organizationId) {
      districtWhere.id = organizationId;
    } else {
      districtWhere.store_code = storeCode;
    }

    const districtStore = await Store.findOne({
      where: districtWhere,
      attributes: [
        "id",
        "store_code",
        "store_name",
        "organization_level",
        "district_id",
        "is_active",
      ],
      raw: true,
    });

    if (!districtStore) {
      return res.status(404).json({
        success: false,
        message: "District store not found or inactive",
        debug: {
          token_organization_id: organizationId || null,
          token_store_code: storeCode || null,
          expected_organization_level: "District",
        },
      });
    }

    const districtLinkIds = [];

    if (districtStore.district_id) {
      districtLinkIds.push(Number(districtStore.district_id));
    }

    districtLinkIds.push(Number(districtStore.id));

    const retailStores = await Store.findAll({
      where: {
        is_active: true,
        organization_level: "Retail",
        district_id: {
          [Op.in]: districtLinkIds,
        },
      },
      attributes: [
        "id",
        "store_code",
        "store_name",
        "organization_level",
        "district_id",
        "is_active",
      ],
      order: [["store_name", "ASC"]],
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "Retail stores fetched successfully",
      count: retailStores.length,
      data: retailStores,
      district: {
        id: districtStore.id,
        store_code: districtStore.store_code,
        store_name: districtStore.store_name,
        organization_level: districtStore.organization_level,
        district_id: districtStore.district_id,
      },
    });
  } catch (error) {
    console.error("getRetailStoresUnderDistrict error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch retail stores",
      error: error.message,
    });
  }
};






const makeForwardRequestNo = (headOrgId, districtOrgId) => {
  return `REQ-FWD-${headOrgId}-${districtOrgId}-${Date.now()}`;
};

const getStoreLevel = (store) => {
  return String(
    store?.organizationlevel ||
      store?.organization_level ||
      ""
  ).trim();
};

const resolveDistrictStoreByCode = async ({ storeCode, transaction }) => {
  const cleanStoreCode = String(storeCode || "").trim().toUpperCase();

  if (!cleanStoreCode) return null;

  /**
   * CASE 1:
   * Actual district store_code.
   * Example: DST004, DST007, DST015
   */
  const directStore = await Store.findOne({
    where: {
      store_code: cleanStoreCode,
      is_active: true,
    },
    raw: true,
    transaction,
  });

  if (directStore && getStoreLevel(directStore) === "District") {
    return directStore;
  }

  /**
   * CASE 2:
   * Legacy/user district code.
   * Example: DIST-7 means districts.id = 7.
   * Actual district store may be DST004 with district_id = 7.
   */
  const legacyMatch = cleanStoreCode.match(/^DIST-(\d+)$/i);

  if (legacyMatch?.[1]) {
    const legacyDistrictId = Number(legacyMatch[1]);

    if (Number.isInteger(legacyDistrictId) && legacyDistrictId > 0) {
      const mappedDistrictStore = await Store.findOne({
        where: {
          district_id: legacyDistrictId,
          organizationlevel: "District",
          is_active: true,
        },
        raw: true,
        transaction,
      });

      if (mappedDistrictStore) {
        return mappedDistrictStore;
      }
    }
  }

  return null;
};

const getLegacyDistrictOrgId = (districtStore) => {
  /**
   * Existing DB flow:
   * stock_requests.to_organization_id uses districts.id / legacy district id.
   *
   * Example:
   * districtStore.id = 44
   * districtStore.store_code = DST004
   * districtStore.district_id = 7
   *
   * Save:
   * to_organization_id = 7
   */
  const legacyDistrictId = Number(districtStore?.district_id || 0);

  if (Number.isInteger(legacyDistrictId) && legacyDistrictId > 0) {
    return legacyDistrictId;
  }

  return Number(districtStore.id);
};

export const forwardRequestToDistrictDirectDelivery = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const user = req.user;
    const { requestId } = req.params;
    const { store_code, notes } = req.body;

    if (!user?.organization_id) {
      await t.rollback();
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    if (!isHeadUser(user)) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Only head office can transfer request to district",
      });
    }

    const cleanRequestId = Number(requestId);
    const selectedStoreCode = String(store_code || "").trim().toUpperCase();

    if (!Number.isInteger(cleanRequestId) || cleanRequestId <= 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Valid requestId is required",
      });
    }

    if (!selectedStoreCode) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Valid store_code is required",
      });
    }

    /**
     * Original request must be received by Head Office.
     * Do not use include with FOR UPDATE.
     */
    const originalRequest = await StockRequest.findOne({
      where: {
        id: cleanRequestId,
        to_organization_id: user.organization_id,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!originalRequest) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Original request not found for this head office",
      });
    }

    const requestItems = await StockRequestItem.findAll({
      where: {
        request_id: originalRequest.id,
      },
      include: [
        {
          model: Item,
          as: "item",
          required: false,
        },
      ],
      transaction: t,
    });

    const originalStatus = String(originalRequest.status || "").toLowerCase();

    if (
      ["cancelled", "rejected", "received", "completed", "dispatched"].includes(
        originalStatus
      )
    ) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Request cannot be transferred because current status is ${originalRequest.status}`,
      });
    }

    if (
      String(originalRequest.request_source || "").toLowerCase() === "forwarded"
    ) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Forwarded request cannot be transferred again",
      });
    }

    if (!requestItems || requestItems.length === 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Original request has no items",
      });
    }

    /**
     * Selected District B.
     *
     * Supports:
     * 1. Actual district store_code: DST004
     * 2. Legacy/user district code: DIST-7
     */
    const selectedDistrict = await resolveDistrictStoreByCode({
      storeCode: selectedStoreCode,
      transaction: t,
    });

    if (!selectedDistrict) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Selected district store_code not found or inactive",
        data: {
          received_store_code: selectedStoreCode,
          expected_examples: ["DST004", "DST007", "DST015", "DIST-7"],
        },
      });
    }

    const selectedOrganizationLevel = getStoreLevel(selectedDistrict);

    if (selectedOrganizationLevel !== "District") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Selected store_code belongs to ${
          selectedOrganizationLevel || "UNKNOWN"
        }, not District`,
        data: {
          id: selectedDistrict.id,
          store_code: selectedDistrict.store_code,
          store_name: selectedDistrict.store_name,
          organization_level: selectedOrganizationLevel || null,
          is_active: selectedDistrict.is_active,
        },
      });
    }

    /**
     * This is the important matching fix.
     * Existing received API/user mapping expects to_organization_id = districts.id.
     */
    const targetDistrictOrgId = getLegacyDistrictOrgId(selectedDistrict);

    /**
     * Original requester store.
     */
    const requesterStore = await Store.findOne({
      where: {
        id: originalRequest.from_organization_id,
      },
      raw: true,
      transaction: t,
    });

    if (!requesterStore) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Original requester store not found",
      });
    }

    /**
     * Same district check must compare legacy district id also.
     *
     * Example:
     * original requester from_organization_id = 7
     * selected district store id = 44
     * selected district district_id = 7
     */
    if (Number(targetDistrictOrgId) === Number(originalRequest.from_organization_id)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Cannot transfer request to the same district that created the original request",
      });
    }

    if (Number(targetDistrictOrgId) === Number(user.organization_id)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Cannot transfer request to head office itself",
      });
    }

    /**
     * Avoid duplicate transfer to same district.
     * Must use targetDistrictOrgId, not selectedDistrict.id.
     */
    const alreadyForwarded = await StockRequest.findOne({
      where: {
        parent_request_id: originalRequest.id,
        to_organization_id: targetDistrictOrgId,
        request_source: "forwarded",
      },
      transaction: t,
    });

    if (alreadyForwarded) {
      await t.rollback();
      return res.status(409).json({
        success: false,
        message: "This request is already transferred to selected district",
        data: {
          forwarded_request_id: alreadyForwarded.id,
          forwarded_request_no: alreadyForwarded.request_no,
        },
      });
    }

    const headStore = await Store.findOne({
      where: {
        id: user.organization_id,
      },
      raw: true,
      transaction: t,
    });

    const forwardedRequest = await StockRequest.create(
      {
        request_no: makeForwardRequestNo(
          user.organization_id,
          targetDistrictOrgId
        ),

        /**
         * Head Office -> District B
         */
        from_organization_id: user.organization_id,
        from_store_code: headStore?.store_code || user.store_code || null,
        from_store_name:
          headStore?.store_name || user.store_name || "Head Office",

        /**
         * IMPORTANT:
         * Existing DB matched flow:
         * to_organization_id = districts.id / district legacy id.
         */
        to_organization_id: targetDistrictOrgId,

        /**
         * Keep actual selected district store details here.
         */
        to_district_code: selectedDistrict.store_code,
        to_district_name: selectedDistrict.store_name,

        to_store_code: selectedDistrict.store_code,
        to_store_name: selectedDistrict.store_name,

        /**
         * Parent-child relation.
         */
        parent_request_id: originalRequest.id,
        request_source: "forwarded",

        forwarded_by: user.id,
        forwarded_at: new Date(),
        forward_note: notes || null,

        /**
         * Final delivery location.
         * District B will deliver to original requester.
         */
        final_to_organization_id: requesterStore.id,
        final_to_store_code: requesterStore.store_code,
        final_to_store_name: requesterStore.store_name,
        final_to_address: requesterStore.address || null,
        final_to_city: requesterStore.city || null,
        final_to_state: requesterStore.state || null,
        final_to_pincode: requesterStore.pincode || null,
        final_to_latitude: requesterStore.latitude || null,
        final_to_longitude: requesterStore.longitude || null,

        priority: originalRequest.priority || "medium",
        category: originalRequest.category || null,
        notes:
          notes ||
          `Transferred by Head Office. Deliver directly to ${requesterStore.store_name}.`,

        status: "pending",
        created_by: user.id,
      },
      { transaction: t }
    );

    const childItems = requestItems.map((item) => ({
      request_id: forwardedRequest.id,
      item_id: item.item_id,
      request_qty: item.request_qty,
      request_weight: item.request_weight || null,

      /**
       * approved_qty cannot be null in your DB.
       */
      approved_qty: item.approved_qty ?? 0,
      approved_weight: item.approved_weight ?? 0,

      rate: item.rate || null,
      remarks: item.remarks || null,
      status: "pending",
    }));

    await StockRequestItem.bulkCreate(childItems, { transaction: t });

    originalRequest.status = "forwarded";
    originalRequest.forwarded_by = user.id;
    originalRequest.forwarded_at = new Date();
    originalRequest.forward_note = notes || null;

    await originalRequest.save({ transaction: t });

    await ActivityLog.create(
      {
        organization_id: user.organization_id,
        user_id: user.id,
        action: "HEAD_TO_DISTRICT_REQUEST_TRANSFERRED",
        module_name: "stock_request",
        reference_id: forwardedRequest.id,
        reference_no: forwardedRequest.request_no,
        title: "Request transferred to district",
        description: `${originalRequest.request_no} transferred to ${selectedDistrict.store_name} for direct delivery to ${requesterStore.store_name}`,
        meta: {
          original_request_id: originalRequest.id,
          original_request_no: originalRequest.request_no,
          forwarded_request_id: forwardedRequest.id,
          forwarded_request_no: forwardedRequest.request_no,

          /**
           * Keep both ids for debugging/future migration.
           */
          assigned_to_organization_id: targetDistrictOrgId,
          assigned_to_actual_store_id: selectedDistrict.id,
          assigned_to_store_code: selectedDistrict.store_code,

          final_to_organization_id: requesterStore.id,
          final_to_store_code: requesterStore.store_code,
          total_items: childItems.length,
        },
        icon: "transfer",
        color: "blue",
      },
      { transaction: t }
    );

    await SystemActivity.create(
      {
        title: "Head transferred request to district",
        description: `Head transferred ${originalRequest.request_no} to ${selectedDistrict.store_name}. Final delivery to ${requesterStore.store_name}.`,
        activity_type: "head_to_district_request_transferred",
        module_name: "stock_request",
        reference_id: forwardedRequest.id,
        reference_no: forwardedRequest.request_no,
        state_code: selectedDistrict.state_code || null,
        district_code:
          selectedDistrict.district_code ||
          selectedDistrict.store_code ||
          null,
        store_code: selectedDistrict.store_code || null,
        store_name: selectedDistrict.store_name || null,
        created_by: user.id,

        /**
         * If your SystemActivity model has column `meta`,
         * replace metadata with meta.
         */
        metadata: {
          original_request_id: originalRequest.id,
          original_request_no: originalRequest.request_no,
          forwarded_request_id: forwardedRequest.id,
          forwarded_request_no: forwardedRequest.request_no,

          assigned_to_organization_id: targetDistrictOrgId,
          assigned_to_actual_store_id: selectedDistrict.id,

          final_delivery_store_id: requesterStore.id,
          final_delivery_store_code: requesterStore.store_code,
          final_delivery_store_name: requesterStore.store_name,
          total_items: childItems.length,
        },
      },
      { transaction: t }
    );

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Head to district request transferred successfully",
      data: {
        original_request: {
          id: originalRequest.id,
          request_no: originalRequest.request_no,
          status: originalRequest.status,
        },
        forwarded_request: {
          id: forwardedRequest.id,
          request_no: forwardedRequest.request_no,
          parent_request_id: forwardedRequest.parent_request_id,
          request_source: forwardedRequest.request_source,

          from_organization_id: forwardedRequest.from_organization_id,
          from_store_code: forwardedRequest.from_store_code,
          from_store_name: forwardedRequest.from_store_name,

          /**
           * This will now match old received API/user mapping.
           * Example: North Delhi = 7
           */
          to_organization_id: forwardedRequest.to_organization_id,

          /**
           * Actual district office details.
           * Example: DST004 / District Office North Delhi
           */
          actual_district_store_id: selectedDistrict.id,
          to_store_code:
            forwardedRequest.to_store_code || forwardedRequest.to_district_code,
          to_store_name:
            forwardedRequest.to_store_name || forwardedRequest.to_district_name,

          final_to_organization_id: forwardedRequest.final_to_organization_id,
          final_to_store_code: forwardedRequest.final_to_store_code,
          final_to_store_name: forwardedRequest.final_to_store_name,
          final_to_address: forwardedRequest.final_to_address,

          status: forwardedRequest.status,
          total_items: childItems.length,
        },
      },
    });
  } catch (error) {
    await t.rollback();

    console.error("forwardRequestToDistrictDirectDelivery error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to transfer request to district",
      error: error.message,
    });
  }
};



const dtRetailForwardNo = (districtOrgId, retailOrgId) => {
  return `REQ-DIST-FWD-${districtOrgId}-${retailOrgId}-${Date.now()}`;
};

const dtRetailStoreCode = (value) => {
  return String(value || "").trim().toUpperCase();
};

const dtRetailClean = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
};

const dtRetailIsDistrictUser = (user) => {
  const level = dtRetailClean(user?.organization_level);
  const role = dtRetailClean(user?.role);

  return (
    level === "district" ||
    level === "district_office" ||
    ["district_manager", "district_tl", "admin", "super_admin"].includes(role)
  );
};

const dtRetailRollback = async (transaction, res, statusCode, payload) => {
  await transaction.rollback();
  return res.status(statusCode).json(payload);
};

const dtRetailIsFinalStatus = (status) => {
  return [
    "cancelled",
    "rejected",
    "received",
    "completed",
    "dispatched",
    "forwarded",
  ].includes(dtRetailClean(status));
};

export const transferDistrictRequestToRetail = async (req, res) => {
  const t = await sequelize.transaction();

  const clean = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

  const toInt = (v) =>
    Number.isFinite(Number(v)) ? Number(v) : null;

  const rollback = async (msg, code = 400, extra = {}) => {
    try {
      await t.rollback();
    } catch {}

    return res.status(code).json({
      success: false,
      message: msg,
      ...extra,
    });
  };

  try {
    const user = req.user;

    const requestId = toInt(req.params.requestId);

    const retailStoreCode = String(req.body.retail_store_code || "")
      .trim()
      .toUpperCase();

    const notes = req.body.notes || null;

    // ---------------- AUTH ----------------
    if (!user?.store_code) {
      return rollback("Unauthorized user", 401);
    }

    if (clean(user.organization_level) !== "district") {
      return rollback("Only district users allowed", 403);
    }

    if (!requestId) {
      return rollback("Invalid request id", 400);
    }

    if (!retailStoreCode) {
      return rollback("Retail store code is required", 400);
    }

    // ---------------- DISTRICT STORE ----------------
    const districtStore = await Store.findOne({
      where: {
        store_code: String(user.store_code).trim().toUpperCase(),
        is_active: true,
      },
      raw: true,
      transaction: t,
    });

    if (!districtStore) {
      return rollback("District store not found", 404);
    }

    const districtLevel = clean(
      districtStore.organization_level ||
        districtStore.organizationlevel
    );

    if (districtLevel !== "district") {
      return rollback("Logged in store is not a district store", 400, {
        district_store: {
          id: districtStore.id,
          store_code: districtStore.store_code,
          store_name: districtStore.store_name,
          organization_level:
            districtStore.organization_level ||
            districtStore.organizationlevel,
          district_id: districtStore.district_id,
        },
      });
    }

    // ---------------- RETAIL STORE ----------------
    const retailStore = await Store.findOne({
      where: {
        store_code: retailStoreCode,
        is_active: true,
      },
      raw: true,
      transaction: t,
    });

    if (!retailStore) {
      return rollback("Retail store not found", 404);
    }

    // ---------------- RETAIL VALIDATION ----------------
    const retailLevel = clean(
      retailStore.organization_level ||
        retailStore.organizationlevel
    );

    const isRetailStore =
      retailLevel === "retail" ||
      String(retailStore.store_code || "")
        .toUpperCase()
        .startsWith("STR");

    if (!isRetailStore) {
      return rollback("Selected store is not a retail store", 400, {
        retail_store: {
          id: retailStore.id,
          store_code: retailStore.store_code,
          store_name: retailStore.store_name,
          organization_level:
            retailStore.organization_level ||
            retailStore.organizationlevel,
        },
      });
    }

    // ---------------- DISTRICT VALIDATION ----------------
    const districtOrgId = Number(districtStore.id);

    // FIXED:
    // District store ka district_id null hona normal hai.
    // Retail store ke district_id me district store ka id hota hai.
    const districtMappingId = Number(districtStore.id);

    const retailDistrictId = Number(retailStore.district_id || 0);

    if (!retailDistrictId) {
      return rollback("District mapping missing for retail store", 400, {
        retail_store: {
          id: retailStore.id,
          store_code: retailStore.store_code,
          store_name: retailStore.store_name,
          organization_level:
            retailStore.organization_level ||
            retailStore.organizationlevel,
          district_id: retailStore.district_id,
        },
      });
    }

    if (districtMappingId !== retailDistrictId) {
      return rollback("Retail store not in same district", 400, {
        district_mapping_id: districtMappingId,
        retail_district_id: retailDistrictId,
        district_store: {
          id: districtStore.id,
          store_code: districtStore.store_code,
          store_name: districtStore.store_name,
          organization_level:
            districtStore.organization_level ||
            districtStore.organizationlevel,
          district_id: districtStore.district_id,
        },
        retail_store: {
          id: retailStore.id,
          store_code: retailStore.store_code,
          store_name: retailStore.store_name,
          organization_level:
            retailStore.organization_level ||
            retailStore.organizationlevel,
          district_id: retailStore.district_id,
        },
      });
    }

    // ---------------- REQUEST ----------------
    const requestOwnerIds = [
      Number(user.organization_id || 0),
      Number(districtStore.id || 0),
      Number(districtMappingId || 0),
    ].filter(Boolean);

    const request = await StockRequest.findOne({
      where: {
        id: requestId,
        to_organization_id: {
          [Op.in]: requestOwnerIds,
        },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!request) {
      return rollback("Request not found for this district", 404, {
        debug: {
          request_id: requestId,
          expected_to_organization_ids: requestOwnerIds,
        },
      });
    }

    const requestStatus = clean(request.status);

    if (
      [
        "cancelled",
        "rejected",
        "received",
        "completed",
        "dispatched",
      ].includes(requestStatus)
    ) {
      return rollback(
        `Request cannot be forwarded because current status is ${request.status}`
      );
    }

    if (requestStatus === "forwarded") {
      return rollback("Request already forwarded");
    }

    // ---------------- ITEMS ----------------
    const items = await StockRequestItem.findAll({
      where: {
        request_id: request.id,
      },
      transaction: t,
    });

    if (!items.length) {
      return rollback("No items found in request");
    }

    // ---------------- DUPLICATE CHECK ----------------
    const alreadyForwarded = await StockRequest.findOne({
      where: {
        parent_request_id: request.id,
        request_source: "district_to_retail_forwarded",
        to_organization_id: retailStore.id,
      },
      transaction: t,
    });

    if (alreadyForwarded) {
      return rollback("Request already forwarded to this retail store", 409, {
        forwarded_request_id: alreadyForwarded.id,
        forwarded_request_no: alreadyForwarded.request_no,
      });
    }

    // ---------------- CREATE FORWARDED REQUEST ----------------
    const forwardedRequest = await StockRequest.create(
      {
        request_no: `REQ-DTR-${Date.now()}`,

        from_organization_id: districtOrgId,
        from_store_code: districtStore.store_code,
        from_store_name: districtStore.store_name,

        to_organization_id: retailStore.id,
        to_store_code: retailStore.store_code,
        to_store_name: retailStore.store_name,

        to_district_code: districtStore.store_code,
        to_district_name: districtStore.store_name,

        parent_request_id: request.id,
        request_source: "district_to_retail_forwarded",

        status: "pending",

        priority: request.priority || "medium",
        category: request.category || null,

        notes: notes || "Forwarded from district to retail",

        created_by: user.id,
        forwarded_by: user.id,
        forwarded_at: new Date(),
      },
      { transaction: t }
    );

    // ---------------- COPY ITEMS ----------------
    const childItems = items.map((i) => ({
      request_id: forwardedRequest.id,
      item_id: i.item_id,
      request_qty: i.request_qty,
      request_weight: i.request_weight || null,

      approved_qty: 0,
      approved_weight: 0,

      rate: i.rate || null,
      remarks: i.remarks || null,
      status: "pending",
    }));

    await StockRequestItem.bulkCreate(childItems, {
      transaction: t,
    });

    // ---------------- UPDATE ORIGINAL REQUEST ----------------
    request.status = "forwarded";
    request.forwarded_by = user.id;
    request.forwarded_at = new Date();
    request.forward_note = notes || null;

    await request.save({ transaction: t });

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "District request transferred to retail successfully",
      data: {
        original_request: {
          id: request.id,
          request_no: request.request_no,
          parent_request_id: request.parent_request_id,
          request_source: request.request_source,
          status: request.status,
          from_organization_id: request.from_organization_id,
          to_organization_id: request.to_organization_id,
        },

        forwarded_request: {
          id: forwardedRequest.id,
          request_no: forwardedRequest.request_no,
          parent_request_id: forwardedRequest.parent_request_id,
          request_source: forwardedRequest.request_source,

          from_organization_id: forwardedRequest.from_organization_id,
          from_store_code: forwardedRequest.from_store_code,
          from_store_name: forwardedRequest.from_store_name,

          to_organization_id: forwardedRequest.to_organization_id,
          to_store_code: forwardedRequest.to_store_code,
          to_store_name: forwardedRequest.to_store_name,

          district_mapping_id: districtMappingId,

          forwarded_by: forwardedRequest.forwarded_by,
          forwarded_at: forwardedRequest.forwarded_at,

          notes: forwardedRequest.notes,
          status: forwardedRequest.status,

          total_items: childItems.length,

          items: childItems.map((item) => ({
            item_id: item.item_id,
            request_qty: item.request_qty,
            request_weight: item.request_weight,
            approved_qty: item.approved_qty,
            approved_weight: item.approved_weight,
            status: item.status,
          })),
        },
      },
    });
  } catch (err) {
    try {
      await t.rollback();
    } catch {}

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};


export const downloadDeliveryChallanByTransfer = async (req, res) => {
  try {
    const transferId = Number(req.params.transferId);

    if (!Number.isInteger(transferId) || transferId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid transferId is required",
      });
    }

    const transfer = await StockTransfer.findByPk(transferId);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    const request = await StockRequest.findByPk(transfer.request_id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Linked stock request not found",
      });
    }

    const transferItems = await StockTransferItem.findAll({
      where: {
        transfer_id: transfer.id,
      },
      include: [
        {
          model: Item,
          as: "item",
          required: false,
        },
      ],
    });

    const fromStore = await Store.findOne({
      where: { id: transfer.from_organization_id },
    });

    const toStore = await Store.findOne({
      where: { id: transfer.to_organization_id },
    });

    const challanItems = transferItems.map((row) => {
      const item = row.item || {};

      const qty = Number(row.qty || 0);
      const weight = Number(row.weight || 0);
      const rate = Number(row.rate || 0);

      return {
        item_id: row.item_id,
        item_name: item.item_name || "-",
        product_code: item.article_code || item.sku_code || "-",
        hsn_code: item.hsn_code || "-",
        purity: item.purity || "-",
        qty,
        weight,
        rate,
        making_charge: item.making_charge || 0,
        huid_code: item.huid_code || "-",
        base_value: weight > 0 ? weight * rate : qty * rate,
      };
    });

    const challanPdf = await generateDeliveryChallanPdf({
      transfer,
      request,
      fromStore,
      toStore,
      challanItems,
      driver: {
        driver_name: transfer.driver_name,
        driver_phone: transfer.driver_phone,
        vehicle_number: transfer.vehicle_number,
        pickup_address: transfer.pickup_address,
        delivery_address: transfer.delivery_address,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${challanPdf.fileName}"`
    );

    return res.sendFile(challanPdf.filePath);
  } catch (error) {
    console.error("downloadDeliveryChallanByTransfer error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to download delivery challan",
      error: error.message,
    });
  }
};
import fs from "fs";

export const dispatchNewItemTransfer = async (req, res) => {
  const transaction = await sequelize.transaction();
  const uploadedLocalPaths = [];

  const safeRollback = async () => {
    if (!transaction.finished) await transaction.rollback();
  };

  const addLocalPath = (file) => {
    if (file?.path) uploadedLocalPaths.push(file.path);
  };

  const isValidPhone = (phone) => /^[6-9]\d{9}$/.test(String(phone).trim());

  const isPositiveNumber = (value) =>
    !isNaN(Number(value)) && Number(value) > 0;

  const isValidNonNegativeNumber = (value) => {
    return value === undefined || value === null || value === ""
      ? true
      : !isNaN(Number(value)) && Number(value) >= 0;
  };

  const isPastDate = (date) => {
    if (!date) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const inputDate = new Date(date);
    inputDate.setHours(0, 0, 0, 0);

    return inputDate < today;
  };

  const uploadFileSafely = async (file, folder, type, errorMessage) => {
    try {
      const uploaded = await uploadToCloudinary(file.path, folder, type);
      return uploaded.secure_url;
    } catch (err) {
      throw new Error(errorMessage || "File upload failed");
    }
  };

  try {
    const {
      remarks,
      driver_name,
      driver_phone,
      vehicle_number,
      pickup_address,
      delivery_address,
      expected_delivery_date,
      expected_delivery_time,
      additional_notes,
      items,
      to_organization_id,
    } = req.body;

    const user = req.user;

    if (!user?.id || !user?.organization_id) {
      await safeRollback();
      return res.status(401).json({
        success: false,
        message: "Invalid user token",
      });
    }

    if (!to_organization_id) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Destination organization is required",
      });
    }

    let parsedItems = [];

    try {
      if (Array.isArray(items)) {
        parsedItems = items;
      } else if (typeof items === "string") {
        parsedItems = JSON.parse(items);
      } else {
        parsedItems = parseItemsFromBody(req.body) || [];
      }
    } catch (err) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Invalid items JSON format",
      });
    }

    if (!Array.isArray(parsedItems) || !parsedItems.length) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Items required",
      });
    }

    if (!driver_name || !String(driver_name).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Driver name is required",
      });
    }

    if (!driver_phone || !String(driver_phone).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Driver phone is required",
      });
    }

    if (!isValidPhone(driver_phone)) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Driver phone must be a valid 10 digit Indian mobile number",
      });
    }

    if (!vehicle_number || !String(vehicle_number).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Vehicle number is required",
      });
    }

    if (!pickup_address || !String(pickup_address).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Pickup address is required",
      });
    }

    if (!delivery_address || !String(delivery_address).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Delivery address is required",
      });
    }

    if (expected_delivery_date && isPastDate(expected_delivery_date)) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Expected delivery date cannot be in the past",
      });
    }

    // ================= FILES =================
    const driverPhotoFile = req.files?.driver_photo?.[0] || null;
    const dispatchImageFiles = req.files?.dispatch_images || [];
    const dispatchVideoFile = req.files?.dispatch_video?.[0] || null;
    const eWayBillFile = req.files?.e_way_bill?.[0] || null;

    addLocalPath(driverPhotoFile);
    dispatchImageFiles.forEach(addLocalPath);
    addLocalPath(dispatchVideoFile);
    addLocalPath(eWayBillFile);

    let driver_photo_url = null;
    let dispatch_image_urls = [];
    let dispatch_video_url = null;
    let e_way_bill_url = null;

    if (driverPhotoFile?.path) {
      driver_photo_url = await uploadFileSafely(
        driverPhotoFile,
        "new-item/driver-photo",
        "image",
        "Failed to upload driver photo"
      );
    }

    for (const file of dispatchImageFiles) {
      const imageUrl = await uploadFileSafely(
        file,
        "new-item/dispatch-images",
        "image",
        "Failed to upload dispatch image"
      );

      dispatch_image_urls.push(imageUrl);
    }

    if (dispatchVideoFile?.path) {
      dispatch_video_url = await uploadFileSafely(
        dispatchVideoFile,
        "new-item/dispatch-video",
        "video",
        "Failed to upload dispatch video"
      );
    }

    if (eWayBillFile?.path) {
      const isPdf =
        eWayBillFile.mimetype === "application/pdf" ||
        eWayBillFile.originalname?.toLowerCase().endsWith(".pdf");

      e_way_bill_url = await uploadFileSafely(
        eWayBillFile,
        "new-item/e-way-bill",
        isPdf ? "raw" : "image",
        "Failed to upload e-way bill"
      );
    }

    // ================= CREATE TRANSFER =================
    const transfer = await StockTransfer.create(
      {
        transfer_no: generateTransferNo(),
        from_organization_id: user.organization_id,
        to_organization_id,
        status: "in_transit",

        driver_name: String(driver_name).trim(),
        driver_phone: String(driver_phone).trim(),
        vehicle_number: String(vehicle_number).trim(),
        pickup_address: String(pickup_address).trim(),
        delivery_address: String(delivery_address).trim(),
        expected_delivery_date,
        expected_delivery_time,
        additional_notes,
        remarks: remarks || null,

        driver_photo_url,
        dispatch_image_url: dispatch_image_urls.length
          ? JSON.stringify(dispatch_image_urls)
          : null,
        dispatch_video_url,
        e_way_bill_url,

        created_by: user.id,
        dispatched_by: user.id,
      },
      { transaction }
    );

    // ================= ITEMS =================
    for (const row of parsedItems) {
      const {
        item_name,
        article_code,
        sku_code,
        qty,
        weight,
        rate,
        purity,
        hsn_code,
      } = row;

      if (!item_name || !String(item_name).trim()) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: "item_name is required",
        });
      }

      if (!isPositiveNumber(qty)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Valid qty is required for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(rate)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Rate cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.gross_weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Gross weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.net_weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Net weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.stone_weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Stone weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.stone_amount)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Stone amount cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.making_charge)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Making charge cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.purchase_rate)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Purchase rate cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.sale_rate)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Sale rate cannot be negative for item ${item_name}`,
        });
      }

      let item = null;
      let isNewItem = false;

      // =====================================================
      // CASE 1: EXISTING HEAD INVENTORY ITEM
      // item_id ya sku_code mila to Head inventory se item uthayega
      // =====================================================
      if (row.item_id) {
        item = await Item.findOne({
          where: {
            id: row.item_id,
            organization_id: user.organization_id,
            is_active: true,
          },
          transaction,
        });
      }

      if (!item && sku_code) {
        item = await Item.findOne({
          where: {
            sku_code: String(sku_code).trim(),
            organization_id: user.organization_id,
            is_active: true,
          },
          transaction,
        });
      }

      // =====================================================
      // CASE 2: BRAND NEW ITEM
      // Agar Head inventory me item nahi mila to new item create hoga
      // =====================================================
      if (!item) {
        isNewItem = true;

        if (!row.metal_type || !String(row.metal_type).trim()) {
          await safeRollback();
          return res.status(400).json({
            success: false,
            message: `metal_type is required for item ${item_name}`,
          });
        }

        if (!row.category || !String(row.category).trim()) {
          await safeRollback();
          return res.status(400).json({
            success: false,
            message: `category is required for item ${item_name}`,
          });
        }

        item = await Item.create(
          {
            article_code:
              article_code ||
              `ART-${Date.now()}-${Math.floor(Math.random() * 1000)}`,

            sku_code:
              sku_code ||
              `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,

            item_name: String(item_name).trim(),

            metal_type: row.metal_type,
            category: row.category,
            subcategory: row.subcategory || "",

            details: row.details || null,
            purity: purity || "NA",

            gross_weight: Number(row.gross_weight || weight || 0),
            net_weight: Number(row.net_weight || weight || 0),
            stone_weight: Number(row.stone_weight || 0),
            stone_amount: Number(row.stone_amount || 0),

            making_charge: Number(row.making_charge || rate || 0),
            purchase_rate: Number(row.purchase_rate || 0),
            sale_rate: Number(row.sale_rate || 0),

            hsn_code: hsn_code || null,
            unit: row.unit || "PCS",

            organization_id: user.organization_id,
            storeCode: user.store_code || user.storeCode || null,

            current_status: "in_stock",
            is_active: true,
          },
          { transaction }
        );

        // ================= INSERT INTO HEAD STOCK =================
        await sequelize.query(
          `
          INSERT INTO stocks (
            item_id,
            organization_id,
            store_code,
            available_qty,
            available_weight,
            reserved_qty,
            reserved_weight,
            transit_qty,
            transit_weight,
            damaged_qty,
            damaged_weight,
            dead_qty,
            dead_weight,
            created_at,
            updated_at
          )
          VALUES (
            :item_id,
            :organization_id,
            :store_code,
            :available_qty,
            :available_weight,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            NOW(),
            NOW()
          )
          `,
          {
            replacements: {
              item_id: item.id,
              organization_id: user.organization_id,
              store_code: user.store_code || user.storeCode || null,
              available_qty: Number(qty),
              available_weight: Number(weight || item.gross_weight || 0),
            },
            type: QueryTypes.INSERT,
            transaction,
          }
        );

        // ================= CREATE ROOT BATCH FOR NEW ITEM =================
        const batchNo = `BATCH-${Date.now()}-${Math.floor(
          Math.random() * 1000
        )}`;

        const [createdBatch] = await sequelize.query(
          `
          INSERT INTO inventory_batches (
  batch_no,
  item_id,
  root_batch_id,
  parent_batch_id,
  organization_id,
  current_organization_id,
  total_qty,
  available_qty,
  total_weight,
  available_weight,
  split_level,
  status,
  created_at,
  updated_at
)
VALUES (
  :batch_no,
  :item_id,
  NULL,
  NULL,
  :organization_id,
  :current_organization_id,
  :total_qty,
  :available_qty,
  :total_weight,
  :available_weight,
  0,
  'created',
  NOW(),
  NOW()
)
RETURNING *
          `,
          {
            replacements: {
              batch_no: batchNo,
              item_id: item.id,
               organization_id: user.organization_id,
              current_organization_id: user.organization_id,
              total_qty: Number(qty),
              available_qty: Number(qty),
              total_weight: Number(weight || item.gross_weight || 0),
              available_weight: Number(weight || item.gross_weight || 0),
            },
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        // root_batch_id same batch id update
        await sequelize.query(
          `
          UPDATE inventory_batches
          SET root_batch_id = :root_batch_id,
              updated_at = NOW()
          WHERE id = :batch_id
          `,
          {
            replacements: {
              root_batch_id: createdBatch.id,
              batch_id: createdBatch.id,
            },
            type: QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      // =====================================================
      // AB EXISTING YA NEW DONO CASE ME HEAD STOCK SE DISPATCH
      // Stock minus + batch split
      // =====================================================

      const [stock] = await sequelize.query(
        `
        SELECT *
        FROM stocks
        WHERE item_id = :item_id
        AND organization_id = :organization_id
        FOR UPDATE
        `,
        {
          replacements: {
            item_id: item.id,
            organization_id: user.organization_id,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (!stock) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Stock not found for item ${item.item_name}`,
        });
      }

      if (Number(stock.available_qty || 0) < Number(qty)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${item.item_name}. Available qty: ${stock.available_qty}`,
        });
      }

      const [parentBatch] = await sequelize.query(
        `
        SELECT 
          id,
          batch_no,
          root_batch_id,
          parent_batch_id,
          item_id,
          current_organization_id,
          total_qty,
          available_qty,
          total_weight,
          available_weight,
          split_level,
          status
        FROM inventory_batches
        WHERE item_id = :item_id
        AND current_organization_id = :organization_id
        AND COALESCE(available_qty, 0) >= :qty
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
        `,
        {
          replacements: {
            item_id: item.id,
            organization_id: user.organization_id,
            qty: Number(qty),
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (!parentBatch) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Available batch not found for item ${item.item_name}`,
        });
      }

      const childBatch = await InventoryTrackingService.distributeBatch(
        {
          parent_batch_id: parentBatch.id,
          to_organization_id,
          quantity: Number(qty),
          weight: Number(weight || item.gross_weight || 0),
          reference_type: isNewItem
            ? "HEAD_NEW_ITEM_DIRECT_TRANSFER"
            : "HEAD_EXISTING_ITEM_DIRECT_TRANSFER",
          reference_id: transfer.id,
          remarks: remarks || "Head inventory direct transfer",
          handled_by: user.id,
        },
        { transaction }
      );

      await sequelize.query(
        `
        UPDATE stocks
        SET 
          available_qty = available_qty - :qty,
          transit_qty = COALESCE(transit_qty, 0) + :qty,
          available_weight = COALESCE(available_weight, 0) - :weight,
          transit_weight = COALESCE(transit_weight, 0) + :weight,
          updated_at = NOW()
        WHERE id = :stock_id
        `,
        {
          replacements: {
            qty: Number(qty),
            weight: Number(weight || item.gross_weight || 0),
            stock_id: stock.id,
          },
          type: QueryTypes.UPDATE,
          transaction,
        }
      );

      await StockTransferItem.create(
        {
          transfer_id: transfer.id,

          item_id: item.id,

          batch_id: childBatch?.id || childBatch?.batch_id || null,
          root_batch_id:
            childBatch?.root_batch_id ||
            parentBatch.root_batch_id ||
            parentBatch.id,
          parent_batch_id: parentBatch.id,

          qty: Number(qty),
          weight: Number(weight || item.gross_weight || 0),
          rate: Number(rate || item.sale_rate || 0),

          remarks: remarks || null,

          external_item_data: {
            source_type: isNewItem
              ? "brand_new_item"
              : "existing_head_inventory",

            item_id: item.id,

            parent_batch_id: parentBatch.id,
            parent_batch_no: parentBatch.batch_no,

            batch_id: childBatch?.id || childBatch?.batch_id || null,
            batch_no: childBatch?.batch_no || null,

            root_batch_id:
              childBatch?.root_batch_id ||
              parentBatch.root_batch_id ||
              parentBatch.id,

            item_name: item.item_name,
            article_code: item.article_code,
            sku_code: item.sku_code,
            metal_type: item.metal_type,
            category: item.category,
            subcategory: item.subcategory,
            details: item.details,
            purity: item.purity,
            gross_weight: item.gross_weight,
            net_weight: item.net_weight,
            stone_weight: item.stone_weight,
            stone_amount: item.stone_amount,
            making_charge: item.making_charge,
            purchase_rate: item.purchase_rate,
            sale_rate: item.sale_rate,
            hsn_code: item.hsn_code,
            unit: item.unit,
            organization_id: item.organization_id,
          },
        },
        { transaction }
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Head item dispatched successfully",
      data: {
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        status: "in_transit",
      },
    });
  } catch (error) {
    await safeRollback();

    console.error("dispatchNewItemTransfer error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    for (const filePath of uploadedLocalPaths) {
      try {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error("Local file cleanup error:", err.message);
      }
    }
  }
};
export const dispatchDistrictToRetailDirectTransfer = async (req, res) => {
  const transaction = await sequelize.transaction();
  const uploadedLocalPaths = [];

  const safeRollback = async () => {
    if (!transaction.finished) {
      await transaction.rollback();
    }
  };

  const addLocalPath = (file) => {
    if (file?.path) uploadedLocalPaths.push(file.path);
  };

  const isValidPhone = (phone) => /^[6-9]\d{9}$/.test(String(phone).trim());

  const isPositiveNumber = (value) =>
    !isNaN(Number(value)) && Number(value) > 0;

  const isValidNonNegativeNumber = (value) => {
    return value === undefined || value === null || value === ""
      ? true
      : !isNaN(Number(value)) && Number(value) >= 0;
  };

  const isPastDate = (date) => {
    if (!date) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const inputDate = new Date(date);
    inputDate.setHours(0, 0, 0, 0);

    return inputDate < today;
  };

  const uploadFileSafely = async (file, folder, type, errorMessage) => {
    try {
      const uploaded = await uploadToCloudinary(file.path, folder, type);
      return uploaded.secure_url;
    } catch (err) {
      throw new Error(errorMessage || "File upload failed");
    }
  };

  try {
    const {
      remarks,
      driver_name,
      driver_phone,
      vehicle_number,
      pickup_address,
      delivery_address,
      expected_delivery_date,
      expected_delivery_time,
      additional_notes,
      items,
      to_organization_id,
    } = req.body;

    const user = req.user;

    if (!user?.id || !user?.organization_id) {
      await safeRollback();
      return res.status(401).json({
        success: false,
        message: "Invalid user token",
      });
    }

    const userLevel = String(user.organization_level || "").toLowerCase();

    if (userLevel !== "district") {
      await safeRollback();
      return res.status(403).json({
        success: false,
        message: "Only district user can dispatch directly to retail",
      });
    }

    if (!to_organization_id) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Retail organization is required",
      });
    }

    const retailStore = await Store.findOne({
      where: {
        id: to_organization_id,
        organization_level: "Retail",
        is_active: true,
      },
      transaction,
    });

    if (!retailStore) {
      await safeRollback();
      return res.status(404).json({
        success: false,
        message: "Retail store not found",
      });
    }

    if (
      retailStore.district_id &&
      Number(retailStore.district_id) !== Number(user.organization_id)
    ) {
      await safeRollback();
      return res.status(403).json({
        success: false,
        message: "This retail store does not belong to your district",
      });
    }

    let parsedItems = [];

    try {
      if (Array.isArray(items)) {
        parsedItems = items;
      } else if (typeof items === "string") {
        parsedItems = JSON.parse(items);
      } else {
        parsedItems = parseItemsFromBody(req.body) || [];
      }
    } catch (err) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Invalid items JSON format",
      });
    }

    if (!Array.isArray(parsedItems) || !parsedItems.length) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Items required",
      });
    }

    if (!driver_name || !String(driver_name).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Driver name is required",
      });
    }

    if (!driver_phone || !String(driver_phone).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Driver phone is required",
      });
    }

    if (!isValidPhone(driver_phone)) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Driver phone must be a valid 10 digit Indian mobile number",
      });
    }

    if (!vehicle_number || !String(vehicle_number).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Vehicle number is required",
      });
    }

    if (!pickup_address || !String(pickup_address).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Pickup address is required",
      });
    }

    if (!delivery_address || !String(delivery_address).trim()) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Delivery address is required",
      });
    }

    if (expected_delivery_date && isPastDate(expected_delivery_date)) {
      await safeRollback();
      return res.status(400).json({
        success: false,
        message: "Expected delivery date cannot be in the past",
      });
    }

    // ================= FILES =================
    const driverPhotoFile = req.files?.driver_photo?.[0] || null;
    const dispatchImageFiles = req.files?.dispatch_images || [];
    const dispatchVideoFile = req.files?.dispatch_video?.[0] || null;
    const eWayBillFile = req.files?.e_way_bill?.[0] || null;

    addLocalPath(driverPhotoFile);
    dispatchImageFiles.forEach(addLocalPath);
    addLocalPath(dispatchVideoFile);
    addLocalPath(eWayBillFile);

    let driver_photo_url = null;
    let dispatch_image_urls = [];
    let dispatch_video_url = null;
    let e_way_bill_url = null;

    if (driverPhotoFile?.path) {
      driver_photo_url = await uploadFileSafely(
        driverPhotoFile,
        "district-retail/driver-photo",
        "image",
        "Failed to upload driver photo"
      );
    }

    for (const file of dispatchImageFiles) {
      const imageUrl = await uploadFileSafely(
        file,
        "district-retail/dispatch-images",
        "image",
        "Failed to upload dispatch image"
      );

      dispatch_image_urls.push(imageUrl);
    }

    if (dispatchVideoFile?.path) {
      dispatch_video_url = await uploadFileSafely(
        dispatchVideoFile,
        "district-retail/dispatch-video",
        "video",
        "Failed to upload dispatch video"
      );
    }

    if (eWayBillFile?.path) {
      const isPdf =
        eWayBillFile.mimetype === "application/pdf" ||
        eWayBillFile.originalname?.toLowerCase().endsWith(".pdf");

      e_way_bill_url = await uploadFileSafely(
        eWayBillFile,
        "district-retail/e-way-bill",
        isPdf ? "raw" : "image",
        "Failed to upload e-way bill"
      );
    }

    // ================= CREATE TRANSFER =================
    const transfer = await StockTransfer.create(
      {
        transfer_no: generateTransferNo(),
        from_organization_id: user.organization_id,
        to_organization_id,
        status: "in_transit",

        driver_name: String(driver_name).trim(),
        driver_phone: String(driver_phone).trim(),
        vehicle_number: String(vehicle_number).trim(),
        pickup_address: String(pickup_address).trim(),
        delivery_address: String(delivery_address).trim(),
        expected_delivery_date,
        expected_delivery_time,
        additional_notes,
        remarks: remarks || null,

        driver_photo_url,
        dispatch_image_url: dispatch_image_urls.length
          ? JSON.stringify(dispatch_image_urls)
          : null,
        dispatch_video_url,
        e_way_bill_url,

        created_by: user.id,
        dispatched_by: user.id,
      },
      { transaction }
    );

    // ================= ITEMS =================
    for (const row of parsedItems) {
      const {
        item_name,
        article_code,
        sku_code,
        qty,
        weight,
        rate,
        purity,
        hsn_code,
      } = row;

      if (!item_name || !String(item_name).trim()) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: "item_name is required",
        });
      }

      if (!sku_code || !String(sku_code).trim()) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `sku_code is required for item ${item_name}`,
        });
      }

      if (!isPositiveNumber(qty)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Valid qty is required for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(rate)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Rate cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.gross_weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Gross weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.net_weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Net weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.stone_weight)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Stone weight cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.stone_amount)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Stone amount cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.making_charge)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Making charge cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.purchase_rate)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Purchase rate cannot be negative for item ${item_name}`,
        });
      }

      if (!isValidNonNegativeNumber(row.sale_rate)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Sale rate cannot be negative for item ${item_name}`,
        });
      }

      // ================= ITEM MASTER HANDLING BY SKU =================
      const item = await Item.findOne({
        where: {
          sku_code: String(sku_code).trim(),
          organization_id: user.organization_id,
          is_active: true,
        },
        transaction,
      });

      if (!item) {
        await safeRollback();
        return res.status(404).json({
          success: false,
          message: `Item with SKU ${sku_code} not found in your inventory`,
        });
      }

      // ================= CHECK OWN INVENTORY STOCK =================
      const [stock] = await sequelize.query(
        `
        SELECT *
        FROM stocks
        WHERE item_id = :item_id
        AND organization_id = :organization_id
        FOR UPDATE
        `,
        {
          replacements: {
            item_id: item.id,
            organization_id: user.organization_id,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (!stock) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Stock not found for SKU ${sku_code}`,
        });
      }

      if (Number(stock.available_qty || 0) < Number(qty)) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for SKU ${sku_code}. Available qty: ${stock.available_qty}`,
        });
      }

      // ================= FIND AVAILABLE PARENT BATCH =================
      const [parentBatch] = await sequelize.query(
        `
        SELECT 
          id,
          batch_no,
          root_batch_id,
          parent_batch_id,
          item_id,
          current_organization_id,
          total_qty,
          available_qty,
          total_weight,
          available_weight,
          split_level,
          status
        FROM inventory_batches
        WHERE item_id = :item_id
        AND current_organization_id = :organization_id
        AND COALESCE(available_qty, 0) >= :qty
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
        `,
        {
          replacements: {
            item_id: item.id,
            organization_id: user.organization_id,
            qty: Number(qty),
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (!parentBatch) {
        await safeRollback();
        return res.status(400).json({
          success: false,
          message: `Available batch not found for SKU ${sku_code}`,
        });
      }

      // ================= CREATE CHILD BATCH + BATCH SPLIT TRACKING =================
      const childBatch = await InventoryTrackingService.distributeBatch(
        {
          parent_batch_id: parentBatch.id,
          to_organization_id,
          quantity: Number(qty),
          weight: Number(weight || item.gross_weight || 0),
          reference_type: "DISTRICT_TO_RETAIL_DIRECT_TRANSFER",
          reference_id: transfer.id,
          remarks: remarks || "District to retail direct transfer",
          handled_by: user.id,
        },
        { transaction }
      );

      // ================= REDUCE STOCK INVENTORY AFTER TRANSFER =================
      await sequelize.query(
        `
        UPDATE stocks
        SET 
          available_qty = available_qty - :qty,
          transit_qty = COALESCE(transit_qty, 0) + :qty,
          updated_at = NOW()
        WHERE id = :stock_id
        `,
        {
          replacements: {
            qty: Number(qty),
            stock_id: stock.id,
          },
          type: QueryTypes.UPDATE,
          transaction,
        }
      );

      await StockTransferItem.create(
        {
          transfer_id: transfer.id,

          item_id: item.id,

          batch_id: childBatch?.id || childBatch?.batch_id || null,
          root_batch_id:
            childBatch?.root_batch_id ||
            parentBatch.root_batch_id ||
            parentBatch.id,
          parent_batch_id: parentBatch.id,

          qty: Number(qty),

          weight: Number(weight || item.gross_weight || 0),

          rate: Number(rate || item.sale_rate || 0),

          remarks: remarks || null,

          external_item_data: {
            item_id: item.id,

            parent_batch_id: parentBatch.id,
            parent_batch_no: parentBatch.batch_no,

            batch_id: childBatch?.id || childBatch?.batch_id || null,
            batch_no: childBatch?.batch_no || null,

            root_batch_id:
              childBatch?.root_batch_id ||
              parentBatch.root_batch_id ||
              parentBatch.id,

            item_name: item.item_name,
            article_code: item.article_code,
            sku_code: item.sku_code,
            metal_type: item.metal_type,
            category: item.category,
            subcategory: item.subcategory,
            details: item.details,
            purity: item.purity,
            gross_weight: item.gross_weight,
            net_weight: item.net_weight,
            stone_weight: item.stone_weight,
            stone_amount: item.stone_amount,
            making_charge: item.making_charge,
            purchase_rate: item.purchase_rate,
            sale_rate: item.sale_rate,
            hsn_code: item.hsn_code,
            unit: item.unit,
            organization_id: item.organization_id,
          },
        },
        { transaction }
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "District to retail item dispatched successfully",
      data: {
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        status: "in_transit",
      },
    });
  } catch (error) {
    await safeRollback();

    console.error("dispatchDistrictToRetailDirectTransfer error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    for (const filePath of uploadedLocalPaths) {
      try {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error("Local file cleanup error:", err.message);
      }
    }
  }
};
