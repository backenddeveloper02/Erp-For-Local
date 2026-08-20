// controllers/LedgerEntry.js
// controllers/LedgerEntry.js
import { QueryTypes } from "sequelize";
import sequelize from "../config/db.js";
import axios from "axios";
import Customer from "../model/Customer.js";
import LedgerEntry from "../model/LedgerEntry.js";
import Bill from "../model/Bill.js"
import PDFDocument from "pdfkit";
import InvoiceItem from "../model/InvoiceItem.js"
// import Customer from "../model/Customer.js";
import Store from "../model/Store.js";
import Invoice from "../model/invoices.js"; // if available in your project
import ExcelJS from "exceljs";
// import { resolveDistrictOrganization } from "../utils/resolveDistrictOrganization.js"
import { Op, fn,col, literal } from "sequelize";


/**
 * @desc    Get ledger dashboard summary + client wise ledger
 * @route   GET /api/ledger
 */
export const getLedger = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { organization_id } = req.user;
    const { search = "" } = req.query;

    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: "organization_id is missing in req.user",
      });
    }

    const cleanSearch = String(search || "").trim();

    const ledgerWhere = {
      organization_id,
    };

    const customerWhere = {
      organization_id,
    };

    if (cleanSearch) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${cleanSearch}%` } },
        { phone: { [Op.iLike]: `%${cleanSearch}%` } },
      ];
    }

    // ===============================
    // SUMMARY RAW
    // ===============================
    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    // ===============================
    // CLIENT WISE TABLE
    // ===============================
    const clientRows = await LedgerEntry.findAll({
      where: ledgerWhere,
      attributes: [
        "customer_id",
        [
          fn(
            "COUNT",
            literal(
              `DISTINCT CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."reference_id" END`
            )
          ),
          "total_deals",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "total_amount",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "received_amount",
        ],
        [
          literal(`
            COALESCE(
              SUM(
                CASE 
                  WHEN "LedgerEntry"."type" = 'DEBIT' 
                  THEN "LedgerEntry"."amount" 
                  ELSE 0 
                END
              ), 
              0
            )
            -
            COALESCE(
              SUM(
                CASE 
                  WHEN "LedgerEntry"."type" = 'CREDIT' 
                  THEN "LedgerEntry"."amount" 
                  ELSE 0 
                END
              ), 
              0
            )
          `),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Customer,
          as: "customer",
          attributes: ["id", "name", "phone", "address", "store_code"],
          where: customerWhere,
          required: true,
        },
      ],
      group: ["LedgerEntry.customer_id", "customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    // ===============================
    // TOTAL DEALS FROM INVOICE TABLE
    // 1 Invoice = 1 Deal
    // ===============================
    const invoiceCounts = await Invoice.findAll({
      where: {
        organization_id,
      },
      attributes: [
        "customer_id",
        [fn("COUNT", col("id")), "total_deals"],
      ],
      group: ["customer_id"],
      raw: true,
    });

    const invoiceMap = {};

    invoiceCounts.forEach((item) => {
      invoiceMap[Number(item.customer_id)] = Number(item.total_deals || 0);
    });

    const clients = clientRows.map((row) => {
      const totalAmount = Number(row.get("total_amount") || 0);
      const receivedAmount = Number(row.get("received_amount") || 0);
      const pendingAmount = Number(row.get("pending_amount") || 0);

      return {
        customer_id: Number(row.customer_id),
        client_name: row.customer?.name || "",
        phone: row.customer?.phone || "",
        address: row.customer?.address || "",
        store_code: row.customer?.store_code || "",
        total_deals: invoiceMap[Number(row.customer_id)] || 0,
        total_amount: Number(totalAmount.toFixed(2)),
        received_amount: Number(receivedAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
      };
    });

    const totalAmount = clients.reduce(
      (sum, item) => sum + Number(item.total_amount || 0),
      0
    );

    const receivedAmount = clients.reduce(
      (sum, item) => sum + Number(item.received_amount || 0),
      0
    );

    const pendingAmount = clients.reduce(
      (sum, item) => sum + Number(item.pending_amount || 0),
      0
    );

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),

      // UI me Total Loss ke liye
      loss: 0,

      // Purana key backward compatibility ke liye rakha hai
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),

      // New proper dashboard keys
      total_clients: clients.length,
      total_amount: Number(totalAmount.toFixed(2)),
      received_amount: Number(receivedAmount.toFixed(2)),
      pending_amount: Number(pendingAmount.toFixed(2)),

      // UI me Collectable Amount ke liye ye use karo
      collectable_amount: Number(pendingAmount.toFixed(2)),
    };

    return res.status(200).json({
      success: true,
      message: "Ledger dashboard fetched successfully",
      data: {
        summary,
        clients,
      },
    });
  } catch (error) {
    console.error("Ledger Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch ledger",
      error: error.message,
    });
  }
};
export const downloadLedgerExcel = async (req, res) => {
  try {
    // ============================================================
    // 1. AUTH CHECK
    // ============================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { organization_id } = req.user;
    const { search = "" } = req.query;

    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: "organization_id is missing in req.user",
      });
    }

    const cleanSearch = String(search || "").trim();

    // ============================================================
    // 2. HEAD OFFICE DETAILS
    // ============================================================

    const storeResult = await sequelize.query(
      `
      SELECT
        id,
        store_name,
        store_code,
        organization_level
      FROM stores
      WHERE id = :organization_id
      LIMIT 1
      `,
      {
        replacements: {
          organization_id,
        },
        type: QueryTypes.SELECT,
      }
    );

    const store = storeResult?.[0] || null;

    // ============================================================
    // 3. GET ALL DISTRICT + RETAIL STORES
    //
    // IMPORTANT:
    // Head Office ke andar saare District + Retail stores
    // yahan se liye jayenge.
    //
    // organization_id = Head Office ka id hone ki wajah se
    // ledger_entries ko directly Head Office id se filter
    // nahi karna hai.
    //
    // Instead:
    //
    // stores.id
    //     ↓
    // ledger_entries.organization_id
    // ============================================================

    const childStoreRows = await sequelize.query(
      `
      SELECT
        s.id,
        s.store_code,
        s.store_name,
        s.organization_level
      FROM stores s
      WHERE
        LOWER(s.organization_level::text) IN (
          'district',
          'retail'
        )
      ORDER BY
        s.store_code ASC
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const childStoreIds = (childStoreRows || [])
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id));

    // ============================================================
    // 4. LEDGER ORGANIZATION CONDITION
    //
    // Head Office:
    //     All District + Retail stores
    //
    // Fallback:
    //     Logged-in organization
    // ============================================================

    let ledgerOrganizationCondition = "";

    let ledgerOrganizationReplacements = {};

    if (childStoreIds.length > 0) {
      ledgerOrganizationCondition = `
        le.organization_id IN (:ledgerOrganizationIds)
      `;

      ledgerOrganizationReplacements = {
        ledgerOrganizationIds: childStoreIds,
      };
    } else {
      ledgerOrganizationCondition = `
        le.organization_id = :organization_id
      `;

      ledgerOrganizationReplacements = {
        organization_id,
      };
    }

    // ============================================================
    // 5. DASHBOARD SUMMARY
    //
    // IMPORTANT:
    //
    // Total Sales:
    // District + Retail ke COMBINED sales/deals count.
    //
    // Reference ID ke basis par DISTINCT count rakha hai,
    // taaki same bill/reference ki multiple ledger entries
    // hone par duplicate sale count na ho.
    //
    // Baaki summary values bhi District + Retail combined
    // ledger se calculate honge.
    // ============================================================

    const summaryResult = await sequelize.query(
      `
      SELECT

        /* ========================================================
           TOTAL SALES
           District + Retail Combined
           ======================================================== */

        COUNT(
          DISTINCT
          CASE
            WHEN le.type = 'DEBIT'
            THEN le.reference_id
          END
        ) AS total_sales,

        /* ========================================================
           GOODS RECEIPT
           District + Retail Combined
           ======================================================== */

        COUNT(
          DISTINCT
          CASE
            WHEN le.type = 'CREDIT'
            THEN le.reference_id
          END
        ) AS goods_receipt,

        /* ========================================================
           TOTAL AMOUNT
           ======================================================== */

        COALESCE(
          SUM(
            CASE
              WHEN le.type = 'DEBIT'
              THEN COALESCE(le.amount, 0)
              ELSE 0
            END
          ),
          0
        ) AS total_amount,

        /* ========================================================
           RECEIVED AMOUNT
           ======================================================== */

        COALESCE(
          SUM(
            CASE
              WHEN le.type = 'CREDIT'
              THEN COALESCE(le.amount, 0)
              ELSE 0
            END
          ),
          0
        ) AS received_amount

      FROM ledger_entries le

      WHERE
        ${ledgerOrganizationCondition}
      `,
      {
        replacements: {
          ...ledgerOrganizationReplacements,
        },
        type: QueryTypes.SELECT,
      }
    );

    const summaryRaw = summaryResult?.[0] || {};

    // ============================================================
    // 6. CUSTOMER SEARCH CONDITION
    //
    // Ye cards ke existing Total Amount / Received / Pending /
    // Total Clients calculation ko preserve karne ke liye hai.
    // ============================================================

    let customerSearchCondition = "";

    if (cleanSearch) {
      customerSearchCondition = `
        AND (
          COALESCE(c.name::text, '') ILIKE :search

          OR COALESCE(c.phone::text, '') ILIKE :search

          OR COALESCE(c.store_code::text, '') ILIKE :search

          OR COALESCE(c.address::text, '') ILIKE :search
        )
      `;
    }

    // ============================================================
    // 7. CUSTOMER DATA
    //
    // IMPORTANT:
    // Cards ke existing financial values preserve karne ke liye
    // customer-level calculation rakhi gayi hai.
    //
    // Data ab Head Office ke District + Retail stores se aayega.
    // ============================================================

    const clientRows = await sequelize.query(
      `
      SELECT

        le.customer_id,

        c.name AS client_name,

        c.phone,

        c.address,

        c.store_code,

        COUNT(
          DISTINCT
          CASE
            WHEN le.type = 'DEBIT'
            THEN le.reference_id
          END
        ) AS total_deals,

        COALESCE(
          SUM(
            CASE
              WHEN le.type = 'DEBIT'
              THEN COALESCE(le.amount, 0)
              ELSE 0
            END
          ),
          0
        ) AS total_amount,

        COALESCE(
          SUM(
            CASE
              WHEN le.type = 'CREDIT'
              THEN COALESCE(le.amount, 0)
              ELSE 0
            END
          ),
          0
        ) AS received_amount,

        (
          COALESCE(
            SUM(
              CASE
                WHEN le.type = 'DEBIT'
                THEN COALESCE(le.amount, 0)
                ELSE 0
              END
            ),
            0
          )

          -

          COALESCE(
            SUM(
              CASE
                WHEN le.type = 'CREDIT'
                THEN COALESCE(le.amount, 0)
                ELSE 0
              END
            ),
            0
          )
        ) AS pending_amount

      FROM ledger_entries le

      INNER JOIN customers c
        ON c.id = le.customer_id

      WHERE
        ${ledgerOrganizationCondition}

        ${customerSearchCondition}

      GROUP BY
        le.customer_id,
        c.id,
        c.name,
        c.phone,
        c.address,
        c.store_code

      ORDER BY
        pending_amount DESC
      `,
      {
        replacements: {
          ...ledgerOrganizationReplacements,
          search: `%${cleanSearch}%`,
        },
        type: QueryTypes.SELECT,
      }
    );

    // ============================================================
    // 8. NORMALIZE CUSTOMER DATA
    // ============================================================

    const clients = (clientRows || []).map((row) => ({
      customer_id: Number(row.customer_id || 0),

      client_name:
        row.client_name || "",

      phone:
        row.phone == null
          ? ""
          : String(row.phone),

      address:
        row.address || "",

      store_code:
        row.store_code == null
          ? ""
          : String(row.store_code),

      total_deals:
        Number(row.total_deals || 0),

      total_amount:
        Number(row.total_amount || 0),

      received_amount:
        Number(row.received_amount || 0),

      pending_amount:
        Number(row.pending_amount || 0),
    }));

    // ============================================================
    // 9. CARD FINANCIAL TOTALS
    //
    // Existing card structure preserved.
    // ============================================================

    const totalAmount = clients.reduce(
      (sum, item) =>
        sum + Number(item.total_amount || 0),
      0
    );

    const receivedAmount = clients.reduce(
      (sum, item) =>
        sum + Number(item.received_amount || 0),
      0
    );

    const pendingAmount = clients.reduce(
      (sum, item) =>
        sum + Number(item.pending_amount || 0),
      0
    );

    // ============================================================
    // 10. FINAL DASHBOARD SUMMARY
    // ============================================================

    const summary = {
      /*
       * IMPORTANT:
       * Total Sales now comes from combined District + Retail
       * stores.
       */
      total_sales: Number(
        summaryRaw.total_sales || 0
      ),

      loss: 0,

      goods_receipt: Number(
        summaryRaw.goods_receipt || 0
      ),

      /*
       * Existing card logic preserved.
       */
      total_clients:
        clients.length,

      total_amount:
        totalAmount,

      received_amount:
        receivedAmount,

      pending_amount:
        pendingAmount,
    };

    // ============================================================
    // 11. STORE LEDGER DATA
    //
    // UI / Excel columns:
    //
    // Store Code
    // Store Manager
    // Total Deals
    // Total Amount
    // Received Amount
    // Pending Amount
    // Action
    // ============================================================

    let storeSearchCondition = "";

    if (cleanSearch) {
      storeSearchCondition = `
        AND (
          COALESCE(s.store_code::text, '') ILIKE :storeSearch

          OR COALESCE(s.store_name::text, '') ILIKE :storeSearch

          OR EXISTS (
            SELECT 1
            FROM users su
            WHERE
              LOWER(TRIM(COALESCE(su.store_code, '')))
                =
              LOWER(TRIM(COALESCE(s.store_code, '')))

              AND LOWER(
                COALESCE(su.role, '')
              ) = 'manager'

              AND (
                COALESCE(su.username::text, '') ILIKE :storeSearch
                OR COALESCE(su.email::text, '') ILIKE :storeSearch
              )
          )
        )
      `;
    }

    const storeLedgerRows = await sequelize.query(
      `
      SELECT

        s.id AS organization_id,

        s.store_code,

        s.store_name,

        s.organization_level,

        /* ========================================================
           STORE MANAGER
           Actual users table fields:
             users.store_code
             users.username
             users.role
           ======================================================== */

        COALESCE(
          MAX(
            CASE
              WHEN LOWER(
                COALESCE(u.role, '')
              ) = 'manager'
              THEN COALESCE(
                NULLIF(u.username, ''),
                NULLIF(u.email, ''),
                NULLIF(u.user_code, '')
              )
              ELSE NULL
            END
          ),
          '—'
        ) AS store_manager,

        /* ========================================================
           TOTAL DEALS
           ======================================================== */

        COUNT(
          DISTINCT
          CASE
            WHEN le.type = 'DEBIT'
            THEN le.reference_id
          END
        ) AS total_deals,

        /* ========================================================
           TOTAL AMOUNT
           ======================================================== */

        COALESCE(
          SUM(
            CASE
              WHEN le.type = 'DEBIT'
              THEN COALESCE(le.amount, 0)
              ELSE 0
            END
          ),
          0
        ) AS total_amount,

        /* ========================================================
           RECEIVED AMOUNT
           ======================================================== */

        COALESCE(
          SUM(
            CASE
              WHEN le.type = 'CREDIT'
              THEN COALESCE(le.amount, 0)
              ELSE 0
            END
          ),
          0
        ) AS received_amount,

        /* ========================================================
           PENDING AMOUNT
           ======================================================== */

        (
          COALESCE(
            SUM(
              CASE
                WHEN le.type = 'DEBIT'
                THEN COALESCE(le.amount, 0)
                ELSE 0
              END
            ),
            0
          )

          -

          COALESCE(
            SUM(
              CASE
                WHEN le.type = 'CREDIT'
                THEN COALESCE(le.amount, 0)
                ELSE 0
              END
            ),
            0
          )
        ) AS pending_amount

      FROM stores s

      /* ==========================================================
         IMPORTANT:
         LEFT JOIN rakha hai.
         Isse jis store ka ledger data nahi hai,
         woh store bhi Excel mein aayega.
         ========================================================== */

      LEFT JOIN ledger_entries le
        ON le.organization_id = s.id

      /* ==========================================================
         MANAGER JOIN
         ========================================================== */

      LEFT JOIN users u
        ON LOWER(
          TRIM(
            COALESCE(u.store_code, '')
          )
        )
        =
        LOWER(
          TRIM(
            COALESCE(s.store_code, '')
          )
        )

        AND LOWER(
          COALESCE(u.role, '')
        ) = 'manager'

      WHERE

        LOWER(
          s.organization_level::text
        ) IN (
          'district',
          'retail'
        )

        ${storeSearchCondition}

      GROUP BY
        s.id,
        s.store_code,
        s.store_name,
        s.organization_level

      ORDER BY
        s.store_code ASC
      `,
      {
        replacements: {
          storeSearch:
            `%${cleanSearch}%`,
        },
        type: QueryTypes.SELECT,
      }
    );

    // ============================================================
    // 12. NORMALIZE STORE LEDGER DATA
    // ============================================================

    const stores = (storeLedgerRows || []).map(
      (row) => {
        const totalAmount =
          Number(
            row.total_amount || 0
          );

        const receivedAmount =
          Number(
            row.received_amount || 0
          );

        const pendingAmount =
          totalAmount -
          receivedAmount;

        return {
          organization_id:
            row.organization_id,

          store_code:
            row.store_code == null
              ? "—"
              : String(row.store_code),

          store_name:
            row.store_name == null
              ? "—"
              : String(row.store_name),

          organization_level:
            row.organization_level == null
              ? "—"
              : String(row.organization_level),

          store_manager:
            row.store_manager || "—",

          total_deals:
            Number(
              row.total_deals || 0
            ),

          total_amount:
            totalAmount,

          received_amount:
            receivedAmount,

          pending_amount:
            pendingAmount,
        };
      }
    );

    // ============================================================
    // 13. CREATE WORKBOOK
    // ============================================================

    const workbook =
      new ExcelJS.Workbook();

    workbook.creator =
      "ERP System";

    workbook.created =
      new Date();

    workbook.modified =
      new Date();

    const worksheet =
      workbook.addWorksheet(
        "Ledger Report",
        {
          views: [
            {
              state: "frozen",
              ySplit: 12,
            },
          ],

          pageSetup: {
            paperSize: 9,
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
          },
        }
      );

    worksheet.properties.defaultRowHeight =
      22;

    // ============================================================
    // 14. COLUMNS
    // ============================================================

    worksheet.columns = [
      {
        header: "Store Code",
        key: "store_code",
        width: 20,
      },

      {
        header: "Store Manager",
        key: "store_manager",
        width: 28,
      },

      {
        header: "Total Deals",
        key: "total_deals",
        width: 16,
      },

      {
        header: "Total Amount",
        key: "total_amount",
        width: 20,
      },

      {
        header: "Received Amount",
        key: "received_amount",
        width: 20,
      },

      {
        header: "Pending Amount",
        key: "pending_amount",
        width: 20,
      },

      {
        header: "Action",
        key: "action",
        width: 16,
      },
    ];

    // ============================================================
    // 15. STYLES
    // ============================================================

    const titleFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FF111827",
      },
    };

    const sectionFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FFE5E7EB",
      },
    };

    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FF1F2937",
      },
    };

    const cardFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FFF9FAFB",
      },
    };

    const border = {
      top: {
        style: "thin",
        color: {
          argb: "FFD1D5DB",
        },
      },

      left: {
        style: "thin",
        color: {
          argb: "FFD1D5DB",
        },
      },

      bottom: {
        style: "thin",
        color: {
          argb: "FFD1D5DB",
        },
      },

      right: {
        style: "thin",
        color: {
          argb: "FFD1D5DB",
        },
      },
    };

    const moneyFormat =
      "₹#,##0.00;[Red]-₹#,##0.00";

    const numberFormat =
      "#,##0";

    // ============================================================
    // 16. TITLE
    // ============================================================

    worksheet.mergeCells(
      "A1:G1"
    );

    const titleCell =
      worksheet.getCell("A1");

    titleCell.value =
      "Dashboard & Ledger Report";

    titleCell.font = {
      bold: true,
      size: 18,
      color: {
        argb: "FFFFFFFF",
      },
    };

    titleCell.fill =
      titleFill;

    titleCell.alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    worksheet.getRow(1).height =
      34;

    // ============================================================
    // 17. STORE / ORGANIZATION DETAILS
    // ============================================================

    worksheet.mergeCells(
      "A3:B3"
    );

    worksheet.getCell(
      "A3"
    ).value =
      "Store / Organization";

    worksheet.getCell(
      "A3"
    ).font = {
      bold: true,
    };

    worksheet.mergeCells(
      "C3:D3"
    );

    worksheet.getCell(
      "C3"
    ).value =
      store?.store_name ||
      req.user?.store_name ||
      "Head Office";

    worksheet.mergeCells(
      "E3:F3"
    );

    worksheet.getCell(
      "E3"
    ).value =
      "Store Code";

    worksheet.getCell(
      "E3"
    ).font = {
      bold: true,
    };

    worksheet.getCell(
      "G3"
    ).value =
      store?.store_code ||
      req.user?.store_code ||
      "N/A";

    worksheet.mergeCells(
      "A4:B4"
    );

    worksheet.getCell(
      "A4"
    ).value =
      "Organization ID";

    worksheet.getCell(
      "A4"
    ).font = {
      bold: true,
    };

    worksheet.mergeCells(
      "C4:D4"
    );

    worksheet.getCell(
      "C4"
    ).value =
      organization_id;

    worksheet.mergeCells(
      "E4:F4"
    );

    worksheet.getCell(
      "E4"
    ).value =
      "Generated At";

    worksheet.getCell(
      "E4"
    ).font = {
      bold: true,
    };

    worksheet.getCell(
      "G4"
    ).value =
      new Date().toLocaleString(
        "en-IN"
      );

    [
      "A3",
      "C3",
      "E3",
      "G3",
      "A4",
      "C4",
      "E4",
      "G4",
    ].forEach(
      (cell) => {
        worksheet.getCell(
          cell
        ).border =
          border;

        worksheet.getCell(
          cell
        ).alignment = {
          vertical: "middle",
          horizontal: "left",
        };
      }
    );

    // ============================================================
    // 18. DASHBOARD CARDS
    //
    // IMPORTANT:
    // Cards ka layout / labels / structure SAME hai.
    //
    // Sirf Total Sales ki value ab combined
    // District + Retail stores se aa rahi hai.
    // ============================================================

    worksheet.mergeCells(
      "A6:G6"
    );

    worksheet.getCell(
      "A6"
    ).value =
      "Dashboard Cards";

    worksheet.getCell(
      "A6"
    ).font = {
      bold: true,
      size: 13,
    };

    worksheet.getCell(
      "A6"
    ).fill =
      sectionFill;

    worksheet.getCell(
      "A6"
    ).border =
      border;

    const cards = [
      [
        "A7:B8",
        "Total Sales",
        summary.total_sales,
        numberFormat,
      ],

      [
        "C7:D8",
        "Goods Receipt",
        summary.goods_receipt,
        numberFormat,
      ],

      [
        "E7:F8",
        "Total Clients",
        summary.total_clients,
        numberFormat,
      ],

      [
        "G7",
        "Loss",
        summary.loss,
        moneyFormat,
      ],

      [
        "A9:B10",
        "Total Amount",
        summary.total_amount,
        moneyFormat,
      ],

      [
        "C9:D10",
        "Received Amount",
        summary.received_amount,
        moneyFormat,
      ],

      [
        "E9:F10",
        "Pending Amount",
        summary.pending_amount,
        moneyFormat,
      ],

      [
        "G9",
        "Collectable",
        summary.pending_amount,
        moneyFormat,
      ],
    ];

    cards.forEach(
      ([range, label, value]) => {
        worksheet.mergeCells(
          range
        );

        const startCell =
          range.split(":")[0];

        const cell =
          worksheet.getCell(
            startCell
          );

        cell.value = {
          richText: [
            {
              text:
                `${label}\n`,
              font: {
                bold: true,
                size: 10,
                color: {
                  argb:
                    "FF6B7280",
                },
              },
            },

            {
              text:
                String(value),

              font: {
                bold: true,
                size: 15,
                color: {
                  argb:
                    "FF111827",
                },
              },
            },
          ],
        };

        cell.fill =
          cardFill;

        cell.border =
          border;

        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
      }
    );

    // ============================================================
    // 19. STORE LEDGER TITLE
    // ============================================================

    worksheet.mergeCells(
      "A12:G12"
    );

    worksheet.getCell(
      "A12"
    ).value =
      "Store Ledger";

    worksheet.getCell(
      "A12"
    ).font = {
      bold: true,
      size: 13,
    };

    worksheet.getCell(
      "A12"
    ).fill =
      sectionFill;

    worksheet.getCell(
      "A12"
    ).border =
      border;

    // ============================================================
    // 20. STORE LEDGER HEADER
    // ============================================================

    const headerRowIndex =
      13;

    const headerRow =
      worksheet.getRow(
        headerRowIndex
      );

    headerRow.values = [
      "Store Code",
      "Store Manager",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount",
      "Action",
    ];

    headerRow.height =
      26;

    headerRow.eachCell(
      (cell) => {
        cell.font = {
          bold: true,
          color: {
            argb: "FFFFFFFF",
          },
        };

        cell.fill =
          headerFill;

        cell.border =
          border;

        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
      }
    );

    // ============================================================
    // 21. ADD ALL DISTRICT + RETAIL STORES
    // ============================================================

    stores.forEach(
      (item) => {
        const row =
          worksheet.addRow([
            item.store_code,

            item.store_manager,

            item.total_deals,

            item.total_amount,

            item.received_amount,

            item.pending_amount,

            "View",
          ]);

        row.height =
          24;

        row.eachCell(
          (cell, colNumber) => {
            cell.border =
              border;

            cell.alignment = {
              vertical: "middle",

              horizontal:
                colNumber >= 3
                  ? "right"
                  : "left",

              wrapText: true,
            };
          }
        );

        // Store Code
        row.getCell(
          1
        ).numFmt = "@";

        // Store Manager
        row.getCell(
          2
        ).numFmt = "@";

        // Total Deals
        row.getCell(
          3
        ).numFmt =
          numberFormat;

        // Total Amount
        row.getCell(
          4
        ).numFmt =
          moneyFormat;

        // Received Amount
        row.getCell(
          5
        ).numFmt =
          moneyFormat;

        // Pending Amount
        row.getCell(
          6
        ).numFmt =
          moneyFormat;

        // Action
        row.getCell(
          7
        ).alignment = {
          horizontal: "center",
          vertical: "middle",
        };

        row.getCell(
          7
        ).font = {
          name: "Calibri",
          size: 10,
          color: {
            argb: "FF2563EB",
          },
          underline: true,
        };
      }
    );

    // ============================================================
    // 22. GRAND TOTAL
    // ============================================================

    const grandTotalDeals =
      stores.reduce(
        (sum, item) =>
          sum +
          Number(
            item.total_deals || 0
          ),
        0
      );

    const grandTotalAmount =
      stores.reduce(
        (sum, item) =>
          sum +
          Number(
            item.total_amount || 0
          ),
        0
      );

    const grandReceivedAmount =
      stores.reduce(
        (sum, item) =>
          sum +
          Number(
            item.received_amount || 0
          ),
        0
      );

    const grandPendingAmount =
      stores.reduce(
        (sum, item) =>
          sum +
          Number(
            item.pending_amount || 0
          ),
        0
      );

    const totalRow =
      worksheet.addRow([
        "Grand Total",

        "",

        grandTotalDeals,

        grandTotalAmount,

        grandReceivedAmount,

        grandPendingAmount,

        "",
      ]);

    totalRow.height =
      26;

    totalRow.eachCell(
      (cell, colNumber) => {
        cell.font = {
          bold: true,
        };

        cell.fill =
          sectionFill;

        cell.border =
          border;

        cell.alignment = {
          vertical: "middle",

          horizontal:
            colNumber >= 3
              ? "right"
              : "left",
        };
      }
    );

    totalRow.getCell(
      3
    ).numFmt =
      numberFormat;

    totalRow.getCell(
      4
    ).numFmt =
      moneyFormat;

    totalRow.getCell(
      5
    ).numFmt =
      moneyFormat;

    totalRow.getCell(
      6
    ).numFmt =
      moneyFormat;

    // ============================================================
    // 23. FILTER
    // ============================================================

    worksheet.autoFilter = {
      from: {
        row: headerRowIndex,
        column: 1,
      },

      to: {
        row:
          headerRowIndex +
          stores.length,

        column: 7,
      },
    };

    // ============================================================
    // 24. FONT
    // ============================================================

    worksheet.eachRow(
      (row) => {
        row.eachCell(
          (cell) => {
            const oldFont =
              cell.font || {};

            cell.font = {
              name: "Calibri",

              size:
                oldFont.size || 11,

              bold:
                oldFont.bold ||
                false,

              color:
                oldFont.color,
            };
          }
        );
      }
    );

    // Restore title font
    worksheet.getRow(
      1
    ).font = {
      name: "Calibri",
      bold: true,
      size: 18,
      color: {
        argb: "FFFFFFFF",
      },
    };

    // ============================================================
    // 25. FILE NAME
    // ============================================================

    const fileName =
      `ledger_report_${
        store?.store_code ||
        req.user?.store_code ||
        organization_id
      }_${Date.now()}.xlsx`;

    // ============================================================
    // 26. DOWNLOAD
    // ============================================================

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    await workbook.xlsx.write(
      res
    );

    return res.end();

  } catch (error) {
    console.error(
      "Download Ledger Excel Error:",
      error
    );

    console.error(
      "DB Error:",
      error?.original?.message ||
      error?.parent?.message ||
      null
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,

        message:
          "Failed to download ledger excel",

        error:
          error?.original?.message ||
          error?.parent?.message ||
          error?.message ||
          "Unknown error",
      });
    }

    return res.end();
  }
};
/**
 * @desc    Get detailed ledger for one customer
 * @route   GET /api/ledger/customer/:customer_id
 */

