import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../api";
import { useConfirm, useToast } from "../ui";

export type MapFocus = { lat: number; lng: number; id?: number; nonce: number };

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTR = "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const OSM_ATTR = "© OpenStreetMap contributors";

type Src = { id: string; tiles: string; attribution?: string; maxzoom?: number };
function raster(sources: Src[]): StyleSpecification {
  return {
    version: 8,
    sources: Object.fromEntries(sources.map((s) => [s.id, { type: "raster", tiles: [s.tiles], tileSize: 256, maxzoom: s.maxzoom ?? 19, attribution: s.attribution }])),
    layers: sources.map((s) => ({ id: s.id, type: "raster", source: s.id })),
  } as StyleSpecification;
}
const imagery: Src = { id: "sat", tiles: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTR };

function satellite3D(): StyleSpecification {
  const s = raster([imagery]) as any;
  s.sources.dem = { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: Mapzen, AWS Open Data" };
  s.terrain = { source: "dem", exaggeration: 1.6 };
  return s as StyleSpecification;
}

type ViewKey = "road" | "satellite" | "hybrid" | "terrain" | "dark" | "city3d" | "sat3d";
const VIEWS: Record<ViewKey, { label: string; style: () => string | StyleSpecification; pitch: number; bearing: number; minZoom?: number }> = {
  road: { label: "Road", style: () => raster([{ id: "osm", tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR }]), pitch: 0, bearing: 0 },
  satellite: { label: "Satellite", style: () => raster([imagery]), pitch: 0, bearing: 0 },
  hybrid: {
    label: "Hybrid",
    style: () => raster([imagery,
      { id: "places", tiles: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}` },
      { id: "roads", tiles: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}` }]),
    pitch: 0, bearing: 0,
  },
  terrain: { label: "Terrain", style: () => raster([{ id: "topo", tiles: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTR }]), pitch: 0, bearing: 0 },
  dark: { label: "Dark", style: () => raster([{ id: "dark", tiles: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", attribution: `${OSM_ATTR} © CARTO`, maxzoom: 20 }]), pitch: 0, bearing: 0 },
  city3d: { label: "3D City", style: () => "https://tiles.openfreemap.org/styles/liberty", pitch: 60, bearing: -20, minZoom: 15.5 },
  sat3d: { label: "3D Satellite", style: satellite3D, pitch: 60, bearing: 20, minZoom: 13 },
};

const SEVERITIES = ["low", "medium", "high"];
const STATUSES = ["reported", "assigned", "in_repair", "repaired", "verified", "rejected"];

type PopupAction = { label: string; danger?: boolean; onClick: () => void };
function popupNode(lines: string[], lat: number, lng: number, actions: PopupAction[] = []) {
  const d = document.createElement("div");
  d.style.fontSize = "13px"; d.style.lineHeight = "1.45"; d.style.color = "#0f1b3d";
  lines.forEach((t, i) => { const p = document.createElement(i === 0 ? "strong" : "div"); p.textContent = t; d.appendChild(p); });
  const a = document.createElement("a");
  a.href = `https://www.google.com/maps?q=${lat},${lng}`; a.target = "_blank"; a.rel = "noopener noreferrer";
  a.textContent = "Open in Google Maps ↗"; a.style.color = "#2563eb"; a.style.textDecoration = "underline";
  d.appendChild(a);
  if (actions.length) {
    const row = document.createElement("div"); row.style.marginTop = "8px"; row.style.display = "flex"; row.style.gap = "6px";
    actions.forEach((x) => {
      const b = document.createElement("button"); b.textContent = x.label;
      b.style.cssText = `padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${x.danger ? "#b91c1c" : "#0f1b3d"};color:${x.danger ? "#b91c1c" : "#0f1b3d"};background:#fff`;
      b.onclick = x.onClick; row.appendChild(b);
    });
    d.appendChild(row);
  }
  return d;
}
const hazardLines = (p: any) => [`Hazard #${p.id}`, `${p.severity} severity · ${String(p.status).replace("_", " ")}`, ...(p.danger_pct != null ? [`Danger ${p.danger_pct}% (${p.danger_level})`] : []), ...(p.approved === false ? ["Pending admission (admins only)"] : []), `${p.confirmations} report(s) · confidence ${Math.round(p.confidence * 100)}%`];

export default function MapPage({ focus, isAdmin }: { focus: MapFocus | null; isAdmin: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const adminRef = useRef<{ approve: (id: number) => void; del: (id: number) => void } | null>(null);
  const clickPopup = useRef<maplibregl.Popup | null>(null);
  const pendingRef = useRef(false);
  const [showPending, setShowPending] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataRef = useRef<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });
  const filterRef = useRef<{ sev: string[]; status: string }>({ sev: SEVERITIES, status: "" });
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const applied = useRef<ViewKey>("road");
  const modeRef = useRef<"dots" | "heat" | "both">("dots");
  const [layerMode, setLayerMode] = useState<"dots" | "heat" | "both">("dots");
  const [view, setView] = useState<ViewKey>(() => { try { const v = localStorage.getItem("map_view") as ViewKey; return v && VIEWS[v] ? v : "road"; } catch { return "road"; } });
  const [sev, setSev] = useState<Record<string, boolean>>({ low: true, medium: true, high: true });
  const [status, setStatus] = useState("");
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null);
  const [error, setError] = useState("");
  const [focusNote, setFocusNote] = useState("");

  const buildFilter = (): any => {
    const f: any[] = ["all", ["in", ["get", "severity"], ["literal", filterRef.current.sev]]];
    if (filterRef.current.status) f.push(["==", ["get", "status"], filterRef.current.status]);
    return f;
  };

  function applyMode(map: maplibregl.Map) {
    const m = modeRef.current;
    if (map.getLayer("hazard-heat")) map.setLayoutProperty("hazard-heat", "visibility", m === "dots" ? "none" : "visible");
    if (map.getLayer("hazard-circles")) map.setLayoutProperty("hazard-circles", "visibility", m === "heat" ? "none" : "visible");
  }

  function addHazards(map: maplibregl.Map) {
    if (!map.getSource("hazards")) map.addSource("hazards", { type: "geojson", data: dataRef.current });
    if (!map.getLayer("hazard-heat")) {
      map.addLayer({
        id: "hazard-heat", type: "heatmap", source: "hazards",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "danger_pct"], 30], 0, 0.15, 100, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 15, 44],
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, "#fde68a", 0.5, "#f59e0b", 0.8, "#ef4444", 1, "#7f1d1d"],
          "heatmap-opacity": 0.85,
        },
      });
    }
    if (!map.getLayer("hazard-circles")) {
      map.addLayer({
        id: "hazard-circles", type: "circle", source: "hazards",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "confirmations"], 1, 7, 6, 14],
          "circle-color": ["match", ["get", "severity"], "high", "#ef4444", "medium", "#f59e0b", "#22c55e"],
          "circle-opacity": ["case", ["==", ["get", "approved"], false], 0.4, 0.85], "circle-stroke-width": 2, "circle-stroke-color": ["case", ["==", ["get", "approved"], false], "#6b7280", "#ffffff"],
        },
      });
    }
    map.setFilter("hazard-circles", buildFilter());
    applyMode(map);
  }

  function fitAll() {
    const map = mapRef.current;
    const feats = dataRef.current.features;
    if (!map || !feats.length) return;
    const b = new maplibregl.LngLatBounds();
    feats.forEach((f) => b.extend((f.geometry as GeoJSON.Point).coordinates as [number, number]));
    map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 800 });
  }

  function loadData(initial: boolean) {
    api<GeoJSON.FeatureCollection>(`/map?include_pending=${pendingRef.current}`).then((data) => {
      dataRef.current = data; setFc(data);
      (mapRef.current?.getSource("hazards") as maplibregl.GeoJSONSource | undefined)?.setData(data);
      if (initial && !focus) {
        const feats = data.features;
        if (feats.length) {
          const b = new maplibregl.LngLatBounds();
          feats.forEach((f) => b.extend((f.geometry as GeoJSON.Point).coordinates as [number, number]));
          mapRef.current?.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
        }
      }
    }).catch((e) => setError(e.message));
  }

  // create the map once
  useEffect(() => {
    const v = VIEWS[view];
    const map = new maplibregl.Map({ container: el.current!, style: v.style(), center: [72.8777, 19.076], zoom: 11, pitch: v.pitch, bearing: v.bearing, maxPitch: 75 });
    mapRef.current = map; applied.current = view;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl(), "bottom-left");
    map.on("style.load", () => addHazards(map));
    map.on("click", "hazard-circles", (e) => {
      const f = e.features?.[0]; if (!f) return;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      const p: any = f.properties;
      const a = adminRef.current;
      const acts: PopupAction[] = a ? [...(p.approved === false ? [{ label: "Admit to map", onClick: () => a.approve(p.id) }] : []), { label: "Delete from map", danger: true, onClick: () => a.del(p.id) }] : [];
      clickPopup.current?.remove();
      clickPopup.current = new maplibregl.Popup({ offset: 12 }).setLngLat([lng, lat]).setDOMContent(popupNode(hazardLines(p), lat, lng, acts)).addTo(map);
    });
    map.on("mouseenter", "hazard-circles", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "hazard-circles", () => { map.getCanvas().style.cursor = ""; });
    loadData(true);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // switch map view
  useEffect(() => {
    const map = mapRef.current;
    if (!map || view === applied.current) return;
    applied.current = view;
    const v = VIEWS[view];
    // diff:false forces a full style reload, so "style.load" fires and the hazard layer is re-added
    map.setStyle(v.style(), { diff: false });
    map.once("idle", () => { if (!map.getLayer("hazard-circles")) addHazards(map); });  // safety net
    map.easeTo({ pitch: v.pitch, bearing: v.bearing, zoom: v.minZoom ? Math.max(map.getZoom(), v.minZoom) : map.getZoom(), duration: 900 });
    try { localStorage.setItem("map_view", view); } catch { /* ignore */ }
  }, [view]);

  useEffect(() => { modeRef.current = layerMode; const map = mapRef.current; if (map) applyMode(map); }, [layerMode]);

  useEffect(() => { pendingRef.current = showPending; if (mapRef.current) loadData(false); }, [showPending]);

  // filters
  useEffect(() => {
    filterRef.current = { sev: SEVERITIES.filter((s) => sev[s]), status };
    const map = mapRef.current;
    if (map && map.getLayer("hazard-circles")) map.setFilter("hazard-circles", buildFilter());
  }, [sev, status]);

  // jump to a report's location (coming from the Reports tab)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !fc) return;
    markerRef.current?.remove(); popupRef.current?.remove();
    const pin = document.createElement("div"); pin.className = "focus-pin";
    markerRef.current = new maplibregl.Marker({ element: pin }).setLngLat([focus.lng, focus.lat]).addTo(map);
    const feat = fc.features.find((f) => (f.properties as any)?.id === focus.id);
    const lines = feat ? hazardLines(feat.properties) : [focus.id ? `Report #${focus.id}` : "Selected location", `${focus.lat.toFixed(5)}, ${focus.lng.toFixed(5)}`];
    popupRef.current = new maplibregl.Popup({ offset: 22, closeOnClick: false }).setLngLat([focus.lng, focus.lat]).setDOMContent(popupNode(lines, focus.lat, focus.lng)).addTo(map);
    map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 17), speed: 1.4 });
    setFocusNote(`Showing ${focus.id ? `report #${focus.id}` : "location"} at ${focus.lat.toFixed(5)}, ${focus.lng.toFixed(5)}`);
  }, [focus?.nonce, fc]);

  adminRef.current = isAdmin ? {
    approve: async (id) => {
      try { await api("/reports/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) }); toast.success(`Hazard #${id} admitted to the map`); clickPopup.current?.remove(); loadData(false); }
      catch (e) { toast.error((e as Error).message); }
    },
    del: async (id) => {
      if (!(await confirm({ title: `Delete hazard #${id}?`, body: "This permanently removes the pothole, its photos and measurements. It can't be undone.", confirm: "Delete", danger: true }))) return;
      try { await api(`/reports/${id}`, { method: "DELETE" }); toast.success(`Hazard #${id} deleted`); clickPopup.current?.remove(); loadData(false); }
      catch (e) { toast.error((e as Error).message); }
    },
  } : null;

  function clearFocus() { markerRef.current?.remove(); popupRef.current?.remove(); setFocusNote(""); }

  const visible = fc ? fc.features.filter((f) => { const p: any = f.properties; return sev[p.severity] && (!status || p.status === status); }).length : null;
  const chip = (on: boolean) => `badge px-3 py-1.5 border ${on ? "bg-lane border-lane text-asphalt" : "bg-white border-asphalt/20 text-asphalt/70"}`;

  return (
    <section className="space-y-3">
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Map view">
        {(Object.keys(VIEWS) as ViewKey[]).map((k) => (
          <button key={k} aria-pressed={view === k} onClick={() => setView(k)}
            className={`btn !py-1.5 ${view === k ? "bg-asphalt text-white" : "btn-ghost"}`}>{VIEWS[k].label}</button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap items-center text-sm">
        {SEVERITIES.map((s) => <button key={s} aria-pressed={sev[s]} onClick={() => setSev({ ...sev, [s]: !sev[s] })} className={`${chip(sev[s])} capitalize`}>{s}</button>)}
        <select aria-label="Status filter" className="border border-asphalt/20 rounded-lg px-2 py-1.5 bg-white" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <span className="flex gap-1" role="group" aria-label="Layer">
          {([["dots", "Dots"], ["heat", "Heatmap"], ["both", "Both"]] as const).map(([k, lab]) => (
            <button key={k} aria-pressed={layerMode === k} onClick={() => setLayerMode(k)} className={`btn !py-1.5 ${layerMode === k ? "bg-asphalt text-white" : "btn-ghost"}`}>{lab}</button>))}
        </span>
        {isAdmin && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} />Show pending (admin)</label>}
        <button className="btn btn-ghost !py-1.5" onClick={fitAll}>Fit all hazards</button>
        <button className="btn btn-ghost !py-1.5" onClick={() => loadData(false)}>Refresh</button>
      </div>
      {focusNote && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
          <span>{focusNote}</span><button className="underline" onClick={clearFocus}>Clear</button>
        </div>)}
      <div ref={el} className="h-[65vh] rounded-xl border border-asphalt/15 overflow-hidden" />
      <p className="text-sm">
        {error || (visible === null ? "Loading…" : `${visible} of ${fc!.features.length} hazard${fc!.features.length === 1 ? "" : "s"} shown. Colour = severity (green low, amber medium, red high); bigger dots have more reports.`)}
      </p>
      <p className="text-xs text-asphalt/60">3D tip: use two fingers (phone) or right-click and drag (PC) to tilt and rotate. Map data: OpenStreetMap, Esri, CARTO, OpenFreeMap; free tile servers, fine for testing and light use.</p>
    </section>
  );
}
