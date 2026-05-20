export default function CashClipPrivacy() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", color: "#1a1a1a", lineHeight: 1.7 }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <img src="/cashclip-icon.png" alt="CashClip" style={{ width: 48, height: 48, borderRadius: 12 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#00C853", letterSpacing: 1, textTransform: "uppercase" }}>CashClip</span>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px" }}>Privacy Policy</h1>
        <p style={{ color: "#666", margin: 0 }}>Effective Date: May 1, 2025 &nbsp;·&nbsp; Last Updated: May 10, 2026</p>
      </div>

      <p>CashClip ("we," "our," or "us") is operated by AB Sustainability Investments LLC. This Privacy Policy explains how we collect, use, disclose, and protect your information when you use the CashClip mobile application ("App"). By using the App, you agree to the practices described in this policy.</p>

      <h2 style={h2}>1. Information We Collect</h2>

      <h3 style={h3}>Account Information</h3>
      <p>When you create an account we collect your <strong>username</strong> and <strong>password</strong> (stored as a one-way hash). If you submit a withdrawal, we collect your <strong>PayPal email address</strong> to process your payout.</p>

      <h3 style={h3}>Financial Information</h3>
      <p>We maintain a record of your <strong>earnings balance</strong>, completed reward activities, survey and offerwall sessions, withdrawal requests, and payout history. This information is necessary to operate the rewards platform.</p>

      <h3 style={h3}>Usage & Activity Data</h3>
      <p>We collect information about how you use the App, including which features you access, ads you view or interact with, surveys and offers you complete, games you play, and referral activity. This helps us improve the App and calculate your rewards accurately.</p>

      <h3 style={h3}>Device Information</h3>
      <p>We may collect device identifiers (such as the advertising identifier / IDFA), device type, operating system version, and crash/performance data. This information is used for analytics, fraud prevention, and to serve relevant advertising.</p>

      <h3 style={h3}>Advertising Data</h3>
      <p>The App displays ads served by Google AdMob and may work with survey and offerwall providers. These partners may collect advertising identifiers and interaction data to serve targeted ads. With your permission (via Apple's App Tracking Transparency prompt), your advertising identifier may be used across apps and websites to deliver relevant ads.</p>

      <h2 style={h2}>2. How We Use Your Information</h2>
      <ul style={ul}>
        <li><strong>App Functionality:</strong> To create and manage your account, calculate and credit your earnings, process withdrawal payouts via PayPal, and deliver rewards for completed activities.</li>
        <li><strong>Advertising:</strong> To show you relevant ads through Google AdMob. Ad revenue is what funds your cash rewards.</li>
        <li><strong>Survey & Offerwall Providers:</strong> To match you with available surveys and offers from our partners (including CPX Research, BitLabs, and others). These partners have their own privacy practices.</li>
        <li><strong>Analytics & Improvement:</strong> To understand how users interact with the App, identify bugs, and improve features.</li>
        <li><strong>Fraud Prevention:</strong> To detect and prevent fraudulent reward activity and protect the integrity of the platform.</li>
        <li><strong>Communications:</strong> To send you important account and service notifications.</li>
      </ul>

      <h2 style={h2}>3. Information Sharing and Disclosure</h2>
      <p>We do not sell your personal information. We may share information in the following circumstances:</p>
      <ul style={ul}>
        <li><strong>Service Providers:</strong> PayPal (payouts), Google AdMob (advertising), survey and offerwall network partners, and our hosting infrastructure providers. Each is bound by appropriate data processing agreements.</li>
        <li><strong>Legal Requirements:</strong> If required by law, court order, or to protect the rights and safety of CashClip, our users, or the public.</li>
        <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction.</li>
      </ul>

      <h2 style={h2}>4. App Tracking Transparency (iOS)</h2>
      <p>On iOS 14.5 and later, we ask for your permission before tracking your activity across other companies' apps and websites. If you grant permission, your advertising identifier (IDFA) may be used to personalize ads and measure ad performance. You can change this permission at any time in your iPhone Settings → Privacy & Security → Tracking.</p>

      <h2 style={h2}>5. Data Retention</h2>
      <p>We retain your account and transaction data for as long as your account is active or as needed to provide services, comply with legal obligations, resolve disputes, and enforce our agreements. You may request deletion of your account by contacting us (see Section 9).</p>

      <h2 style={h2}>6. Security</h2>
      <p>We use industry-standard measures including password hashing (bcrypt), encrypted API communication (HTTPS/TLS), and encrypted storage of sensitive credentials. No method of transmission or storage is 100% secure; we cannot guarantee absolute security.</p>

      <h2 style={h2}>7. Children's Privacy</h2>
      <p>CashClip is not directed to children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected information from a child under 13, please contact us immediately so we can delete it.</p>

      <h2 style={h2}>8. Your Rights & Choices</h2>
      <ul style={ul}>
        <li><strong>Access & Correction:</strong> You may view and update your account information within the App.</li>
        <li><strong>Deletion:</strong> You may request deletion of your account and associated personal data by contacting us.</li>
        <li><strong>Opt-Out of Tracking:</strong> You can disable ad tracking at any time via iOS Settings → Privacy & Security → Tracking.</li>
        <li><strong>California Residents (CCPA):</strong> You have the right to know what personal information we collect, request deletion, and opt out of the sale of personal information (we do not sell personal information).</li>
      </ul>

      <h2 style={h2}>9. Contact Us</h2>
      <p>If you have questions about this Privacy Policy or wish to exercise your data rights, please contact us:</p>
      <p>
        <strong>AB Sustainability Investments LLC</strong><br />
        Email: <a href="mailto:support@absustaininvest.com" style={{ color: "#00C853" }}>support@absustaininvest.com</a><br />
        Website: <a href="https://absustaininvest.com" style={{ color: "#00C853" }}>absustaininvest.com</a>
      </p>

      <h2 style={h2}>10. Changes to This Policy</h2>
      <p>We may update this Privacy Policy from time to time. We will notify you of material changes by updating the "Last Updated" date above. Continued use of the App after changes constitutes your acceptance of the updated policy.</p>

      <hr style={{ margin: "40px 0", borderColor: "#e5e7eb" }} />
      <p style={{ color: "#999", fontSize: 13 }}>© {new Date().getFullYear()} AB Sustainability Investments LLC. All rights reserved.<br />
        <a href="/cashclip/terms" style={{ color: "#00C853" }}>Terms of Service</a> &nbsp;·&nbsp; <a href="https://absustaininvest.com" style={{ color: "#00C853" }}>Back to AB Sustainability</a>
      </p>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 36, marginBottom: 8, borderBottom: "1px solid #e5e7eb", paddingBottom: 6 };
const h3: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginTop: 20, marginBottom: 4 };
const ul: React.CSSProperties = { paddingLeft: 20, marginTop: 4 };
