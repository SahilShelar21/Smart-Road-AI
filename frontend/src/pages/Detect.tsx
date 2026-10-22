import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Info, LocateFixed, Maximize, MapPin, Pause, Play, Route as RouteIcon, Upload, Video } from "lucide-react";
import { api } from "../api";
import { useToast } from "../ui";

type Det = { x1: number; y1: number; x2: number; y2: number; confidence: number };
type Loc = { lat: number; lng: number; acc: number | null };
type Calib = { h: string; tilt: string; hfov: string };

// Auto-report rules: confident detection in 2 consecutive frames, one report per cooldown,
// and (live camera) only after moving some metres.
const AUTO_MIN_CONF = 0.5;
const COOLDOWN_MS = 8000;
const MIN_MOVE_M = 10;
const MAX_VIDEO_MB = 50;

const summarize = (r: any) => `${r.count} pothole${r.count > 1 ? "s" : ""} reported (${r.new} new, ${r.merged} matched existing hazards)`;
const fmtLoc = (l: { lat: number; lng: number }) => `${Math.abs(l.lat).toFixed(4)}° ${l.lat >= 0 ? "N" : "S"}, ${Math.abs(l.lng).toFixed(4)}° ${l.lng >= 0 ? "E" : "W"}`;
const loadCalib = (): Calib => { try { return JSON.parse(localStorage.getItem("camera_calib") ?? "") as Calib; } catch { return { h: "", tilt: "", hfov: "" }; } };

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function Detect() {
  const toast = useToast();
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const grab = useRef<HTMLCanvasElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const stream = useRef<MediaStream | null>(null);
  const [dets, setDets] = useState<Det[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [manual, setManual] = useState({ lat: "", lng: "" });
  const [fileMode, setFileMode] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [auto, setAuto] = useState(true);
  const [sent, setSent] = useState(0);
  const [place, setPlace] = useState<{ road_type: string | null } | null>(null);
  const [calib, setCalib] = useState<Calib>(loadCalib);
  const calibRef = useRef<{ h: number; tilt: number; hfov: number } | null>(null);
  const [trip, setTrip] = useState<{ id: number; startedAt: number } | null>(null);
  const tripRef = useRef<{ id: number; startedAt: number } | null>(null);
  const tripPts = useRef<number[][]>([]);
  const trackRef = useRef<((lat: number, lng: number, acc: number) => void) | null>(null);
  const [tripDist, setTripDist] = useState(0);
  const [tripReports, setTripReports] = useState(0);
  const [, setTick] = useState(0);

  // refs so the scan timer always sees the latest values
  const autoRef = useRef(true);
  const locRef = useRef<Loc | null>(null);
  const fileModeRef = useRef(false);
  const streak = useRef(0);
  const lastAt = useRef(0);
  const lastPos = useRef<{ lat: number; lng: number } | null>(null);
  const lastPlace = useRef<{ lat: number; lng: number; t: number } | null>(null);

  function startCamera() {
    setFileMode(false);
    if (video.current) { video.current.removeAttribute("src"); video.current.loop = false; }
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => { stream.current = s; if (video.current) { video.current.srcObject = s; video.current.play(); } setCamOn(true); setError(""); })
      .catch(() => setError("Camera unavailable. Allow camera access (HTTPS or localhost is required)."));
  }

  useEffect(() => {
    startCamera();
    const watch = navigator.geolocation?.watchPosition(
      (p) => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); trackRef.current?.(p.coords.latitude, p.coords.longitude, p.coords.accuracy); },
      () => setError((e) => e || "Location unavailable. Allow location access to submit reports."), { enableHighAccuracy: true });
    return () => { stream.current?.getTracks().forEach((t) => t.stop()); if (watch !== undefined) navigator.geolocation.clearWatch(watch); };
  }, []);

  function loadFile(f: File) {
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) { toast.error(`Video is larger than ${MAX_VIDEO_MB} MB`); return; }
    stream.current?.getTracks().forEach((t) => t.stop());
    setCamOn(false);
    const v = video.current!;
    v.srcObject = null; v.src = URL.createObjectURL(f); v.loop = true; v.muted = true; v.play();
    setFileMode(true); setDets([]);
  }

  function frame(): Promise<Blob | null> {
    const v = video.current!;
    const c = (grab.current ??= document.createElement("canvas"));
    const scale = Math.min(1, 640 / v.videoWidth);
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  }

  async function sendReport(blob: Blob, l: Loc, isAuto: boolean) {
    const fd = new FormData();
    fd.append("image", blob, isAuto ? "auto.jpg" : "report.jpg");
    fd.append("latitude", String(l.lat)); fd.append("longitude", String(l.lng));
    if (l.acc != null) fd.append("accuracy_m", String(l.acc));
    fd.append("source", fileModeRef.current ? "video_file" : "camera");
    if (isAuto) fd.append("min_conf", String(AUTO_MIN_CONF));
    const c = calibRef.current;
    if (c) { fd.append("cam_height_m", String(c.h)); fd.append("tilt_deg", String(c.tilt)); fd.append("hfov_deg", String(c.hfov)); }
    if (tripRef.current) fd.append("trip_id", String(tripRef.current.id));
    const res = await api("/reports", { method: "POST", body: fd });
    if (tripRef.current) setTripReports((n) => n + res.count);
    return res;
  }

  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(async () => {
      const v = video.current;
      if (busy.current || !v || v.readyState < 2 || !v.videoWidth || v.paused) return;
      busy.current = true;
      try {
        const blob = await frame();
        if (!blob) return;
        const fd = new FormData(); fd.append("image", blob, "frame.jpg");
        const r = await api<{ image_width: number; image_height: number; detections: Det[] }>("/detect", { method: "POST", body: fd });
        const sx = v.videoWidth / r.image_width, sy = v.videoHeight / r.image_height;
        setDets(r.detections.map((d) => ({ ...d, x1: d.x1 * sx, x2: d.x2 * sx, y1: d.y1 * sy, y2: d.y2 * sy })));
        setError("");

        // ---- automatic reporting ----
        const strong = r.detections.some((d) => d.confidence >= AUTO_MIN_CONF);
        streak.current = strong ? streak.current + 1 : 0;
        if (autoRef.current && strong && streak.current >= 2) {
          const l = locRef.current;
          if (!l) { setError("Pothole seen, but no location yet. Allow GPS (or enter a location) to auto-report."); }
          else if (Date.now() - lastAt.current >= COOLDOWN_MS &&
                   (fileModeRef.current || !lastPos.current || distM(lastPos.current, l) >= MIN_MOVE_M)) {
            lastAt.current = Date.now();
            lastPos.current = { lat: l.lat, lng: l.lng };
            try {
              const rep = await sendReport(blob, l, true);
              setSent((n) => n + rep.count);
              toast.success(`Auto-reported: ${summarize(rep)}`);
            } catch (e) { setError("Auto-report failed: " + (e as Error).message); toast.error("Auto-report failed: " + (e as Error).message); }
          }
        }
      } catch (e) { setError((e as Error).message); }
      finally { busy.current = false; }
    }, 600);
    return () => clearInterval(timer);
  }, [scanning]);

  // boxes drawn like the design: orange frame with a filled label tab
  useEffect(() => {
    const c = overlay.current, v = video.current;
    if (!c || !v) return;
    c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const lw = Math.max(2, c.width / 240), fs = Math.max(13, c.width / 42);
    ctx.lineWidth = lw; ctx.font = `600 ${fs}px system-ui`;
    for (const d of dets) {
      ctx.strokeStyle = "#f59e0b"; ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
      const label = `Pothole ${(d.confidence * 100).toFixed(0)}%`;
      const tw = ctx.measureText(label).width + 12, th = fs + 8, ty = Math.max(0, d.y1 - th);
      ctx.fillStyle = "#f59e0b"; ctx.fillRect(d.x1 - lw / 2, ty, tw, th);
      ctx.fillStyle = "#1f2937"; ctx.fillText(label, d.x1 + 5, ty + th - 7);
    }
  }, [dets]);

  // road class of the current position (OpenStreetMap data, not AI)
  useEffect(() => {
    if (!gps || fileMode) return;
    const l = lastPlace.current;
    if (l && Date.now() - l.t < 20000 && distM(l, gps) < 100) return;
    lastPlace.current = { lat: gps.lat, lng: gps.lng, t: Date.now() };
    api<{ road_type: string | null }>(`/place?lat=${gps.lat}&lng=${gps.lng}`).then(setPlace).catch(() => {});
  }, [gps?.lat, gps?.lng, fileMode]);

  const manualLoc: Loc | null = manual.lat && manual.lng && !isNaN(+manual.lat) && !isNaN(+manual.lng) ? { lat: +manual.lat, lng: +manual.lng, acc: null } : null;
  const loc: Loc | null = fileMode ? manualLoc : gps ?? manualLoc;
  autoRef.current = auto; locRef.current = loc; fileModeRef.current = fileMode;
  const hn = parseFloat(calib.h), tn = parseFloat(calib.tilt), fn = parseFloat(calib.hfov);
  calibRef.current = hn > 0 && !isNaN(tn) && fn > 0 ? { h: hn, tilt: tn, hfov: fn } : null;
  tripRef.current = trip;
  trackRef.current = (lat, lng, acc) => {
    if (!tripRef.current || acc > 50) return;
    const last = tripPts.current[tripPts.current.length - 1];
    const step = last ? distM({ lat: last[1], lng: last[0] }, { lat, lng }) : 0;
    if (last && step < 5) return;
    tripPts.current.push([lng, lat, Date.now()]);
    setTripDist((d) => d + step);
  };
  useEffect(() => { try { localStorage.setItem("camera_calib", JSON.stringify(calib)); } catch { /* ignore */ } }, [calib]);
  useEffect(() => { if (!trip) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [trip]);

  async function submit() {
    if (!loc) { toast.error("No location yet. Allow GPS or enter a latitude and longitude."); return; }
    try {
      const blob = await frame();
      const rep = await sendReport(blob!, loc, false);
      toast.success(summarize(rep)); setError("");
    } catch (e) { setError((e as Error).message); toast.error((e as Error).message); }
  }
  async function startTrip() {
    try {
      const t = await api<{ id: number }>("/trips", { method: "POST" });
      tripPts.current = gps ? [[gps.lng, gps.lat, Date.now()]] : [];
      setTripDist(0); setTripReports(0); setTrip({ id: t.id, startedAt: Date.now() }); setAuto(true);
      toast.success("Trip started: your route and reports are being recorded");
    } catch (e) { toast.error((e as Error).message); }
  }
  async function endTrip() {
    if (!trip) return;
    try {
      const t = await api<any>(`/trips/${trip.id}/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: tripPts.current }) });
      toast.success(`Trip saved: ${(t.distance_m / 1000).toFixed(2)} km, ${t.reports} pothole report(s). Admin will review them.`);
      setTrip(null);
    } catch (e) { toast.error((e as Error).message); }
  }
  const elapsed = trip ? Math.floor((Date.now() - trip.startedAt) / 1000) : 0;
  const best = dets.length ? Math.max(...dets.map((d) => d.confidence)) : 0;
  const autoState = !auto ? "Auto-report is off" : !scanning ? "Scan paused" : dets.length ? "Pothole in view: reporting when confirmed" : "Waiting for detection…";

  const card = "rounded-xl border p-4 flex items-center gap-4";
  return (
    <section className="grid gap-4 xl:grid-cols-[1.55fr_0.85fr_1.1fr]">
      {/* video */}
      <div className="order-1 xl:order-none">
        <div ref={wrap} className="relative bg-asphalt rounded-xl overflow-hidden">
          <video ref={video} autoPlay playsInline muted className="w-full h-auto block min-h-56" />
          <canvas ref={overlay} className="absolute inset-0 w-full h-full" />
          <span className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/55 text-white text-xs px-3 py-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${scanning && (camOn || fileMode) ? "bg-red-500" : "bg-gray-400"}`} />{fileMode ? "Video file" : camOn ? "Live Camera" : "Camera off"}
          </span>
          {loc && <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/55 text-white text-xs px-3 py-1.5"><MapPin size={14} />Location: {fmtLoc(loc)}</span>}
          <div className="absolute bottom-3 right-3 flex gap-2">
            <button aria-label="Report potholes in view now" title="Report potholes in view now" onClick={submit} disabled={!dets.length} className="w-11 h-11 rounded-lg bg-black/70 text-white grid place-items-center disabled:opacity-40"><Camera size={20} /></button>
            <button aria-label="Full screen" title="Full screen" onClick={() => wrap.current?.requestFullscreen?.()} className="w-11 h-11 rounded-lg bg-black/70 text-white grid place-items-center"><Maximize size={20} /></button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
      </div>

      {/* big buttons */}
      <div className="order-2 xl:order-none card p-4 space-y-3 self-start">
        <button onClick={startCamera} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white p-4 flex items-center gap-4 text-left">
          <Camera size={30} /><span><b className="block text-lg leading-tight">Use Camera</b><span className="text-sm text-white/80">Capture a photo or scan live</span></span>
        </button>
        <button onClick={() => fileInput.current?.click()} className="w-full rounded-xl border border-asphalt/20 bg-white hover:bg-asphalt/5 p-4 flex items-center gap-4 text-left">
          <Upload size={30} className="text-signal" /><span><b className="block text-lg leading-tight">Upload Video</b><span className="text-sm text-asphalt/70">Choose a video file instead</span></span>
        </button>
        <div className="rounded-xl bg-blue-50 p-3 text-sm flex gap-2"><Info size={18} className="text-signal shrink-0 mt-0.5" /><span><b className="text-signal">Supported formats</b><br /><span className="text-xs text-asphalt/70">MP4, MOV (Max {MAX_VIDEO_MB}MB)</span></span></div>
        <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
      </div>

      {/* right panels */}
      <div className="order-4 xl:order-none xl:row-span-2 space-y-4">
        <div className="card p-4 space-y-3 bg-blue-50/60">
          <label className="flex items-start gap-3 cursor-pointer text-sm">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-1 w-4 h-4" />
            <span><b>Auto-report potholes</b> ({sent} reported this session)
              <span className="block text-xs text-asphalt/70 mt-1">Every pothole in the frame becomes its own entry when a pothole (≥{AUTO_MIN_CONF * 100}% confidence) is seen in 2 frames in a row, with your current location. Max one every {COOLDOWN_MS / 1000}s. New reports wait for an admin to admit them to the map.</span></span>
          </label>
          <p className="rounded-lg bg-amber-100/80 text-amber-900 text-sm px-3 py-2.5 flex items-center justify-center gap-2"><MapPin size={16} />{autoState}</p>
        </div>
        <button onClick={() => setScanning((s) => !s)} className="btn btn-ghost w-full !py-3">{scanning ? <><Pause size={16} />Pause scan</> : <><Play size={16} />Resume scan</>}</button>

        <div className="card p-4 space-y-3 text-sm">
          <p className="font-semibold flex items-center gap-2"><Video size={18} />Use a video file instead</p>
          <p className="text-asphalt/70 text-xs">For demos and testing on recorded road footage. Enter a location below; reports are marked as video_file.</p>
          <div className="flex items-center gap-2"><button className="btn btn-ghost !py-1.5" onClick={() => fileInput.current?.click()}>Choose File</button>{fileMode && <button className="underline text-xs" onClick={startCamera}>Back to live camera</button>}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="relative"><MapPin size={16} className="absolute left-3 top-3 text-asphalt/50" /><input className="input !pl-9" placeholder="Latitude" value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} /></label>
            <label className="relative"><MapPin size={16} className="absolute left-3 top-3 text-asphalt/50" /><input className="input !pl-9 !pr-9" placeholder="Longitude" value={manual.lng} onChange={(e) => setManual({ ...manual, lng: e.target.value })} />
              <button type="button" aria-label="Use my GPS position" title="Use my GPS position" disabled={!gps} onClick={() => gps && setManual({ lat: gps.lat.toFixed(6), lng: gps.lng.toFixed(6) })} className="absolute right-2 top-2.5 text-asphalt/60 disabled:opacity-30"><LocateFixed size={18} /></button></label>
          </div>
        </div>

        <div className="card p-4 space-y-3 text-sm">
          <p className="font-semibold flex items-center gap-2"><Camera size={18} />Camera setup (for size estimates)</p>
          <p className="text-xs text-asphalt/70">Width and length are estimated from the camera's height, tilt and field of view. Without this setup no size is estimated. Estimates are unvalidated until an admin compares them with tape measurements.</p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">Height (m)<input className="input !py-1.5" inputMode="decimal" placeholder="1.2" value={calib.h} onChange={(e) => setCalib({ ...calib, h: e.target.value })} /></label>
            <label className="text-xs">Tilt down (°)<input className="input !py-1.5" inputMode="decimal" placeholder="10" value={calib.tilt} onChange={(e) => setCalib({ ...calib, tilt: e.target.value })} /></label>
            <label className="text-xs">H-FOV (°)<input className="input !py-1.5" inputMode="decimal" placeholder="70" value={calib.hfov} onChange={(e) => setCalib({ ...calib, hfov: e.target.value })} /></label>
          </div>
          <p className="text-xs text-asphalt/60">Height = lens above the road (windshield about 1.2 m). Tilt = degrees below horizontal (about 5 to 15). Horizontal FOV: phone landscape about 65 to 75, portrait about 45 to 55 (typical values; check your phone).</p>
          <p className={`text-xs font-semibold ${calibRef.current ? "text-green-700" : "text-amber-600"}`}>{calibRef.current ? "Size estimates are ON for new reports." : "Size estimates are OFF."}</p>
        </div>

        {!fileMode && (!trip ? (
          <button className="btn btn-primary w-full !py-3.5 text-base" disabled={!gps} onClick={startTrip} title={gps ? "" : "Waiting for GPS"}><Play size={18} />Start trip</button>
        ) : (
          <div className="card p-4 space-y-3 text-sm">
            <p className="font-semibold flex items-center gap-2"><RouteIcon size={18} />Trip in progress</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-xl font-bold">{(tripDist / 1000).toFixed(2)}</p><p className="text-xs text-asphalt/60">km</p></div>
              <div><p className="text-xl font-bold">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</p><p className="text-xs text-asphalt/60">time</p></div>
              <div><p className="text-xl font-bold">{tripReports}</p><p className="text-xs text-asphalt/60">potholes</p></div>
            </div>
            <button className="btn btn-ghost w-full" onClick={endTrip}>End trip and save</button>
          </div>
        ))}
      </div>

      {/* status cards */}
      <div className="order-3 xl:order-none xl:col-span-2 grid sm:grid-cols-3 gap-4">
        <div className={`${card} border-red-100 bg-red-50`}>
          <span className="w-14 h-14 rounded-full bg-red-500 text-white grid place-items-center shrink-0"><AlertTriangle size={26} /></span>
          <div><p className="font-bold">{dets.length ? `${dets.length} pothole${dets.length > 1 ? "s" : ""} detected` : "No potholes detected"}</p>
            <p className="text-sm text-red-600">{dets.length ? `Highest confidence ${(best * 100).toFixed(0)}%` : scanning ? "Waiting for input…" : "Scan paused"}</p></div>
        </div>
        <div className={`${card} border-violet-100 bg-violet-50`}>
          <span className="w-14 h-14 rounded-full bg-violet-500 text-white grid place-items-center shrink-0"><MapPin size={26} /></span>
          <div><p className="font-bold">GPS Location</p><p className="text-sm text-asphalt/70">{loc ? `${fmtLoc(loc)}${loc.acc != null ? ` (±${Math.round(loc.acc)} m)` : ""}` : "Not available yet"}</p></div>
        </div>
        <div className={`${card} border-emerald-100 bg-emerald-50`}>
          <span className="w-14 h-14 rounded-full bg-emerald-500 text-white grid place-items-center shrink-0"><RouteIcon size={26} /></span>
          <div><p className="font-bold text-emerald-700">Road Type</p><p className="text-sm text-asphalt/70">{!fileMode && place?.road_type ? place.road_type : "Not available"}</p><p className="text-[11px] text-asphalt/50">from map data</p></div>
        </div>
      </div>
    </section>
  );
}
