"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, MessageSquare, Mail } from "lucide-react";

interface Prefs {
  smsEnabled: boolean;
  emailEnabled: boolean;
  phone: string;
  email: string;
  triggerStateChange: boolean;
  triggerStorm: boolean;
  triggerPlannedWork: boolean;
}

const DEFAULT_PREFS: Prefs = {
  smsEnabled: false,
  emailEnabled: false,
  phone: "",
  email: "",
  triggerStateChange: true,
  triggerStorm: true,
  triggerPlannedWork: false,
};

const STORAGE_KEY = "islagrid-notif-prefs-v1";

/**
 * Stub UI: collects opt-in prefs and saves them locally. SMS sending is
 * gated server-side on TWILIO_* envs that aren't set yet — when the user
 * hits "save" we display the honest "stored locally; not sending until ops
 * provisions Twilio" state instead of pretending we wired it up.
 */
export function NotificationsClient() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Prefs) });
    } catch {
      /* ignore */
    }
  }, []);

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    setSavedAt(Date.now());
  }

  const smsValid = prefs.smsEnabled
    ? /^\+?[0-9\s\-()]{7,}$/.test(prefs.phone)
    : true;
  const emailValid = prefs.emailEnabled
    ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(prefs.email)
    : true;
  const canSave =
    smsValid &&
    emailValid &&
    (prefs.smsEnabled || prefs.emailEnabled) &&
    (prefs.triggerStateChange || prefs.triggerStorm || prefs.triggerPlannedWork);

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="surface rounded-xl p-5">
        <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 p-3 text-[12px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            SMS delivery is <strong>not yet wired</strong>. We&rsquo;ll save
            your preferences locally; once the Twilio integration ships
            you&rsquo;ll receive an opt-in confirmation text. No charges are
            incurred today.
          </p>
        </div>

        <div className="mt-4 space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={prefs.smsEnabled}
              onChange={(e) => update("smsEnabled", e.target.checked)}
              className="mt-1 size-4"
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <MessageSquare className="size-4 text-text-2" aria-hidden />
                SMS digests
              </span>
              <span className="block text-[11px] text-text-3">
                Max 2 messages per hour. Reply STOP to opt out at any time.
              </span>
            </span>
          </label>
          {prefs.smsEnabled ? (
            <div className="ml-7">
              <label
                htmlFor="phone"
                className="block text-[11px] text-text-3"
              >
                Phone number (international format)
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                placeholder="+1 787 555 0123"
                value={prefs.phone}
                onChange={(e) => update("phone", e.target.value)}
                className="mt-1 min-h-12 w-full max-w-sm rounded-md border border-line bg-surface px-3 text-sm"
              />
              {!smsValid ? (
                <p className="mt-1 text-[11px] text-warn">
                  That doesn&rsquo;t look like a phone number.
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={prefs.emailEnabled}
              onChange={(e) => update("emailEnabled", e.target.checked)}
              className="mt-1 size-4"
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Mail className="size-4 text-text-2" aria-hidden />
                Email digests
              </span>
              <span className="block text-[11px] text-text-3">
                Daily summary; immediate notice only for storm advisories
                affecting your municipality.
              </span>
            </span>
          </label>
          {prefs.emailEnabled ? (
            <div className="ml-7">
              <label htmlFor="email" className="block text-[11px] text-text-3">
                Email address
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={prefs.email}
                onChange={(e) => update("email", e.target.value)}
                className="mt-1 min-h-12 w-full max-w-sm rounded-md border border-line bg-surface px-3 text-sm"
              />
              {!emailValid ? (
                <p className="mt-1 text-[11px] text-warn">
                  That doesn&rsquo;t look like an email address.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="surface rounded-xl p-5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-3">
          Send me a digest when
        </p>
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={prefs.triggerStateChange}
              onChange={(e) => update("triggerStateChange", e.target.checked)}
              className="mt-1 size-4"
            />
            <span>
              <span className="font-medium">Grid status changes</span>
              <span className="block text-[11px] text-text-3">
                NORMAL ↔ WATCH ↔ STRAINED ↔ CRITICAL transitions.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={prefs.triggerStorm}
              onChange={(e) => update("triggerStorm", e.target.checked)}
              className="mt-1 size-4"
            />
            <span>
              <span className="font-medium">Tropical-cyclone threat</span>
              <span className="block text-[11px] text-text-3">
                NHC issues an advisory whose forecast cone touches PR.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={prefs.triggerPlannedWork}
              onChange={(e) => update("triggerPlannedWork", e.target.checked)}
              className="mt-1 size-4"
            />
            <span>
              <span className="font-medium">Planned work in your area</span>
              <span className="block text-[11px] text-text-3">
                Off by default. Requires location consent.
              </span>
            </span>
          </label>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {savedAt ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-ok">
            <Check className="size-4" aria-hidden />
            Saved locally.
          </span>
        ) : null}
        <button
          type="submit"
          disabled={!canSave}
          className="min-h-12 rounded-md bg-brand px-5 py-2 text-sm font-medium text-bg transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-text-2"
        >
          Save preferences
        </button>
      </div>
    </form>
  );
}
