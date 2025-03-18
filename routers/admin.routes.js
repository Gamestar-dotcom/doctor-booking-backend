import conn from "../connectDB/DB.js";
import express from "express";
import asyncHandler from "../utils/asyncHandler.js";

import {
  authenticateToken,
  authorizeRoles,
} from "../middlewares/authenticateToken.js";

const router = express.Router();

//  geta all users
router.get(
  "/users",
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

//   get all appointments
router.get(
  "/appointments",
  authenticateToken,
  authorizeRoles("admin"),
  asyncHandler(async (req, res) => {
    try {
      const [appointments] = await conn.query(
        `
        SELECT a.id AS appointment_id, u1.name AS patient_name, u2.name AS doctor_name, a.appointment_date, a.status
        FROM appointments a
        JOIN users u1 ON a.patient_id = u1.id
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u2 ON d.user_id = u2.id
      `
      );
      res.json(appointments);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

//   update a use role
router.put(
  "/users/:id",
  authenticateToken,
  authorizeRoles("admin"),
  asyncHandler(async (req, res) => {
    try {
      const userId = req.params.id;
      const updates = req.body;

      // Ensure updates are not empty
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }

      // Validate role if it's in the update request
      if (updates.role) {
        const validRoles = ["admin", "doctor", "patient"];
        if (!validRoles.includes(updates.role)) {
          return res.status(400).json({ message: "Invalid role" });
        }
      }

      // Build dynamic SQL query
      const fields = Object.keys(updates)
        .map((key) => `${key} = ?`)
        .join(", ");
      const values = Object.values(updates);

      // Execute update query
      await conn.query(`UPDATE users SET ${fields} WHERE id = ?`, [
        ...values,
        userId,
      ]);

      res.json({ message: "User updated successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);
// Delete a user
router.delete(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    try {
      const { userId } = req.params;

      // Delete user and related data
      await conn.query("DELETE FROM users WHERE id = ?", [userId]);

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

export default router;
