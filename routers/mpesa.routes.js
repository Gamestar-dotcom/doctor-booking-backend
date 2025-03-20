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
      // Debug info
      console.log("STK Push Request:", JSON.stringify(req.body, null, 2));
      console.log("User ID from token:", req.user.id);

      const accessToken = await getAccessToken();
      if (!accessToken) {
        console.error("Failed to get M-Pesa access token");
        return res
          .status(500)
          .json({ message: "Failed to get MPesa access token" });
      }
      console.log("Got M-Pesa access token successfully");

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

      console.log("M-Pesa STK Push Payload:", JSON.stringify(payload, null, 2));
      console.log("M-Pesa Callback URL:", process.env.MPESA_CALLBACK_URL);

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

      console.log("M-Pesa STK Push Response:", JSON.stringify(data, null, 2));

      // ✅ Store the pending payment in the `payments` table
      const checkoutRequestId = data.CheckoutRequestID;
      console.log(
        `Storing payment with CheckoutRequestID: ${checkoutRequestId}`
      );

      await conn.execute(
        `INSERT INTO payments (mpesa_receipt, phone_number, amount, status, user_id) 
       VALUES (?, ?, ?, ?, ?)`,
        [checkoutRequestId, phoneNumber, amount, "Pending", userId]
      );

      console.log("Payment record inserted successfully");

      res.status(200).json(data);
    } catch (error) {
      console.error(
        "MPesa STK Push Error:",
        error.response?.data || error.message
      );
      console.error("Full error:", error);
      res.status(500).json({ message: "Failed to initiate STK Push" });
    }
  }
);

// ✅ Handle MPesa Callback with enhanced debugging
router.post("/callback", async (req, res) => {
  console.log("=== M-PESA CALLBACK RECEIVED ===");
  console.log("Callback timestamp:", new Date().toISOString());
  console.log("Callback headers:", JSON.stringify(req.headers, null, 2));
  console.log("Callback body (raw):", JSON.stringify(req.body, null, 2));

  try {
    // Validate callback structure
    if (!req.body || typeof req.body !== "object") {
      console.error("Invalid callback: body is not an object");
      return res
        .status(200)
        .json({
          resultCode: 0,
          resultDesc: "Callback received but invalid format",
        });
    }

    const { Body } = req.body;

    if (!Body || !Body.stkCallback) {
      console.error("Invalid callback: missing Body.stkCallback");
      console.error(
        "Received body structure:",
        Object.keys(req.body).join(", ")
      );
      return res
        .status(200)
        .json({
          resultCode: 0,
          resultDesc: "Callback received but missing stkCallback",
        });
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = Body.stkCallback;

    console.log("Extracted callback data:", {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata: CallbackMetadata || "Not provided",
    });

    // Check if the transaction was successful (ResultCode 0 means success)
    const status = ResultCode === 0 ? "Completed" : "Failed";
    console.log(`Setting payment status to: ${status}`);

    // First, query to check if this payment exists
    console.log(
      `Looking for payment with mpesa_receipt = ${CheckoutRequestID}`
    );
    const [existingPayments] = await conn.execute(
      `SELECT * FROM payments WHERE mpesa_receipt = ?`,
      [CheckoutRequestID]
    );

    console.log(
      `Found ${existingPayments.length} matching payments in database`
    );

    if (existingPayments.length === 0) {
      // Try with wildcard search as fallback
      console.log("No exact match found, trying wildcard search");
      const [wildcardPayments] = await conn.execute(
        `SELECT * FROM payments WHERE mpesa_receipt LIKE ?`,
        [`%${CheckoutRequestID}%`]
      );

      console.log(`Wildcard search found ${wildcardPayments.length} payments`);

      if (wildcardPayments.length === 0) {
        console.error(
          `Payment with CheckoutRequestID ${CheckoutRequestID} not found in database`
        );
        return res
          .status(200)
          .json({
            resultCode: 0,
            resultDesc: "Callback received but payment not found",
          });
      }

      // Use the first matching payment from wildcard search
      const paymentId = wildcardPayments[0].id;
      console.log(`Using payment ID ${paymentId} from wildcard search`);

      // Update payment status
      await conn.execute(`UPDATE payments SET status = ? WHERE id = ?`, [
        status,
        paymentId,
      ]);

      console.log(`Updated payment status to ${status} for ID ${paymentId}`);
    } else {
      // Update payment status with exact match
      await conn.execute(
        `UPDATE payments SET status = ? WHERE mpesa_receipt = ?`,
        [status, CheckoutRequestID]
      );

      console.log(
        `Updated payment status to ${status} for mpesa_receipt ${CheckoutRequestID}`
      );
    }

    // Additional validation to confirm the update worked
    const [verifyUpdate] = await conn.execute(
      `SELECT * FROM payments WHERE mpesa_receipt = ?`,
      [CheckoutRequestID]
    );

    console.log(
      "Post-update payment record:",
      JSON.stringify(verifyUpdate[0] || "Not found", null, 2)
    );

    console.log(
      `M-Pesa callback processed successfully at ${new Date().toISOString()}`
    );
    res
      .status(200)
      .json({ resultCode: 0, resultDesc: "Callback processed successfully" });
  } catch (error) {
    console.error("=== M-PESA CALLBACK ERROR ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);

    // Always respond with 200 to M-Pesa to acknowledge receipt
    res
      .status(200)
      .json({
        resultCode: 0,
        resultDesc: "Callback received with processing errors",
      });
  }
});

// ✅ Get logged-in user's payments
router.get("/payments", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from token
    console.log(`Fetching payments for user ID: ${userId}`);

    const [rows] = await conn.execute(
      "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );

    console.log(`Found ${rows.length} payments for user ID ${userId}`);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No payments found." });
    }

    res.status(200).json({ payments: rows });
  } catch (error) {
    console.error("Error fetching payments:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({ message: "Failed to fetch payments." });
  }
});

// ✅ Get payment status by checkout request ID
router.get("/payment-status/:checkoutRequestId", async (req, res) => {
  const { checkoutRequestId } = req.params;
  console.log(
    `Checking payment status for checkoutRequestId: ${checkoutRequestId}`
  );

  try {
    // First try exact match
    const [exactRows] = await conn.execute(
      "SELECT id, status, created_at, updated_at FROM payments WHERE mpesa_receipt = ?",
      [checkoutRequestId]
    );

    console.log(`Exact match search found ${exactRows.length} payments`);

    // If no exact match, try substring match
    if (exactRows.length === 0) {
      console.log("No exact match found, trying substring match");
      const [wildcardRows] = await conn.execute(
        "SELECT id, status, created_at, updated_at FROM payments WHERE mpesa_receipt LIKE ?",
        [`%${checkoutRequestId}%`]
      );

      console.log(`Substring match found ${wildcardRows.length} payments`);

      if (wildcardRows.length === 0) {
        console.log("No payment found with either search method");
        return res.status(404).json({ message: "Payment not found" });
      }

      // Return the most recent matching payment
      console.log(
        "Returning status from substring match:",
        wildcardRows[0].status
      );
      return res.json({
        status: wildcardRows[0].status,
        payment_id: wildcardRows[0].id,
        created_at: wildcardRows[0].created_at,
        updated_at: wildcardRows[0].updated_at,
      });
    }

    // Return the payment status from exact match
    console.log("Returning status from exact match:", exactRows[0].status);
    res.json({
      status: exactRows[0].status,
      payment_id: exactRows[0].id,
      created_at: exactRows[0].created_at,
      updated_at: exactRows[0].updated_at,
    });
  } catch (error) {
    console.error("Error fetching payment status:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
