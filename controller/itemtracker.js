import { QueryTypes } from "sequelize";
import sequelize from "../../config/db.js";
import { InventoryTrackingService } from "../../service/inventoryTracking.service.js";


const fetchBatchMovementHistory = async (rootBatchId) => {
  const rows = await sequelize.query(
    `
    SELECT
      bs.id AS split_id,
      bs.root_batch_id,

      bs.parent_batch_id,
      parent_batch.batch_no AS parent_batch_no,

      bs.child_batch_id,
      child_batch.batch_no AS child_batch_no,

      bs.item_id,

      bs.from_organization_id,
      from_store.store_name AS from_store_name,
      from_store.store_code AS from_store_code,
      from_store.organization_level AS from_organization_level,

      bs.to_organization_id,
      to_store.store_name AS to_store_name,
      to_store.store_code AS to_store_code,
      to_store.organization_level AS to_organization_level,

      bs.quantity,
      bs.weight,
      bs.reference_type,
      bs.reference_id,
      bs.remarks,
      bs.created_by,
      bs.created_at

    FROM public.batch_splits bs

    LEFT JOIN public.inventory_batches parent_batch
      ON parent_batch.id = bs.parent_batch_id

    LEFT JOIN public.inventory_batches child_batch
      ON child_batch.id = bs.child_batch_id

    LEFT JOIN public.stores from_store
      ON from_store.id = bs.from_organization_id

    LEFT JOIN public.stores to_store
      ON to_store.id = bs.to_organization_id

    WHERE bs.root_batch_id = :root_batch_id

    ORDER BY bs.created_at ASC, bs.id ASC
    `,
    {
      replacements: { root_batch_id: rootBatchId },
      type: QueryTypes.SELECT,
    }
  );

  return rows.map(formatMovementHistory);
};
const toNumber = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

const toPositiveInt = (value, fallback = 1) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const cleanText = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const cleanPositiveIntOrNull = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Supports:
 * date_from=2026-05-14
 * date_to=2026-05-14
 * date_from=2026-05-14T00:00:00.000Z
 * date_to=2026-05-14T23:59:59.999Z
 */
