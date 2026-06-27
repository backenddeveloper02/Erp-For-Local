import axios from "axios";
import Item from "../models/Item.js";
import Stock from "../models/Stock.js";
import Store from "../models/Store.js";

const WEBSITE_BACKEND_URL = process.env.WEBSITE_BACKEND_URL;
const WEBSITE_SYNC_SECRET = process.env.WEBSITE_SYNC_SECRET;

// =============================
// COMMON API CALL
// =============================
const sendToWebsiteBackend = async (endpoint, payload) => {
  try {
    if (!WEBSITE_BACKEND_URL) {
      console.log("WEBSITE_BACKEND_URL missing");
      return;
    }

    await axios.post(`${WEBSITE_BACKEND_URL}${endpoint}`, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": WEBSITE_SYNC_SECRET,
      },
      timeout: 10000,
    });

    console.log(`Website sync success: ${endpoint}`);
  } catch (error) {
    console.error(`Website sync failed: ${endpoint}`, {
      message: error.message,
      response: error?.response?.data,
    });
  }
};

// =============================
// SYNC PRODUCT
// =============================
export const syncProduct = async (itemId) => {
  try {
    if (!itemId) return;

    const item = await Item.findByPk(itemId);

    if (!item) {
      console.log("Sync product skipped: Item not found", itemId);
      return;
    }

    const payload = {
      erp_item_id: item.id,
      erp_article_code: item.article_code,
      erp_sku_code: item.sku_code,

      name: item.item_name,
      price: Number(item.sale_rate || 0),
      category: item.category,
      metal: item.metal_type,
      description: item.details,

      purity: item.purity,
      gross_weight: Number(item.gross_weight || 0),
      net_weight: Number(item.net_weight || 0),
      stone_weight: Number(item.stone_weight || 0),
      stone_amount: Number(item.stone_amount || 0),
      making_charge: Number(item.making_charge || 0),
      purchase_rate: Number(item.purchase_rate || 0),
      unit: item.unit,
      hsn_code: item.hsn_code,
      current_status: item.current_status,

      thumbnail: {
        url: item.image_url || null,
        public_id: item.image_public_id || null,
      },

      store_code: item.storeCode || null,
      store_name: item.storeName || null,
      organization_id: item.organization_id || null,

      is_active: item.is_active,

      erp_created_at: item.createdAt,
      erp_updated_at: item.updatedAt,
    };

    await sendToWebsiteBackend("/api/sync/product", payload);
  } catch (error) {
    console.error("syncProduct error:", error.message);
  }
};

// =============================
// SYNC INVENTORY
// =============================
export const syncInventory = async (itemId) => {
  try {
    if (!itemId) return;

    const stocks = await Stock.findAll({
      where: {
        item_id: itemId,
      },
    });

    if (!stocks.length) {
      console.log("Sync inventory skipped: Stock not found", itemId);
      return;
    }

    const payload = stocks.map((stock) => ({
      erp_stock_id: stock.id,
      erp_item_id: stock.item_id,
      erp_store_id: stock.organization_id,
      store_code: stock.store_code,

      available_qty: Number(stock.available_qty || 0),
      available_weight: Number(stock.available_weight || 0),

      is_available: Number(stock.available_qty || 0) > 0,

      erp_updated_at: stock.updated_at,
    }));

    await sendToWebsiteBackend("/api/sync/inventory", {
      erp_item_id: itemId,
      inventory: payload,
    });
  } catch (error) {
    console.error("syncInventory error:", error.message);
  }
};

// =============================
// SYNC STORE
// =============================
export const syncStore = async (storeId) => {
  try {
    if (!storeId) return;

    const store = await Store.findByPk(storeId);

    if (!store) {
      console.log("Sync store skipped: Store not found", storeId);
      return;
    }

    const payload = {
      erp_store_id: store.id,
      store_code: store.store_code,
      store_name: store.store_name,

      organization_level: store.organizationlevel,
      state: store.state,
      district: store.district,
      district_id: store.district_id,

      address: store.address,
      phone_number: store.phone_number,

      is_active: store.is_active,

      erp_created_at: store.createdAt,
      erp_updated_at: store.updatedAt,
    };

    await sendToWebsiteBackend("/api/sync/store", payload);
  } catch (error) {
    console.error("syncStore error:", error.message);
  }
};