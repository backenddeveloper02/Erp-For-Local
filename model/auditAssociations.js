import InventoryAudit from "./inventoryAudit.js";
import InventoryAuditItem from "./inventoryAuditItem.js";
import InventoryAuditFollowup from "./inventoryAuditFollowup.js";

import Item from "./item.js";

// Audit -> items
InventoryAudit.hasMany(InventoryAuditItem, {
  foreignKey: "audit_id",
  as: "audit_items",
});

InventoryAuditItem.belongsTo(InventoryAudit, {
  foreignKey: "audit_id",
  as: "audit",
});

// Audit -> followups
InventoryAudit.hasMany(InventoryAuditFollowup, {
  foreignKey: "audit_id",
  as: "followups",
});

InventoryAuditFollowup.belongsTo(InventoryAudit, {
  foreignKey: "audit_id",
  as: "audit",
});

// Audit item -> followups
InventoryAuditItem.hasMany(InventoryAuditFollowup, {
  foreignKey: "audit_item_id",
  as: "followups",
});

InventoryAuditFollowup.belongsTo(InventoryAuditItem, {
  foreignKey: "audit_item_id",
  as: "audit_item",
});

// Item -> audit entries
InventoryAuditItem.belongsTo(Item, {
  foreignKey: "item_id",
  as: "item",
});

Item.hasMany(InventoryAuditItem, {
  foreignKey: "item_id",
  as: "audit_entries",
});
InventoryAudit.hasMany(InventoryAuditItem, {
  foreignKey: "audit_id",
  as: "audit_items",
});

InventoryAuditItem.belongsTo(InventoryAudit, {
  foreignKey: "audit_id",
  as: "audit",
});
export {
  InventoryAudit,
  InventoryAuditItem,
  InventoryAuditFollowup,
};