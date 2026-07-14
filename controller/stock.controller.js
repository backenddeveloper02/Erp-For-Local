import { Op, QueryTypes } from "sequelize";
// import Ledger from "../model/ladger.js";
// import Task from "../model/task.js";
import sequelize from "../config/db.js";
import QRCode from "qrcode";
// import QRCode from "qrcode";
import path from "path";
import { pathToFileURL } from "url";
import crypto from "crypto";
import Item from "../model/item.js";
import Stock from "../model/stockrecord.js";
import StockMovement from "../model/stockmovement.js";
// import StockMovement from "../models/StockMovement.js";
import ActivityLog from "../model/activityLog.js";
import SystemActivity from "../model/systemActivity.js";
import Store from "../model/Store.js";
import { createActivityLog } from "../service/activity.service.js";
// import {generateItemQR} from "../service/qrgen.js"
import XLSX from "xlsx";
import uploadToCloudinary from "../utils/uploadToCloudinary.js";
import { InventoryTrackingService } from "../service/inventoryTracking.service.js";
import CodeSequence from "../model/codeSequenceModel.js";
/* =========================================================
   HELPERS
========================================================= */
const hasAttr = (model, attr) => !!model?.rawAttributes?.[attr];

const pickAttr = (model, attrs = []) => {
  for (const attr of attrs) {
    if (hasAttr(model, attr)) return attr;
  }
  return null;
};

const QR_SECRET = process.env.QR_SECRET || "change-this-secret";

