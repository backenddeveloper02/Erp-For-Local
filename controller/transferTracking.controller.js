// import StockTransfer from "../model/stockTransfer.js";
// import TransferLocation from "../model/TransferLocation.js";

// const toNumber = (v) => {
//   const n = Number(v);
//   return Number.isFinite(n) ? n : 0;
// };

// const generateFakeRoute = (startLat, startLng, km = 50, points = 50) => {
//   const endLat = startLat + km / 111; // approx 50 km north
//   const endLng = startLng + 0.05;

//   const route = [];

//   for (let i = 0; i < points; i++) {
//     const ratio = i / (points - 1);

//     route.push({
//       latitude: startLat + (endLat - startLat) * ratio,
//       longitude: startLng + (endLng - startLng) * ratio,
//       source: "fake",
//     });
//   }

//   return route;
// };

// export const startFakeTracking = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { start_lat, start_lng } = req.body;

//     const transfer = await StockTransfer.findByPk(id);

//     if (!transfer) {
//       return res.status(404).json({
//         success: false,
//         message: "Transfer not found",
//       });
//     }

//     if (transfer.status !== "in_transit") {
//       return res.status(400).json({
//         success: false,
//         message: "Tracking can start only for in_transit transfer",
//       });
//     }

//     const lat = toNumber(start_lat);
//     const lng = toNumber(start_lng);

//     if (!lat || !lng) {
//       return res.status(400).json({
//         success: false,
//         message: "start_lat and start_lng are required",
//       });
//     }

//     await TransferLocation.destroy({
//       where: { transfer_id: transfer.id },
//     });

//     const route = generateFakeRoute(lat, lng, 50, 50).map((p) => ({
//       transfer_id: transfer.id,
//       latitude: p.latitude,
//       longitude: p.longitude,
//       source: "fake",
//     }));

//     await TransferLocation.bulkCreate(route);

//     return res.status(200).json({
//       success: true,
//       message: "Fake tracking route started successfully",
//       data: {
//         transfer_id: transfer.id,
//         transfer_no: transfer.transfer_no,
//         total_points: route.length,
//       },
//     });
//   } catch (error) {
//     console.error("startFakeTracking error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to start fake tracking",
//       error: error.message,
//     });
//   }
// };

// export const getTransferRoute = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const transfer = await StockTransfer.findByPk(id);

//     if (!transfer) {
//       return res.status(404).json({
//         success: false,
//         message: "Transfer not found",
//       });
//     }

//     const locations = await TransferLocation.findAll({
//       where: { transfer_id: id },
//       order: [["recorded_at", "ASC"]],
//     });

//     const covered_route = locations.map((loc) => ({
//       latitude: Number(loc.latitude),
//       longitude: Number(loc.longitude),
//       recorded_at: loc.recorded_at,
//       source: loc.source,
//     }));

//     const current_location =
//       covered_route.length > 0
//         ? covered_route[covered_route.length - 1]
//         : null;

//     return res.status(200).json({
//       success: true,
//       data: {
//         transfer_id: transfer.id,
//         transfer_no: transfer.transfer_no,
//         status: transfer.status,
//         current_location,
//         covered_route,
//       },
//     });
//   } catch (error) {
//     console.error("getTransferRoute error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch transfer route",
//       error: error.message,
//     });
//   }
// };






import axios from "axios";
import { QueryTypes } from "sequelize";
import sequelize from "../config/db.js";
import StockTransfer from "../model/stockTransfer.js";
import StockRequest from "../model/StockRequest.js";
import TransferLocation from "../model/TransferLocation.js";

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isValidLatLng = (lat, lng) =>
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

const getLatLngFromAddress = async (address) => {
  try {
    if (!address || !process.env.GOOGLE_MAPS_API_KEY) return null;

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      }
    );

    const data = response.data;

    if (data.status !== "OK" || !data.results?.length) return null;

    const location = data.results[0].geometry.location;

    return {
      latitude: location.lat,
      longitude: location.lng,
    };
  } catch (error) {
    console.error("getLatLngFromAddress error:", error.message);
    return null;
  }
};

