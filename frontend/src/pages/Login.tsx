import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";
import Logo from "../components/Logo";

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api<{ token: string }>(`/auth/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
      });
      setToken(r.token);
      onDone();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <main className="min-h-screen grid md:grid-cols-2">
      <section className="navy-bg text-white p-8 flex flex-col justify-between overflow-hidden">
        <div className="flex items-center gap-3"><Logo size={36} /><span className="font-bold text-lg">SmartRoad AI</span></div>
        <div className="py-12">
          <h1 className="text-3xl md:text-5xl font-bold leading-tight">Point. Detect. Report.</h1>
          <p className="mt-4 text-white/70 max-w-sm">Your phone's camera spots potholes and sends them, with their location, to the people who fix the roads.</p>
        </div>
        <div className="lane-line -mx-8" />
      </section>
      <section className="grid place-items-center p-6">
        <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-3">
          <h2 className="text-xl font-semibold">{mode === "login" ? "Sign in" : "Create account"}</h2>
          <input className="input" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" required minLength={8} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button className="btn btn-primary w-full">{mode === "login" ? "Sign in" : "Create account"}</button>
          <button type="button" className="text-sm underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Create an account" : "I already have an account"}
          </button>
        </form>
      </section>
    </main>
  );
}