const signQRPayload = (payload) => {
  return crypto
    .createHmac("sha256", QR_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
};

const generateItemQR = async (item) => {
  const qrCode = item.sku_code || item.article_code;

  if (!qrCode) {
    throw new Error("QR value missing");
  }

  const payload = {
    type: "ITEM",
    item_id: item.id,
    code: qrCode,
    organization_id: item.organization_id,
  };

  const qrValue = JSON.stringify({
    payload,
    signature: signQRPayload(payload),
  });

  const qrCodeUrl = await QRCode.toDataURL(qrValue, {
    width: 300,
    margin: 2,
  });

  return {
    qr_code_value: qrValue,
    qr_code_url: qrCodeUrl,
  };
};
const getCreatedKey = (model) =>
  pickAttr(model, ["created_at", "createdAt"]) || "id";

export const getRetailInventory = async (req, res) => {
  try {
    const user = req.user;

    const {
      search,
      category,
      metal_type,
      page = 1,
      limit = 1000,
    } = req.query;

    // =====================================================
    // AUTHENTICATION
    // =====================================================

    if (!user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const role = String(user.role || "")
      .trim()
      .toLowerCase();

    const cleanStoreCode = String(
      user.store_code ||
      user.storeCode ||
      ""
    )
      .trim()
      .toUpperCase();

    if (
      !cleanStoreCode &&
      role !== "super_admin"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Store code missing in login user",
      });
    }

    // =====================================================
    // PAGINATION
    // Category cards par pagination lagegi
    // =====================================================

    const pageNumber = Math.max(
      Number(page) || 1,
      1
    );

    const pageLimit = Math.max(
      Number(limit) || 1000,
      1
    );

    const offset =
      (pageNumber - 1) * pageLimit;

    // =====================================================
    // ITEM AND STOCK FILTERS
    // =====================================================

    const itemWhere = {};
    const stockWhere = {};

    /*
     * IMPORTANT:
     *
     * items.storeCode par filter nahi lagayenge.
     *
     * Item originally Head Office, Retail Store ya kisi
     * dusre store ka ho sakta hai.
     *
     * Current inventory location stocks.store_code se
     * decide hogi.
     *
     * Example:
     * items.storeCode = STR503
     * stocks.store_code = DST500
     *
     * Iska matlab item abhi DST500 ke stock me hai.
     */

    if (role !== "super_admin") {
      stockWhere.store_code =
        cleanStoreCode;
    }

    if (category) {
      itemWhere.category = {
        [Op.iLike]:
          String(category).trim(),
      };
    }

    if (metal_type) {
      itemWhere.metal_type = {
        [Op.iLike]:
          String(metal_type).trim(),
      };
    }

    if (search) {
      const cleanSearch =
        String(search).trim();

      itemWhere[Op.or] = [
        {
          item_name: {
            [Op.iLike]:
              `%${cleanSearch}%`,
          },
        },
        {
          article_code: {
            [Op.iLike]:
              `%${cleanSearch}%`,
          },
        },
        {
          sku_code: {
            [Op.iLike]:
              `%${cleanSearch}%`,
          },
        },
        {
          category: {
            [Op.iLike]:
              `%${cleanSearch}%`,
          },
        },
        {
          metal_type: {
            [Op.iLike]:
              `%${cleanSearch}%`,
          },
        },
        {
          purity: {
            [Op.iLike]:
              `%${cleanSearch}%`,
          },
        },
      ];
    }

    // =====================================================
    // FETCH MATCHING ITEMS
    // =====================================================
    //
    // Non-super-admin ke case me Stock include required true
    // rahega.
    //
    // Isse sirf wahi items aayenge jinki current store ke
    // stocks table me row available hai.
    //
    // items.storeCode match hona zaroori nahi hai.
    // =====================================================

    const items = await Item.findAll({
      where: itemWhere,

      attributes: [
        "id",
        "item_name",
        "article_code",
        "sku_code",
        "category",
        "metal_type",
        "purity",
        "net_weight",
        "stone_weight",
        "gross_weight",
        "sale_rate",
        "making_charge",
        "current_status",
        "storeCode",
        "organization_id",
        "createdAt",
        "image_url",
      ],

      include: [
        {
          model: Stock,
          as: "stocks",

          /*
           * Current store ke bina stock wale items
           * response me include nahi honge.
           */
          required:
            role !== "super_admin",

          where:
            Object.keys(stockWhere).length > 0
              ? stockWhere
              : undefined,

          attributes: [
            "id",
            "item_id",
            "organization_id",
            "store_code",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "dead_qty",
            "dead_weight",
          ],
        },
      ],

      order: [
        ["id", "DESC"],
      ],

      subQuery: false,

      distinct: true,
    });

    // =====================================================
    // ITEM IDS
    // =====================================================

    const itemIds = items
      .map((item) =>
        Number(item.id)
      )
      .filter(Boolean);

    // =====================================================
    // BATCH INFORMATION
    // =====================================================

    const batchMap = {};

    if (itemIds.length > 0) {
      const batches =
        await sequelize.query(
          `
            SELECT DISTINCT ON (
              ib.item_id
            )
              ib.item_id,
              ib.id AS batch_id,
              ib.parent_batch_id,
              ib.root_batch_id,
              ib.batch_no

            FROM inventory_batches ib

            WHERE ib.item_id
              IN (:item_ids)

            ORDER BY
              ib.item_id,

              CASE
                WHEN ib.parent_batch_id
                  IS NULL
                THEN 0
                ELSE 1
              END,

              ib.id DESC
          `,
          {
            replacements: {
              item_ids: itemIds,
            },

            type:
              sequelize.QueryTypes
                .SELECT,
          }
        );

      for (const batch of batches) {
        batchMap[
          Number(batch.item_id)
        ] = {
          batch_id:
            batch.batch_id
              ? Number(
                  batch.batch_id
                )
              : null,

          parent_batch_id:
            batch.parent_batch_id
              ? Number(
                  batch.parent_batch_id
                )
              : null,

          root_batch_id:
            batch.root_batch_id
              ? Number(
                  batch.root_batch_id
                )
              : null,

          batch_no:
            batch.batch_no ||
            null,
        };
      }
    }

    // =====================================================
    // CATEGORY-WISE AGGREGATION
    // =====================================================

    const categoryMap =
      new Map();

    let lowStockItems = 0;
    let transitGoods = 0;

    for (const item of items) {
      const stocks =
        Array.isArray(item.stocks)
          ? item.stocks
          : [];

      // ===================================================
      // INDIVIDUAL ITEM STOCK TOTALS
      // ===================================================

      const itemAvailableQty =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.available_qty ||
              0
            ),
          0
        );

      const itemAvailableWeight =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.available_weight ||
              0
            ),
          0
        );

      const itemReservedQty =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.reserved_qty ||
              0
            ),
          0
        );

      const itemReservedWeight =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.reserved_weight ||
              0
            ),
          0
        );

      const itemTransitQty =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.transit_qty ||
              0
            ),
          0
        );

      const itemTransitWeight =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.transit_weight ||
              0
            ),
          0
        );

      const itemDeadQty =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.dead_qty ||
              0
            ),
          0
        );

      const itemDeadWeight =
        stocks.reduce(
          (sum, stock) =>
            sum +
            Number(
              stock.dead_weight ||
              0
            ),
          0
        );

      transitGoods +=
        itemTransitQty;

      // Individual SKU/item basis par low stock count
      if (
        itemAvailableQty > 0 &&
        itemAvailableQty <= 5
      ) {
        lowStockItems += 1;
      }

      const categoryName =
        String(
          item.category || ""
        ).trim() || "Others";

      const categoryKey =
        categoryName.toLowerCase();

      // ===================================================
      // CREATE CATEGORY
      // ===================================================

      if (
        !categoryMap.has(
          categoryKey
        )
      ) {
        const batch =
          batchMap[
            Number(item.id)
          ] || {};

        categoryMap.set(
          categoryKey,
          {
            id:
              item.id,

            item_name:
              item.item_name,

            article_code:
              item.article_code,

            sku_code:
              item.sku_code,

            parent_batch_id:
              batch.parent_batch_id ||
              null,

            root_batch_id:
              batch.root_batch_id ||
              null,

            batch_id:
              batch.batch_id ||
              null,

            batch_no:
              batch.batch_no ||
              null,

            category:
              categoryName,

            image_url:
              item.image_url ||
              null,

            total_category_items:
              0,

            metal_type:
              item.metal_type,

            purity:
              item.purity,

            quantity:
              0,

            available_qty:
              0,

            available_weight:
              0,

            reserved_qty:
              0,

            reserved_weight:
              0,

            transit_qty:
              0,

            transit_weight:
              0,

            dead_qty:
              0,

            dead_weight:
              0,

            net_weight:
              Number(
                item.net_weight ||
                0
              ),

            gross_weight:
              Number(
                item.gross_weight ||
                0
              ),

            stone_weight:
              Number(
                item.stone_weight ||
                0
              ),

            selling_price:
              Number(
                item.sale_rate ||
                0
              ),

            making_charge:
              Number(
                item.making_charge ||
                0
              ),

            current_status:
              item.current_status,

            /*
             * Current store code stocks table se
             * decide ho raha hai.
             */
            storeCode:
              cleanStoreCode ||
              item.storeCode ||
              null,

            organization_id:
              stocks?.[0]
                ?.organization_id ||
              item.organization_id ||
              null,

            stocks: [],

            items: [],
          }
        );
      }

      const categoryData =
        categoryMap.get(
          categoryKey
        );

      // ===================================================
      // CATEGORY TOTALS
      // ===================================================

      categoryData
        .total_category_items += 1;

      categoryData.quantity +=
        itemAvailableQty;

      categoryData.available_qty +=
        itemAvailableQty;

      categoryData.available_weight +=
        itemAvailableWeight;

      categoryData.reserved_qty +=
        itemReservedQty;

      categoryData.reserved_weight +=
        itemReservedWeight;

      categoryData.transit_qty +=
        itemTransitQty;

      categoryData.transit_weight +=
        itemTransitWeight;

      categoryData.dead_qty +=
        itemDeadQty;

      categoryData.dead_weight +=
        itemDeadWeight;

      // ===================================================
      // CATEGORY STOCK ROWS
      // ===================================================

      for (
        const stock of stocks
      ) {
        categoryData.stocks.push({
          id:
            stock.id,

          item_id:
            stock.item_id,

          organization_id:
            stock.organization_id ||
            null,

          store_code:
            stock.store_code ||
            cleanStoreCode ||
            null,

          available_qty:
            Number(
              stock.available_qty ||
              0
            ),

          available_weight:
            Number(
              stock.available_weight ||
              0
            ),

          reserved_qty:
            Number(
              stock.reserved_qty ||
              0
            ),

          reserved_weight:
            Number(
              stock.reserved_weight ||
              0
            ),

          transit_qty:
            Number(
              stock.transit_qty ||
              0
            ),

          transit_weight:
            Number(
              stock.transit_weight ||
              0
            ),

          dead_qty:
            Number(
              stock.dead_qty ||
              0
            ),

          dead_weight:
            Number(
              stock.dead_weight ||
              0
            ),
        });
      }

      // ===================================================
      // INDIVIDUAL ITEM DETAILS
      // ===================================================

      const itemBatch =
        batchMap[
          Number(item.id)
        ] || {};

      categoryData.items.push({
        id:
          item.id,

        item_name:
          item.item_name,

        article_code:
          item.article_code,

        sku_code:
          item.sku_code,

        category:
          categoryName,

        metal_type:
          item.metal_type,

        purity:
          item.purity,

        image_url:
          item.image_url ||
          null,

        available_qty:
          itemAvailableQty,

        available_weight:
          itemAvailableWeight,

        reserved_qty:
          itemReservedQty,

        reserved_weight:
          itemReservedWeight,

        transit_qty:
          itemTransitQty,

        transit_weight:
          itemTransitWeight,

        dead_qty:
          itemDeadQty,

        dead_weight:
          itemDeadWeight,

        current_status:
          itemAvailableQty > 0
            ? "in_stock"
            : "out_of_stock",

        /*
         * Original item.storeCode response me
         * reference ke liye diya gaya hai.
         */
        original_item_store_code:
          item.storeCode ||
          null,

        /*
         * Current inventory store stocks table
         * se liya gaya hai.
         */
        storeCode:
          stocks?.[0]
            ?.store_code ||
          cleanStoreCode ||
          null,

        organization_id:
          stocks?.[0]
            ?.organization_id ||
          item.organization_id ||
          null,

        batch_id:
          itemBatch.batch_id ||
          null,

        parent_batch_id:
          itemBatch
            .parent_batch_id ||
          null,

        root_batch_id:
          itemBatch
            .root_batch_id ||
          null,

        batch_no:
          itemBatch.batch_no ||
          null,
      });
    }

    // =====================================================
    // FINAL CATEGORY DATA
    // =====================================================

    const allCategoryData =
      Array.from(
        categoryMap.values()
      ).map(
        (categoryItem) => ({
          ...categoryItem,

          quantity:
            Number(
              categoryItem
                .quantity || 0
            ),

          available_qty:
            Number(
              categoryItem
                .available_qty || 0
            ),

          available_weight:
            Number(
              Number(
                categoryItem
                  .available_weight ||
                  0
              ).toFixed(3)
            ),

          reserved_qty:
            Number(
              categoryItem
                .reserved_qty || 0
            ),

          reserved_weight:
            Number(
              Number(
                categoryItem
                  .reserved_weight ||
                  0
              ).toFixed(3)
            ),

          transit_qty:
            Number(
              categoryItem
                .transit_qty || 0
            ),

          transit_weight:
            Number(
              Number(
                categoryItem
                  .transit_weight ||
                  0
              ).toFixed(3)
            ),

          dead_qty:
            Number(
              categoryItem
                .dead_qty || 0
            ),

          dead_weight:
            Number(
              Number(
                categoryItem
                  .dead_weight ||
                  0
              ).toFixed(3)
            ),

          current_status:
            Number(
              categoryItem
                .available_qty || 0
            ) > 0
              ? "in_stock"
              : "out_of_stock",
        })
      );

    // =====================================================
    // TOTAL STOCK ITEMS
    // =====================================================
    //
    // Sirf current logged-in store ki available quantity.
    //
    // DST500 ke case me:
    // SUM(stocks.available_qty)
    // WHERE stocks.store_code = 'DST500'
    // =====================================================

    const totalStockItems =
      allCategoryData.reduce(
        (
          sum,
          categoryItem
        ) =>
          sum +
          Number(
            categoryItem
              .quantity || 0
          ),
        0
      );

    // =====================================================
    // DEAD STOCK
    // =====================================================

    let deadStockItems = 0;

    if (itemIds.length > 0) {
      let storeCondition = "";

      const replacements = {
        item_ids:
          itemIds,
      };

      if (
        role !== "super_admin"
      ) {
        storeCondition = `
          AND UPPER(
            TRIM(
              COALESCE(
                s.store_code,
                ''
              )
            )
          ) = :storeCode
        `;

        replacements.storeCode =
          cleanStoreCode;
      }

      const deadStockResult =
        await sequelize.query(
          `
            SELECT
              COUNT(
                DISTINCT i.id
              )::int AS dead_stock_items

            FROM items i

            INNER JOIN stocks s
              ON s.item_id = i.id

            WHERE i.id
              IN (:item_ids)

              ${storeCondition}

              AND COALESCE(
                s.available_qty,
                0
              ) > 0

              AND i."createdAt"
                < NOW()
                  - INTERVAL '30 days'

              AND NOT EXISTS (
                SELECT 1

                FROM invoice_items ii

                INNER JOIN invoices inv
                  ON inv.id =
                    ii.invoice_id

                WHERE ii.item_id =
                  i.id

                  AND inv."createdAt"
                    > NOW()
                      - INTERVAL '30 days'
              )
          `,
          {
            replacements,

            type:
              sequelize.QueryTypes
                .SELECT,
          }
        );

      deadStockItems =
        Number(
          deadStockResult?.[0]
            ?.dead_stock_items ||
          0
        );
    }

    // =====================================================
    // CATEGORY-WISE PAGINATION
    // =====================================================

    const totalCategories =
      allCategoryData.length;

    const totalPages =
      totalCategories > 0
        ? Math.ceil(
            totalCategories /
            pageLimit
          )
        : 0;

    const paginatedData =
      allCategoryData.slice(
        offset,
        offset + pageLimit
      );

    const currentPageStockItems =
      paginatedData.reduce(
        (
          sum,
          categoryItem
        ) =>
          sum +
          Number(
            categoryItem
              .quantity || 0
          ),
        0
      );

    // =====================================================
    // RESPONSE
    // =====================================================

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Retail inventory fetched successfully",

        summary: {
          /*
           * Current logged-in store ki total
           * available quantity.
           */
          total_stock_items:
            totalStockItems,

          dead_stock_items:
            deadStockItems,

          low_stock_items:
            lowStockItems,

          transit_goods:
            transitGoods,

          current_page_stock_items:
            currentPageStockItems,

          store_code:
            role !== "super_admin"
              ? cleanStoreCode
              : null,
        },

        pagination: {
          page:
            pageNumber,

          limit:
            pageLimit,

          total_categories:
            totalCategories,

          total_pages:
            totalPages,

          has_next_page:
            pageNumber <
            totalPages,

          has_previous_page:
            pageNumber > 1,
        },

        count:
          paginatedData.length,

        data:
          paginatedData,
      });
  } catch (error) {
    console.error(
      "getRetailInventory error:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        message:
          "Failed to fetch retail inventory",

        error:
          error.message,
      });
  }
};
export const getDistrictInventory = async (req, res) => {
  try {
    const user = req.user;
    const { search, category, metal_type } = req.query;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (
      user.role !== "district_manager" &&
      String(user.organization_level || "").toLowerCase() !== "district"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this inventory",
      });
    }

    const districtOrgId = Number(user.organization_id);
    const districtCode = user.store_code || user.storeCode;

    if (!districtOrgId || !districtCode) {
      return res.status(400).json({
        success: false,
        message: "District organization id or code not found",
      });
    }

    const whereClause = {
      organization_id: districtOrgId,
      storeCode: districtCode,
    };

    if (category) {
      whereClause.category = category;
    }

    if (metal_type) {
      whereClause.metal_type = metal_type;
    }

    if (search) {
      whereClause[Op.or] = [
        { article_code: { [Op.iLike]: `%${search}%` } },
        { sku_code: { [Op.iLike]: `%${search}%` } },
        { item_name: { [Op.iLike]: `%${search}%` } },
        { category: { [Op.iLike]: `%${search}%` } },
        { purity: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const items = await Item.findAll({
      where: whereClause,
      attributes: [
        "id",
        "article_code",
        "sku_code",
        "item_name",
        "metal_type",
        "category",
        "details",
        "purity",
        "gross_weight",
        "net_weight",
        "stone_weight",
        "stone_amount",
        "making_charge",
        "purchase_rate",
        "sale_rate",
        "hsn_code",
        "unit",
        "current_status",
        "store_id",
        "storeCode",
        "storeName",
        "organization_id",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          attributes: [
            "id",
            "organization_id",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
          where: {
            organization_id: districtOrgId,
          },
        },
      ],
      order: [["id", "DESC"]],
    });

    let totalStockItems = 0;
    let deadStockItems = 0;
    let lowStockItems = 0;
    let transitGoods = 0;

    const LOW_STOCK_THRESHOLD = 5;

    const grouped = {};

    for (const item of items) {
      const key = item.category || "Other";
      const stocks = Array.isArray(item.stocks) ? item.stocks : [];

      let itemAvailableQty = 0;
      let itemTransitQty = 0;
      let itemDeadQty = 0;

      for (const stock of stocks) {
        itemAvailableQty += Number(stock.available_qty || 0);
        itemTransitQty += Number(stock.transit_qty || 0);
        itemDeadQty += Number(stock.dead_qty || 0);
      }

      totalStockItems += itemAvailableQty;
      transitGoods += itemTransitQty;
      deadStockItems += itemDeadQty;

      if (itemAvailableQty > 0 && itemAvailableQty <= LOW_STOCK_THRESHOLD) {
        lowStockItems += 1;
      }

      if (!grouped[key]) {
        grouped[key] = {
          category: key,
          code: item.article_code || "-",
          quantity: 0,
          selling_price: Number(item.sale_rate || 0),
          making_charge: Number(item.making_charge || 0),
          purity: item.purity || "-",
          net_weight: 0,
          stone_weight: 0,
          gross_weight: 0,
          action: "View Details",
        };
      }

      grouped[key].quantity += itemAvailableQty;
      grouped[key].net_weight += Number(item.net_weight || 0);
      grouped[key].stone_weight += Number(item.stone_weight || 0);
      grouped[key].gross_weight += Number(item.gross_weight || 0);
    }

    const data = Object.values(grouped).map((row) => ({
      ...row,
      quantity: Number(row.quantity.toFixed(3)),
      net_weight: Number(row.net_weight.toFixed(3)),
      stone_weight: Number(row.stone_weight.toFixed(3)),
      gross_weight: Number(row.gross_weight.toFixed(3)),
    }));

    return res.status(200).json({
      success: true,
      message: "District inventory fetched successfully",
      organization_id: districtOrgId,
      store_code: districtCode,
      summary: {
        total_stock_items: Number(totalStockItems.toFixed(3)),
        dead_stock_items: Number(deadStockItems.toFixed(3)),
        low_stock_items: lowStockItems,
        transit_goods: Number(transitGoods.toFixed(3)),
      },
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getDistrictInventory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district inventory",
      error: error.message,
    });
  }
};
/* =========================================================
   STOCK OF ALL CATOGARY
========================================================= */



export const getStockItemsByCategory = async (req, res) => {
  try {
    const user = req.user;

    const { category } = req.params;

    const {
      organization_id,
      organization_level,
      search,
      metal_type,
    } = req.query;

    let orgId = null;

    // =====================================================
    // NORMALIZE ORGANIZATION LEVEL
    // =====================================================

    const normalizeOrganizationLevel = (level) => {
      if (!level) return null;

      const value = String(level)
        .trim()
        .toLowerCase();

      if (value === "retail") return "Retail";

      if (value === "district") return "District";

      if (value === "head") return "head_office";

      if (value === "head_office") {
        return "head_office";
      }

      return level;
    };

    const normalizedOrganizationLevel =
      normalizeOrganizationLevel(organization_level);


    const getAuditBusinessDate = () => {
      const indiaNow = new Date(
        new Date().toLocaleString("en-US", {
          timeZone: "Asia/Kolkata",
        })
      );

      if (indiaNow.getHours() < 8) {
        indiaNow.setDate(
          indiaNow.getDate() - 1
        );
      }

      return indiaNow
        .toISOString()
        .slice(0, 10);
    };

    const isSameDate = (
      dateValue,
      targetDate
    ) => {
      if (!dateValue) return false;

      return (
        new Date(dateValue)
          .toISOString()
          .slice(0, 10) === targetDate
      );
    };

    // =====================================================
    // AUTHENTICATION
    // =====================================================

    if (!user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    // =====================================================
    // RESOLVE ORGANIZATION
    // =====================================================

    if (user.role === "super_admin") {
      orgId = organization_id
        ? Number(organization_id)
        : null;
    } else {
      orgId = user.organization_id
        ? Number(user.organization_id)
        : null;
    }

    if (
      user.role !== "super_admin" &&
      !orgId
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Organization not found for this user",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    // =====================================================
    // ITEM AND STOCK FILTERS
    // =====================================================

    const itemWhere = {
      category: {
        [Op.iLike]: String(category).trim(),
      },
    };

    const stockWhere = {};

    let targetOrgId = null;
    let targetStoreCode = null;

    // =====================================================
    // ORGANIZATION ID + LEVEL FILTER
    // =====================================================

    if (
      organization_id &&
      normalizedOrganizationLevel
    ) {
      targetOrgId = Number(
        organization_id
      );

      if (
        !Number.isFinite(targetOrgId) ||
        targetOrgId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid organization_id",
        });
      }

      const targetStore =
        await Store.findOne({
          where: {
            id: targetOrgId,
            organization_level:
              normalizedOrganizationLevel,
            is_active: true,
          },

          attributes: [
            "id",
            "store_code",
            "store_name",
            "organization_level",
          ],
        });

      if (!targetStore) {
        return res.status(404).json({
          success: false,
          message:
            "Organization not found for given organization_id and organization_level",
        });
      }

      targetStoreCode = String(
        targetStore.store_code || ""
      )
        .trim()
        .toUpperCase();

      itemWhere.organization_id =
        targetOrgId;

      itemWhere.storeCode =
        targetStoreCode;

      stockWhere.organization_id =
        targetOrgId;

      stockWhere.store_code =
        targetStoreCode;
    } else if (
      user.role !== "super_admin"
    ) {
      const cleanStoreCode = String(
        user.store_code ||
          user.storeCode ||
          ""
      )
        .trim()
        .toUpperCase();

      if (!cleanStoreCode) {
        return res.status(400).json({
          success: false,
          message:
            "Store code missing in login user",
        });
      }

      itemWhere.organization_id =
        Number(user.organization_id);

      itemWhere.storeCode =
        cleanStoreCode;

      stockWhere.organization_id =
        Number(user.organization_id);

      stockWhere.store_code =
        cleanStoreCode;

      targetOrgId = Number(
        user.organization_id
      );

      targetStoreCode =
        cleanStoreCode;
    } else if (
      user.role === "super_admin" &&
      organization_id
    ) {
      targetOrgId = Number(
        organization_id
      );

      if (
        !Number.isFinite(targetOrgId) ||
        targetOrgId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid organization_id",
        });
      }

      const targetStore =
        await Store.findOne({
          where: {
            id: targetOrgId,
            is_active: true,
          },

          attributes: [
            "id",
            "store_code",
            "store_name",
            "organization_level",
          ],
        });

      if (!targetStore) {
        return res.status(404).json({
          success: false,
          message:
            "Organization not found",
        });
      }

      targetStoreCode = String(
        targetStore.store_code || ""
      )
        .trim()
        .toUpperCase();

      itemWhere.organization_id =
        targetOrgId;

      itemWhere.storeCode =
        targetStoreCode;

      stockWhere.organization_id =
        targetOrgId;

      stockWhere.store_code =
        targetStoreCode;
    }

    // =====================================================
    // METAL TYPE FILTER
    // =====================================================

    if (metal_type) {
      itemWhere.metal_type = {
        [Op.iLike]: String(
          metal_type
        ).trim(),
      };
    }

    // =====================================================
    // SEARCH FILTER
    // =====================================================

    if (search) {
      const cleanSearch = String(
        search
      ).trim();

      itemWhere[Op.or] = [
        {
          item_name: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },

        {
          article_code: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },

        {
          sku_code: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },

        {
          purity: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },

        {
          category: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },
      ];
    }

    // =====================================================
    // FETCH ITEMS WITH ALL STOCK ROWS
    // =====================================================

    const items = await Item.findAll({
      attributes: [
        "id",
        "article_code",
        "sku_code",
        "item_name",
        "metal_type",
        "category",
        "details",
        "purity",
        "gross_weight",
        "net_weight",
        "stone_weight",
        "stone_amount",
        "making_charge",
        "purchase_rate",
        "sale_rate",
        "hsn_code",
        "unit",
        "current_status",
        "organization_id",
        "storeCode",
        "isItemAudit",
        "itemAuditAt",
        "createdAt",
        "updatedAt",
        "image_url",
      ],

      where: itemWhere,

      include: [
        {
          model: Stock,

          as: "stocks",

          required: false,

          where:
            Object.keys(stockWhere).length >
            0
              ? stockWhere
              : undefined,

          attributes: [
            "id",
            "organization_id",
            "item_id",
            "store_code",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
        },

        {
          model: Store,

          as: "organization",

          required: false,

          attributes: [
            "id",
            "store_code",
            "store_name",
            "organization_level",
          ],
        },
      ],

      order: [["id", "DESC"]],

      subQuery: false,

      distinct: true,
    });

    const auditBusinessDate =
      getAuditBusinessDate();

    // =====================================================
    // ITEM-WISE STOCK AGGREGATION
    // Har item ki saari stock rows ka sum hoga
    // =====================================================

    const data = items.map(
      (item, index) => {
        const stocks = Array.isArray(
          item.stocks
        )
          ? item.stocks
          : [];

        const availableQty =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.available_qty || 0
              ),
            0
          );

        const availableWeight =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.available_weight ||
                  0
              ),
            0
          );

        const reservedQty =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.reserved_qty || 0
              ),
            0
          );

        const reservedWeight =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.reserved_weight ||
                  0
              ),
            0
          );

        const transitQty =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.transit_qty || 0
              ),
            0
          );

        const transitWeight =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.transit_weight ||
                  0
              ),
            0
          );

        const damagedQty =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.damaged_qty || 0
              ),
            0
          );

        const damagedWeight =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.damaged_weight ||
                  0
              ),
            0
          );

        const deadQty =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.dead_qty || 0
              ),
            0
          );

        const deadWeight =
          stocks.reduce(
            (sum, stock) =>
              sum +
              Number(
                stock.dead_weight || 0
              ),
            0
          );

        return {
          idx: index + 1,

          id: Number(item.id || 0),

          article_code:
            item.article_code || "",

          sku_code:
            item.sku_code || "",

          item_name:
            item.item_name || "",

          metal_type:
            item.metal_type || "",

          category:
            item.category || "",

          image_url:
            item.image_url || null,

          details:
            item.details || "",

          purity:
            item.purity || "",

          gross_weight: Number(
            item.gross_weight || 0
          ),

          net_weight: Number(
            item.net_weight || 0
          ),

          stone_weight: Number(
            item.stone_weight || 0
          ),

          stone_amount: Number(
            item.stone_amount || 0
          ),

          making_charge: Number(
            item.making_charge || 0
          ),

          purchase_rate: Number(
            item.purchase_rate || 0
          ),

          sale_rate: Number(
            item.sale_rate || 0
          ),

          hsn_code:
            item.hsn_code || "",

          unit: item.unit || "",

          current_status:
            availableQty > 0
              ? "in_stock"
              : "out_of_stock",

          stock_id:
            stocks.length === 1
              ? Number(
                  stocks[0].id || 0
                )
              : null,

          quantity: Number(
            availableQty
          ),

          available_qty: Number(
            availableQty
          ),

          available_weight: Number(
            availableWeight.toFixed(3)
          ),

          reserved_qty: Number(
            reservedQty
          ),

          reserved_weight: Number(
            reservedWeight.toFixed(3)
          ),

          transit_qty: Number(
            transitQty
          ),

          transit_weight: Number(
            transitWeight.toFixed(3)
          ),

          damaged_qty: Number(
            damagedQty
          ),

          damaged_weight: Number(
            damagedWeight.toFixed(3)
          ),

          dead_qty: Number(deadQty),

          dead_weight: Number(
            deadWeight.toFixed(3)
          ),

          store_id:
            item.organization
              ? Number(
                  item.organization.id ||
                    0
                )
              : targetOrgId ||
                orgId ||
                null,

          storeCode:
            item.organization
              ?.store_code ||
            item.storeCode ||
            targetStoreCode ||
            user.store_code ||
            user.storeCode ||
            null,

          storeName:
            item.organization
              ?.store_name || null,

          organization_level:
            item.organization
              ?.organization_level ||
            normalizedOrganizationLevel ||
            user.organization_level ||
            null,

          organization_id: Number(
            item.organization_id || 0
          ),

          isItemAudit: isSameDate(
            item.itemAuditAt,
            auditBusinessDate
          ),

          itemAuditAt:
            item.itemAuditAt || null,

          createdAt:
            item.createdAt || null,

          updatedAt:
            item.updatedAt || null,

          // Item ki saari stock rows
          stock_rows: stocks.map(
            (stock) => ({
              stock_id: Number(
                stock.id || 0
              ),

              organization_id: Number(
                stock.organization_id ||
                  0
              ),

              item_id: Number(
                stock.item_id || 0
              ),

              store_code:
                stock.store_code ||
                null,

              available_qty: Number(
                stock.available_qty || 0
              ),

              available_weight: Number(
                stock.available_weight ||
                  0
              ),

              reserved_qty: Number(
                stock.reserved_qty || 0
              ),

              reserved_weight: Number(
                stock.reserved_weight ||
                  0
              ),

              transit_qty: Number(
                stock.transit_qty || 0
              ),

              transit_weight: Number(
                stock.transit_weight ||
                  0
              ),

              damaged_qty: Number(
                stock.damaged_qty || 0
              ),

              damaged_weight: Number(
                stock.damaged_weight ||
                  0
              ),

              dead_qty: Number(
                stock.dead_qty || 0
              ),

              dead_weight: Number(
                stock.dead_weight || 0
              ),
            })
          ),

          action: "View",
        };
      }
    );

    // =====================================================
    // CATEGORY TOTALS
    // =====================================================

    const totalCategoryQuantity =
      data.reduce(
        (sum, item) =>
          sum +
          Number(item.quantity || 0),
        0
      );

    const totalAvailableWeight =
      data.reduce(
        (sum, item) =>
          sum +
          Number(
            item.available_weight || 0
          ),
        0
      );

    const totalReservedQty =
      data.reduce(
        (sum, item) =>
          sum +
          Number(
            item.reserved_qty || 0
          ),
        0
      );

    const totalTransitQty =
      data.reduce(
        (sum, item) =>
          sum +
          Number(
            item.transit_qty || 0
          ),
        0
      );

    const totalDamagedQty =
      data.reduce(
        (sum, item) =>
          sum +
          Number(
            item.damaged_qty || 0
          ),
        0
      );

    const totalDeadQty =
      data.reduce(
        (sum, item) =>
          sum +
          Number(item.dead_qty || 0),
        0
      );

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      message: `${category} items fetched successfully`,

      organization_id:
        targetOrgId || orgId || null,

      store_code:
        targetStoreCode ||
        user.store_code ||
        user.storeCode ||
        null,

      organization_level:
        normalizedOrganizationLevel ||
        user.organization_level ||
        null,

      category,

      count: data.length,

      summary: {
        total_items: data.length,

        total_quantity: Number(
          totalCategoryQuantity
        ),

        total_available_qty: Number(
          totalCategoryQuantity
        ),

        total_available_weight: Number(
          totalAvailableWeight.toFixed(3)
        ),

        total_reserved_qty: Number(
          totalReservedQty
        ),

        total_transit_qty: Number(
          totalTransitQty
        ),

        total_damaged_qty: Number(
          totalDamagedQty
        ),

        total_dead_qty: Number(
          totalDeadQty
        ),
      },

      total_quantity: Number(
        totalCategoryQuantity
      ),

      data,
    });
  } catch (error) {
    console.error(
      "getStockItemsByCategory error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to fetch category items",

      error: error.message,
    });
  }
};
/* =========================================================
   GET SINGLE STOCK ITEM
========================================================= */


