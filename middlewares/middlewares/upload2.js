import multer from "multer";
import path from "path";

// ================= STORAGE =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9);

    const ext = path.extname(file.originalname);
    cb(null, uniqueName + ext);
  },
});

// ================= FILE FILTER =================
const fileFilter = (req, file, cb) => {
  console.log("📂 Incoming File:", file.fieldname, file.mimetype);

  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    console.log("❌ Rejected File:", file.fieldname);
    cb(new Error("Only PDF, JPG, JPEG, PNG allowed"), false);
  }
};

// ================= MULTER =================
export const upload2 = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});