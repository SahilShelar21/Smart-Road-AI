import { useEffect, useState, type ReactNode } from "react";
import { Camera, ClipboardList, FileText, LayoutDashboard, LogOut, Mail, Map as MapIcon, Route, Settings as SettingsIcon, Users } from "lucide-react";
import { api, getToken, Me, setToken } from "./api";
import Logo from "./components/Logo";
import PageTitle from "./components/PageTitle";
import Login from "./pages/Login";
import Detect from "./pages/Detect";
import Reports from "./pages/Reports";
import MapPage, { type MapFocus } from "./pages/MapPage";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import TripsPage from "./pages/TripsPage";
import SettingsPage from "./pages/SettingsPage";

type View = "admin" | "officer" | "citizen";
type Tab = "dashboard" | "reports" | "assigned" | "mine" | "map" | "detect" | "users" | "trips" | "settings";

const ICONS: Record<Tab, (s: number) => ReactNode> = {
  dashboard: (s) => <LayoutDashboard size={s} />, reports: (s) => <FileText size={s} />, assigned: (s) => <ClipboardList size={s} />,
  mine: (s) => <FileText size={s} />, map: (s) => <MapIcon size={s} />, detect: (s) => <Camera size={s} />,
  users: (s) => <Users size={s} />, trips: (s) => <Route size={s} />, settings: (s) => <SettingsIcon size={s} />,
};
const TABS: Record<View, [Tab, string][]> = {
  admin: [["dashboard", "Dashboard"], ["reports", "All Reports"], ["map", "Map"], ["detect", "Scan Road"], ["users", "Users"], ["settings", "Settings"]],
  officer: [["assigned", "My Assignments"], ["map", "Map"], ["detect", "Scan Road"], ["mine", "My Reports"]],
  citizen: [["detect", "Scan Road"], ["mine", "My Reports"], ["trips", "My Trips"], ["map", "Map"]],
};
const TITLES: Record<Tab, [string, string]> = {
  dashboard: ["Dashboard", "Overview of road hazard detection and repair status"],
  reports: ["All Reports", "Review, admit, assign and close reported hazards"],
  assigned: ["My Assignments", "Repairs assigned to you"],
  mine: ["My Reports", "Hazards you have reported"],
  map: ["Map", "Road, satellite and 3D views of admitted hazards"],
  detect: ["Scan Road", "Detect potholes with your camera or upload a road video"],
  users: ["Users", "Create accounts, change roles and review the audit log"],
  trips: ["My Trips", "Your recorded routes and the potholes found on them"],
  settings: ["Settings", "Repair budget rates and AI training data"],
};

