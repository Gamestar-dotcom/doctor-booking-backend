import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

// Middleware to authenticate user
export const authenticateToken = async (req, res, next) => {
  let token = req.cookies.jwt; // Try from cookies
  // console.log("Token from cookies:", token);

  // If not found in cookies, check Authorization header
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
    console.log("Token from Authorization header:", token);
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };

    // console.log("Authenticated User:", req.user); // ✅ Debugging log
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// Middleware to check roles
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: Access denied" });
    }
    next();
  };
};