/**
 * POST /api/transfers/tracking/:id/start
 * Dispatch/start ke time call hogi.
 */

export const startLiveTracking = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_lat, start_lng } = req.body;

    const transfer = await StockTransfer.findByPk(id);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    if (!["dispatched", "in_transit"].includes(transfer.status)) {
      return res.status(400).json({
        success: false,
        message: "Tracking can start only for dispatched or in_transit transfer",
      });
    }

    const lat = toNumber(start_lat);
    const lng = toNumber(start_lng);

    if (lat === null || lng === null || !isValidLatLng(lat, lng)) {
      return res.status(400).json({
        success: false,
        message: "Valid start_lat and start_lng are required",
      });
    }

    let finalDeliveryAddress = transfer.delivery_address || null;

    if (!finalDeliveryAddress && transfer.request_id) {
      const request = await StockRequest.findByPk(transfer.request_id);

      if (request) {
        finalDeliveryAddress =
          request.delivery_address ||
          request.address ||
          request.to_address ||
          null;
      }
    }

    let geo = null;

    if (
      finalDeliveryAddress &&
      !transfer.drop_lat &&
      !transfer.drop_lng &&
      !transfer.destination_latitude &&
      !transfer.destination_longitude
    ) {
      geo = await getLatLngFromAddress(finalDeliveryAddress);
    }

    const dropLat =
      geo?.latitude ||
      transfer.drop_lat ||
      transfer.destination_latitude ||
      null;

    const dropLng =
      geo?.longitude ||
      transfer.drop_lng ||
      transfer.destination_longitude ||
      null;

    const location = await TransferLocation.create({
      transfer_id: transfer.id,
      latitude: lat,
      longitude: lng,
      source: "live",
      recorded_at: new Date(),
    });

    await sequelize.query(
      `
      UPDATE stock_transfers
      SET
        status = 'in_transit',
        is_tracking_active = true,
        tracking_started_at = COALESCE(tracking_started_at, NOW()),
        tracking_stopped_at = NULL,

        pickup_lat = COALESCE(pickup_lat, :pickup_lat),
        pickup_lng = COALESCE(pickup_lng, :pickup_lng),

        drop_lat = :drop_lat,
        drop_lng = :drop_lng,

        destination_latitude = :drop_lat,
        destination_longitude = :drop_lng,

        last_latitude = :last_latitude,
        last_longitude = :last_longitude,
        last_tracked_at = :last_tracked_at,

        delivery_address = :delivery_address,
        fake_tracking_enabled = false,
        updated_at = NOW()
      WHERE id = :id
      `,
      {
        replacements: {
          id: transfer.id,
          pickup_lat: lat,
          pickup_lng: lng,
          drop_lat: dropLat,
          drop_lng: dropLng,
          last_latitude: lat,
          last_longitude: lng,
          last_tracked_at: location.recorded_at,
          delivery_address: finalDeliveryAddress,
        },
        type: QueryTypes.UPDATE,
      }
    );

    const updatedTransfer = await StockTransfer.findByPk(id);

    return res.status(200).json({
      success: true,
      message: "Live tracking started successfully",
      data: {
        transfer_id: updatedTransfer.id,
        transfer_no: updatedTransfer.transfer_no,
        status: updatedTransfer.status,
        is_tracking_active: updatedTransfer.is_tracking_active,
        current_location: {
          latitude: Number(updatedTransfer.last_latitude),
          longitude: Number(updatedTransfer.last_longitude),
          recorded_at: updatedTransfer.last_tracked_at,
        },
        destination: {
          address: updatedTransfer.delivery_address,
          latitude: updatedTransfer.drop_lat
            ? Number(updatedTransfer.drop_lat)
            : null,
          longitude: updatedTransfer.drop_lng
            ? Number(updatedTransfer.drop_lng)
            : null,
        },
      },
    });
  } catch (error) {
    console.error("startLiveTracking error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to start live tracking",
      error: error.message,
    });
  }
};
/**
 * POST /api/transfers/tracking/:id/location
 * Driver app har 5-10 second me call karegi.
 */
