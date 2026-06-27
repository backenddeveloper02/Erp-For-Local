import multer from "multer";

const storage = multer.memoryStorage();

export const uploadInventoryFile = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },

  fileFilter: (req, file, cb) => {
    const fileName = file.originalname.toLowerCase();

    const allowed =
      file.mimetype === "application/pdf" ||
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel" ||
      fileName.endsWith(".pdf") ||
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls");

    if (!allowed) {
      return cb(new Error("Only PDF, XLSX and XLS files are allowed"), false);
    }

    cb(null, true);
  },
});