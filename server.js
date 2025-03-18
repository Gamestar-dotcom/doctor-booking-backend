import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRoutes from "./routers/auth.routes.js";
import conn from "./connectDB/DB.js"; // Import database connection
import doctorRoutes from "./routers/doctor.routes.js";
import appointmentRoutes from "./routers/appointment.routes.js";
import paymentRoutes from "./routers/payment.routes.js";
import adminRoutes from "./routers/admin.routes.js";
// import compression from "compression";

dotenv.config();

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  cors()
  //   {
  //   origin: "https://gamestar-dotcom.github.io",
  //   methods: ["GET", "POST", "PUT", "DELETE"],
  //   allowedHeaders: ["Content-Type", "Authorization"],
  //   credentials: true,
  // }
);

// Routes
app.use("/api/users", authRoutes);
app.use("/api/doctor", doctorRoutes);
app.use("/api/appointment", appointmentRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/admin", adminRoutes);

// Test MySQL Connection Before Starting Server
conn
  .query("SELECT 1")
  .then(() => {
    console.log("✅ MySQL Database Connected Successfully");

    const PORT = process.env.DB_PORT;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1); // Exit process if DB connection fails
  });

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Global Error Handler:", err);
  res.status(500).json({ message: "Something went wrong!" });
});
