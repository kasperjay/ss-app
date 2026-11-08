const { isContactEmail } = require("./contact-email");
const nodemailer = require("nodemailer");

const getTransporter = () => {
  const host = process.env.SMTP_HOST || "mail.spacemail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const secure = port === 465; // SSL for 465
  const user = process.env.SMTP_USER || "kasper@spectralsound.works";
  const pass = process.env.SMTP_PASS || "K!ttenll4m4$";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
};

const sendEmail = async (to, subject, html) => {
  if (!isContactEmail(to)) throw new Error("Recipient is not a usable contact email");
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || '"Kasper | Spectral Soundworks" <kasper@spectralsound.works>';

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html,
  });

  return info;
};

module.exports = {
  getTransporter,
  sendEmail,
};
