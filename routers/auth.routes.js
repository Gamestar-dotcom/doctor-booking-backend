import express from "express";
import bcrypt from "bcryptjs";
import conn from "../connectDB/DB.js";
import { generateToken } from "../utils/generateToken.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middlewares/authenticateToken.js";
import dotenv from "dotenv";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { sendVerificationEmail } from "../utils/sendEmail.js";
import asyncHandler from "../utils/asyncHandler.js";
dotenv.config();

const router = express.Router();

// Register route

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    try {
      const { name, email, password, role } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ message: "All fields are required." });
      }

      // Check if user already exists
      const [existingUsers] = await conn.query(
        "SELECT * FROM users WHERE email = ?",
        [email]
      );

      if (existingUsers.length > 0) {
        return res.status(400).json({ message: "User already exists" });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Insert new user
      const [result] = await conn.query(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        [name, email, hashedPassword, role || "patient"]
      );

      // Fetch the newly inserted user
      const [users] = await conn.query("SELECT * FROM users WHERE id = ?", [
        result.insertId,
      ]);
      const user = users[0];

      // If the user is a doctor, insert them into the `doctors` table
      if (user.role === "doctor") {
        await conn.query("INSERT INTO doctors (user_id) VALUES (?)", [user.id]);
        // Fetch the newly inserted doctor details
        const [doctor] = await conn.query(
          "SELECT id FROM doctors WHERE user_id = ?",
          [user.id]
        );
        // Attach doctorId to user object
        user.doctorId = doctor.length > 0 ? doctor[0].id : null;
      }

      // Generate verification token using crypto
      const verificationToken = crypto.randomBytes(32).toString("hex");

      // Set expiration time for the token (10 minutes from now)
      const expirationTime = new Date(Date.now() + 600000);

      // Update user with verification info
      await conn.query(
        "UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?",
        [verificationToken, expirationTime, user.id]
      );

      // Send verification email using our service
      await sendVerificationEmail(email, name, verificationToken);

      res.status(201).json({
        message:
          "User registered successfully. Please check your email to verify your account.",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          doctorId: user.doctorId || null,
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);
// Login route
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find user by email
      const [users] = await conn.query("SELECT * FROM users WHERE email = ?", [
        email,
      ]);

      if (users.length === 0) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const user = users[0];

      // Check password
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Fetch role-specific data (only for doctors)
      if (user.role === "doctor") {
        const [doctors] = await conn.query(
          "SELECT * FROM doctors WHERE user_id = ?",
          [user.id]
        );

        if (doctors.length > 0) {
          user.doctorId = doctors[0].id; // Add doctorId inside user object
          user.doctor = doctors[0];
        } else {
          return res.status(400).json({ message: "Doctor profile not found" });
        }
      }

      // Generate JWT token
      const token = generateToken(res, user.id, user.role);

      res.json({
        message: "Login successful",
        token,
        user, // Now contains doctorId if applicable
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Logout route
router.post(
  "/logout",
  authenticateToken,
  asyncHandler((req, res) => {
    res.cookie("jwt", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: new Date(0),
    });

    res.status(200).json({ message: "Logout successful" });
  })
);

// Get user by ID
router.get(
  "/:id",
  authenticateToken,
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;
      const [users] = await conn.query("SELECT * FROM users WHERE id = ?", [
        id,
      ]);
      const user = users[0];
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Update user by ID
router.put(
  "/:id",
  authenticateToken,
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, password, role } = req.body;

      // Prevent unauthorized role changes
      if (req.user.role !== "admin" && role && role !== req.user.role) {
        return res
          .status(403)
          .json({ message: "You are not allowed to change roles" });
      }

      // Dynamic query builder
      const updates = [];
      const values = [];

      if (name) {
        updates.push("name = ?");
        values.push(name);
      }
      if (email) {
        updates.push("email = ?");
        values.push(email);
      }
      if (password) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        updates.push("password = ?");
        values.push(hashedPassword);
      }
      if (role && req.user.role === "admin") {
        updates.push("role = ?");
        values.push(role);
      }

      // Ensure at least one field is being updated
      if (updates.length === 0) {
        return res
          .status(400)
          .json({ message: "No valid fields provided for update" });
      }

      // Execute the update
      const sqlQuery = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
      values.push(id);
      await conn.query(sqlQuery, values);

      // Fetch the updated user
      const [updatedUsers] = await conn.query(
        "SELECT * FROM users WHERE id = ?",
        [id]
      );
      const updatedUser = updatedUsers[0];

      res.json({ message: "User updated successfully", user: updatedUser });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Delete user by ID
router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("admin"),
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;
      await conn.query("DELETE FROM users WHERE id = ?", [id]);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);
// fetch all users
router.get(
  "/",
  authenticateToken,
  authorizeRoles("admin"),
  asyncHandler(async (req, res) => {
    try {
      const [users] = await conn.query("SELECT * FROM users");
      res.json(users);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);
// Forgot Password Route
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    try {
      // Check if user exists
      const [user] = await conn.query("SELECT * FROM users WHERE email = ?", [
        email,
      ]);
      if (user.length === 0) {
        return res.status(404).json({ message: "Email not found" });
      }

      // Generate a unique token
      const token = crypto.randomBytes(32).toString("hex");
      // expiires in 15 min
      const expiresAt = new Date(Date.now() + 900000); // Token expires in 15 min

      // Store token in database
      await conn.query(
        "INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)",
        [email, token, expiresAt]
      );

      // Send email with reset link
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
      // const resetLink = `https://gamestar-dotcom.github.io/Doctor-Booking-App/reset-password?token=${token}`;

      const resetLink = `http://localhost:5173/reset-password?token=${token}`;
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Password Reset Request",
        html: `<p>You requested a password reset. Click the link below to reset your password:</p>
            <a href="${resetLink}">${resetLink}</a>
            <p>This link will expire in 1 hour.</p>`,
      };

      await transporter.sendMail(mailOptions);

      res.json({ message: "Password reset link sent to your email." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);
router.post("/reset-password/:token", async (req, res) => {
  const { token, password } = req.body;

  try {
    // Check if token exists
    const [resetRequest] = await conn.query(
      "SELECT * FROM password_resets WHERE token = ?",
      [token]
    );
    if (resetRequest.length === 0) {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    const userEmail = resetRequest[0].email;

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user's password
    await conn.query("UPDATE users SET password = ? WHERE email = ?", [
      hashedPassword,
      userEmail,
    ]);

    // Delete used token
    await conn.query("DELETE FROM password_resets WHERE token = ?", [token]);

    res.json({ message: "Password has been reset successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Email verification route
// Route to handle email verification
router.get(
  "/verify-email/:token",
  asyncHandler(async (req, res) => {
    try {
      const { token } = req.params;
      // const {token} = "3a89caa833fb94e898e95a568414a0295c9eb276580e7e26afb142e4a152df37z"

      // Validate token format
      if (!token || typeof token !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "Invalid token format" });
      }

      try {
        // Query the users table for the token
        const [results] = await conn.query(
          "SELECT * FROM users WHERE verification_token = ?",
          [token]
        );
        console.log("results", results);

        if (results.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Invalid or expired verification token",
          });
        }

        const user = results[0];
        console.log("user", user);

        // Check if token has expired
        if (
          user.verification_expires &&
          new Date(user.verification_expires) < new Date()
        ) {
          return res.status(410).json({
            success: false,
            message: "Verification token has expired",
          });
        }

        // Check if already verified
        if (user.is_verified) {
          return res.status(200).json({
            success: true,
            message: "Email already verified",
          });
        }

        // Update user record - set verified to true, clear token and expiry
        await conn.query(
          "UPDATE users SET is_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?",
          [user.id]
        );

        // Return success
        return res.status(200).json({
          success: true,
          message: "Email verification successful",
        });
      } catch (error) {
        console.error("Error verifying email:", error);
        return res.status(500).json({
          success: false,
          message: "Server error during verification",
        });
      }
    } catch (error) {
      console.error("Error verifying email:", error);
      return res.status(500).json({
        success: false,
        message: "Server error during verification",
      });
    }
  })
);

router.post(
  "/resend-verification",
  asyncHandler(async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Find user with the given email
      const [users] = await conn.query("SELECT * FROM users WHERE email =?", [
        email,
      ]);
      if (users.length === 0) {
        return res.status(404).json({ message: "Email not found" });
      }

      const user = users[0];

      // Check if user is already verified
      if (user.verified) {
        return res.status(400).json({
          message: "Email is already verified. Please log in.",
        });
      }
      // Generate a unique verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      // expiires in 10 minutes
      const verificationExpires = new Date(Date.now() + 600000);

      // Update user with verification information
      await conn.query(
        "UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?",
        [verificationToken, verificationExpires, user.id]
      );

      // Send verification email
      await sendVerificationEmail(email, user.name, verificationToken);

      res
        .status(200)
        .json({ message: "Verification email sent successfully." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

export default router;
