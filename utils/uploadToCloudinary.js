import streamifier from "streamifier";
import cloudinary from "./cloudinary.js";

const uploadToCloudinary = async (
  file,
  folder = "inventory/items"
) => {
  try {

    // ==========================================
    // MEMORY STORAGE
    // ==========================================

    if (file.buffer) {

      return await new Promise((resolve, reject) => {

        const stream =
          cloudinary.uploader.upload_stream(
            {
              folder,
              resource_type: "auto",

              type: "upload",
              access_mode: "public",

              use_filename: true,
              unique_filename: true,
              overwrite: false,
            },

            (error, result) => {

              if (error) {
                reject(error);
              } else {
                resolve(result);
              }

            }
          );

        streamifier
          .createReadStream(file.buffer)
          .pipe(stream);

      });

    }

    // ==========================================
    // DISK STORAGE
    // ==========================================

    if (file.path) {

      return await cloudinary.uploader.upload(
        file.path,
        {
          folder,
          resource_type: "auto",

          type: "upload",
          access_mode: "public",

          use_filename: true,
          unique_filename: true,
          overwrite: false,
        }
      );

    }

    throw new Error("Invalid file object");

  } catch (error) {
    throw error;
  }
};

export default uploadToCloudinary;
