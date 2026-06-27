const { Op } = require("sequelize");
const {
  Stock,
  StockMovement,
  AuditTrail
} = require("../models");

const toNum = (val) => Number(val || 0);

async function getOrCreateStockRow({ organization_id, item_id, transaction, lock = false }) {
  let stock = await Stock.findOne({
    where: { organization_id, item_id },
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined
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
        damaged_weight: 0
      },
      { transaction }
    );

    if (lock) {
      stock = await Stock.findOne({
        where: { organization_id, item_id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
    }
  }

  return stock;
}

function validateNonNegativeStock(stock) {
  const fields = [
    "available_qty",
    "available_weight",
    "reserved_qty",
    "reserved_weight",
    "transit_qty",
    "transit_weight",
    "damaged_qty",
    "damaged_weight"
  ];

  for (const field of fields) {
    if (toNum(stock[field]) < 0) {
      throw new Error(`Negative stock not allowed for ${field}`);
    }
  }
}

async function createStockMovement({
  organization_id,
  item_id,
  movement_type,
  reference_type = null,
  reference_id = null,
  qty = 0,
  weight = 0,
  openingStock,
  closingStock,
  remarks = null,
  created_by = null,
  transaction
}) {
  return await StockMovement.create(
    {
      organization_id,
      item_id,
      movement_type,
      reference_type,
      reference_id,
      qty,
      weight,

      opening_available_qty: toNum(openingStock.available_qty),
      closing_available_qty: toNum(closingStock.available_qty),

      opening_reserved_qty: toNum(openingStock.reserved_qty),
      closing_reserved_qty: toNum(closingStock.reserved_qty),

      opening_transit_qty: toNum(openingStock.transit_qty),
      closing_transit_qty: toNum(closingStock.transit_qty),

      opening_damaged_qty: toNum(openingStock.damaged_qty),
      closing_damaged_qty: toNum(closingStock.damaged_qty),

      opening_available_weight: toNum(openingStock.available_weight),
      closing_available_weight: toNum(closingStock.available_weight),

      opening_reserved_weight: toNum(openingStock.reserved_weight),
      closing_reserved_weight: toNum(closingStock.reserved_weight),

      opening_transit_weight: toNum(openingStock.transit_weight),
      closing_transit_weight: toNum(closingStock.transit_weight),

      opening_damaged_weight: toNum(openingStock.damaged_weight),
      closing_damaged_weight: toNum(closingStock.damaged_weight),

      remarks,
      created_by
    },
    { transaction }
  );
}

async function createAuditLog({
  module,
  entity_type,
  entity_id = null,
  action,
  organization_id = null,
  user_id = null,
  old_values = null,
  new_values = null,
  remarks = null,
  req = null,
  transaction
}) {
  return await AuditTrail.create(
    {
      module,
      entity_type,
      entity_id,
      action,
      organization_id,
      user_id,
      old_values,
      new_values,
      remarks,
      ip_address: req?.ip || null,
      user_agent: req?.headers?.["user-agent"] || null
    },
    { transaction }
  );
}

module.exports = {
  toNum,
  getOrCreateStockRow,
  validateNonNegativeStock,
  createStockMovement,
  createAuditLog
};