const normalizeDateFrom = (value) => {
  const text = cleanText(value);
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00:00.000Z`;
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const normalizeDateTo = (value) => {
  const text = cleanText(value);
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T23:59:59.999Z`;
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const formatDestination = (d) => ({
  organization_id: d.organization_id ? Number(d.organization_id) : null,
  store_name: d.store_name || "Unknown Location",
  store_code: d.store_code || null,
  organization_level: d.organization_level || null,
  quantity: toNumber(d.quantity),
  weight: toNumber(d.weight),
  last_updated_at: d.last_updated_at || null,
  batch_nodes: Array.isArray(d.batch_nodes) ? d.batch_nodes : [],
});

const formatBatchNode = (b) => ({
  batch_id: Number(b.batch_id),
  batch_no: b.batch_no,
  root_batch_id: b.root_batch_id ? Number(b.root_batch_id) : null,
  parent_batch_id: b.parent_batch_id ? Number(b.parent_batch_id) : null,
  item_id: Number(b.item_id),

  organization_id: b.organization_id ? Number(b.organization_id) : null,
  store_name: b.store_name || "Unknown Location",
  store_code: b.store_code || null,
  organization_level: b.organization_level || null,

  total_qty: toNumber(b.total_qty),
  available_qty: toNumber(b.available_qty),
  total_weight: toNumber(b.total_weight),
  available_weight: toNumber(b.available_weight),
  split_level: toNumber(b.split_level),
  status: b.status,
  created_at: b.created_at,
  updated_at: b.updated_at,
});

const formatMovementHistory = (m, index) => ({
  step: index + 1,
  type: "batch_distributed",
  title:
    m.to_organization_level?.toLowerCase?.().includes("retail")
      ? "Delivered to Store"
      : "Delivered to District",

  split_id: Number(m.split_id),
  root_batch_id: Number(m.root_batch_id),

  parent_batch_id: Number(m.parent_batch_id),
  parent_batch_no: m.parent_batch_no,

  child_batch_id: Number(m.child_batch_id),
  child_batch_no: m.child_batch_no,

  item_id: Number(m.item_id),

  from_organization_id: m.from_organization_id
    ? Number(m.from_organization_id)
    : null,
  from_store_name: m.from_store_name || "Unknown Location",
  from_store_code: m.from_store_code || null,
  from_organization_level: m.from_organization_level || null,

  to_organization_id: m.to_organization_id ? Number(m.to_organization_id) : null,
  to_store_name: m.to_store_name || "Unknown Location",
  to_store_code: m.to_store_code || null,
  to_organization_level: m.to_organization_level || null,

  quantity: toNumber(m.quantity),
  weight: toNumber(m.weight),

  reference_type: m.reference_type || null,
  reference_id: m.reference_id ? Number(m.reference_id) : null,
  remarks: m.remarks || null,
  handled_by: m.created_by ? Number(m.created_by) : null,
  created_at: m.created_at,
});

export const getTrackerItems = async (req, res) => {
  try {
    const search = cleanText(req.query.search);
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;

    const rows = await sequelize.query(
      `
      WITH root_batches AS (
        SELECT *
        FROM public.inventory_batches
        WHERE parent_batch_id IS NULL
      ),
      batch_current AS (
        SELECT
          COALESCE(root_batch_id, id) AS effective_root_batch_id,
          SUM(COALESCE(available_qty, 0)) AS current_available_qty,
          COUNT(DISTINCT current_organization_id) FILTER (
            WHERE COALESCE(available_qty, 0) > 0
          ) AS location_count
        FROM public.inventory_batches
        GROUP BY COALESCE(root_batch_id, id)
      )
      SELECT
        i.id AS item_id,
        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,
        i.current_status,

        COUNT(DISTINCT rb.id)::INT AS batch_count,
        COALESCE(SUM(rb.total_qty), 0) AS total_qty,
        COALESCE(SUM(bc.current_available_qty), 0) AS available_qty,
        COALESCE(SUM(bc.location_count), 0)::INT AS total_location_count

      FROM public.items i

      LEFT JOIN root_batches rb
        ON rb.item_id = i.id

      LEFT JOIN batch_current bc
        ON bc.effective_root_batch_id = rb.id

      WHERE
        COALESCE(i.is_active, true) = true
        AND (
          :search = ''
          OR i.item_name ILIKE :searchLike
          OR i.article_code ILIKE :searchLike
          OR i.sku_code ILIKE :searchLike
          OR i.category ILIKE :searchLike
        )

      GROUP BY
        i.id,
        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,
        i.current_status

      ORDER BY i."createdAt" DESC NULLS LAST, i.id DESC

      LIMIT :limit
      OFFSET :offset
      `,
      {
        replacements: {
          search,
          searchLike: `%${search}%`,
          limit,
          offset,
        },
        type: QueryTypes.SELECT,
      }
    );

    const countRows = await sequelize.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM public.items i
      WHERE
        COALESCE(i.is_active, true) = true
        AND (
          :search = ''
          OR i.item_name ILIKE :searchLike
          OR i.article_code ILIKE :searchLike
          OR i.sku_code ILIKE :searchLike
          OR i.category ILIKE :searchLike
        )
      `,
      {
        replacements: {
          search,
          searchLike: `%${search}%`,
        },
        type: QueryTypes.SELECT,
      }
    );

    const total = toNumber(countRows?.[0]?.total);

    return res.status(200).json({
      success: true,
      message: "Tracker items fetched successfully",
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: rows.length,
      data: rows.map((item) => ({
        ...item,
        item_id: Number(item.item_id),
        batch_count: toNumber(item.batch_count),
        total_qty: toNumber(item.total_qty),
        available_qty: toNumber(item.available_qty),
        total_location_count: toNumber(item.total_location_count),
      })),
    });
  } catch (error) {
    console.error("getTrackerItems error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tracker items",
      error: error.message,
    });
  }
};

export const getItemTrackerBatches = async (req, res) => {
  try {
    const itemId = Number(req.params.item_id);

    const dateFrom = normalizeDateFrom(req.query.date_from || req.query.from);
    const dateTo = normalizeDateTo(req.query.date_to || req.query.to);
    const search = String(req.query.search || req.query.batch_no || "").trim();

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid item_id is required",
      });
    }

    const whereClauses = [
      "b.item_id = :item_id",
      "b.parent_batch_id IS NULL",
      "COALESCE(i.is_active, true) = true",
    ];

    const replacements = {
      item_id: itemId,
      date_from: dateFrom,
      date_to: dateTo,
      search,
      searchLike: `%${search}%`,
      limit,
      offset,
    };

    if (dateFrom) {
      whereClauses.push("b.created_at >= :date_from::timestamptz");
    }

    if (dateTo) {
      whereClauses.push("b.created_at <= :date_to::timestamptz");
    }

    if (search) {
      whereClauses.push(`
        (
          b.batch_no ILIKE :searchLike
          OR i.item_name ILIKE :searchLike
          OR i.article_code ILIKE :searchLike
          OR i.sku_code ILIKE :searchLike
        )
      `);
    }

    const whereSql = whereClauses.join(" AND ");

    const rows = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,
        COALESCE(b.root_batch_id, b.id) AS root_batch_id,
        b.parent_batch_id,

        b.organization_id,
        b.current_organization_id,

        b.total_qty,
        b.available_qty,
        b.total_weight,
        b.available_weight,

        b.status,
        b.created_at,
        b.updated_at,

        i.id AS item_id,
        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,

        st.store_name AS current_store_name,
        st.store_code AS current_store_code,
        st.organization_level AS current_organization_level,

        COALESCE(dest.location_count, 0)::INT AS location_count,
        COALESCE(dest.current_total_qty, 0) AS current_total_qty,
        COALESCE(dest.current_total_weight, 0) AS current_total_weight

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT cb.current_organization_id) FILTER (
            WHERE COALESCE(cb.available_qty, 0) > 0
          ) AS location_count,
          SUM(COALESCE(cb.available_qty, 0)) AS current_total_qty,
          SUM(COALESCE(cb.available_weight, 0)) AS current_total_weight
        FROM public.inventory_batches cb
        WHERE
          (
            cb.root_batch_id = b.id
            OR cb.id = b.id
          )
          AND COALESCE(cb.available_qty, 0) > 0
      ) dest ON TRUE

      WHERE ${whereSql}

      ORDER BY b.created_at DESC NULLS LAST, b.id DESC

      LIMIT :limit
      OFFSET :offset
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const countRows = await sequelize.query(
      `
      SELECT COUNT(*)::INT AS total

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE ${whereSql}
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const total = toNumber(countRows?.[0]?.total);

    return res.status(200).json({
      success: true,
      message: "Item tracker batches fetched successfully",
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: rows.length,
      data: rows.map((b) => ({
        batch_id: Number(b.batch_id),
        batch_no: b.batch_no,

        root_batch_id: b.root_batch_id ? Number(b.root_batch_id) : null,
        parent_batch_id: b.parent_batch_id ? Number(b.parent_batch_id) : null,

        item_id: Number(b.item_id),
        item_name: b.item_name,
        article_code: b.article_code,
        sku_code: b.sku_code,
        category: b.category,
        metal_type: b.metal_type,
        purity: b.purity,

        organization_id: b.organization_id ? Number(b.organization_id) : null,
        current_organization_id: b.current_organization_id
          ? Number(b.current_organization_id)
          : null,

        current_store_name: b.current_store_name || "Unknown Location",
        current_store_code: b.current_store_code || null,
        current_organization_level: b.current_organization_level || null,

        total_qty: toNumber(b.total_qty),
        available_qty: toNumber(b.available_qty),
        total_weight: toNumber(b.total_weight),
        available_weight: toNumber(b.available_weight),

        location_count: toNumber(b.location_count),
        current_total_qty: toNumber(b.current_total_qty),
        current_total_weight: toNumber(b.current_total_weight),

        status: b.status,
        created_at: b.created_at,
        updated_at: b.updated_at,
      })),
    });
  } catch (error) {
    console.error("getItemTrackerBatches error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch item tracker batches",
      error: error.message,
    });
  }
};

export const distributeBatch = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { parent_batch_id, destinations } = req.body;

    if (!parent_batch_id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "parent_batch_id is required",
      });
    }

    if (!Array.isArray(destinations) || destinations.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "destinations array is required",
      });
    }

    const created = [];

    for (const destination of destinations) {
      const childBatch = await InventoryTrackingService.distributeBatch(
        {
          parent_batch_id,
          to_organization_id: destination.to_organization_id,
          quantity: destination.quantity,
          weight: destination.weight || 0,
          reference_type: destination.reference_type || "MANUAL_DISTRIBUTION",
          reference_id: destination.reference_id || null,
          remarks: destination.remarks || "Batch distributed",
          handled_by: req.user?.id || null,
        },
        { transaction }
      );

      created.push(childBatch);
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Batch distributed successfully",
      count: created.length,
      data: created,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("distributeBatch error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to distribute batch",
      error: error.message,
    });
  }
};

