import { useEffect, useState } from "react";
import { Download, Gauge, Wallet } from "lucide-react";
import { api, download } from "../api";
import { useToast } from "../ui";

const LEVEL_BAR: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-emerald-500" };

export default function InsightsPanel({ stats }: { stats: any }) {
  const toast = useToast();
  const [val, setVal] = useState<any>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  useEffect(() => { api("/validation").then(setVal).catch(() => {}); }, []);

  async function exportMonth(format: "xlsx" | "csv") {
    try { const r = await download(`/export/monthly?month=${month}&format=${format}`, `smartroad_report_${month}.${format}`); toast.success(`Downloaded ${r.name}`); }
    catch (e) { toast.error((e as Error).message); }
  }

  const b = stats.budget, dl = stats.danger_levels ?? {};
  const totalDl = Math.max(1, (dl.low ?? 0) + (dl.medium ?? 0) + (dl.high ?? 0));
  const dm = val?.depth_model;
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Wallet size={20} className="text-signal" />Repair budget (estimate)</h3>
        <p className="text-3xl font-bold">{b.currency}{b.open_total.toLocaleString()}</p>
        <p className="text-sm text-asphalt/70">for {b.open_count} open hazard{b.open_count === 1 ? "" : "s"} · all hazards in this period: {b.currency}{b.all_total.toLocaleString()}</p>
        <ul className="space-y-2 text-sm">
          {["high", "medium", "low"].map((lv) => (
            <li key={lv} className="flex items-center gap-2"><span className="w-14 capitalize">{lv}</span>
              <div className="flex-1 h-2.5 rounded-full bg-asphalt/10 overflow-hidden"><div className={`h-full ${LEVEL_BAR[lv]}`} style={{ width: `${((dl[lv] ?? 0) / totalDl) * 100}%` }} /></div><b className="w-6 text-right">{dl[lv] ?? 0}</b></li>))}
        </ul>
        <p className="text-xs text-asphalt/60">Average danger {stats.avg_danger ?? "–"}%. Danger is a risk index (size, depth, repeat reports, AI confidence), not a physical measurement. Costs use the rates in Settings; the defaults are placeholders.</p>
      </div>

      <div className="card p-5 space-y-2">
        <h3 className="font-semibold flex items-center gap-2"><Gauge size={20} className="text-signal" />Are the size estimates accurate?</h3>
        {!val || val.measured_reports === 0 ? (
          <p className="text-sm text-asphalt/70">No on-site tape measurements yet, so the estimates are <b>unvalidated</b>. Open a report and use "On-site measurement" for a few real potholes, then this card shows the error.</p>
        ) : (
          <ul className="text-sm space-y-1">
            <li>{val.measured_reports} pothole(s) measured on site</li>
            <li>Width: {val.width.n ? `avg error ${val.width.mae_cm} cm (${val.width.mape_pct}%) over ${val.width.n}` : "no pairs yet"}</li>
            <li>Length: {val.length.n ? `avg error ${val.length.mae_cm} cm (${val.length.mape_pct}%) over ${val.length.n}` : "no pairs yet"}</li>
          </ul>)}
        <p className="text-sm">Depth: {dm?.ready ? <>estimated from size (ratio {dm.k.toFixed(3)}, avg error {dm.mae_cm.toFixed(1)} cm on {dm.n} samples, checked on the same data).</> : <><b>locked</b>: needs {10 - (dm?.n ?? 0)} more pothole(s) with width, length and depth measured by tape. Depth cannot be read from a single photo.</>}</p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Download size={20} className="text-signal" />Monthly report</h3>
        <p className="text-sm text-asphalt/70">One row per report with location, status, danger, size, cost, people and a map link, plus a summary sheet.</p>
        <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" onClick={() => exportMonth("xlsx")}>Excel (.xlsx)</button>
          <button className="btn btn-ghost flex-1" onClick={() => exportMonth("csv")}>CSV</button>
        </div>
      </div>
    </div>
  );
}
