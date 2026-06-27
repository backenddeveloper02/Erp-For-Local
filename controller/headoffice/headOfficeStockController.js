import sequelize from "../config/db.js";
import { Op } from "sequelize";

// import {
//   StockRequest,
//   StockRequestItem,
//   StockTransfer,
//   StockTransferItem,
//   Item,
//   Stock,
//   Store, 
// } from "../models/index.js";

import StockRequest from "../../model/StockRequest.js"
import StockRequestItem from "../../model/stockRequestItem.js"
import StockTransfer from "../../model/stockTransfer.js"
import StockTransferItem from "../../model/stockTransferItem.js"
import Item from "../../model/item.js"
import Stock from "../../model/stockrecord.js"
import Store from "../../model/Store.js"
const getStoreIdFromHeader = async (req) => {
  const store = await Store.findOne({
    where: { store_code: req.headers.store_code },
    attributes: ["id"],
    raw: true,
  });

  if (!store) throw new Error("Store not found");

  return store.id;
};



export const getReceivedRequestsHO = async (req, res) => {
  try {
    if (req.headers.organization_level !== "head_office") {
      return res.status(403).json({ message: "Access denied" });
    }

   
    const storeId = await getStoreIdFromHeader(req);

    const requests = await StockRequest.findAll({
      where: {
        to_organization_id: storeId, 
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
                "article_code",
                "sku_code",
                "item_name",
                "metal_type",
                "category",
                "purity",
                "gross_weight",
                "net_weight",
                "stone_weight",
                "making_charge",
                "purchase_rate",
                "sale_rate",
                "hsn_code",
                "unit",
                "current_status",
                "store_id",
              ],
            },
          ],
        },
        {
          model: StockTransfer,
          as: "transfer",
        },
      ],
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (err) {
    console.error("getReceivedRequestsHO error:", err);
    return res.status(500).json({ error: err.message });
  }
};



export const getRequestDetailsHO = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await StockRequest.findByPk(id, {
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
                "article_code",
                "sku_code",
                "item_name",
                "metal_type",
                "category",
                "purity",
                "gross_weight",
                "net_weight",
                "stone_weight",
                "making_charge",
                "purchase_rate",
                "sale_rate",
                "hsn_code",
                "unit",
                "current_status",
                "store_id",
              ],
            },
          ],
        },
      ],
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    return res.status(200).json({
      success: true,
      data: request,
    });
  } catch (err) {
    console.error("getRequestDetailsHO error:", err);
    return res.status(500).json({ error: err.message });
  }
};


// ==========================================
// 3. APPROVE + DISPATCH
// ==========================================
export const approveAndDispatchHO = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { items } = req.body;

    const request = await StockRequest.findByPk(id, { transaction: t });

    if (!request) throw new Error("Request not found");

    const requestItems = await StockRequestItem.findAll({
      where: { request_id: request.id },
      transaction: t,
    });

    const map = new Map(
      requestItems.map((i) => [i.item_id, i])
    );

    const transfer = await StockTransfer.create(
      {
        transfer_no: "TRF-" + Date.now(),
        request_id: request.id,
        status: "in_transit",
      },
      { transaction: t }
    );

    for (let i of items) {
      const reqItem = map.get(i.item_id);

      if (!reqItem) throw new Error("Invalid item");

      await StockTransferItem.create(
        {
          transfer_id: transfer.id,
          item_id: i.item_id,
          qty: i.qty,
        },
        { transaction: t }
      );
    }

    await request.update(
      { status: "approved" },
      { transaction: t }
    );

    await t.commit();

    return res.json({
      success: true,
      message: "Approved & Dispatched",
    });
  } catch (err) {
    await t.rollback();
    console.error("approveAndDispatchHO error:", err);
    return res.status(500).json({ error: err.message });
  }
};


// ==========================================
// 4. REJECT
// ==========================================
export const rejectRequestHO = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await StockRequest.findByPk(id);

    if (!request) {
      return res.status(404).json({ message: "Not found" });
    }

    await request.update({ status: "rejected" });

    return res.json({
      success: true,
      message: "Rejected",
    });
  } catch (err) {
    console.error("rejectRequestHO error:", err);
    return res.status(500).json({ error: err.message });
  }
};