export const getBatchFinalDestinations = async (req, res) => {
  try {
    const batchId = Number(req.params.batch_id);

    if (!Number.isInteger(batchId) || batchId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid batch_id is required",
      });
    }

    const batchRows = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,
        b.root_batch_id,
        b.parent_batch_id,
        b.item_id,
        b.total_qty,
        b.available_qty,
        b.total_weight,
        b.available_weight,
        b.status,
        b.created_at,
        b.updated_at,

        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      WHERE b.id = :batch_id

      LIMIT 1
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
      }
    );

    const batch = batchRows?.[0];

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    const rootBatchId = Number(batch.root_batch_id || batch.batch_id);

  const destinations = await sequelize.query(
  `
  SELECT
    b.current_organization_id AS organization_id,

    st.store_name,
    st.store_code,
    st.organization_level,
    st.address,

    SUM(COALESCE(b.available_qty, 0)) AS quantity,
    SUM(COALESCE(b.available_weight, 0)) AS weight,

    MAX(b.updated_at) AS last_updated_at,

   JSONB_AGG(
  JSONB_BUILD_OBJECT(
    'batch_id', b.id,
    'batch_no', b.batch_no,
    'parent_batch_id', b.parent_batch_id,
    'root_batch_id', b.root_batch_id,
    'quantity', b.available_qty,
    'weight', b.available_weight,
    'split_level', b.split_level,
    'status', b.status
  )
) AS batch_nodes

  FROM public.inventory_batches b

  LEFT JOIN public.stores st
    ON st.id = b.current_organization_id

  WHERE
    (
      b.root_batch_id = :root_batch_id
      OR b.id = :root_batch_id
    )
    AND COALESCE(b.available_qty, 0) > 0

  GROUP BY
    b.current_organization_id,
    st.store_name,
    st.store_code,
    st.organization_level,
    st.address

  ORDER BY st.store_name ASC NULLS LAST
  `,
  {
    replacements: { root_batch_id: rootBatchId },
    type: QueryTypes.SELECT,
  }
);

    const movementRows = await sequelize.query(
      `
      SELECT
        bs.id AS split_id,
        bs.root_batch_id,
        bs.parent_batch_id,
        pb.batch_no AS parent_batch_no,
        bs.child_batch_id,
        cb.batch_no AS child_batch_no,
        bs.item_id,

        bs.from_organization_id,
        from_store.store_name AS from_store_name,
        from_store.store_code AS from_store_code,
        from_store.organization_level AS from_organization_level,

        bs.to_organization_id,
        to_store.store_name AS to_store_name,
        to_store.store_code AS to_store_code,
        to_store.organization_level AS to_organization_level,
        
        bs.quantity,
        bs.weight,
        bs.reference_type,
        bs.reference_id,
        bs.remarks,
        bs.created_by,
        bs.created_at

      FROM public.batch_splits bs

      LEFT JOIN public.inventory_batches pb
        ON pb.id = bs.parent_batch_id

      LEFT JOIN public.inventory_batches cb
        ON cb.id = bs.child_batch_id

      LEFT JOIN public.stores from_store
        ON from_store.id = bs.from_organization_id

      LEFT JOIN public.stores to_store
        ON to_store.id = bs.to_organization_id

      WHERE bs.root_batch_id = :root_batch_id

      ORDER BY bs.created_at ASC, bs.id ASC
      `,
      {
        replacements: { root_batch_id: rootBatchId },
        type: QueryTypes.SELECT,
      }
    );

    const finalDestinations = destinations.map(formatDestination);
    const movementHistory = movementRows.map(formatMovementHistory);

    return res.status(200).json({
      success: true,
      message: "Batch final destinations fetched successfully",
      data: {
        batch: {
          batch_id: Number(batch.batch_id),
          batch_no: batch.batch_no,
          item_id: Number(batch.item_id),
          item_name: batch.item_name,
          article_code: batch.article_code,
          sku_code: batch.sku_code,
          category: batch.category,
          metal_type: batch.metal_type,
          purity: batch.purity,
          total_qty: toNumber(batch.total_qty),
          available_qty: toNumber(batch.available_qty),
          total_weight: toNumber(batch.total_weight),
          available_weight: toNumber(batch.available_weight),
          status: batch.status,
          created_at: batch.created_at,
          updated_at: batch.updated_at,
        },
        summary: {
          root_batch_id: rootBatchId,
          total_qty: toNumber(batch.total_qty),
          total_weight: toNumber(batch.total_weight),
          current_available_qty: finalDestinations.reduce(
            (sum, d) => sum + d.quantity,
            0
          ),
          current_available_weight: finalDestinations.reduce(
            (sum, d) => sum + d.weight,
            0
          ),
          location_count: finalDestinations.length,
          movement_count: movementHistory.length,
        },
        final_destinations: finalDestinations,
        movement_history: movementHistory,
      },
    });
  } catch (error) {
  console.error("ERROR MESSAGE:", error?.message);
  console.error("ERROR POSITION:", error?.parent?.position);
  console.error("ERROR SQL:", error?.sql);

  return res.status(500).json({
    success: false,
    message: "Failed to fetch batch final destinations",
    error: error.message,
    position: error?.parent?.position,
  });
}
};
export const getBatchNodeRoute = async (req, res) => {
  try {
    const batchId = Number(req.params.batch_id);

    if (!Number.isInteger(batchId) || batchId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid batch_id is required",
      });
    }

    const route = await sequelize.query(
      `
      WITH RECURSIVE route_cte AS (
        SELECT
          b.id,
          b.batch_no,
          b.root_batch_id,
          b.parent_batch_id,
          b.item_id,
          b.current_organization_id,
          b.total_qty,
          b.available_qty,
          b.total_weight,
          b.available_weight,
          b.split_level,
          b.status,
          b.created_at,
          b.updated_at
        FROM public.inventory_batches b
        WHERE b.id = :batch_id

        UNION ALL

        SELECT
          p.id,
          p.batch_no,
          p.root_batch_id,
          p.parent_batch_id,
          p.item_id,
          p.current_organization_id,
          p.total_qty,
          p.available_qty,
          p.total_weight,
          p.available_weight,
          p.split_level,
          p.status,
          p.created_at,
          p.updated_at
        FROM public.inventory_batches p
        INNER JOIN route_cte r
          ON r.parent_batch_id = p.id
      )

      SELECT
        r.id AS batch_id,
        r.batch_no,
        r.root_batch_id,
        r.parent_batch_id,
        r.item_id,
        r.current_organization_id AS organization_id,

        st.store_name,
        st.store_code,
        st.organization_level,

        r.total_qty,
        r.available_qty,
        r.total_weight,
        r.available_weight,
        r.split_level,
        r.status,
        r.created_at,
        r.updated_at

      FROM route_cte r

      LEFT JOIN public.stores st
        ON st.id = r.current_organization_id

      ORDER BY COALESCE(r.split_level, 0) ASC, r.id ASC
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Batch route fetched successfully",
      count: route.length,
      data: route.map(formatBatchNode),
    });
  } catch (error) {
    console.error("getBatchNodeRoute error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch route",
      error: error.message,
    });
  }
};

export const searchBatchTracker = async (req, res) => {
  try {
    const batchNo = cleanText(req.query.batch_no || req.query.search);

    if (!batchNo) {
      return res.status(400).json({
        success: false,
        message: "batch_no is required",
      });
    }

    const searchedRows = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,
        b.root_batch_id,
        b.parent_batch_id,
        b.item_id,
        b.current_organization_id,
        b.total_qty,
        b.available_qty,
        b.total_weight,
        b.available_weight,
        b.status,
        b.created_at,
        b.updated_at,

        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,

        st.store_name AS current_store_name,
        st.store_code AS current_store_code,
        st.organization_level AS current_organization_level

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE b.batch_no = :batch_no

      LIMIT 1
      `,
      {
        replacements: { batch_no: batchNo },
        type: QueryTypes.SELECT,
      }
    );

    const searchedBatch = searchedRows?.[0];

    if (!searchedBatch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    const rootBatchId = Number(
      searchedBatch.root_batch_id || searchedBatch.batch_id
    );

    const rootRows = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,
        b.root_batch_id,
        b.parent_batch_id,
        b.item_id,
        b.current_organization_id,
        b.total_qty,
        b.available_qty,
        b.total_weight,
        b.available_weight,
        b.status,
        b.created_at,
        b.updated_at,

        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,

        st.store_name AS current_store_name,
        st.store_code AS current_store_code,
        st.organization_level AS current_organization_level

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE b.id = :root_batch_id

      LIMIT 1
      `,
      {
        replacements: { root_batch_id: rootBatchId },
        type: QueryTypes.SELECT,
      }
    );

    const rootBatch = rootRows?.[0];

    const batchNodes = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,
        b.root_batch_id,
        b.parent_batch_id,
        b.item_id,
        b.current_organization_id AS organization_id,

        st.store_name,
        st.store_code,
        st.organization_level,

        b.total_qty,
        b.available_qty,
        b.total_weight,
        b.available_weight,
        b.split_level,
        b.status,
        b.created_at,
        b.updated_at

      FROM public.inventory_batches b

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE
        b.root_batch_id = :root_batch_id
        OR b.id = :root_batch_id

      ORDER BY
        COALESCE(b.split_level, 0) ASC,
        b.id ASC
      `,
      {
        replacements: { root_batch_id: rootBatchId },
        type: QueryTypes.SELECT,
      }
    );

    const destinations = await sequelize.query(
      `
      SELECT
        b.current_organization_id AS organization_id,

        st.store_name,
        st.store_code,
        st.organization_level,

        SUM(COALESCE(b.available_qty, 0)) AS quantity,
        SUM(COALESCE(b.available_weight, 0)) AS weight,

        MAX(b.updated_at) AS last_updated_at,

        JSON_AGG(
          JSON_BUILD_OBJECT(
            'batch_id', b.id,
            'batch_no', b.batch_no,
            'parent_batch_id', b.parent_batch_id,
            'root_batch_id', b.root_batch_id,
            'quantity', b.available_qty,
            'weight', b.available_weight,
            'split_level', b.split_level,
            'status', b.status
          )
          ORDER BY COALESCE(b.split_level, 0) ASC, b.id ASC
        ) AS batch_nodes

      FROM public.inventory_batches b

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE
        (
          b.root_batch_id = :root_batch_id
          OR b.id = :root_batch_id
        )
        AND COALESCE(b.available_qty, 0) > 0

      GROUP BY
        b.current_organization_id,
        st.store_name,
        st.store_code,
        st.organization_level

      ORDER BY st.store_name ASC NULLS LAST
      `,
      {
        replacements: { root_batch_id: rootBatchId },
        type: QueryTypes.SELECT,
      }
    );

    const movementRows = await sequelize.query(
      `
      SELECT
        bs.id AS split_id,
        bs.root_batch_id,
        bs.parent_batch_id,
        pb.batch_no AS parent_batch_no,
        bs.child_batch_id,
        cb.batch_no AS child_batch_no,
        bs.item_id,

        bs.from_organization_id,
        from_store.store_name AS from_store_name,
        from_store.store_code AS from_store_code,
        from_store.organization_level AS from_organization_level,

        bs.to_organization_id,
        to_store.store_name AS to_store_name,
        to_store.store_code AS to_store_code,
        to_store.organization_level AS to_organization_level,

        bs.quantity,
        bs.weight,
        bs.reference_type,
        bs.reference_id,
        bs.remarks,
        bs.created_by,
        bs.created_at

      FROM public.batch_splits bs

      LEFT JOIN public.inventory_batches pb
        ON pb.id = bs.parent_batch_id

      LEFT JOIN public.inventory_batches cb
        ON cb.id = bs.child_batch_id

      LEFT JOIN public.stores from_store
        ON from_store.id = bs.from_organization_id

      LEFT JOIN public.stores to_store
        ON to_store.id = bs.to_organization_id

      WHERE bs.root_batch_id = :root_batch_id

      ORDER BY bs.created_at ASC, bs.id ASC
      `,
      {
        replacements: { root_batch_id: rootBatchId },
        type: QueryTypes.SELECT,
      }
    );

    const formattedDestinations = destinations.map(formatDestination);
    const movementHistory = movementRows.map(formatMovementHistory);

    const currentAvailableQty = formattedDestinations.reduce(
      (sum, d) => sum + d.quantity,
      0
    );

    const currentAvailableWeight = formattedDestinations.reduce(
      (sum, d) => sum + d.weight,
      0
    );

    return res.status(200).json({
      success: true,
      message: "Batch tracker fetched successfully",
      data: {
        searched_batch: {
          batch_id: Number(searchedBatch.batch_id),
          batch_no: searchedBatch.batch_no,
          is_root_batch: Number(searchedBatch.batch_id) === rootBatchId,
          root_batch_id: rootBatchId,
          parent_batch_id: searchedBatch.parent_batch_id
            ? Number(searchedBatch.parent_batch_id)
            : null,
        },

        root_batch: rootBatch
          ? {
              batch_id: Number(rootBatch.batch_id),
              batch_no: rootBatch.batch_no,
              root_batch_id: rootBatch.root_batch_id
                ? Number(rootBatch.root_batch_id)
                : Number(rootBatch.batch_id),
              parent_batch_id: rootBatch.parent_batch_id
                ? Number(rootBatch.parent_batch_id)
                : null,

              item_id: Number(rootBatch.item_id),
              item_name: rootBatch.item_name,
              article_code: rootBatch.article_code,
              sku_code: rootBatch.sku_code,
              category: rootBatch.category,
              metal_type: rootBatch.metal_type,
              purity: rootBatch.purity,

              total_qty: toNumber(rootBatch.total_qty),
              available_qty: toNumber(rootBatch.available_qty),
              total_weight: toNumber(rootBatch.total_weight),
              available_weight: toNumber(rootBatch.available_weight),

              current_store_name: rootBatch.current_store_name,
              current_store_code: rootBatch.current_store_code,
              current_organization_level:
                rootBatch.current_organization_level,

              status: rootBatch.status,
              created_at: rootBatch.created_at,
              updated_at: rootBatch.updated_at,
            }
          : null,

        summary: {
          root_batch_id: rootBatchId,
          total_batch_nodes: batchNodes.length,
          total_qty: toNumber(rootBatch?.total_qty),
          total_weight: toNumber(rootBatch?.total_weight),
          current_available_qty: currentAvailableQty,
          current_available_weight: currentAvailableWeight,
          location_count: formattedDestinations.length,
          movement_count: movementHistory.length,
        },

        /**
         * For your UI cards:
         * "Is root batch ki quantity abhi kaha-kaha bachi hui hai"
         */
        current_distribution: formattedDestinations,
        final_destinations: formattedDestinations,

        /**
         * Technical tree from inventory_batches
         */
        batch_nodes: batchNodes.map(formatBatchNode),

        /**
         * Proper progress timeline from batch_splits
         */
        movement_history: movementHistory,

        /**
         * Keep old key for frontend backward compatibility.
         * Now this is also movement history.
         */
        timeline: movementHistory,
      },
    });
  } catch (error) {
    console.error("searchBatchTracker error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch tracker",
      error: error.message,
    });
  }
};

