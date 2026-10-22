import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../api";

type Trip = { id: number; started_at: string; distance_m: number; duration_s: number; reports: number };
type Detail = Trip & { path: [number, number][]; reports_list: { id: number; latitude: number; longitude: number; danger_pct: number; danger_level: string }[] };

function RouteMap({ d }: { d: Detail }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!, zoom: 14,
      center: (d.path[0] ?? [d.reports_list[0]?.longitude ?? 72.8777, d.reports_list[0]?.latitude ?? 19.076]) as [number, number],
      style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] } as any,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      const b = new maplibregl.LngLatBounds();
      if (d.path.length > 1) {
        map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: d.path } } });
        map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 5 } });
        d.path.forEach((p) => b.extend(p));
      }
      map.addSource("pts", { type: "geojson", data: { type: "FeatureCollection", features: d.reports_list.map((r) => ({ type: "Feature", properties: { danger: r.danger_level }, geometry: { type: "Point", coordinates: [r.longitude, r.latitude] } })) } });
      map.addLayer({ id: "pts", type: "circle", source: "pts", paint: { "circle-radius": 8, "circle-stroke-width": 2, "circle-stroke-color": "#fff", "circle-color": ["match", ["get", "danger"], "high", "#ef4444", "medium", "#f59e0b", "#22c55e"] } });
      d.reports_list.forEach((r) => b.extend([r.longitude, r.latitude]));
      if (!b.isEmpty()) map.fitBounds(b, { padding: 50, maxZoom: 17, duration: 0 });
    });
    return () => map.remove();
  }, []);
  return <div ref={el} className="h-[50vh] rounded-xl border border-asphalt/15 overflow-hidden" />;
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [sel, setSel] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Trip[]>("/trips").then(setTrips).catch((e) => setError(e.message)); }, []);
  const open = (id: number) => api<Detail>(`/trips/${id}`).then(setSel).catch((e) => setError(e.message));
  const dur = (s: number) => `${Math.floor(s / 60)} min ${s % 60}s`;
  if (error) return <p role="alert" className="text-red-700">{error}</p>;
  if (!trips) return <p>Loading…</p>;
  return (
    <section className="grid lg:grid-cols-[1fr_2fr] gap-4">
      <div className="space-y-2">
        {!trips.length && <p>No trips yet. On Scan Road, press <b>Start trip</b> before you drive or walk the road.</p>}
        {trips.map((t) => (
          <button key={t.id} onClick={() => open(t.id)} className={`card w-full text-left p-3 text-sm ${sel?.id === t.id ? "ring-2 ring-lane" : ""}`}>
            <p className="font-medium">{new Date(t.started_at).toLocaleString()}</p>
            <p>{(t.distance_m / 1000).toFixed(2)} km · {dur(t.duration_s)} · <b>{t.reports}</b> pothole report{t.reports === 1 ? "" : "s"}</p>
          </button>))}
      </div>
      <div>
        {sel ? (<div className="space-y-2" key={sel.id}>
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 text-center"><p className="text-2xl font-bold">{(sel.distance_m / 1000).toFixed(2)}</p><p className="text-xs text-asphalt/60">km driven</p></div>
            <div className="card p-3 text-center"><p className="text-2xl font-bold">{sel.reports}</p><p className="text-xs text-asphalt/60">potholes reported</p></div>
            <div className="card p-3 text-center"><p className="text-2xl font-bold">{sel.distance_m > 0 ? (sel.reports / (sel.distance_m / 1000)).toFixed(1) : "–"}</p><p className="text-xs text-asphalt/60">per km</p></div>
          </div>
          <RouteMap d={sel} />
          <p className="text-xs text-asphalt/60">Blue line = your route. Dots = reports (green low, amber medium, red high danger).</p>
        </div>) : <div className="card p-6 text-sm text-asphalt/70">Select a trip to see its route and the potholes you reported on it.</div>}
      </div>
    </section>
  );
}
