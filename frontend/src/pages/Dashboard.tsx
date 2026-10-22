import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Brain, CalendarDays, Copy, Info, LayoutDashboard, Layers, ShieldCheck, TrendingUp, Wrench } from "lucide-react";
import { api } from "../api";
import PageTitle from "../components/PageTitle";
import InsightsPanel from "../components/InsightsPanel";

type Kpi = { value: number | null; previous: number | null };
type Stats = {
  days: number;
  pending_approval: number;
  kpi: { unique_hazards: Kpi; duplicates_merged: Kpi; avg_confidence: Kpi; repairs_verified: Kpi };
  by_status: Record<string, number>;
  by_severity: Record<string, number>;
  per_day: { day: string; count: number; avg_confidence: number | null }[];
  model: { file: string; weights_present: boolean; offline_evaluation: any };
  notes: string;
};

const PERIODS: [number, string][] = [[7, "Last 7 days"], [14, "Last 14 days"], [30, "Last 30 days"], [90, "Last 90 days"], [0, "All time"]];
const STATUS_COLORS: Record<string, string> = { reported: "#2563eb", assigned: "#f59e0b", in_repair: "#06b6d4", repaired: "#14b8a6", verified: "#8b5cf6", rejected: "#94a3b8" };
const SEV_COLORS: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-emerald-500" };
const TINT = {
  red: { card: "from-red-50 border-red-100", icon: "bg-red-500" },
  blue: { card: "from-blue-50 border-blue-100", icon: "bg-blue-500" },
  green: { card: "from-emerald-50 border-emerald-100", icon: "bg-emerald-500" },
  purple: { card: "from-violet-50 border-violet-100", icon: "bg-violet-500" },
};

// Compares with the previous period of the same length (real numbers from the database).
function Delta({ cur, prev, days, mode, upBad }: { cur: number | null; prev: number | null; days: number; mode: "pct" | "pts"; upBad: boolean | null }) {
  if (!days) return <p className="text-xs text-asphalt/60">All time</p>;
  if (cur == null || prev == null) return <p className="text-xs text-asphalt/60">No earlier data to compare</p>;
  const diff = cur - prev;
  const sign = diff >= 0 ? "+" : "";
  const text = mode === "pts" ? `${sign}${(diff * 100).toFixed(0)} pts` : prev === 0 ? (cur === 0 ? "0%" : "new") : `${sign}${Math.round((diff / prev) * 100)}%`;
  const dir = diff === 0 ? "flat" : diff > 0 ? "up" : "down";
  const bad = upBad === null || dir === "flat" ? null : (dir === "up") === upBad;
  const color = bad === null ? "text-slate-500" : bad ? "text-red-600" : "text-emerald-600";
  return (
    <p className="text-xs text-asphalt/60 flex items-center gap-1">
      <span className={`flex items-center font-semibold ${color}`}>{dir === "up" && <ArrowUp size={13} />}{dir === "down" && <ArrowDown size={13} />}{text}</span>
      vs previous {days} days
    </p>
  );
}

