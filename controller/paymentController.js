import { Op } from "sequelize";
import {
  Payment,
  Invoice,
  Transaction,
  TransactionEntry,
  LedgerEntry,
  Customer,
  sequelize,
} from "../model/index.js";
import Store from "../model/Store.js"
const ALLOWED_PAYMENT_ROLES = [
  "manager",
  "tl",
  "admin",
  "retail_manager",
  "retail_tl",
  "district_manager",
  "district_tl",
  "super_admin",
  "finance",
  "super_sales_manager",
  "sales_admin",
];

const normalize = (value) => String(value || "").trim().toLowerCase();

const getUserRole = (user) => {
  if (!user) return null;
  if (typeof user.role === "string") return normalize(user.role);
  if (user.role?.name) return normalize(user.role.name);
  return null;
};

const canManagePayments = (user) => {
  const role = getUserRole(user);
  return ALLOWED_PAYMENT_ROLES.includes(role);
};

const validateInvoiceAccess = async (invoice, user) => {
  if (!invoice || !user) return false;

  const role = getUserRole(user);
  const level = normalize(user.organization_level);

  if (!canManagePayments(user)) return false;

  const fullAccessRoles = [
    "super_admin",
    "admin",
    "finance",
    "super_sales_manager",
    "sales_admin",

    // added: every retail store access
    "retail_manager",
    "retail_tl",
  ];

  if (fullAccessRoles.includes(role)) {
    return true;
  }

  const userOrgId = Number(user.organization_id);
  const invoiceOrgId = Number(invoice.organization_id);

  const districtRoles = ["district_manager", "district_tl"];

  if (districtRoles.includes(role) || level === "district") {
    return userOrgId === invoiceOrgId;
  }

  return userOrgId === invoiceOrgId;
};

/**
 * @desc    Create payment + update invoice + ledger credit + accounting
 * @route   POST /api/payment
 */
