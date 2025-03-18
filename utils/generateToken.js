import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Generate JWT token
export const generateToken = (res, id, role) => {
  try {
    // Generate JWT token (expires in 30 days)
    const token = jwt.sign({ id, role }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    // If res is provided, set the cookie

    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return token;
  } catch (error) {
    console.error("❌ Error generating token:", error.message);
    throw new Error("Token generation failed");
  }
};