export const getAllTrackerBatches = async (req, res) => {
  try {
    const search = cleanText(req.query.search);
    const storeCode = cleanText(req.query.store_code);
    const status = cleanText(req.query.status);

    const organizationId = cleanPositiveIntOrNull(req.query.organization_id);
    const itemId = cleanPositiveIntOrNull(req.query.item_id);

    const dateFrom = normalizeDateFrom(req.query.date_from || req.query.from);
    const dateTo = normalizeDateTo(req.query.date_to || req.query.to);

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 50), 200);
    const offset = (page - 1) * limit;

    const whereClauses = [
      "1 = 1",
      "COALESCE(i.is_active, true) = true",
    ];

    const replacements = {
      search,
      searchLike: `%${search}%`,
      store_code: storeCode,
      status,
      organization_id: organizationId,
      item_id: itemId,
      date_from: dateFrom,
      date_to: dateTo,
      limit,
      offset,
    };

    if (search) {
      whereClauses.push(`
        (
          b.batch_no ILIKE :searchLike
          OR i.item_name ILIKE :searchLike
          OR i.article_code ILIKE :searchLike
          OR i.sku_code ILIKE :searchLike
          OR i.category ILIKE :searchLike
          OR st.store_name ILIKE :searchLike
          OR st.store_code ILIKE :searchLike
        )
      `);
    }

    if (storeCode) {
      whereClauses.push("st.store_code = :store_code");
    }

    if (organizationId) {
      whereClauses.push("b.current_organization_id = :organization_id");
    }

    if (itemId) {
      whereClauses.push("b.item_id = :item_id");
    }

    if (status) {
      whereClauses.push("b.status = :status");
    }

    if (dateFrom) {
      whereClauses.push("b.created_at >= :date_from::timestamptz");
    }

    if (dateTo) {
      whereClauses.push("b.created_at <= :date_to::timestamptz");
    }

    const whereSql = whereClauses.join(" AND ");

    const rows = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,
        b.root_batch_id,
        b.parent_batch_id,
        b.item_id,

        i.item_name,
        i.article_code,
        i.sku_code,
        i.category,
        i.metal_type,
        i.purity,

        b.current_organization_id AS organization_id,
        st.store_name,
        st.store_code,
        st.organization_level,

        b.total_qty,
        b.available_qty,
        b.total_weight,
        b.available_weight,
        b.split_level,
        b.status,
        b.created_at,
        b.updated_at,

        CASE
          WHEN b.parent_batch_id IS NULL THEN true
          ELSE false
        END AS is_root_batch

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE ${whereSql}

      ORDER BY b.created_at DESC NULLS LAST, b.id DESC

      LIMIT :limit
      OFFSET :offset
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const countRows = await sequelize.query(
      `
      SELECT COUNT(*)::INT AS total

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE ${whereSql}
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const total = toNumber(countRows?.[0]?.total);

    return res.status(200).json({
      success: true,
      message: "Tracker batches fetched successfully",
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: rows.length,
      data: rows.map((b) => ({
        batch_id: Number(b.batch_id),
        batch_no: b.batch_no,

        root_batch_id: b.root_batch_id ? Number(b.root_batch_id) : null,
        parent_batch_id: b.parent_batch_id ? Number(b.parent_batch_id) : null,
        is_root_batch: Boolean(b.is_root_batch),

        item_id: Number(b.item_id),
        item_name: b.item_name,
        article_code: b.article_code,
        sku_code: b.sku_code,
        category: b.category,
        metal_type: b.metal_type,
        purity: b.purity,

        organization_id: b.organization_id ? Number(b.organization_id) : null,
        store_name: b.store_name || "Unknown Location",
        store_code: b.store_code || null,
        organization_level: b.organization_level || null,

        total_qty: toNumber(b.total_qty),
        available_qty: toNumber(b.available_qty),
        total_weight: toNumber(b.total_weight),
        available_weight: toNumber(b.available_weight),

        split_level: toNumber(b.split_level),
        status: b.status,

        created_at: b.created_at,
        updated_at: b.updated_at,
      })),
    });
  } catch (error) {
    console.error("getAllTrackerBatches error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch tracker batches",
      error: error.message,
    });
  }
};



export const getBatchMovementHistory = async (req, res) => {
  try {
    const batchId = Number(req.params.batch_id);

    if (!Number.isInteger(batchId) || batchId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid batch_id is required",
      });
    }

    const batchRows = await sequelize.query(
      `
      SELECT
        id AS batch_id,
        batch_no,
        root_batch_id,
        parent_batch_id,
        item_id
      FROM public.inventory_batches
      WHERE id = :batch_id
      LIMIT 1
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
      }
    );

    const batch = batchRows?.[0];

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    const rootBatchId = Number(batch.root_batch_id || batch.batch_id);

    const movementHistory = await fetchBatchMovementHistory(rootBatchId);

    return res.status(200).json({
      success: true,
      message: "Batch movement history fetched successfully",
      data: {
        searched_batch: {
          batch_id: Number(batch.batch_id),
          batch_no: batch.batch_no,
          root_batch_id: rootBatchId,
          parent_batch_id: batch.parent_batch_id
            ? Number(batch.parent_batch_id)
            : null,
          item_id: Number(batch.item_id),
        },
        summary: {
          root_batch_id: rootBatchId,
          movement_count: movementHistory.length,
        },
        movement_history: movementHistory,
        timeline: movementHistory,
      },
    });
  } catch (error) {
    console.error("getBatchMovementHistory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch movement history",
      error: error.message,
    });
  }
};



