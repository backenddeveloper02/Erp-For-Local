// socket/billingSocket.js

export const registerBillingSocket = (socket) => {
  socket.on("join-billing-session", (roomName) => {
    try {
      if (!roomName) return;

      const cleanRoom = String(roomName).trim();

      if (!cleanRoom.startsWith("billing_session_")) {
        console.log("Invalid billing session room:", cleanRoom);
        return;
      }

      socket.join(cleanRoom);

      console.log(`Socket ${socket.id} joined ${cleanRoom}`);

      socket.emit("billing-session-joined", {
        success: true,
        room: cleanRoom,
        socket_id: socket.id,
      });
    } catch (error) {
      console.error("join-billing-session error:", error.message);
    }
  });

  socket.on("join-billing-store", (storeCode) => {
    try {
      if (!storeCode) return;

      const cleanStoreCode = String(storeCode).trim().toUpperCase();
      const roomName = `billing_store_${cleanStoreCode}`;

      socket.join(roomName);

      console.log(`Socket ${socket.id} joined ${roomName}`);

      socket.emit("billing-store-joined", {
        success: true,
        room: roomName,
      });
    } catch (error) {
      console.error("join-billing-store error:", error.message);
    }
  });

  socket.on("join-billing-org", (organizationId) => {
    try {
      if (!organizationId) return;

      const roomName = `billing_org_${organizationId}`;

      socket.join(roomName);

      console.log(`Socket ${socket.id} joined ${roomName}`);

      socket.emit("billing-org-joined", {
        success: true,
        room: roomName,
      });
    } catch (error) {
      console.error("join-billing-org error:", error.message);
    }
  });
};

export const emitBillingScan = ({
  organization_id,
  store_code,
  session_id,
  item,
}) => {
  try {
    if (!global.io) {
      console.log("global.io not found");
      return;
    }

    const cleanStoreCode = store_code
      ? String(store_code).trim().toUpperCase()
      : null;

    const cleanSessionId = session_id
      ? String(session_id).trim()
      : null;

    const payload = {
      success: true,
      organization_id: organization_id || null,
      store_code: cleanStoreCode,
      session_id: cleanSessionId,
      item,
    };

    if (cleanSessionId) {
      global.io
        .to(`billing_session_${cleanSessionId}`)
        .emit("billing-item-scanned", payload);

      console.log(
        `billing-item-scanned emitted to billing_session_${cleanSessionId}`
      );
    }

    if (cleanStoreCode) {
      global.io
        .to(`billing_store_${cleanStoreCode}`)
        .emit("billing-item-scanned", payload);
    }

    if (organization_id) {
      global.io
        .to(`billing_org_${organization_id}`)
        .emit("billing-item-scanned", payload);
    }
  } catch (error) {
    console.error("emitBillingScan error:", error.message);
  }
};