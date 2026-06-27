export const isHeadUser = (user) => {
  const role = String(user?.role || "").toLowerCase();
  const level = String(user?.organization_level || "").toLowerCase();

  return (
    level === "head" ||
    level === "head_office" ||
    role === "super_admin" ||
    role === "admin" ||
    role === "super_stock_manager"
  );
};

export const isForwardedDirectDelivery = (request) => {
  return (
    request?.request_source === "forwarded" &&
    request?.parent_request_id &&
    request?.final_to_organization_id
  );
};

export const buildRequestFlowMeta = (request, user) => {
  const isHead = isHeadUser(user);
  const isForwarded = isForwardedDirectDelivery(request);

  const requestStatus = String(request?.status || "").toLowerCase();
  const transferStatus = String(request?.transfer?.status || "").toLowerCase();

  if (
    isHead &&
    !isForwarded &&
    requestStatus === "pending" &&
    Number(request.to_organization_id) === Number(user.organization_id)
  ) {
    return {
      flow_type: "head_received_request",
      next_action: "forward_to_district",
      button_label: "Assign District",
      action_hint: "Head can assign this request to another district.",
      delivery_location: null,
    };
  }

  if (
    isForwarded &&
    requestStatus === "pending" &&
    Number(request.to_organization_id) === Number(user.organization_id)
  ) {
    return {
      flow_type: "forwarded_direct_delivery",
      next_action: "dispatch_to_final_location",
      button_label: `Dispatch to ${request.final_to_store_name || "Final Location"}`,
      action_hint: "Dispatch stock directly to final delivery location.",
      delivery_location: {
        organization_id: request.final_to_organization_id,
        store_code: request.final_to_store_code,
        store_name: request.final_to_store_name,
        address: request.final_to_address,
        city: request.final_to_city,
        state: request.final_to_state,
        pincode: request.final_to_pincode,
        latitude: request.final_to_latitude ? Number(request.final_to_latitude) : null,
        longitude: request.final_to_longitude ? Number(request.final_to_longitude) : null,
      },
    };
  }

  if (["dispatched", "in_transit"].includes(transferStatus)) {
    return {
      flow_type: isForwarded ? "forwarded_direct_delivery" : "normal_transfer",
      next_action: "track_transfer",
      button_label: "Track Delivery",
      action_hint: "Transfer is in transit.",
      delivery_location: isForwarded
        ? {
            organization_id: request.final_to_organization_id,
            store_code: request.final_to_store_code,
            store_name: request.final_to_store_name,
            address: request.final_to_address,
          }
        : null,
    };
  }

  return {
    flow_type: isForwarded ? "forwarded_direct_delivery" : "normal_request",
    next_action: "view_details",
    button_label: "View Details",
    action_hint: "Open request details.",
    delivery_location: null,
  };
};