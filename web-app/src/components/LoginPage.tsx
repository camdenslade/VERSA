import { useState, FormEvent } from "react";
import { KimbuSession } from "../hooks/useKimbuAuth";

export default function LoginPage({ auth }: { auth: KimbuSession }) {
  const [mode,        setMode]        = useState<"login" | "register">("login");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "login") {
      await auth.login(email, password);
    } else {
      await auth.register(email, password);
    }
  }

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 360, margin: "120px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Versa</h1>
      <p style={{ color: "#999", fontSize: 14, marginBottom: 28 }}>
        {mode === "login" ? "Sign in to continue" : "Create your account"}
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          style={inputStyle}
        />
        <div style={{ position: "relative" }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder={mode === "register" ? "Password (8+ chars, A-Z, 0-9, symbol)" : "Password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingRight: 44 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 13 }}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        {auth.error && (
          <p style={{ color: "#c00", fontSize: 13, margin: 0 }}>{auth.error}</p>
        )}

        <button
          type="submit"
          disabled={auth.loading || !email || !password}
          style={{
            padding: "12px",
            background: auth.loading ? "#aaa" : "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            cursor: auth.loading ? "default" : "pointer",
          }}
        >
          {auth.loading
            ? (mode === "login" ? "Signing in…" : "Creating account…")
            : (mode === "login" ? "Sign In" : "Create Account")}
        </button>
      </form>

      <p style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: "#666" }}>
        {mode === "login" ? "No account? " : "Already have one? "}
        <button
          onClick={() => { setMode(m => m === "login" ? "register" : "login"); auth.error && void 0; }}
          style={{ background: "none", border: "none", color: "#0070f3", cursor: "pointer", fontSize: 14, padding: 0 }}
        >
          {mode === "login" ? "Create one" : "Sign in"}
        </button>
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "12px",
  border: "1px solid #ddd",
  borderRadius: 8,
  fontSize: 15,
  outline: "none",
};