export const getBatchMovementHistoryByBatchNo = async (req, res) => {
  try {
    const batchNo = String(req.query.batch_no || req.query.search || "").trim();

    if (!batchNo) {
      return res.status(400).json({
        success: false,
        message: "batch_no is required",
      });
    }

    const batchRows = await sequelize.query(
      `
      SELECT
        id AS batch_id,
        batch_no,
        root_batch_id,
        parent_batch_id,
        item_id
      FROM public.inventory_batches
      WHERE batch_no = :batch_no
      LIMIT 1
      `,
      {
        replacements: { batch_no: batchNo },
        type: QueryTypes.SELECT,
      }
    );

    const batch = batchRows?.[0];

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    const rootBatchId = Number(batch.root_batch_id || batch.batch_id);

    const movementHistory = await fetchBatchMovementHistory(rootBatchId);

    return res.status(200).json({
      success: true,
      message: "Batch movement history fetched successfully",
      data: {
        searched_batch: {
          batch_id: Number(batch.batch_id),
          batch_no: batch.batch_no,
          root_batch_id: rootBatchId,
          parent_batch_id: batch.parent_batch_id
            ? Number(batch.parent_batch_id)
            : null,
          item_id: Number(batch.item_id),
        },
        summary: {
          root_batch_id: rootBatchId,
          movement_count: movementHistory.length,
        },
        movement_history: movementHistory,
        timeline: movementHistory,
      },
    });
  } catch (error) {
    console.error("getBatchMovementHistoryByBatchNo error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch movement history",
      error: error.message,
    });
  }
};
const safeNumber = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};

