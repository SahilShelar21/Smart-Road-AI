const KEY = "smartroad_token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = getToken();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function fetchImageUrl(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("Could not load image");
  return URL.createObjectURL(await res.blob());
}

export type Me = { id: number; email: string; role: "citizen" | "officer" | "admin" };
export const isStaff = (m: Me) => m.role === "officer" || m.role === "admin";

export async function download(path: string, fallbackName: string): Promise<{ name: string; headers: Headers }> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const m = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") ?? "");
  const name = m?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return { name, headers: res.headers };
}
