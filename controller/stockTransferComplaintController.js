import { Op,QueryTypes } from "sequelize";

import sequelize from "../config/db.js";
import Item from "../model/item.js";
import StockTransfer from "../model/stockTransfer.js";
import StockTransferItem from "../model/stockTransferItem.js";
import StockTransferComplaint from "../model/StockTransferComplaint.js";
import SystemActivity from "../model/systemActivity.js";
import ActivityLog from "../model/activityLog.js";
import Store from "../model/Store.js";
import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";
import Stock from "../model/stockrecord.js";
/**
 * Safely converts any value into a number.
 */
const toNumber = (value) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

/**
 * Generates a unique complaint number.
 */
const generateComplaintNo = (transferNo, transferId) => {
  const safeTransferNo = String(transferNo || transferId)
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toUpperCase();

  return `CMP-${safeTransferNo}-${Date.now()}`;
};

/**
 * Parses complaint items from multipart form-data.
 *
 * Items may come as:
 * 1. Direct JavaScript array
 * 2. JSON string inside form-data
 */
const parseComplaintItems = (items) => {
  if (Array.isArray(items)) {
    return items;
  }

  if (typeof items === "string") {
    try {
      const parsedItems = JSON.parse(items);

      return Array.isArray(parsedItems) ? parsedItems : [];
    } catch {
      return [];
    }
  }

  return [];
};

/**
 * Raise complaint against selected transfer items.
 *
 * Important:
 * - Transfer status will remain "in_transit".
 * - Stock request status will not be changed.
 * - Remaining transfer items can still be received.
 * - Complaint items remain tracked separately.
 */
