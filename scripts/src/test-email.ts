import nodemailer from "nodemailer";

const password = process.env["ZOHO_SMTP_PASSWORD"];
if (!password) {
  console.error("❌ ZOHO_SMTP_PASSWORD not set");
  process.exit(1);
}

const TARGET = process.argv[2] ?? "supportpr@absustain.com";

const transport = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: "support@absustaininvest.com",
    pass: password,
  },
});

console.log(`🔌 Verifying SMTP connection to smtp.zoho.com:465...`);
try {
  await transport.verify();
  console.log("✅ SMTP connection verified — credentials are good.");
} catch (err) {
  console.error("❌ SMTP verify failed:", err);
  process.exit(1);
}

console.log(`📨 Sending test email to ${TARGET}...`);
try {
  const info = await transport.sendMail({
    from: "AB Sustainability Investments <support@absustaininvest.com>",
    to: TARGET,
    subject: "✅ Zoho Email Test — supportpr@absustain.com",
    text: "This is a test email to confirm your supportpr@absustain.com inbox is live and receiving mail via Zoho SMTP.",
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;background:#f9f9f9;border-radius:8px">
        <h2 style="color:#00C853;margin-bottom:8px">✅ Inbox Confirmed</h2>
        <p style="color:#333">This test confirms that <strong>supportpr@absustain.com</strong> is live and receiving mail through Zoho SMTP.</p>
        <p style="color:#333">Sent from: <strong>support@absustaininvest.com</strong></p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
        <p style="font-size:12px;color:#999">AB Sustainability Investments LLC · absustaininvest.com</p>
      </div>
    `,
  });
  console.log(`✅ Email sent! Message ID: ${info.messageId}`);
  console.log(`   Accepted: ${info.accepted?.join(", ")}`);
  console.log(`   Rejected: ${info.rejected?.join(", ") || "none"}`);
} catch (err) {
  console.error("❌ Send failed:", err);
  process.exit(1);
}
