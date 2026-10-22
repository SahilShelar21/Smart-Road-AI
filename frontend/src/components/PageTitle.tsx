import type { ReactNode } from "react";

export default function PageTitle({ title, subtitle, icon, right }: { title: string; subtitle?: string; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <div className="flex items-center gap-4">
        {icon && <div className="w-14 h-14 rounded-2xl bg-blue-100 text-signal grid place-items-center shrink-0">{icon}</div>}
        <div>
          <h2 className="text-2xl font-bold leading-tight">{title}</h2>
          {subtitle && <p className="text-sm text-asphalt/70">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
