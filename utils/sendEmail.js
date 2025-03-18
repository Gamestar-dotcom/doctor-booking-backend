// services/emailService.js
import nodemailer from "nodemailer";

// Create transporter once
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send email utility function
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @returns {Promise} - Promise resolving to send info
 */
const sendEmail = async (to, subject, html) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  };

  return await transporter.sendMail(mailOptions);
};

/**
 * Send verification email to user
 * @param {string} email - User's email address
 * @param {string} name - User's name
 * @param {string} verificationToken - Generated verification token
 */
export const sendVerificationEmail = async (email, name, verificationToken) => {
  const subject = "Email Verification";
  const verificationLink = `http://localhost:5173/verify-email/${verificationToken}`;
  // const verificationLink = `https://gamestar-dotcom.github.io/Doctor-Booking-App/verify-email/${verificationToken}`;
  const html = `
    <p>Hello ${name},</p>
    <p>Click the link below to verify your email:</p>
    <a href="${verificationLink}">Verify Email</a>
  `;

  console.log(verificationLink);

  return await sendEmail(email, subject, html);
};
