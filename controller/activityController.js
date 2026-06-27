import { Op, Sequelize } from "sequelize";
import ActivityLog from "../model/activityLog.js";
import SystemActivity from "../model/systemActivity.js";
import Store from "../model/Store.js";
import User from "../model/user.js";

const hasAttr = (Model, field) => !!Model?.rawAttributes?.[field];

const getFirstExistingField = (Model, fields = []) => {
  for (const field of fields) {
    if (hasAttr(Model, field)) return field;
  }
  return null;
};

const normalizeRole = (role) =>
  String(role || "")
    .toLowerCase()
    .replace(/[\s-]/g, "_");

const safeMeta = (meta) => {
  if (!meta) return {};
  if (typeof meta === "object") return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
};

const getTimeAgo = (dateValue) => {
  if (!dateValue) return null;

  const now = new Date();
  const then = new Date(dateValue);
  const diffMs = now - then;

  const mins = Math.floor(diffMs / (1000 * 60));
  const hrs = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins > 1 ? "s" : ""} ago`;
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  return `${days} day${days > 1 ? "s" : ""} ago`;
};

const getDistrictScope = (req) => {
  if (!req.user) {
    throw new Error("User not authenticated");
  }

  const role = normalizeRole(req.user.role);
  const orgLevel = String(req.user.organization_level || "").toLowerCase();

  if (!role.includes("district") && orgLevel !== "district") {
    throw new Error("Only district users can access this API");
  }

  const districtOrgId = Number(req.user.organization_id);
  const districtCode =
    req.user.district_code ||
    req.user.store_code ||
    req.user.organization_code ||
    null;

  if (!districtOrgId) {
    throw new Error("organization_id missing in req.user");
  }

  return { districtOrgId, districtCode };
};

const getStoreFieldMap = () => ({
  idField: getFirstExistingField(Store, ["id"]),
  districtIdField: getFirstExistingField(Store, ["district_id", "districtId"]),
  districtCodeField: getFirstExistingField(Store, ["district_code", "districtCode"]),
  storeCodeField: getFirstExistingField(Store, ["store_code", "storeCode"]),
  storeNameField: getFirstExistingField(Store, ["store_name", "storeName", "name"]),
});

const buildStoreMap = (stores = []) => {
  const { idField, storeCodeField, storeNameField, districtIdField, districtCodeField } =
    getStoreFieldMap();

  const map = {};

  for (const st of stores) {
    const idVal = idField ? Number(st[idField]) : null;
    if (!idVal) continue;

    map[idVal] = {
      store_id: idVal,
      store_code: storeCodeField ? st[storeCodeField] || null : null,
      store_name: storeNameField ? st[storeNameField] || null : null,
      district_id: districtIdField ? st[districtIdField] || null : null,
      district_code: districtCodeField ? st[districtCodeField] || null : null,
    };
  }

  return map;
};

const getDistrictSelfStoreRows = async (districtOrgId, districtCode = null) => {
  const { idField, storeCodeField, storeNameField, districtIdField, districtCodeField } =
    getStoreFieldMap();

  if (!idField) return [];

  const orConditions = [{ [idField]: districtOrgId }];

  if (districtCode && storeCodeField) {
    orConditions.push({ [storeCodeField]: districtCode });
  }

  const attributes = [
    idField,
    ...(storeCodeField ? [storeCodeField] : []),
    ...(storeNameField ? [storeNameField] : []),
    ...(districtIdField ? [districtIdField] : []),
    ...(districtCodeField ? [districtCodeField] : []),
  ];

  return await Store.findAll({
    where: { [Op.or]: orConditions },
    attributes,
    raw: true,
  });
};

const getRetailStoresUnderDistrict = async (districtOrgId, districtCode = null) => {
  const { idField, districtIdField, districtCodeField, storeCodeField, storeNameField } =
    getStoreFieldMap();

  if (!idField) return [];

  const orConditions = [];

  if (districtIdField) {
    orConditions.push({ [districtIdField]: districtOrgId });
  }

  if (districtCode && districtCodeField) {
    orConditions.push({ [districtCodeField]: districtCode });
  }

  if (!orConditions.length) return [];

  const attributes = [
    idField,
    ...(storeCodeField ? [storeCodeField] : []),
    ...(storeNameField ? [storeNameField] : []),
    ...(districtIdField ? [districtIdField] : []),
    ...(districtCodeField ? [districtCodeField] : []),
  ];

  return await Store.findAll({
    where: { [Op.or]: orConditions },
    attributes,
    raw: true,
  });
};

const buildHandledByMap = async (userIds = []) => {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return {};

  const nameField = getFirstExistingField(User, ["name", "username"]);
  if (!nameField) return {};

  const users = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ["id", nameField],
    raw: true,
  });

  const map = {};
  for (const user of users) {
    map[user.id] = user[nameField] || `User #${user.id}`;
  }

  return map;
};

