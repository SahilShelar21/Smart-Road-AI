import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error" | "info";
type ToastItem = { id: number; kind: Kind; text: string };
type ToastApi = { success: (t: string) => void; error: (t: string) => void; info: (t: string) => void };
type ConfirmOpts = { title: string; body?: string; confirm?: string; danger?: boolean };

const ToastCtx = createContext<ToastApi>({ success() {}, error() {}, info() {} });
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useToast = () => useContext(ToastCtx);
export const useConfirm = () => useContext(ConfirmCtx);

const STYLE: Record<Kind, string> = {
  success: "bg-green-700 text-white",
  error: "bg-red-700 text-white",
  info: "bg-asphalt text-white border-l-4 border-lane",
};

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const [dlg, setDlg] = useState<{ opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);

  const push = useCallback((kind: Kind, text: string) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const toast = useMemo<ToastApi>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t), info: (t) => push("info", t) }), [push]);
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDlg({ opts, resolve })), []);
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null); };

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-80 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div key={t.id} role={t.kind === "error" ? "alert" : "status"}
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              className={`pointer-events-auto cursor-pointer rounded-md shadow-lg px-4 py-3 text-sm ${STYLE[t.kind]}`}>
              {t.text}
            </div>
          ))}
        </div>
        {dlg && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onKeyDown={(e) => e.key === "Escape" && close(false)}>
            <div role="alertdialog" aria-modal="true" aria-label={dlg.opts.title} className="card p-5 max-w-sm w-full space-y-3">
              <h2 className="font-semibold text-lg">{dlg.opts.title}</h2>
              {dlg.opts.body && <p className="text-sm text-asphalt/80">{dlg.opts.body}</p>}
              <div className="flex justify-end gap-2">
                <button autoFocus className="btn btn-ghost" onClick={() => close(false)}>Cancel</button>
                <button className={`btn ${dlg.opts.danger ? "bg-red-700 text-white hover:bg-red-800" : "btn-primary"}`} onClick={() => close(true)}>{dlg.opts.confirm ?? "Confirm"}</button>
              </div>
            </div>
          </div>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
