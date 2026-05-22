"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** MP4 source. If omitted, the component renders nothing — pair with a CSS backdrop. */
  src?: string;
  /** Seconds of fade-in at the start and fade-out at the end. */
  fadeSeconds?: number;
  /** Milliseconds to wait between an end and the next replay. */
  gapMs?: number;
  className?: string;
};

/**
 * Plays a video once, fades it in over the first `fadeSeconds` and out over
 * the last `fadeSeconds`. On 'ended', opacity resets to 0, waits `gapMs`, and
 * the cycle restarts. Mirrors the Hero.html design spec.
 */
export default function FadeLoopVideoBg({
  src,
  fadeSeconds = 0.5,
  gapMs = 100,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!src) return;
    const video = videoRef.current;
    if (!video) return;

    let rafId = 0;

    const tick = () => {
      const dur = video.duration;
      const t = video.currentTime;
      if (Number.isFinite(dur) && dur > 0) {
        let op = 1;
        if (t < fadeSeconds) op = Math.max(0, t / fadeSeconds);
        else if (t > dur - fadeSeconds) op = Math.max(0, (dur - t) / fadeSeconds);
        video.style.opacity = String(op);
      }
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    };

    const onLoaded = () => {
      video.currentTime = 0;
      video.style.opacity = "0";
      video.play().catch(() => {});
      start();
    };

    const onEnded = () => {
      cancelAnimationFrame(rafId);
      video.style.opacity = "0";
      window.setTimeout(() => {
        try {
          video.currentTime = 0;
        } catch {}
        video.play().catch(() => {});
        start();
      }, gapMs);
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("ended", onEnded);
    if (video.readyState >= 1) onLoaded();

    return () => {
      cancelAnimationFrame(rafId);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("ended", onEnded);
    };
  }, [src, fadeSeconds, gapMs]);

  if (!src) return null;

  return (
    <video
      ref={videoRef}
      src={src}
      className={className ?? "absolute inset-0 w-full h-full object-cover"}
      style={{ opacity: 0 }}
      muted
      playsInline
      preload="auto"
      crossOrigin="anonymous"
    />
  );
}
