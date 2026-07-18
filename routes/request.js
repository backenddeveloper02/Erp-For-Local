import express from "express";
import { auth } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/upload.js";

import {
  createStockRequest,
  getMyStockRequests,
  getReceivedStockRequests,
  getStockRequestById,
  cancelStockRequest,
  rejectStockRequest,
  approveAndDispatchRequest,
  receiveTransfer,
  getIncomingTransfers,
  getOutgoingTransfers,
  getAvailableStockForRequest,
  getTransferDetails,
  getEWayBillByTransferId,
  estimateDispatchRequestValue,
  createDistrictStockRequest,
  getHeadStore,
  getRetailStoresUnderDistrict,
  approveAndDispatchRequestfromretail,
  forwardRequestToDistrictDirectDelivery,downloadDeliveryChallanByTransfer,dispatchNewItemTransfer,

  //  District request ko selected retail store ko forward/transfer karne ke liye
  // Agar ye controller stockRequest.controller.js me export nahi hai,
  // to pehle us controller ko add/export karna padega.
  transferDistrictRequestToRetail,
  dispatchDistrictToRetailDirectTransfer,
} from "../controller/stockRequest.controller.js";

import {
  getHeadReceivedStockRequests,
  approveAndDispatchHeadRequest,
  createHeadStockRequest,
  getHeadAllTransfers,
  getAvailableStoresForHeadRequest,
  getAnyTransferDetailsForHead,
} from "../controller/headoffice/headrequestflow.js";
import {raiseTransferComplaint,getStoreComplaints} from "../controller/stockTransferComplaintController.js";
const router = express.Router();

/* =====================================================
   INVENTORY / AVAILABLE STOCK
===================================================== */

router.get("/getinventory", auth, getAvailableStockForRequest);

/* =====================================================
   COMMON STOCK REQUEST FLOW
===================================================== */

router.post("/requests", auth, createStockRequest);

router.get("/requests/my", auth, getMyStockRequests);

router.get("/requests/received", auth, getReceivedStockRequests);

router.get("/requests/:requestId", auth, getStockRequestById);

router.put("/requests/:requestId/cancel", auth, cancelStockRequest);

router.put("/requests/:requestId/reject", auth, rejectStockRequest);

/* =====================================================
   RETAIL APPROVE + DISPATCH FLOW
   Retail forwarded request ko approve + dispatch karega
===================================================== */

router.post(
  "/requests/:requestId/approve-dispatch-from-retail",
  auth,
  upload.fields([
    { name: "driver_photo", maxCount: 1 },
    { name: "dispatch_images", maxCount: 3 },
    { name: "dispatch_video", maxCount: 1 },
    { name: "e_way_bill", maxCount: 1 },
  ]),
  approveAndDispatchRequestfromretail
);

/* =====================================================
   DISTRICT APPROVE + DISPATCH FLOW
   District received request ko approve + dispatch karega
===================================================== */

router.put(
  "/requests/:requestId/approve-dispatch",
  auth,
  upload.fields([
    { name: "driver_photo", maxCount: 1 },
    { name: "dispatch_images", maxCount: 3 },
    { name: "dispatch_video", maxCount: 1 },
    { name: "e_way_bill", maxCount: 1 },
  ]),
  approveAndDispatchRequest
);

/* =====================================================
   TRANSFER FLOW
===================================================== */

router.get("/transfers/incoming", auth, getIncomingTransfers);

router.get("/transfers/outgoing", auth, getOutgoingTransfers);

router.put("/transfers/:transferId", auth, receiveTransfer);

router.get("/transfers/:id/details", auth, getTransferDetails);

router.get("/transfers/:id/e-way-bill", auth, getEWayBillByTransferId);

router.post(
  "/stock-requests/:requestId/estimate-dispatch-value",
  auth,
  estimateDispatchRequestValue
);

/* =====================================================
   DISTRICT REQUEST FLOW
   District Head ko ya Retail ko request bana sakta hai
===================================================== */



//YE NEW SCREEN FLOW K ACCORDING H CREATE REQUEST 
router.post(
  "/district-stock-request",
  auth,
  createDistrictStockRequest
);

/**
 *  DISTRICT POPUP ROUTE
 *
 * District screen me jab Transfer button click hoga,
 * popup ke dropdown me retail stores dikhane ke liye ye API hit hogi.
 *
 * Full URL:
 * GET /request/district/retail-stores
 */
