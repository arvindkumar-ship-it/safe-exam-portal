import { useState } from "react";
import { authApi } from "../../api/authApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import { useAuth } from "../../auth/useAuth";

export default function LoginForm({ onSuccess }) {
  const { login } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") await authApi.register(email.trim(), password, fullName.trim());
      const user = await login(email.trim(), password);
      onSuccess?.(user);
    } catch (err) {
      setError(err); // form data erase nahi hota
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card form">
      <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
      {mode === "register" && (
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
      )}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </label>
      <ErrorMessage error={error} />
      <Button type="submit" disabled={busy}>
        {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Register"}
      </Button>
      <Button variant="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
      </Button>
    </form>
  );
}