export const updateLiveLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, lat, lng, speed, heading, accuracy, battery_level } = req.body;

    const [transfer] = await sequelize.query(
      `
      SELECT *
      FROM stock_transfers
      WHERE id = :id
      LIMIT 1
      `,
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      }
    );

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    if (transfer.status !== "in_transit") {
      return res.status(400).json({
        success: false,
        message: "Location update allowed only for in_transit transfer",
      });
    }

    if (transfer.is_tracking_active !== true) {
      return res.status(400).json({
        success: false,
        message: "Tracking is not active for this transfer",
      });
    }

    const finalLat = toNumber(latitude ?? lat);
    const finalLng = toNumber(longitude ?? lng);

    if (
      finalLat === null ||
      finalLng === null ||
      !isValidLatLng(finalLat, finalLng)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid latitude and longitude are required",
      });
    }

    const lastLat = transfer.last_latitude ? Number(transfer.last_latitude) : null;
    const lastLng = transfer.last_longitude ? Number(transfer.last_longitude) : null;

    const isSamePoint =
      lastLat !== null &&
      lastLng !== null &&
      Number(lastLat.toFixed(6)) === Number(finalLat.toFixed(6)) &&
      Number(lastLng.toFixed(6)) === Number(finalLng.toFixed(6));

    let location = null;

    if (!isSamePoint) {
      location = await TransferLocation.create({
        transfer_id: transfer.id,
        latitude: finalLat,
        longitude: finalLng,
        speed: speed || null,
        heading: heading || null,
        accuracy: accuracy || null,
        battery_level: battery_level || null,
        source: "live",
        recorded_at: new Date(),
      });
    }

    const recordedAt = location?.recorded_at || new Date();

    await sequelize.query(
      `
      UPDATE stock_transfers
      SET
        last_latitude = :last_latitude,
        last_longitude = :last_longitude,
        last_tracked_at = :last_tracked_at,
        updated_at = NOW()
      WHERE id = :id
      `,
      {
        replacements: {
          id: transfer.id,
          last_latitude: finalLat,
          last_longitude: finalLng,
          last_tracked_at: recordedAt,
        },
        type: QueryTypes.UPDATE,
      }
    );

    const destinationLat = transfer.drop_lat
      ? Number(transfer.drop_lat)
      : transfer.destination_latitude
      ? Number(transfer.destination_latitude)
      : null;

    const destinationLng = transfer.drop_lng
      ? Number(transfer.drop_lng)
      : transfer.destination_longitude
      ? Number(transfer.destination_longitude)
      : null;

    const payload = {
      transfer_id: transfer.id,
      transfer_no: transfer.transfer_no,
      status: transfer.status,
      is_tracking_active: transfer.is_tracking_active,
      current_location: {
        latitude: finalLat,
        longitude: finalLng,
        speed: speed || null,
        heading: heading || null,
        accuracy: accuracy || null,
        battery_level: battery_level || null,
        recorded_at: recordedAt,
        source: "live",
      },
      destination: {
        address: transfer.delivery_address || null,
        latitude: destinationLat,
        longitude: destinationLng,
      },
      duplicate_point_skipped: isSamePoint,
      updated_at: Date.now(),
    };

if (global.io) {
  global.io
    .to(`transfer_${transfer.id}`)
    .emit(`transfer_tracking_${transfer.id}`, payload);
}


    return res.status(200).json({
      success: true,
      message: isSamePoint
        ? "Live location already up to date"
        : "Live location updated successfully",
      data: payload,
    });
  } catch (error) {
    console.error("updateLiveLocation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update live location",
      error: error.message,
    });
  }
};

/**
 * GET /api/transfers/tracking/:id/route
 * Frontend map ke liye full route.
 */
