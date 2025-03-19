import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRoutes from "./routers/auth.routes.js";
import conn from "./connectDB/DB.js";
import doctorRoutes from "./routers/doctor.routes.js";
import appointmentRoutes from "./routers/appointment.routes.js";

import adminRoutes from "./routers/admin.routes.js";
import mpesaRoutes from "./routers/mpesa.routes.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.DB_PORT || 3000;

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Enhanced CORS configuration with specific headers
app.use(
  cors({
    origin: [
      "https://gamestar-dotcom.github.io",
      "https://gamestar-dotcom.github.io/Doctor-Booking-App",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    exposedHeaders: ["Authorization"],
    credentials: true,
    maxAge: 86400, // 24 hours in seconds - preflight requests cache
  })
);

// Explicit CORS preflight handler for credentials
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header(
    "Access-Control-Allow-Methods",
    "PATCH, GET,POST,PUT,DELETE,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept"
  );
  res.status(200).send();
});

// Routes
app.use("/api/users", authRoutes);
app.use("/api/doctor", doctorRoutes);
app.use("/api/appointment", appointmentRoutes);

app.use("/api/admin", adminRoutes);
app.use("/api/mpesa", mpesaRoutes);

// Test MySQL Connection Before Starting Server
const startServer = async () => {
  try {
    await conn.query("SELECT 1");
    console.log("✅ MySQL Database Connected Successfully");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }
};

startServer();

// Global Error Handler with better response
app.use((err, req, res, next) => {
  console.error("❌ Global Error Handler:", err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Something went wrong on the server";

  res.status(statusCode).json({
    success: false,
    message,
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (error) => {
  console.error("Unhandled Promise Rejection:", error);
});
