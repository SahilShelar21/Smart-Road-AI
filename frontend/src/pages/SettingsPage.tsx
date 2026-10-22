import { useEffect, useState } from "react";
import { api, download } from "../api";
import { useToast } from "../ui";

type Budget = { currency: string; low: number; medium: number; high: number; per_m2: number };

export default function SettingsPage() {
  const toast = useToast();
  const [b, setB] = useState<Budget | null>(null);
  useEffect(() => { api<Budget>("/settings/budget").then(setB).catch((e) => toast.error(e.message)); }, []);

  async function save() {
    if (!b) return;
    try { setB(await api<Budget>("/settings/budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })); toast.success("Budget rates saved"); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function exportTraining() {
    try {
      const r = await download("/training/export", "smartroad_training_data.zip");
      toast.success(`${r.headers.get("X-Frames")} frames exported (${r.headers.get("X-Positive")} labelled potholes, ${r.headers.get("X-Negative")} false-alarm frames)`);
    } catch (e) { toast.error((e as Error).message); }
  }
  const num = (k: keyof Budget) => (
    <input className="input" type="number" min={0} value={b ? (b[k] as number) : ""} onChange={(e) => setB({ ...b!, [k]: +e.target.value })} />
  );

  return (
    <section className="grid md:grid-cols-2 gap-4">
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Repair budget rates</h2>
        <p className="text-sm text-asphalt/70">Estimated cost of a hazard = the rate for its danger level + the per-m² rate × its area (when a size is known). The defaults are placeholders: enter your municipality's real rates.</p>
        {!b ? <p>Loading…</p> : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label>Currency symbol<input className="input" maxLength={4} value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value })} /></label>
            <label>Per m² of damaged area{num("per_m2")}</label>
            <label>Low danger (per repair){num("low")}</label>
            <label>Medium danger (per repair){num("medium")}</label>
            <label>High danger (per repair){num("high")}</label>
          </div>)}
        <button className="btn btn-primary" onClick={save} disabled={!b}>Save rates</button>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Improve the AI model</h2>
        <p className="text-sm text-asphalt/70">Open All Reports and mark each detection <b>AI was right</b> or <b>False alarm</b>. Download the reviewed frames as a YOLO dataset: confirmed boxes become labels and false alarms become negative examples. Merge it with public datasets (see ml/DATASETS.md) and retrain.</p>
        <button className="btn btn-primary" onClick={exportTraining}>Download training data (.zip)</button>
        <p className="text-xs text-asphalt/60">Only reports created after this update have clean frames. Potholes the AI missed are not captured here: label those separately in Roboflow or CVAT. Faces and plates are already blurred in stored frames.</p>
      </div>
    </section>
  );
}
