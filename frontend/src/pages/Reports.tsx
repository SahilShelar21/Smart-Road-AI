import { useEffect, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Eye, ExternalLink, MapPin, MoreVertical, X } from "lucide-react";
import { api, fetchImageUrl } from "../api";
import { useConfirm, useToast } from "../ui";

type Report = { id: number; latitude: number; longitude: number; max_confidence: number; status: string; severity: string; confirmations: number; assigned_to: number | null; created_at: string; source: string; width_cm: number | null; length_cm: number | null; depth_cm: number | null; size_source: string | null; depth_source: string | null; size_reliability: string | null; danger_pct: number; danger_level: string; est_cost: number; currency: string; review: string | null; approved: boolean; reporter?: string; assignee?: string };
type Photo = { id: number; kind: string };
type Person = { id: number; email: string; role: string };
type Scope = "all" | "assigned" | "mine";
type Mode = "admin" | "officer" | "none";

// What each role may do next. The server enforces the same rules.
const NEXT: Record<Mode, Record<string, string[]>> = {
  admin: { reported: ["rejected"], assigned: ["in_repair", "reported"], in_repair: ["repaired"], repaired: ["verified", "in_repair"] },
  officer: { assigned: ["in_repair"], in_repair: ["repaired"] },
  none: {},
};
const label = (from: string, to: string) =>
  to === "verified" ? "Close report (verify)" : to === "rejected" ? "Reject" : to === "repaired" ? "Mark repaired"
  : to === "reported" ? "Unassign" : to === "in_repair" ? (from === "repaired" ? "Send back for repair" : "Start repair") : to;

const SEV: Record<string, string> = { low: "border-l-green-600", medium: "border-l-amber-500", high: "border-l-red-600" };
const SEVBADGE: Record<string, string> = { low: "bg-green-100 text-green-800", medium: "bg-amber-100 text-amber-900", high: "bg-red-100 text-red-800" };
const STATUSES = ["reported", "assigned", "in_repair", "repaired", "verified", "rejected"];
const json = { "Content-Type": "application/json" };

function Img({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let u = ""; fetchImageUrl(path).then((x) => { u = x; setSrc(x); }).catch(() => {}); return () => { if (u) URL.revokeObjectURL(u); }; }, [path]);
  return src ? <img src={src} alt={alt} className="w-40 h-28 object-cover rounded" /> : <div className="w-40 h-28 bg-asphalt/10 rounded" />;
}

type ViewMap = (lat: number, lng: number, id: number) => void;

