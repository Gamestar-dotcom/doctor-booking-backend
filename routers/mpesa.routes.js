import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import getAccessToken from "../utils/MPESA/getAccessToken.js"; // Ensure this function is properly set

dotenv.config();
const router = express.Router();

router.post("/stkpush", async (req, res) => {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return res
      .status(500)
      .json({ message: "Failed to get MPesa access token" });
  }

  const { phoneNumber, amount } = req.body; // Data from frontend
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14);
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phoneNumber,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: phoneNumber,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: "DoctorBookingApp",
    TransactionDesc: "Booking Payment",
  };

  try {
    const { data } = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json(data);
  } catch (error) {
    console.error(
      "MPesa STK Push Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ message: "Failed to initiate STK Push" });
  }
});

router.post("/callback", async (req, res) => {
  console.log("MPesa Callback Received:", req.body);

  const { Body } = req.body;
  if (!Body || !Body.stkCallback) {
    return res.status(400).json({ message: "Invalid callback data" });
  }

  const callbackData = Body.stkCallback;

  if (callbackData.ResultCode === 0) {
    // Payment successful
    console.log("Payment successful:", callbackData.CallbackMetadata);
  } else {
    console.log("Payment failed:", callbackData.ResultDesc);
  }

  res.status(200).json({ message: "Callback received successfully" });
});

export default router;