export const getCustomerLedgerDetail = async (req, res) => {
  try {
    const customer_id = Number(req.params.customer_id);

    if (isNaN(customer_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer_id",
      });
    }

    const organization_id = req.user?.organization_id || null;

    const customerWhere = { id: customer_id };
    if (organization_id) customerWhere.organization_id = organization_id;

    const customer = await Customer.findOne({ where: customerWhere });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const ledgerWhere = { customer_id };
    if (organization_id) ledgerWhere.organization_id = organization_id;

    const entries = await LedgerEntry.findAll({
      where: ledgerWhere,
      order: [["createdAt", "ASC"]],
      raw: true,
    });

    const debitEntries = entries.filter((e) => e.type === "DEBIT");
    const creditEntries = entries.filter((e) => e.type === "CREDIT");

    let totalCreditPool = creditEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const rows = [];

    for (const entry of debitEntries) {
      const debitAmount = parseFloat(entry.amount || 0);

      let receivedAmount = 0;

      if (totalCreditPool > 0) {
        receivedAmount = Math.min(totalCreditPool, debitAmount);
        totalCreditPool -= receivedAmount;
      }

      const pendingAmount = debitAmount - receivedAmount;

      let invoiceId = null;
      let invoiceNumber = "-";

      if (
        entry.reference_type === "INVOICE" &&
        entry.reference_id
      ) {
        const invoiceWhere = { id: entry.reference_id };
        if (organization_id) invoiceWhere.organization_id = organization_id;

        const invoice = await Invoice.findOne({
          where: invoiceWhere,
          attributes: ["id", "invoice_number", "bill_id", "createdAt"],
          raw: true,
        });

        if (invoice) {
          invoiceId = invoice.id;
          invoiceNumber = invoice.invoice_number || "-";
        }
      }

      if (
        entry.reference_type === "BILL" &&
        entry.reference_id
      ) {
        const invoiceWhere = { bill_id: entry.reference_id };
        if (organization_id) invoiceWhere.organization_id = organization_id;

        const invoice = await Invoice.findOne({
          where: invoiceWhere,
          attributes: ["id", "invoice_number", "bill_id", "createdAt"],
          raw: true,
        });

        if (invoice) {
          invoiceId = invoice.id;
          invoiceNumber = invoice.invoice_number || "-";
        } else {
          const billWhere = { id: entry.reference_id };
          if (organization_id) billWhere.organization_id = organization_id;

          const bill = await Bill.findOne({
            where: billWhere,
            attributes: ["id", "bill_number", "createdAt"],
            raw: true,
          });

          if (bill) {
            invoiceId = bill.id;
            invoiceNumber = bill.bill_number || "-";
          }
        }
      }

      if (!invoiceId) {
        const invoiceWhere = {
          customer_id,
          total_amount: debitAmount,
        };

        if (organization_id) invoiceWhere.organization_id = organization_id;

        const invoice = await Invoice.findOne({
          where: invoiceWhere,
          attributes: ["id", "invoice_number", "bill_id", "createdAt"],
          order: [["createdAt", "DESC"]],
          raw: true,
        });

        if (invoice) {
          invoiceId = invoice.id;
          invoiceNumber = invoice.invoice_number || "-";
        }
      }

      rows.push({
        ledger_id: entry.id,
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        date: entry.createdAt,
        total_amount: Number(debitAmount.toFixed(2)),
        received_amount: Number(receivedAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
        reference_type: entry.reference_type,
        reference_id: entry.reference_id,
        action: "View",
      });
    }

    const totalAmount = debitEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const totalReceived = creditEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const totalPending = totalAmount - totalReceived;

    return res.status(200).json({
      success: true,
      message: "Customer ledger detail fetched successfully",
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          pan_card_number: customer.pan_card_number,
          store_code: customer.store_code,
        },
        summary: {
          total_amount: Number(totalAmount.toFixed(2)),
          received_amount: Number(totalReceived.toFixed(2)),
          pending_amount: Number(totalPending.toFixed(2)),
        },
        deals: rows.reverse(),
      },
    });
  } catch (err) {
    console.error("Ledger Detail Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer ledger detail",
      error: err.message,
    });
  }
};
const DISTRICT_LEVELS = ["district", "District", "DISTRICT"];