function Row({ r, mode, people, reload, onViewMap }: { r: Report; mode: Mode; people: Person[]; reload: () => void; onViewMap: ViewMap }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState("");
  const toast = useToast();
  const confirm = useConfirm();
  const [measuring, setMeasuring] = useState(false);
  const [mf, setMf] = useState({ w: "", l: "", d: "" });
  useEffect(() => { api<Photo[]>(`/reports/${r.id}/photos`).then(setPhotos).catch(() => {}); }, [r.id, r.status]);
  const run = async (fn: () => Promise<any>, done: string) => {
    try { await fn(); setError(""); toast.success(done); reload(); }
    catch (e) { setError((e as Error).message); toast.error((e as Error).message); }
  };
  const upload = (f: File) => {
    toast.info("Uploading photo…");
    const fd = new FormData(); fd.append("image", f); fd.append("kind", "after");
    return run(() => api(`/reports/${r.id}/photos`, { method: "POST", body: fd }), `After photo uploaded for report #${r.id}`);
  };
  const changeStatus = (s: string) => run(() => api(`/reports/${r.id}/status`, { method: "POST", headers: json, body: JSON.stringify({ status: s }) }),
    s === "verified" ? `Report #${r.id} closed (verified)` : s === "reported" ? `Report #${r.id} unassigned` : `Report #${r.id} moved to ${s.replace("_", " ")}`);
  const assign = (id: number) => run(() => api(`/reports/${r.id}/assign`, { method: "POST", headers: json, body: JSON.stringify({ officer_id: id }) }),
    `Report #${r.id} assigned to ${people.find((p) => p.id === id)?.email ?? "officer"}`);
  async function deleteReport() {
    if (await confirm({ title: `Delete report #${r.id}?`, body: "This permanently removes the report and its photos. It can't be undone.", confirm: "Delete", danger: true }))
      run(() => api(`/reports/${r.id}`, { method: "DELETE" }), `Report #${r.id} deleted`);
  }
  async function deletePhoto(id: number) {
    if (await confirm({ title: "Delete this after photo?", body: "If the report is marked repaired, it goes back to in repair until a new photo is uploaded.", confirm: "Delete photo", danger: true }))
      run(() => api(`/photos/${id}`, { method: "DELETE" }), "After photo deleted");
  }
  const canDeleteReport = mode === "admin" || (mode === "none" && r.status === "reported");
  const canDeletePhoto = mode === "admin" || (mode === "officer" && r.status === "in_repair");
  const assignee = people.find((p) => p.id === r.assigned_to)?.email;
  const nexts = NEXT[mode][r.status] ?? [];
  return (
    <li className={`card p-3 space-y-2 border-l-4 ${SEV[r.severity] ?? ""}`}>
      <div className="flex gap-3 flex-wrap">
        <div><Img path={`/reports/${r.id}/image`} alt={`Before: report ${r.id}`} /><p className="text-xs">Before</p></div>
        {photos.filter((p) => p.kind === "after").slice(-1).map((p) => <div key={p.id}><Img path={`/photos/${p.id}/image`} alt={`After: report ${r.id}`} /><p className="text-xs">After{canDeletePhoto && <button className="ml-2 underline text-red-700" onClick={() => deletePhoto(p.id)}>Delete photo</button>}</p></div>)}
        <div className="text-sm">
          <p className="font-medium flex gap-2 items-center flex-wrap">Hazard #{r.id} <span className="badge bg-asphalt/10">{r.status.replace("_", " ")}</span> <span className={`badge ${SEVBADGE[r.severity] ?? ""}`}>{r.severity}</span>{!r.approved && <span className="badge bg-amber-100 text-amber-900">pending admission</span>}</p>
          <p className="flex items-center gap-2 flex-wrap"><button className="inline-flex items-center gap-1 underline text-signal font-medium" title="Show this location on the map" onClick={() => onViewMap(r.latitude, r.longitude, r.id)}><MapPin size={14} />{r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</button><a className="text-xs underline text-asphalt/60" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}>Google Maps ↗</a></p>
          <p>Confidence {(r.max_confidence * 100).toFixed(0)}% · {r.confirmations} report(s) · {r.source}</p>
          <p>Danger <b className={r.danger_level === "high" ? "text-red-600" : r.danger_level === "medium" ? "text-amber-600" : "text-emerald-600"}>{r.danger_pct}%</b> ({r.danger_level}) · est. repair {r.currency}{r.est_cost.toLocaleString()}</p>
          {r.width_cm || r.length_cm ? (
            <p>Size {r.width_cm?.toFixed(0) ?? "–"} × {r.length_cm?.toFixed(0) ?? "–"} cm · depth {r.depth_cm != null ? `${r.depth_cm.toFixed(1)} cm` : "not available"}
              <span className="text-xs text-asphalt/60"> ({r.size_source}{r.size_reliability === "low" && r.size_source === "estimated" ? ", low reliability" : ""}{r.depth_source === "estimated" ? ", depth estimated" : ""})</span></p>
          ) : <p className="text-xs text-asphalt/60">No size recorded{r.depth_cm != null ? ` · depth ${r.depth_cm.toFixed(1)} cm` : ""}. Set the camera setup before scanning, or add an on-site measurement.</p>}
          {r.review && <p className="text-xs">AI review: <b>{r.review === "correct" ? "detection was right" : "false alarm"}</b></p>}
          <p>{new Date(r.created_at).toLocaleString()}</p>
          {mode === "admin" && assignee && <p>Assigned to: <b>{assignee}</b></p>}
          {mode === "admin" && r.status === "repaired" && <p className="text-signal font-medium">Repair submitted: review the after photo, then close or send back.</p>}
        </div>
      </div>
      {(mode !== "none" || canDeleteReport) && (
        <div className="flex gap-2 flex-wrap items-center text-sm">
          {mode === "admin" && ["reported", "assigned"].includes(r.status) && (
            <select className="border rounded px-2 py-1 bg-white" value={r.assigned_to ?? ""} onChange={(e) => assign(+e.target.value)}>
              <option value="" disabled>Assign to…</option>
              {people.map((o) => <option key={o.id} value={o.id}>{o.email} ({o.role})</option>)}
            </select>)}
          {nexts.map((s) => (
            <button key={s} className={`btn ${s === "verified" ? "btn-primary" : "btn-ghost"}`} onClick={() => changeStatus(s)}>{label(r.status, s)}</button>))}
          {mode !== "none" && r.status === "in_repair" && <label className="btn btn-ghost cursor-pointer">Upload after photo<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>}
          {mode === "admin" && !r.approved && <button className="btn btn-primary" onClick={() => run(() => api("/reports/approve", { method: "POST", headers: json, body: JSON.stringify({ ids: [r.id] }) }), `Hazard #${r.id} admitted: now visible on the map`)}>Admit to map</button>}
          {mode !== "none" && (mode === "admin" || ["assigned", "in_repair"].includes(r.status)) && <button className="btn btn-ghost" onClick={() => setMeasuring(!measuring)}>On-site measurement</button>}
          {mode === "admin" && <>
            <button className={`btn btn-ghost ${r.review === "correct" ? "!bg-green-50" : ""}`} onClick={() => run(() => api(`/reports/${r.id}/review`, { method: "POST", headers: json, body: JSON.stringify({ verdict: r.review === "correct" ? null : "correct" }) }), "Marked: AI was right")}>AI was right</button>
            <button className={`btn btn-ghost ${r.review === "false_positive" ? "!bg-red-50" : ""}`} onClick={() => run(() => api(`/reports/${r.id}/review`, { method: "POST", headers: json, body: JSON.stringify({ verdict: r.review === "false_positive" ? null : "false_positive" }) }), "Marked: false alarm")}>False alarm</button>
          </>}
          {canDeleteReport && <button className="btn btn-ghost text-red-700 ml-auto" onClick={deleteReport}>Delete report</button>}
        </div>)}
      {measuring && (
        <div className="flex gap-2 flex-wrap items-end text-sm bg-asphalt/5 rounded-lg p-3">
          {([["w", "Width (cm)"], ["l", "Length (cm)"], ["d", "Depth (cm)"]] as const).map(([k, lab]) => (
            <label key={k} className="text-xs">{lab}<input className="input !py-1 w-24" inputMode="decimal" value={mf[k]} onChange={(e) => setMf({ ...mf, [k]: e.target.value })} /></label>))}
          <button className="btn btn-primary" onClick={() => run(async () => {
            await api(`/reports/${r.id}/measurements`, { method: "POST", headers: json, body: JSON.stringify({ width_cm: parseFloat(mf.w) || null, length_cm: parseFloat(mf.l) || null, depth_cm: parseFloat(mf.d) || null }) });
            setMeasuring(false); setMf({ w: "", l: "", d: "" });
          }, "Measurement saved")}>Save measurement</button>
          <p className="text-xs text-asphalt/60 w-full">Tape measurements are the ground truth used to check the camera estimates.</p>
        </div>)}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </li>
  );
}

