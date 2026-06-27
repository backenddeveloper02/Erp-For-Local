import ActivityLog from "../models/ActivityLog.js";

const createActivityLog = async ({
  organization_id = null,
  user_id = null,
  action,
  module_name = null,
  reference_id = null,
  reference_no = null,
  title,
  description = null,
  meta = {},
  icon = "activity",
  color = "blue",
}) => {
  try {
    await ActivityLog.create({
      organization_id,
      user_id,
      action,
      module_name,
      reference_id,
      reference_no,
      title,
      description,
      meta,
      icon,
      color,
    });
  } catch (error) {
    console.error("createActivityLog error:", error.message);
  }
};

export default createActivityLog;