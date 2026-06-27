import express from "express";
import { addState, getAllItems } from "../controllers/capitalController.js";
import { fakeAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

//  Capital Only Routes
router.post("/add-state", fakeAuth, addState);
router.get("/items", fakeAuth, getAllItems);

export default router;