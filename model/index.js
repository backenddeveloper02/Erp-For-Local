import sequelize from "../config/db.js";

import User from "./user.js";
import Item from "./item.js";
import Stock from "./stockrecord.js";
import StockTransfer from "./stockTransfer.js";
import StockTransferItem from "./stockTransferItem.js";
import StockMovement from "./stockmovement.js";
import StockRequest from "./StockRequest.js";
import StockRequestItem from "./stockRequestItem.js";
import AuditTrail from "./audittrail.js";
import Store from "./Store.js";

import Customer from "./Customer.js";
import LedgerEntry from "./LedgerEntry.js";
import Invoice from "./invoices.js";
import Payment from "./Payment.js";
import Transaction from "./Transaction.js";
import TransactionEntry from "./TransactionEntry.js";

import InventoryBatch from "./inventoryBatch.js";
import BatchSplit from "./batchSplit.js";
import BatchTimeline from "./batchTimeline.js";
import TrackingLog from "./trackingLog.js";

/* =========================================================
   ITEM RELATIONS
========================================================= */

Item.hasMany(Stock, {
  foreignKey: "item_id",
  as: "stocks",
  onDelete: "CASCADE",
});

Stock.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

Item.hasMany(StockMovement, {
  foreignKey: "item_id",
  as: "movements",
});

StockMovement.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

Item.hasMany(StockTransferItem, {
  foreignKey: "item_id",
  as: "transfer_items",
});

StockTransferItem.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

Item.hasMany(StockRequestItem, {
  foreignKey: "item_id",
  as: "request_items",
});

StockRequestItem.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

Item.hasMany(InventoryBatch, {
  foreignKey: "item_id",
  as: "inventory_batches",
});

InventoryBatch.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

/* =========================================================
   STORE / ORGANIZATION RELATIONS
========================================================= */

Store.hasMany(Item, {
  foreignKey: "organization_id",
  as: "items",
});

Item.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

Store.hasMany(Stock, {
  foreignKey: "organization_id",
  as: "stocks",
});

Stock.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

Store.hasMany(StockMovement, {
  foreignKey: "organization_id",
  as: "stock_movements",
});

StockMovement.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

Store.hasMany(InventoryBatch, {
  foreignKey: "organization_id",
  as: "inventory_batches",
});

InventoryBatch.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

/* =========================================================
   CUSTOMER / LEDGER RELATIONS
========================================================= */

Customer.hasMany(LedgerEntry, {
  foreignKey: "customer_id",
  as: "ledger_entries",
});

LedgerEntry.belongsTo(Customer, {
  foreignKey: "customer_id",
  as: "customer",
});

Store.hasMany(Customer, {
  foreignKey: "organization_id",
  as: "customers",
});

Customer.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

/* =========================================================
   INVOICE / PAYMENT / ACCOUNTING RELATIONS
========================================================= */

Customer.hasMany(Invoice, {
  foreignKey: "customer_id",
  as: "invoices",
});

Invoice.belongsTo(Customer, {
  foreignKey: "customer_id",
  as: "customer",
});

Store.hasMany(Invoice, {
  foreignKey: "organization_id",
  as: "invoices",
});

Invoice.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

Invoice.hasMany(Payment, {
  foreignKey: "invoice_id",
  as: "payments",
});

Payment.belongsTo(Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
});

Store.hasMany(Payment, {
  foreignKey: "organization_id",
  as: "payments",
});

Payment.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

Transaction.hasMany(TransactionEntry, {
  foreignKey: "transaction_id",
  as: "entries",
});

TransactionEntry.belongsTo(Transaction, {
  foreignKey: "transaction_id",
  as: "transaction",
});

/* =========================================================
   STOCK REQUEST RELATIONS
========================================================= */

Store.hasMany(StockRequest, {
  foreignKey: "from_organization_id",
  as: "outgoing_requests",
});

Store.hasMany(StockRequest, {
  foreignKey: "to_organization_id",
  as: "incoming_requests",
});

StockRequest.belongsTo(Store, {
  foreignKey: "from_organization_id",
  as: "fromOrganization",
});

StockRequest.belongsTo(Store, {
  foreignKey: "to_organization_id",
  as: "toOrganization",
});

StockRequest.hasMany(StockRequestItem, {
  foreignKey: "request_id",
  as: "request_items",
});

StockRequestItem.belongsTo(StockRequest, {
  foreignKey: "request_id",
  as: "request",
});

/* =========================================================
   STOCK TRANSFER RELATIONS
========================================================= */

Store.hasMany(StockTransfer, {
  foreignKey: "from_organization_id",
  as: "outgoing_transfers",
});

