import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: '#06060E' }}>
      <div className="text-center px-6">
        <AlertCircle className="h-12 w-12 text-[#00E676] mx-auto mb-6" />
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '48px', fontWeight: 700, letterSpacing: '-1px', marginBottom: '12px' }}>404</h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '16px', maxWidth: '400px' }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a href="/" className="hero-cta" style={{ marginTop: '32px', display: 'inline-flex' }} data-testid="link-go-home">
          Back to Home
        </a>
      </div>
    </div>
  );
}
