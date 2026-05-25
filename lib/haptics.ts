/**
 * Tiny haptic-feedback wrappers around the Vibration API.
 *
 * Browser support:
 *   - Chrome on Android: full support
 *   - Firefox on Android: supported
 *   - iOS Safari (mobile): NOT supported — `navigator.vibrate` exists
 *     but is a no-op. Apple intentionally doesn't expose haptics via
 *     the web platform yet.
 *   - All desktop browsers: not supported (`navigator.vibrate` either
 *     missing or a no-op)
 *
 * That means these calls are best-effort — they trigger a real tap
 * on Android, nothing on iOS / desktop. Safe to call from any client
 * code; the no-op fallback won't throw.
 */

/** A short tap — used for long-press fire, pick confirmations, and
 *  other "I got the thing" moments where the user just performed a
 *  deliberate action. 10ms is the conventional brief-tap duration. */
export function hapticTap(): void {
  vibrate(10);
}

/** A slightly heavier confirmation — used when something more
 *  consequential happens (saving to binder, completing a draft round).
 *  20ms reads as a "thunk" rather than the 10ms "tick" of hapticTap. */
export function hapticConfirm(): void {
  vibrate(20);
}

function vibrate(ms: number): void {
  if (typeof navigator === "undefined") return;
  // The vibrate API is on Navigator but TS DOM lib types it as
  // optional + Iterable<number>-only in some configs. Bind the
  // method through a permissive shape so the call typechecks
  // regardless of which DOM-lib variant is in scope.
  const n = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof n.vibrate !== "function") return;
  try {
    n.vibrate(ms);
  } catch {
    // Some browsers throw if vibrate is called too often or outside
    // a user-gesture context. Swallow — it's strictly best-effort.
  }
}