Store.hasMany(StockTransfer, {
  foreignKey: "to_organization_id",
  as: "incoming_transfers",
});

StockTransfer.belongsTo(Store, {
  foreignKey: "from_organization_id",
  as: "fromOrganization",
});

StockTransfer.belongsTo(Store, {
  foreignKey: "to_organization_id",
  as: "toOrganization",
});

StockTransfer.hasMany(StockTransferItem, {
  foreignKey: "transfer_id",
  as: "transfer_items",
});

StockTransferItem.belongsTo(StockTransfer, {
  foreignKey: "transfer_id",
  as: "transfer",
});

/* =========================================================
   STOCK TRANSFER <-> USER RELATIONS
========================================================= */

StockTransfer.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator",
});

StockTransfer.belongsTo(User, {
  foreignKey: "approved_by",
  as: "approver",
});

StockTransfer.belongsTo(User, {
  foreignKey: "dispatched_by",
  as: "dispatcher",
});

StockTransfer.belongsTo(User, {
  foreignKey: "received_by",
  as: "receiver",
});

User.hasMany(StockTransfer, {
  foreignKey: "created_by",
  as: "created_transfers",
});

User.hasMany(StockTransfer, {
  foreignKey: "approved_by",
  as: "approved_transfers",
});

User.hasMany(StockTransfer, {
  foreignKey: "dispatched_by",
  as: "dispatched_transfers",
});

User.hasMany(StockTransfer, {
  foreignKey: "received_by",
  as: "received_transfers",
});

/* =========================================================
   REQUEST <-> TRANSFER LINK
========================================================= */

StockRequest.hasOne(StockTransfer, {
  foreignKey: "request_id",
  as: "transfer",
});

StockTransfer.belongsTo(StockRequest, {
  foreignKey: "request_id",
  as: "request",
});

/* =========================================================
   AUDIT TRAIL RELATIONS
========================================================= */

Store.hasMany(AuditTrail, {
  foreignKey: "organization_id",
  as: "audit_trails",
});

AuditTrail.belongsTo(Store, {
  foreignKey: "organization_id",
  as: "organization",
});

Item.hasMany(AuditTrail, {
  foreignKey: "item_id",
  as: "audit_trails",
});

AuditTrail.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

/* =========================================================
   BATCH TRACKING RELATIONS
========================================================= */

InventoryBatch.belongsTo(InventoryBatch, {
  foreignKey: "root_batch_id",
  as: "rootBatch",
});

InventoryBatch.belongsTo(InventoryBatch, {
  foreignKey: "parent_batch_id",
  as: "parentBatch",
});

InventoryBatch.hasMany(InventoryBatch, {
  foreignKey: "parent_batch_id",
  as: "childBatches",
});

InventoryBatch.hasMany(BatchSplit, {
  foreignKey: "root_batch_id",
  as: "root_splits",
});

InventoryBatch.hasMany(BatchSplit, {
  foreignKey: "parent_batch_id",
  as: "parent_splits",
});

InventoryBatch.hasMany(BatchSplit, {
  foreignKey: "child_batch_id",
  as: "child_splits",
});

BatchSplit.belongsTo(InventoryBatch, {
  foreignKey: "root_batch_id",
  as: "rootBatch",
});

BatchSplit.belongsTo(InventoryBatch, {
  foreignKey: "parent_batch_id",
  as: "parentBatch",
});

BatchSplit.belongsTo(InventoryBatch, {
  foreignKey: "child_batch_id",
  as: "childBatch",
});

InventoryBatch.hasMany(BatchTimeline, {
  foreignKey: "batch_id",
  as: "timelines",
});

BatchTimeline.belongsTo(InventoryBatch, {
  foreignKey: "batch_id",
  as: "batch",
});

Item.hasMany(BatchTimeline, {
  foreignKey: "item_id",
  as: "batch_timelines",
});

BatchTimeline.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

StockTransfer.hasMany(TrackingLog, {
  foreignKey: "transfer_id",
  as: "tracking_logs",
});

TrackingLog.belongsTo(StockTransfer, {
  foreignKey: "transfer_id",
  as: "transfer",
});

/* =========================================================
   EXPORTS
========================================================= */

export {
  sequelize,
  User,
  Item,
  Stock,
  StockTransfer,
  StockTransferItem,
  StockMovement,
  StockRequest,
  StockRequestItem,
  AuditTrail,
  Store,
  Customer,
  LedgerEntry,
  Invoice,
  Payment,
  Transaction,
  TransactionEntry,
  InventoryBatch,
  BatchSplit,
  BatchTimeline,
  TrackingLog,
};