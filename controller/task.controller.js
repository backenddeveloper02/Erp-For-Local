import { Op } from "sequelize";
import Task from "../model/task.js";

export const getPendingTasks = async (req, res) => {
  try {
    const user = req.user;

    const where = {
      status: "pending",
    };

    if (user.role !== "super_admin") {
      where[Op.or] = [
        { assigned_to: user.id },
        { district_code: user.district_code || null },
        { store_code: user.store_code || null },
      ];
    }

    const tasks = await Task.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: 20,
    });

    const now = new Date();

    const formattedTasks = tasks.map((task) => {
      const t = task.toJSON();

      const createdAt = new Date(
        t.created_at || t.createdAt || new Date()
      );

      const diffMs = now - createdAt;
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHrs / 24);

      let pendingSince = "Just now";

      if (diffDays > 0) {
        pendingSince = `${diffDays} day(s) ago`;
      } else if (diffHrs > 0) {
        pendingSince = `${diffHrs} hour(s) ago`;
      } else if (diffMinutes > 0) {
        pendingSince = `${diffMinutes} minute(s) ago`;
      }

      const meta =
        t.meta && typeof t.meta === "object"
          ? t.meta
          : {};

      const dueRaw =
        t.due_date ||
        t.dueDate ||
        t.deadline ||
        t.end_date ||
        meta.due_date ||
        meta.deadline ||
        null;

      let progressPercent = 0;
      let remainingTime = null;

      if (dueRaw) {
        const dueDate = new Date(dueRaw);

        const totalMs = dueDate - createdAt;
        const usedMs = now - createdAt;

        if (totalMs > 0) {
          progressPercent = Math.min(
            100,
            Math.max(0, Math.round((usedMs / totalMs) * 100))
          );
        }

        const remainMs = dueDate - now;

        if (remainMs > 0) {
          const remainMinutes = Math.floor(remainMs / (1000 * 60));
          const remainHrs = Math.floor(remainMs / (1000 * 60 * 60));
          const remainDays = Math.floor(remainHrs / 24);

          if (remainDays > 0) {
            remainingTime = `${remainDays} day(s) left`;
          } else if (remainHrs > 0) {
            remainingTime = `${remainHrs} hour(s) left`;
          } else {
            remainingTime = `${remainMinutes} minute(s) left`;
          }
        } else {
          remainingTime = "Overdue";
          progressPercent = 100;
        }
      }

      const rawAmount =
        t.amount ||
        t.total_amount ||
        meta.amount ||
        meta.total_amount ||
        null;

      const amountNumber =
        rawAmount !== null && rawAmount !== undefined && rawAmount !== ""
          ? Number(rawAmount)
          : null;

      return {
        ...t,

        priority: t.priority || meta.priority || "medium",
        module_name:
          t.module_name ||
          t.task_type ||
          t.type ||
          meta.module_name ||
          meta.task_type ||
          meta.type ||
          "Task",

        title: t.title || meta.title || t.name || "Pending Task",

        description:
          t.description ||
          meta.description ||
          t.remark ||
          "Task requires your attention",

        time_ago: pendingSince,
        created_time: createdAt.toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        }),

        pending_since: pendingSince,
        progress_percent: progressPercent,
        remaining_time: remainingTime,

        items_pending:
          t.items_pending ||
          meta.items_pending ||
          meta.pending_items ||
          meta.item_count ||
          null,

        customer_name:
          t.customer_name ||
          meta.customer_name ||
          meta.customer ||
          meta.client_name ||
          null,

        amount: amountNumber,
        amount_text:
          amountNumber !== null && !Number.isNaN(amountNumber)
            ? `₹${amountNumber.toLocaleString("en-IN")}`
            : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: formattedTasks,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending tasks",
      error: error.message,
    });
  }
};