const getStoreNameField = () => {
  if (Store.rawAttributes?.store_name) return "store_name";
  if (Store.rawAttributes?.name) return "name";
  return "store_name";
};

const getStoreCodeField = () => {
  if (Store.rawAttributes?.store_code) return "store_code";
  if (Store.rawAttributes?.code) return "code";
  return "store_code";
};

const getInvoiceNoField = () => {
  if (Invoice?.rawAttributes?.invoice_number) return "invoice_number";
  if (Invoice?.rawAttributes?.invoice_no) return "invoice_no";
  if (Invoice?.rawAttributes?.bill_no) return "bill_no";
  return "invoice_number";
};

const getInvoiceDateField = () => {
  if (Invoice?.rawAttributes?.invoice_date) return "invoice_date";
  if (Invoice?.rawAttributes?.date) return "date";
  if (Invoice?.rawAttributes?.createdAt) return "createdAt";
  return "invoice_date";
};

const resolveDistrictOrganization = async (user) => {
  if (!user) {
    throw new Error("User not authenticated");
  }

  if (!DISTRICT_LEVELS.includes(user.organization_level)) {
    throw new Error("Only district users can access this ledger");
  }

  let districtOrg = null;

  if (user.store_code) {
    districtOrg = await Store.findOne({
      where: {
        store_code: user.store_code,
      },
      raw: true,
    });

    if (districtOrg) return districtOrg;
  }

  districtOrg = await Store.findOne({
    where: {
      id: user.organization_id,
    },
    raw: true,
  });

  if (districtOrg) return districtOrg;

  throw new Error("District office organization not found");
};

