import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const getAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  // Check if credentials exist
  if (!consumerKey || !consumerSecret) {
    console.error("M-Pesa credentials missing in environment variables");
    return null;
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64"
  );

  try {
    console.log("Attempting to get M-Pesa access token...");

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        timeout: 10000, // 10 seconds timeout
      }
    );

    console.log("M-Pesa API responded with status:", response.status);

    if (response.data && response.data.access_token) {
      console.log("Successfully received access token");
      return response.data.access_token;
    } else {
      console.error("Invalid response format from M-Pesa API:", response.data);
      return null;
    }
  } catch (error) {
    console.error("M-Pesa Access Token Error Details:");

    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error("Status:", error.response.status);
      console.error("Response data:", error.response.data);
      console.error("Response headers:", error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error("No response received:", error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error("Request setup error:", error.message);
    }

    return null;
  }
};

export default getAccessToken;
