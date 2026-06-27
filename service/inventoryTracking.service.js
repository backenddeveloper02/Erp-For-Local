import { QueryTypes } from "sequelize";
import sequelize from "../config/db.js";

const toNumber = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

const cleanId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const cleanText = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
};

const createChildBatchNo = async (parentBatchId, parentBatchNo, transaction) => {
  const rows = await sequelize.query(
    `
    SELECT COUNT(*)::INT AS count
    FROM public.inventory_batches
    WHERE parent_batch_id = :parent_batch_id
    `,
    {
      replacements: { parent_batch_id: parentBatchId },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  const next = toNumber(rows?.[0]?.count) + 1;
  return `${parentBatchNo}-${next}`;  
};

export const InventoryTrackingService = {
  async ensureRootBatch({ batch_id }, { transaction } = {}) {
    const batchId = cleanId(batch_id);

    if (!batchId) {
      throw new Error("Valid batch_id is required");
    }

    const rows = await sequelize.query(
      `
      SELECT
        id,
        root_batch_id,
        parent_batch_id,
        current_organization_id,
        organization_id
      FROM public.inventory_batches
      WHERE id = :batch_id
      FOR UPDATE
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const batch = rows?.[0];

    if (!batch) {
      throw new Error("Batch not found");
    }

    if (!batch.root_batch_id) {
      await sequelize.query(
        `
        UPDATE public.inventory_batches
        SET
          root_batch_id = id,
          parent_batch_id = NULL,
          split_level = 0,
          is_leaf = true,
          current_organization_id = COALESCE(current_organization_id, organization_id),
          updated_at = NOW()
        WHERE id = :batch_id
        `,
        {
          replacements: { batch_id: batchId },
          type: QueryTypes.UPDATE,
          transaction,
        }
      );
    }

    return true;
  },

  async distributeBatch(
    {
      parent_batch_id,
      to_organization_id,
      quantity,
      weight = 0,
      reference_type = "MANUAL_DISTRIBUTION",
      reference_id = null,
      remarks = null,
      handled_by = null,
    },
    { transaction } = {}
  ) {
    const parentBatchId = cleanId(parent_batch_id);
    const toOrgId = cleanId(to_organization_id);
    const qty = toNumber(quantity);
    const wt = toNumber(weight);

    if (!parentBatchId) throw new Error("parent_batch_id is required");
    if (!toOrgId) throw new Error("to_organization_id is required");
    if (qty <= 0) throw new Error("quantity must be greater than 0");

    const parentRows = await sequelize.query(
      `
      SELECT
        id,
        batch_no,
        organization_id,
        item_id,
        current_organization_id,
        root_batch_id,
        parent_batch_id,
        total_qty,
        available_qty,
        total_weight,
        available_weight,
        split_level,
        status
      FROM public.inventory_batches
      WHERE id = :parent_batch_id
      FOR UPDATE
      `,
      {
        replacements: { parent_batch_id: parentBatchId },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const parent = parentRows?.[0];

    if (!parent) {
      throw new Error("Parent batch not found");
    }

    const parentAvailableQty = toNumber(parent.available_qty);
    const parentAvailableWeight = toNumber(parent.available_weight);

    if (parentAvailableQty < qty) {
      throw new Error(
        `Insufficient batch quantity. Available: ${parentAvailableQty}, requested: ${qty}`
      );
    }

    if (wt > 0 && parentAvailableWeight < wt) {
      throw new Error(
        `Insufficient batch weight. Available: ${parentAvailableWeight}, requested: ${wt}`
      );
    }

    const rootBatchId = cleanId(parent.root_batch_id) || parent.id;
    const fromOrgId =
      cleanId(parent.current_organization_id) || cleanId(parent.organization_id);

    const childBatchNo = await createChildBatchNo(
      parent.id,
      parent.batch_no,
      transaction
    );

    const childRows = await sequelize.query(
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
        NULL,
        :current_organization_id,
        :total_qty,
        :available_qty,
        :total_weight,
        :available_weight,
        'delivered',
        :remarks,
        :created_by,
        :root_batch_id,
        :parent_batch_id,
        :split_level,
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
          batch_no: childBatchNo,
          organization_id: toOrgId,
          item_id: parent.item_id,
          current_organization_id: toOrgId,
          total_qty: qty,
          available_qty: qty,
          total_weight: wt,
          available_weight: wt,
          remarks: cleanText(remarks),
          created_by: cleanId(handled_by),
          root_batch_id: rootBatchId,
          parent_batch_id: parent.id,
          split_level: toNumber(parent.split_level) + 1,
          source_type: cleanText(reference_type),
          source_reference_id: cleanId(reference_id),
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const childBatch = childRows[0];

    await sequelize.query(
      `
      UPDATE public.inventory_batches
      SET
        available_qty = available_qty - :quantity,
        available_weight = CASE
          WHEN :weight > 0 THEN available_weight - :weight
          ELSE available_weight
        END,
        is_leaf = false,
        status = CASE
          WHEN available_qty - :quantity > 0 THEN 'partial'
          ELSE 'delivered'
        END,
        updated_at = NOW()
      WHERE id = :parent_batch_id
      `,
      {
        replacements: {
          parent_batch_id: parent.id,
          quantity: qty,
          weight: wt,
        },
        type: QueryTypes.UPDATE,
        transaction,
      }
    );

    await sequelize.query(
      `
      INSERT INTO public.batch_splits (
        root_batch_id,
        parent_batch_id,
        child_batch_id,
        item_id,
        from_organization_id,
        to_organization_id,
        quantity,
        weight,
        reference_type,
        reference_id,
        remarks,
        created_by,
        created_at
      )
      VALUES (
        :root_batch_id,
        :parent_batch_id,
        :child_batch_id,
        :item_id,
        :from_organization_id,
        :to_organization_id,
        :quantity,
        :weight,
        :reference_type,
        :reference_id,
        :remarks,
        :created_by,
        NOW()
      )
      `,
      {
        replacements: {
          root_batch_id: rootBatchId,
          parent_batch_id: parent.id,
          child_batch_id: childBatch.id,
          item_id: parent.item_id,
          from_organization_id: fromOrgId,
          to_organization_id: toOrgId,
          quantity: qty,
          weight: wt,
          reference_type: cleanText(reference_type),
          reference_id: cleanId(reference_id),
          remarks: cleanText(remarks),
          created_by: cleanId(handled_by),
        },
        type: QueryTypes.INSERT,
        transaction,
      }
    );

    return childBatch;
  },

  async consumeBatch(
    {
      batch_id,
      quantity,
      weight = 0,
      event_type = "SOLD",
      reference_type = "INVOICE",
      reference_id = null,
      remarks = null,
      handled_by = null,
    },
    { transaction } = {}
  ) {
    const batchId = cleanId(batch_id);
    const qty = toNumber(quantity);
    const wt = toNumber(weight);

    if (!batchId) throw new Error("batch_id is required");
    if (qty <= 0) throw new Error("quantity must be greater than 0");

    const rows = await sequelize.query(
      `
      SELECT id, available_qty, available_weight
      FROM public.inventory_batches
      WHERE id = :batch_id
      FOR UPDATE
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const batch = rows?.[0];

    if (!batch) throw new Error("Batch not found");

    if (toNumber(batch.available_qty) < qty) {
      throw new Error(
        `Insufficient quantity. Available: ${batch.available_qty}, requested: ${qty}`
      );
    }

    await sequelize.query(
      `
      UPDATE public.inventory_batches
      SET
        available_qty = available_qty - :quantity,
        available_weight = CASE
          WHEN :weight > 0 THEN available_weight - :weight
          ELSE available_weight
        END,
        status = CASE
          WHEN available_qty - :quantity <= 0 THEN
            CASE
              WHEN :event_type = 'SOLD' THEN 'sold'
              WHEN :event_type = 'DAMAGED' THEN 'damaged'
              WHEN :event_type = 'DEAD' THEN 'dead'
              ELSE status
            END
          ELSE status
        END,
        updated_at = NOW()
      WHERE id = :batch_id
      `,
      {
        replacements: {
          batch_id: batchId,
          quantity: qty,
          weight: wt,
          event_type,
        },
        type: QueryTypes.UPDATE,
        transaction,
      }
    );

    return true;
  },
};