const buildLocationLabel = (location) => {
  if (!location) return null;

  return [
    location.store_name || "Unknown Store",
    location.store_code ? `(${location.store_code})` : null,
    location.organization_level ? `- ${location.organization_level}` : null,
  ]
    .filter(Boolean)
    .join(" ");
};

const getMovementEventType = (movement) => {
  const movementType = String(movement.movement_type || "").toLowerCase();
  const referenceType = String(movement.reference_type || "").toLowerCase();

  if (!movement.from && movement.to && movementType === "purchase") {
    if (referenceType === "stock_upload_existing_item") {
      return "existing_stock_added";
    }

    return "stock_created";
  }

  if (movement.from && movement.to && movementType === "transfer") {
    return "stock_transfer";
  }

  if (movementType === "dispatch") {
    return "stock_dispatched";
  }

  if (movementType.includes("receive")) {
    return "stock_received";
  }

  if (referenceType === "stock_upload_existing_item") {
    return "existing_stock_added";
  }

  return "stock_movement";
};

const buildJourneyTimeline = (movementHistory = []) => {
  return movementHistory.map((movement, index) => {
    const eventType = getMovementEventType(movement);

    let title = "Stock Movement";
    let fromLabel = buildLocationLabel(movement.from);
    let toLabel = buildLocationLabel(movement.to);

    if (eventType === "stock_created") {
      fromLabel = "External / Opening Stock";
      toLabel = buildLocationLabel(movement.to);
      title = `Stock Created → ${movement.to?.store_name || "Unknown Store"}`;
    }

    if (eventType === "existing_stock_added") {
      fromLabel = "Delivery Challan / Existing Item Upload";
      toLabel = buildLocationLabel(movement.to);
      title = `Existing Item Stock Added → ${
        movement.to?.store_name || "Unknown Store"
      }`;
    }

    if (eventType === "stock_transfer") {
      fromLabel = buildLocationLabel(movement.from);
      toLabel = buildLocationLabel(movement.to);
      title = `${movement.from?.store_name || "Unknown"} → ${
        movement.to?.store_name || "Unknown"
      }`;
    }

    if (eventType === "stock_dispatched") {
      fromLabel = buildLocationLabel(movement.to);
      toLabel = "In Transit / Transfer";
      title = `Dispatched from ${movement.to?.store_name || "Source Store"}`;
    }

    if (eventType === "stock_received") {
      fromLabel = "In Transit / Transfer";
      toLabel = buildLocationLabel(movement.to);
      title = `Received at ${movement.to?.store_name || "Destination Store"}`;
    }

    return {
      step_no: index + 1,
      event_type: eventType,

      title,
      from_label: fromLabel,
      to_label: toLabel,

      from: movement.from,
      to: movement.to,

      quantity: safeNumber(movement.quantity),
      weight: safeNumber(movement.weight),

      movement_type: movement.movement_type,
      movement_source: movement.movement_source,

      reference_type: movement.reference_type,
      reference_id: movement.reference_id,
      reference_no: movement.reference_no,

      root_batch_id: movement.root_batch_id,
      root_batch_no: movement.root_batch_no,

      parent_batch_id: movement.parent_batch_id,
      parent_batch_no: movement.parent_batch_no,

      child_batch_id: movement.child_batch_id,
      child_batch_no: movement.child_batch_no,

      remarks: movement.remarks,
      created_by: movement.created_by,
      created_at: movement.created_at,
    };
  });
};

/**
 * Industry-level cleanup:
 * Same transfer ke liye agar batch_splits me transfer entry hai,
 * to stock_movements ka dispatch log timeline me duplicate nahi dikhana.
 *
 * Raw data raw.movement_history me available rahega.
 */
const buildCleanJourneyTimeline = (movementHistory = []) => {
  const transferReferenceIds = new Set();

  for (const movement of movementHistory) {
    const movementType = String(movement.movement_type || "").toLowerCase();

    if (
      movement.movement_source === "batch_split" &&
      movementType === "transfer" &&
      movement.reference_id
    ) {
      transferReferenceIds.add(String(movement.reference_id));
    }
  }

  const cleanedMovements = movementHistory.filter((movement) => {
    const movementType = String(movement.movement_type || "").toLowerCase();

    const isDuplicateDispatch =
      movement.movement_source === "stock_movement" &&
      movementType === "dispatch" &&
      movement.reference_id &&
      transferReferenceIds.has(String(movement.reference_id));

    return !isDuplicateDispatch;
  });

  return buildJourneyTimeline(cleanedMovements).map((step, index) => ({
    ...step,
    step_no: index + 1,
  }));
};

