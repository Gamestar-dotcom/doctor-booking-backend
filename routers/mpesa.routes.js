import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { body, validationResult } from "express-validator";
import getAccessToken from "../utils/MPESA/getAccessToken.js";
import conn from "../connectDB/DB.js";
import { authenticateToken } from "../middlewares/authenticateToken.js";
import rateLimit from "express-rate-limit";

dotenv.config();
const router = express.Router();

// ✅ Rate limiting middleware to prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests
  message: "Too many requests from this IP, please try again later",
});

// ✅ Input validation middleware for STK push
const validateStkPush = [
  body("phoneNumber")
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^254[0-9]{9}$/)
    .withMessage("Phone number must be in format 254XXXXXXXXX"),
  body("amount")
    .notEmpty()
    .withMessage("Amount is required")
    .isNumeric()
    .withMessage("Amount must be a number")
    .isFloat({ min: 1 })
    .withMessage("Amount must be at least 1"),
];

// ✅ Initialize MPesa STK Push request
router.post(
  "/stkpush",
  authenticateToken,
  apiLimiter,
  validateStkPush,
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        return res
          .status(500)
          .json({ message: "Failed to get MPesa access token" });
      }

      const { phoneNumber, amount } = req.body;
      const userId = req.user.id; // Get user ID from token
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
        AccountReference: "MediConnect",
        TransactionDesc: "Booking Payment",
      };

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

      // ✅ Store the pending payment in the `payments` table
      await conn.execute(
        `INSERT INTO payments (mpesa_receipt, phone_number, amount, status, user_id) 
       VALUES (?, ?, ?, ?, ?)`,
        [data.CheckoutRequestID, phoneNumber, amount, "Pending", userId]
      );

      res.status(200).json(data);
    } catch (error) {
      console.error(
        "MPesa STK Push Error:",
        error.response?.data || error.message
      );
      res.status(500).json({ message: "Failed to initiate STK Push" });
    }
  }
);

// ✅ Handle MPesa Callback
router.post("/callback", async (req, res) => {
  try {
    const { Body } = req.body;
    console.log("Received M-Pesa Callback:", JSON.stringify(req.body, null, 2)); // Better logging

    if (!Body || !Body.stkCallback) {
      return res.status(400).json({ message: "Invalid callback data" });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc } =
      Body.stkCallback;

    // Check if the transaction was successful (ResultCode 0 means success)
    const status = ResultCode === 0 ? "Completed" : "Failed";

    // First, query to check if this payment exists
    const [payments] = await conn.execute(
      `SELECT * FROM payments WHERE mpesa_receipt = ?`,
      [CheckoutRequestID]
    );

    if (payments.length === 0) {
      console.log(
        `Payment with CheckoutRequestID ${CheckoutRequestID} not found in database`
      );
      return res.status(404).json({ message: "Payment record not found" });
    }

    // Update payment status in the database
    // Keep the CheckoutRequestID in mpesa_receipt field
    await conn.execute(
      `UPDATE payments SET status = ? WHERE mpesa_receipt = ?`,
      [status, CheckoutRequestID]
    );

    console.log(`Payment updated successfully for ${CheckoutRequestID}`);
    res.status(200).json({ message: "Payment status updated successfully" });
  } catch (error) {
    console.error("MPesa Callback Error:", error);
    res.status(500).json({ message: "Failed to process callback" });
  }
});

// ✅ Get logged-in user's payments
router.get("/payments", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from token

    const [rows] = await conn.execute(
      "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "No payments found." });
    }

    res.status(200).json({ payments: rows });
  } catch (error) {
    console.error("Error fetching payments:", error.message);
    res.status(500).json({ message: "Failed to fetch payments." });
  }
});
router.get("/payment-status/:checkoutRequestId", async (req, res) => {
  const { checkoutRequestId } = req.params;

  try {
    // Check if the payment exists in the database
    const [rows] = await conn.execute(
      "SELECT status FROM payments WHERE mpesa_receipt = ?",
      [checkoutRequestId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Return the payment status
    res.json({ status: rows[0].status });
  } catch (error) {
    console.error("Error fetching payment status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