router.get(
  "/district/retail-stores",
  auth,
  getRetailStoresUnderDistrict
);
router.post(
  "/district-to-retail/direct-transfer",
  auth,
  upload.fields([
    { name: "driver_photo", maxCount: 1 },
    { name: "dispatch_images", maxCount: 10 },
    { name: "dispatch_video", maxCount: 1 },
    { name: "e_way_bill", maxCount: 1 },
  ]),
  dispatchDistrictToRetailDirectTransfer
);
/**
 *  DISTRICT -> RETAIL TRANSFER / FORWARD FLOW
 *
 * District kisi received/original request ko selected retail store ko forward karega.
 *
 * Full URL:
 * POST /request/district/requests/:requestId/transfer-to-retail
 *
 * Body:
 * {
 *   "retail_organization_id": 21,
 *   "notes": "Please fulfill this request from retail store."
 * }
 */
router.post(
  "/district/requests/:requestId/transfer-to-retail",
  auth,
  transferDistrictRequestToRetail
);

/* =====================================================
   HEAD STORE / AVAILABLE STORE FLOW
===================================================== */

/**
 *  Head store fetch ke liye separate route.
 *
 * Pehle ye bhi /head/available-stores par tha,
 * isliye duplicate conflict aa raha tha.
 */
router.post(
  "/head/store",
  auth,
  getHeadStore
);

/**
 *  OLD DUPLICATE ROUTE - commented
 *
 * Ye route duplicate tha:
 * POST /head/available-stores
 *
 * Isko use mat karo, kyunki neeche getAvailableStoresForHeadRequest
 * bhi same route par already mounted hai.
 */
// router.post(
//   "/head/available-stores",
//   auth,
//   getHeadStore
// );

/**
 *  OLD WRONG ROUTE - commented
 *
 * getRetailStoresUnderDistrict ko /head/available-stores par mount karna wrong tha.
 * District retail popup ke liye ab correct route hai:
 *
 * GET /district/retail-stores
 */
// router.post(
//   "/head/available-stores",
//   auth,
//   getRetailStoresUnderDistrict
// );

/* =====================================================
   HEAD REQUEST FLOW
===================================================== */

router.get("/headrece", auth, getHeadReceivedStockRequests);

router.post(
  "/requestshead/:requestId/approve-dispatch",
  auth,
  upload.fields([
    { name: "driver_photo", maxCount: 1 },
    { name: "dispatch_images", maxCount: 3 },
    { name: "dispatch_video", maxCount: 1 },
  ]),
  approveAndDispatchHeadRequest
);

/**
 *  Head available stores ke liye final route.
 *
 * Full URL:
 * POST /request/head/available-stores
 */
// router.post(
//   "/head/available-stores",
//   auth,
//   getAvailableStoresForHeadRequest
// );
router.get(
  "/available-stores/:target_type",
  auth,
  getAvailableStoresForHeadRequest
);
router.post(
  "/head/create",
  auth,
  createHeadStockRequest
);

export const newItemDispatchUpload = upload.fields([
  { name: "driver_photo", maxCount: 1 },
  { name: "dispatch_images", maxCount: 3 },
  { name: "dispatch_video", maxCount: 1 },
  { name: "e_way_bill", maxCount: 1 },
]);

router.post(
  "/stock-transfer/new-item-dispatch",
  auth,
  newItemDispatchUpload, // multer fields middleware
  dispatchNewItemTransfer
);
router.get(
  "/head/transfers/:id",
  auth,
  getAnyTransferDetailsForHead
);

router.get(
  "/transfers/head/all",
  auth,
  getHeadAllTransfers
);

/* =====================================================
   HEAD REQUEST TRANSFER FLOW
   Head kisi request ko District ko forward/direct delivery de sakta hai
===================================================== */

router.post(
  "/head/requests/:requestId/transfer-to-district",
  auth,
  forwardRequestToDistrictDirectDelivery
);


router.get(
  "/transfers/:transferId/delivery-challan/download",
  auth,
  downloadDeliveryChallanByTransfer
);
router.post(
  "/transfers/:transferId/complaint",
  auth,
  upload.fields([
    {
      name: "images",
      maxCount: 2,
    },
    {
      name: "video",
      maxCount: 1,
    },
  ]),
  raiseTransferComplaint
);
router.get(
  "/complaints/store",
  auth,
  getStoreComplaints
);
export default router;
