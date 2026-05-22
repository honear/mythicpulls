import { CollectionBinder } from "./CollectionBinder";

export const metadata = {
  title: "Binder · Mythic Pulls",
  description: "Every card you've pulled, kept in your local binder.",
};

export default function CollectionPage() {
  return (
    <div className="mx-auto max-w-7xl w-full px-6 pt-28 md:pt-32 pb-16">
      <header className="mb-10">
        <p className="label-caps text-[var(--color-ink-muted)]">Your binder</p>
        <h1 className="font-display text-[2.2rem] md:text-6xl text-[var(--color-fg)] mt-2 leading-[0.95] balance">
          Every pull, kept{" "}
          <span className="ai-grad">in one place.</span>
        </h1>
        <p className="mt-3 text-[var(--color-ink)] max-w-xl">
          Stored locally in this browser — no account, no sync, no buyer&apos;s remorse.
        </p>
      </header>
      <CollectionBinder />
    </div>
  );
}
