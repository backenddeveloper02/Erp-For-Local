import multer from "multer";

const storage = multer.memoryStorage();

export const uploadInventoryFile = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only Excel or CSV file allowed"));
    }

    cb(null, true);
  },
});