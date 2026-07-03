// socket/auditSocket.js

export const registerAuditSocket = (socket) => {
  socket.on("join-audit", (auditId) => {
    try {
      if (!auditId) return;

      const cleanAuditId = String(auditId).trim();
      const roomName = `audit_${cleanAuditId}`;

      socket.join(roomName);

      console.log(`Socket ${socket.id} joined ${roomName}`);

      socket.emit("audit-joined", {
        success: true,
        room: roomName,
        socket_id: socket.id,
      });
    } catch (error) {
      console.error("join-audit error:", error.message);
    }
  });

  socket.on("leave-audit", (auditId) => {
    try {
      if (!auditId) return;

      const cleanAuditId = String(auditId).trim();
      const roomName = `audit_${cleanAuditId}`;

      socket.leave(roomName);

      console.log(`Socket ${socket.id} left ${roomName}`);

      socket.emit("audit-left", {
        success: true,
        room: roomName,
      });
    } catch (error) {
      console.error("leave-audit error:", error.message);
    }
  });
};

export const emitAuditScan = ({ audit_id, organization_id, store_code, item }) => {
  try {
    if (!global.io) {
      console.log("global.io not found");
      return;
    }

    const payload = {
      success: true,
      audit_id,
      organization_id: organization_id || null,
      store_code: store_code || null,
      item,
    };

    global.io.to(`audit_${audit_id}`).emit("audit-item-scanned", payload);

    console.log(`audit-item-scanned emitted to audit_${audit_id}`);
  } catch (error) {
    console.error("emitAuditScan error:", error.message);
  }
};

export const emitAuditNotDone = ({
  audit_id,
  organization_id,
  store_code,
  item,
}) => {
  try {
    if (!global.io) {
      console.log("global.io not found");
      return;
    }

    const payload = {
      success: true,
      audit_id,
      organization_id: organization_id || null,
      store_code: store_code || null,
      item,
    };

    global.io.to(`audit_${audit_id}`).emit("audit-item-not-done", payload);

    console.log(`audit-item-not-done emitted to audit_${audit_id}`);
  } catch (error) {
    console.error("emitAuditNotDone error:", error.message);
  }
};

export const emitAuditSummary = ({ audit_id, summary }) => {
  try {
    if (!global.io) {
      console.log("global.io not found");
      return;
    }

    global.io.to(`audit_${audit_id}`).emit("audit-summary-updated", {
      success: true,
      audit_id,
      summary,
    });
  } catch (error) {
    console.error("emitAuditSummary error:", error.message);
  }
};

export const emitAuditSubmitted = ({ audit_id, data }) => {
  try {
    if (!global.io) {
      console.log("global.io not found");
      return;
    }

    global.io.to(`audit_${audit_id}`).emit("audit-submitted", {
      success: true,
      audit_id,
      data,
    });

    console.log(`audit-submitted emitted to audit_${audit_id}`);
  } catch (error) {
    console.error("emitAuditSubmitted error:", error.message);
  }
};