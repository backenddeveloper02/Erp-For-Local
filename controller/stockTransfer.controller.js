const {
  createTransferService,
  approveTransferService,
  dispatchTransferService,
  receiveTransferService,
  cancelTransferService
} = require("../services/stockTransfer.service");

const { StockTransfer, StockTransferItem, Item } = require("../models");

exports.createTransfer = async (req, res) => {
  try {
    const transfer = await createTransferService({
      body: req.body,
      user: req.user,
      req
    });

    return res.status(201).json({
      success: true,
      message: "Stock transfer created successfully",
      data: transfer
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create transfer"
    });
  }
};

exports.approveTransfer = async (req, res) => {
  try {
    const transfer = await approveTransferService({
      transferId: req.params.id,
      user: req.user,
      req
    });

    return res.status(200).json({
      success: true,
      message: "Transfer approved successfully",
      data: transfer
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to approve transfer"
    });
  }
};

exports.dispatchTransfer = async (req, res) => {
  try {
    const transfer = await dispatchTransferService({
      transferId: req.params.id,
      user: req.user,
      req
    });

    return res.status(200).json({
      success: true,
      message: "Transfer dispatched successfully",
      data: transfer
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to dispatch transfer"
    });
  }
};

exports.receiveTransfer = async (req, res) => {
  try {
    const transfer = await receiveTransferService({
      transferId: req.params.id,
      user: req.user,
      req
    });

    return res.status(200).json({
      success: true,
      message: "Transfer received successfully",
      data: transfer
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to receive transfer"
    });
  }
};

exports.cancelTransfer = async (req, res) => {
  try {
    const transfer = await cancelTransferService({
      transferId: req.params.id,
      user: req.user,
      req,
      remarks: req.body?.remarks || null
    });

    return res.status(200).json({
      success: true,
      message: "Transfer cancelled successfully",
      data: transfer
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to cancel transfer"
    });
  }
};

exports.getTransferById = async (req, res) => {
  try {
    const transfer = await StockTransfer.findByPk(req.params.id, {
      include: [
        {
          model: StockTransferItem,
          as: "items",
          include: [
            {
              model: Item,
              as: "item"
            }
          ]
        }
      ]
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Transfer fetched successfully",
      data: transfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transfer",
      error: error.message
    });
  }
};

exports.getTransferList = async (req, res) => {
  try {
    const { status, from_organization_id, to_organization_id } = req.query;

    const where = {};
    if (status) where.status = status;
    if (from_organization_id) where.from_organization_id = from_organization_id;
    if (to_organization_id) where.to_organization_id = to_organization_id;

    const rows = await StockTransfer.findAll({
      where,
      include: [
        {
          model: StockTransferItem,
          as: "items"
        }
      ],
      order: [["created_at", "DESC"]]
    });

    return res.status(200).json({
      success: true,
      message: "Transfer list fetched successfully",
      count: rows.length,
      data: rows
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transfer list",
      error: error.message
    });
  }
};