type Place = { name: string | null; area: string | null; road_type: string | null };
const placeCache = new Map<string, Place>();

function PlaceCell({ lat, lng }: { lat: number; lng: number }) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const [p, setP] = useState<Place | null>(placeCache.get(key) ?? null);
  useEffect(() => {
    if (p) return;
    api<Place>(`/place?lat=${lat}&lng=${lng}`).then((x) => { if (x.name || x.area) placeCache.set(key, x); setP(x); }).catch(() => setP({ name: null, area: null, road_type: null }));
  }, [key]);
  return (
    <div className="flex gap-2">
      <MapPin size={16} className="text-signal mt-0.5 shrink-0" />
      <div><p className="font-medium">{p ? p.name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "Locating…"}</p><p className="text-xs text-asphalt/60">{p?.area ?? ""}</p></div>
    </div>
  );
}

function Thumb({ id, extra }: { id: number; extra: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let u = ""; fetchImageUrl(`/reports/${id}/image`).then((x) => { u = x; setSrc(x); }).catch(() => {}); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  return (
    <div className="relative w-28 h-20 rounded-lg overflow-hidden bg-asphalt/10">
      {src && <img src={src} alt={`Hazard ${id}`} className="w-full h-full object-cover" />}
      {extra > 0 && <span className="absolute bottom-1 right-1 rounded-md bg-black/65 text-white text-xs font-semibold px-1.5 py-0.5">+{extra}</span>}
    </div>
  );
}

function statusPill(r: Report): [string, string] {
  if (r.status === "rejected") return ["Rejected", "bg-red-100 text-red-700"];
  if (r.status === "verified") return ["Closed", "bg-green-100 text-green-700"];
  if (r.status === "repaired") return ["In Review", "bg-blue-100 text-blue-700"];
  if (r.status === "in_repair") return ["In Repair", "bg-violet-100 text-violet-700"];
  if (r.status === "assigned") return ["Assigned", "bg-indigo-100 text-indigo-700"];
  return r.approved ? ["Admitted", "bg-teal-100 text-teal-700"] : ["Pending", "bg-amber-100 text-amber-700"];
}
const SEV_PILL: Record<string, string> = { low: "bg-green-100 text-green-700", medium: "bg-amber-100 text-amber-800", high: "bg-red-100 text-red-700" };
const BAR: Record<string, string> = { low: "bg-emerald-500", medium: "bg-amber-500", high: "bg-red-500" };
const SIZE_LABEL: Record<string, string> = { low: "Small", medium: "Medium", high: "Large" };

type Range = "all" | "today" | "7d" | "30d" | "month" | "custom";
function rangeBounds(range: Range, from: string, to: string): { from?: string; to?: string } {
  const day = 86400000, now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), tomorrow = new Date(today.getTime() + day);
  if (range === "today") return { from: today.toISOString(), to: tomorrow.toISOString() };
  if (range === "7d") return { from: new Date(today.getTime() - 6 * day).toISOString(), to: tomorrow.toISOString() };
  if (range === "30d") return { from: new Date(today.getTime() - 29 * day).toISOString(), to: tomorrow.toISOString() };
  if (range === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: tomorrow.toISOString() };
  if (range === "custom") return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + day).toISOString() : undefined,
  };
  return {};
}

