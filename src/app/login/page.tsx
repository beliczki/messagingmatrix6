"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type LookAndFeel = {
  pageTitle?: string;
  headerColor?: string;
  buttonColor?: string;
  fontFamily?: string;
  cobranding?: { enabled?: boolean; logoUrl?: string };
};

type PublicConfig = {
  clientKey: string;
  clientName: string;
  lookAndFeel: LookAndFeel;
};

export default function LoginPage() {
  const router = useRouter();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/config-public")
      .then((r) => r.json())
      .then(setConfig);
  }, []);

  useEffect(() => {
    if (!config) return;
    const root = document.documentElement;
    if (config.lookAndFeel.headerColor) {
      root.style.setProperty("--color-primary", config.lookAndFeel.headerColor);
    }
    if (config.lookAndFeel.buttonColor) {
      root.style.setProperty("--color-button", config.lookAndFeel.buttonColor);
    }
    if (config.lookAndFeel.pageTitle) {
      document.title = config.lookAndFeel.pageTitle;
    }
  }, [config]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error === "invalid_credentials" ? "Invalid email or password" : "Sign-in failed");
      return;
    }
    router.push("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/40 bg-white/70 p-8 shadow-xl backdrop-blur">
        <div className="mb-6 text-center">
          {config?.lookAndFeel.cobranding?.enabled && config.lookAndFeel.cobranding.logoUrl ? (
            <img
              src={config.lookAndFeel.cobranding.logoUrl}
              alt={config.clientName}
              className="mx-auto mb-3 h-10"
            />
          ) : null}
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-primary)" }}>
            {config?.lookAndFeel.pageTitle ?? "MessagingMatrix"}
          </h1>
          {config ? (
            <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
              {config.clientName}
            </p>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
            style={{ backgroundColor: "var(--color-button, #2563eb)" }}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
