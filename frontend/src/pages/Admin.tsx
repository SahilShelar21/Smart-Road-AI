import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useConfirm, useToast } from "../ui";

const json = { "Content-Type": "application/json" };

export default function Admin() {
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ email: "", password: "", role: "officer" });
  const load = () => { api("/users").then(setUsers).catch((e) => setError(e.message)); api("/audit").then(setAudit).catch(() => {}); };
  useEffect(load, []);

  async function setRole(id: number, role: string) {
    try { await api(`/users/${id}/role`, { method: "POST", headers: json, body: JSON.stringify({ role }) }); setError(""); toast.success(`Role changed to ${role}`); load(); }
    catch (e) { setError((e as Error).message); toast.error((e as Error).message); }
  }
  async function remove(u: any) {
    if (!(await confirm({ title: `Delete ${u.email}?`, body: "Users who have reports or photos can't be deleted; change their role instead.", confirm: "Delete user", danger: true }))) return;
    try { await api(`/users/${u.id}`, { method: "DELETE" }); toast.success(`Deleted ${u.email}`); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function create(e: FormEvent) {
    e.preventDefault(); setOk(""); setError("");
    try {
      const u = await api("/users", { method: "POST", headers: json, body: JSON.stringify(form) });
      setOk(`Created ${u.role}: ${u.email}`); toast.success(`Created ${u.role}: ${u.email}`); setForm({ ...form, email: "", password: "" }); load();
    } catch (err) { setError((err as Error).message); toast.error((err as Error).message); }
  }

  return (
    <section className="grid md:grid-cols-2 gap-4">
      <div className="space-y-4">
        <form onSubmit={create} className="card p-4 space-y-2">
          <h2 className="font-semibold">Create user</h2>
          <input className="input" type="email" required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" type="text" required minLength={8} placeholder="Password (8+ characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="citizen">citizen</option><option value="officer">officer</option><option value="admin">admin</option>
          </select>
          <button className="btn btn-primary w-full">Create user</button>
          {ok && <p className="text-sm text-green-800">{ok}</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </form>
        <div>
          <h2 className="font-semibold mb-2">Users</h2>
          <ul className="space-y-1 text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex justify-between items-center gap-2 card p-2">
                <span className="truncate">{u.email}</span>
                <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)} className="border rounded px-1 py-1 bg-white">
                  <option>citizen</option><option>officer</option><option>admin</option>
                </select>
                <button className="text-red-700 underline shrink-0" onClick={() => remove(u)}>Delete</button>
              </li>))}
          </ul>
        </div>
      </div>
      <div>
        <h2 className="font-semibold mb-2">Audit log</h2>
        <ul className="space-y-1 text-xs">{audit.map((a) => <li key={a.id}>{new Date(a.at).toLocaleString()} · user {a.user_id ?? "–"} · {a.action} · {a.target}</li>)}</ul>
      </div>
    </section>
  );
}