export const getDistrictStockItemsByCategory = async (req, res) => {
  try {
    const user = req.user;
    const { category } = req.params;
    const { search, metal_type } = req.query;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const level = String(user.organization_level || "").toLowerCase();
    const role = String(user.role || "").toLowerCase();

    if (role !== "district_manager" && level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district users can access category items",
      });
    }

    const districtOrgId = Number(user.organization_id);
    const districtCode = user.store_code || user.storeCode;

    if (!districtOrgId || !districtCode) {
      return res.status(400).json({
        success: false,
        message: "District organization id or code not found",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const itemWhere = {
      organization_id: districtOrgId,
      storeCode: districtCode,
      category,
    };

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
        "article_code",
        "sku_code",
        "item_name",
        "metal_type",
        "category",
        "details",
        "purity",
        "gross_weight",
        "net_weight",
        "stone_weight",
        "stone_amount",
        "making_charge",
        "purchase_rate",
        "sale_rate",
        "hsn_code",
        "unit",
        "current_status",
        "store_id",
        "storeCode",
        "storeName",
        "organization_id",
        "createdAt",
        "updatedAt",
      ],
      where: itemWhere,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          attributes: [
            "id",
            "organization_id",
            "item_id",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
          where: {
            organization_id: districtOrgId,
          },
        },
      ],
      order: [["id", "DESC"]],
    });

    const data = items.map((item, index) => {
      const stock =
        Array.isArray(item.stocks) && item.stocks.length > 0
          ? item.stocks[0]
          : null;

      return {
        idx: index + 1,
        id: Number(item.id || 0),
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        item_name: item.item_name || "",
        metal_type: item.metal_type || "",
        category: item.category || "",
        details: item.details || "",
        purity: item.purity || "",

        gross_weight: Number(item.gross_weight || 0),
        net_weight: Number(item.net_weight || 0),
        stone_weight: Number(item.stone_weight || 0),
        stone_amount: Number(item.stone_amount || 0),

        making_charge: Number(item.making_charge || 0),
        purchase_rate: Number(item.purchase_rate || 0),
        sale_rate: Number(item.sale_rate || 0),

        hsn_code: item.hsn_code || "",
        unit: item.unit || "",
        current_status: item.current_status || "",

        stock_id: stock ? Number(stock.id || 0) : null,
        quantity: Number(stock?.available_qty || 0),
        available_qty: Number(stock?.available_qty || 0),
        available_weight: Number(stock?.available_weight || 0),
        reserved_qty: Number(stock?.reserved_qty || 0),
        reserved_weight: Number(stock?.reserved_weight || 0),
        transit_qty: Number(stock?.transit_qty || 0),
        transit_weight: Number(stock?.transit_weight || 0),
        damaged_qty: Number(stock?.damaged_qty || 0),
        damaged_weight: Number(stock?.damaged_weight || 0),
        dead_qty: Number(stock?.dead_qty || 0),
        dead_weight: Number(stock?.dead_weight || 0),

        store_id: Number(item.store_id || 0),
        storeCode: item.storeCode || districtCode,
        storeName: item.storeName || null,
        organization_id: Number(item.organization_id || 0),

        createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || null,

        action: "View",
      };
    });

    return res.status(200).json({
      success: true,
      message: `District ${category} items fetched successfully`,
      organization_id: districtOrgId,
      store_code: districtCode,
      category,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getDistrictStockItemsByCategory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district category items",
      error: error.message,
    });
  }
};



