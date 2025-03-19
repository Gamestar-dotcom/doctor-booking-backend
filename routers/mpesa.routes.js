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
  console.log("MPesa Callback Received:", req.body);

  const { Body } = req.body;
  if (!Body || !Body.stkCallback) {
    return res.status(400).json({ message: "Invalid callback data" });
  }

  const callbackData = Body.stkCallback;
  const resultCode = callbackData.ResultCode;
  const resultDesc = callbackData.ResultDesc;
  const mpesaReceipt = callbackData.CheckoutRequestID;

  // Start database transaction
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    if (resultCode === 0) {
      // ✅ Payment was successful
      const metadata = callbackData.CallbackMetadata;

      const transactionId =
        metadata.Item.find((item) => item.Name === "MpesaReceiptNumber")
          ?.Value || null;
      const amount =
        metadata.Item.find((item) => item.Name === "Amount")?.Value || null;
      const phoneNumber =
        metadata.Item.find((item) => item.Name === "PhoneNumber")?.Value ||
        null;
      const transactionDate =
        metadata.Item.find((item) => item.Name === "TransactionDate")?.Value ||
        null;

      console.log("✅ Payment Successful:", {
        transactionId,
        amount,
        phoneNumber,
      });

      // ✅ Update the `payments` table with actual transaction details
      await connection.execute(
        "UPDATE payments SET status = ?, mpesa_receipt = ?, transaction_date = ? WHERE mpesa_receipt = ?",
        ["Completed", transactionId, transactionDate, mpesaReceipt]
      );

      await connection.commit();
      console.log("💾 Payment updated in database.");
      res.status(200).json({ message: "Payment recorded successfully." });
    } else {
      // ❌ Payment failed
      console.log("❌ Payment Failed:", resultDesc);

      // ✅ Update the `payments` table with failure status
      await connection.execute(
        "UPDATE payments SET status = ?, failure_reason = ? WHERE mpesa_receipt = ?",
        ["Failed", resultDesc, mpesaReceipt]
      );

      await connection.commit();
      res.status(200).json({ message: "Payment failure recorded." });
    }
  } catch (error) {
    await connection.rollback();
    console.error("❌ Database Transaction Error:", error.message);
    res
      .status(500)
      .json({ message: "Database error while processing payment." });
  } finally {
    connection.release();
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

export default router;
