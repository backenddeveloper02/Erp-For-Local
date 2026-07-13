import { Op } from "sequelize";

import sequelize from "../config/db.js";

import StockTransfer from "../model/stockTransfer.js";
import StockTransferItem from "../model/stockTransferItem.js";
import StockTransferComplaint from "../model/StockTransferComplaint.js";
import StockRequest from "../model/StockRequest.js";
import SystemActivity from "../model/systemActivity.js";
import ActivityLog from "../model/activityLog.js";

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
