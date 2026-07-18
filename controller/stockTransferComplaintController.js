import { Op } from "sequelize";

import sequelize from "../config/db.js";

import StockTransfer from "../model/stockTransfer.js";
import StockTransferItem from "../model/stockTransferItem.js";
import StockTransferComplaint from "../model/StockTransferComplaint.js";
import SystemActivity from "../model/systemActivity.js";
import ActivityLog from "../model/activityLog.js";
import Store from "../model/Store.js";
import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";

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