function SideArt() {
  return (
    <div className="mt-auto">
      <svg viewBox="0 0 224 150" className="w-full" aria-hidden="true">
        <path d="M-10 150 C 60 125, 100 70, 240 35" stroke="#1d3f8f" strokeWidth="46" fill="none" />
        <path d="M-10 150 C 60 125, 100 70, 240 35" stroke="#f7b500" strokeWidth="2.5" strokeDasharray="10 9" fill="none" />
      </svg>
      <div className="px-5 pb-6 -mt-2">
        <p className="font-bold leading-snug">Safer Roads<br />Better <span className="text-lane">Tomorrow</span></p>
        <div className="mt-2 h-1 w-14 rounded bg-lane" />
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [viewAs, setViewAs] = useState<View>("admin");
  const [tab, setTab] = useState<Tab | "">("");
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [preset, setPreset] = useState("");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!authed) return;
    api<Me>("/auth/me").then(setMe).catch(() => { setToken(null); setAuthed(false); });
  }, [authed]);

  // admins get a live count of hazards waiting to be admitted
  useEffect(() => {
    if (me?.role !== "admin") return;
    const poll = () => api<{ pending: number }>("/pending-count").then((r) => setPending(r.pending)).catch(() => {});
    poll();
    const t = setInterval(poll, 20000);
    return () => clearInterval(t);
  }, [me?.role, tab]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  if (!me) return <p className="p-4">Loading…</p>;

  // Admins can preview the app as any role; real permissions always stay admin on the server.
  const view: View = me.role === "admin" ? viewAs : me.role;
  const tabs = TABS[view];
  const current: Tab = tabs.some(([id]) => id === tab) ? (tab as Tab) : tabs[0][0];
  const go = (id: Tab) => { setFocus(null); setPreset(""); setTab(id); };
  const switchView = (v: View) => { setViewAs(v); setFocus(null); setPreset(""); setTab(TABS[v][0][0]); };
  const viewOnMap = (lat: number, lng: number, id: number) => { setFocus({ lat, lng, id, nonce: Date.now() }); setTab("map"); };
  const reviewPending = () => { setPreset("pending"); setTab("reports"); };
  const signOut = () => { setToken(null); setAuthed(false); setMe(null); };
  const badge = (id: Tab) => (id === "reports" && view === "admin" && pending > 0
    ? <span className="ml-auto badge bg-red-500 text-white">{pending}</span> : null);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="navy-bg text-white">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 className="text-xl font-bold leading-tight">SmartRoad <span className="text-lane">AI</span></h1>
              <p className="text-xs text-white/70 hidden sm:block">Detect • Map • Repair Road Hazards</p>
            </div>
          </div>
          <div className="text-sm flex items-center gap-4 min-w-0">
            <span className="flex items-center gap-2 min-w-0"><Mail size={18} className="shrink-0" /><span className="truncate max-w-[9rem] sm:max-w-[16rem] font-semibold">{me.email}</span></span>
            <button className="flex items-center gap-1.5 text-white/90 hover:text-white shrink-0" onClick={signOut}><LogOut size={18} /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </div>
      </header>

      {me.role === "admin" && (
        <div className="bg-tar text-white">
          <div className="px-4 md:px-6 py-2 flex items-center gap-2 text-xs overflow-x-auto">
            <span className="text-white/60 shrink-0">View as:</span>
            {(["admin", "officer", "citizen"] as View[]).map((v) => (
              <button key={v} onClick={() => switchView(v)} aria-pressed={view === v}
                className={`badge capitalize px-3 py-1 ${view === v ? "bg-lane text-asphalt" : "bg-white/10 text-white hover:bg-white/20"}`}>{v}</button>
            ))}
            {view !== "admin" && <span className="text-white/60 shrink-0">You are still signed in as admin.</span>}
          </div>
        </div>
      )}

      <div className="flex flex-1">
        <aside className="hidden md:flex flex-col w-60 shrink-0 side-bg text-white pt-5">
          <nav className="px-3 space-y-1.5">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => go(id)} aria-current={current === id ? "page" : undefined}
                className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-left transition ${current === id ? "bg-gradient-to-r from-amber-300 to-amber-500 text-asphalt font-semibold shadow" : "text-white/85 hover:bg-white/10"}`}>
                {ICONS[id](18)}{label}{badge(id)}
              </button>
            ))}
          </nav>
          <SideArt />
        </aside>

        <main className="flex-1 min-w-0 p-4 md:p-6">
          <nav className="md:hidden flex gap-2 mb-4 overflow-x-auto pb-1">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => go(id)}
                className={`btn whitespace-nowrap ${current === id ? "bg-gradient-to-r from-amber-300 to-amber-500 text-asphalt" : "bg-white border border-asphalt/15 text-asphalt/80"}`}>{ICONS[id](16)}{label}{badge(id)}</button>
            ))}
          </nav>
          {current !== "dashboard" && <PageTitle title={TITLES[current][0]} subtitle={TITLES[current][1]} icon={ICONS[current](28)} />}
          {current === "detect" && <Detect />}
          {current === "map" && <MapPage focus={focus} isAdmin={view === "admin"} />}
          {current === "dashboard" && <Dashboard onReview={reviewPending} />}
          {current === "users" && <Admin />}
          {current === "trips" && <TripsPage />}
          {current === "settings" && <SettingsPage />}
          {current === "reports" && <Reports key={`all-${preset}`} scope="all" onViewMap={viewOnMap} initialApproval={preset} />}
          {current === "assigned" && <Reports key="assigned" scope="assigned" onViewMap={viewOnMap} />}
          {current === "mine" && <Reports key="mine" scope="mine" onViewMap={viewOnMap} />}
        </main>
      </div>
    </div>
  );
}