const formatActivityLogRow = (row, handledByMap = {}, storeMap = {}) => {
  const parsedMeta = safeMeta(row.meta);

  const storeIdFromLog = row.organization_id ? Number(row.organization_id) : null;
  const storeIdFromMeta = parsedMeta.organization_id
    ? Number(parsedMeta.organization_id)
    : null;

  const storeInfo = storeMap[storeIdFromLog] || storeMap[storeIdFromMeta] || null;

  return {
    id: row.id,
    source: "activity_logs",
    activity_type: row.action || "activity",
    action: row.action || null,
    module_name: row.module_name || null,
    title: row.title || "Activity",
    description: row.description || null,
    reference_id: row.reference_id || null,
    reference_no: row.reference_no || null,
    main_store:
      storeInfo?.store_name ||
      parsedMeta.store_name ||
      parsedMeta.store_code ||
      "-",
    store_name: storeInfo?.store_name || parsedMeta.store_name || "-",
    store_code: storeInfo?.store_code || parsedMeta.store_code || null,
    handled_by: handledByMap[row.user_id] || "-",
    icon: row.icon || "activity",
    color: row.color || "blue",
    meta: parsedMeta,
    activity_at: row.created_at,
    time_ago: getTimeAgo(row.created_at),
  };
};

const formatSystemActivityRow = (row, handledByMap = {}) => ({
  id: row.id,
  source: "system_activities",
  activity_type: row.activity_type || "activity",
  action: row.activity_type || null,
  module_name: row.module_name || null,
  title: row.title || "Activity",
  description: row.description || null,
  reference_id: row.reference_id || null,
  reference_no: row.reference_no || null,
  main_store: row.store_name || row.store_code || "-",
  store_name: row.store_name || "-",
  store_code: row.store_code || null,
  handled_by: handledByMap[row.created_by] || "-",
  icon: "activity",
  color: "blue",
  meta: null,
  activity_at: row.created_at,
  time_ago: getTimeAgo(row.created_at),
});

