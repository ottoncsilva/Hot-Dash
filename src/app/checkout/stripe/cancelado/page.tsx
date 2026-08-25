export default function StripeCanceladoPage() {
  return (
    <main style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Payment canceled</h1>
        <p style={{ color: "#666" }}>No charge was made. Go back to Telegram to try again.</p>
      </div>
    </main>
  );
}