export const getTransferRoute = async (req, res) => {
  try {
    const { id } = req.params;

    const transfer = await StockTransfer.findByPk(id);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    const locations = await TransferLocation.findAll({
      where: { transfer_id: id },
      order: [["recorded_at", "ASC"]],
    });

    const covered_route = locations.map((loc) => ({
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      speed: loc.speed || null,
      heading: loc.heading || null,
      accuracy: loc.accuracy || null,
      battery_level: loc.battery_level || null,
      recorded_at: loc.recorded_at,
      source: loc.source,
    }));

    const current_location =
      covered_route.length > 0
        ? covered_route[covered_route.length - 1]
        : transfer.last_latitude && transfer.last_longitude
        ? {
            latitude: Number(transfer.last_latitude),
            longitude: Number(transfer.last_longitude),
            recorded_at: transfer.last_tracked_at,
            source: "last_known",
          }
        : null;

    return res.status(200).json({
      success: true,
      data: {
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        status: transfer.status,
        is_tracking_active: transfer.is_tracking_active,

        pickup: {
          latitude: transfer.pickup_lat ? Number(transfer.pickup_lat) : null,
          longitude: transfer.pickup_lng ? Number(transfer.pickup_lng) : null,
        },

        current_location,

        destination: {
          address: transfer.delivery_address || null,
          latitude: transfer.drop_lat
            ? Number(transfer.drop_lat)
            : transfer.destination_latitude
            ? Number(transfer.destination_latitude)
            : null,
          longitude: transfer.drop_lng
            ? Number(transfer.drop_lng)
            : transfer.destination_longitude
            ? Number(transfer.destination_longitude)
            : null,
        },

        covered_route,
      },
    });
  } catch (error) {
    console.error("getTransferRoute error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transfer route",
      error: error.message,
    });
  }
};

/**
 * POST /api/transfers/tracking/:id/stop
 */
export const stopLiveTracking = async (req, res) => {
  try {
    const { id } = req.params;

    const transfer = await StockTransfer.findByPk(id);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    await transfer.update({
      is_tracking_active: false,
      tracking_stopped_at: new Date(),
    });

    const payload = {
      transfer_id: transfer.id,
      transfer_no: transfer.transfer_no,
      status: transfer.status,
      is_tracking_active: false,
      tracking_stopped_at: transfer.tracking_stopped_at,
    };

    if (global.io) {
      global.io.emit(`transfer_tracking_${transfer.id}`, payload);
      global.io.emit(`transfer_status_${transfer.id}`, payload);
    }

    return res.status(200).json({
      success: true,
      message: "Live tracking stopped successfully",
      data: payload,
    });
  } catch (error) {
    console.error("stopLiveTracking error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to stop live tracking",
      error: error.message,
    });
  }
};

export const getTransferLiveLocation = async (req, res) => {
  try {
    const { id } = req.params;

    const [transfer] = await sequelize.query(
      `SELECT * FROM stock_transfers WHERE id = :id LIMIT 1`,
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      }
    );

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    const lat = transfer.last_latitude ? Number(transfer.last_latitude) : null;
    const lng = transfer.last_longitude ? Number(transfer.last_longitude) : null;

    const destinationLat = transfer.drop_lat
      ? Number(transfer.drop_lat)
      : transfer.destination_latitude
      ? Number(transfer.destination_latitude)
      : null;

    const destinationLng = transfer.drop_lng
      ? Number(transfer.drop_lng)
      : transfer.destination_longitude
      ? Number(transfer.destination_longitude)
      : null;

    const payload = {
      transfer_id: transfer.id,
      transfer_no: transfer.transfer_no,
      status: transfer.status,
      is_tracking_active: transfer.is_tracking_active,

      current_location: {
        latitude: lat,
        longitude: lng,
        recorded_at: transfer.last_tracked_at,
        source: "last_known",
      },

      destination: {
        address: transfer.delivery_address || null,
        latitude: destinationLat,
        longitude: destinationLng,
      },

      updated_at: Date.now(),
    };

    return res.status(200).json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.error("getTransferLiveLocation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch live location",
      error: error.message,
    });
  }
};