export const getSingleStock = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const { organization_id } = req.query;

    const orgId = getOrganizationFilter(user, organization_id);

    const where = { id };
    if (orgId) where.organization_id = orgId;

    const item = await Item.findOne({
      where,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
        },
        {
          model: Store,
          as: "organization",
          attributes: ["id", "store_code", "store_name", "organizationlevel"],
          required: false,
        },
      ],
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Stock item not found",
      });
    }

    const movementCreatedKey = getCreatedKey(StockMovement);

    const movements = await StockMovement.findAll({
      where: {
        item_id: item.id,
        ...(orgId ? { organization_id: orgId } : {}),
      },
      order: [[movementCreatedKey, "DESC"]],
      limit: 10,
    });

    return res.status(200).json({
      success: true,
      message: "Stock item fetched successfully",
      data: {
        item,
        stock: item.stocks?.[0] || null,
        organization: item.organization || null,
        recent_movements: movements,
      },
    });
  } catch (error) {
    console.error("getSingleStock error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stock item",
      error: error.message,
    });
  }
};

/* =========================================================
   UPDATE STOCK STATUS
========================================================= */

export const updateStockStatus = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { current_status, remarks } = req.body;
    const user = req.user;

    const where = { id };

    if (user?.role !== "super_admin") {
      where.organization_id = user?.organization_id;
    }

    const item = await Item.findOne({
      where,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
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

    const previousStatus = item.current_status;

    await item.update({ current_status }, { transaction: t });

    const movement = await StockMovement.create(
      {
        item_id: item.id,
        organization_id: item.organization_id,
        movement_type: "adjustment",
        qty: item.unit === "piece" ? 1 : 0,
        weight: item.gross_weight || 0,
        previous_status: previousStatus,
        new_status: current_status,
        reference_type: "item_status_update",
        remarks:
          remarks || `Status changed from ${previousStatus} to ${current_status}`,
        created_by: user?.id || null,
      },
      { transaction: t }
    );

    await createActivityLog({
      organization_id: item.organization_id,
      user_id: user?.id || null,
      module: "stock",
      action: "update_status",
      entity_type: "item",
      entity_id: item.id,
      title: "Stock item status updated",
      description: `${item.item_name} status changed from ${previousStatus} to ${current_status}`,
      metadata: {
        item_id: item.id,
        article_code: item.article_code,
        previous_status: previousStatus,
        new_status: current_status,
        movement_id: movement.id,
      },
    });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Stock status updated successfully",
      data: item,
    });
  } catch (error) {
    await t.rollback();
    console.error("updateStockStatus error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update stock status",
      error: error.message,
    });
  }
};