/* =========================================================
   DISTRICT OWN RECENT ACTIVITIES
========================================================= */
export const getDistrictOwnRecentActivities = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const parsedLimit = Math.max(1, Number(limit) || 10);

    const { districtOrgId, districtCode } = getDistrictScope(req);

    const districtStoreRows = await getDistrictSelfStoreRows(
      districtOrgId,
      districtCode
    );

    const storeMap = buildStoreMap(districtStoreRows);

    const activityLogWhere = {
      [Op.or]: [
        { organization_id: districtOrgId },

        Sequelize.where(
          Sequelize.cast(Sequelize.json("meta.organization_id"), "TEXT"),
          String(districtOrgId)
        ),

        Sequelize.where(
          Sequelize.cast(Sequelize.json("meta.district_id"), "TEXT"),
          String(districtOrgId)
        ),

        ...(districtCode
          ? [
              Sequelize.where(
                Sequelize.cast(Sequelize.json("meta.district_code"), "TEXT"),
                districtCode
              ),
              Sequelize.where(
                Sequelize.cast(Sequelize.json("meta.store_code"), "TEXT"),
                districtCode
              ),
            ]
          : []),
      ],
    };

    const systemActivityWhere = districtCode
      ? {
          [Op.or]: [
            { district_code: districtCode },
            { store_code: districtCode },
          ],
        }
      : undefined;

    const [activityLogs, systemActivities] = await Promise.all([
      ActivityLog.findAll({
        where: activityLogWhere,
        attributes: [
          "id",
          "organization_id",
          "user_id",
          "action",
          "module_name",
          "reference_id",
          "reference_no",
          "title",
          "description",
          "meta",
          "icon",
          "color",
          "created_at",
          "updated_at",
        ],
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 3,
        raw: true,
      }),

      SystemActivity.findAll({
        ...(systemActivityWhere ? { where: systemActivityWhere } : {}),
        attributes: [
          "id",
          "activity_type",
          "module_name",
          "reference_id",
          "reference_no",
          "title",
          "description",
          "state_code",
          "district_code",
          "store_code",
          "store_name",
          "created_by",
          "created_at",
        ],
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 3,
        raw: true,
      }),
    ]);

    const handledByMap = await buildHandledByMap([
      ...activityLogs.map((x) => x.user_id).filter(Boolean),
      ...systemActivities.map((x) => x.created_by).filter(Boolean),
    ]);

    const merged = [
      ...activityLogs.map((row) => {
        const formatted = formatActivityLogRow(row, handledByMap, storeMap);

        return {
          ...formatted,

          // ✅ DB se direct fetched created_at
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,

          // ✅ sorting ke liye
          activity_at: row.created_at || formatted.activity_at || null,
        };
      }),

      ...systemActivities.map((row) => {
        const formatted = formatSystemActivityRow(row, handledByMap);

        return {
          ...formatted,

          // ✅ DB se direct fetched created_at
          created_at: row.created_at || null,

          // ✅ sorting ke liye
          activity_at: row.created_at || formatted.activity_at || null,
        };
      }),
    ]
      .sort((a, b) => new Date(b.activity_at) - new Date(a.activity_at))
      .slice(0, parsedLimit);

    return res.status(200).json({
      success: true,
      message: "District own recent activities fetched successfully",
      count: merged.length,
      data: merged,
    });
  } catch (error) {
    console.error("getDistrictOwnRecentActivities error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch district own recent activities",
      error: error.message,
    });
  }
};
/* =========================================================
   DISTRICT RETAIL STORES RECENT ACTIVITIES
========================================================= */
export const getDistrictRetailRecentActivities = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const parsedLimit = Math.max(1, Number(limit) || 10);

    const { districtOrgId, districtCode } = getDistrictScope(req);

    const retailStores = await getRetailStoresUnderDistrict(districtOrgId, districtCode);

    if (!retailStores.length) {
      return res.status(200).json({
        success: true,
        message: "No retail stores found under this district",
        count: 0,
        stores_count: 0,
        data: [],
      });
    }

    const { idField, storeCodeField } = getStoreFieldMap();
    const storeMap = buildStoreMap(retailStores);

    const retailStoreIds = retailStores
      .map((s) => Number(s[idField]))
      .filter(Boolean);

    const retailStoreCodes = retailStores
      .map((s) => (storeCodeField ? s[storeCodeField] : null))
      .filter(Boolean);

    const activityLogWhere = {
      [Op.or]: [
        { organization_id: { [Op.in]: retailStoreIds } },
        ...retailStoreIds.map((id) =>
          Sequelize.where(
            Sequelize.cast(Sequelize.json("meta.organization_id"), "TEXT"),
            String(id)
          )
        ),
        ...retailStoreCodes.map((code) =>
          Sequelize.where(
            Sequelize.cast(Sequelize.json("meta.store_code"), "TEXT"),
            code
          )
        ),
      ],
    };

    const systemActivityWhere = retailStoreCodes.length
      ? {
          store_code: {
            [Op.in]: retailStoreCodes,
          },
        }
      : undefined;

    const [activityLogs, systemActivities] = await Promise.all([
      ActivityLog.findAll({
        where: activityLogWhere,
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 5,
        raw: true,
      }),
      SystemActivity.findAll({
        ...(systemActivityWhere ? { where: systemActivityWhere } : {}),
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 5,
        raw: true,
      }),
    ]);

    const handledByMap = await buildHandledByMap([
      ...activityLogs.map((x) => x.user_id),
      ...systemActivities.map((x) => x.created_by),
    ]);

    const merged = [
      ...activityLogs.map((row) => formatActivityLogRow(row, handledByMap, storeMap)),
      ...systemActivities.map((row) => formatSystemActivityRow(row, handledByMap)),
    ]
      .sort((a, b) => new Date(b.activity_at) - new Date(a.activity_at))
      .slice(0, parsedLimit);

    return res.status(200).json({
      success: true,
      message: "District retail stores recent activities fetched successfully",
      count: merged.length,
      stores_count: retailStores.length,
      data: merged,
    });
  } catch (error) {
    console.error("getDistrictRetailRecentActivities error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district retail recent activities",
      error: error.message,
    });
  }
};


