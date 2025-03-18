import mysql from "mysql2";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "", // Ensure password is always a string
  database: process.env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
});

const conn = pool.promise();

// Test the connection
conn
  .getConnection()
  .then((connection) => {
    console.log("✅ MySQL Connected Successfully!");
    connection.release(); // Release the connection back to the pool
  })
  .catch((err) => {
    console.error("❌ MySQL Connection Error:", err.message);
  });

export default conn;