/* =========================================================
   STOCK SUMMARY
========================================================= */

export const stockSummary = async (req, res) => {
  try {
    const user = req.user;
    const { organization_id } = req.query;

    const orgId = getOrganizationFilter(user, organization_id);

    const itemWhere = {};
    const stockWhere = {};

    if (orgId) {
      itemWhere.organization_id = orgId;
      stockWhere.organization_id = orgId;
    }

    const totalStock = await Stock.count({
      where: {
        ...stockWhere,
        available_qty: { [Op.gt]: 0 },
      },
    });

    const deadStock = await Stock.count({
      where: {
        ...stockWhere,
        dead_qty: { [Op.gt]: 0 },
      },
    });

    const transitGoods = await Stock.count({
      where: {
        ...stockWhere,
        transit_qty: { [Op.gt]: 0 },
      },
    });

    const reservedItems = await Stock.count({
      where: {
        ...stockWhere,
        reserved_qty: { [Op.gt]: 0 },
      },
    });

    const soldItems = await Item.count({
      where: {
        ...itemWhere,
        current_status: "sold",
      },
    });

    const lowStockItems = await Stock.count({
      where: {
        ...stockWhere,
        available_qty: {
          [Op.gt]: 0,
          [Op.lte]: 2,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Stock summary fetched successfully",
      data: {
        total_stock: totalStock,
        dead_stock: deadStock,
        low_stock: lowStockItems,
        transit_goods: transitGoods,
        sold_items: soldItems,
        reserved_items: reservedItems,
      },
    });
  } catch (error) {
    console.error("stockSummary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stock summary",
      error: error.message,
    });
  }
};

/* =========================================================
   ADD STOCK IN
====================================================== */


const createStockInRootBatch = async (
  {
    item,
    stock,
    organization_id,
    quantity,
    weight,
    remarks,
    created_by,
    source_type = "manual_stock_in",
    source_reference_id = null,
  },
  { transaction }
) => {
  const batchNo = `BATCH-${item.article_code || item.sku_code || item.id}-${Date.now()}`;

  const batchRows = await sequelize.query(
    `
    INSERT INTO public.inventory_batches (
      batch_no,
      organization_id,
      item_id,
      stock_record_id,
      current_organization_id,
      total_qty,
      available_qty,
      total_weight,
      available_weight,
      status,
      remarks,
      created_by,
      root_batch_id,
      parent_batch_id,
      split_level,
      is_leaf,
      source_type,
      source_reference_id,
      created_at,
      updated_at
    )
    VALUES (
      :batch_no,
      :organization_id,
      :item_id,
      :stock_record_id,
      :current_organization_id,
      :total_qty,
      :available_qty,
      :total_weight,
      :available_weight,
      'created',
      :remarks,
      :created_by,
      NULL,
      NULL,
      0,
      true,
      :source_type,
      :source_reference_id,
      NOW(),
      NOW()
    )
    RETURNING *
    `,
    {
      replacements: {
        batch_no: batchNo,
        organization_id,
        item_id: item.id,
        stock_record_id: stock?.id || null,
        current_organization_id: organization_id,
        total_qty: Number(quantity || 0),
        available_qty: Number(quantity || 0),
        total_weight: Number(weight || 0),
        available_weight: Number(weight || 0),
        remarks: remarks || "Stock inward root batch",
        created_by: created_by || null,
        source_type,
        source_reference_id,
      },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  const batch = batchRows[0];

  const rootBatchRows = await sequelize.query(
    `
    UPDATE public.inventory_batches
    SET
      root_batch_id = :batch_id,
      parent_batch_id = NULL,
      split_level = 0,
      is_leaf = true,
      updated_at = NOW()
    WHERE id = :batch_id
    RETURNING *
    `,
    {
      replacements: {
        batch_id: batch.id,
      },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  return rootBatchRows[0];
};

const normalizeCategory = (value) => {
  if (!value) return value;

  return String(value)
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const cleanCodePart = (value, fallback = "GEN") => {
  if (!value) return fallback;

  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const getMonthYear = () => {
  const now = new Date();

  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());

  return `${month}${year}`;
};

const getOrganizationPrefix = (user) => {
  const level = String(
    user?.organization_level || user?.role || ""
  ).toLowerCase();

  if (
    level.includes("head") ||
    level.includes("super_admin") ||
    level.includes("super-admin")
  ) {
    return "HO";
  }

  if (level.includes("district")) {
    return "HO-DIS";
  }

  if (level.includes("retail") || level.includes("store")) {
    return "HO-DIS-RE";
  }

  return "HO";
};

const getNextSequenceNumber = async ({
  organization_id,
  organization_level,
  store_code,
  code_type,
  category_code,
  sub_category_code = "NA",
  month_year = "NA",
  transaction,
}) => {
  const where = {
    organization_id,
    code_type,
    category_code,
    sub_category_code,
    month_year,
  };

  let sequence = await CodeSequence.findOne({
    where,
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!sequence) {
    try {
      sequence = await CodeSequence.create(
        {
          organization_id,
          organization_level,
          store_code,
          code_type,
          category_code,
          sub_category_code,
          month_year,
          last_number: 0,
        },
        { transaction }
      );
    } catch (error) {
      if (error?.name !== "SequelizeUniqueConstraintError") {
        throw error;
      }

      sequence = await CodeSequence.findOne({
        where,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!sequence) {
        throw error;
      }
    }
  }

  const nextNumber = Number(sequence.last_number || 0) + 1;

  await sequence.update(
    {
      last_number: nextNumber,
    },
    { transaction }
  );

  return nextNumber;
};

const generateArticleCode = async ({
  user,
  category,
  transaction,
}) => {
  const prefix = getOrganizationPrefix(user);
  const categoryCode = cleanCodePart(category, "GEN");

  const existingItem = await Item.findOne({
    where: {
      organization_id: user.organization_id,
      category,
      article_code: {
        [Op.like]: `${prefix}-${categoryCode}-%`,
      },
    },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (existingItem?.article_code) {
    return existingItem.article_code;
  }

  const serial = await getNextSequenceNumber({
    organization_id: user.organization_id,
    organization_level: user.organization_level,
    store_code: user.store_code || user.storeCode || null,
    code_type: "ARTICLE",
    category_code: categoryCode,
    sub_category_code: "NA",
    month_year: "NA",
    transaction,
  });

  return `${prefix}-${categoryCode}-${String(serial).padStart(4, "0")}`;
};

const generateSkuCode = async ({
  user,
  category,
  sub_category,
  transaction,
}) => {
  const prefix = getOrganizationPrefix(user);
  const categoryCode = cleanCodePart(category, "GEN");
  const subCategoryCode = cleanCodePart(sub_category, "SUB");
  const monthYear = getMonthYear();

  const serial = await getNextSequenceNumber({
    organization_id: user.organization_id,
    organization_level: user.organization_level,
    store_code: user.store_code || user.storeCode || null,
    code_type: "SKU",
    category_code: categoryCode,
    sub_category_code: subCategoryCode,
    month_year: monthYear,
    transaction,
  });

  return `${prefix}-${categoryCode}-${subCategoryCode}-${monthYear}-${String(
    serial
  ).padStart(3, "0")}`;
};

export const addStockIn = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const user = req.user;

    // =====================================================
    // AUTHENTICATION
    // =====================================================

    if (!user?.organization_id) {
      await t.rollback();

      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const destinationOrganizationId = Number(
      user.organization_id
    );

    if (
      !Number.isInteger(destinationOrganizationId) ||
      destinationOrganizationId <= 0
    ) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "Valid organization_id is required",
      });
    }

    const cleanStoreCode = String(
      user.store_code || user.storeCode || ""
    )
      .trim()
      .toUpperCase();

    if (!cleanStoreCode) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "Store code is missing in logged-in user",
      });
    }

    // =====================================================
    // ITEMS PARSE
    // =====================================================

    let payloads = [];

    try {
      if (Array.isArray(req.body.items)) {
        payloads = req.body.items;
      } else if (typeof req.body.items === "string") {
        const parsedItems = JSON.parse(req.body.items);

        payloads = Array.isArray(parsedItems)
          ? parsedItems
          : [];
      } else if (
        req.body.items &&
        typeof req.body.items === "object"
      ) {
        payloads = [req.body.items];
      }
    } catch (parseError) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid items JSON format",
        error: parseError.message,
      });
    }

    if (!payloads.length) {
      await t.rollback();

      return res.status(400).json({
        success: false,
        message: "Items are required",
      });
    }

    const responseData = [];

    // =====================================================
    // PROCESS ITEMS
    // =====================================================

    for (
      let index = 0;
      index < payloads.length;
      index++
    ) {
      const body = payloads[index] || {};

      const {
        item_id,
        item_name,
        metal_type,
        category,
        sub_category,
        qty = 1,
        purchase_price = 0,
        selling_price = 0,
        making_charge = 0,
        purity,
        net_weight = 0,
        stone_weight = 0,
        remarks,
      } = body;

      const cleanItemId =
        item_id !== undefined &&
        item_id !== null &&
        item_id !== ""
          ? Number(item_id)
          : null;

      if (
        cleanItemId !== null &&
        (!Number.isInteger(cleanItemId) ||
          cleanItemId <= 0)
      ) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message: `Invalid item_id at item index ${index}`,
        });
      }

      const normalizedCategory =
        normalizeCategory(category);

      const finalSubCategory =
        sub_category ||
        body.subCategory ||
        body.sub_category_name ||
        metal_type ||
        normalizedCategory ||
        "General";

      const incomingQty = Number(qty);
      const incomingWeight = Number(net_weight);
      const incomingStoneWeight = Number(
        stone_weight || 0
      );

      const purchaseRate = Number(
        purchase_price || 0
      );

      const saleRate = Number(
        selling_price || 0
      );

      const makingChargeValue = Number(
        making_charge || 0
      );

      // ===================================================
      // NUMBER VALIDATION
      // ===================================================

      if (
        !Number.isFinite(incomingQty) ||
        incomingQty <= 0
      ) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Quantity must be greater than 0 at item index ${index}`,
        });
      }

      if (
        !Number.isFinite(incomingWeight) ||
        incomingWeight < 0
      ) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Net weight cannot be negative at item index ${index}`,
        });
      }

      if (
        !Number.isFinite(incomingStoneWeight) ||
        incomingStoneWeight < 0
      ) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Stone weight cannot be negative at item index ${index}`,
        });
      }

      if (
        !Number.isFinite(purchaseRate) ||
        purchaseRate < 0
      ) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Purchase price cannot be negative at item index ${index}`,
        });
      }

      if (
        !Number.isFinite(saleRate) ||
        saleRate < 0
      ) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Selling price cannot be negative at item index ${index}`,
        });
      }

      if (
        !Number.isFinite(makingChargeValue) ||
        makingChargeValue < 0
      ) {
        await t.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Making charge cannot be negative at item index ${index}`,
        });
      }

      // ===================================================
      // IMAGE UPLOAD
      // ===================================================

      let imageUrl = null;
      let imagePublicId = null;

      const uploadedFile =
        Array.isArray(req.files)
          ? req.files[index]
          : null;

      if (uploadedFile) {
        const uploadedImage =
          await uploadToCloudinary(uploadedFile);

        imageUrl =
          uploadedImage?.secure_url ||
          uploadedImage?.url ||
          null;

        imagePublicId =
          uploadedImage?.public_id || null;
      }

      // ===================================================
      // FIND EXISTING ITEM
      //
      // Important:
      // Item ko organization_id ke saath restrict nahi
      // karenge, kyunki transferred item source store ka
      // ho sakta hai.
      // ===================================================

      let item = null;
      let isExistingItem = false;

      if (cleanItemId) {
        item = await Item.findOne({
          where: {
            id: cleanItemId,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!item) {
          await t.rollback();

          return res.status(404).json({
            success: false,
            message:
              `Item not found for item_id ${cleanItemId}`,
          });
        }

        isExistingItem = true;
      }

      // ===================================================
      // CREATE NEW ITEM
      // ===================================================

      if (!item) {
        if (
          !item_name ||
          !metal_type ||
          !category ||
          !purity
        ) {
          await t.rollback();

          return res.status(400).json({
            success: false,
            message:
              `item_name, metal_type, category and purity are required for new item at index ${index}`,
          });
        }

        const articleCode =
          await generateArticleCode({
            user,
            category: normalizedCategory,
            transaction: t,
          });

        const skuCode =
          await generateSkuCode({
            user,
            category: normalizedCategory,
            sub_category: finalSubCategory,
            transaction: t,
          });

        item = await Item.create(
          {
            item_name: String(item_name).trim(),

            article_code: articleCode,
            sku_code: skuCode,

            metal_type: String(
              metal_type
            ).trim(),

            category: normalizedCategory,

            purchase_rate: purchaseRate,
            sale_rate: saleRate,
            making_charge: makingChargeValue,

            purity: String(purity).trim(),

            net_weight: incomingWeight,

            gross_weight:
              incomingWeight +
              incomingStoneWeight,

            stone_weight:
              incomingStoneWeight,

            current_status: "in_stock",

            organization_id:
              destinationOrganizationId,

            storeCode: cleanStoreCode,
            storeName: user.store_name || user.storeName || null,
            image_url: imageUrl,
              
            image_public_id:
              imagePublicId,
          },
          {
            transaction: t,
          }
        );

        // =================================================
        // QR GENERATION
        // =================================================

        try {
          const qr = await generateItemQR({
            ...item.toJSON(),

            qr_code_value:
              item.sku_code,

            sku_code:
              item.sku_code,

            article_code:
              item.article_code,

            product_code:
              item.article_code,
          });

          await item.update(
            {
              /*
               * generateItemQR signed JSON QR value return
               * karta hai. Isi value ko store karna hai.
               */
              qr_code_value:
                qr.qr_code_value,

              qr_code_url:
                qr.qr_code_url,
            },
            {
              transaction: t,
            }
          );
        } catch (qrError) {
          console.error(
            "QR generation failed:",
            qrError.message
          );

          await item.update(
            {
              qr_code_value:
                item.sku_code,

              qr_code_url: null,
            },
            {
              transaction: t,
            }
          );
        }
      } else {
        // =================================================
        // EXISTING ITEM UPDATE
        //
        // Existing transferred item ka original ownership
        // metadata forcefully change nahi karenge.
        //
        // Current inventory location Stock row decide karegi.
        // =================================================

        const updateItemData = {
          current_status: "in_stock",
        };

        if (imageUrl) {
          updateItemData.image_url =
            imageUrl;
        }

        if (imagePublicId) {
          updateItemData.image_public_id =
            imagePublicId;
        }

        await item.update(
          updateItemData,
          {
            transaction: t,
          }
        );
      }

      // ===================================================
      // DESTINATION STOCK ROW
      //
      // Important:
      // organization_id item.organization_id nahi,
      // logged-in destination organization hoga.
      // ===================================================

      let stock = await Stock.findOne({
        where: {
          item_id: item.id,

          organization_id:
            destinationOrganizationId,

          store_code: cleanStoreCode,
        },

        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      // Older records me store_code null ho sakta hai.
      if (!stock) {
        stock = await Stock.findOne({
          where: {
            item_id: item.id,

            organization_id:
              destinationOrganizationId,
          },

          transaction: t,
          lock: t.LOCK.UPDATE,
        });
      }

      if (!stock) {
        stock = await Stock.create(
          {
            organization_id:
              destinationOrganizationId,

            item_id: item.id,

            store_code:
              cleanStoreCode,

            available_qty: 0,
            available_weight: 0,

            reserved_qty: 0,
            reserved_weight: 0,

            transit_qty: 0,
            transit_weight: 0,

            damaged_qty: 0,
            damaged_weight: 0,

            dead_qty: 0,
            dead_weight: 0,
          },
          {
            transaction: t,
          }
        );
      }

      // ===================================================
      // UPDATE STOCK
      // ===================================================

      const previousAvailableQty = Number(
        stock.available_qty || 0
      );

      const previousAvailableWeight = Number(
        stock.available_weight || 0
      );

      const newAvailableQty = Number(
        (
          previousAvailableQty +
          incomingQty
        ).toFixed(3)
      );

      const newAvailableWeight = Number(
        (
          previousAvailableWeight +
          incomingWeight
        ).toFixed(3)
      );

      await stock.update(
        {
          available_qty:
            newAvailableQty,

          available_weight:
            newAvailableWeight,

          store_code:
            cleanStoreCode,
        },
        {
          transaction: t,
        }
      );

      // ===================================================
      // ITEM STATUS
      // ===================================================

      const previousStatus =
        item.current_status || null;

      if (
        String(item.current_status || "")
          .trim()
          .toLowerCase() !== "in_stock"
      ) {
        await item.update(
          {
            current_status:
              "in_stock",
          },
          {
            transaction: t,
          }
        );
      }

      // ===================================================
      // STOCK MOVEMENT
      // ===================================================

      const movement =
        await StockMovement.create(
          {
            item_id: item.id,

            /*
             * Movement destination organization ke andar
             * create hoga.
             */
            organization_id:
              destinationOrganizationId,

            store_code:
              cleanStoreCode,

            movement_type:
              "purchase",

            qty: incomingQty,
            weight: incomingWeight,

            previous_status:
              previousStatus,

            new_status:
              "in_stock",

            reference_type:
              isExistingItem
                ? "existing_item_stock_in"
                : "manual_stock_in",

            reference_id:
              item.id,

            reference_no:
              item.article_code,

            remarks:
              remarks ||
              (isExistingItem
                ? "Existing item stock inward completed"
                : "Stock inward completed"),

            created_by:
              user.id || null,
          },
          {
            transaction: t,
          }
        );

      // ===================================================
      // ROOT BATCH
      //
      // Batch destination organization ke andar बनेगा.
      // ===================================================

      const batch =
        await createStockInRootBatch(
          {
            item,
            stock,

            organization_id:
              destinationOrganizationId,

            quantity:
              incomingQty,

            weight:
              incomingWeight,

            remarks:
              remarks ||
              (isExistingItem
                ? "Existing item stock inward root batch"
                : "Manual stock inward root batch"),

            created_by:
              user.id || null,

            source_type:
              isExistingItem
                ? "existing_item_stock_in"
                : "manual_stock_in",

            source_reference_id:
              movement.id,
          },
          {
            transaction: t,
          }
        );

      // ===================================================
      // ACTIVITY LOG
      // ===================================================

      await createActivityLog({
        organization_id:
          destinationOrganizationId,

        user_id:
          user.id || null,

        module: "stock",
        action: "stock_in",

        entity_type: "item",
        entity_id: item.id,

        title:
          "Stock inward completed",

        description:
          `${item.item_name} stock inward completed`,

        metadata: {
          item_id:
            item.id,

          article_code:
            item.article_code,

          sku_code:
            item.sku_code,

          stock_id:
            stock.id,

          movement_id:
            movement.id,

          batch_id:
            batch.id,

          qty:
            incomingQty,

          weight:
            incomingWeight,

          store_code:
            cleanStoreCode,

          organization_id:
            destinationOrganizationId,

          existing_item:
            isExistingItem,
        },
      });

      // ===================================================
      // SYSTEM ACTIVITY
      // ===================================================

      await SystemActivity.create(
        {
          organization_id:
            destinationOrganizationId,

          user_id:
            user.id || null,

          module:
            "stock",

          action:
            "stock_in",

          title:
            "Stock inward completed",

          description:
            `${item.item_name} inward stock added`,

          metadata: {
            item_id:
              item.id,

            article_code:
              item.article_code,

            sku_code:
              item.sku_code,

            stock_id:
              stock.id,

            movement_id:
              movement.id,

            batch_id:
              batch.id,

            qty:
              incomingQty,

            weight:
              incomingWeight,

            store_code:
              cleanStoreCode,

            organization_id:
              destinationOrganizationId,

            existing_item:
              isExistingItem,
          },
        },
        {
          transaction: t,
        }
      );

      // ===================================================
      // ITEM RESPONSE
      // ===================================================

      responseData.push({
        item: item.toJSON(),

        stock: {
          ...stock.toJSON(),

          organization_id:
            destinationOrganizationId,

          store_code:
            cleanStoreCode,

          available_qty:
            newAvailableQty,

          available_weight:
            newAvailableWeight,
        },

        movement:
          movement.toJSON
            ? movement.toJSON()
            : movement,

        batch,

        stock_in_type:
          isExistingItem
            ? "existing_item"
            : "new_item",
      });
    }

    // =====================================================
    // COMMIT
    // =====================================================

    await t.commit();

    return res.status(200).json({
      success: true,

      message:
        "Stock inward successful",

      count:
        responseData.length,

      data:
        responseData.length === 1
          ? responseData[0]
          : responseData,
    });
  } catch (error) {
    if (t && !t.finished) {
      await t.rollback();
    }

    console.error(
      "addStockIn error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to add stock inward",

      error:
        error.message,

      error_name:
        error.name || null,

      validation_errors:
        Array.isArray(error.errors)
          ? error.errors.map(
              (validationError) => ({
                field:
                  validationError.path ||
                  null,

                message:
                  validationError.message,

                value:
                  validationError.value,
              })
            )
          : [],
    });
  }
};
const clean = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
};

const toNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;

  const cleaned = String(value)
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeUnit = (unit) => {
  const u = clean(unit).toLowerCase();

  if (["g", "gm", "gms", "gram", "grams"].includes(u)) return "g";
  if (["kg", "kilogram", "kilograms"].includes(u)) return "kg";
  if (["mg", "milligram", "milligrams"].includes(u)) return "mg";
  if (["piece", "pieces", "pcs", "pc", "nos"].includes(u)) return "pcs";
  if (["pair", "pairs"].includes(u)) return "pair";
  if (["set", "sets"].includes(u)) return "set";

  return u || "pcs";
};

const normalizeMetalType = (itemName) => {
  const text = clean(itemName).toLowerCase();

  if (text.includes("silver")) return "Silver";
  return "Gold";
};

const generateCode = (storeCode, prefix, i) => {
  return `${prefix}-${storeCode}-${Date.now()}-${i}`;
};

const isPdfFile = (file) => {
  const fileName = file.originalname.toLowerCase();

  return file.mimetype === "application/pdf" || fileName.endsWith(".pdf");
};

const isExcelFile = (file) => {
  const fileName = file.originalname.toLowerCase();

  return (
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.mimetype === "application/vnd.ms-excel" ||
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls")
  );
};

/* =========================================================
   PDF PARSER - DELIVERY CHALLAN ITEM TABLE ONLY
========================================================= */