const buildCurrentLocations = (finalDestinations = []) => {
  return finalDestinations.map((location) => {
    const batchNodes = Array.isArray(location.batch_nodes)
      ? location.batch_nodes
      : [];

    return {
      organization_id: location.organization_id,
      store_name: location.store_name,
      store_code: location.store_code,
      organization_level: location.organization_level,
      address: location.address,

      current_quantity: safeNumber(location.quantity),
      current_weight: safeNumber(location.weight),

      batch_count: batchNodes.length,
      batch_numbers: batchNodes.map((batch) => batch.batch_no),

      last_updated_at: location.last_updated_at,
    };
  });
};

const buildBatchLocations = (finalDestinations = []) => {
  const rows = [];

  for (const location of finalDestinations) {
    const batchNodes = Array.isArray(location.batch_nodes)
      ? location.batch_nodes
      : [];

    for (const batch of batchNodes) {
      rows.push({
        batch_id: batch.batch_id ? Number(batch.batch_id) : null,
        batch_no: batch.batch_no,

        root_batch_id: batch.root_batch_id
          ? Number(batch.root_batch_id)
          : null,
        root_batch_no: batch.root_batch_no,

        parent_batch_id: batch.parent_batch_id
          ? Number(batch.parent_batch_id)
          : null,

        current_location: {
          organization_id: location.organization_id,
          store_name: location.store_name,
          store_code: location.store_code,
          organization_level: location.organization_level,
          address: location.address,
        },

        quantity: safeNumber(batch.quantity),
        weight: safeNumber(batch.weight),

        status: batch.status,
        split_level: safeNumber(batch.split_level),

        created_at: batch.created_at,
        updated_at: batch.updated_at,
      });
    }
  }

  return rows;
};

