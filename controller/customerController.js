import Customer from "../model/Customer.js";
import sequelize from "../config/db.js";
import { Op } from "sequelize";

const normalizePhone = (phone) => {
  if (!phone) return null;
  return String(phone).replace(/\D/g, "").trim() || null;
};

/**
 * @desc    Create new customer
 * @route   POST /api/customer
 * @access  Private
 */
export const createCustomer = async (req, res) => {
  try {
    if (!req.user?.organization_id || !req.user?.store_code) {
      return res.status(401).json({
        success: false,
        message: "organization_id or store_code missing in req.user",
      });
    }

    const organization_id = req.user.organization_id;
    const store_code = String(req.user.store_code).trim().toUpperCase();
    const organization_level = req.user.organization_level || null;

    const {
      name,
      phone,
      address,
      pan_card_number,
      pincode,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    const cleanPhone = normalizePhone(phone);
    const cleanPan = pan_card_number ? String(pan_card_number).trim().toUpperCase() : null;

    // same entity/store_code ke andar duplicate check
    let existingCustomer = null;

    if (cleanPhone) {
      existingCustomer = await Customer.findOne({
        where: {
          store_code,
          phone: cleanPhone,
        },
      });
    }

    // optional PAN duplicate check same store_code ke andar
    if (!existingCustomer && cleanPan) {
      existingCustomer = await Customer.findOne({
        where: {
          store_code,
          pan_card_number: cleanPan,
        },
      });
    }

    if (existingCustomer) {
      return res.status(200).json({
        success: true,
        message: "Customer already exists for this entity",
        data: {
          id: existingCustomer.id,
          name: existingCustomer.name,
          phone: existingCustomer.phone,
          address: existingCustomer.address,
          pan_card_number: existingCustomer.pan_card_number,
          pincode: existingCustomer.pincode,
          organization_id: existingCustomer.organization_id,
          organization_level: existingCustomer.organization_level || organization_level,
          store_code: existingCustomer.store_code,
        },
      });
    }

    const customer = await Customer.create({
      name: String(name).trim(),
      phone: cleanPhone,
      address: address ? String(address).trim() : null,
      pan_card_number: cleanPan,
      pincode: pincode ? String(pincode).trim() : null,
      organization_id,
      organization_level,
      store_code,
    });

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        pan_card_number: customer.pan_card_number,
        pincode: customer.pincode,
        organization_id: customer.organization_id,
        organization_level: customer.organization_level,
        store_code: customer.store_code,
      },
    });
  } catch (err) {
    console.error("Create Customer Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create customer",
      error: err.message,
    });
  }
};

/**
 * @desc    Search customers with optional balance
 * @route   GET /api/customer/search?q=Johan&with_balance=true
 * @access  Private
 */
export const searchCustomers = async (req, res) => {
  try {
    if (!req.user?.organization_id || !req.user?.store_code) {
      return res.status(401).json({
        success: false,
        message: "organization_id or store_code missing in req.user",
      });
    }

    const { q = "", with_balance = "false" } = req.query;
    const organization_id = req.user.organization_id;
    const store_code = String(req.user.store_code).trim().toUpperCase();

    const whereClause = {
      organization_id,
      store_code,
    };

    if (q.trim()) {
      const search = q.trim();

      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { pan_card_number: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const customers = await Customer.findAll({
      where: whereClause,
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "pan_card_number",
        "pincode",
        "store_code",
        "organization_id",
        "organization_level",
        "createdAt",
      ],
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    if (with_balance === "true") {
      const withBalances = await Promise.all(
        customers.map(async (c) => {
          const ledger = await sequelize.query(
            `
            SELECT 
              COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0) AS total_debit,
              COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_credit
            FROM ledger_entries
            WHERE customer_id = :customer_id
              AND organization_id = :organization_id
              AND store_code = :store_code
          `,
            {
              replacements: {
                customer_id: c.id,
                organization_id,
                store_code,
              },
              type: sequelize.QueryTypes.SELECT,
            }
          );

          const debit = parseFloat(ledger?.[0]?.total_debit || 0);
          const credit = parseFloat(ledger?.[0]?.total_credit || 0);

          return {
            ...c.toJSON(),
            total_amount: Number(debit.toFixed(2)),
            received_amount: Number(credit.toFixed(2)),
            pending_amount: Number((debit - credit).toFixed(2)),
          };
        })
      );

      return res.status(200).json({
        success: true,
        count: withBalances.length,
        data: withBalances,
      });
    }

    return res.status(200).json({
      success: true,
      count: customers.length,
      data: customers,
    });
  } catch (err) {
    console.error("Search Customers Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to search customers",
      error: err.message,
    });
  }
};

/**
 * @desc    Get single customer
 * @route   GET /api/customer/:id
 * @access  Private
 */
export const getCustomer = async (req, res) => {
  try {
    if (!req.user?.organization_id || !req.user?.store_code) {
      return res.status(401).json({
        success: false,
        message: "organization_id or store_code missing in req.user",
      });
    }

    const { id } = req.params;
    const organization_id = req.user.organization_id;
    const store_code = String(req.user.store_code).trim().toUpperCase();

    const customer = await Customer.findOne({
      where: {
        id,
        organization_id,
        store_code,
      },
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "pan_card_number",
        "pincode",
        "organization_id",
        "organization_level",
        "store_code",
        "createdAt",
        "updatedAt",
      ],
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (err) {
    console.error("Get Customer Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer",
      error: err.message,
    });
  }
};