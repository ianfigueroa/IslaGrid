"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BatteryCharging, Building2, Languages, MessageSquareWarning, RefreshCw, Wifi, WifiOff, Zap } from "lucide-react";
import { SHELTERS, SHELTER_DISCLAIMER } from "@/lib/shelters";

type Lang = "en" | "es";

const STR = {
  appTag: { en: "disaster", es: "emergencia" },
  online: { en: "online", es: "en línea" },
  offline: { en: "offline", es: "sin conexión" },
  refresh: { en: "Refresh", es: "Actualizar" },
  amIAtRisk: { en: "Am I at risk?", es: "¿Estoy en riesgo?" },
  reasonsLead: { en: "Reasons", es: "Razones" },
  noSnap: {
    en: "No grid snapshot cached yet. Open this page once with a connection so it can save a copy for the next outage.",
    es: "Aún no hay datos guardados. Abre esta página con conexión al menos una vez para que se guarde una copia para el próximo apagón.",
  },
  netError: { en: "Network error", es: "Error de red" },
  cachedFrom: { en: "Showing cached snapshot from", es: "Mostrando datos guardados de hace" },
  minAgo: { en: "min ago", es: "min" },
  recentOutages: { en: "Recent outage events (48h)", es: "Eventos recientes (48 h)" },
  noRecent: {
    en: "No reported events in the last 48 hours.",
    es: "No hay eventos reportados en las últimas 48 horas.",
  },
  quickActions: { en: "Quick actions", es: "Acciones rápidas" },
  report: { en: "Report what you see", es: "Reportar lo que ves" },
  batteryAdvice: { en: "Battery advice", es: "Guía de baterías" },
  shelters: { en: "Refuges nearby", es: "Refugios cercanos" },
  footer: {
    en: "Disaster mode caches this page so it loads with no signal. Numbers may be stale — refresh when you get connectivity.",
    es: "Este modo guarda la página para que cargue sin señal. Los datos pueden estar atrasados — actualiza cuando tengas conexión.",
  },
  numbersUnavailable: {
    en: "Numbers temporarily unavailable.",
    es: "Datos no disponibles temporalmente.",
  },
  toggleLang: { en: "Español", es: "English" },
};

function t(lang: Lang, key: keyof typeof STR): string {
  return STR[key][lang];
}

interface SnapshotPayload {
  grid:
    | {
        ts: string;
        current_demand_mw: number | null;
        total_generation_mw: number | null;
        operational_reserve_mw: number | null;
        status: string;
        status_reasons: string[];
        source: string;
      }
    | null;
  planned_work: Array<{
    id: string;
    municipality_id: string | null;
    area: string | null;
    work_type: string | null;
    start_ts: string | null;
    end_ts: string | null;
    possible_interruption: boolean | null;
  }>;
  outage_events: Array<{
    id: string;
    municipality_id: string | null;
    started_at: string;
    ended_at: string | null;
    kind: string;
    snippet: string | null;
  }>;
  updates: Array<{
    id: string;
    ts: string;
    source: string;
    category: string | null;
    text: string;
    url: string | null;
  }>;
  ts: string;
  reason?: string;
  offline?: boolean;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const ageSec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
  return `${Math.round(ageSec / 86400)}d ago`;
}

