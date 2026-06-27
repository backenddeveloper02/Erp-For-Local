import Task from "../model/task.js";
import InventoryAudit from "../model/inventoryAudit.js";

const getYesterdayDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

export const ensureDailyAuditPendingTask = async (user) => {
  if (!user?.organization_id) return;

  const auditDate = getYesterdayDate();

  const audit = await InventoryAudit.findOne({
    where: {
      organization_id: user.organization_id,
      audit_date: auditDate,
      audit_type: "daily",
    },
  });

  const isAuditDone =
    audit && ["submitted", "verified"].includes(audit.status);

  if (isAuditDone) return;

  const referenceNo = `AUDIT-PENDING-${user.organization_id}-${auditDate}`;

  const existingTask = await Task.findOne({
    where: {
      task_type: "daily_audit_pending",
      reference_no: referenceNo,
    },
  });

  if (existingTask) return;

  await Task.create({
    title: "Daily audit pending",
    description: `Daily audit for ${auditDate} is pending`,
    priority: "high",
    status: "pending",
    task_type: "daily_audit_pending",
    reference_id: audit?.id || null,
    reference_no: referenceNo,
    district_code: user.district_code || null,
    store_code: user.store_code || null,
    store_name: user.store_name || null,
    assigned_to: user.id || null,
    created_by: null,
  });
};