function KpiCard({ tint, icon, value, label, children }: { tint: keyof typeof TINT; icon: ReactNode; value: string; label: string; children: ReactNode }) {
  const t = TINT[tint];
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${t.card} to-white p-4 shadow-sm`}>
      <div className={`w-11 h-11 rounded-full ${t.icon} text-white grid place-items-center mb-3`}>{icon}</div>
      <p className="text-3xl font-bold leading-none">{value}</p>
      <p className="text-sm mt-1 mb-2">{label}</p>
      {children}
    </div>
  );
}

function Donut({ data, total }: { data: Record<string, number>; total: number }) {
  let acc = 0;
  return (
    <div className="relative w-36 h-36 shrink-0">
      <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90" role="img" aria-label={`${total} hazards by status`}>
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#e5e9f2" strokeWidth="5" />
        {total > 0 && Object.entries(data).filter(([, v]) => v > 0).map(([k, v]) => {
          const pct = (v / total) * 100;
          const el = <circle key={k} cx="21" cy="21" r="15.9155" fill="none" stroke={STATUS_COLORS[k] ?? "#94a3b8"} strokeWidth="5" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-acc} />;
          acc += pct;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><p className="text-2xl font-bold leading-none">{total}</p><p className="text-[11px] text-asphalt/60">Total Hazards</p></div>
      </div>
    </div>
  );
}

export default function Dashboard({ onReview }: { onReview: () => void }) {
  const [days, setDays] = useState(14);
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => { setS(null); setHover(null); api<Stats>(`/stats?days=${days}`).then(setS).catch((e) => setError(e.message)); }, [days]);

  const picker = (
    <label className="card px-3 py-2 flex items-center gap-2 text-sm">
      <CalendarDays size={18} className="text-signal" />
      <select aria-label="Period" className="bg-transparent font-medium focus:outline-none" value={days} onChange={(e) => setDays(+e.target.value)}>
        {PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
      </select>
    </label>
  );
  const head = <PageTitle title="Dashboard" subtitle="Overview of road hazard detection and repair status" icon={<LayoutDashboard size={28} />} right={picker} />;
  if (error) return <>{head}<p role="alert" className="text-red-700">{error}</p></>;
  if (!s) return <>{head}<p>Loading…</p></>;

  const k = s.kpi;
  const total = k.unique_hazards.value ?? 0;
  const maxSev = Math.max(1, ...Object.values(s.by_severity));
  const n = s.per_day.length;
  const maxDay = Math.max(1, ...s.per_day.map((d) => d.count));
  const peak = s.per_day.reduce((b, d, i) => (d.count > s.per_day[b].count ? i : b), 0);
  const active = hover ?? (s.per_day[peak]?.count ? peak : null);
  const step = Math.ceil(n / 7);
  const m = s.model.offline_evaluation;
  const conf = k.avg_confidence.value;

  return (
    <section className="space-y-5">
      {head}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard tint="red" icon={<AlertTriangle size={22} />} value={String(k.unique_hazards.value ?? 0)} label="Unique hazards">
          <Delta cur={k.unique_hazards.value} prev={k.unique_hazards.previous} days={s.days} mode="pct" upBad={true} />
        </KpiCard>
        <KpiCard tint="blue" icon={<Copy size={22} />} value={String(k.duplicates_merged.value ?? 0)} label="Duplicate reports merged">
          <Delta cur={k.duplicates_merged.value} prev={k.duplicates_merged.previous} days={s.days} mode="pct" upBad={null} />
        </KpiCard>
        <KpiCard tint="green" icon={<ShieldCheck size={22} />} value={conf == null ? "–" : `${(conf * 100).toFixed(0)}%`} label="Mean detection confidence">
          <Delta cur={conf} prev={k.avg_confidence.previous} days={s.days} mode="pts" upBad={false} />
        </KpiCard>
        <KpiCard tint="purple" icon={<Wrench size={22} />} value={String(k.repairs_verified.value ?? 0)} label="Repairs verified">
          <Delta cur={k.repairs_verified.value} prev={k.repairs_verified.previous} days={s.days} mode="pct" upBad={false} />
        </KpiCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><Layers size={20} className="text-signal" />By Status</h3>
          <div className="flex items-center gap-6 flex-wrap">
            <ul className="flex-1 min-w-[10rem] text-sm divide-y divide-asphalt/10">
              {Object.keys(STATUS_COLORS).map((st) => (
                <li key={st} className="flex items-center justify-between py-1.5">
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[st] }} />{st.replace("_", " ")}</span>
                  <b>{s.by_status[st] ?? 0}</b>
                </li>))}
            </ul>
            <Donut data={s.by_status} total={total} />
          </div>
        </div>
        <div className="card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><AlertTriangle size={20} className="text-signal" />By Severity (image heuristic)</h3>
          <ul className="space-y-4 text-sm">
            {["high", "medium", "low"].map((sev) => (
              <li key={sev} className="flex items-center gap-3">
                <span className="w-14 capitalize">{sev}</span>
                <div className="flex-1 h-3 rounded-full bg-asphalt/10 overflow-hidden"><div className={`h-full rounded-full ${SEV_COLORS[sev]}`} style={{ width: `${((s.by_severity[sev] ?? 0) / maxSev) * 100}%` }} /></div>
                <b className="w-8 text-right">{s.by_severity[sev] ?? 0}</b>
              </li>))}
          </ul>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-6"><TrendingUp size={20} className="text-signal" />Reports per day (last {n} days)</h3>
        <div className="flex gap-3">
          <div className="flex flex-col justify-between h-40 text-xs text-asphalt/60 text-right"><span>{maxDay}</span><span>{Math.round(maxDay / 2)}</span><span>0</span></div>
          <div className="flex-1 relative">
            {active != null && (
              <div className="absolute -top-9 z-10 whitespace-nowrap rounded-lg bg-signal text-white text-xs font-semibold px-3 py-1.5 shadow"
                style={{ left: `${((active + 0.5) / n) * 100}%`, transform: `translateX(-${active / n > 0.85 ? 100 : active / n < 0.15 ? 0 : 50}%)` }}>
                {s.per_day[active].day}: {s.per_day[active].count} report{s.per_day[active].count === 1 ? "" : "s"}
                {s.per_day[active].avg_confidence != null && ` · ${(s.per_day[active].avg_confidence! * 100).toFixed(0)}% conf`}
              </div>)}
            <div className="h-40 flex items-end gap-px sm:gap-1 border-b border-asphalt/15">
              {s.per_day.map((d, i) => (
                <div key={d.day} className="flex-1 h-full flex items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
                  <div className={`w-full rounded-t ${active === i ? "bg-blue-600" : "bg-blue-400"}`} style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 3 : 0 }} title={`${d.day}: ${d.count}`} />
                </div>))}
            </div>
            <div className="flex mt-1 text-[11px] text-asphalt/60">
              {s.per_day.map((d, i) => <span key={d.day} className="flex-1 text-center overflow-visible whitespace-nowrap">{i % step === 0 ? d.day.slice(5) : ""}</span>)}
            </div>
          </div>
        </div>
        {total === 0 && <p className="text-sm text-asphalt/60 mt-3">No reports in this period yet.</p>}
      </div>

      {s.pending_approval > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm"><b>{s.pending_approval}</b> reported pothole{s.pending_approval === 1 ? " is" : "s are"} waiting for your approval before appearing on the map.</p>
          <button className="btn btn-primary" onClick={onReview}>Review pending</button>
        </div>)}

      <InsightsPanel stats={s} />

      <div className="card p-5 grid md:grid-cols-2 gap-4 items-center">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-violet-100 text-violet-600 grid place-items-center shrink-0"><Brain size={28} /></div>
          <div className="text-sm">
            <p className="font-semibold text-violet-900">{s.model.file} — weights {s.model.weights_present ? "present" : "MISSING"}</p>
            {m ? <p className="text-asphalt/70">Offline eval ({m.eval_split ?? "unknown"} split): precision {m.precision.toFixed(3)}, recall {m.recall.toFixed(3)}, mAP50 {m.mAP50.toFixed(3)}, mAP50-95 {m["mAP50-95"].toFixed(3)}</p>
               : <p className="text-asphalt/70">No offline evaluation found. Run training to produce metrics.json.</p>}
          </div>
        </div>
        <div className="rounded-lg bg-violet-50 border border-violet-100 p-3 text-xs text-asphalt/70 flex gap-2"><Info size={16} className="text-violet-500 shrink-0 mt-0.5" />{s.notes}</div>
      </div>
    </section>
  );
}