export const raiseTransferComplaint = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { transferId } = req.params;

    const {
      complaint_type = "quantity_shortage",
      description,
    } = req.body;

    const user = req.user;

    // =====================================================
    // USER VALIDATION
    // =====================================================

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
    // TRANSFER ID VALIDATION
    // =====================================================

    const parsedTransferId = Number(transferId);

    if (
      !parsedTransferId ||
      !Number.isInteger(parsedTransferId) ||
      parsedTransferId <= 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Valid transferId is required",
      });
    }

    // =====================================================
    // ITEMS PARSE
    //
    // Multipart form-data me items JSON string aayega.
    // =====================================================

    const requestedItems = parseComplaintItems(req.body.items);

    if (!requestedItems.length) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "At least one complaint item is required",
      });
    }

    // =====================================================
    // FILE VALIDATION
    //
    // Expected fields:
    // images = exactly 2 files
    // video  = exactly 1 file
    // =====================================================

    const images = Array.isArray(req.files?.images)
      ? req.files.images
      : [];

    const videos = Array.isArray(req.files?.video)
      ? req.files.video
      : [];

    if (images.length !== 2) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Exactly 2 complaint images are required",
      });
    }

    if (videos.length !== 1) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Exactly 1 complaint video is required",
      });
    }

    // =====================================================
    // FILE TYPE VALIDATION
    // =====================================================

    const validImageTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];

    const validVideoTypes = [
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/webm",
    ];

    for (const image of images) {
      if (!validImageTypes.includes(image.mimetype)) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Only JPG, JPEG, PNG and WEBP images are allowed",
        });
      }
    }

    if (!validVideoTypes.includes(videos[0].mimetype)) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Only MP4, MPEG, MOV and WEBM videos are allowed",
      });
    }

    // =====================================================
    // FETCH TRANSFER
    // =====================================================

    const transfer = await StockTransfer.findByPk(
      parsedTransferId,
      {
        transaction,
        lock: transaction.LOCK.UPDATE,
      }
    );

    if (!transfer) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    // =====================================================
    // RECEIVER AUTHORIZATION
    // =====================================================

    if (
      Number(transfer.to_organization_id) !==
      Number(user.organization_id)
    ) {
      await transaction.rollback();

      return res.status(403).json({
        success: false,
        message:
          "You cannot raise complaint for this transfer",
      });
    }

    // =====================================================
    // TRANSFER STATUS VALIDATION
    //
    // Transfer complaint ke baad bhi in_transit hi rahega,
    // taaki remaining items receive ho sakein.
    // =====================================================

    const transferStatus = String(transfer.status || "")
      .trim()
      .toLowerCase();

    if (transferStatus !== "in_transit") {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Complaint can only be raised for an in-transit transfer",
      });
    }

    // =====================================================
    // DUPLICATE ACTIVE COMPLAINT CHECK
    // =====================================================

    const existingComplaint =
      await StockTransferComplaint.findOne({
        where: {
          transfer_id: transfer.id,

          status: {
            [Op.in]: ["open", "under_review"],
          },
        },

        transaction,
        lock: transaction.LOCK.UPDATE,
      });

    if (existingComplaint) {
      await transaction.rollback();

      return res.status(409).json({
        success: false,

        message:
          "An active complaint already exists for this transfer",

        data: {
          complaint_id: existingComplaint.id,
          complaint_no: existingComplaint.complaint_no,
          status: existingComplaint.status,
        },
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

    const transferItemMap = new Map();

    for (const transferItem of transferItems) {
      transferItemMap.set(
        Number(transferItem.id),
        transferItem
      );
    }

    // =====================================================
    // VALIDATE DUPLICATE TRANSFER ITEMS IN PAYLOAD
    // =====================================================

    const requestedTransferItemIds = new Set();

    for (const requestedItem of requestedItems) {
      const transferItemId = Number(
        requestedItem.transfer_item_id
      );

      if (
        transferItemId &&
        requestedTransferItemIds.has(transferItemId)
      ) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Duplicate transfer_item_id ${transferItemId} found in complaint items`,
        });
      }

      if (transferItemId) {
        requestedTransferItemIds.add(transferItemId);
      }
    }

    // =====================================================
    // VALIDATE AND PREPARE COMPLAINT ITEMS JSON
    // =====================================================

    const complaintItems = [];

    for (const requestedItem of requestedItems) {
      const transferItemId = Number(
        requestedItem.transfer_item_id
      );

      if (!transferItemId) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            "transfer_item_id is required for every item",
        });
      }

      const transferItem =
        transferItemMap.get(transferItemId);

      if (!transferItem) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Transfer item ${transferItemId} does not belong to this transfer`,
        });
      }

      const sentQty = toNumber(transferItem.qty);
      const sentWeight = toNumber(transferItem.weight);

      const receivedQty = toNumber(
        requestedItem.received_qty
      );

      const receivedWeight = toNumber(
        requestedItem.received_weight
      );

      // ===================================================
      // QUANTITY VALIDATION
      // ===================================================

      if (receivedQty < 0) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Received quantity cannot be negative for transfer item ${transferItemId}`,
        });
      }

      if (receivedQty > sentQty) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Received quantity cannot exceed sent quantity for transfer item ${transferItemId}`,
          sent_qty: sentQty,
          received_qty: receivedQty,
        });
      }

      if (receivedQty >= sentQty) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Complaint cannot be raised because no quantity shortage exists for transfer item ${transferItemId}`,
          sent_qty: sentQty,
          received_qty: receivedQty,
        });
      }

      // ===================================================
      // WEIGHT VALIDATION
      // ===================================================

      if (receivedWeight < 0) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Received weight cannot be negative for transfer item ${transferItemId}`,
        });
      }

      if (
        sentWeight > 0 &&
        receivedWeight > sentWeight
      ) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Received weight cannot exceed sent weight for transfer item ${transferItemId}`,
          sent_weight: sentWeight,
          received_weight: receivedWeight,
        });
      }

      const shortageQty = Number(
        Math.max(0, sentQty - receivedQty).toFixed(3)
      );

      const shortageWeight = Number(
        Math.max(
          0,
          sentWeight - receivedWeight
        ).toFixed(3)
      );

      complaintItems.push({
        transfer_item_id: transferItem.id,
        item_id: transferItem.item_id,

        sent_qty: sentQty,
        received_qty: receivedQty,
        shortage_qty: shortageQty,

        sent_weight: sentWeight,
        received_weight: receivedWeight,
        shortage_weight: shortageWeight,

        note: requestedItem.note || null,
      });
    }

    // =====================================================
    // UPLOAD 2 IMAGES AND 1 VIDEO
    // =====================================================

    const image1Upload = await uploadToCloudinary(
      images[0].path,
      "stock-transfer-complaints/images",
      "image"
    );

    const image2Upload = await uploadToCloudinary(
      images[1].path,
      "stock-transfer-complaints/images",
      "image"
    );

    const videoUpload = await uploadToCloudinary(
      videos[0].path,
      "stock-transfer-complaints/videos",
      "video"
    );

    const image1Url =
      image1Upload?.secure_url ||
      image1Upload?.url ||
      null;

    const image2Url =
      image2Upload?.secure_url ||
      image2Upload?.url ||
      null;

    const videoUrl =
      videoUpload?.secure_url ||
      videoUpload?.url ||
      null;

    if (!image1Url || !image2Url || !videoUrl) {
      throw new Error(
        "Failed to upload complaint evidence"
      );
    }

    // =====================================================
    // CREATE COMPLAINT
    // =====================================================

    const complaintNo = generateComplaintNo(
      transfer.transfer_no,
      transfer.id
    );

    const complaint =
      await StockTransferComplaint.create(
        {
          complaint_no: complaintNo,

          transfer_id: transfer.id,

          from_organization_id:
            transfer.from_organization_id,

          to_organization_id:
            transfer.to_organization_id,

          complaint_type: String(
            complaint_type || "quantity_shortage"
          )
            .trim()
            .toLowerCase(),

          description: description || null,

          items: complaintItems,

          image_1_url: image1Url,
          image_2_url: image2Url,
          video_url: videoUrl,

          status: "open",

          raised_by: user.id,
        },
        {
          transaction,
        }
      );

    // =====================================================
    // IMPORTANT CHANGE
    //
    // Transfer ka status "complaint_raised" nahi karenge.
    // Transfer "in_transit" hi rahega.
    //
    // Isse:
    // 1. Transfer card list me visible rahega.
    // 2. Remaining items receive ho sakenge.
    // 3. Complaint items separately track honge.
    //
    // Sirf remarks me complaint details save kar rahe hain.
    // =====================================================

    const oldRemarks = String(
      transfer.remarks || ""
    ).trim();

    const complaintRemark =
      description ||
      `Complaint ${complaintNo} raised due to quantity shortage`;

    const updatedRemarks = oldRemarks
      ? `${oldRemarks}\n${complaintRemark}`
      : complaintRemark;

    await transfer.update(
      {
        remarks: updatedRemarks,

        // Status intentionally unchanged.
        // Current status "in_transit" hi rahega.
      },
      {
        transaction,
      }
    );

    // =====================================================
    // IMPORTANT CHANGE
    //
    // StockRequest ka status bhi change nahi hoga.
    //
    // Pehle request status complaint_raised ho raha tha,
    // jiski wajah se request/card frontend list se disappear
    // ho raha tha.
    //
    // Ab StockRequest ko touch nahi karenge.
    // =====================================================

    // No StockRequest status update here.

    // =====================================================
    // SYSTEM ACTIVITY
    // =====================================================

    await SystemActivity.create(
      {
        title: "Stock transfer complaint raised",

        description:
          `Complaint ${complaintNo} raised against transfer ${transfer.transfer_no}. Transfer remains in transit for remaining items.`,

        activity_type:
          "stock_transfer_complaint_raised",

        module_name:
          "stock_transfer_complaint",

        reference_id: complaint.id,
        reference_no: complaintNo,

        district_code:
          user.district_code || null,

        store_code: receiverStoreCode,
        store_name: user.store_name || null,

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
        organization_id: user.organization_id,

        user_id: user.id,

        action:
          "stock_transfer_complaint_raised",

        module_name:
          "stock_transfer_complaint",

        reference_id: complaint.id,
        reference_no: complaintNo,

        title:
          "Stock transfer complaint raised",

        description:
          `Complaint ${complaintNo} raised against transfer ${transfer.transfer_no}. Remaining items can still be received.`,

        meta: {
          complaint_id: complaint.id,
          complaint_no: complaintNo,

          transfer_id: transfer.id,
          transfer_no: transfer.transfer_no,

          from_organization_id:
            transfer.from_organization_id,

          to_organization_id:
            transfer.to_organization_id,

          store_code: receiverStoreCode,

          complaint_type:
            complaint.complaint_type,

          items: complaintItems,

          image_1_url: image1Url,
          image_2_url: image2Url,
          video_url: videoUrl,

          complaint_status: "open",

          transfer_status:
            transfer.status,

          transfer_status_changed: false,

          remaining_items_receivable: true,
        },

        icon: "complaint",
        color: "red",
      },
      {
        transaction,
      }
    );

    await transaction.commit();

    // =====================================================
    // SUCCESS RESPONSE
    // =====================================================

    return res.status(201).json({
      success: true,

      message:
        "Transfer complaint raised successfully. Transfer card will remain visible and remaining items can still be received.",

      data: {
        id: complaint.id,

        complaint_no:
          complaint.complaint_no,

        transfer_id:
          complaint.transfer_id,

        transfer_no:
          transfer.transfer_no,

        transfer_status:
          transfer.status,

        transfer_status_changed: false,

        card_should_remain_visible: true,

        remaining_items_receivable: true,

        complaint_type:
          complaint.complaint_type,

        description:
          complaint.description,

        items: complaint.items,

        evidence: {
          image_1_url:
            complaint.image_1_url,

          image_2_url:
            complaint.image_2_url,

          video_url:
            complaint.video_url,
        },

        status: complaint.status,

        raised_by:
          complaint.raised_by,

        created_at:
          complaint.created_at,
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
      "raiseTransferComplaint error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to raise transfer complaint",
      error: error.message,
    });
  }
};


/**
 * =========================================================
 * GET COMPLAINTS RAISED AGAINST LOGGED-IN STORE
 * =========================================================
 *
 * Logged-in store sirf wahi complaints dekh payega jahan:
 *
 * complaint.from_organization_id === user.organization_id
 *
 * Matlab:
 * Source/Sender store ke against receiver ne complaint raise ki hai.
 *
 * Supported query parameters:
 *
 * page
 * limit
 * status
 * complaint_type
 * search
 * date_from
 * date_to
 *
 * Example:
 *
 * GET /api/stock-transfer-complaints/store
 *
 * GET /api/stock-transfer-complaints/store?page=1&limit=10
 *
 * GET /api/stock-transfer-complaints/store?status=open
 *
 * GET /api/stock-transfer-complaints/store?complaint_type=quantity_shortage
 *
 * GET /api/stock-transfer-complaints/store?search=CMP
 */
export const getStoreComplaints = async (req, res) => {
  try {
    const user = req.user;

    // =====================================================
    // USER VALIDATION
    // =====================================================

    if (!user?.id || !user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const storeOrganizationId = Number(
      user.organization_id
    );

    if (
      !storeOrganizationId ||
      !Number.isInteger(storeOrganizationId) ||
      storeOrganizationId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid store organization is required",
      });
    }

    // =====================================================
    // QUERY PARAMETERS
    // =====================================================

    const {
      page = 1,
      limit = 10,
      status,
      complaint_type,
      search,
      date_from,
      date_to,
    } = req.query;

    const pageNo = Math.max(
      Number(page) || 1,
      1
    );

    const limitNo = Math.min(
      Math.max(Number(limit) || 10, 1),
      100
    );

    const offset = (pageNo - 1) * limitNo;

    // =====================================================
    // COMPLAINT WHERE CONDITION
    // =====================================================

    const complaintWhere = {
      /*
       * Complaint logged-in store ke against
       * raise hui honi chahiye.
       */
      from_organization_id:
        storeOrganizationId,
    };

    // =====================================================
    // STATUS FILTER
    // =====================================================

    if (
      status &&
      String(status).trim().toLowerCase() !==
        "all"
    ) {
      complaintWhere.status = String(status)
        .trim()
        .toLowerCase();
    }

    // =====================================================
    // COMPLAINT TYPE FILTER
    // =====================================================

    if (
      complaint_type &&
      String(complaint_type)
        .trim()
        .toLowerCase() !== "all"
    ) {
      complaintWhere.complaint_type = String(
        complaint_type
      )
        .trim()
        .toLowerCase();
    }

    // =====================================================
    // DATE FILTER
    // =====================================================

    if (date_from || date_to) {
      complaintWhere.created_at = {};

      if (date_from) {
        const fromDate = new Date(
          `${date_from}T00:00:00.000Z`
        );

        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid date_from. Use YYYY-MM-DD format",
          });
        }

        complaintWhere.created_at[Op.gte] =
          fromDate;
      }

      if (date_to) {
        const toDate = new Date(
          `${date_to}T23:59:59.999Z`
        );

        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid date_to. Use YYYY-MM-DD format",
          });
        }

        complaintWhere.created_at[Op.lte] =
          toDate;
      }
    }

    // =====================================================
    // SEARCH FILTER
    //
    // Search complaint number, description and transfer no.
    // =====================================================

    const normalizedSearch = String(
      search || ""
    ).trim();

    if (normalizedSearch) {
      /*
       * Transfer number StockTransfer table me hai.
       * Pehle matching transfer IDs nikalenge.
       */

      const matchingTransfers =
        await StockTransfer.findAll({
          where: {
            from_organization_id:
              storeOrganizationId,

            transfer_no: {
              [Op.iLike]:
                `%${normalizedSearch}%`,
            },
          },

          attributes: ["id"],

          raw: true,
        });

      const matchingTransferIds =
        matchingTransfers
          .map((transfer) =>
            Number(transfer.id)
          )
          .filter(Boolean);

      const searchConditions = [
        {
          complaint_no: {
            [Op.iLike]:
              `%${normalizedSearch}%`,
          },
        },
        {
          description: {
            [Op.iLike]:
              `%${normalizedSearch}%`,
          },
        },
      ];

      if (matchingTransferIds.length) {
        searchConditions.push({
          transfer_id: {
            [Op.in]:
              matchingTransferIds,
          },
        });
      }

      complaintWhere[Op.or] =
        searchConditions;
    }

    // =====================================================
    // FETCH COMPLAINTS
    // =====================================================

    const { count, rows: complaints } =
      await StockTransferComplaint.findAndCountAll(
        {
          where: complaintWhere,

          order: [
            ["created_at", "DESC"],
            ["id", "DESC"],
          ],

          limit: limitNo,
          offset,

          distinct: true,
        }
      );

    // =====================================================
    // NO COMPLAINTS
    // =====================================================

    if (!complaints.length) {
      return res.status(200).json({
        success: true,

        message:
          "No complaints found against this store",

        summary: {
          total_complaints: count,
          open_complaints: 0,
          under_review_complaints: 0,
          resolved_complaints: 0,
          rejected_complaints: 0,
        },

        pagination: {
          current_page: pageNo,
          per_page: limitNo,
          total_records: count,
          total_pages: Math.ceil(
            count / limitNo
          ),
        },

        data: [],
      });
    }

    // =====================================================
    // FETCH RELATED TRANSFERS
    // =====================================================

    const transferIds = [
      ...new Set(
        complaints
          .map((complaint) =>
            Number(complaint.transfer_id)
          )
          .filter(Boolean)
      ),
    ];

    const transfers =
      transferIds.length > 0
        ? await StockTransfer.findAll({
            where: {
              id: {
                [Op.in]: transferIds,
              },

              /*
               * Additional security:
               * Related transfer bhi logged-in
               * store ka hona chahiye.
               */
              from_organization_id:
                storeOrganizationId,
            },

            raw: true,
          })
        : [];

    const transferMap = new Map();

    for (const transfer of transfers) {
      transferMap.set(
        Number(transfer.id),
        transfer
      );
    }

    // =====================================================
    // FORMAT COMPLAINT RESPONSE
    // =====================================================

    const formattedComplaints =
      complaints.map((complaintModel) => {
        const complaint =
          complaintModel.toJSON();

        const transfer =
          transferMap.get(
            Number(complaint.transfer_id)
          ) || null;

        const complaintItems =
          Array.isArray(complaint.items)
            ? complaint.items
            : [];

        const totalSentQty =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(item.sent_qty || 0),
            0
          );

        const totalReceivedQty =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(
                item.received_qty || 0
              ),
            0
          );

        const totalShortageQty =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(
                item.shortage_qty || 0
              ),
            0
          );

        const totalSentWeight =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(
                item.sent_weight || 0
              ),
            0
          );

        const totalReceivedWeight =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(
                item.received_weight || 0
              ),
            0
          );

        const totalShortageWeight =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(
                item.shortage_weight || 0
              ),
            0
          );

        return {
          complaint_id: complaint.id,

          complaint_no:
            complaint.complaint_no,

          complaint_type:
            complaint.complaint_type,

          description:
            complaint.description,

          complaint_status:
            complaint.status,

          /*
           * Kis transfer ke against
           * complaint raise hui hai.
           */
          transfer: transfer
            ? {
                transfer_id:
                  transfer.id,

                transfer_no:
                  transfer.transfer_no,

                request_id:
                  transfer.request_id ||
                  null,

                status:
                  transfer.status,

                from_organization_id:
                  transfer.from_organization_id,

                to_organization_id:
                  transfer.to_organization_id,

                dispatch_date:
                  transfer.dispatch_date ||
                  transfer.dispatched_at ||
                  null,

                received_date:
                  transfer.received_date ||
                  transfer.received_at ||
                  null,

                remarks:
                  transfer.remarks ||
                  null,
              }
            : {
                transfer_id:
                  complaint.transfer_id,

                transfer_no: null,
              },

          from_organization_id:
            complaint.from_organization_id,

          to_organization_id:
            complaint.to_organization_id,

          /*
           * Complaint items.
           */
          items: complaintItems,

          item_summary: {
            total_complaint_items:
              complaintItems.length,

            total_sent_qty: Number(
              totalSentQty.toFixed(3)
            ),

            total_received_qty: Number(
              totalReceivedQty.toFixed(3)
            ),

            total_shortage_qty: Number(
              totalShortageQty.toFixed(3)
            ),

            total_sent_weight: Number(
              totalSentWeight.toFixed(3)
            ),

            total_received_weight:
              Number(
                totalReceivedWeight.toFixed(
                  3
                )
              ),

            total_shortage_weight:
              Number(
                totalShortageWeight.toFixed(
                  3
                )
              ),
          },

          evidence: {
            image_1_url:
              complaint.image_1_url ||
              null,

            image_2_url:
              complaint.image_2_url ||
              null,

            video_url:
              complaint.video_url ||
              null,
          },

          raised_by:
            complaint.raised_by,

          resolved_by:
            complaint.resolved_by ||
            null,

          resolution_note:
            complaint.resolution_note ||
            null,

          created_at:
            complaint.created_at,

          updated_at:
            complaint.updated_at,
        };
      });

    // =====================================================
    // COMPLAINT SUMMARY
    //
    // Entire store complaints ka count hai,
    // sirf current page ka nahi.
    // =====================================================

    const complaintSummaryRows =
      await StockTransferComplaint.findAll({
        where: {
          from_organization_id:
            storeOrganizationId,
        },

        attributes: ["status"],

        raw: true,
      });

    const summary = {
      total_complaints:
        complaintSummaryRows.length,

      open_complaints: 0,

      under_review_complaints: 0,

      resolved_complaints: 0,

      rejected_complaints: 0,

      closed_complaints: 0,
    };

    for (const complaint of complaintSummaryRows) {
      const complaintStatus = String(
        complaint.status || ""
      )
        .trim()
        .toLowerCase();

      if (complaintStatus === "open") {
        summary.open_complaints += 1;
      } else if (
        complaintStatus === "under_review"
      ) {
        summary.under_review_complaints +=
          1;
      } else if (
        complaintStatus === "resolved"
      ) {
        summary.resolved_complaints += 1;
      } else if (
        complaintStatus === "rejected"
      ) {
        summary.rejected_complaints += 1;
      } else if (
        complaintStatus === "closed"
      ) {
        summary.closed_complaints += 1;
      }
    }

    // =====================================================
    // FINAL RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      message:
        "Store complaints fetched successfully",

      store: {
        organization_id:
          storeOrganizationId,

        store_code:
          user.store_code ||
          user.storeCode ||
          null,

        store_name:
          user.store_name || null,
      },

      summary,

      pagination: {
        current_page: pageNo,
        per_page: limitNo,
        total_records: count,
        total_pages: Math.ceil(
          count / limitNo
        ),
        has_next_page:
          pageNo <
          Math.ceil(count / limitNo),
        has_previous_page:
          pageNo > 1,
      },

      data: formattedComplaints,
    });
  } catch (error) {
    console.error(
      "getStoreComplaints error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch store complaints",
      error: error.message,
    });
  }
};


/**
 * =========================================================
 * UPDATE STOCK TRANSFER COMPLAINT STATUS
 * =========================================================
 *
 * Route:
 * PATCH /api/stock-transfer-complaints/:complaintId/status
 *
 * Body:
 * {
 *   "status": "under_review",
 *   "resolution_note": "Complaint verification started"
 * }
 *
 * Allowed statuses:
 * - open
 * - under_review
 * - resolved
 * - rejected
 * - closed
 *
 * Important:
 * - Sirf wahi store complaint update kar sakta hai
 *   jiske against complaint raise hui hai.
 *
 * - Complaint status update hone par transfer status
 *   automatically change nahi hoga.
 *
 * - Transfer card aur receiving flow alag rahega.
 */
export const updateTransferComplaintStatus = async (
  req,
  res
) => {
  const transaction = await sequelize.transaction();

  try {
    const { complaintId } = req.params;

    const {
      status,
      resolution_note,
    } = req.body;

    const user = req.user;

    // =====================================================
    // USER VALIDATION
    // =====================================================

    if (!user?.id || !user?.organization_id) {
      await transaction.rollback();

      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const organizationId = Number(
      user.organization_id
    );

    if (
      !organizationId ||
      !Number.isInteger(organizationId) ||
      organizationId <= 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Valid user organization is required",
      });
    }

    // =====================================================
    // COMPLAINT ID VALIDATION
    // =====================================================

    const parsedComplaintId = Number(complaintId);

    if (
      !parsedComplaintId ||
      !Number.isInteger(parsedComplaintId) ||
      parsedComplaintId <= 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Valid complaintId is required",
      });
    }

    // =====================================================
    // STATUS VALIDATION
    // =====================================================

    if (!status) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "status is required",
      });
    }

    const normalizedStatus = String(status)
      .trim()
      .toLowerCase();

    const allowedStatuses = [
      "open",
      "under_review",
      "replacement_dispatched",
      "resolved",
      "rejected",
      "closed",
    ];

    if (
      !allowedStatuses.includes(
        normalizedStatus
      )
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,

        message:
          "Invalid complaint status",

        allowed_statuses: allowedStatuses,
      });
    }

    // =====================================================
    // RESOLUTION NOTE VALIDATION
    //
    // Resolved, rejected aur closed karte waqt
    // resolution_note required rahega.
    // =====================================================

    const normalizedResolutionNote = String(
      resolution_note || ""
    ).trim();

    const noteRequiredStatuses = [
      "resolved",
      "rejected",
      "closed",
    ];

    if (
      noteRequiredStatuses.includes(
        normalizedStatus
      ) &&
      !normalizedResolutionNote
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,

        message:
          `resolution_note is required when complaint status is ${normalizedStatus}`,
      });
    }

    // =====================================================
    // FETCH COMPLAINT
    // =====================================================

    const complaint =
      await StockTransferComplaint.findByPk(
        parsedComplaintId,
        {
          transaction,
          lock: transaction.LOCK.UPDATE,
        }
      );

    if (!complaint) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    // =====================================================
    // STORE AUTHORIZATION
    //
    // Complaint jis source store ke against raise hui hai,
    // sirf wahi store status update kar sakta hai.
    // =====================================================

    if (
      Number(
        complaint.from_organization_id
      ) !== organizationId
    ) {
      await transaction.rollback();

      return res.status(403).json({
        success: false,

        message:
          "You are not allowed to update this complaint",

        details:
          "Only the store against which the complaint was raised can update its status",
      });
    }

    // =====================================================
    // CURRENT STATUS
    // =====================================================

    const oldStatus = String(
      complaint.status || ""
    )
      .trim()
      .toLowerCase();

    if (oldStatus === normalizedStatus) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,

        message:
          `Complaint status is already ${normalizedStatus}`,
      });
    }

    // =====================================================
    // STATUS TRANSITION VALIDATION
    //
    // open         -> under_review / resolved / rejected
    // under_review -> resolved / rejected / open
    // resolved     -> closed
    // rejected     -> closed / under_review
    // closed       -> no further status update
    // =====================================================

    const allowedTransitions = {
      open: [
        "under_review",
        "resolved",
        "rejected",
      ],

      under_review: [
        "open",
        "resolved",
        "rejected",
      ],

      resolved: ["closed"],

      rejected: [
        "under_review",
        "closed",
      ],

      closed: [],
    };

    const validNextStatuses =
      allowedTransitions[oldStatus] || [];

    if (
      !validNextStatuses.includes(
        normalizedStatus
      )
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,

        message:
          `Complaint status cannot be changed from ${oldStatus} to ${normalizedStatus}`,

        current_status: oldStatus,

        allowed_next_statuses:
          validNextStatuses,
      });
    }

    // =====================================================
    // FETCH RELATED TRANSFER
    // =====================================================

    const transfer = complaint.transfer_id
      ? await StockTransfer.findByPk(
          complaint.transfer_id,
          {
            transaction,
          }
        )
      : null;

    // =====================================================
    // PREPARE UPDATE PAYLOAD
    //
    // rawAttributes check isliye use kiya hai taaki agar
    // resolved_by, resolved_at ya resolution_note columns
    // model me available hain tabhi update hon.
    // =====================================================

    const complaintAttributes =
      StockTransferComplaint.rawAttributes ||
      {};

    const updatePayload = {
      status: normalizedStatus,
    };

    if (
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "resolution_note"
      )
    ) {
      updatePayload.resolution_note =
        normalizedResolutionNote || null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "updated_by"
      )
    ) {
      updatePayload.updated_by = user.id;
    }

    if (
      normalizedStatus === "under_review" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "reviewed_by"
      )
    ) {
      updatePayload.reviewed_by = user.id;
    }

    if (
      normalizedStatus === "under_review" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "reviewed_at"
      )
    ) {
      updatePayload.reviewed_at =
        new Date();
    }

    if (
      normalizedStatus === "resolved" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "resolved_by"
      )
    ) {
      updatePayload.resolved_by = user.id;
    }

    if (
      normalizedStatus === "resolved" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "resolved_at"
      )
    ) {
      updatePayload.resolved_at =
        new Date();
    }

    if (
      normalizedStatus === "rejected" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "rejected_by"
      )
    ) {
      updatePayload.rejected_by = user.id;
    }

    if (
      normalizedStatus === "rejected" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "rejected_at"
      )
    ) {
      updatePayload.rejected_at =
        new Date();
    }

    if (
      normalizedStatus === "closed" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "closed_by"
      )
    ) {
      updatePayload.closed_by = user.id;
    }

    if (
      normalizedStatus === "closed" &&
      Object.prototype.hasOwnProperty.call(
        complaintAttributes,
        "closed_at"
      )
    ) {
      updatePayload.closed_at =
        new Date();
    }

    // =====================================================
    // UPDATE COMPLAINT
    // =====================================================

    await complaint.update(
      updatePayload,
      {
        transaction,
      }
    );

    // =====================================================
    // IMPORTANT
    //
    // Transfer ka status yahan update nahi kar rahe.
    //
    // Complaint status aur transfer receiving status
    // dono separate flows hain.
    //
    // Isse remaining items ka Stock In continue rahega.
    // =====================================================

    // No StockTransfer status update here.

    // =====================================================
    // SYSTEM ACTIVITY
    // =====================================================

    const receiverStoreCode = String(
      user.store_code || user.storeCode || ""
    )
      .trim()
      .toUpperCase();

    await SystemActivity.create(
      {
        title:
          "Stock transfer complaint status updated",

        description:
          `Complaint ${complaint.complaint_no} status changed from ${oldStatus} to ${normalizedStatus}`,

        activity_type:
          "stock_transfer_complaint_status_updated",

        module_name:
          "stock_transfer_complaint",

        reference_id:
          complaint.id,

        reference_no:
          complaint.complaint_no,

        district_code:
          user.district_code || null,

        store_code:
          receiverStoreCode || null,

        store_name:
          user.store_name || null,

        created_by:
          user.id,

        created_at:
          new Date(),
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
          organizationId,

        user_id:
          user.id,

        action:
          "stock_transfer_complaint_status_updated",

        module_name:
          "stock_transfer_complaint",

        reference_id:
          complaint.id,

        reference_no:
          complaint.complaint_no,

        title:
          "Complaint status updated",

        description:
          `Complaint ${complaint.complaint_no} status changed from ${oldStatus} to ${normalizedStatus}`,

        meta: {
          complaint_id:
            complaint.id,

          complaint_no:
            complaint.complaint_no,

          transfer_id:
            complaint.transfer_id,

          transfer_no:
            transfer?.transfer_no || null,

          from_organization_id:
            complaint.from_organization_id,

          to_organization_id:
            complaint.to_organization_id,

          old_status:
            oldStatus,

          new_status:
            normalizedStatus,

          resolution_note:
            normalizedResolutionNote || null,

          updated_by:
            user.id,

          transfer_status:
            transfer?.status || null,

          transfer_status_changed:
            false,
        },

        icon:
          normalizedStatus === "resolved"
            ? "check-circle"
            : normalizedStatus === "rejected"
              ? "x-circle"
              : normalizedStatus === "closed"
                ? "lock"
                : "complaint",

        color:
          normalizedStatus === "resolved"
            ? "green"
            : normalizedStatus === "rejected"
              ? "red"
              : normalizedStatus === "closed"
                ? "gray"
                : "orange",
      },
      {
        transaction,
      }
    );

    await transaction.commit();

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      message:
        `Complaint status updated successfully from ${oldStatus} to ${normalizedStatus}`,

      data: {
        complaint_id:
          complaint.id,

        complaint_no:
          complaint.complaint_no,

        transfer_id:
          complaint.transfer_id,

        transfer_no:
          transfer?.transfer_no || null,

        old_status:
          oldStatus,

        status:
          complaint.status,

        resolution_note:
          complaint.resolution_note ||
          normalizedResolutionNote ||
          null,

        updated_by: {
          user_id:
            user.id,

          organization_id:
            organizationId,

          store_code:
            user.store_code ||
            user.storeCode ||
            null,

          store_name:
            user.store_name || null,
        },

        transfer: {
          status:
            transfer?.status || null,

          status_changed:
            false,

          remaining_items_receivable:
            transfer?.status ===
            "in_transit",
        },

        updated_at:
          complaint.updated_at,
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
      "updateTransferComplaintStatus error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to update complaint status",

      error:
        error.message,
    });
  }
};
/**
 * =========================================================
 * GET ALL STOCK TRANSFER COMPLAINTS FOR HEAD OFFICE
 * =========================================================
 *
 * Head Office saare stores ki complaints dekh sakta hai.
 *
 * Route:
 * GET /api/stock-transfer-complaints/head/all
 *
 * Query params:
 *
 * page
 * limit
 * status
 * complaint_type
 * search
 * from_store_code
 * to_store_code
 * date_from
 * date_to
 *
 * Examples:
 *
 * GET /api/stock-transfer-complaints/head/all
 *
 * GET /api/stock-transfer-complaints/head/all?status=open
 *
 * GET /api/stock-transfer-complaints/head/all?search=CMP
 *
 * GET /api/stock-transfer-complaints/head/all?from_store_code=DST500
 *
 * GET /api/stock-transfer-complaints/head/all?page=1&limit=10
 */
export const getHeadAllTransferComplaints = async (
  req,
  res
) => {
  try {
    const user = req.user;

    // =====================================================
    // AUTHENTICATION
    // =====================================================

    if (!user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    // =====================================================
    // HEAD OFFICE AUTHORIZATION
    // =====================================================

    const role = String(user.role || "")
      .trim()
      .toLowerCase();

    const organizationLevel = String(
      user.organization_level || ""
    )
      .trim()
      .toLowerCase();

    const allowedRoles = [
      "super_admin",
      "super-admin",
      "head_admin",
      "head-admin",
      "head_manager",
      "head-manager",
      "head_office",
    ];

    const isHeadUser =
      allowedRoles.includes(role) ||
      organizationLevel === "head_office" ||
      organizationLevel === "head office" ||
      organizationLevel === "head";

    if (!isHeadUser) {
      return res.status(403).json({
        success: false,
        message:
          "Only Head Office users can access all complaints",
      });
    }

    // =====================================================
    // QUERY PARAMETERS
    // =====================================================

    const {
      page = 1,
      limit = 10,
      status,
      complaint_type,
      search,
      from_store_code,
      to_store_code,
      date_from,
      date_to,
    } = req.query;

    const pageNumber = Math.max(
      Number(page) || 1,
      1
    );

    const pageLimit = Math.min(
      Math.max(Number(limit) || 10, 1),
      100
    );

    const offset =
      (pageNumber - 1) * pageLimit;

    // =====================================================
    // COMPLAINT WHERE CONDITION
    // =====================================================

    const complaintWhere = {};

    // =====================================================
    // STATUS FILTER
    // =====================================================

    if (
      status &&
      String(status).trim().toLowerCase() !== "all"
    ) {
      complaintWhere.status = String(status)
        .trim()
        .toLowerCase();
    }

    // =====================================================
    // COMPLAINT TYPE FILTER
    // =====================================================

    if (
      complaint_type &&
      String(complaint_type)
        .trim()
        .toLowerCase() !== "all"
    ) {
      complaintWhere.complaint_type = String(
        complaint_type
      )
        .trim()
        .toLowerCase();
    }

    // =====================================================
    // DATE FILTER
    // =====================================================

    if (date_from || date_to) {
      complaintWhere.created_at = {};

      if (date_from) {
        const fromDate = new Date(
          `${date_from}T00:00:00.000Z`
        );

        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid date_from. Use YYYY-MM-DD format",
          });
        }

        complaintWhere.created_at[Op.gte] =
          fromDate;
      }

      if (date_to) {
        const toDate = new Date(
          `${date_to}T23:59:59.999Z`
        );

        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid date_to. Use YYYY-MM-DD format",
          });
        }

        complaintWhere.created_at[Op.lte] =
          toDate;
      }
    }

    // =====================================================
    // STORE CODE FILTERS
    //
    // Pehle matching stores ke IDs niklenge.
    // =====================================================

    if (from_store_code) {
      const cleanFromStoreCode = String(
        from_store_code
      )
        .trim()
        .toUpperCase();

      const fromStore = await Store.findOne({
        where: {
          store_code: {
            [Op.iLike]: cleanFromStoreCode,
          },
        },

        attributes: [
          "id",
          "store_code",
          "store_name",
        ],

        raw: true,
      });

      if (!fromStore) {
        return res.status(200).json({
          success: true,
          message:
            "No complaints found for given from_store_code",
          summary: {
            total_complaints: 0,
            open_complaints: 0,
            under_review_complaints: 0,
            resolved_complaints: 0,
            rejected_complaints: 0,
            closed_complaints: 0,
          },
          pagination: {
            page: pageNumber,
            limit: pageLimit,
            total_records: 0,
            total_pages: 0,
            has_next_page: false,
            has_previous_page: false,
          },
          data: [],
        });
      }

      complaintWhere.from_organization_id =
        Number(fromStore.id);
    }

    if (to_store_code) {
      const cleanToStoreCode = String(to_store_code)
        .trim()
        .toUpperCase();

      const toStore = await Store.findOne({
        where: {
          store_code: {
            [Op.iLike]: cleanToStoreCode,
          },
        },

        attributes: [
          "id",
          "store_code",
          "store_name",
        ],

        raw: true,
      });

      if (!toStore) {
        return res.status(200).json({
          success: true,
          message:
            "No complaints found for given to_store_code",
          summary: {
            total_complaints: 0,
            open_complaints: 0,
            under_review_complaints: 0,
            resolved_complaints: 0,
            rejected_complaints: 0,
            closed_complaints: 0,
          },
          pagination: {
            page: pageNumber,
            limit: pageLimit,
            total_records: 0,
            total_pages: 0,
            has_next_page: false,
            has_previous_page: false,
          },
          data: [],
        });
      }

      complaintWhere.to_organization_id =
        Number(toStore.id);
    }

    // =====================================================
    // SEARCH FILTER
    //
    // Search complaint_no, description aur transfer_no.
    // =====================================================

    const cleanSearch = String(search || "").trim();

    if (cleanSearch) {
      const matchingTransfers =
        await StockTransfer.findAll({
          where: {
            transfer_no: {
              [Op.iLike]: `%${cleanSearch}%`,
            },
          },

          attributes: ["id"],

          raw: true,
        });

      const matchingTransferIds =
        matchingTransfers
          .map((transfer) => Number(transfer.id))
          .filter(Boolean);

      const searchConditions = [
        {
          complaint_no: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },
        {
          description: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },
        {
          complaint_type: {
            [Op.iLike]: `%${cleanSearch}%`,
          },
        },
      ];

      if (matchingTransferIds.length > 0) {
        searchConditions.push({
          transfer_id: {
            [Op.in]: matchingTransferIds,
          },
        });
      }

      complaintWhere[Op.or] =
        searchConditions;
    }

    // =====================================================
    // FETCH COMPLAINTS
    // =====================================================

    const {
      count,
      rows: complaintModels,
    } =
      await StockTransferComplaint.findAndCountAll({
        where: complaintWhere,

        order: [
          ["created_at", "DESC"],
          ["id", "DESC"],
        ],

        limit: pageLimit,
        offset,

        distinct: true,
      });

    // =====================================================
    // FETCH RELATED TRANSFERS
    // =====================================================

    const complaints = complaintModels.map(
      (complaint) => complaint.toJSON()
    );

    const transferIds = [
      ...new Set(
        complaints
          .map((complaint) =>
            Number(complaint.transfer_id)
          )
          .filter(Boolean)
      ),
    ];

    const transfers =
      transferIds.length > 0
        ? await StockTransfer.findAll({
            where: {
              id: {
                [Op.in]: transferIds,
              },
            },

            raw: true,
          })
        : [];

    const transferMap = new Map();

    for (const transfer of transfers) {
      transferMap.set(
        Number(transfer.id),
        transfer
      );
    }

    // =====================================================
    // FETCH RELATED STORES
    // =====================================================

    const organizationIds = [
      ...new Set(
        complaints
          .flatMap((complaint) => [
            Number(
              complaint.from_organization_id
            ),
            Number(
              complaint.to_organization_id
            ),
          ])
          .filter(Boolean)
      ),
    ];

    const stores =
      organizationIds.length > 0
        ? await Store.findAll({
            where: {
              id: {
                [Op.in]: organizationIds,
              },
            },

            attributes: [
              "id",
              "store_code",
              "store_name",
              "organization_level",
              "district_id",
              "address",
              "is_active",
            ],

            raw: true,
          })
        : [];

    const storeMap = new Map();

    for (const store of stores) {
      storeMap.set(Number(store.id), store);
    }

    // =====================================================
    // FORMAT COMPLAINT RESPONSE
    // =====================================================

    const formattedComplaints = complaints.map(
      (complaint) => {
        const transfer =
          transferMap.get(
            Number(complaint.transfer_id)
          ) || null;

        const fromStore =
          storeMap.get(
            Number(
              complaint.from_organization_id
            )
          ) || null;

        const toStore =
          storeMap.get(
            Number(
              complaint.to_organization_id
            )
          ) || null;

        const complaintItems =
          Array.isArray(complaint.items)
            ? complaint.items
            : [];

        const totalSentQty =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(item.sent_qty || 0),
            0
          );

        const totalReceivedQty =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(item.received_qty || 0),
            0
          );

        const totalShortageQty =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(item.shortage_qty || 0),
            0
          );

        const totalSentWeight =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(item.sent_weight || 0),
            0
          );

        const totalReceivedWeight =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(
                item.received_weight || 0
              ),
            0
          );

        const totalShortageWeight =
          complaintItems.reduce(
            (total, item) =>
              total +
              Number(
                item.shortage_weight || 0
              ),
            0
          );

        return {
          complaint_id: complaint.id,

          complaint_no:
            complaint.complaint_no,

          complaint_type:
            complaint.complaint_type,

          description:
            complaint.description,

          /*
           * Current complaint status.
           */
          status:
            complaint.status,

          complaint_status:
            complaint.status,

          status_label:
            String(complaint.status || "")
              .replace(/_/g, " ")
              .replace(/\b\w/g, (letter) =>
                letter.toUpperCase()
              ),

          items:
            complaintItems,

          item_summary: {
            total_complaint_items:
              complaintItems.length,

            total_sent_qty: Number(
              totalSentQty.toFixed(3)
            ),

            total_received_qty: Number(
              totalReceivedQty.toFixed(3)
            ),

            total_shortage_qty: Number(
              totalShortageQty.toFixed(3)
            ),

            total_sent_weight: Number(
              totalSentWeight.toFixed(3)
            ),

            total_received_weight: Number(
              totalReceivedWeight.toFixed(3)
            ),

            total_shortage_weight: Number(
              totalShortageWeight.toFixed(3)
            ),
          },

          transfer: transfer
            ? {
                transfer_id:
                  transfer.id,

                transfer_no:
                  transfer.transfer_no,

                request_id:
                  transfer.request_id || null,

                status:
                  transfer.status,

                from_organization_id:
                  transfer.from_organization_id,

                to_organization_id:
                  transfer.to_organization_id,

                remarks:
                  transfer.remarks || null,

                driver_name:
                  transfer.driver_name || null,

                driver_phone:
                  transfer.driver_phone || null,

                vehicle_number:
                  transfer.vehicle_number || null,

                expected_delivery_date:
                  transfer.expected_delivery_date ||
                  null,

                expected_delivery_time:
                  transfer.expected_delivery_time ||
                  null,

                created_at:
                  transfer.created_at ||
                  transfer.createdAt ||
                  null,
              }
            : {
                transfer_id:
                  complaint.transfer_id,

                transfer_no: null,
                status: null,
              },

          /*
           * Complaint kis store ke against raise hui.
           */
          against_store: {
            organization_id:
              complaint.from_organization_id,

            store_code:
              fromStore?.store_code || null,

            store_name:
              fromStore?.store_name || null,

            organization_level:
              fromStore?.organization_level ||
              null,

            district_id:
              fromStore?.district_id || null,

            address:
              fromStore?.address || null,
          },

          /*
           * Complaint kis receiving store ne raise ki.
           */
          raised_by_store: {
            organization_id:
              complaint.to_organization_id,

            store_code:
              toStore?.store_code || null,

            store_name:
              toStore?.store_name || null,

            organization_level:
              toStore?.organization_level ||
              null,

            district_id:
              toStore?.district_id || null,

            address:
              toStore?.address || null,
          },

          evidence: {
            image_1_url:
              complaint.image_1_url || null,

            image_2_url:
              complaint.image_2_url || null,

            video_url:
              complaint.video_url || null,
          },

          raised_by:
            complaint.raised_by || null,

          resolved_by:
            complaint.resolved_by || null,

          resolution_note:
            complaint.resolution_note || null,

          reviewed_by:
            complaint.reviewed_by || null,

          reviewed_at:
            complaint.reviewed_at || null,

          resolved_at:
            complaint.resolved_at || null,

          rejected_at:
            complaint.rejected_at || null,

          closed_at:
            complaint.closed_at || null,

          created_at:
            complaint.created_at ||
            complaint.createdAt ||
            null,

          updated_at:
            complaint.updated_at ||
            complaint.updatedAt ||
            null,
        };
      }
    );

    // =====================================================
    // STATUS-WISE SUMMARY
    //
    // Filters apply hone ke baad matching complaints ka
    // status-wise count return hoga.
    // =====================================================

    const summaryWhere = {
      ...complaintWhere,
    };

    /*
     * Status filter summary par nahi lagayenge,
     * taaki cards me saare status counts dikh sakein.
     */
    delete summaryWhere.status;

    const summaryRows =
      await StockTransferComplaint.findAll({
        where: summaryWhere,

        attributes: ["status"],

        raw: true,
      });

    const summary = {
      total_complaints:
        summaryRows.length,

      open_complaints: 0,

      under_review_complaints: 0,

      resolved_complaints: 0,

      rejected_complaints: 0,

      closed_complaints: 0,

      other_complaints: 0,
    };

    for (const row of summaryRows) {
      const currentStatus = String(
        row.status || ""
      )
        .trim()
        .toLowerCase();

      if (currentStatus === "open") {
        summary.open_complaints += 1;
      } else if (
        currentStatus === "under_review"
      ) {
        summary.under_review_complaints += 1;
      } else if (
        currentStatus === "resolved"
      ) {
        summary.resolved_complaints += 1;
      } else if (
        currentStatus === "rejected"
      ) {
        summary.rejected_complaints += 1;
      } else if (
        currentStatus === "closed"
      ) {
        summary.closed_complaints += 1;
      } else {
        summary.other_complaints += 1;
      }
    }

    const totalPages =
      count > 0
        ? Math.ceil(count / pageLimit)
        : 0;

    // =====================================================
    // FINAL RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      message:
        "All transfer complaints fetched successfully",

      summary,

      applied_filters: {
        status:
          status || "all",

        complaint_type:
          complaint_type || "all",

        search:
          search || null,

        from_store_code:
          from_store_code || null,

        to_store_code:
          to_store_code || null,

        date_from:
          date_from || null,

        date_to:
          date_to || null,
      },

      pagination: {
        page: pageNumber,
        limit: pageLimit,

        total_records:
          count,

        total_pages:
          totalPages,

        has_next_page:
          pageNumber < totalPages,

        has_previous_page:
          pageNumber > 1,
      },

      count:
        formattedComplaints.length,

      data:
        formattedComplaints,
    });
  } catch (error) {
    console.error(
      "getHeadAllTransferComplaints error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to fetch all transfer complaints",

      error:
        error.message,
    });
  }
};


/**
 * Safely converts any value into number.
 */
const toComplaintNumber = (value) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

/**
 * Converts Sequelize model into normal object.
 */
const toPlainObject = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value.toJSON === "function") {
    return value.toJSON();
  }

  return value;
};

/**
 * Normalizes item resolution status.
 */
const normalizeResolutionStatus = (status) => {
  return String(status || "")
    .trim()
    .toLowerCase();
};

/**
 * Overall complaint status is calculated from
 * all complaint-item statuses.
 */
const calculateOverallComplaintStatus = (
  complaintItems
) => {
  const statuses = complaintItems.map((item) =>
    normalizeResolutionStatus(
      item.resolution_status || "open"
    )
  );

  if (
    statuses.length > 0 &&
    statuses.every(
      (status) => status === "closed"
    )
  ) {
    return "closed";
  }

  if (
    statuses.length > 0 &&
    statuses.every((status) =>
      ["resolved", "closed"].includes(status)
    )
  ) {
    return "resolved";
  }

  if (
    statuses.some(
      (status) =>
        status === "replacement_dispatched"
    )
  ) {
    return "replacement_dispatched";
  }

  if (
    statuses.some(
      (status) => status === "under_review"
    )
  ) {
    return "under_review";
  }

  return "open";
};

/**
 * =========================================================
 * UPDATE COMPLAINT STATUS PER ITEM
 * =========================================================
 *
 * Route:
 *
 * PATCH
 * /api/stock-transfer-complaints/:complaintId/items/:transferItemId/status
 *
 * Stages:
 *
 * open
 * -> under_review
 * -> replacement_dispatched
 * -> resolved
 * -> closed
 *
 * Important:
 *
 * 1. Source store:
 *    open -> under_review
 *    under_review -> replacement_dispatched
 *
 * 2. Receiver store:
 *    replacement_dispatched -> resolved
 *    resolved -> closed
 *
 * 3. Head Office:
 *    Can perform any valid transition.
 *
 * 4. Replacement stock quantity is not directly added here.
 *    Normal transfer receiving API will handle stock.
 *
 * 5. resolved will be allowed only when linked replacement
 *    transfer has been received.
 */
/* =====================================================
   STOCK TRANSFER COMPLAINT HELPERS
===================================================== */

/**
 * Null, undefined aur extra spaces ko handle karta hai.
 */
const normalizeText = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

/**
 * Status ko consistent snake_case format me convert karta hai.
 *
 * Example:
 * "Under Review" -> "under_review"
 * "REPLACEMENT-DISPATCHED" -> "replacement_dispatched"
 */
const normalizeStatus = (value) => {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
};

/**
 * Value ko safe number me convert karta hai.
 */
// const toNumber = (value, fallback = 0) => {
//   const parsedValue = Number(value);

//   return Number.isFinite(parsedValue)
//     ? parsedValue
//     : fallback;
// };

/**
 * Decimal value ko fixed precision tak round karta hai.
 */
const roundNumber = (value, precision = 3) => {
  const numericValue = toNumber(value, 0);
  const multiplier = 10 ** precision;

  return Math.round(
    (numericValue + Number.EPSILON) * multiplier
  ) / multiplier;
};

/**
 * Sequelize transaction ko safely rollback karta hai.
 */
const safeRollback = async (transaction) => {
  try {
    if (
      transaction &&
      !transaction.finished
    ) {
      await transaction.rollback();
    }
  } catch (rollbackError) {
    console.error(
      "Transaction rollback error:",
      rollbackError
    );
  }
};

/**
 * Sequelize model me attribute available hai ya nahi check karta hai.
 */
const modelHasAttribute = (
  model,
  attributeName
) => {
  if (!model || !attributeName) {
    return false;
  }

  const attributes =
    model.rawAttributes ||
    model.getAttributes?.() ||
    {};

  return Boolean(attributes[attributeName]);
};

/**
 * Sirf tab object me value set karta hai jab Sequelize model
 * me woh column/attribute exist karta ho.
 */
const setIfModelHasAttribute = (
  targetObject,
  model,
  attributeName,
  value
) => {
  if (
    modelHasAttribute(model, attributeName)
  ) {
    targetObject[attributeName] = value;
  }

  return targetObject;
};

/**
 * JSON string ya array se complaint items safely return karta hai.
 */
const parseComplaintStoredItems = (
  storedItems
) => {
  if (Array.isArray(storedItems)) {
    return storedItems;
  }

  if (
    storedItems === null ||
    storedItems === undefined ||
    storedItems === ""
  ) {
    return [];
  }

  if (typeof storedItems === "object") {
    if (Array.isArray(storedItems.items)) {
      return storedItems.items;
    }

    return [];
  }

  if (typeof storedItems === "string") {
    try {
      const parsedValue =
        JSON.parse(storedItems);

      if (Array.isArray(parsedValue)) {
        return parsedValue;
      }

      if (
        parsedValue &&
        Array.isArray(parsedValue.items)
      ) {
        return parsedValue.items;
      }

      return [];
    } catch (parseError) {
      console.error(
        "Complaint items JSON parse error:",
        parseError
      );

      return [];
    }
  }

  return [];
};

/**
 * Complaint item ko transfer_item_id se find karta hai.
 */
const findComplaintItem = (
  complaintItems,
  transferItemId
) => {
  const normalizedTransferItemId =
    toNumber(transferItemId);

  return complaintItems.find((item) => {
    const itemTransferId = toNumber(
      item?.transfer_item_id ??
      item?.transferItemId ??
      item?.stock_transfer_item_id ??
      item?.id
    );

    return (
      itemTransferId ===
      normalizedTransferItemId
    );
  });
};

/**
 * Complaint item ka status nikalta hai.
 */
const getComplaintItemStatus = (item) => {
  if (
    !item ||
    typeof item !== "object"
  ) {
    return "open";
  }

  const status =
    item.resolution_status ??
    item.resolutionStatus ??
    item.status ??
    item.complaint_status ??
    item.complaintStatus ??
    "open";

  return normalizeStatus(status);
};
/**
 * Sabhi complaint items ko dekhkar parent complaint status decide karta hai.
 */
const getComplaintOverallStatus = (
  complaintItems
) => {
  if (
    !Array.isArray(complaintItems) ||
    complaintItems.length === 0
  ) {
    return "open";
  }

  const statuses = complaintItems.map(
    getComplaintItemStatus
  );

  const allClosed = statuses.every(
    (status) => status === "closed"
  );

  if (allClosed) {
    return "closed";
  }

  const allResolvedOrClosed =
    statuses.every((status) =>
      ["resolved", "closed"].includes(status)
    );

  if (allResolvedOrClosed) {
    return "resolved";
  }

  const hasReplacementDispatched =
    statuses.some(
      (status) =>
        status ===
        "replacement_dispatched"
    );

  if (hasReplacementDispatched) {
    return "replacement_dispatched";
  }

  const hasUnderReview = statuses.some(
    (status) => status === "under_review"
  );

  if (hasUnderReview) {
    return "under_review";
  }

  const hasRejected = statuses.some(
    (status) => status === "rejected"
  );

  if (hasRejected) {
    return "rejected";
  }

  return "open";
};

/**
 * Complaint status transition allowed hai ya nahi check karta hai.
 */
const isValidComplaintStatusTransition = (
  currentStatus,
  nextStatus
) => {
  const current =
    normalizeStatus(currentStatus);

  const next = normalizeStatus(nextStatus);

  const allowedTransitions = {
    open: [
      "under_review",
      "rejected",
    ],

    under_review: [
      "replacement_dispatched",
      "resolved",
      "rejected",
    ],

    replacement_dispatched: [
      "resolved",
      "closed",
    ],

    resolved: [
      "closed",
    ],

    rejected: [],

    closed: [],
  };

  if (current === next) {
    return true;
  }

  return (
    allowedTransitions[current]?.includes(
      next
    ) || false
  );
};

/**
 * Complaint item me supported keys ko preserve karke status update karta hai.
 */
const updateStoredComplaintItem = (
  complaintItem,
  updates = {}
) => {
  return {
    ...complaintItem,
    ...updates,
    updated_at: new Date().toISOString(),
  };
};

/**
 * Date value ko safe ISO date me convert karta hai.
 */
const normalizeDateValue = (value) => {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);

  if (
    Number.isNaN(parsedDate.getTime())
  ) {
    return null;
  }

  return parsedDate;
};

/**
 * Quantity aur weight ko negative hone se rokta hai.
 */
const subtractSafely = (
  currentValue,
  subtractValue,
  precision = 3
) => {
  const result =
    toNumber(currentValue) -
    toNumber(subtractValue);

  return roundNumber(
    Math.max(0, result),
    precision
  );
};

/**
 * Quantity aur weight ko safely add karta hai.
 */
const addSafely = (
  currentValue,
  addedValue,
  precision = 3
) => {
  return roundNumber(
    toNumber(currentValue) +
    toNumber(addedValue),
    precision
  );
};

/**
 * Complaint replacement transfer number generate karta hai.
 */
const generateComplaintReplacementTransferNo = (
  complaintId
) => {
  return `TRF-REPL-CMP-${complaintId}-${Date.now()}`;
};

/**
 * Sequelize instance ya plain object ko plain JSON me convert karta hai.
 */
// const toPlainObject = (value) => {
//   if (!value) {
//     return null;
//   }

//   if (
//     typeof value.get === "function"
//   ) {
//     return value.get({
//       plain: true,
//     });
//   }

//   if (
//     typeof value.toJSON === "function"
//   ) {
//     return value.toJSON();
//   }

//   return {
//     ...value,
//   };
// };
const isHeadOfficeUser = (user) => {
  if (!user) {
    return false;
  }

  const role = normalizeText(user.role).toLowerCase();
  const level = normalizeText(
    user.organization_level ||
    user.organizationType ||
    user.organization_type
  ).toLowerCase();

  return (
    level === "head_office" ||
    role === "super_admin" ||
    role === "head_admin" ||
    role === "head_manager"
  );
};
const isDistrictUser = (user) => {
  if (!user) {
    return false;
  }

  const level = normalizeText(
    user.organization_level
  ).toLowerCase();

  return level === "district";
};

const isRetailUser = (user) => {
  if (!user) {
    return false;
  }

  const level = normalizeText(
    user.organization_level
  ).toLowerCase();

  return level === "retail";
};
const createComplaintActivity = async ({
  transaction = null,
  user = null,
  complaint = null,
  complaintItem = null,
  action = "complaint_updated",
  title = "Complaint Updated",
  description = "",
  meta = {},
}) => {
  try {
    if (!ActivityLog) {
      console.warn(
        "ActivityLog model is not available. Complaint activity skipped."
      );
      return null;
    }

    const complaintId =
      complaint?.id ||
      complaint?.complaint_id ||
      null;

    const complaintNo =
      complaint?.complaint_no ||
      complaint?.complaint_number ||
      `CMP-${complaintId || Date.now()}`;

    const transferItemId =
      complaintItem?.transfer_item_id ||
      complaintItem?.transferItemId ||
      complaintItem?.stock_transfer_item_id ||
      complaintItem?.id ||
      null;

    const organizationId =
      user?.organization_id ||
      complaint?.from_organization_id ||
      complaint?.to_organization_id ||
      null;

    const userId =
      user?.id ||
      user?.user_id ||
      null;

    const activityPayload = {
      organization_id: organizationId,
      user_id: userId,
      action,
      module_name: "stock_transfer_complaint",
      reference_id: complaintId,
      reference_no: complaintNo,
      title,
      description:
        description ||
        `Complaint ${complaintNo} updated successfully.`,
      meta: {
        complaint_id: complaintId,
        complaint_no: complaintNo,
        transfer_id:
          complaint?.transfer_id ||
          null,
        transfer_item_id: transferItemId,
        complaint_item_status:
          complaintItem?.status ||
          complaintItem?.complaint_status ||
          null,
        performed_by: userId,
        performed_by_role:
          user?.role ||
          null,
        ...meta,
      },
      icon: "complaint",
    };

    const finalPayload = {};

    const activityAttributes =
      ActivityLog.rawAttributes ||
      ActivityLog.getAttributes?.() ||
      {};

    Object.entries(activityPayload).forEach(
      ([key, value]) => {
        if (
          Object.prototype.hasOwnProperty.call(
            activityAttributes,
            key
          )
        ) {
          finalPayload[key] = value;
        }
      }
    );

    return await ActivityLog.create(
      finalPayload,
      transaction
        ? { transaction }
        : {}
    );
  } catch (activityError) {
    console.error(
      "createComplaintActivity error:",
      activityError
    );

    // Activity log fail hone par main complaint API fail nahi hogi.
    return null;
  }
};
/**
 * Error response ko consistent banata hai.
 */
const getErrorDetails = (error) => {
  return {
    message:
      error?.message ||
      "Something went wrong",

    name:
      error?.name ||
      "Error",

    validation_errors:
      error?.errors?.map((item) => ({
        field:
          item?.path ||
          item?.field ||
          null,

        message:
          item?.message ||
          "Validation error",

        value:
          item?.value ??
          null,
      })) || [],
  };
};
export const updateComplaintItemStatus = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { complaintId, transferItemId } = req.params;

    const {
      status,
      resolution_note,
      replacement_transfer_id,
    } = req.body;

    const user = req.user;

    if (!user?.id || !user?.organization_id) {
      await safeRollback(transaction);

      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const parsedComplaintId = Number(complaintId);
    const parsedTransferItemId = Number(transferItemId);

    if (
      !parsedComplaintId ||
      !Number.isInteger(parsedComplaintId) ||
      parsedComplaintId <= 0
    ) {
      await safeRollback(transaction);

      return res.status(400).json({
        success: false,
        message: "Valid complaintId is required",
      });
    }

    if (
      !parsedTransferItemId ||
      !Number.isInteger(parsedTransferItemId) ||
      parsedTransferItemId <= 0
    ) {
      await safeRollback(transaction);

      return res.status(400).json({
        success: false,
        message: "Valid transferItemId is required",
      });
    }

    const requestedStatus = normalizeStatus(status);

    const allowedStatuses = [
      "under_review",
      "replacement_dispatched",
      "resolved",
    ];

    if (!allowedStatuses.includes(requestedStatus)) {
      await safeRollback(transaction);

      return res.status(400).json({
        success: false,
        message: "Invalid complaint item status",
        allowed_statuses: allowedStatuses,
        note:
          "resolved status replacement receive hone ke baad item ko automatically closed karega",
      });
    }

    const normalizedResolutionNote =
      normalizeText(resolution_note);

    if (
      ["replacement_dispatched", "resolved"].includes(
        requestedStatus
      ) &&
      !normalizedResolutionNote
    ) {
      await safeRollback(transaction);

      return res.status(400).json({
        success: false,
        message: `resolution_note is required when status is ${requestedStatus}`,
      });
    }

    const complaint =
      await StockTransferComplaint.findByPk(
        parsedComplaintId,
        {
          transaction,
          lock: transaction.LOCK.UPDATE,
        }
      );

    if (!complaint) {
      await safeRollback(transaction);

      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    const originalTransfer =
      await StockTransfer.findByPk(
        complaint.transfer_id,
        {
          transaction,
          lock: transaction.LOCK.UPDATE,
        }
      );

    if (!originalTransfer) {
      await safeRollback(transaction);

      return res.status(404).json({
        success: false,
        message: "Original transfer not found",
      });
    }

    const complaintItems =
      parseComplaintStoredItems(complaint.items);

    const complaintItemIndex =
      complaintItems.findIndex(
        (item) =>
          Number(item.transfer_item_id) ===
          parsedTransferItemId
      );

    if (complaintItemIndex === -1) {
      await safeRollback(transaction);

      return res.status(404).json({
        success: false,
        message: "Complaint item not found",
      });
    }

    const complaintItem = {
      ...complaintItems[complaintItemIndex],
    };

    const currentItemStatus =
      getComplaintItemStatus(complaintItem);

    const loggedInOrganizationId = Number(
      user.organization_id
    );

    const sourceOrganizationId = Number(
      complaint.from_organization_id
    );

    const receiverOrganizationId = Number(
      complaint.to_organization_id
    );

    const headOfficeUser = isHeadOfficeUser(user);

    const isSourceStore =
      loggedInOrganizationId === sourceOrganizationId;

    const isReceiverStore =
      loggedInOrganizationId === receiverOrganizationId;

    let responseMessage =
      "Complaint item status updated successfully";

    let linkedReplacementTransfer = null;

    /*
     * =====================================================
     * OPEN -> UNDER REVIEW
     * =====================================================
     */

    if (requestedStatus === "under_review") {
      if (!isSourceStore && !headOfficeUser) {
        await safeRollback(transaction);

        return res.status(403).json({
          success: false,
          message:
            "Only source store or Head Office can mark complaint under review",
        });
      }

      if (currentItemStatus !== "open") {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message: `Complaint item cannot move from ${currentItemStatus} to under_review`,
          required_current_status: "open",
        });
      }

      complaintItem.resolution_status =
        "under_review";

      complaintItem.reviewed_by = user.id;

      complaintItem.reviewed_at = new Date();

      complaintItem.resolution_note =
        normalizedResolutionNote ||
        "Complaint verification started";

      responseMessage =
        "Complaint item marked under review successfully";
    }

    /*
     * =====================================================
     * UNDER REVIEW -> REPLACEMENT DISPATCHED
     * =====================================================
     *
     * Is flow me pehle se created replacement transfer ko
     * complaint item ke saath link kiya jayega.
     */

    if (
      requestedStatus === "replacement_dispatched"
    ) {
      if (!isSourceStore && !headOfficeUser) {
        await safeRollback(transaction);

        return res.status(403).json({
          success: false,
          message:
            "Only source store or Head Office can link replacement transfer",
        });
      }

      if (currentItemStatus !== "under_review") {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message: `Complaint item cannot move from ${currentItemStatus} to replacement_dispatched`,
          required_current_status: "under_review",
        });
      }

      const parsedReplacementTransferId = Number(
        replacement_transfer_id
      );

      if (
        !parsedReplacementTransferId ||
        !Number.isInteger(
          parsedReplacementTransferId
        ) ||
        parsedReplacementTransferId <= 0
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Valid replacement_transfer_id is required",
        });
      }

      linkedReplacementTransfer =
        await StockTransfer.findByPk(
          parsedReplacementTransferId,
          {
            transaction,
            lock: transaction.LOCK.UPDATE,
          }
        );

      if (!linkedReplacementTransfer) {
        await safeRollback(transaction);

        return res.status(404).json({
          success: false,
          message: "Replacement transfer not found",
        });
      }

      if (
        Number(linkedReplacementTransfer.id) ===
        Number(originalTransfer.id)
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Original transfer cannot be used as replacement transfer",
        });
      }

      if (
        Number(
          linkedReplacementTransfer.from_organization_id
        ) !== sourceOrganizationId
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer source organization does not match complaint source organization",
        });
      }

      if (
        Number(
          linkedReplacementTransfer.to_organization_id
        ) !== receiverOrganizationId
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer destination organization does not match complaint receiver organization",
        });
      }

      const replacementTransferStatus =
        normalizeStatus(
          linkedReplacementTransfer.status
        );

      const validReplacementTransferStatuses = [
        "approved",
        "dispatched",
        "in_transit",
      ];

      if (
        !validReplacementTransferStatuses.includes(
          replacementTransferStatus
        )
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer must be approved, dispatched or in_transit before linking",
          current_transfer_status:
            linkedReplacementTransfer.status,
          allowed_transfer_statuses:
            validReplacementTransferStatuses,
        });
      }

      const replacementTransferItems =
        await StockTransferItem.findAll({
          where: {
            transfer_id:
              linkedReplacementTransfer.id,

            item_id:
              complaintItem.item_id,
          },

          transaction,
          lock: transaction.LOCK.UPDATE,
        });

      if (!replacementTransferItems.length) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer does not contain the complaint item",
          item_id: complaintItem.item_id,
        });
      }

      const totalReplacementQty =
        roundNumber(
          replacementTransferItems.reduce(
            (total, item) =>
              total + toNumber(item.qty),
            0
          )
        );

      const totalReplacementWeight =
        roundNumber(
          replacementTransferItems.reduce(
            (total, item) =>
              total + toNumber(item.weight),
            0
          )
        );

      const shortageQty = roundNumber(
        complaintItem.shortage_qty
      );

      const shortageWeight = roundNumber(
        complaintItem.shortage_weight
      );

      if (totalReplacementQty < shortageQty) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer quantity is less than complaint shortage quantity",
          shortage_qty: shortageQty,
          replacement_qty: totalReplacementQty,
        });
      }

      if (
        shortageWeight > 0 &&
        totalReplacementWeight < shortageWeight
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer weight is less than complaint shortage weight",
          shortage_weight: shortageWeight,
          replacement_weight:
            totalReplacementWeight,
        });
      }

      complaintItem.resolution_status =
        "replacement_dispatched";

      complaintItem.replacement_transfer_id =
        linkedReplacementTransfer.id;

      complaintItem.replacement_transfer_no =
        linkedReplacementTransfer.transfer_no;

      complaintItem.replacement_transfer_item_id =
        replacementTransferItems.length === 1
          ? replacementTransferItems[0].id
          : null;

      complaintItem.replacement_qty =
        totalReplacementQty;

      complaintItem.replacement_weight =
        totalReplacementWeight;

      complaintItem.replacement_dispatched_by =
        user.id;

      complaintItem.replacement_dispatched_at =
        linkedReplacementTransfer.dispatch_date ||
        linkedReplacementTransfer.transfer_date ||
        new Date();

      complaintItem.resolution_note =
        normalizedResolutionNote;

      responseMessage =
        "Replacement transfer linked and complaint item marked replacement dispatched";
    }

    /*
     * =====================================================
     * REPLACEMENT DISPATCHED -> SOLVED + CLOSED
     * =====================================================
     *
     * Replacement transfer receive hone ke baad:
     *
     * 1. Replacement transfer status received verify hoga.
     * 2. Complaint item solved hoga.
     * 3. Complaint item automatically closed hoga.
     * 4. Agar saare complaint items closed hain to complaint
     *    ka overall status bhi closed ho jayega.
     */

    if (requestedStatus === "resolved") {
      if (!isReceiverStore && !headOfficeUser) {
        await safeRollback(transaction);

        return res.status(403).json({
          success: false,
          message:
            "Only receiver store or Head Office can solve complaint after replacement is received",
        });
      }

      if (
        currentItemStatus !==
        "replacement_dispatched"
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message: `Complaint item cannot move from ${currentItemStatus} to resolved`,
          required_current_status:
            "replacement_dispatched",
        });
      }

      const linkedReplacementTransferId = Number(
        complaintItem.replacement_transfer_id
      );

      if (!linkedReplacementTransferId) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer is not linked with this complaint item",
        });
      }

      linkedReplacementTransfer =
        await StockTransfer.findByPk(
          linkedReplacementTransferId,
          {
            transaction,
            lock: transaction.LOCK.UPDATE,
          }
        );

      if (!linkedReplacementTransfer) {
        await safeRollback(transaction);

        return res.status(404).json({
          success: false,
          message: "Replacement transfer not found",
        });
      }

      if (
        normalizeStatus(
          linkedReplacementTransfer.status
        ) !== "received"
      ) {
        await safeRollback(transaction);

        return res.status(400).json({
          success: false,
          message:
            "Replacement transfer must be received before complaint can be solved",

          replacement_transfer: {
            id: linkedReplacementTransfer.id,

            transfer_no:
              linkedReplacementTransfer.transfer_no,

            current_status:
              linkedReplacementTransfer.status,

            required_status: "received",
          },
        });
      }

      const solvedAt = new Date();

      /*
       * Pehle resolved information save hogi.
       */

      complaintItem.resolved_by = user.id;

      complaintItem.resolved_at = solvedAt;

      /*
       * Latest change:
       * Resolved ke baad alag close API call ki zarurat nahi.
       * Complaint item automatically closed ho jayega.
       */

      complaintItem.closed_by = user.id;

      complaintItem.closed_at = solvedAt;

      complaintItem.resolution_status = "closed";

      complaintItem.replacement_received = true;

      complaintItem.replacement_received_at =
        linkedReplacementTransfer.received_at ||
        linkedReplacementTransfer.receive_date ||
        solvedAt;

      complaintItem.resolution_note =
        normalizedResolutionNote;

      responseMessage =
        "Replacement transfer received. Complaint item solved and closed automatically.";
    }

    /*
     * Updated item ko complaint items JSON me replace karna.
     */

    complaintItems[complaintItemIndex] =
      complaintItem;

    /*
     * Saare complaint items ke status ke hisaab se
     * overall complaint status calculate hoga.
     */

    const overallComplaintStatus =
      getComplaintOverallStatus(complaintItems);

    const complaintUpdatePayload = {
      items: complaintItems,
      status: overallComplaintStatus,
    };

    /*
     * Optional model columns exist karte hain tabhi set honge.
     */

    setIfModelHasAttribute(
      StockTransferComplaint,
      complaintUpdatePayload,
      "updated_by",
      user.id
    );

    setIfModelHasAttribute(
      StockTransferComplaint,
      complaintUpdatePayload,
      "resolution_note",
      normalizedResolutionNote ||
        complaint.resolution_note ||
        null
    );

    if (requestedStatus === "under_review") {
      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "reviewed_by",
        user.id
      );

      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "reviewed_at",
        new Date()
      );
    }

    if (overallComplaintStatus === "resolved") {
      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "resolved_by",
        user.id
      );

      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "resolved_at",
        new Date()
      );
    }

    if (overallComplaintStatus === "closed") {
      const closedAt = new Date();

      /*
       * Overall complaint closed hone par resolved aur closed
       * dono details maintain ki ja rahi hain.
       */

      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "resolved_by",
        user.id
      );

      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "resolved_at",
        closedAt
      );

      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "closed_by",
        user.id
      );

      setIfModelHasAttribute(
        StockTransferComplaint,
        complaintUpdatePayload,
        "closed_at",
        closedAt
      );
    }

    await complaint.update(
      complaintUpdatePayload,
      {
        transaction,
      }
    );

    await createComplaintActivity({
      transaction,
      user,
      complaint,
      transfer: originalTransfer,

      action:
        "stock_transfer_complaint_item_status_updated",

      title:
        "Complaint item status updated",

      description:
        requestedStatus === "resolved"
          ? `Complaint ${complaint.complaint_no} item ${parsedTransferItemId} solved and closed after replacement transfer receive`
          : `Complaint ${complaint.complaint_no} item ${parsedTransferItemId} changed from ${currentItemStatus} to ${complaintItem.resolution_status}`,

      meta: {
        transfer_item_id:
          parsedTransferItemId,

        item_id:
          complaintItem.item_id,

        requested_status:
          requestedStatus,

        old_item_status:
          currentItemStatus,

        new_item_status:
          complaintItem.resolution_status,

        overall_complaint_status:
          overallComplaintStatus,

        resolution_note:
          normalizedResolutionNote || null,

        replacement_transfer_id:
          complaintItem.replacement_transfer_id ||
          null,

        replacement_transfer_no:
          complaintItem.replacement_transfer_no ||
          null,

        replacement_received:
          complaintItem.replacement_received ||
          false,

        auto_resolved:
          requestedStatus === "resolved",

        auto_closed:
          requestedStatus === "resolved",
      },

      icon:
        requestedStatus === "resolved"
          ? "check-circle"
          : requestedStatus ===
              "replacement_dispatched"
            ? "truck"
            : "complaint",

      color:
        requestedStatus === "resolved"
          ? "green"
          : requestedStatus ===
              "replacement_dispatched"
            ? "blue"
            : "orange",
    });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: responseMessage,

      data: {
        complaint_id:
          complaint.id,

        complaint_no:
          complaint.complaint_no,

        transfer_id:
          complaint.transfer_id,

        transfer_no:
          originalTransfer.transfer_no,

        complaint_status:
          overallComplaintStatus,

        overall_complaint_status:
          overallComplaintStatus,

        updated_item: {
          ...complaintItem,

          requested_status:
            requestedStatus,

          status:
            complaintItem.resolution_status,

          auto_resolved:
            requestedStatus === "resolved",

          auto_closed:
            requestedStatus === "resolved",

          replacement_received:
            complaintItem.replacement_received ||
            false,
        },

        replacement_transfer:
          linkedReplacementTransfer
            ? {
                transfer_id:
                  linkedReplacementTransfer.id,

                transfer_no:
                  linkedReplacementTransfer.transfer_no,

                status:
                  linkedReplacementTransfer.status,
              }
            : null,

        flow: {
          previous_status:
            currentItemStatus,

          requested_status:
            requestedStatus,

          final_item_status:
            complaintItem.resolution_status,

          final_complaint_status:
            overallComplaintStatus,
        },
      },
    });
  } catch (error) {
    await safeRollback(transaction);

    console.error(
      "updateComplaintItemStatus error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update complaint item status",
      error: error.message,
    });
  }
};
/**
 * =========================================================
 * SEND DIRECT REPLACEMENT AGAINST COMPLAINT
 * =========================================================
 *
 * Flow:
 *
 * open
 *   ↓
 * under_review
 *   ↓
 * Direct replacement transfer create
 *   ↓
 * replacement_dispatched
 *
 * Route:
 * POST /api/stock-transfer-complaints/:complaintId/items/:transferItemId/send-replacement
 */
export const sendReplacementAgainstComplaint = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    // =====================================================
    // REQUEST DATA
    // =====================================================

    const complaintId = Number(req.params.complaintId);
    const transferItemId = Number(req.params.transferItemId);

    const {
      replacement_item_id,
      dispatch_qty,
      dispatch_weight,

      remarks,
      driver_name,
      driver_phone,
      vehicle_number,

      pickup_address,
      delivery_address,

      expected_delivery_date,
      expected_delivery_time,

      additional_notes,
    } = req.body;

    const user = req.user;

    // =====================================================
    // BASIC VALIDATION
    // =====================================================

    if (!user?.id || !user?.organization_id) {
      await transaction.rollback();

      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    if (!Number.isInteger(complaintId) || complaintId <= 0) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Valid complaintId is required",
      });
    }

    if (!Number.isInteger(transferItemId) || transferItemId <= 0) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Valid transferItemId is required",
      });
    }

    // =====================================================
    // FETCH COMPLAINT
    // =====================================================

    const complaintRows = await sequelize.query(
      `
      SELECT
        id,
        complaint_no,
        transfer_id,
        from_organization_id,
        to_organization_id,
        complaint_type,
        description,
        items,
        status,
        raised_by,
        resolution_note,
        resolved_by,
        resolved_at,
        created_at,
        updated_at
      FROM stock_transfer_complaints
      WHERE id = :complaintId
      FOR UPDATE
      `,
      {
        replacements: {
          complaintId,
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const complaint = complaintRows[0];

    if (!complaint) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    const sourceOrganizationId = Number(
      complaint.from_organization_id
    );

    const destinationOrganizationId = Number(
      complaint.to_organization_id
    );

    const loggedInOrganizationId = Number(
      user.organization_id
    );

    // =====================================================
    // AUTHORIZATION
    // =====================================================

    const normalizedRole = String(user.role || "")
      .trim()
      .toLowerCase()
      .replaceAll("-", "_")
      .replaceAll(" ", "_");

    const allowedHeadOfficeRoles = [
      "super_admin",
      "head_office",
      "head_office_admin",
      "admin",
    ];

    const isHeadOfficeUser =
      allowedHeadOfficeRoles.includes(normalizedRole);

    if (
      loggedInOrganizationId !== sourceOrganizationId &&
      !isHeadOfficeUser
    ) {
      await transaction.rollback();

      return res.status(403).json({
        success: false,
        message:
          "Only source organization or Head Office can send replacement",
        source_organization_id: sourceOrganizationId,
        logged_in_organization_id:
          loggedInOrganizationId,
      });
    }

    // =====================================================
    // COMPLAINT STATUS VALIDATION
    // =====================================================

    const complaintStatus = String(
      complaint.status || ""
    )
      .trim()
      .toLowerCase()
      .replaceAll("-", "_")
      .replaceAll(" ", "_");

    if (complaintStatus !== "under_review") {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Replacement can only be dispatched when complaint is under review",
        current_status: complaintStatus,
        required_status: "under_review",
      });
    }

    // =====================================================
    // PARSE COMPLAINT ITEMS
    // =====================================================

    let complaintItems = [];

    if (Array.isArray(complaint.items)) {
      complaintItems = complaint.items;
    } else if (typeof complaint.items === "string") {
      try {
        const parsedItems = JSON.parse(complaint.items);

        complaintItems = Array.isArray(parsedItems)
          ? parsedItems
          : [];
      } catch {
        complaintItems = [];
      }
    }

    const complaintItemIndex = complaintItems.findIndex(
      (item) =>
        Number(item.transfer_item_id) === transferItemId
    );

    if (complaintItemIndex === -1) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Transfer item not found inside complaint",
        complaint_id: complaintId,
        transfer_item_id: transferItemId,
      });
    }

    const complaintItem = {
      ...complaintItems[complaintItemIndex],
    };

    // =====================================================
    // DUPLICATE REPLACEMENT CHECK
    // =====================================================

    if (
      complaintItem.replacement_transfer_id ||
      complaintItem.replacement_transfer_item_id
    ) {
      await transaction.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Replacement has already been dispatched for this complaint item",
        replacement_transfer_id:
          complaintItem.replacement_transfer_id || null,
        replacement_transfer_no:
          complaintItem.replacement_transfer_no || null,
      });
    }
        // =====================================================
    // FETCH ORIGINAL TRANSFER
    // =====================================================

    const originalTransferRows =
      await sequelize.query(
        `
        SELECT
          id,
          transfer_no,
          request_id,
          from_organization_id,
          to_organization_id,
          transfer_date,
          dispatch_date,
          receive_date,
          status,
          remarks
        FROM stock_transfers
        WHERE id = :transferId
        FOR UPDATE
        `,
        {
          replacements: {
            transferId: Number(
              complaint.transfer_id
            ),
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

    const originalTransfer =
      originalTransferRows[0];

    if (!originalTransfer) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message: "Original stock transfer not found",
      });
    }

    // =====================================================
    // FETCH ORIGINAL TRANSFER ITEM
    // =====================================================

    const originalTransferItemRows =
      await sequelize.query(
        `
        SELECT
          id,
          transfer_id,
          item_id,
          qty,
          weight,
          rate,
          remarks,
          parent_batch_id,
          child_batch_id,
          external_item_data
        FROM stock_transfer_items
        WHERE id = :transferItemId
        FOR UPDATE
        `,
        {
          replacements: {
            transferItemId,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

    const originalTransferItem =
      originalTransferItemRows[0];

    if (!originalTransferItem) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Original transfer item not found",
      });
    }

    if (
      Number(originalTransferItem.transfer_id) !==
      Number(originalTransfer.id)
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Transfer item does not belong to the complaint transfer",
      });
    }

    // =====================================================
    // ORIGINAL & REPLACEMENT ITEM
    // =====================================================

    const originalItemId = Number(
      complaintItem.item_id ||
        originalTransferItem.item_id
    );

    if (
      !Number.isInteger(originalItemId) ||
      originalItemId <= 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Original item ID is missing or invalid",
      });
    }

    const replacementItemId =
      replacement_item_id === undefined ||
      replacement_item_id === null ||
      replacement_item_id === ""
        ? originalItemId
        : Number(replacement_item_id);

    if (
      !Number.isInteger(replacementItemId) ||
      replacementItemId <= 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Valid replacement_item_id is required",
      });
    }

    // =====================================================
    // FETCH REPLACEMENT ITEM
    // =====================================================

    const replacementItemRows =
      await sequelize.query(
        `
        SELECT
          id,
          article_code,
          sku_code,
          item_name,
          metal_type,
          category,
          purity,
          gross_weight,
          net_weight,
          stone_weight,
          stone_amount,
          making_charge,
          purchase_rate,
          sale_rate,
          hsn_code,
          unit,
          current_status,
          organization_id,
          "storeCode",
          "storeName",
          is_active
        FROM items
        WHERE id = :replacementItemId
        `,
        {
          replacements: {
            replacementItemId,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

    const replacementItem =
      replacementItemRows[0];

    if (!replacementItem) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Replacement item not found",
        replacement_item_id:
          replacementItemId,
      });
    }

    if (replacementItem.is_active === false) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Inactive item cannot be sent as replacement",
        replacement_item_id:
          replacementItemId,
      });
    }

    // =====================================================
    // QUANTITY VALIDATION
    // =====================================================

    const shortageQty = Number(
      complaintItem.shortage_qty || 0
    );

    const shortageWeight = Number(
      complaintItem.shortage_weight || 0
    );

    const replacementQty =
      dispatch_qty === undefined ||
      dispatch_qty === null ||
      dispatch_qty === ""
        ? shortageQty
        : Number(dispatch_qty);

    const replacementWeight =
      dispatch_weight === undefined ||
      dispatch_weight === null ||
      dispatch_weight === ""
        ? shortageWeight
        : Number(dispatch_weight);

    if (
      !Number.isFinite(shortageQty) ||
      shortageQty <= 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Complaint does not contain valid shortage quantity",
      });
    }

    if (
      !Number.isFinite(replacementQty) ||
      replacementQty <= 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "dispatch_qty must be greater than zero",
      });
    }

    if (replacementQty > shortageQty) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Replacement quantity cannot exceed shortage quantity",
      });
    }

    if (
      !Number.isFinite(replacementWeight) ||
      replacementWeight < 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "dispatch_weight cannot be negative",
      });
    }

    if (
      shortageWeight > 0 &&
      replacementWeight > shortageWeight
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Replacement weight cannot exceed shortage weight",
      });
    }
        // =====================================================
    // FETCH SOURCE AND DESTINATION STORES
    // Only actual database columns are selected.
    // =====================================================

    const sourceStoreRows = await sequelize.query(
      `
        SELECT
          id,
          store_code,
          store_name,
          organization_level,
          state,
          district,
          district_id,
          address,
          phone_number,
          is_active
        FROM stores
        WHERE id = :sourceOrganizationId
      `,
      {
        replacements: {
          sourceOrganizationId,
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const sourceStore = sourceStoreRows[0];

    if (!sourceStore) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message: "Source organization not found",
        organization_id: sourceOrganizationId,
      });
    }

    if (sourceStore.is_active === false) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Source organization is inactive",
        organization_id: sourceOrganizationId,
      });
    }

    const destinationStoreRows =
      await sequelize.query(
        `
          SELECT
            id,
            store_code,
            store_name,
            organization_level,
            state,
            district,
            district_id,
            address,
            phone_number,
            is_active
          FROM stores
          WHERE id = :destinationOrganizationId
        `,
        {
          replacements: {
            destinationOrganizationId,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

    const destinationStore =
      destinationStoreRows[0];

    if (!destinationStore) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Destination organization not found",
        organization_id:
          destinationOrganizationId,
      });
    }

    if (destinationStore.is_active === false) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Destination organization is inactive",
        organization_id:
          destinationOrganizationId,
      });
    }

    // =====================================================
    // FETCH AND LOCK SOURCE STOCK
    //
    // Ek single stock row ke andar required quantity aur
    // required weight dono available hone chahiye.
    // =====================================================

    const sourceStockRows = await sequelize.query(
      `
        SELECT
          id,
          item_id,
          organization_id,
          organization_type,
          store_code,
          batch_id,
          COALESCE(available_qty, 0) AS available_qty,
          COALESCE(available_weight, 0) AS available_weight,
          COALESCE(reserved_qty, 0) AS reserved_qty,
          COALESCE(reserved_weight, 0) AS reserved_weight,
          COALESCE(transit_qty, 0) AS transit_qty,
          COALESCE(transit_weight, 0) AS transit_weight,
          COALESCE(damaged_qty, 0) AS damaged_qty,
          COALESCE(damaged_weight, 0) AS damaged_weight,
          COALESCE(dead_qty, 0) AS dead_qty,
          COALESCE(dead_weight, 0) AS dead_weight
        FROM stocks
        WHERE organization_id = :sourceOrganizationId
          AND item_id = :replacementItemId
          AND COALESCE(available_qty, 0) >= :replacementQty
          AND (
            :replacementWeight = 0
            OR COALESCE(available_weight, 0) >= :replacementWeight
          )
        ORDER BY
          CASE
            WHEN batch_id IS NOT NULL THEN 0
            ELSE 1
          END,
          id ASC
        LIMIT 1
        FOR UPDATE
      `,
      {
        replacements: {
          sourceOrganizationId,
          replacementItemId,
          replacementQty,
          replacementWeight,
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const sourceStock = sourceStockRows[0];

    // =====================================================
    // STOCK NOT FOUND / INSUFFICIENT STOCK
    // =====================================================

    if (!sourceStock) {
      const stockSummaryRows = await sequelize.query(
        `
          SELECT
            COUNT(*)::integer AS stock_row_count,

            COALESCE(
              SUM(COALESCE(available_qty, 0)),
              0
            ) AS total_available_qty,

            COALESCE(
              SUM(COALESCE(available_weight, 0)),
              0
            ) AS total_available_weight

          FROM stocks

          WHERE organization_id = :sourceOrganizationId
            AND item_id = :replacementItemId
        `,
        {
          replacements: {
            sourceOrganizationId,
            replacementItemId,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      const stockSummary = stockSummaryRows[0];

      await transaction.rollback();

      return res.status(400).json({
        success: false,

        message:
          Number(
            stockSummary?.stock_row_count || 0
          ) === 0
            ? "Source stock record not found for replacement item"
            : "Insufficient source stock for replacement",

        original_item_id: originalItemId,

        replacement_item_id:
          replacementItemId,

        source_organization_id:
          sourceOrganizationId,

        source_store_code:
          sourceStore.store_code,

        required_qty:
          replacementQty,

        required_weight:
          replacementWeight,

        total_available_qty: Number(
          stockSummary?.total_available_qty || 0
        ),

        total_available_weight: Number(
          stockSummary?.total_available_weight || 0
        ),
      });
    }

    // =====================================================
    // OPENING STOCK VALUES
    // =====================================================

    const openingAvailableQty = Number(
      sourceStock.available_qty || 0
    );

    const openingAvailableWeight = Number(
      sourceStock.available_weight || 0
    );

    const openingReservedQty = Number(
      sourceStock.reserved_qty || 0
    );

    const openingReservedWeight = Number(
      sourceStock.reserved_weight || 0
    );

    const openingTransitQty = Number(
      sourceStock.transit_qty || 0
    );

    const openingTransitWeight = Number(
      sourceStock.transit_weight || 0
    );

    const openingDamagedQty = Number(
      sourceStock.damaged_qty || 0
    );

    const openingDamagedWeight = Number(
      sourceStock.damaged_weight || 0
    );

    // =====================================================
    // CLOSING STOCK VALUES
    //
    // Replacement dispatch hone par:
    // available stock kam hoga
    // transit stock badhega
    // =====================================================

    const closingAvailableQty =
      openingAvailableQty - replacementQty;

    const closingAvailableWeight =
      openingAvailableWeight - replacementWeight;

    const closingReservedQty =
      openingReservedQty;

    const closingReservedWeight =
      openingReservedWeight;

    const closingTransitQty =
      openingTransitQty + replacementQty;

    const closingTransitWeight =
      openingTransitWeight + replacementWeight;

    const closingDamagedQty =
      openingDamagedQty;

    const closingDamagedWeight =
      openingDamagedWeight;

    // =====================================================
    // FINAL NEGATIVE STOCK VALIDATION
    // =====================================================

    if (
      closingAvailableQty < 0 ||
      closingAvailableWeight < 0
    ) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Source stock became negative during replacement validation",

        available_qty:
          openingAvailableQty,

        available_weight:
          openingAvailableWeight,

        requested_qty:
          replacementQty,

        requested_weight:
          replacementWeight,
      });
    }
        // =====================================================
    // GENERATE REPLACEMENT TRANSFER NUMBER
    // =====================================================

    const replacementTransferNo =
      `RPL-${complaintId}-${Date.now()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

    const transferRemarks =
      String(remarks || "").trim() ||
      `Replacement dispatched against complaint ${complaint.complaint_no}`;

    // =====================================================
    // CREATE REPLACEMENT TRANSFER
    // =====================================================

    const replacementTransferRows =
      await sequelize.query(
        `
        INSERT INTO stock_transfers
        (
          transfer_no,
          request_id,
          from_organization_id,
          to_organization_id,
          transfer_date,
          dispatch_date,
          status,
          remarks,
          approved_by,
          dispatched_by,
          created_by,
          driver_name,
          driver_phone,
          vehicle_number,
          tracking_number,
          pickup_address,
          delivery_address,
          expected_delivery_date,
          expected_delivery_time,
          additional_notes,
          created_at,
          updated_at
        )
        VALUES
        (
          :replacementTransferNo,
          NULL,
          :sourceOrganizationId,
          :destinationOrganizationId,
          CURRENT_DATE,
          NOW(),
          'in_transit',
          :transferRemarks,
          :userId,
          :userId,
          :userId,
          :driverName,
          :driverPhone,
          :vehicleNumber,
          :replacementTransferNo,
          :pickupAddress,
          :deliveryAddress,
          :expectedDeliveryDate,
          :expectedDeliveryTime,
          :additionalNotes,
          NOW(),
          NOW()
        )
        RETURNING *
        `,
        {
          replacements: {
            replacementTransferNo,
            sourceOrganizationId,
            destinationOrganizationId,

            userId: Number(user.id),

            transferRemarks,

            driverName:
              String(driver_name || "").trim() ||
              null,

            driverPhone:
              String(driver_phone || "").trim() ||
              null,

            vehicleNumber:
              String(vehicle_number || "").trim() ||
              null,

            pickupAddress:
              String(pickup_address || "").trim() ||
              sourceStore.address ||
              null,

            deliveryAddress:
              String(delivery_address || "").trim() ||
              destinationStore.address ||
              null,

            expectedDeliveryDate:
              expected_delivery_date || null,

            expectedDeliveryTime:
              expected_delivery_time || null,

            additionalNotes:
              String(additional_notes || "").trim() ||
              `Replacement against complaint ${complaint.complaint_no} and original transfer ${originalTransfer.transfer_no}`,
          },

          type: QueryTypes.SELECT,
          transaction,
        }
      );

    const replacementTransfer =
      replacementTransferRows[0];

    if (!replacementTransfer) {
      throw new Error(
        "Replacement stock transfer could not be created"
      );
    }

    // =====================================================
    // CREATE REPLACEMENT TRANSFER ITEM
    // =====================================================

    const replacementRate = Number(
      replacementItem.sale_rate ||
      replacementItem.purchase_rate ||
      originalTransferItem.rate ||
      0
    );

    const externalItemData = JSON.stringify({
      complaint_id: complaintId,
      complaint_no: complaint.complaint_no,

      original_transfer_id:
        Number(originalTransfer.id),

      original_transfer_no:
        originalTransfer.transfer_no,

      original_transfer_item_id:
        transferItemId,

      original_item_id:
        originalItemId,

      replacement_item_id:
        replacementItemId,

      source_stock_id:
        Number(sourceStock.id),

      source_batch_id:
        sourceStock.batch_id || null,
    });

    const replacementTransferItemRows =
      await sequelize.query(
        `
        INSERT INTO stock_transfer_items
        (
          transfer_id,
          item_id,
          qty,
          weight,
          rate,
          remarks,
          parent_batch_id,
          child_batch_id,
          external_item_data
        )
        VALUES
        (
          :replacementTransferId,
          :replacementItemId,
          :replacementQty,
          :replacementWeight,
          :replacementRate,
          :itemRemarks,
          :parentBatchId,
          NULL,
          CAST(:externalItemData AS jsonb)
        )
        RETURNING *
        `,
        {
          replacements: {
            replacementTransferId:
              Number(replacementTransfer.id),

            replacementItemId,

            replacementQty,

            replacementWeight,

            replacementRate,

            itemRemarks:
              `Replacement against complaint ${complaint.complaint_no}`,

            parentBatchId:
              sourceStock.batch_id || null,

            externalItemData,
          },

          type: QueryTypes.SELECT,
          transaction,
        }
      );

    const replacementTransferItem =
      replacementTransferItemRows[0];

    if (!replacementTransferItem) {
      throw new Error(
        "Replacement transfer item could not be created"
      );
    }
        // =====================================================
    // UPDATE SOURCE STOCK: AVAILABLE -> TRANSIT
    // =====================================================

    const updatedStockRows = await sequelize.query(
      `
        UPDATE stocks
        SET
          available_qty = :closingAvailableQty,
          available_weight = :closingAvailableWeight,
          transit_qty = :closingTransitQty,
          transit_weight = :closingTransitWeight,
          updated_at = NOW()
        WHERE id = :stockId
        RETURNING
          id,
          item_id,
          organization_id,
          store_code,
          batch_id,
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
          updated_at
      `,
      {
        replacements: {
          stockId: Number(sourceStock.id),
          closingAvailableQty,
          closingAvailableWeight,
          closingTransitQty,
          closingTransitWeight,
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const updatedStock = updatedStockRows[0];

    if (!updatedStock) {
      throw new Error(
        "Source stock could not be updated"
      );
    }

    // =====================================================
    // CREATE STOCK MOVEMENT
    // movement_type = dispatch DB constraint me allowed hai
    // =====================================================

    const movementMakingCharge = Number(
      replacementItem.making_charge || 0
    );

    const movementStoneAmount = Number(
      replacementItem.stone_amount || 0
    );

    const movementTotalAmount =
      replacementRate * replacementQty +
      movementMakingCharge +
      movementStoneAmount;

    const stockMovementRows = await sequelize.query(
      `
        INSERT INTO stock_movements
        (
          organization_id,
          item_id,
          movement_type,
          reference_type,
          reference_id,
          qty,
          weight,

          opening_available_qty,
          closing_available_qty,

          opening_reserved_qty,
          closing_reserved_qty,

          opening_transit_qty,
          closing_transit_qty,

          opening_damaged_qty,
          closing_damaged_qty,

          opening_available_weight,
          closing_available_weight,

          opening_reserved_weight,
          closing_reserved_weight,

          opening_transit_weight,
          closing_transit_weight,

          opening_damaged_weight,
          closing_damaged_weight,

          remarks,
          created_by,
          created_at,

          rate,
          making_charge,
          stone_amount,
          total_amount,
          profit_amount,

          from_organization_id,
          to_organization_id,

          movement_weight,
          transfer_id
        )
        VALUES
        (
          :sourceOrganizationId,
          :replacementItemId,
          'dispatch',
          'complaint_replacement',
          :replacementTransferId,
          :replacementQty,
          :replacementWeight,

          :openingAvailableQty,
          :closingAvailableQty,

          :openingReservedQty,
          :closingReservedQty,

          :openingTransitQty,
          :closingTransitQty,

          :openingDamagedQty,
          :closingDamagedQty,

          :openingAvailableWeight,
          :closingAvailableWeight,

          :openingReservedWeight,
          :closingReservedWeight,

          :openingTransitWeight,
          :closingTransitWeight,

          :openingDamagedWeight,
          :closingDamagedWeight,

          :movementRemarks,
          :userId,
          NOW(),

          :movementRate,
          :movementMakingCharge,
          :movementStoneAmount,
          :movementTotalAmount,
          0,

          :sourceOrganizationId,
          :destinationOrganizationId,

          :replacementWeight,
          :replacementTransferId
        )
        RETURNING *
      `,
      {
        replacements: {
          sourceOrganizationId,
          destinationOrganizationId,

          replacementItemId,

          replacementTransferId: Number(
            replacementTransfer.id
          ),

          replacementQty,
          replacementWeight,

          openingAvailableQty,
          closingAvailableQty,

          openingReservedQty,
          closingReservedQty,

          openingTransitQty,
          closingTransitQty,

          openingDamagedQty,
          closingDamagedQty,

          openingAvailableWeight,
          closingAvailableWeight,

          openingReservedWeight,
          closingReservedWeight,

          openingTransitWeight,
          closingTransitWeight,

          openingDamagedWeight,
          closingDamagedWeight,

          movementRemarks:
            `Replacement dispatched against complaint ${complaint.complaint_no}`,

          userId: Number(user.id),

          movementRate: replacementRate,
          movementMakingCharge,
          movementStoneAmount,
          movementTotalAmount,
        },

        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const stockMovement =
      stockMovementRows[0];

    if (!stockMovement) {
      throw new Error(
        "Stock movement could not be created"
      );
    }

    // =====================================================
    // UPDATE COMPLAINT ITEM JSONB
    // =====================================================

    const dispatchedAt =
      new Date().toISOString();

    const updatedComplaintItem = {
      ...complaintItem,

      status: "replacement_dispatched",

      resolution_status:
        "replacement_dispatched",

      original_item_id:
        originalItemId,

      replacement_item_id:
        replacementItemId,

      replacement_transfer_id:
        Number(replacementTransfer.id),

      replacement_transfer_no:
        replacementTransfer.transfer_no,

      replacement_transfer_item_id:
        Number(replacementTransferItem.id),

      replacement_qty:
        replacementQty,

      replacement_weight:
        replacementWeight,

      replacement_rate:
        replacementRate,

      replacement_stock_id:
        Number(sourceStock.id),

      replacement_batch_id:
        sourceStock.batch_id || null,

      replacement_dispatched_by:
        Number(user.id),

      replacement_dispatched_at:
        dispatchedAt,

      resolution_note:
        String(remarks || "").trim() ||
        "Replacement item dispatched",
    };

    complaintItems[complaintItemIndex] =
      updatedComplaintItem;

    /*
      Complaint ka main status under_review hi rakha gaya hai.

      Kyunki database ke complaint status constraint ki
      complete allowed values abhi confirm nahi hain.

      Individual complaint item ke andar:
      replacement_dispatched status save ho raha hai.
    */

    const updatedComplaintStatus =
  "replacement_dispatched";

    const updatedComplaintRows =
      await sequelize.query(
        `
          UPDATE stock_transfer_complaints
          SET
            items = CAST(:complaintItems AS jsonb),
            status = :updatedComplaintStatus,
            resolution_note = :resolutionNote,
            updated_at = NOW()
          WHERE id = :complaintId
          RETURNING
            id,
            complaint_no,
            transfer_id,
            from_organization_id,
            to_organization_id,
            complaint_type,
            description,
            items,
            status,
            raised_by,
            resolution_note,
            resolved_by,
            resolved_at,
            created_at,
            updated_at
        `,
        {
          replacements: {
            complaintItems:
              JSON.stringify(complaintItems),

            updatedComplaintStatus,

            resolutionNote:
              String(remarks || "").trim() ||
              `Replacement transfer ${replacementTransfer.transfer_no} dispatched`,

            complaintId,
          },

          type: QueryTypes.SELECT,
          transaction,
        }
      );

    const updatedComplaint =
      updatedComplaintRows[0];

    if (!updatedComplaint) {
      throw new Error(
        "Complaint could not be updated"
      );
    }

    // =====================================================
    // COMMIT TRANSACTION
    // =====================================================

    await transaction.commit();

    // =====================================================
    // SUCCESS RESPONSE
    // =====================================================

    return res.status(201).json({
      success: true,

      message:
        "Replacement item dispatched successfully",

      data: {
        complaint: {
          id: Number(updatedComplaint.id),

          complaint_no:
            updatedComplaint.complaint_no,

          status:
            updatedComplaint.status,

          original_transfer_id:
            Number(originalTransfer.id),

          original_transfer_no:
            originalTransfer.transfer_no,

          source_organization_id:
            sourceOrganizationId,

          source_store_code:
            sourceStore.store_code,

          destination_organization_id:
            destinationOrganizationId,

          destination_store_code:
            destinationStore.store_code,
        },

        complaint_item: {
          original_transfer_item_id:
            transferItemId,

          original_item_id:
            originalItemId,

          sent_qty: Number(
            updatedComplaintItem.sent_qty || 0
          ),

          received_qty: Number(
            updatedComplaintItem.received_qty || 0
          ),

          shortage_qty:
            shortageQty,

          shortage_weight:
            shortageWeight,

          replacement_item_id:
            replacementItemId,

          replacement_qty:
            replacementQty,

          replacement_weight:
            replacementWeight,

          resolution_status:
            "replacement_dispatched",
        },

        replacement_transfer: {
          id: Number(
            replacementTransfer.id
          ),

          transfer_no:
            replacementTransfer.transfer_no,

          status:
            replacementTransfer.status,

          from_organization_id: Number(
            replacementTransfer.from_organization_id
          ),

          to_organization_id: Number(
            replacementTransfer.to_organization_id
          ),

          dispatch_date:
            replacementTransfer.dispatch_date,

          tracking_number:
            replacementTransfer.tracking_number,

          driver_name:
            replacementTransfer.driver_name,

          driver_phone:
            replacementTransfer.driver_phone,

          vehicle_number:
            replacementTransfer.vehicle_number,
        },

        replacement_transfer_item: {
          id: Number(
            replacementTransferItem.id
          ),

          transfer_id: Number(
            replacementTransferItem.transfer_id
          ),

          item_id: Number(
            replacementTransferItem.item_id
          ),

          qty: Number(
            replacementTransferItem.qty
          ),

          weight: Number(
            replacementTransferItem.weight
          ),

          rate: Number(
            replacementTransferItem.rate
          ),
        },

        stock_after_dispatch: {
          stock_id: Number(
            updatedStock.id
          ),

          item_id: Number(
            updatedStock.item_id
          ),

          organization_id: Number(
            updatedStock.organization_id
          ),

          store_code:
            updatedStock.store_code,

          batch_id:
            updatedStock.batch_id,

          available_qty: Number(
            updatedStock.available_qty
          ),

          available_weight: Number(
            updatedStock.available_weight
          ),

          transit_qty: Number(
            updatedStock.transit_qty
          ),

          transit_weight: Number(
            updatedStock.transit_weight
          ),
        },

        stock_movement: {
          id: Number(
            stockMovement.id
          ),

          movement_type:
            stockMovement.movement_type,

          reference_type:
            stockMovement.reference_type,

          reference_id: Number(
            stockMovement.reference_id
          ),

          opening_available_qty: Number(
            stockMovement.opening_available_qty
          ),

          closing_available_qty: Number(
            stockMovement.closing_available_qty
          ),

          opening_transit_qty: Number(
            stockMovement.opening_transit_qty
          ),

          closing_transit_qty: Number(
            stockMovement.closing_transit_qty
          ),
        },
      },
    });
  } catch (error) {
    // =====================================================
    // ROLLBACK TRANSACTION
    // =====================================================

    if (!transaction.finished) {
      await transaction.rollback();
    }

    console.error(
      "sendReplacementAgainstComplaint error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to dispatch replacement item",

      error:
        error.message,

      database_error:
        error?.parent?.message ||
        error?.original?.message ||
        null,

      sql_state:
        error?.parent?.code ||
        error?.original?.code ||
        null,
    });
  }
};
/**
 * ==========================================================
 * GET COMPLAINT DETAILS (STORE)
 * ==========================================================
 * GET /stock-transfer-complaints/:complaintId
 *
 * Only the receiver store (complaint raiser)
 * can view complaint details.
 * ==========================================================
 */

export const getComplaintDetails = async (req, res) => {
  try {
    const { complaintId } = req.params;
    const user = req.user;

    // =====================================================
    // VALIDATION
    // =====================================================

    if (!user?.id || !user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user.",
      });
    }

    const id = Number(complaintId);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid complaint id.",
      });
    }

    // =====================================================
    // FETCH COMPLAINT
    // =====================================================

    const complaint = await StockTransferComplaint.findByPk(id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found.",
      });
    }

    // =====================================================
    // AUTHORIZATION
    // =====================================================

    if (
      Number(user.organization_id) !==
      Number(complaint.to_organization_id)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You are not authorized to view this complaint.",
      });
    }

    // =====================================================
    // FETCH EVERYTHING
    // =====================================================

    const [
      transfer,
      transferItems,
      senderStore,
      receiverStore,
    ] = await Promise.all([
      StockTransfer.findByPk(complaint.transfer_id),

      StockTransferItem.findAll({
        where: {
          transfer_id: complaint.transfer_id,
        },
        raw: true,
      }),

      sequelize.query(
        `
        SELECT
            id,
            store_code,
            store_name,
            organization_level,
            state,
            district,
            district_id,
            address,
            phone_number,
            is_active
        FROM stores
        WHERE id=:id
        `,
        {
          replacements: {
            id: complaint.from_organization_id,
          },
          type: QueryTypes.SELECT,
        }
      ),

      sequelize.query(
        `
        SELECT
            id,
            store_code,
            store_name,
            organization_level,
            state,
            district,
            district_id,
            address,
            phone_number,
            is_active
        FROM stores
        WHERE id=:id
        `,
        {
          replacements: {
            id: complaint.to_organization_id,
          },
          type: QueryTypes.SELECT,
        }
      ),
    ]);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found.",
      });
    }

    const fromStore = senderStore[0] || null;
    const toStore = receiverStore[0] || null;

    // =====================================================
    // PREPARE MAPS
    // =====================================================

    const transferItemMap = new Map();

    transferItems.forEach((x) =>
      transferItemMap.set(Number(x.id), x)
    );

    const itemIds = [
      ...new Set(
        transferItems.map((x) =>
          Number(x.item_id)
        )
      ),
    ];

    const items =
      itemIds.length === 0
        ? []
        : await Item.findAll({
            where: {
              id: {
                [Op.in]: itemIds,
              },
            },
            raw: true,
          });

    const itemMap = new Map();

    items.forEach((x) =>
      itemMap.set(Number(x.id), x)
    );

    const complaintItems = Array.isArray(
      complaint.items
    )
      ? complaint.items
      : [];

    let totalSentQty = 0;
    let totalReceivedQty = 0;
    let totalShortageQty = 0;

    let totalSentWeight = 0;
    let totalReceivedWeight = 0;
    let totalShortageWeight = 0;

    const formattedItems = [];
        // =====================================================
    // BUILD ITEM DETAILS
    // =====================================================

    for (const complaintItem of complaintItems) {

      const transferItem =
        transferItemMap.get(
          Number(complaintItem.transfer_item_id)
        ) || null;

      const item =
        itemMap.get(
          Number(complaintItem.item_id)
        ) || null;

      const sentQty = Number(
        complaintItem.sent_qty || 0
      );

      const receivedQty = Number(
        complaintItem.received_qty || 0
      );

      const shortageQty = Number(
        complaintItem.shortage_qty || 0
      );

      const sentWeight = Number(
        complaintItem.sent_weight || 0
      );

      const receivedWeight = Number(
        complaintItem.received_weight || 0
      );

      const shortageWeight = Number(
        complaintItem.shortage_weight || 0
      );

      // =============================================
      // SUMMARY
      // =============================================

      totalSentQty += sentQty;
      totalReceivedQty += receivedQty;
      totalShortageQty += shortageQty;

      totalSentWeight += sentWeight;
      totalReceivedWeight += receivedWeight;
      totalShortageWeight += shortageWeight;

      // =============================================
      // PUSH ITEM
      // =============================================

      formattedItems.push({

        transfer_item_id:
          complaintItem.transfer_item_id,

        item_id:
          complaintItem.item_id,

        article_code:
          item?.article_code ?? null,

        sku_code:
          item?.sku_code ?? null,

        item_name:
          item?.item_name ?? null,

        category:
          item?.category ?? null,

        metal_type:
          item?.metal_type ?? null,

        purity:
          item?.purity ?? null,

        details:
          item?.details ?? null,

        image_url:
          item?.image_url ?? null,

        qr_code_url:
          item?.qr_code_url ?? null,

        qr_code_value:
          item?.qr_code_value ?? null,

        unit:
          item?.unit ?? null,

        gross_weight:
          Number(item?.gross_weight || 0),

        net_weight:
          Number(item?.net_weight || 0),

        stone_weight:
          Number(item?.stone_weight || 0),

        making_charge:
          Number(item?.making_charge || 0),

        purchase_rate:
          Number(item?.purchase_rate || 0),

        sale_rate:
          Number(item?.sale_rate || 0),

        current_status:
          item?.current_status ?? null,

        organization_id:
          item?.organization_id ?? null,

        // =========================================
        // Transfer Snapshot
        // =========================================

        transfer: transferItem
          ? {

              id:
                transferItem.id,

              qty:
                Number(
                  transferItem.qty || 0
                ),

              weight:
                Number(
                  transferItem.weight || 0
                ),

              rate:
                Number(
                  transferItem.rate || 0
                ),

              remarks:
                transferItem.remarks,
            }
          : null,

        // =========================================
        // Complaint Snapshot
        // =========================================

        complaint: {

          sent_qty:
            sentQty,

          received_qty:
            receivedQty,

          shortage_qty:
            shortageQty,

          sent_weight:
            sentWeight,

          received_weight:
            receivedWeight,

          shortage_weight:
            shortageWeight,

          note:
            complaintItem.note || "",
        },
      });

    }

    // =====================================================
    // SUMMARY OBJECT
    // =====================================================

    const summary = {

      total_items:
        formattedItems.length,

      total_sent_qty:
        Number(totalSentQty.toFixed(3)),

      total_received_qty:
        Number(totalReceivedQty.toFixed(3)),

      total_shortage_qty:
        Number(totalShortageQty.toFixed(3)),

      total_sent_weight:
        Number(totalSentWeight.toFixed(3)),

      total_received_weight:
        Number(totalReceivedWeight.toFixed(3)),

      total_shortage_weight:
        Number(totalShortageWeight.toFixed(3)),
    };

    // =====================================================
    // TIMELINE
    // =====================================================

    const timeline = [];

    timeline.push({
      key: "raised",
      title: "Complaint Raised",
      completed: true,
      date: complaint.created_at,
    });

    timeline.push({
      key: "review",
      title: "Under Review",
      completed: [
        "under_review",
        "resolved",
        "closed",
        "rejected",
      ].includes(complaint.status),
      date:
        complaint.status === "under_review"
          ? complaint.updated_at
          : null,
    });

    timeline.push({
      key: "resolved",
      title: "Resolved",
      completed:
        complaint.status === "resolved",
      date:
        complaint.resolved_at,
    });

    timeline.push({
      key: "rejected",
      title: "Rejected",
      completed:
        complaint.status === "rejected",
      date:
        complaint.resolved_at,
    });

    timeline.push({
      key: "closed",
      title: "Closed",
      completed:
        complaint.status === "closed",
      date:
        complaint.updated_at,
    });
        // =====================================================
    // RESPONSE OBJECT
    // =====================================================

    const response = {
      complaint: {
        id: complaint.id,
        complaint_no: complaint.complaint_no,
        transfer_id: complaint.transfer_id,

        complaint_type: complaint.complaint_type,
        status: complaint.status,

        description: complaint.description,

        raised_by: complaint.raised_by,

        from_organization_id:
          complaint.from_organization_id,

        to_organization_id:
          complaint.to_organization_id,

        created_at: complaint.created_at,
        updated_at: complaint.updated_at,

        resolution_note:
          complaint.resolution_note,

        resolved_by:
          complaint.resolved_by,

        resolved_at:
          complaint.resolved_at,
      },

      transfer: {
        id: transfer.id,

        transfer_no:
          transfer.transfer_no,

        request_id:
          transfer.request_id,

        status:
          transfer.status,

        transfer_date:
          transfer.transfer_date,

        dispatch_date:
          transfer.dispatch_date,

        receive_date:
          transfer.receive_date,

        remarks:
          transfer.remarks,

        approved_by:
          transfer.approved_by,

        dispatched_by:
          transfer.dispatched_by,

        received_by:
          transfer.received_by,

        created_by:
          transfer.created_by,

        driver_name:
          transfer.driver_name,

        driver_phone:
          transfer.driver_phone,

        vehicle_number:
          transfer.vehicle_number,

        tracking_number:
          transfer.tracking_number,

        dispatch_address:
          transfer.dispatch_address,

        destination_address:
          transfer.destination_address,

        expected_delivery_date:
          transfer.expected_delivery_date,

        expected_delivery_time:
          transfer.expected_delivery_time,

        dispatch_image_url:
          transfer.dispatch_image_url,

        dispatch_video_url:
          transfer.dispatch_video_url,

        e_way_bill_url:
          transfer.e_way_bill_url,
      },

      sender_store: fromStore
        ? {
            id: fromStore.id,
            store_code:
              fromStore.store_code,
            store_name:
              fromStore.store_name,
            organization_level:
              fromStore.organization_level,
            state:
              fromStore.state,
            district:
              fromStore.district,
            district_id:
              fromStore.district_id,
            address:
              fromStore.address,
            phone_number:
              fromStore.phone_number,
            is_active:
              fromStore.is_active,
          }
        : null,

      receiver_store: toStore
        ? {
            id: toStore.id,
            store_code:
              toStore.store_code,
            store_name:
              toStore.store_name,
            organization_level:
              toStore.organization_level,
            state:
              toStore.state,
            district:
              toStore.district,
            district_id:
              toStore.district_id,
            address:
              toStore.address,
            phone_number:
              toStore.phone_number,
            is_active:
              toStore.is_active,
          }
        : null,

      evidence: {
        image_1_url:
          complaint.image_1_url,

        image_2_url:
          complaint.image_2_url,

        video_url:
          complaint.video_url,
      },

      summary,

      items: formattedItems,

      timeline,
    };

    // =====================================================
    // SUCCESS RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,
      message:
        "Complaint details fetched successfully.",
      data: response,
    });

  } catch (error) {

    console.error(
      "getComplaintDetails Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch complaint details.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });

  }
};
