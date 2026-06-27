import axios from "axios";

const OUNCE_TO_GRAM = 31.1034768;

const defaultRate = () => ({
  price_gram_24k: 0,
  price_gram_22k: 0,
  price_gram_18k: 0,
  silver_price_gram: 0,
  silver_high_rate: 0,
  gold_change_percent: 0,
  silver_change_percent: 0,
  currency: "INR",
  timestamp: null,
});

export const getGoldRate = async () => {
  try {
    const apiKey = process.env.GOLD_API_KEY;

    if (!apiKey) {
      console.error("GOLD_API_KEY missing in .env");
      return defaultRate();
    }

    const headers = {
      "x-access-token": apiKey,
      "Content-Type": "application/json",
    };

    const goldRes = await axios.get("https://www.goldapi.io/api/XAU/INR", {
      headers,
    });

    const silverRes = await axios.get("https://www.goldapi.io/api/XAG/INR", {
      headers,
    });

    const goldData = goldRes.data;
    const silverData = silverRes.data;

    const goldPerOunce = Number(goldData.price || 0);
    const silverPerOunce = Number(silverData.price || 0);

    if (!goldPerOunce) {
      return defaultRate();
    }

    const goldGram24k = goldPerOunce / OUNCE_TO_GRAM;
    const goldGram22k = goldGram24k * (22 / 24);
    const goldGram18k = goldGram24k * (18 / 24);
    const silverGram = silverPerOunce / OUNCE_TO_GRAM;

    return {
      price_gram_24k: Number(goldGram24k.toFixed(2)),
      price_gram_22k: Number(goldGram22k.toFixed(2)),
      price_gram_18k: Number(goldGram18k.toFixed(2)),
      silver_price_gram: Number(silverGram.toFixed(2)),
      silver_high_rate: Number(silverGram.toFixed(2)),
      gold_change_percent: Number(goldData.chp || 0),
      silver_change_percent: Number(silverData.chp || 0),
      currency: "INR",
      timestamp: goldData.timestamp || new Date().toISOString(),
    };
  } catch (error) {
    console.error("getGoldRate error:", error.response?.data || error.message);
    return defaultRate();
  }
};