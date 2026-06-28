"use client";

import { useEffect, useRef, useState } from "react";
import { IconServer, IconX, Spinner } from "@/components/icons";

interface Track {
  state: string;
  progress: number;
  error: string | null;
  rommUrl: string | null;
}

/**
 * Tracks one download job from the (info-only) game page opened via a download's
 * cover. While the install runs it shows live progress; once RomM has the game it
 * becomes a button linking straight to that game's page on the RomM server.
 */
export function InstallTracker({ jobId }: { jobId: string }) {
  const [track, setTrack] = useState<Track | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    const stop = () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
    const load = async () => {
      try {
        const res = await fetch(`/api/downloads/${jobId}/track`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Track;
        if (!active) return;
        setTrack(data);
        // Nothing left to watch for once it failed or it's installed and linkable.
        if (data.state === "failed" || (data.state === "done" && data.rommUrl)) stop();
      } catch {
        /* transient network blip — keep polling */
      }
    };
    void load();
    timer.current = setInterval(load, 2000);
    return () => {
      active = false;
      stop();
    };
  }, [jobId]);

  if (!track) {
    return (
      <div className="flex items-center gap-2 text-sm text-steam-muted">
        <Spinner className="h-4 w-4" /> Checking download…
      </div>
    );
  }

  if (track.state === "failed") {
    return (
      <div className="space-y-1">
        <span className="inline-flex items-center gap-2 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-400">
          <IconX className="h-4 w-4" /> Download failed
        </span>
        {track.error && <p className="max-w-xl text-xs text-steam-muted">{track.error}</p>}
      </div>
    );
  }

  if (track.state === "done") {
    if (track.rommUrl) {
      return (
        <a
          href={track.rommUrl}
          target="_blank"
          rel="noreferrer"
          className="steam-btn-green inline-flex w-fit items-center gap-2 px-4 py-2"
        >
          <IconServer className="h-4 w-4" /> View in RomM
        </a>
      );
    }
    // Installed, but RomM hasn't surfaced it yet — keep waiting for the link.
    return (
      <div className="flex items-center gap-2 text-sm text-steam-muted">
        <Spinner className="h-4 w-4" /> Installed — opening in RomM…
      </div>
    );
  }

  // Still running.
  const label = track.state === "uploading" ? "Installing…" : "Downloading…";
  return (
    <div className="w-full max-w-sm space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-steam-text">
          <Spinner className="h-4 w-4 text-steam-blue-light" /> {label}
        </span>
        <span className="tabular-nums text-steam-muted">{track.progress}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden bg-black/50">
        <div
          className="h-full bg-steam-blue transition-all"
          style={{ width: `${track.progress}%` }}
        />
      </div>
    </div>
  );
}
