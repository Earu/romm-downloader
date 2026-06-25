"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconTrash } from "@/components/icons";

export function UninstallButton({ romId, name }: { romId: number; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const uninstall = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/roms/${romId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const danger =
    "inline-flex cursor-pointer items-center justify-center gap-2 border-0 bg-[#a93226] px-6 py-2.5 text-[15px] font-semibold text-white transition hover:bg-[#c0392b] disabled:cursor-not-allowed disabled:opacity-50";

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className={danger}>
        <IconTrash className="h-4 w-4" />
        Uninstall
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-steam-text">
        Remove <span className="font-semibold">{name}</span> from RomM and delete its file?
      </p>
      <div className="flex items-center gap-2">
        <button onClick={uninstall} disabled={busy} className={danger}>
          {busy ? "Uninstalling…" : "Yes, uninstall"}
        </button>
        <button onClick={() => setConfirming(false)} disabled={busy} className="steam-btn">
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
