import { Seo } from "../components/Seo";

export default function CashClipTerms() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", color: "#1a1a1a", lineHeight: 1.7 }}>
      <Seo
        title="CashClip Terms of Service | AB Sustainability Investments"
        description="The CashClip terms of service govern your use of the CashClip mobile rewards app operated by AB Sustainability Investments LLC, including rewards, withdrawals, and account rules."
        path="/cashclip/terms"
      />
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <img src="/cashclip-icon.png" alt="CashClip" style={{ width: 48, height: 48, borderRadius: 12 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#00C853", letterSpacing: 1, textTransform: "uppercase" }}>CashClip</span>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px" }}>Terms of Service</h1>
        <p style={{ color: "#666", margin: 0 }}>Effective Date: May 1, 2025 &nbsp;·&nbsp; Last Updated: May 10, 2026</p>
      </div>

      <p>These Terms of Service ("Terms") govern your use of the CashClip mobile application ("App") operated by AB Sustainability Investments LLC ("Company," "we," "our," or "us"). By downloading or using the App, you agree to be bound by these Terms. If you do not agree, do not use the App.</p>

      <h2 style={h2}>1. Eligibility</h2>
      <p>You must be at least <strong>13 years of age</strong> to use CashClip. By using the App, you represent that you meet this age requirement. Users under 18 must have parental or guardian consent. The App is intended for use in jurisdictions where such rewards programs are permitted by law.</p>

      <h2 style={h2}>2. Account Registration</h2>
      <p>You must create an account to use CashClip. You agree to provide accurate information, keep your credentials confidential, and notify us immediately of any unauthorized access. You are responsible for all activity that occurs under your account. We reserve the right to suspend or terminate accounts that violate these Terms.</p>

      <h2 style={h2}>3. How CashClip Works</h2>
      <p>CashClip allows users to earn virtual rewards ("Earnings") by completing activities such as watching ads, taking surveys, completing offers, playing games, and referring friends. Earnings accumulate in your in-app balance and may be redeemed for real money via PayPal, subject to the minimum withdrawal threshold and our verification procedures.</p>

      <h2 style={h2}>4. Earning Rewards</h2>
      <ul style={ul}>
        <li>Earnings are credited only for activities completed in good faith and in accordance with our guidelines.</li>
        <li>We reserve the right to withhold or reverse Earnings if we detect fraudulent activity, account manipulation, or violation of these Terms.</li>
        <li>Survey and offerwall rewards are subject to confirmation from our third-party partners and may be reversed if a partner reverses the credit.</li>
        <li>Referral bonuses are credited only for genuine new users who register with a valid referral code and meet minimum activity requirements.</li>
        <li>We may adjust reward rates, earning opportunities, or offer availability at any time without notice.</li>
      </ul>

      <h2 style={h2}>5. Withdrawals & Payouts</h2>
      <p>Withdrawals are processed via PayPal. By requesting a withdrawal, you confirm that you own the PayPal account associated with the email address provided. Payouts are subject to a minimum threshold and may take up to 10 business days to process. We reserve the right to delay payouts pending fraud review. Earnings have no cash value until a withdrawal is approved and processed.</p>

      <h2 style={h2}>6. Prohibited Conduct</h2>
      <p>You agree not to:</p>
      <ul style={ul}>
        <li>Create multiple accounts or use bots, scripts, or automated tools to generate Earnings.</li>
        <li>Provide false information during registration or withdrawal.</li>
        <li>Manipulate, interfere with, or attempt to exploit any aspect of the reward system.</li>
        <li>Use the App for any unlawful purpose or in violation of any applicable law or regulation.</li>
        <li>Reverse engineer, decompile, or attempt to extract the source code of the App.</li>
        <li>Harass, abuse, or harm other users or our staff.</li>
      </ul>
      <p>Violation of these prohibitions may result in immediate account suspension, forfeiture of Earnings, and legal action.</p>

      <h2 style={h2}>7. Advertising & Third Parties</h2>
      <p>The App includes advertisements served by Google AdMob and integrates with third-party survey and offerwall providers. Your interactions with these third parties are governed by their respective terms and privacy policies. We are not responsible for the content, practices, or privacy policies of third-party advertisers or providers.</p>

      <h2 style={h2}>8. Intellectual Property</h2>
      <p>The App and all content within it — including but not limited to the CashClip name, logo, design, and code — are owned by AB Sustainability Investments LLC or its licensors. You may not copy, modify, distribute, or create derivative works without our express written permission.</p>

      <h2 style={h2}>9. Disclaimers</h2>
      <p>The App is provided "as is" and "as available" without warranties of any kind, express or implied. We do not warrant that the App will be uninterrupted, error-free, or that defects will be corrected. We are not responsible for any loss of Earnings due to technical failures, server outages, or third-party provider issues.</p>

      <h2 style={h2}>10. Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, AB Sustainability Investments LLC shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of earnings or data, arising from your use of the App. Our total liability to you for any claim shall not exceed the amount of Earnings credited to your account in the 30 days preceding the claim.</p>

      <h2 style={h2}>11. Termination</h2>
      <p>We may suspend or terminate your account and access to the App at any time, with or without cause, with or without notice. Upon termination, your right to use the App ceases immediately. Earned balances may be forfeited if termination results from a violation of these Terms.</p>

      <h2 style={h2}>12. Governing Law</h2>
      <p>These Terms are governed by and construed in accordance with the laws of the State of Florida, United States, without regard to its conflict of law provisions. Any disputes shall be resolved in the courts located in Florida.</p>

      <h2 style={h2}>13. Changes to Terms</h2>
      <p>We may update these Terms at any time. Material changes will be indicated by an updated "Last Updated" date. Continued use of the App after changes constitutes your acceptance of the revised Terms.</p>

      <h2 style={h2}>14. Contact Us</h2>
      <p>
        <strong>AB Sustainability Investments LLC</strong><br />
        Email: <a href="mailto:support@absustaininvest.com" style={{ color: "#00C853" }}>support@absustaininvest.com</a><br />
        Website: <a href="https://absustaininvest.com" style={{ color: "#00C853" }}>absustaininvest.com</a>
      </p>

      <hr style={{ margin: "40px 0", borderColor: "#e5e7eb" }} />
      <p style={{ color: "#999", fontSize: 13 }}>© {new Date().getFullYear()} AB Sustainability Investments LLC. All rights reserved.<br />
        <a href="/cashclip/privacy" style={{ color: "#00C853" }}>Privacy Policy</a> &nbsp;·&nbsp; <a href="https://absustaininvest.com" style={{ color: "#00C853" }}>Back to AB Sustainability</a>
      </p>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 36, marginBottom: 8, borderBottom: "1px solid #e5e7eb", paddingBottom: 6 };
const ul: React.CSSProperties = { paddingLeft: 20, marginTop: 4 };
