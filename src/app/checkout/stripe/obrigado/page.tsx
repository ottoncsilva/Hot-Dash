export default function StripeObrigadoPage() {
  return (
    <main style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Payment received 🎉</h1>
        <p style={{ color: "#666" }}>You can close this page and go back to Telegram — your confirmation is on its way.</p>
      </div>
    </main>
  );
}
