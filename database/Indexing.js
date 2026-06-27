const sequelize = require("../config/db");

const Organization = require("../modules/organizations/organization.model");
const User = require("../modules/users/user.model");
const Item = require("../modules/items/item.model");
const Stock = require("../modules/stock/stock.model");
const StockMovement = require("../modules/stock/stockMovement.model");
const StockRequest = require("../modules/stock-requests/stockRequest.model");
const StockRequestItem = require("../modules/stock-requests/stockRequestItem.model");
const StockTransfer = require("../modules/stock-transfers/stockTransfer.model");
const StockTransferItem = require("../modules/stock-transfers/stockTransferItem.model");

/* ================= ORGANIZATION RELATIONS ================= */

Organization.belongsTo(Organization, {
  foreignKey: "parent_id",
  as: "parent"
});

Organization.hasMany(Organization, {
  foreignKey: "parent_id",
  as: "children"
});

/* ================= USER RELATIONS ================= */

User.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization"
});

Organization.hasMany(User, {
  foreignKey: "organization_id",
  as: "users"
});

/* ================= STOCK RELATIONS ================= */

Stock.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization"
});

Stock.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item"
});

Organization.hasMany(Stock, {
  foreignKey: "organization_id",
  as: "stocks"
});

Item.hasMany(Stock, {
  foreignKey: "item_id",
  as: "stocks"
});

/* ================= STOCK MOVEMENT RELATIONS ================= */

StockMovement.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization"
});

StockMovement.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item"
});

Item.hasMany(StockMovement, {
  foreignKey: "item_id",
  as: "stockMovements"
});

Organization.hasMany(StockMovement, {
  foreignKey: "organization_id",
  as: "stockMovements"
});

/* ================= STOCK REQUEST RELATIONS ================= */

StockRequest.belongsTo(Organization, {
  foreignKey: "from_organization_id",
  as: "fromOrganization"
});

StockRequest.belongsTo(Organization, {
  foreignKey: "to_organization_id",
  as: "toOrganization"
});

StockRequest.hasMany(StockRequestItem, {
  foreignKey: "request_id",
  as: "items"
});

StockRequestItem.belongsTo(StockRequest, {
  foreignKey: "request_id",
  as: "request"
});

StockRequestItem.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item"
});

/* ================= STOCK TRANSFER RELATIONS ================= */

StockTransfer.belongsTo(StockRequest, {
  foreignKey: "request_id",
  as: "request"
});

StockTransfer.belongsTo(Organization, {
  foreignKey: "from_organization_id",
  as: "fromOrganization"
});

StockTransfer.belongsTo(Organization, {
  foreignKey: "to_organization_id",
  as: "toOrganization"
});

StockTransfer.hasMany(StockTransferItem, {
  foreignKey: "transfer_id",
  as: "items"
});

StockTransferItem.belongsTo(StockTransfer, {
  foreignKey: "transfer_id",
  as: "transfer"
});

StockTransferItem.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item"
});

module.exports = {
  sequelize,
  Organization,
  User,
  Item,
  Stock,
  StockMovement,
  StockRequest,
  StockRequestItem,
  StockTransfer,
  StockTransferItem
};