export const getItemFinalDestinations = async (req, res) => {
  try {
    const itemId = Number(req.params.item_id);

    const singleDate = String(req.query.date || "").trim();

    const dateFrom = normalizeDateFrom(
      req.query.date_from || req.query.from || singleDate
    );

    const dateTo = normalizeDateTo(
      req.query.date_to || req.query.to || singleDate
    );

    const search = String(req.query.search || req.query.batch_no || "").trim();

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid item_id is required",
      });
    }

    const itemRows = await sequelize.query(
      `
      SELECT
        id AS item_id,
        item_name,
        article_code,
        sku_code,
        category,
        metal_type,
        purity,
        current_status
      FROM public.items
      WHERE id = :item_id
      LIMIT 1
      `,
      {
        replacements: { item_id: itemId },
        type: QueryTypes.SELECT,
      }
    );

    const item = itemRows?.[0];

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const whereClauses = [
      "b.item_id = :item_id",
      "COALESCE(i.is_active, true) = true",
      "COALESCE(b.available_qty, 0) > 0",
    ];

    const replacements = {
      item_id: itemId,
      date_from: dateFrom,
      date_to: dateTo,
      search,
      searchLike: `%${search}%`,
    };

    if (dateFrom) {
      whereClauses.push("root_b.created_at >= :date_from::timestamptz");
    }

    if (dateTo) {
      whereClauses.push("root_b.created_at <= :date_to::timestamptz");
    }

    if (search) {
      whereClauses.push(`
        (
          b.batch_no ILIKE :searchLike
          OR root_b.batch_no ILIKE :searchLike
          OR i.item_name ILIKE :searchLike
          OR i.article_code ILIKE :searchLike
          OR i.sku_code ILIKE :searchLike
          OR st.store_name ILIKE :searchLike
          OR st.store_code ILIKE :searchLike
        )
      `);
    }

    const whereSql = whereClauses.join(" AND ");

    const destinationRows = await sequelize.query(
      `
      SELECT
        b.current_organization_id AS organization_id,

        st.store_name,
        st.store_code,
        st.organization_level,
        st.address,

        SUM(COALESCE(b.available_qty, 0)) AS quantity,
        SUM(COALESCE(b.available_weight, 0)) AS weight,

        COUNT(DISTINCT COALESCE(b.root_batch_id, b.id))::INT AS root_batch_count,
        COUNT(DISTINCT b.id)::INT AS batch_node_count,

        MAX(b.updated_at) AS last_updated_at,

  JSON_AGG(
  JSON_BUILD_OBJECT(
    'batch_id', b.id,
    'batch_no', b.batch_no,
    'parent_batch_id', b.parent_batch_id,
    'root_batch_id', b.root_batch_id,
    'quantity', b.available_qty,
    'weight', b.available_weight,
    'split_level', b.split_level,
    'status', b.status
  )
) AS batch_nodes
      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      INNER JOIN public.inventory_batches root_b
        ON root_b.id = COALESCE(b.root_batch_id, b.id)

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE ${whereSql}

      GROUP BY
        b.current_organization_id,
        st.store_name,
        st.store_code,
        st.organization_level,
        st.address

      ORDER BY
        st.store_name ASC NULLS LAST,
        b.current_organization_id ASC NULLS LAST
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const summaryRows = await sequelize.query(
      `
      SELECT
        COUNT(DISTINCT COALESCE(b.root_batch_id, b.id))::INT AS total_root_batches,
        COUNT(DISTINCT b.id)::INT AS total_batch_nodes,

        COUNT(DISTINCT b.current_organization_id) FILTER (
          WHERE COALESCE(b.available_qty, 0) > 0
        )::INT AS location_count,

        SUM(COALESCE(b.available_qty, 0)) AS current_available_qty,
        SUM(COALESCE(b.available_weight, 0)) AS current_available_weight

      FROM public.inventory_batches b

      INNER JOIN public.items i
        ON i.id = b.item_id

      INNER JOIN public.inventory_batches root_b
        ON root_b.id = COALESCE(b.root_batch_id, b.id)

      LEFT JOIN public.stores st
        ON st.id = b.current_organization_id

      WHERE ${whereSql}
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const summary = summaryRows?.[0] || {};

    const movementRows = await sequelize.query(
      `
      WITH stock_movement_rows AS (
        SELECT
          'stock_movement'::text AS movement_source,
          sm.id AS movement_id,

          NULL::integer AS split_id,
          NULL::integer AS root_batch_id,
          NULL::text AS root_batch_no,
          NULL::integer AS parent_batch_id,
          NULL::text AS parent_batch_no,
          NULL::integer AS child_batch_id,
          NULL::text AS child_batch_no,

          sm.item_id,

          NULL::integer AS from_organization_id,
          NULL::text AS from_store_name,
          NULL::text AS from_store_code,
          NULL::text AS from_organization_level,

          sm.organization_id AS to_organization_id,
          to_store.store_name AS to_store_name,
          to_store.store_code AS to_store_code,
          to_store.organization_level::text AS to_organization_level,

          COALESCE(sm.qty, 0) AS quantity,
          COALESCE(sm.weight, 0) AS weight,

          sm.movement_type::text AS movement_type,
          sm.reference_type::text AS reference_type,
          sm.reference_id,
          NULL::text AS reference_no,

          sm.remarks,
          sm.created_by,
          sm.created_at

        FROM public.stock_movements sm

        LEFT JOIN public.stores to_store
          ON to_store.id = sm.organization_id

        WHERE sm.item_id = :item_id
      ),

      batch_split_rows AS (
        SELECT
          'batch_split'::text AS movement_source,
          bs.id AS movement_id,

          bs.id AS split_id,
          bs.root_batch_id,
          root_b.batch_no AS root_batch_no,
          bs.parent_batch_id,
          parent_b.batch_no AS parent_batch_no,
          bs.child_batch_id,
          child_b.batch_no AS child_batch_no,

          bs.item_id,

          bs.from_organization_id,
          from_store.store_name AS from_store_name,
          from_store.store_code AS from_store_code,
          from_store.organization_level::text AS from_organization_level,

          bs.to_organization_id,
          to_store.store_name AS to_store_name,
          to_store.store_code AS to_store_code,
          to_store.organization_level::text AS to_organization_level,

          COALESCE(bs.quantity, 0) AS quantity,
          COALESCE(bs.weight, 0) AS weight,

          'transfer'::text AS movement_type,
          bs.reference_type::text AS reference_type,
          bs.reference_id,
          NULL::text AS reference_no,

          bs.remarks,
          bs.created_by,
          bs.created_at

        FROM public.batch_splits bs

        LEFT JOIN public.inventory_batches root_b
          ON root_b.id = bs.root_batch_id

        LEFT JOIN public.inventory_batches parent_b
          ON parent_b.id = bs.parent_batch_id

        LEFT JOIN public.inventory_batches child_b
          ON child_b.id = bs.child_batch_id

        LEFT JOIN public.stores from_store
          ON from_store.id = bs.from_organization_id

        LEFT JOIN public.stores to_store
          ON to_store.id = bs.to_organization_id

        WHERE bs.item_id = :item_id
      )

      SELECT *
      FROM (
        SELECT * FROM stock_movement_rows
        UNION ALL
        SELECT * FROM batch_split_rows
      ) movement_data

      WHERE
        (
          :date_from IS NULL
          OR movement_data.created_at >= :date_from::timestamptz
        )
        AND (
          :date_to IS NULL
          OR movement_data.created_at <= :date_to::timestamptz
        )
        AND (
          :search = ''
          OR movement_data.root_batch_no ILIKE :searchLike
          OR movement_data.parent_batch_no ILIKE :searchLike
          OR movement_data.child_batch_no ILIKE :searchLike
          OR movement_data.from_store_name ILIKE :searchLike
          OR movement_data.from_store_code ILIKE :searchLike
          OR movement_data.to_store_name ILIKE :searchLike
          OR movement_data.to_store_code ILIKE :searchLike
          OR movement_data.reference_id::text ILIKE :searchLike
          OR movement_data.reference_type ILIKE :searchLike
          OR movement_data.movement_type ILIKE :searchLike
        )

      ORDER BY movement_data.created_at ASC, movement_data.movement_id ASC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    const finalDestinations = destinationRows.map((d) => ({
      organization_id: d.organization_id ? Number(d.organization_id) : null,

      store_name: d.store_name || "Unknown Location",
      store_code: d.store_code || null,
      address: d.address,
      organization_level: d.organization_level || null,

      quantity: safeNumber(d.quantity),
      weight: safeNumber(d.weight),

      last_updated_at: d.last_updated_at || null,

      batch_nodes: Array.isArray(d.batch_nodes) ? d.batch_nodes : [],
    }));

    const movementHistory = movementRows.map((m) => ({
      movement_source: m.movement_source,
      movement_id: Number(m.movement_id),

      split_id: m.split_id ? Number(m.split_id) : null,

      root_batch_id: m.root_batch_id ? Number(m.root_batch_id) : null,
      root_batch_no: m.root_batch_no || null,

      parent_batch_id: m.parent_batch_id ? Number(m.parent_batch_id) : null,
      parent_batch_no: m.parent_batch_no || null,

      child_batch_id: m.child_batch_id ? Number(m.child_batch_id) : null,
      child_batch_no: m.child_batch_no || null,

      item_id: Number(m.item_id),

      from: m.from_organization_id
        ? {
            organization_id: Number(m.from_organization_id),
            store_name: m.from_store_name,
            store_code: m.from_store_code,
            organization_level: m.from_organization_level,
          }
        : null,

      to: m.to_organization_id
        ? {
            organization_id: Number(m.to_organization_id),
            store_name: m.to_store_name,
            store_code: m.to_store_code,
            organization_level: m.to_organization_level,
          }
        : null,

      quantity: safeNumber(m.quantity),
      weight: safeNumber(m.weight),

      movement_type: m.movement_type,
      reference_type: m.reference_type,
      reference_id: m.reference_id ? Number(m.reference_id) : null,
      reference_no: m.reference_no || null,

      remarks: m.remarks || null,
      created_by: m.created_by ? Number(m.created_by) : null,
      created_at: m.created_at,
    }));

    const currentLocations = buildCurrentLocations(finalDestinations);
    const batchLocations = buildBatchLocations(finalDestinations);
    const journeyTimeline = buildCleanJourneyTimeline(movementHistory);

    return res.status(200).json({
      success: true,
      message: "Item final destinations fetched successfully",
      data: {
        item: {
          item_id: Number(item.item_id),
          item_name: item.item_name,
          article_code: item.article_code,
          sku_code: item.sku_code,
          category: item.category,
          metal_type: item.metal_type,
          purity: item.purity,
          current_status: item.current_status,
        },

        filters: {
          date_from: dateFrom,
          date_to: dateTo,
          search: search || null,
        },

        summary: {
          item_id: itemId,

          location_count: safeNumber(summary.location_count),
          current_available_qty: safeNumber(summary.current_available_qty),
          current_available_weight: safeNumber(summary.current_available_weight),

          total_root_batches: safeNumber(summary.total_root_batches),
          total_batch_nodes: safeNumber(summary.total_batch_nodes),

          movement_count: movementHistory.length,
          journey_step_count: journeyTimeline.length,
          current_location_count: currentLocations.length,
          batch_location_count: batchLocations.length,
        },

        current_locations: currentLocations,

        batch_locations: batchLocations,

        journey_timeline: journeyTimeline,

        raw: {
          final_destinations: finalDestinations,
          movement_history: movementHistory,
        },
      },
    });
  } catch (error) {
  console.error("getBatchFinalDestinations error:", error);
  console.error("ERROR MESSAGE:", error?.message);
  console.error("ERROR PARENT:", error?.parent);
  console.error("ERROR ORIGINAL:", error?.original);

  return res.status(500).json({
    success: false,
    message: "Failed to fetch batch final destinations",
    error: error.message,
  });
}
}