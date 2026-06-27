import express from "express";
const router = express.Router();

/**
 * @swagger
 * /customers:
 *   get:
 *     summary: Get all customers
 *     tags: [Customer]
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/", (req, res) => {
  res.json([{ id: 1, name: "Rahul" }]);
});

/**
 * @swagger
 * /customers:
 *   post:
 *     summary: Create customer
 *     tags: [Customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             name: Rahul
 *             phone: 9876543210
 *     responses:
 *       201:
 *         description: Created
 */
router.post("/", (req, res) => {
  res.status(201).json({ message: "Customer created" });
});

export default router;