const getDistrictScope = async (user) => {
  const districtOrg = await resolveDistrictOrganization(user);

  return {
    districtOrg,
    districtStoreCode: user.store_code || districtOrg[getStoreCodeField()],
    districtOrgId: user.organization_id || districtOrg.id,
  };
};

export const getDistrictLedger = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { search = "" } = req.query;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this ledger",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customerWhere = {
      store_code: districtStoreCode,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    const ledgerWhere = {
      store_code: districtStoreCode,
    };

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await Customer.findAll({
      where: customerWhere,
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
        [fn("COUNT", literal(`DISTINCT "invoices"."id"`)), "total_deals"],
        [
          fn("COALESCE", fn("SUM", col(`invoices.total_amount`)), 0),
          "total_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.received_amount`)), 0),
          "received_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.pending_amount`)), 0),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Invoice,
          as: "invoices",
          attributes: [],
          required: false,
          where: {
            store_code: districtStoreCode,
          },
        },
      ],
      group: ["Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const clients = clientRows.map((row) => ({
      customer_id: row.id,
      client_name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      store_code: row.store_code || "",
      source_type: "district",
      source_name: districtOrg[getStoreNameField()] || "District Office",
      source_store_code: districtStoreCode,
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: clients.length,
      total_amount: clients.reduce(
        (sum, item) => sum + Number(item.total_amount || 0),
        0
      ),
      total_received: clients.reduce(
        (sum, item) => sum + Number(item.received_amount || 0),
        0
      ),
      total_pending: clients.reduce(
        (sum, item) => sum + Number(item.pending_amount || 0),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      message: "District ledger dashboard fetched successfully",
      data: {
        district: {
          organization_id: districtOrgId,
          district_id: districtOrg.district_id || districtOrgId,
          store_code: districtStoreCode,
          store_name: districtOrg[getStoreNameField()] || "District Office",
          organization_level: req.user.organization_level,
        },
        summary,
        clients,
      },
    });
  } catch (error) {
    console.error("District Ledger Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district ledger",
      error: error.message,
    });
  }
};

