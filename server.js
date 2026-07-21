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
import itemRoutes from "./routes/itemRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import requestItemRoutes from "./routes/request.js";
import stockRoutes from "./routes/stockRoute.js";

// Dono ko clear aur alag naam diya gaya hai
import userRoutes from "./routes/userRoute.js";
import profileRoutes from "./routes/profileRoute.js";

import districtRoutes from "./routes/districtRoute.js";
import storeManagementRoutes from "./routes/store_managment.js";
import ledgerRoutes from "./routes/ledgerRoutes.js";
import billRoutes from "./routes/billRoute.js";
import activityRoutes from "./routes/activityRoutes.js";
import exchangeRoutes from "./routes/Exchange.js";
import transferLocationRoutes from "./routes/transferlocation.js";
import staffRoutes from "./routes/staffroutes.js";
import headLedgerRoutes from "./routes/headladger.js";
import itemTrackerRoutes from "./routes/itemtracker.js";
import newAuditRoutes from "./routes/auditRoutes.js";

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

import {
  registerAuditSocket,
} from "./socket/auditSocket.js";

dotenv.config();

/*
  ==========================================
  SENTRY CONFIGURATION
  ==========================================
*/

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

/*
  ==========================================
  EXPRESS APP
  ==========================================
*/

const app = express();

/*
  ==========================================
  CORS CONFIGURATION
  ==========================================
*/

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://erp-dash-board.vercel.app",
    "https://erp-dash-board-stagging-iep5.vercel.app",
  ],

  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "store_code",
    "x-store-code",
    "organization_id",
    "x-organization-id",
    "x-billing-session-id",
  ],

  credentials: true,
};

app.use(cors(corsOptions));

/*
  ==========================================
  BODY PARSERS
  ==========================================
*/

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

/*
  ==========================================
  DATABASE CONNECTION
  ==========================================
*/

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

/*
  ==========================================
  API ROUTES
  ==========================================
*/

app.use("/auth", authRoutes);

app.use("/item", itemRoutes);

app.use("/dash", dashboardRoutes);

app.use("/request", requestItemRoutes);

app.use("/stock", stockRoutes);

/*
  userRoute.js ke routes

  Pehle:
  app.use("/profile", Profile);

  Ab:
*/
app.use("/user", userRoutes);

/*
  profileRoute.js ke routes

  Forgot Password endpoint:
  POST /profile/forgot-password
*/
app.use("/profile", profileRoutes);

app.use("/audit", newAuditRoutes);

app.use("/district", districtRoutes);

app.use("/ladger", ledgerRoutes);

app.use("/bill", billRoutes);

app.use("/activity", activityRoutes);

app.use("/exchange", exchangeRoutes);

app.use(
  "/complete-audit",
  completeAuditRoutes
);

app.use(
  "/track",
  transferLocationRoutes
);

app.use(
  "/headstore/manage",
  storeManagementRoutes
);

app.use("/staff", staffRoutes);

app.use(
  "/headledger",
  headLedgerRoutes
);

app.use(
  "/item-tracker",
  itemTrackerRoutes
);

/*
  ==========================================
  HEALTH CHECK
  ==========================================
*/

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Server is running successfully",
  });
});

/*
  ==========================================
  ROUTE NOT FOUND
  ==========================================
*/

app.use((req, res, next) => {
  return res.status(404).json({
    success: false,
    message: "API route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

/*
  ==========================================
  SENTRY TEST ROUTE
  Remove after testing
  ==========================================
*/

/*
app.get("/sentry-test", (req, res) => {
  throw new Error("Sentry Test Error");
});
*/

/*
  ==========================================
  SENTRY EXPRESS ERROR HANDLER
  ==========================================
*/

Sentry.setupExpressErrorHandler(app);

/*
  ==========================================
  GLOBAL ERROR HANDLER
  ==========================================
*/

app.use((error, req, res, next) => {
  console.error("GLOBAL SERVER ERROR:", error);

  return res.status(
    error.status || 500
  ).json({
    success: false,
    message:
      error.message ||
      "Internal server error",
  });
});

/*
  ==========================================
  PORT
  ==========================================
*/

const PORT =
  process.env.PORT || 8000;

/*
  ==========================================
  SOCKET RESPONSE HELPER
  ==========================================
*/

const makeSocketRes = (
  socket,
  eventName
) => {
  return {
    status: () =>
      makeSocketRes(
        socket,
        eventName
      ),

    json: (data) => {
      socket.emit(
        eventName,
        data
      );
    },
  };
};

/*
  ==========================================
  LIVE DASHBOARD EMIT
  ==========================================
*/

const emitDashboardData = async (
  socket,
  user
) => {
  try {
    if (!user) {
      return;
    }

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
      user.role ===
        "district_manager" ||
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

/*
  ==========================================
  START SERVER
  ==========================================
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

    /*
      ========================================
      SOCKET.IO SETUP
      ========================================
    */

    const io = new Server(
      server,
      {
        cors: corsOptions,
      }
    );

    global.io = io;

    io.on(
      "connection",
      async (socket) => {
        console.log(
          "Client connected:",
          socket.id
        );

        registerBillingSocket(
          socket
        );

        registerAuditSocket(
          socket
        );

        /*
          ====================================
          JOIN TRANSFER TRACKING
          ====================================
        */

        socket.on(
          "join-transfer-tracking",
          (transferId) => {
            try {
              if (!transferId) {
                return;
              }

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
                  transfer_id:
                    transferId,
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

        /*
          ====================================
          LEAVE TRANSFER TRACKING
          ====================================
        */

        socket.on(
          "leave-transfer-tracking",
          (transferId) => {
            try {
              if (!transferId) {
                return;
              }

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

        /*
          ====================================
          JOIN DASHBOARD
          ====================================
        */

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

              /*
              const goldRate =
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

        /*
          ====================================
          SOCKET DISCONNECT
          ====================================
        */

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

    /*
      ========================================
      LIVE DASHBOARD INTERVAL
      ========================================
    */

    setInterval(
      async () => {
        try {
          /*
          const goldRate =
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

          for (
            const socket of sockets
          ) {
            const user =
              socket.data.user;

            if (!user) {
              continue;
            }

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
      },
      30000
    );
  } catch (error) {
    console.error(
      "Database connection failed:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
