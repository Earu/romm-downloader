"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/icons";

export function LoginForm({ defaultUrl, pinned = false }: { defaultUrl: string; pinned?: boolean }) {
  const router = useRouter();
  const [rommUrl, setRommUrl] = useState(defaultUrl || "http://localhost:8080");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rommUrl, username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const field = (label: string) => (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-steam-muted">
      {label}
    </span>
  );

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="steam-panel w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center justify-center gap-2.5">
          <Logo className="h-7 w-7 text-steam-bright" />
          <span className="text-lg font-bold tracking-tight text-steam-bright">
            RomM <span className="text-steam-blue-light">Downloader</span>
          </span>
        </div>
        <p className="text-center text-xs text-steam-muted">Sign in with your RomM account.</p>

        <label className="block">
          {field("RomM URL")}
          <input
            value={rommUrl}
            onChange={(e) => setRommUrl(e.target.value)}
            placeholder="http://localhost:8080"
            disabled={pinned}
            readOnly={pinned}
            aria-disabled={pinned}
            title={pinned ? "Managed by your administrator" : undefined}
            className={`steam-input w-full ${
              pinned ? "cursor-not-allowed opacity-60" : ""
            }`}
          />
          {pinned && (
            <span className="mt-1 flex items-center gap-1 text-xs text-steam-muted">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 1a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V5a4 4 0 0 0-4-4Zm2 6V5a2 2 0 1 0-4 0v2h4Z"
                  clipRule="evenodd"
                />
              </svg>
              Managed by your administrator
            </span>
          )}
        </label>
        <label className="block">
          {field("Username")}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="steam-input w-full"
          />
        </label>
        <label className="block">
          {field("Password")}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="steam-input w-full"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || !username || !password || !rommUrl}
          className="steam-btn-primary w-full justify-center"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
