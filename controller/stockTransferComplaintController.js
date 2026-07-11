import { Op } from "sequelize";

import sequelize from "../config/db.js";

import StockTransfer from "../model/StockTransfer.js";
import StockTransferItem from "../model/StockTransferItem.js";
import StockTransferComplaint from "../model/StockTransferComplaint.js";
import StockRequest from "../model/StockRequest.js";
import SystemActivity from "../model/SystemActivity.js";
import ActivityLog from "../model/ActivityLog.js";

import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";

const toNumber = (value) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

const generateComplaintNo = (
  transferNo,
  transferId
) => {
  const safeTransferNo = String(
    transferNo || transferId
  )
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toUpperCase();

  return `CMP-${safeTransferNo}-${Date.now()}`;
};

const parseComplaintItems = (items) => {
  if (Array.isArray(items)) {
    return items;
  }

  if (typeof items === "string") {
    try {
      const parsedItems = JSON.parse(items);

      return Array.isArray(parsedItems)
        ? parsedItems
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

export const raiseTransferComplaint = async (
  req,
  res
) => {
  const transaction =
    await sequelize.transaction();

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
    // ITEMS PARSE
    // Multipart form-data me items JSON string aayega
    // =====================================================

    const requestedItems = parseComplaintItems(
      req.body.items
    );

    if (!requestedItems.length) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "At least one complaint item is required",
      });
    }

    // =====================================================
    // FILE VALIDATION
    //
    // Expected fields:
    // images = exactly 2 files
    // video  = exactly 1 file
    // =====================================================

    const images = Array.isArray(
      req.files?.images
    )
      ? req.files.images
      : [];

    const videos = Array.isArray(
      req.files?.video
    )
      ? req.files.video
      : [];

    if (images.length !== 2) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Exactly 2 complaint images are required",
      });
    }

    if (videos.length !== 1) {
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Exactly 1 complaint video is required",
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
      if (
        !validImageTypes.includes(image.mimetype)
      ) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Only JPG, JPEG, PNG and WEBP images are allowed",
        });
      }
    }

    if (
      !validVideoTypes.includes(
        videos[0].mimetype
      )
    ) {
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
      transferId,
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

    const transferStatus = String(
      transfer.status || ""
    )
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
            [Op.in]: [
              "open",
              "under_review",
            ],
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
          complaint_id:
            existingComplaint.id,

          complaint_no:
            existingComplaint.complaint_no,

          status:
            existingComplaint.status,
        },
      });
    }

    // =====================================================
    // FETCH TRANSFER ITEMS
    // =====================================================

    const transferItems =
      await StockTransferItem.findAll({
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
        message:
          "No items found in this transfer",
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
    // VALIDATE AND PREPARE ITEMS JSON
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

      const sentQty = toNumber(
        transferItem.qty
      );

      const sentWeight = toNumber(
        transferItem.weight
      );

      const receivedQty = toNumber(
        requestedItem.received_qty
      );

      const receivedWeight = toNumber(
        requestedItem.received_weight
      );

      if (receivedQty < 0) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Received quantity cannot be negative for transfer item ${transferItemId}`,
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

      if (receivedQty > sentQty) {
        await transaction.rollback();

        return res.status(400).json({
          success: false,

          message:
            `Received quantity cannot exceed sent quantity for transfer item ${transferItemId}`,
        });
      }

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
        });
      }

      const shortageQty = Number(
        Math.max(
          0,
          sentQty - receivedQty
        ).toFixed(3)
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

        received_weight:
          receivedWeight,

        shortage_weight:
          shortageWeight,

        note:
          requestedItem.note || null,
      });
    }

    // =====================================================
    // UPLOAD 2 IMAGES AND 1 VIDEO
    // =====================================================

    const image1Upload =
      await uploadToCloudinary(
        images[0].path,
        "stock-transfer-complaints/images",
        "image"
      );

    const image2Upload =
      await uploadToCloudinary(
        images[1].path,
        "stock-transfer-complaints/images",
        "image"
      );

    const videoUpload =
      await uploadToCloudinary(
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

    if (
      !image1Url ||
      !image2Url ||
      !videoUrl
    ) {
      throw new Error(
        "Failed to upload complaint evidence"
      );
    }

    // =====================================================
    // CREATE COMPLAINT
    // =====================================================

    const complaintNo =
      generateComplaintNo(
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

          complaint_type:
            String(
              complaint_type ||
                "quantity_shortage"
            )
              .trim()
              .toLowerCase(),

          description:
            description || null,

          items:
            complaintItems,

          image_1_url:
            image1Url,

          image_2_url:
            image2Url,

          video_url:
            videoUrl,

          status:
            "open",

          raised_by:
            user.id,
        },
        {
          transaction,
        }
      );

    // =====================================================
    // UPDATE TRANSFER STATUS
    //
    // Stock receive nahi hoga.
    // Destination available_qty update nahi hogi.
    // Source transit_qty clear nahi hogi.
    // =====================================================

    await transfer.update(
      {
        status:
          "complaint_raised",

        remarks:
          description ||
          `Complaint ${complaintNo} raised due to quantity shortage`,
      },
      {
        transaction,
      }
    );

    // =====================================================
    // REQUEST STATUS
    //
    // Agar StockRequest status constraint me
    // complaint_raised available nahi hai,
    // to is block ko remove kar dena.
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
            status:
              "complaint_raised",
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
        title:
          "Stock transfer complaint raised",

        description:
          `Complaint ${complaintNo} raised against transfer ${transfer.transfer_no}`,

        activity_type:
          "stock_transfer_complaint_raised",

        module_name:
          "stock_transfer_complaint",

        reference_id:
          complaint.id,

        reference_no:
          complaintNo,

        district_code:
          user.district_code || null,

        store_code:
          receiverStoreCode,

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
          user.organization_id,

        user_id:
          user.id,

        action:
          "stock_transfer_complaint_raised",

        module_name:
          "stock_transfer_complaint",

        reference_id:
          complaint.id,

        reference_no:
          complaintNo,

        title:
          "Stock transfer complaint raised",

        description:
          `Complaint ${complaintNo} raised against transfer ${transfer.transfer_no}`,

        meta: {
          complaint_id:
            complaint.id,

          complaint_no:
            complaintNo,

          transfer_id:
            transfer.id,

          transfer_no:
            transfer.transfer_no,

          from_organization_id:
            transfer.from_organization_id,

          to_organization_id:
            transfer.to_organization_id,

          store_code:
            receiverStoreCode,

          complaint_type:
            complaint.complaint_type,

          items:
            complaintItems,

          image_1_url:
            image1Url,

          image_2_url:
            image2Url,

          video_url:
            videoUrl,

          status:
            "open",
        },

        icon:
          "complaint",

        color:
          "red",
      },
      {
        transaction,
      }
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,

      message:
        "Transfer complaint raised successfully. Stock has not been received.",

      data: {
        id:
          complaint.id,

        complaint_no:
          complaint.complaint_no,

        transfer_id:
          complaint.transfer_id,

        transfer_no:
          transfer.transfer_no,

        complaint_type:
          complaint.complaint_type,

        description:
          complaint.description,

        items:
          complaint.items,

        evidence: {
          image_1_url:
            complaint.image_1_url,

          image_2_url:
            complaint.image_2_url,

          video_url:
            complaint.video_url,
        },

        status:
          complaint.status,

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

      error:
        error.message,
    });
  }
};