const PDF_STANDARD_FONT_PATH = pathToFileURL(
  path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts")
).href + "/";

const cleanPdf = (value = "") =>
  String(value)
    .replace(/\s+/g, " ")
    .replace(/₹/g, "")
    .trim();

const pdfNum = (value) => {
  if (value === undefined || value === null || value === "") return 0;

  const num = Number(
    String(value)
      .replace(/₹/g, "")
      .replace(/,/g, "")
      .replace(/[^\d.-]/g, "")
      .trim()
  );

  return Number.isFinite(num) ? num : 0;
};

const getPdfCategory = (itemName = "") => {
  const value = cleanPdf(itemName);
  if (!value.includes("/")) return "General";

  return cleanPdf(value.split("/").pop()) || "General";
};

const isValidProductCode = (value = "") => {
  return /^[A-Z]{2,}(?:-[A-Z0-9]+){3,}-\d{3,}$/i.test(cleanPdf(value));
};

const isValidHsn = (value = "") => {
  return /^\d{6,10}$/.test(cleanPdf(value));
};

const isValidPurity = (value = "") => {
  return /^(18|20|22|24)\s*(kt|k)?\s*\/?\s*\d{3}$/i.test(cleanPdf(value));
};
const isValidHuid = (value = "") => {
  return /^HUID[A-Z0-9]+$/i.test(cleanPdf(value));
};

const groupByY = (items, tolerance = 2.5) => {
  const lines = [];

  for (const item of items) {
    const text = cleanPdf(item.str);
    if (!text) continue;

    const x = item.transform[4];
    const y = item.transform[5];

    let line = lines.find((l) => Math.abs(l.y - y) <= tolerance);

    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }

    line.items.push({ x, y, text });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => ({
      y: line.y,
      items: line.items.sort((a, b) => a.x - b.x),
      text: line.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text)
        .join(" "),
    }));
};

const getCellText = (line, minX, maxX) => {
  return cleanPdf(
    line.items
      .filter((i) => i.x >= minX && i.x < maxX)
      .map((i) => i.text)
      .join(" ")
  );
};

const parsePdfRows = async (buffer) => {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: PDF_STANDARD_FONT_PATH,
      disableWorker: true,
      disableFontFace: true,
    }).promise;

    const rows = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const textContent = await page.getTextContent();

      const lines = groupByY(textContent.items, 3);

      for (const line of lines) {
        const item_name = getCellText(line, 65, 136);
        const product_code = getCellText(line, 136, 205);
        const qty = getCellText(line, 228, 250);
        const hsn_code = getCellText(line, 255, 288);
        const purity = getCellText(line, 288, 318);
        const net_weight = getCellText(line, 365, 390);
        const rate = getCellText(line, 400, 425);
        const making_charge = getCellText(line, 435, 458);
        const huid_code = getCellText(line, 458, 505);
        const base_value = getCellText(line, 525, 560);

        if (!isValidProductCode(product_code)) continue;
        if (!isValidHsn(hsn_code)) continue;
        if (!isValidPurity(purity)) continue;

        rows.push({
          source_row_no: rows.length + 1,

          item_name,
          product_code,

          qty: pdfNum(qty) || 1,
          hsn_code,
          purity,

          net_weight: pdfNum(net_weight),
          gross_weight: pdfNum(net_weight),

          rate: pdfNum(rate),
          making_charge: pdfNum(making_charge),

          huid_code: isValidHuid(huid_code) ? huid_code : "",
          amount: pdfNum(base_value),
          base_value: pdfNum(base_value),

          unit: "g",
          metal_type: normalizeMetalType(item_name),
          category: getPdfCategory(item_name),
        });
      }
    }

    const uniqueRows = [];
    const seenProductCodes = new Set();

    for (const row of rows) {
      if (!row.product_code) continue;
      if (seenProductCodes.has(row.product_code)) continue;

      seenProductCodes.add(row.product_code);

      uniqueRows.push({
        ...row,
        source_row_no: uniqueRows.length + 1,
      });
    }

    console.log("PDF PARSED ROWS:", uniqueRows);

    if (!uniqueRows.length) {
      return {
        success: false,
        message: "No valid item rows found in PDF challan",
        rows: [],
      };
    }

    return {
      success: true,
      rows: uniqueRows,
    };
  } catch (err) {
    return {
      success: false,
      message: `PDF parse failed: ${err.message}`,
      rows: [],
    };
  }
};

/* =========================================================
   EXCEL PARSER
========================================================= */

const parseExcelRows = (buffer) => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return {
      success: false,
      message: "No sheet found in uploaded file",
      rows: [],
    };
  }

  const sheet = workbook.Sheets[sheetName];

  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  let headerIndex = rawRows.findIndex((row) => {
    const rowText = row.map(clean).join(" ").toLowerCase();

    return (
      rowText.includes("material description") &&
      rowText.includes("product code") &&
      rowText.includes("hsn")
    );
  });

  if (headerIndex === -1) {
    headerIndex = rawRows.findIndex((row) =>
      row.some((cell) => clean(cell).toUpperCase() === "PARTICULAR")
    );
  }

  if (headerIndex === -1) {
    return {
      success: false,
      message: "Invalid challan format",
      rows: [],
    };
  }

  const headerRow = rawRows[headerIndex].map((cell) =>
    clean(cell).toLowerCase()
  );

  const findCol = (...names) => {
    return headerRow.findIndex((header) =>
      names.some((name) => header.includes(name))
    );
  };

  const hasDeliveryChallanHeader = headerRow.some((header) =>
    header.includes("material description")
  );

  /**
   * Old PARTICULAR format
   */
  if (!hasDeliveryChallanHeader) {
    const dataRows = rawRows.slice(headerIndex + 1);

    const rows = dataRows
      .map((row, index) => {
        const item_name = clean(row[1]);
        if (!item_name) return null;

        const unit = normalizeUnit(row[3]);
        const qty = toNumber(row[4]);

        return {
          source_row_no: headerIndex + index + 2,

          item_name,
          product_code: "",

          hsn_code: clean(row[2]),
          unit,
          qty,

          rate: toNumber(row[5]),
          amount: toNumber(row[6]),
          base_value: toNumber(row[6]),

          purity: "NA",
          net_weight: unit === "g" ? qty : 0,
          gross_weight: unit === "g" ? qty : 0,

          making_charge: 0,
          huid_code: "",

          metal_type: normalizeMetalType(item_name),
          category: "General",
        };
      })
      .filter(Boolean);

    return {
      success: true,
      rows,
    };
  }

  /**
   * Delivery Challan format
   */
  const colItem = findCol("material description", "description", "particular");
  const colProduct = findCol("product code", "sku", "article");
  const colQty = findCol("qty", "quantity");
  const colHsn = findCol("hsn");
  const colPurity = findCol("purity", "karat");
  const colNetWeight = findCol("net weight", "weight");
  const colRate = findCol("rate");
  const colMaking = findCol("making");
  const colHuid = findCol("huid");
  const colBaseValue = findCol("base value", "amount", "value");

  const requiredCols = [
    { name: "Material Description", index: colItem },
    { name: "Product Code", index: colProduct },
    { name: "Qty", index: colQty },
    { name: "HSN Code", index: colHsn },
    { name: "Purity/Karat", index: colPurity },
    { name: "Net Weight", index: colNetWeight },
  ];

  const missingCol = requiredCols.find((col) => col.index === -1);

  if (missingCol) {
    return {
      success: false,
      message: `${missingCol.name} column missing in Excel challan`,
      rows: [],
    };
  }

  const dataRows = rawRows.slice(headerIndex + 1);

  const rows = dataRows
    .map((row, index) => {
      const item_name = clean(row[colItem]);
      const product_code = clean(row[colProduct]);

      if (!item_name && !product_code) return null;

      const netWeight = toNumber(row[colNetWeight]);

      return {
        source_row_no: headerIndex + index + 2,

        item_name,
        product_code,

        qty: toNumber(row[colQty]) || 1,
        hsn_code: clean(row[colHsn]),
        purity: clean(row[colPurity]) || "NA",

        net_weight: netWeight,
        gross_weight: netWeight,

        rate: colRate !== -1 ? toNumber(row[colRate]) : 0,
        making_charge: colMaking !== -1 ? toNumber(row[colMaking]) : 0,
        huid_code: colHuid !== -1 ? clean(row[colHuid]) : "",
        amount: colBaseValue !== -1 ? toNumber(row[colBaseValue]) : 0,
        base_value: colBaseValue !== -1 ? toNumber(row[colBaseValue]) : 0,

        unit: "g",
        metal_type: normalizeMetalType(item_name),
        category: getPdfCategory(item_name),
      };
    })
    .filter(Boolean);

  if (!rows.length) {
    return {
      success: false,
      message: "No item rows found in Excel challan",
      rows: [],
    };
  }

  return {
    success: true,
    rows,
  };
};

/* =========================================================
   MAIN CONTROLLER
========================================================= */

