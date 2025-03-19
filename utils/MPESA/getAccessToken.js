import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const getAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64"
  );

  try {
    const { data } = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    return data.access_token;
  } catch (error) {
    console.error(
      "MPesa Access Token Error:",
      error.response?.data || error.message
    );
    return null;
  }
};

export default getAccessToken;