export const getRetailOwnRecentActivities = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const parsedLimit = Math.max(1, Number(limit) || 10);

    const user = req.user;

    if (!user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const orgId = user.organization_id;
    const storeCode = user.store_code;

    const activityLogWhere = {
      [Op.or]: [
        { organization_id: orgId },

        Sequelize.where(
          Sequelize.cast(Sequelize.json("meta.organization_id"), "TEXT"),
          String(orgId)
        ),

        ...(storeCode
          ? [
              Sequelize.where(
                Sequelize.cast(Sequelize.json("meta.store_code"), "TEXT"),
                storeCode
              ),
            ]
          : []),
      ],
    };

    const systemActivityWhere = storeCode
      ? {
          [Op.or]: [{ store_code: storeCode }, { created_by: user.id }],
        }
      : { created_by: user.id };

    const [activityLogs, systemActivities] = await Promise.all([
      ActivityLog.findAll({
        where: activityLogWhere,
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 3,
        raw: true,
      }),

      SystemActivity.findAll({
        where: systemActivityWhere,
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 3,
        raw: true,
      }),
    ]);

    const handledByMap = await buildHandledByMap([
      ...activityLogs.map((x) => x.user_id).filter(Boolean),
      ...systemActivities.map((x) => x.created_by).filter(Boolean),
    ]);

    const merged = [
      ...activityLogs.map((row) => {
        const formatted = formatActivityLogRow(row, handledByMap, {});
        return {
          ...formatted,
          created_at: row.created_at || row.createdAt || null,
        };
      }),

      ...systemActivities.map((row) => {
        const formatted = formatSystemActivityRow(row, handledByMap);
        return {
          ...formatted,
          created_at: row.created_at || row.createdAt || null,
        };
      }),
    ]
      .sort((a, b) => new Date(b.activity_at) - new Date(a.activity_at))
      .slice(0, parsedLimit);

    return res.status(200).json({
      success: true,
      message: "Retail own recent activities fetched successfully",
      count: merged.length,
      data: merged,
    });
  } catch (error) {
    console.error("getRetailOwnRecentActivities error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch retail own recent activities",
      error: error.message,
    });
  }
};

export const getHeadOwnRecentActivities = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const parsedLimit = Math.max(1, Number(limit) || 10);

    const user = req.user;

    if (!user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const orgId = user.organization_id;
    const storeCode = user.store_code;

    const activityLogWhere = {
      [Op.or]: [
        { organization_id: orgId },
        Sequelize.where(
          Sequelize.cast(Sequelize.json("meta.organization_id"), "TEXT"),
          String(orgId)
        ),
        ...(storeCode
          ? [
              Sequelize.where(
                Sequelize.cast(Sequelize.json("meta.store_code"), "TEXT"),
                storeCode
              ),
            ]
          : []),
      ],
    };

    const systemActivityWhere = storeCode
      ? {
          [Op.or]: [{ store_code: storeCode }, { created_by: user.id }],
        }
      : { created_by: user.id };

    const [activityLogs, systemActivities] = await Promise.all([
      ActivityLog.findAll({
        where: activityLogWhere,
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 3,
        raw: true,
      }),

      SystemActivity.findAll({
        where: systemActivityWhere,
        order: [["created_at", "DESC"]],
        limit: parsedLimit * 3,
        raw: true,
      }),
    ]);

    const handledByMap = await buildHandledByMap([
      ...activityLogs.map((x) => x.user_id).filter(Boolean),
      ...systemActivities.map((x) => x.created_by).filter(Boolean),
    ]);

    const merged = [
      ...activityLogs.map((row) => {
        const formatted = formatActivityLogRow(row, handledByMap, {});
        return {
          ...formatted,
          created_at: row.created_at || row.createdAt || null,
        };
      }),

      ...systemActivities.map((row) => {
        const formatted = formatSystemActivityRow(row, handledByMap);
        return {
          ...formatted,
          created_at: row.created_at || row.createdAt || null,
        };
      }),
    ]
      .sort((a, b) => new Date(b.activity_at) - new Date(a.activity_at))
      .slice(0, parsedLimit);

    return res.status(200).json({
      success: true,
      message: "Head own recent activities fetched successfully",
      count: merged.length,
      data: merged,
    });
  } catch (error) {
    console.error("getHeadOwnRecentActivities error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch head own recent activities",
      error: error.message,
    });
  }
};
