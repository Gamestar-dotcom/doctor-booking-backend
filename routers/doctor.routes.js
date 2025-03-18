import express from "express";
import conn from "../connectDB/DB.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middlewares/authenticateToken.js";
import asyncHandler from "../utils/asyncHandler.js";

const router = express.Router();

// Get all doctors
router.get(
  "/",
  asyncHandler(async (req, res) => {
    try {
      const [doctors] = await conn.query(`
      SELECT d.id, u.name, u.email, d.speciality, d.experience, d.fee
      FROM doctors d
      JOIN users u ON d.user_id = u.id
    `);

      if (doctors.length === 0) {
        return res.status(404).json({ message: "No doctors found" });
      }

      res.json(doctors);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Get doctor by ID
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [doctors] = await conn.query(
        `
      SELECT d.id, u.name, u.email, d.speciality, d.experience, d.fee
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `,
        [req.params.id]
      );

      if (doctors.length === 0) {
        return res.status(404).json({ message: "Doctor not found" });
      }

      res.json(doctors[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Add doctor profile (for users with doctor role)
router.put(
  "/",
  authenticateToken,
  authorizeRoles("doctor", "admin"),
  asyncHandler(async (req, res) => {
    try {
      const { speciality, experience, fee } = req.body;

      // Ensure the doctor profile exists
      const [existingProfiles] = await conn.query(
        "SELECT * FROM doctors WHERE user_id = ?",
        [req.user.id]
      );

      if (existingProfiles.length === 0) {
        return res.status(404).json({ message: "Doctor profile not found" });
      }

      // Update the existing doctor profile
      await conn.query(
        "UPDATE doctors SET speciality = ?, experience = ?, fee = ? WHERE user_id = ?",
        [speciality, experience, fee, req.user.id]
      );

      // Fetch updated user details from the database
      const [updatedDoctor] = await conn.query(
        "SELECT users.id, users.name, users.email, doctors.speciality, doctors.experience, doctors.fee " +
          "FROM users " +
          "JOIN doctors ON users.id = doctors.user_id " +
          "WHERE users.id = ?",
        [req.user.id]
      );

      res.json({
        message: "Doctor profile updated successfully",
        updatedUser: updatedDoctor[0], // Ensure it's not an array
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);
// Create doctor profile (for users with doctor role)
router.post(
  "/",
  authenticateToken,
  authorizeRoles("doctor", "admin"),
  asyncHandler(async (req, res) => {
    try {
      const { speciality, experience, fee } = req.body;

      // Check if the doctor profile already exists
      const [existingProfiles] = await conn.query(
        "SELECT * FROM doctors WHERE user_id = ?",
        [req.user.id]
      );

      if (existingProfiles.length > 0) {
        return res
          .status(400)
          .json({ message: "Doctor profile already exists" });
      }

      // Create a new doctor profile
      await conn.query(
        "INSERT INTO doctors (user_id, speciality, experience, fee) VALUES (?, ?, ?, ?)",
        [req.user.id, speciality, experience, fee]
      );

      // Fetch the newly created doctor profile
      const [newDoctor] = await conn.query(
        "SELECT users.id, users.name, users.email, doctors.speciality, doctors.experience, doctors.fee " +
          "FROM users " +
          "JOIN doctors ON users.id = doctors.user_id " +
          "WHERE users.id = ?",
        [req.user.id]
      );

      res.json({
        message: "Doctor profile created successfully",
        doctor: newDoctor[0],
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Delete doctor profile (Admin only)
router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("admin"),
  asyncHandler(async (req, res) => {
    try {
      const doctorId = req.params.id;

      // Check if the doctor exists
      const [doctors] = await conn.query("SELECT * FROM doctors WHERE id = ?", [
        doctorId,
      ]);

      if (doctors.length === 0) {
        return res.status(404).json({ message: "Doctor not found" });
      }

      // Delete the doctor profile
      await conn.query("DELETE FROM doctors WHERE id = ?", [doctorId]);

      res.json({ message: "Doctor profile deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Search doctors by speciality
router.get("/search", async (req, res) => {
  try {
    const { speciality } = req.query;

    if (!speciality) {
      return res
        .status(400)
        .json({ message: "Speciality query parameter is required" });
    }

    const [doctors] = await conn.query(
      `
      SELECT d.id, u.name, u.email, d.speciality, d.experience, d.fee
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      WHERE d.speciality LIKE ?
    `,
      [`%${speciality}%`]
    );

    res.json(doctors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get appointments for a specific doctor
router.get(
  "/get-doctor-appointments/:id",
  asyncHandler(async (req, res) => {
    try {
      const doctorId = req.params.id;

      const [appointments] = await conn.query(
        `
      SELECT a.id AS appointment_id, a.appointment_date, a.status,
             p.name AS patient_name, p.email AS patient_email
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      WHERE a.doctor_id = ?
    `,
        [doctorId]
      );

      res.json(appointments);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Update doctor availability
router.patch(
  "/availability",
  authenticateToken,
  authorizeRoles("doctor", "admin"),
  asyncHandler(async (req, res) => {
    try {
      const { isAvailable } = req.body;

      // Update the doctor's availability status
      await conn.query(
        "UPDATE doctors SET is_available = ? WHERE user_id = ?",
        [isAvailable, req.user.id]
      );

      res.json({ message: "Doctor availability updated successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

export default router;
