import express from "express";
import sequelize from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import itemRoutes from "./routes/itemRoutes.js";
import capitalRoutes from "./routes/capitalRoutes.js";
import stateRoutes from "./routes/stateRoutes.js";


const app = express();

app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/capital", capitalRoutes);
app.use("/api/state", stateRoutes);
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log("DB Connected");

    await sequelize.sync({ alter: true }); // ✅ safe sync

    app.listen(process.env.PORT || 5000, () => {
      console.log(`Server running on port ${process.env.PORT || 5000}`);
    });

  } catch (error) {
    console.log("Error:", error);
  }
};

startServer();