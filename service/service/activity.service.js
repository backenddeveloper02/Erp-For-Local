import ActivityLog from "../model/activityLog.js";

export const createActivityLog = async ({
  branch_id = null,
  user_id = null,
  module,
  action,
  entity_type,
  entity_id = null,
  title,
  description = "",
  metadata = null,
}) => {
  return await ActivityLog.create({
    branch_id,
    user_id,
    module,
    action,
    entity_type,
    entity_id,
    title,
    description,
    metadata,
  });
};