export const getDistrictLedgerClientDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { customerId } = req.params;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this ledger detail",
      });
    }

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customer = await Customer.findOne({
      where: {
        id: customerId,
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
        message: "District client not found",
      });
    }

    const invoiceNoField = getInvoiceNoField();
    const invoiceDateField = getInvoiceDateField();

    const invoices = await Invoice.findAll({
      where: {
        customer_id: customer.id,
        store_code: districtStoreCode,
      },
      attributes: [
        "id",
        ...(invoiceNoField ? [invoiceNoField] : []),
        ...(invoiceDateField ? [invoiceDateField] : []),
        "total_amount",
        "received_amount",
        "pending_amount",
      ],
      order: [
        [invoiceDateField, "DESC"],
        ["id", "DESC"],
      ],
      raw: true,
    });

    const rows = invoices.map((inv) => ({
      invoice_id: inv.id,
      invoice_number: inv[invoiceNoField] || `INV-${inv.id}`,
      date: inv[invoiceDateField]
        ? new Date(inv[invoiceDateField]).toISOString().split("T")[0]
        : null,
      total_amount: Number(inv.total_amount || 0),
      received_amount: Number(inv.received_amount || 0),
      pending_amount: Number(inv.pending_amount || 0),
      action: "View",
    }));

    return res.status(200).json({
      success: true,
      message: "District client ledger detail fetched successfully",
      data: {
        district: {
          organization_id: districtOrgId,
          district_id: districtOrg.district_id || districtOrgId,
          store_code: districtStoreCode,
          store_name: districtOrg[getStoreNameField()] || "District Office",
        },
        client: {
          id: customer.id,
          name: customer.name || "",
          phone: customer.phone || "",
          address: customer.address || "",
          store_code: customer.store_code || "",
          source_type: "district",
          source_name: districtOrg[getStoreNameField()] || "District Office",
        },
        summary: {
          total_deals: rows.length,
          total_amount: rows.reduce((sum, item) => sum + item.total_amount, 0),
          received_amount: rows.reduce(
            (sum, item) => sum + item.received_amount,
            0
          ),
          pending_amount: rows.reduce(
            (sum, item) => sum + item.pending_amount,
            0
          ),
        },
        rows,
      },
    });
  } catch (error) {
    console.error("District Ledger Client Detail Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district client ledger detail",
      error: error.message,
    });
  }
};

