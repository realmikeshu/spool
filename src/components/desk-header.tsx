import { Link } from "@tanstack/react-router";
import { Film, Megaphone } from "lucide-react";

export type DeskMode = "social" | "ads";

export function DeskHeader({ mode }: { mode: DeskMode }) {
  const social = mode === "social";
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-21 px-4 py-21 sm:flex-row sm:items-center lg:px-34">
        <div className="flex min-w-0 items-center gap-21">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-bg">
            {social ? <Film className="size-5" aria-hidden="true" /> : <Megaphone className="size-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-mast tracking-tight text-balance">Spool</h1>
            <p className="mt-13 text-sm text-pretty text-muted">
              {social
                ? "Social desk. Competitor Reels, TikToks, and Shorts, saved so you can study the cut."
                : "Ads desk. The same links, read as paid creative: offer, proof, and the ask."}
            </p>
          </div>
        </div>
        <nav aria-label="Desk" className="flex w-full rounded-xl border border-border p-1 sm:ml-auto sm:w-auto">
          <ModeTab mode="social" current={mode}>
            Social
          </ModeTab>
          <ModeTab mode="ads" current={mode}>
            Ads
          </ModeTab>
        </nav>
      </div>
    </header>
  );
}

function ModeTab({ mode, current, children }: { mode: DeskMode; current: DeskMode; children: string }) {
  const on = mode === current;
  return (
    <Link
      to="/"
      search={{ mode }}
      aria-current={on ? "page" : undefined}
      className={
        on
          ? "inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-bg sm:flex-none"
          : "inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-medium text-muted sm:flex-none"
      }
    >
      {children}
    </Link>
  );
}
