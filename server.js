import express from "express";
import "./model/index.js";
import cors from "cors";
import dotenv from "dotenv";
import { Sequelize } from "sequelize";
import { Server } from "socket.io";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import completeAuditRoutes from "./routes/completeAuditRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import item from "./routes/itemRoutes.js";
import dashboard from "./routes/dashboardRoutes.js";
import requestItem from "./routes/request.js";
import stock from "./routes/stockRoute.js";
import Profile from "./routes/userRoute.js";
import Audit from "./routes/Audit.js";
import District from "./routes/districtRoute.js";
import storemanage from "./routes/store_managment.js";
import ladger from "./routes/ledgerRoutes.js";
import Bill from "./routes/billRoute.js";
import Activity from "./routes/activityRoutes.js";
import exchange from "./routes/Exchange.js";
import tracklocation from "./routes/transferlocation.js";
import staff from "./routes/staffroutes.js";
import profile from "./routes/profileRoute.js";
import ledger from "./routes/headladger.js";
import itemTracker from "./routes/itemtracker.js";
// import { getGoldRate } from "./service/goldService.js";

import {
  getDashboardSummary,
} from "./controller/dashboardController.js";

import {
  getDistrictDashboard,
} from "./controller/districtController.js";

import {
  registerBillingSocket,
} from "./socket/billingSocket.js";

dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  integrations: [
    nodeProfilingIntegration(),
  ],

  tracesSampleRate: 1.0,

  profilesSampleRate: 1.0,

  environment:
    process.env.NODE_ENV || "development",
});

const app = express();

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://erp-dash-board.vercel.app",
    "https://erp-dash-board-stagging-iep5.vercel.app"
  ],

  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "store_code",
    "x-store-code",
    "organization_id",
    "x-organization-id",
  ],

  credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

const sequelize = new Sequelize(
  process.env.DATABASE_URL,
  {
    dialect: "postgres",
    protocol: "postgres",

    logging: false,

    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  }
);

/**
 * ROUTES
 */

app.use("/auth", authRoutes);

app.use("/item", item);

app.use("/dash", dashboard);

app.use("/request", requestItem);

app.use("/stock", stock);

app.use("/profile", Profile);

app.use("/audit", Audit);

app.use("/District", District);

app.use("/ladger", ladger);

app.use("/bill", Bill);

app.use("/Activity", Activity);

app.use("/exchange", exchange);
app.use("/complete-audit", completeAuditRoutes);
app.use("/track", tracklocation);

app.use("/Profile", profile);

app.use("/headstore/manage", storemanage);

app.use("/staff", staff);

app.use("/headledger", ledger);

app.use("/item-tracker", itemTracker);

/**
 * HEALTH CHECK
 */

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Server is running successfully",
  });
});

/**
 * SENTRY TEST ROUTE
 * Remove this route after testing
 */

app.get("/sentry-test", (req, res) => {
  throw new Error("Sentry Test Error");
});

/**
 * SENTRY EXPRESS ERROR HANDLER
 */

Sentry.setupExpressErrorHandler(app);

const PORT = process.env.PORT || 8000;

/**
 * SOCKET RESPONSE HELPER
 */

const makeSocketRes = (
  socket,
  eventName
) => {
  return {
    status: () =>
      makeSocketRes(socket, eventName),

    json: (data) => {
      socket.emit(eventName, data);
    },
  };
};

/**
 * LIVE DASHBOARD EMIT
 */

const emitDashboardData = async (
  socket,
  user
) => {
  try {
    if (!user) return;

    const fakeReq = {
      user,
    };

    await getDashboardSummary(
      fakeReq,
      makeSocketRes(
        socket,
        "dashboard-summary-live"
      )
    );

    if (
      user.role === "district_manager" ||
      String(
        user.organization_level || ""
      ).toLowerCase() === "district"
    ) {
      await getDistrictDashboard(
        fakeReq,
        makeSocketRes(
          socket,
          "district-dashboard-live"
        )
      );
    }

  } catch (error) {
    console.error(
      "emitDashboardData error:",
      error.message
    );
  }
};

/**
 * START SERVER
 */

async function startServer() {
  try {
    await sequelize.authenticate();

    console.log(
      "PostgreSQL connected successfully"
    );

    const server = app.listen(
      PORT,
      () => {
        console.log(
          `Server running on port ${PORT}`
        );
      }
    );

    const io = new Server(server, {
      cors: corsOptions,
    });

    global.io = io;

    io.on(
      "connection",
      async (socket) => {

        console.log(
          "Client connected:",
          socket.id
        );

        registerBillingSocket(socket);

        socket.on(
          "join-transfer-tracking",
          (transferId) => {
            try {
              if (!transferId) return;

              const roomName =
                `transfer_${transferId}`;

              socket.join(roomName);

              console.log(
                `Socket ${socket.id} joined ${roomName}`
              );

              socket.emit(
                "transfer-tracking-joined",
                {
                  success: true,
                  transfer_id: transferId,
                  room: roomName,
                }
              );

            } catch (error) {
              console.error(
                "join-transfer-tracking error:",
                error.message
              );
            }
          }
        );

        socket.on(
          "leave-transfer-tracking",
          (transferId) => {
            try {
              if (!transferId) return;

              const roomName =
                `transfer_${transferId}`;

              socket.leave(roomName);

              console.log(
                `Socket ${socket.id} left ${roomName}`
              );

            } catch (error) {
              console.error(
                "leave-transfer-tracking error:",
                error.message
              );
            }
          }
        );

        socket.on(
          "join-dashboard",
          async (userData) => {
            try {

              socket.data.user =
                userData;

              await emitDashboardData(
                socket,
                userData
              );

              /*const goldRate =
                await getGoldRate();

              socket.emit(
                "gold-rate-updated",
                {
                  price_gram_24k:
                    goldRate.price_gram_24k,

                  price_gram_22k:
                    goldRate.price_gram_22k,

                  price_gram_18k:
                    goldRate.price_gram_18k,

                  currency:
                    goldRate.currency,

                  timestamp:
                    goldRate.timestamp,
                }
              );
*/
            } catch (error) {
              console.error(
                "join-dashboard socket error:",
                error.message
              );
            }
          }
        );

        socket.on(
          "disconnect",
          () => {
            console.log(
              "Client disconnected:",
              socket.id
            );
          }
        );
      }
    );

    setInterval(async () => {
      try {
       /* const goldRate =
          await getGoldRate();

        io.emit(
          "gold-rate-updated",
          {
            price_gram_24k:
              goldRate.price_gram_24k,

            price_gram_22k:
              goldRate.price_gram_22k,

            price_gram_18k:
              goldRate.price_gram_18k,

            currency:
              goldRate.currency,

            timestamp:
              goldRate.timestamp,
          }
        );
*/
        const sockets =
          await io.fetchSockets();

        for (const socket of sockets) {

          const user =
            socket.data.user;

          if (!user) continue;

          await emitDashboardData(
            socket,
            user
          );
        }

        // console.log(
        //   "Live dashboard data emitted"
        // );

      } catch (error) {
        console.error(
          "Live dashboard socket error:",
          error.message
        );
      }
    }, 30000);

  } catch (error) {

    console.error(
      "Database connection failed:",
      error.message
    );
  }
}

startServer();