export const downloadDistrictLedgerExcel = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { search = "" } = req.query;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can download this ledger excel",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customerWhere = {
      store_code: districtStoreCode,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    const ledgerWhere = {
      store_code: districtStoreCode,
    };

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await Customer.findAll({
      where: customerWhere,
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
        [fn("COUNT", literal(`DISTINCT "invoices"."id"`)), "total_deals"],
        [
          fn("COALESCE", fn("SUM", col(`invoices.total_amount`)), 0),
          "total_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.received_amount`)), 0),
          "received_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.pending_amount`)), 0),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Invoice,
          as: "invoices",
          attributes: [],
          required: false,
          where: {
            store_code: districtStoreCode,
          },
        },
      ],
      group: ["Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const data = clientRows.map((row) => ({
      customer_id: row.id,
      client_name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      customer_store_code: row.store_code || "",
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: data.length,
      total_amount: data.reduce((sum, item) => sum + item.total_amount, 0),
      total_received: data.reduce((sum, item) => sum + item.received_amount, 0),
      total_pending: data.reduce((sum, item) => sum + item.pending_amount, 0),
    };

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("District Ledger");

    worksheet.mergeCells("A1:I1");
    worksheet.getCell("A1").value = "District Ledger Dashboard Report";
    worksheet.getCell("A1").font = { bold: true, size: 16 };
    worksheet.getCell("A1").alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    worksheet.getCell("A3").value = "District Office Name";
    worksheet.getCell("B3").value =
      districtOrg[getStoreNameField()] || "District Office";

    worksheet.getCell("A4").value = "District Office Code";
    worksheet.getCell("B4").value = districtStoreCode;

    worksheet.getCell("A5").value = "Organization ID";
    worksheet.getCell("B5").value = districtOrgId;

    worksheet.getCell("A6").value = "District ID";
    worksheet.getCell("B6").value = districtOrg.district_id || districtOrgId;

    worksheet.getCell("A7").value = "Organization Level";
    worksheet.getCell("B7").value = req.user.organization_level || "District";

    worksheet.getCell("A8").value = "Generated At";
    worksheet.getCell("B8").value = new Date().toLocaleString();

    ["A3", "A4", "A5", "A6", "A7", "A8"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    worksheet.getCell("D3").value = "Total Sales";
    worksheet.getCell("E3").value = summary.total_sales;

    worksheet.getCell("D4").value = "Loss";
    worksheet.getCell("E4").value = summary.loss;

    worksheet.getCell("D5").value = "Goods Receipt";
    worksheet.getCell("E5").value = summary.goods_receipt;

    worksheet.getCell("D6").value = "Total Clients";
    worksheet.getCell("E6").value = summary.total_clients;

    worksheet.getCell("D7").value = "Total Amount";
    worksheet.getCell("E7").value = summary.total_amount;

    worksheet.getCell("D8").value = "Received Amount";
    worksheet.getCell("E8").value = summary.total_received;

    worksheet.getCell("D9").value = "Pending Amount";
    worksheet.getCell("E9").value = summary.total_pending;

    ["D3", "D4", "D5", "D6", "D7", "D8", "D9"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    const headerRowIndex = 11;

    worksheet.getRow(headerRowIndex).values = [
      "Customer ID",
      "Client Name",
      "Phone",
      "Address",
      "District Store Code",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount",
    ];

    worksheet.getRow(headerRowIndex).font = { bold: true };

    data.forEach((item) => {
      worksheet.addRow([
        item.customer_id,
        item.client_name,
        item.phone,
        item.address,
        item.customer_store_code,
        item.total_deals,
        item.total_amount,
        item.received_amount,
        item.pending_amount,
      ]);
    });

    worksheet.columns = [
      { width: 15 },
      { width: 25 },
      { width: 18 },
      { width: 30 },
      { width: 20 },
      { width: 15 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
    ];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= headerRowIndex) {
        row.getCell(6).alignment = { horizontal: "center" };
        row.getCell(7).alignment = { horizontal: "right" };
        row.getCell(8).alignment = { horizontal: "right" };
        row.getCell(9).alignment = { horizontal: "right" };
      }
    });

    const fileName = `district_ledger_${districtStoreCode}_${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("Download District Ledger Excel Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download district ledger excel",
      error: error.message,
    });
  }
};


// =========================
// MODERN PROFESSIONAL PDF INVOICE
// =========================

// =========================
// IMPORTS
// =========================

// import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

// =========================
// DOWNLOAD INVOICE
// =========================

export const downloadInvoiceById = async (
  req,
  res
) => {
  try {
    // =========================
    // VALIDATION
    // =========================

    const invoice_id = Number(
      req.params.invoice_id
    );

    if (isNaN(invoice_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice id",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const organization_id =
      req.user.organization_id;

    // =========================
    // FETCH INVOICE
    // =========================

    const invoice = await Invoice.findOne({
      where: {
        id: invoice_id,
        organization_id,
      },
      raw: true,
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    // =========================
    // FETCH CUSTOMER
    // =========================

    const customer =
      await Customer.findOne({
        where: {
          id: invoice.customer_id,
        },
        raw: true,
      });

    // =========================
    // FETCH ITEMS
    // =========================

    const items = await sequelize.query(
      `
      SELECT *
      FROM invoice_items
      WHERE invoice_id = :invoice_id
      ORDER BY id ASC
      `,
      {
        replacements: {
          invoice_id,
        },
        type: QueryTypes.SELECT,
      }
    );

    // =========================
    // PDF CONFIG
    // =========================

    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
    });

    const fileName = `invoice_${invoice.id}.pdf`;

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    doc.pipe(res);

    // =========================
    // LOGO
    // =========================

    const logoPath = path.join(
      process.cwd(),
      "public",
      "logo.png"
    );

    // =========================
    // COLORS
    // =========================

    const COLORS = {
      bg: "#F8F6F3",
      white: "#FFFFFF",
      primary: "#2C3E50",
      secondary: "#7B6D62",
      accent: "#C7A17A",
      accentLight: "#EFE5DA",
      border: "#E7DED5",
      tableHead: "#A27B5C",
      text: "#6B7280",
    };

    // =========================
    // HELPERS
    // =========================

    const drawText = (
      text,
      x,
      y,
      size = 10,
      color = COLORS.primary,
      bold = false,
      align = "left",
      width = 100
    ) => {
      doc
        .fillColor(color)
        .font(
          bold
            ? "Helvetica-Bold"
            : "Helvetica"
        )
        .fontSize(size)
        .text(String(text || ""), x, y, {
          width,
          align,
        });
    };

    const roundedBox = (
      x,
      y,
      w,
      h,
      fill = COLORS.white,
      border = COLORS.border,
      radius = 12
    ) => {
      doc
        .fillColor(fill)
        .roundedRect(
          x,
          y,
          w,
          h,
          radius
        )
        .fill();

      doc
        .strokeColor(border)
        .lineWidth(1)
        .roundedRect(
          x,
          y,
          w,
          h,
          radius
        )
        .stroke();
    };

    // =========================
    // PAGE BG
    // =========================

    doc
      .fillColor(COLORS.bg)
      .rect(0, 0, 595, 842)
      .fill();

    // =========================
    // HEADER CARD
    // =========================

    roundedBox(
      25,
      25,
      545,
      150,
      COLORS.white,
      COLORS.border,
      18
    );

    // LEFT ACCENT

    doc
      .fillColor(COLORS.accent)
      .roundedRect(25, 25, 8, 150, 10)
      .fill();

    // LOGO

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 45, 48, {
        fit: [70, 70],
      });
    }

    // TITLE

    drawText(
      "TAX INVOICE",
      0,
      38,
      30,
      COLORS.primary,
      true,
      "center",
      595
    );

    // UNDERLINE

    doc
      .strokeColor(COLORS.accent)
      .lineWidth(2)
      .moveTo(255, 82)
      .lineTo(340, 82)
      .stroke();

    // COMPANY NAME

    drawText(
      "Merxenta Global Private Limited",
      0,
      102,
      18,
      COLORS.primary,
      true,
      "center",
      595
    );

    drawText(
      "H. No. 999/9, Gurugram, Haryana, India",
      0,
      130,
      10,
      COLORS.text,
      false,
      "center",
      595
    );

    drawText(
      "PH: 0120-256211",
      0,
      146,
      10,
      COLORS.text,
      false,
      "center",
      595
    );

    // DECORATIVE STRIP

    doc
      .fillColor("#D9C2A8")
      .roundedRect(25, 192, 380, 6, 5)
      .fill();

    doc
      .fillColor("#B08968")
      .polygon(
        [405, 192],
        [570, 192],
        [545, 198],
        [385, 198]
      )
      .fill();

    // =========================
    // INFO CARD
    // =========================

    const infoCard = (
      x,
      y,
      w,
      h,
      title,
      value
    ) => {
      roundedBox(
        x,
        y,
        w,
        h,
        COLORS.white,
        COLORS.border,
        16
      );

      // LEFT STRIP

      doc
        .fillColor(COLORS.accentLight)
        .roundedRect(
          x,
          y,
          8,
          h,
          16
        )
        .fill();

      // LABEL

      drawText(
        title,
        x + 24,
        y + 15,
        9,
        COLORS.secondary,
        true
      );

      // VALUE

      drawText(
        value,
        x + 24,
        y + 38,
        13,
        COLORS.primary,
        true
      );
    };

    // =========================
    // CUSTOMER INFO
    // =========================

    let infoY = 225;

    infoCard(
      30,
      infoY,
      255,
      70,
      "Customer Name",
      customer?.name || "-"
    );

    infoCard(
      310,
      infoY,
      255,
      70,
      "Invoice Number",
      String(
        invoice.invoice_number ||
          invoice.id
      )
    );

    infoCard(
      30,
      infoY + 85,
      255,
      70,
      "Customer Address",
      customer?.address || "-"
    );

    infoCard(
      310,
      infoY + 85,
      255,
      70,
      "Invoice Date",
      new Date(
        invoice.invoice_date ||
          invoice.createdAt
      ).toLocaleDateString("en-IN")
    );

    infoCard(
      30,
      infoY + 170,
      255,
      70,
      "State",
      customer?.state || "Haryana"
    );

    infoCard(
      310,
      infoY + 170,
      255,
      70,
      "State Code",
      customer?.state_code ||
        customer?.store_code?.substring(0, 2)
    );

    // =========================
    // TABLE START
    // =========================

    let y = 500;

    const columns = [
      {
        title: "S.No",
        x: 30,
        width: 50,
      },
      {
        title: "Product",
        x: 80,
        width: 145,
      },
      {
        title: "Purity",
        x: 225,
        width: 70,
      },
      {
        title: "Gross",
        x: 295,
        width: 70,
      },
      {
        title: "Less",
        x: 365,
        width: 70,
      },
      {
        title: "Net",
        x: 435,
        width: 70,
      },
      {
        title: "Rate",
        x: 505,
        width: 60,
      },
    ];

    // =========================
    // TABLE HEADER
    // =========================

    columns.forEach((col) => {
      doc
        .fillColor(COLORS.tableHead)
        .roundedRect(
          col.x,
          y,
          col.width,
          42,
          0
        )
        .fill();

      drawText(
        col.title,
        col.x,
        y + 14,
        10,
        COLORS.white,
        true,
        "center",
        col.width
      );
    });

    y += 42;

    // =========================
    // TOTALS
    // =========================

    let totalNet = 0;
    let totalRate = 0;
    let totalAmount = 0;

    // =========================
    // TABLE ROWS
    // =========================

    items.forEach((item, index) => {
      const bg =
        index % 2 === 0
          ? "#FFFFFF"
          : "#FAF7F4";

      const gross = Number(
        item.gross_weight || 0
      );

      const less = Number(
        item.less_weight || 0
      );

      const net = Number(
        item.net_weight || 0
      );

      const rate = Number(
        item.rate || 0
      );

      const amount = Number(
        item.total_amount || 0
      );

      totalNet += net;
      totalRate += rate;
      totalAmount += amount;

      const row = [
        index + 1,
        item.description || "-",
        item.purity || "-",
        gross.toFixed(3),
        less.toFixed(3),
        net.toFixed(3),
        rate.toFixed(2),
      ];

      columns.forEach((col, i) => {
        doc
          .fillColor(bg)
          .rect(
            col.x,
            y,
            col.width,
            44
          )
          .fill();

        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .rect(
            col.x,
            y,
            col.width,
            44
          )
          .stroke();

        drawText(
          row[i],
          col.x,
          y + 15,
          10,
          COLORS.primary,
          i === 1,
          "center",
          col.width
        );
      });

      y += 44;
    });

    // =========================
    // TOTAL ROW
    // =========================

    doc
      .fillColor(COLORS.accentLight)
      .roundedRect(
        30,
        y,
        535,
        50,
        12
      )
      .fill();

    drawText(
      "TOTAL",
      50,
      y + 17,
      12,
      COLORS.secondary,
      true
    );

    drawText(
      totalNet.toFixed(3),
      438,
      y + 17,
      11,
      COLORS.primary,
      true
    );

    drawText(
      totalRate.toFixed(2),
      510,
      y + 17,
      11,
      COLORS.primary,
      true
    );

    // =========================
    // TAX
    // =========================

    const sgst =
      totalAmount * 0.015;

    const cgst =
      totalAmount * 0.015;

    const grandTotal =
      totalAmount + sgst + cgst;

    // =========================
    // SUMMARY BOX
    // =========================

    const summaryX = 330;
    const summaryY = y + 80;

    roundedBox(
      summaryX,
      summaryY,
      235,
      125,
      COLORS.white,
      COLORS.border,
      16
    );

    const summaryRows = [
      [
        "SGST 1.5%",
        sgst.toFixed(2),
      ],
      [
        "CGST 1.5%",
        cgst.toFixed(2),
      ],
      [
        "Grand Total",
        grandTotal.toFixed(2),
      ],
    ];

    summaryRows.forEach(
      ([label, value], index) => {
        const rowY =
          summaryY + index * 41;

        const fill =
          label === "Grand Total"
            ? COLORS.accentLight
            : COLORS.white;

        doc
          .fillColor(fill)
          .rect(
            summaryX,
            rowY,
            235,
            41
          )
          .fill();

        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .rect(
            summaryX,
            rowY,
            235,
            41
          )
          .stroke();

        drawText(
          label,
          summaryX + 18,
          rowY + 14,
          11,
          COLORS.primary,
          true
        );

        drawText(
          value,
          summaryX + 145,
          rowY + 14,
          11,
          COLORS.primary,
          true
        );
      }
    );

    // =========================
    // FOOTER
    // =========================

    doc
      .strokeColor("#D9C2A8")
      .lineWidth(1.5)
      .moveTo(220, 800)
      .lineTo(370, 800)
      .stroke();

    drawText(
      "This is a computer generated invoice.",
      0,
      812,
      10,
      COLORS.text,
      false,
      "center",
      595
    );

    // =========================
    // END PDF
    // =========================

    doc.end();
  } catch (err) {
    console.error(
      "Download Invoice Error:",
      err
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          "Failed to download invoice",
        error: err.message,
      });
    }

    return res.end();
  }
};
