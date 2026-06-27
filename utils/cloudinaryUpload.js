import cloudinary from "./cloudinary";

export const uploadToCloudinary = async (
  filePath,
  folder,
  resourceType = "auto"
) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: resourceType,

      // ✅ public file URL
      type: "upload",

      access_mode: "public",
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });

    return result;
  } catch (error) {
    throw error;
  }
};