export const uploadStockInItems = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    if (!req.file) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const user = req.user || {};

    const organization_id = user.organization_id;
    const store_code = user.store_code;
    const store_name = user.store_name || user.storeName || null;
    const state_code = user.state_code || null;
    const district_code = user.district_code || null;
    const user_id = user.id || null;

    if (!organization_id || !store_code) {
      await t.rollback();
      return res.status(401).json({
        success: false,
        message: "organization_id or store_code missing in login token",
      });
    }

    let parsedResult;

    console.log("UPLOAD FILE DEBUG:", {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    if (isPdfFile(req.file)) {
      console.log("PDF parser running...");
      parsedResult = await parsePdfRows(req.file.buffer);
    } else if (isExcelFile(req.file)) {
      console.log("Excel parser running...");
      parsedResult = parseExcelRows(req.file.buffer);
    } else {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Only PDF, XLSX and XLS files are allowed",
      });
    }

    if (!parsedResult.success) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: parsedResult.message,
      });
    }

    const dataRows = parsedResult.rows || [];

    if (!dataRows.length) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "No valid stock rows found in uploaded file",
      });
    }

    const uploaded = [];
    const skipped = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNo = row.source_row_no || i + 1;

      const item_name = clean(row.item_name);
      const product_code = clean(row.product_code);
      const hsn_code = clean(row.hsn_code);
      const unit = normalizeUnit(row.unit || "g");

      const qty = toNumber(row.qty);
      const rate = toNumber(row.rate);
      const amount = toNumber(row.amount || row.base_value);

      const purity = clean(row.purity) || "NA";
      const net_weight = toNumber(row.net_weight);
      const gross_weight = toNumber(row.gross_weight || row.net_weight);
      const making_charge = toNumber(row.making_charge);
      const huid_code = clean(row.huid_code);

      const metal_type = normalizeMetalType(row.metal_type || item_name);
      const category = clean(row.category) || "General";

      if (!item_name && !product_code) {
        continue;
      }

      if (!item_name) {
        skipped.push({
          row: rowNo,
          item_name: item_name || product_code,
          reason: "Material Description required",
        });
        continue;
      }

      if (!product_code) {
        skipped.push({
          row: rowNo,
          item_name,
          reason: "Product Code required",
        });
        continue;
      }

      if (!["g", "kg", "mg", "pcs", "pair", "set"].includes(unit)) {
        skipped.push({
          row: rowNo,
          item_name,
          reason: "Invalid UoM",
        });
        continue;
      }

      if (qty <= 0) {
        skipped.push({
          row: rowNo,
          item_name,
          reason: "Qty required",
        });
        continue;
      }

      if (!hsn_code) {
        skipped.push({
          row: rowNo,
          item_name,
          reason: "HSN Code required",
        });
        continue;
      }

      if (!purity || purity === "NA") {
        skipped.push({
          row: rowNo,
          item_name,
          reason: "Purity/Karat required",
        });
        continue;
      }

      const finalGrossWeight = gross_weight || net_weight || 0;
      const finalNetWeight = net_weight || finalGrossWeight;

      if (unit === "g" && finalNetWeight <= 0) {
        skipped.push({
          row: rowNo,
          item_name,
          reason: "Net Weight required",
        });
        continue;
      }

      const article_code = product_code;
      const sku_code = generateCode(store_code, "SKU", i + 1);

      const existingItem = await Item.findOne({
        where: {
          [Op.or]: [{ article_code }, { sku_code: product_code }],
        },
        transaction: t,
      });

      if (existingItem) {
        skipped.push({
          row: rowNo,
          item_name,
          reason: "Duplicate product code",
        });
        continue;
      }

      const item = await Item.create(
        {
          article_code,
          sku_code,

          item_name,
          metal_type,
          category,
          details: "Uploaded from delivery challan",
          purity,

          gross_weight: finalGrossWeight,
          net_weight: finalNetWeight,
          stone_weight: 0,
          stone_amount: 0,
          making_charge,

          purchase_rate: rate,
          sale_rate: rate,
          hsn_code,
          unit,
          huid_code,

          current_status: "in_stock",

          store_id: organization_id,
          storeCode: store_code,
          storeName: store_name,
          organization_id,

          is_active: true,
          isItemAudit: false,
          itemAuditAt: null,
          is_item_audit: false,
          item_audit_at: null,
          last_audit_status: null,
          last_audit_reason: null,
        },
        { transaction: t }
      );

      /*
        IMPORTANT:
        qr_code_value me ab JSON payload nahi save hoga.
        qr_code_value = sku_code
        qr_code_url = QR image data/base64/url
      */
      let qr = {
        qr_code_value: sku_code,
        qr_code_url: null,
      };

      try {
        qr = await generateItemQR({
          ...item.toJSON(),
          qr_code_value: sku_code,
          sku_code,
          article_code,
          product_code,
        });

        await item.update(
          {
            qr_code_value: sku_code,
            qr_code_url: qr.qr_code_url,
          },
          { transaction: t }
        );

        qr.qr_code_value = sku_code;
      } catch (qrErr) {
        console.error("QR generation failed:", qrErr.message);

        await item.update(
          {
            qr_code_value: sku_code,
            qr_code_url: null,
          },
          { transaction: t }
        );

        qr = {
          qr_code_value: sku_code,
          qr_code_url: null,
        };
      }

      const available_qty = qty;
      const available_weight = unit === "g" ? finalNetWeight : 0;

      await Stock.create(
        {
          item_id: item.id,
          organization_id,
          store_code,

          available_qty,
          available_weight,

          reserved_qty: 0,
          reserved_weight: 0,
          transit_qty: 0,
          transit_weight: 0,
          damaged_qty: 0,
          damaged_weight: 0,
        },
        { transaction: t }
      );

      await StockMovement.create(
        {
          item_id: item.id,
          organization_id,
          store_code,

          // DB check constraint ke according lowercase rakha hai
          movement_type: "purchase",

          qty: available_qty,
          weight: available_weight,

          reference_type: "stock_upload",
          reference_id: item.id,
          reference_no: article_code,

          remarks: "Stock added via delivery challan upload",
          created_by: user_id,
        },
        { transaction: t }
      );

      await ActivityLog.create(
        {
          organization_id,
          user_id,

          action: "stock_upload",
          module_name: "inventory",

          reference_id: item.id,
          reference_no: article_code,

          title: "Stock added via upload",
          description: `${item_name} (${qty} ${unit}) added to inventory`,

          meta: {
            file_name: req.file.originalname,
            file_type: req.file.mimetype,

            item_id: item.id,
            article_code,
            sku_code,
            product_code,

            item_name,
            hsn_code,
            qty,
            unit,
            rate,
            amount,
            purity,
            net_weight: finalNetWeight,
            gross_weight: finalGrossWeight,
            making_charge,
            huid_code,

            store_code,
            store_name,
            organization_id,
          },

          icon: "activity",
          color: "blue",
        },
        { transaction: t }
      );

      await SystemActivity.create(
        {
          title: "Stock Uploaded",
          description: `${item_name} added to ${store_code}`,

          activity_type: "stock_upload",
          module_name: "inventory",

          reference_id: item.id,
          reference_no: article_code,

          state_code,
          district_code,
          store_code,
          store_name,

          created_by: user_id,
        },
        { transaction: t }
      );

      uploaded.push({
        row: rowNo,
        item_id: item.id,

        item_name,
        product_code,
        qty,
        unit,

        hsn_code,
        purity,
        net_weight: finalNetWeight,
        gross_weight: finalGrossWeight,

        rate,
        making_charge,
        huid_code,
        base_value: amount,

        article_code,
        sku_code,

        store_code,
        store_name,
        organization_id,

        qr_code_value: sku_code,
        qr_code_url: qr.qr_code_url,
      });
    }

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Stock-in uploaded successfully",
      total_rows: dataRows.length,
      uploaded_count: uploaded.length,
      skipped_count: skipped.length,
      uploaded,
      skipped,
    });
  } catch (err) {
    await t.rollback();

    console.error("Upload failed:", err);

    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err.message,
    });
  }
};


export const getItemQR = async (req, res) => {
  try {
    const { itemId } = req.params;
    const user = req.user;

    const where = { id: itemId };

    if (user?.role !== "super_admin") {
      where.organization_id = user.organization_id;
    }

    const item = await Item.findOne({
      where,
      attributes: [
        "id",
        "item_name",
        "article_code",
        "sku_code",
        "qr_code_value",
        "qr_code_url",
      ],
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    if (!item.qr_code_url) {
      return res.status(404).json({
        success: false,
        message: "QR not generated for this item",
      });
    }

    return res.status(200).json({
      success: true,
      message: "QR fetched successfully",
      data: {
        item_id: item.id,
        item_name: item.item_name,
        article_code: item.article_code,
        sku_code: item.sku_code,
        qr_code_value: item.qr_code_value,
        qr_code_url: item.qr_code_url,
      },
    });
  } catch (error) {
    console.error("getItemQR error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch item QR",
      error: error.message,
    });
  }
};

export const getMyStoreItemQRs = async (req, res) => {
  try {
    const user = req.user;

    const where = {};

    if (user?.role !== "super_admin") {
      where.organization_id = user.organization_id;
    }

    const items = await Item.findAll({
      where,
      attributes: [
        "id",
        "item_name",
        "article_code",
        "sku_code",
        "qr_code_value",
        "qr_code_url",
        "current_status",
      ],
      order: [["id", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      message: "QR list fetched successfully",
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error("getMyStoreItemQRs error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch QR list",
      error: error.message,
    });
  }
};
/* =========================================================
   UPDATE ITEM IMAGE
========================================================= */

export const updateItemImage = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { itemId } = req.params;
    const user = req.user;

    if (!req.file) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Image file is required",
      });
    }

    const where = {
      id: itemId,
    };

    // if (user?.role !== "super_admin") {
    //   where.organization_id = user?.organization_id;
    // }

    const item = await Item.findOne({
      where,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const uploadedImage = await uploadToCloudinary(
      req.file,
      "inventory/items"
    );

    await item.update(
      {
        image_url: uploadedImage?.secure_url || null,
        image_public_id: uploadedImage?.public_id || null,
      },
      { transaction: t }
    );

    await createActivityLog({
      organization_id: item.organization_id,
      user_id: user?.id || null,
      module: "stock",
      action: "update_item_image",
      entity_type: "item",
      entity_id: item.id,
      title: "Item image updated",
      description: `${item.item_name} image updated`,
      metadata: {
        item_id: item.id,
        article_code: item.article_code,
        sku_code: item.sku_code,
        image_url: uploadedImage?.secure_url || null,
        image_public_id: uploadedImage?.public_id || null,
      },
    });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Item image updated successfully",
      data: {
        item_id: item.id,
        item_name: item.item_name,
        article_code: item.article_code,
        sku_code: item.sku_code,
        image_url: item.image_url,
        image_public_id: item.image_public_id,
      },
    });
  } catch (error) {
    await t.rollback();

    console.error("updateItemImage error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update item image",
      error: error.message,
    });
  }
};
