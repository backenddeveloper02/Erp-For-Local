import QRCode from "qrcode";

const generateItemQR = async (item) => {
  const qrValue = item.sku_code || item.article_code;

  if (!qrValue) {
    throw new Error("QR value missing");
  }

  const qrCodeUrl = await QRCode.toDataURL(qrValue, {
    width: 300,
    margin: 2,
  });

  return {
    qr_code_value: qrValue,
    qr_code_url: qrCodeUrl,
  };
};