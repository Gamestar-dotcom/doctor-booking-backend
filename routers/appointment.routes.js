import express from "express";
import conn from "../connectDB/DB.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middlewares/authenticateToken.js";
import asyncHandler from "../utils/asyncHandler.js";

const router = express.Router();
// Update appointment status
router.patch(
  "/:id",
  authenticateToken,
  authorizeRoles("doctor", "admin"),
  asyncHandler(async (req, res) => {
    try {
      const { status } = req.body;
      const appointmentId = req.params.id;
      console.log("Request body:", req.body);

      // Validate status
      const validStatuses = ["confirmed", "cancelled", "completed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      // Verify appointment exists
      const [appointments] = await conn.query(
        "SELECT * FROM appointments WHERE id = ?",
        [appointmentId]
      );
      if (appointments.length === 0) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      // Update appointment status
      await conn.query("UPDATE appointments SET status = ? WHERE id = ?", [
        status,
        appointmentId,
      ]);

      res.json({
        message: `Appointment status updated to ${status} successfully`,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Get appointments (filtered by user role)
router.get(
  "/",
  authenticateToken,
  asyncHandler(async (req, res) => {
    try {
      let query;
      let params = [];

      if (req.user.role === "patient") {
        // Patients can only see their own appointments
        query = `
        SELECT 
          a.id AS appointment_id,
          a.appointment_date,
          a.status,
          u.name AS doctor_name,
          d.speciality,
          d.fee
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u ON d.user_id = u.id
        WHERE a.patient_id = ?
      `;
        params = [req.user.id];
      } else if (req.user.role === "doctor") {
        // Doctors can only see appointments assigned to them
        query = `
        SELECT 
          a.id AS appointment_id,
          a.appointment_date,
          a.status,
          u.name AS patient_name,
          u.email AS patient_email
        FROM appointments a
        JOIN users u ON a.patient_id = u.id
        JOIN doctors d ON a.doctor_id = d.id
        WHERE d.user_id = ?
      `;
        params = [req.user.id];
      } else if (req.user.role === "admin") {
        // Admins can see all appointments with full details
        query = `
        SELECT 
          a.id AS appointment_id,
          a.appointment_date,
          a.status,
          p.name AS patient_name,
          p.email AS patient_email,
          d.id AS doctor_id,
          doc.name AS doctor_name,
          d.speciality,
          d.fee
        FROM appointments a
        JOIN users p ON a.patient_id = p.id
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users doc ON d.user_id = doc.id
      `;
      }

      const [appointments] = await conn.query(query, params);
      res.json(appointments);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

// Book an appointment
router.post("/", authenticateToken, async (req, res) => {
  try {
    // Only patients can book appointments
    if (req.user.role !== "patient") {
      return res
        .status(403)
        .json({ message: "Only patients can book appointments" });
    }

    const { doctorId, appointmentDate } = req.body;

    // console.log("doctorId", doctorId, "appointmentDate", appointmentDate);

    // Check if the doctor exists
    const [doctors] = await conn.query("SELECT * FROM doctors WHERE id = ?", [
      doctorId,
    ]);

    if (doctors.length === 0) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    // Insert the appointment
    const [result] = await conn.query(
      "INSERT INTO appointments (patient_id, doctor_id, appointment_date) VALUES (?, ?, ?)",
      [req.user.id, doctorId, appointmentDate]
    );

    res.status(201).json({
      message: "Appointment booked successfully",
      appointmentId: result.insertId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Cancel appointment (update status instead of deleting)
router.put(
  "/:id",
  authenticateToken,
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params; // Extract the appointment ID from the URL
      const userId = req.user.id;

      // Ensure the appointment exists and belongs to the logged-in user
      const [rows] = await conn.query(
        "SELECT * FROM appointments WHERE id = ? AND patient_id = ?",
        [id, userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      // Update appointment status to "canceled"
      await conn.query("UPDATE appointments SET status = ? WHERE id = ?", [
        "cancelled",
        id,
      ]);

      res.json({ message: "Appointment cancelled successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  })
);

export default router;