export const createPayment = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    if (!req.user) {
      await t.rollback();
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // if (!canManagePayments(req.user)) {
    //   await t.rollback();
    //   return res.status(403).json({
    //     success: false,
    //     message: "You are not allowed to create payment entries",
    //   });
    // }

    const {
      invoice_id,
      amount,
      payment_method = "CASH",
      financier = "Self",
      txn_id = null,
      payment_date = null,
      remarks = null,
    } = req.body;

    const organization_id = req.user.organization_id;
    const operator =
      req.user.name || req.user.username || req.user.email || "System";

    if (!organization_id) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "organization_id missing in req.user",
      });
    }

    if (!invoice_id || !amount) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "invoice_id and amount are required",
      });
    }

    const invoice = await Invoice.findByPk(invoice_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!invoice) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (!validateInvoiceAccess(invoice, req.user)) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this invoice",
      });
    }

    const paymentAmount = parseFloat(amount);
    const totalAmount = parseFloat(invoice.total_amount || 0);
    const receivedAmount = parseFloat(invoice.received_amount || 0);
    const pendingAmount = parseFloat(invoice.pending_amount || 0);

    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount",
      });
    }

    if (paymentAmount > pendingAmount) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Overpayment not allowed. Pending amount: ${pendingAmount.toFixed(
          2
        )}`,
      });
    }

    // 1. Create payment
    const payment = await Payment.create(
      {
        invoice_id: invoice.id,
        customer_id: invoice.customer_id || null, // if column exists in payments table
        organization_id: invoice.organization_id,
        store_code: invoice.store_code || null,
        amount: paymentAmount.toFixed(2),
        payment_method,
        financier,
        txn_id,
        operator,
        payment_date: payment_date || new Date(),
      },
      { transaction: t }
    );

    // 2. Update invoice amounts
    const newReceived = receivedAmount + paymentAmount;
    const newPending = totalAmount - newReceived;

    invoice.received_amount = newReceived.toFixed(2);
    invoice.pending_amount = newPending.toFixed(2);
    invoice.status = newPending <= 0 ? "PAID" : "PARTIAL";

    await invoice.save({ transaction: t });

    // 3. Ledger entry
    await LedgerEntry.create(
      {
        customer_id: invoice.customer_id,
        organization_id: invoice.organization_id,
        store_code: invoice.store_code || null,
        type: "CREDIT",
        amount: paymentAmount.toFixed(2),
        reference_type: "PAYMENT",
        reference_id: payment.id,
        description: `Payment received for Invoice ${invoice.invoice_number}`,
      },
      { transaction: t }
    );

    // 4. Optional accounting transaction
    let txn = null;
    let accounting_status = "not_created";

    try {
      txn = await Transaction.create(
        {
          transaction_date: payment_date || new Date(),
          transaction_type: "PAYMENT_RECEIVED",
          organization_id: invoice.organization_id,
          reference_id: payment.id,
          reference_type: "PAYMENT",
          remarks:
            remarks || `Payment received for invoice ${invoice.invoice_number}`,
        },
        { transaction: t }
      );

      await TransactionEntry.bulkCreate(
        [
          {
            transaction_id: txn.id,
            account_id: 1,
            debit: paymentAmount.toFixed(2),
            credit: "0.00",
          },
          {
            transaction_id: txn.id,
            account_id: 2,
            debit: "0.00",
            credit: paymentAmount.toFixed(2),
          },
        ],
        { transaction: t }
      );

      accounting_status = "created";
    } catch (txnError) {
      console.error("Accounting transaction skipped:", txnError.message);
      accounting_status = "skipped";
    }

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        payment_id: payment.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id: invoice.customer_id,
        amount: paymentAmount.toFixed(2),
        payment_method,
        financier,
        txn_id,
        operator,
        invoice_status: invoice.status,
        received_amount: invoice.received_amount,
        pending_amount: invoice.pending_amount,
        accounting_status,
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("Payment Error:", err);

    return res.status(400).json({
      success: false,
      message: "Failed to record payment",
      error: err.message,
    });
  }
};

/**
 * @desc    Get payments of one invoice
 * @route   GET /api/payment/invoice/:invoice_id
 */

export const getPaymentsByInvoice = async (req, res) => {
  try {
    const { invoice_id } = req.params;

    if (!req.user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "organization_id missing in req.user",
      });
    }

    const invoice = await Invoice.findByPk(invoice_id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const hasAccess = await validateInvoiceAccess(invoice, req.user);

    // // if (!hasAccess) {
    // //   return res.status(403).json({
    // //     success: false,
    // //     message: "You are not allowed to access this invoice payments",
    // //   });
    // }

    // 🔥 FIX: removed organization_id filter
    const payments = await Payment.findAll({
      where: {
        invoice_id: invoice.id,
      },
      order: [["payment_date", "DESC"]],
    });

    const totalPaid = payments.reduce(
      (sum, p) => sum + parseFloat(p.amount || 0),
      0
    );

    return res.status(200).json({
      success: true,
      invoice: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id: invoice.customer_id,
        total_amount: invoice.total_amount,
        received_amount: invoice.received_amount,
        pending_amount: invoice.pending_amount,
        status: invoice.status,
        store_code: invoice.store_code,
      },
      count: payments.length,
      total_paid: totalPaid.toFixed(2),
      data: payments.map((p) => ({
        id: p.id,
        invoice_id: p.invoice_id,
        amount: parseFloat(p.amount || 0).toFixed(2),
        payment_method: p.payment_method,
        financier: p.financier,
        txn_id: p.txn_id,
        operator: p.operator,
        payment_date: p.payment_date,
        store_code: p.store_code,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    console.error("Get Payments By Invoice Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invoice payments",
      error: err.message,
    });
  }
};

/**
 * @desc    Get customer invoices + payment summary
 * @route   GET /api/payment/customer/:customer_id
 */
export const getPaymentsByCustomer = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const organization_id = req.user?.organization_id;
    const level = normalizeLevel(req.user?.organization_level);
    const userStoreCode = req.user?.store_code || null;

    if (!organization_id) {
      return res.status(401).json({
        success: false,
        message: "organization_id missing in req.user",
      });
    }

    const customerWhere = {
      id: customer_id,
      organization_id,
    };

    if (level === "retail" && userStoreCode) {
      customerWhere.store_code = userStoreCode;
    }

    const customer = await Customer.findOne({
      where: customerWhere,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const invoiceWhere = {
      customer_id,
      organization_id,
    };

    if (level === "retail" && userStoreCode) {
      invoiceWhere.store_code = userStoreCode;
    }

    const invoices = await Invoice.findAll({
      where: invoiceWhere,
      order: [["invoice_date", "DESC"]],
    });

    const invoiceIds = invoices.map((inv) => inv.id);

    const payments = invoiceIds.length
      ? await Payment.findAll({
          where: {
            invoice_id: { [Op.in]: invoiceIds },
            organization_id,
          },
          order: [["payment_date", "DESC"]],
        })
      : [];

    const paymentsByInvoice = {};
    for (const payment of payments) {
      if (!paymentsByInvoice[payment.invoice_id]) {
        paymentsByInvoice[payment.invoice_id] = [];
      }
      paymentsByInvoice[payment.invoice_id].push({
        id: payment.id,
        amount: parseFloat(payment.amount).toFixed(2),
        payment_method: payment.payment_method,
        financier: payment.financier,
        txn_id: payment.txn_id,
        operator: payment.operator,
        payment_date: payment.payment_date,
        createdAt: payment.createdAt,
      });
    }

    const totalInvoiceAmount = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.total_amount || 0),
      0
    );
    const totalReceivedAmount = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.received_amount || 0),
      0
    );
    const totalPendingAmount = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.pending_amount || 0),
      0
    );

    return res.status(200).json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        organization_id: customer.organization_id,
        store_code: customer.store_code,
      },
      summary: {
        total_invoices: invoices.length,
        total_invoice_amount: totalInvoiceAmount.toFixed(2),
        total_received_amount: totalReceivedAmount.toFixed(2),
        total_pending_amount: totalPendingAmount.toFixed(2),
      },
      data: invoices.map((invoice) => ({
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        bill_id: invoice.bill_id,
        invoice_date: invoice.invoice_date,
        total_amount: invoice.total_amount,
        received_amount: invoice.received_amount,
        pending_amount: invoice.pending_amount,
        status: invoice.status,
        store_code: invoice.store_code,
        payments: paymentsByInvoice[invoice.id] || [],
      })),
    });
  } catch (err) {
    console.error("Get Payments By Customer Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer payments",
      error: err.message,
    });
  }
};

/**
 * @desc    Payment list for table screen
 * @route   GET /api/payment/list
 * @query   search, customer_id, invoice_number, status, from_date, to_date
 */
export const getPaymentInvoiceList = async (req, res) => {
  try {
    const organization_id = req.user?.organization_id;
    const level = normalizeLevel(req.user?.organization_level);
    const userStoreCode = req.user?.store_code || null;

    const {
      search = "",
      customer_id,
      invoice_number,
      status,
      from_date,
      to_date,
    } = req.query;

    if (!organization_id) {
      return res.status(401).json({
        success: false,
        message: "organization_id missing in req.user",
      });
    }

    const invoiceWhere = {
      organization_id,
    };

    if (level === "retail" && userStoreCode) {
      invoiceWhere.store_code = userStoreCode;
    }

    if (customer_id) {
      invoiceWhere.customer_id = customer_id;
    }

    if (invoice_number) {
      invoiceWhere.invoice_number = {
        [Op.iLike]: `%${invoice_number}%`,
      };
    }

    if (status) {
      invoiceWhere.status = status;
    }

    if (from_date && to_date) {
      invoiceWhere.invoice_date = {
        [Op.between]: [new Date(from_date), new Date(to_date)],
      };
    }

    const customerWhere = {};
    if (search?.trim()) {
      customerWhere.name = {
        [Op.iLike]: `%${search.trim()}%`,
      };
    }

    const invoices = await Invoice.findAll({
      where: invoiceWhere,
      include: [
        {
          model: Customer,
          as: "customer",
          where: Object.keys(customerWhere).length ? customerWhere : undefined,
          attributes: ["id", "name", "phone", "store_code"],
        },
      ],
      order: [["invoice_date", "DESC"]],
    });

    const invoiceIds = invoices.map((inv) => inv.id);

    const payments = invoiceIds.length
      ? await Payment.findAll({
          where: {
            invoice_id: { [Op.in]: invoiceIds },
            organization_id,
          },
          order: [["payment_date", "DESC"]],
        })
      : [];

    const latestPaymentMap = {};
    for (const p of payments) {
      if (!latestPaymentMap[p.invoice_id]) {
        latestPaymentMap[p.invoice_id] = p;
      }
    }

    return res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices.map((inv) => {
        const latestPayment = latestPaymentMap[inv.id];

        return {
          invoice_id: inv.id,
          customer_id: inv.customer_id,
          client_name: inv.customer?.name || null,
          phone: inv.customer?.phone || null,
          invoice_number: inv.invoice_number,
          txn_id: latestPayment?.txn_id || null,
          date: inv.invoice_date,
          total_amount: inv.total_amount,
          received_amount: inv.received_amount,
          pending_amount: inv.pending_amount,
          status: inv.status,
          payment_method: latestPayment?.payment_method || null,
          store_code: inv.store_code,
          action: inv.pending_amount > 0 ? "EDIT" : "VIEW",
        };
      }),
    });
  } catch (err) {
    console.error("Get Payment Invoice List Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment invoice list",
      error: err.message,
    });
  }
};

export const getPaymentTracker = async (req, res) => {
  try {
    const { customer_id } = req.params;

    const organization_id = req.user?.organization_id;
    const level = String(req.user?.organization_level || "").toLowerCase();
    const store_code = req.user?.store_code || null;

    if (!organization_id) {
      return res.status(401).json({
        success: false,
        message: "organization_id missing in req.user",
      });
    }

    const customerWhere = {
      id: customer_id,
      organization_id,
    };

    if (level === "retail" && store_code) {
      customerWhere.store_code = store_code;
    }

    const customer = await Customer.findOne({
      where: customerWhere,
      attributes: ["id", "name", "phone", "store_code"],
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const invoiceWhere = {
      customer_id,
      organization_id,
    };

    if (level === "retail" && store_code) {
      invoiceWhere.store_code = store_code;
    }

    const invoices = await Invoice.findAll({
      where: invoiceWhere,
      order: [["invoice_date", "DESC"]],
    });

    const invoiceIds = invoices.map((inv) => inv.id);

    const payments = invoiceIds.length
      ? await Payment.findAll({
          where: {
            invoice_id: invoiceIds,
            organization_id,
          },
          order: [["payment_date", "DESC"]],
        })
      : [];

    const paymentMap = {};

    for (const pay of payments) {
      if (!paymentMap[pay.invoice_id]) {
        paymentMap[pay.invoice_id] = [];
      }

      paymentMap[pay.invoice_id].push({
        id: pay.id,
        date: pay.payment_date,
        received_amount: pay.amount,
        self_financer: pay.financier,
        payment_method: pay.payment_method,
        txn_id: pay.txn_id,
        operator: pay.operator,
      });
    }

    return res.status(200).json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
      },
      data: invoices.map((inv) => ({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        date: inv.invoice_date,
        total_amount: inv.total_amount,
        received_amount: inv.received_amount,
        pending_amount: inv.pending_amount,
        status: inv.status,
        payment_tracking: paymentMap[inv.id] || [],
      })),
    });
  } catch (error) {
    console.error("Payment Tracker Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment tracker",
      error: error.message,
    });
  }
};



const DISTRICT_LEVELS = ["district", "District", "DISTRICT"];

const resolveDistrictOrganization = async (user) => {
  if (!user) {
    throw new Error("User not authenticated");
  }

  if (!DISTRICT_LEVELS.includes(user.organization_level)) {
    throw new Error("Only district users can access this data");
  }

  let districtOrg = await Store.findOne({
    where: {
      id: user.organization_id,
      organization_level: "District",
    },
    raw: true,
  });

  if (districtOrg) return districtOrg;

  districtOrg = await Store.findOne({
    where: {
      district_id: user.organization_id,
      organization_level: "District",
    },
    order: [["id", "ASC"]],
    raw: true,
  });

  if (districtOrg) return districtOrg;

  if (user.store_code) {
    districtOrg = await Store.findOne({
      where: {
        store_code: user.store_code,
        organization_level: "District",
      },
      raw: true,
    });

    if (districtOrg) return districtOrg;
  }

  throw new Error("District office organization not found");
};



export const getDistrictPaymentsByInvoice = async (req, res) => {
  try {
    const { invoice_id } = req.params;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access payment tracker",
      });
    }

    if (!invoice_id) {
      return res.status(400).json({
        success: false,
        message: "invoice_id is required",
      });
    }

    const districtOrg = await resolveDistrictOrganization(req.user);

    // IMPORTANT: token ka store_code priority me rakho
    const districtStoreCode = req.user.store_code || districtOrg.store_code;
    const districtOrgId = req.user.organization_id || districtOrg.id;

    const invoice = await Invoice.findOne({
      where: {
        id: invoice_id,
        store_code: districtStoreCode,
      },
      raw: true,
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "District invoice not found",
      });
    }

    const customer = await Customer.findOne({
      where: {
        id: invoice.customer_id,
        store_code: districtStoreCode,
      },
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
      ],
      raw: true,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "District customer not found for this invoice",
      });
    }

    const payments = await Payment.findAll({
      where: {
        invoice_id: invoice.id,
        store_code: districtStoreCode,
      },
      order: [
        ["payment_date", "DESC"],
        ["id", "DESC"],
      ],
      raw: true,
    });

    const totalPaid = payments.reduce(
      (sum, p) => sum + parseFloat(p.amount || 0),
      0
    );

    return res.status(200).json({
      success: true,
      message: "District invoice payment tracker fetched successfully",
      district: {
        organization_id: districtOrgId,
        district_id: districtOrg.district_id || districtOrgId,
        store_code: districtStoreCode,
        store_name: districtOrg.store_name,
        organization_level: req.user.organization_level,
      },
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        store_code: customer.store_code,
      },
      invoice: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id: invoice.customer_id,
        total_amount: Number(invoice.total_amount || 0),
        received_amount: Number(invoice.received_amount || 0),
        pending_amount: Number(invoice.pending_amount || 0),
        status: invoice.status,
        store_code: invoice.store_code,
        invoice_date: invoice.invoice_date || invoice.createdAt || null,
      },
      count: payments.length,
      total_paid: totalPaid.toFixed(2),
      data: payments.map((p) => ({
        id: p.id,
        invoice_id: p.invoice_id,
        amount: parseFloat(p.amount || 0).toFixed(2),
        payment_method: p.payment_method || null,
        financier: p.financier || null,
        txn_id: p.txn_id || null,
        operator: p.operator || null,
        payment_date: p.payment_date || null,
        store_code: p.store_code || null,
        organization_id: p.organization_id || null,
        createdAt: p.createdAt || null,
      })),
    });
  } catch (err) {
    console.error("Get District Payments By Invoice Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch district invoice payments",
      error: err.message,
    });
  }
};