const PAGE = 5;

export default function Reports({ scope, onViewMap, initialApproval = "" }: { scope: Scope; onViewMap: ViewMap; initialApproval?: string }) {
  const mode: Mode = scope === "all" ? "admin" : scope === "assigned" ? "officer" : "none";
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<{ items: Report[]; total: number } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [approval, setApproval] = useState(initialApproval);
  const [range, setRange] = useState<Range>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);

  const load = () => {
    const q = new URLSearchParams({ scope, limit: String(PAGE), offset: String(page * PAGE) });
    if (status) q.set("status", status);
    if (approval) q.set("approval", approval);
    const b = rangeBounds(range, from, to);
    if (b.from) q.set("date_from", b.from);
    if (b.to) q.set("date_to", b.to);
    return api<{ items: Report[]; total: number }>(`/reports?${q}`).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [page, status, approval, range, from, to]);
  useEffect(() => { if (mode === "admin") api<Person[]>("/officers").then(setPeople).catch(() => {}); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenId(null); setMenuId(null); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  const filter = (fn: () => void) => { fn(); setPage(0); };
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const sel = items.find((r) => r.id === openId) ?? null;

  async function admitAll() {
    if (!(await confirm({ title: "Admit all pending hazards?", body: "They will appear on the map for everyone.", confirm: "Admit all" }))) return;
    try { const r = await api<{ approved: number }>("/reports/approve", { method: "POST", headers: json, body: JSON.stringify({ all_pending: true }) }); toast.success(`${r.approved} hazard(s) admitted to the map`); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function remove(r: Report) {
    setMenuId(null);
    if (!(await confirm({ title: `Delete report #${r.id}?`, body: "This permanently removes the report and its photos. It can't be undone.", confirm: "Delete", danger: true }))) return;
    try { await api(`/reports/${r.id}`, { method: "DELETE" }); toast.success(`Report #${r.id} deleted`); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  const canDelete = (r: Report) => mode === "admin" || (mode === "none" && r.status === "reported");

  const sel_ = "border border-asphalt/20 rounded-lg px-3 py-2 bg-white text-sm";
  const pageNums = Array.from({ length: Math.min(5, pages) }, (_, i) => Math.min(Math.max(0, page - 2), Math.max(0, pages - 5)) + i);

  return (
    <section className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-2 flex-wrap items-center">
          <select aria-label="Status filter" className={sel_} value={status} onChange={(e) => filter(() => setStatus(e.target.value))}>
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          {mode === "admin" && (
            <select aria-label="Approval filter" className={sel_} value={approval} onChange={(e) => filter(() => setApproval(e.target.value))}>
              <option value="">Pending and admitted</option><option value="pending">Pending admission</option><option value="approved">Admitted to map</option>
            </select>)}
          {mode === "admin" && <button className="btn btn-primary !py-2" onClick={admitAll}>Admit all pending</button>}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {range === "custom" && <>
            <input type="date" aria-label="From date" className={sel_} value={from} onChange={(e) => filter(() => setFrom(e.target.value))} />
            <input type="date" aria-label="To date" className={sel_} value={to} onChange={(e) => filter(() => setTo(e.target.value))} />
          </>}
          <label className="card flex items-center gap-2 px-3 py-2 text-sm"><Calendar size={16} className="text-signal" />
            <select aria-label="Date range" className="bg-transparent focus:outline-none" value={range} onChange={(e) => filter(() => setRange(e.target.value as Range))}>
              <option value="all">All dates</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="custom">Custom range…</option>
            </select></label>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="text-left bg-asphalt/[0.03] border-b border-asphalt/10">
              {["#", "Images", "Hazard Details", "Location", "Confidence", "Severity", "Reported On", "Status", "Actions"].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {error ? <tr><td colSpan={9} className="p-6 text-red-700" role="alert">{error}</td></tr>
              : !data ? <tr><td colSpan={9} className="p-6">Loading…</td></tr>
              : !items.length ? <tr><td colSpan={9} className="p-8 text-center text-asphalt/60">{scope === "assigned" ? "Nothing is assigned to you right now." : "No reports match. Scan a road to report a pothole."}</td></tr>
              : items.map((r, i) => {
                const [pill, pillCls] = statusPill(r);
                const when = new Date(r.created_at);
                return (
                  <tr key={r.id} className="border-b border-asphalt/10 last:border-0 align-top hover:bg-asphalt/[0.02]">
                    <td className="px-4 py-4">{page * PAGE + i + 1}</td>
                    <td className="px-4 py-4"><Thumb id={r.id} extra={Math.max(0, r.confirmations - 1)} /></td>
                    <td className="px-4 py-4 space-y-1 max-w-[17rem]">
                      <p className="font-semibold flex gap-2 items-center flex-wrap">Hazard #{r.id}
                        <span className="badge bg-blue-100 text-blue-700">{r.status.replace("_", " ")}</span>
                        <span className={`badge ${SEV_PILL[r.severity]}`}>{r.severity}</span></p>
                      <p className="flex gap-2 items-center flex-wrap text-xs"><MapPin size={13} className="text-signal" />
                        <button className="underline text-signal" title="Show on the map" onClick={() => onViewMap(r.latitude, r.longitude, r.id)}>{r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</button>
                        <a className="underline text-signal inline-flex items-center gap-0.5" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}>Google Maps<ExternalLink size={11} /></a></p>
                      <p className="text-asphalt/80">Pothole detected by AI{r.source === "video_file" ? " (video file)" : ""}</p>
                      <p className="text-xs text-asphalt/70">Size: <b>{r.width_cm && r.length_cm ? `${r.width_cm.toFixed(0)} × ${r.length_cm.toFixed(0)} cm` : SIZE_LABEL[r.severity]}</b> | Est. repair: <b>{r.currency}{r.est_cost.toLocaleString()}</b></p>
                      {mode === "admin" && r.reporter && <p className="text-xs text-asphalt/60">By {r.reporter}{r.assignee ? ` · assigned to ${r.assignee}` : ""}</p>}
                    </td>
                    <td className="px-4 py-4"><PlaceCell lat={r.latitude} lng={r.longitude} /></td>
                    <td className="px-4 py-4 w-40"><p>{(r.max_confidence * 100).toFixed(0)}%</p><div className="h-1.5 rounded-full bg-asphalt/10 mt-1 overflow-hidden"><div className={`h-full ${r.max_confidence >= 0.8 ? "bg-emerald-600" : "bg-emerald-500"}`} style={{ width: `${r.max_confidence * 100}%` }} /></div></td>
                    <td className="px-4 py-4"><span className={`badge px-3 py-1 ${SEV_PILL[r.severity]}`}>{r.severity[0].toUpperCase() + r.severity.slice(1)}</span>
                      <p className="text-xs text-asphalt/60 mt-1">Danger {r.danger_pct}%</p><div className="h-1 w-16 rounded-full bg-asphalt/10 mt-1 overflow-hidden"><div className={`h-full ${BAR[r.danger_level]}`} style={{ width: `${r.danger_pct}%` }} /></div></td>
                    <td className="px-4 py-4"><div className="flex gap-2"><Calendar size={16} className="text-asphalt/50 mt-0.5" /><div><p>{when.toLocaleDateString()}</p><p className="text-xs text-asphalt/60">{when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div></div></td>
                    <td className="px-4 py-4"><span className={`badge px-3 py-1.5 ${pillCls}`}>{pill}</span></td>
                    <td className="px-4 py-4"><div className="flex items-center gap-2 relative">
                      <button className="btn btn-ghost !py-1.5 !rounded-full !border-signal !text-signal" onClick={() => setOpenId(r.id)}><Eye size={16} />View Details</button>
                      <button aria-label="More actions" className="p-1.5 rounded-full hover:bg-asphalt/10" onClick={() => setMenuId(menuId === r.id ? null : r.id)}><MoreVertical size={18} /></button>
                      {menuId === r.id && (<>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                        <div className="absolute right-0 top-9 z-20 card w-48 py-1 text-sm shadow-lg">
                          <button className="w-full text-left px-4 py-2 hover:bg-asphalt/5" onClick={() => { setMenuId(null); onViewMap(r.latitude, r.longitude, r.id); }}>View on map</button>
                          <a className="block px-4 py-2 hover:bg-asphalt/5" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`} onClick={() => setMenuId(null)}>Open in Google Maps</a>
                          {canDelete(r) && <button className="w-full text-left px-4 py-2 text-red-700 hover:bg-red-50" onClick={() => remove(r)}>Delete report</button>}
                        </div></>)}
                    </div></td>
                  </tr>);
              })}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-asphalt/10 text-sm flex-wrap">
          <span className="text-asphalt/70">{total ? `Showing ${page * PAGE + 1} to ${Math.min(total, (page + 1) * PAGE)} of ${total} report${total === 1 ? "" : "s"}` : "No reports"}</span>
          <div className="flex items-center gap-1.5">
            <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)} className="w-9 h-9 grid place-items-center rounded-lg border border-asphalt/15 disabled:opacity-40"><ChevronLeft size={16} /></button>
            {pageNums.map((n) => <button key={n} onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined} className={`w-9 h-9 rounded-lg border text-sm ${n === page ? "bg-signal border-signal text-white" : "border-asphalt/15"}`}>{n + 1}</button>)}
            <button aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="w-9 h-9 grid place-items-center rounded-lg border border-asphalt/15 disabled:opacity-40"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {sel && (
        <div className="fixed inset-0 z-40 bg-black/50 grid place-items-center p-4" onClick={() => setOpenId(null)}>
          <div role="dialog" aria-modal="true" aria-label={`Hazard ${sel.id} details`} className="bg-paper rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-lg font-bold">Hazard #{sel.id}: details and actions</h3>
              <button aria-label="Close" className="p-1.5 rounded-full hover:bg-asphalt/10" onClick={() => setOpenId(null)}><X size={20} /></button></div>
            <ul><Row r={sel} mode={mode} people={people} reload={load} onViewMap={(la, ln, id) => { setOpenId(null); onViewMap(la, ln, id); }} /></ul>
          </div>
        </div>)}
    </section>
  );
}
