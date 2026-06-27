import axios from "axios";

export const getGoldRate = async () => {
  try {
    const apiKey = process.env.GOLD_API_KEY;

    if (!apiKey) {
      throw new Error("GOLD_API_KEY missing in .env");
    }

    const response = await axios.get("https://www.goldapi.io/api/XAU/INR", {
      headers: {
        "x-access-token": apiKey,
        "Content-Type": "application/json",
      },
    });

    const data = response.data;

    console.log("GOLD API RAW DATA:", data);

    const pricePerOunce = Number(data.price || 0);

    if (!pricePerOunce) {
      throw new Error("Gold API price not found");
    }

    const priceGram24k = pricePerOunce / 31.1034768;
    const priceGram22k = priceGram24k * (22 / 24);
    const priceGram18k = priceGram24k * (18 / 24);

    let silverPriceGram = 0;

    try {
      const silverResponse = await axios.get("https://www.goldapi.io/api/XAG/INR", {
        headers: {
          "x-access-token": apiKey,
          "Content-Type": "application/json",
        },
      });

      const silverData = silverResponse.data;
      console.log("SILVER API RAW DATA:", silverData);

      const silverPerOunce = Number(silverData.price || 0);
      silverPriceGram = silverPerOunce / 31.1034768;
    } catch (silverErr) {
      console.error("Silver rate error:", silverErr.response?.data || silverErr.message);
    }

    return {
      price_gram_24k: Number(priceGram24k.toFixed(2)),
      price_gram_22k: Number(priceGram22k.toFixed(2)),
      price_gram_18k: Number(priceGram18k.toFixed(2)),
      silver_price_gram: Number(silverPriceGram.toFixed(2)),
      currency: "INR",
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch (error) {
    console.error("getGoldRate error:", error.response?.data || error.message);

    return {
      price_gram_24k: 0,
      price_gram_22k: 0,
      price_gram_18k: 0,
      silver_price_gram: 0,
      currency: "INR",
      timestamp: null,
    };
  }
};