export function DisasterClient() {
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Spanish-first preference is persisted so users only set it once. Default
  // to Spanish on PR-locale browsers (navigator.language starts with "es").
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("islagrid-disaster-lang");
      if (stored === "en" || stored === "es") {
        setLang(stored);
        return;
      }
    } catch {
      /* private mode */
    }
    if (typeof navigator !== "undefined" && navigator.language?.startsWith("es")) {
      setLang("es");
    }
  }, []);

  const toggleLang = () => {
    const next = lang === "en" ? "es" : "en";
    setLang(next);
    try {
      localStorage.setItem("islagrid-disaster-lang", next);
    } catch {
      /* ignore */
    }
  };

  // Register service worker for offline.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: just means offline mode won't work this visit.
    });
  }, []);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/disaster/snapshot", { cache: "no-store" });
      const body = (await res.json()) as SnapshotPayload;
      setSnapshot(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const cachedAt = snapshot?.ts;
  const cachedAgeMin = cachedAt
    ? Math.round((Date.now() - new Date(cachedAt).getTime()) / 60000)
    : null;

  const grid = snapshot?.grid ?? null;
  const status = grid?.status ?? "unknown";
  const recentOutages = useMemo(
    () => (snapshot?.outage_events ?? []).filter((o) => o.kind !== "restored").slice(0, 6),
    [snapshot],
  );

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="size-5 text-warn" aria-hidden />
          <span className="font-mono text-sm tracking-tight text-text">
            IslaGrid<span className="text-text-3">/{t(lang, "appTag")}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {online ? (
            <span className="inline-flex items-center gap-1 text-ok">
              <Wifi className="size-3" aria-hidden /> {t(lang, "online")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-warn">
              <WifiOff className="size-3" aria-hidden /> {t(lang, "offline")}
            </span>
          )}
          <button
            type="button"
            onClick={toggleLang}
            aria-label={`Switch language to ${STR.toggleLang[lang]}`}
            className="inline-flex min-h-12 min-w-12 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Languages className="size-3" aria-hidden />
            <span className="font-mono text-[10px]">{lang === "en" ? "ES" : "EN"}</span>
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label={t(lang, "refresh")}
            className="min-h-12 min-w-12 cursor-pointer rounded-md border border-line p-2 text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>

      <section className="mt-4 surface rounded-xl p-4">
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-3">
          {t(lang, "amIAtRisk")}
        </p>
        {grid ? (
          <>
            <p
              className={`mt-1 font-mono text-2xl uppercase ${
                status === "critical"
                  ? "text-crit"
                  : status === "strained"
                    ? "text-orange-500"
                    : status === "watch"
                      ? "text-warn"
                      : status === "normal"
                        ? "text-ok"
                        : "text-text-3"
              }`}
            >
              {status}
            </p>
            <p className="mt-1 text-xs text-text-2">
              {grid.current_demand_mw && grid.total_generation_mw
                ? `Demand ${Math.round(grid.current_demand_mw).toLocaleString()} MW · Generation ${Math.round(grid.total_generation_mw).toLocaleString()} MW · Reserves ${Math.round(grid.operational_reserve_mw ?? 0).toLocaleString()} MW`
                : t(lang, "numbersUnavailable")}
            </p>
            {grid.status_reasons?.length > 0 ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-text-2">
                {grid.status_reasons.slice(0, 3).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[10px] text-text-3">
              {grid.source} · {timeAgo(grid.ts)}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-text-3">{t(lang, "noSnap")}</p>
        )}
        {error ? (
          <p className="mt-2 text-[11px] text-warn">{t(lang, "netError")}: {error}</p>
        ) : null}
        {cachedAgeMin != null && !online ? (
          <p className="mt-2 inline-block rounded-md border border-warn/30 bg-warn/10 px-2 py-0.5 text-[10px] text-warn">
            {t(lang, "cachedFrom")} {cachedAgeMin} {t(lang, "minAgo")}
          </p>
        ) : null}
      </section>

      <section className="mt-4 surface rounded-xl p-4">
        <header className="flex items-center justify-between">
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-3">
            {t(lang, "recentOutages")}
          </p>
          <span className="font-mono text-[10px] text-text-3">
            {recentOutages.length}
          </span>
        </header>
        {recentOutages.length === 0 ? (
          <p className="mt-2 text-sm text-text-3">{t(lang, "noRecent")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {recentOutages.map((o) => (
              <li key={o.id} className="py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="capitalize text-text">{o.kind}</span>
                  <span className="font-mono text-[10px] text-text-3">
                    {timeAgo(o.started_at)}
                  </span>
                </div>
                {o.snippet ? (
                  <p className="text-[11px] text-text-2">{o.snippet}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 surface rounded-xl p-4">
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-3">
          {t(lang, "quickActions")}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <a
            href="/?layers=municipalities,reports"
            className="flex min-h-12 items-center gap-2 rounded-md border border-line bg-surface p-3 text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <MessageSquareWarning className="size-4 text-warn" aria-hidden />
            {t(lang, "report")}
          </a>
          <a
            href="/battery"
            className="flex min-h-12 items-center gap-2 rounded-md border border-line bg-surface p-3 text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <BatteryCharging className="size-4 text-brand" aria-hidden />
            {t(lang, "batteryAdvice")}
          </a>
        </div>
      </section>

      <section className="mt-4 surface rounded-xl p-4">
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-3">
          {t(lang, "shelters")}
        </p>
        <ul className="mt-2 divide-y divide-line">
          {SHELTERS.map((s) => (
            <li key={s.name} className="flex items-start gap-2 py-2 text-sm">
              <Building2 className="mt-0.5 size-4 shrink-0 text-text-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text">{s.name}</p>
                <p className="text-[11px] text-text-2">
                  {s.municipality} · {s.address}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 inline-flex items-start gap-1.5 text-[10px] text-text-3">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {SHELTER_DISCLAIMER}
        </p>
      </section>

      <footer className="mt-6 text-center text-[10px] text-text-3">
        {t(lang, "footer")}
      </footer>
    </div>
  );
}
