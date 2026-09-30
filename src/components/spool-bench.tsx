import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Film, Image as ImageIcon, Loader2, Music2, Square } from "lucide-react";
import { DeskHeader } from "@/components/desk-header";
import {
  blankStudy,
  captionFile,
  clipSlug,
  extractUrls,
  formatDuration,
  mediaHref,
  studyFile,
  type Clip,
  type ClipResult,
  type Platform,
  type Study,
} from "@/lib/media/shared";

const HISTORY_KEY = "spool.recent.v1";

type Recent = {
  sourceUrl: string;
  platform: Platform;
  title: string;
  handle: string;
  savedAt: number;
};

type Row = {
  url: string;
  state: "loading" | "done";
  result?: ClipResult;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecent(value: unknown): value is Recent {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Recent>;
  return (
    typeof row.sourceUrl === "string" &&
    (row.platform === "tiktok" || row.platform === "instagram" || row.platform === "youtube") &&
    typeof row.title === "string" &&
    typeof row.handle === "string" &&
    typeof row.savedAt === "number"
  );
}

function loadRecent(): Recent[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, 20);
  } catch {
    return [];
  }
}

function triggerDownload(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function saveResponse(url: string, filename: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.replace(/\s+/g, " ").trim().slice(0, 240) || "Download failed.");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  triggerDownload(href, filename);
  setTimeout(() => URL.revokeObjectURL(href), 8000);
}

function paceAfter(url: string): number {
  if (/tiktok\.com/i.test(url)) return 1100;
  if (/youtube\.com|youtu\.be/i.test(url)) return 800;
  return 250;
}

function platformLabel(platform: Platform): string {
  if (platform === "tiktok") return "TikTok";
  if (platform === "youtube") return "YouTube";
  return "Instagram";
}

export function SpoolBench() {
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [running, setRunning] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [studies, setStudies] = useState<Record<string, Study>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const parsed = useMemo(() => extractUrls(draft), [draft]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  function remember(clip: Clip) {
    const next: Recent = {
      sourceUrl: clip.sourceUrl,
      platform: clip.platform,
      title: clip.title,
      handle: clip.handle,
      savedAt: Date.now(),
    };
    setRecent((current) => {
      const merged = [next, ...current.filter((item) => item.sourceUrl !== next.sourceUrl)].slice(0, 20);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
      return merged;
    });
  }

  function clearRecent() {
    localStorage.removeItem(HISTORY_KEY);
    setRecent([]);
  }

  async function fetchOne(url: string, signal: AbortSignal): Promise<ClipResult> {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
    const text = await response.text();
    try {
      const data = JSON.parse(text) as ClipResult;
      if (data && typeof data === "object" && "ok" in data) return data;
    } catch {
      /* fall through */
    }
    return { ok: false, sourceUrl: url, error: "Spool could not read that link." };
  }

  async function run(list?: string[]) {
    const urls = list ?? parsed.urls;
    if (!urls.length || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setNotice(null);
    setRows(urls.map((url) => ({ url, state: "loading" })));
    for (let index = 0; index < urls.length; index += 1) {
      if (controller.signal.aborted) break;
      const url = urls[index] ?? "";
      if (index > 0) await sleep(paceAfter(urls[index - 1] ?? ""));
      if (controller.signal.aborted) break;
      try {
        const result = await fetchOne(url, controller.signal);
        if (result.ok) remember(result);
        setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { url, state: "done", result } : row)));
      } catch (error) {
        if (controller.signal.aborted) break;
        const message = error instanceof Error ? error.message : "Could not open that link.";
        setRows((current) =>
          current.map((row, rowIndex) =>
            rowIndex === index ? { url, state: "done", result: { ok: false, sourceUrl: url, error: message } } : row,
          ),
        );
      }
    }
    if (controller.signal.aborted) {
      setRows((current) =>
        current.map((row) =>
          row.state === "loading"
            ? { ...row, state: "done", result: { ok: false, sourceUrl: row.url, error: "Stopped." } }
            : row,
        ),
      );
    }
    setRunning(false);
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function readCut(clip: Clip) {
    if (busyKey) return;
    setBusyKey(`${clip.sourceUrl}:read`);
    setNotice(null);
    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clip),
      });
      const text = await response.text();
      let data: { ok?: boolean; study?: Study; error?: string } = {};
      try {
        data = JSON.parse(text) as { ok?: boolean; study?: Study; error?: string };
      } catch {
        data = {};
      }
      if (data.ok && data.study?.filled) {
        setStudies((current) => ({ ...current, [clip.sourceUrl]: data.study as Study }));
      } else {
        setNotice(data.error || "Could not write the study notes.");
      }
    } catch {
      setNotice("Could not write the study notes.");
    } finally {
      setBusyKey(null);
    }
  }

  async function savePack(clip: Clip) {
    const slug = clipSlug(clip);
    const key = `${clip.sourceUrl}:pack`;
    setBusyKey(key);
    setNotice(null);
    const study = studies[clip.sourceUrl];
    try {
      await saveResponse("/api/pack", `${slug}.zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...clip,
          filename: slug,
          studyText: studyFile(clip, study?.filled ? study : blankStudy()),
        }),
      });
      setNotice(study?.filled ? `Saved ${slug}.zip` : `Saved ${slug}.zip. Read the cut first if you want notes in the pack.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not build that pack.");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveAudio(clip: Clip) {
    const slug = clipSlug(clip);
    const key = `${clip.sourceUrl}:audio`;
    setBusyKey(key);
    setNotice(null);
    try {
      if (clip.audioUrl) {
        triggerDownload(mediaHref(clip.audioUrl, `${slug}-audio.mp3`, false), `${slug}-audio.mp3`);
      } else {
        const params = new URLSearchParams({ u: clip.videoUrl, name: `${slug}-audio.aac` });
        await saveResponse(`/api/audio?${params.toString()}`, `${slug}-audio.aac`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the audio.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <DeskHeader mode="social" />

      <div className="desk">
        <div className="flex min-w-0 flex-col gap-21">
          <form
            className="panel rounded-3xl bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <label htmlFor="links" className="px-2 pt-1 text-sm font-medium">
              Links
            </label>
            <textarea
              id="links"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void run();
                }
              }}
              rows={6}
              spellCheck={false}
              placeholder={"Paste one link per line\nhttps://www.instagram.com/reel/\u2026\nhttps://www.tiktok.com/@\u2026/video/\u2026\nhttps://www.youtube.com/shorts/\u2026"}
              className="mt-2 w-full resize-y rounded-2xl border border-border bg-bg px-4 py-3 text-base leading-normal text-fg outline-none placeholder:text-muted focus:border-primary"
            />
            <div className="flex flex-wrap items-center gap-3 px-2 py-3">
              <p className="text-sm text-muted">
                {parsed.urls.length === 0
                  ? "Instagram Reels, video posts, TikToks, and YouTube Shorts."
                  : `${parsed.urls.length} ${parsed.urls.length === 1 ? "link" : "links"}`}
                {parsed.truncated ? " \u00b7 first 12 only" : ""}
              </p>
              <div className="ml-auto flex items-center gap-2">
                {running ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium"
                  >
                    <Square className="size-4" aria-hidden="true" />
                    Stop
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={running || parsed.urls.length === 0}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-bg disabled:opacity-50"
                >
                  {running ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  Fetch
                </button>
              </div>
            </div>
          </form>

          {notice ? (
            <p className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-fg" role="status">
              {notice}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <p className="px-1 text-sm text-pretty text-muted">
              Paste a public Reel, TikTok, or Short, then Fetch. Read shows the hook, the middle, and the ask on the
              card. Save pack comes after, as one zip.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {rows.map((row, index) => (
                <li key={`${row.url}-${index}`}>
                  {row.state === "loading" || !row.result ? (
                    <article className="panel flex items-center gap-3 rounded-3xl bg-surface px-4 py-4">
                      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
                      <p className="min-w-0 truncate text-sm text-muted">{row.url}</p>
                    </article>
                  ) : row.result.ok ? (
                    <ClipCard
                      clip={row.result}
                      busy={busyKey}
                      study={studies[row.result.sourceUrl]}
                      onRead={() => void readCut(row.result as Clip)}
                      onPack={() => void savePack(row.result as Clip)}
                      onAudio={() => void saveAudio(row.result as Clip)}
                    />
                  ) : (
                    <article className="panel rounded-3xl bg-surface px-4 py-4">
                      <p className="text-sm font-medium">Could not open</p>
                      <p className="mt-1 break-all text-sm text-muted">{row.result.sourceUrl || row.url}</p>
                      <p className="mt-2 text-sm">{row.result.error}</p>
                      <p className="mt-2 text-sm text-muted">
                        Private and login-only posts will not open. Use a public Reel, TikTok, or Short, or switch to
                        Ads and paste the written ad.
                      </p>
                    </article>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="text-sm text-pretty text-muted">
            Save only what you have the right to keep. Private and login-only posts will not open. Nothing is installed
            on your Mac. A pack saves to Downloads.
          </p>
        </div>

        <aside className="desk-side">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-side">On this browser</h2>
            {recent.length > 0 ? (
              <button type="button" onClick={clearRecent} className="h-11 px-2 text-sm text-muted">
                Clear
              </button>
            ) : null}
          </div>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing saved here yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {recent.map((item) => (
                <li key={item.sourceUrl}>
                  <button
                    type="button"
                    onClick={() => void run([item.sourceUrl])}
                    disabled={running}
                    className="panel w-full rounded-2xl bg-surface px-3 py-3 text-left disabled:opacity-50"
                  >
                    <span className="block text-xs tracking-wide text-muted">
                      <span className="uppercase">{platformLabel(item.platform)}</span>
                      {` \u00b7 @${item.handle}`}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-sm">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function ClipCard({
  clip,
  busy,
  study,
  onRead,
  onPack,
  onAudio,
}: {
  clip: Clip;
  busy: string | null;
  study?: Study;
  onRead: () => void;
  onPack: () => void;
  onAudio: () => void;
}) {
  const slug = clipSlug(clip);
  const duration = formatDuration(clip.durationSec);
  const reading = busy === `${clip.sourceUrl}:read`;
  const packing = busy === `${clip.sourceUrl}:pack`;
  const audioBusy = busy === `${clip.sourceUrl}:audio`;
  const filled = Boolean(study?.filled);
  return (
    <article className="panel rounded-3xl bg-surface p-2">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="mx-auto w-full max-w-56 shrink-0 overflow-hidden rounded-2xl bg-bg sm:mx-0">
          <video
            controls
            playsInline
            preload="none"
            poster={mediaHref(clip.coverUrl, `${slug}-cover.jpg`, true)}
            src={mediaHref(clip.videoUrl, `${slug}.mp4`, true)}
            className="clip-frame"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-3 py-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              {platformLabel(clip.platform)}
              {duration ? <span className="tabular-nums"> \u00b7 {duration}</span> : null}
            </p>
            <h3 className="mt-13 font-display text-card text-balance">{clip.title}</h3>
            <p className="mt-1 text-sm text-muted">@{clip.handle}</p>
            {clip.musicTitle ? <p className="mt-1 text-sm text-muted">{clip.musicTitle}</p> : null}
          </div>
          {clip.caption && clip.caption !== clip.title ? (
            <p className="line-clamp-4 text-sm whitespace-pre-wrap text-pretty">{clip.caption}</p>
          ) : null}
          {study?.filled ? <StudyNotes study={study} /> : null}
          <div className="mt-auto flex flex-wrap gap-2">
            {filled ? (
              <button
                type="button"
                onClick={onPack}
                disabled={Boolean(busy)}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-bg disabled:opacity-50"
              >
                {packing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                {packing ? "Saving" : "Save pack"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onRead}
                disabled={Boolean(busy)}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-bg disabled:opacity-50"
              >
                {reading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {reading ? "Reading the cut" : "Read"}
              </button>
            )}
            {filled ? (
              <button
                type="button"
                onClick={onRead}
                disabled={Boolean(busy)}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm disabled:opacity-50"
              >
                {reading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {reading ? "Reading the cut" : "Read again"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onPack}
                disabled={Boolean(busy)}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm disabled:opacity-50"
              >
                {packing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                {packing ? "Saving" : "Save pack"}
              </button>
            )}
            <details className="w-full">
              <summary className="inline-flex h-11 items-center text-sm text-muted">Files</summary>
              <div className="flex flex-wrap gap-2 pb-1">
                <a
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"
                  href={mediaHref(clip.videoUrl, `${slug}.mp4`, false)}
                  download={`${slug}.mp4`}
                >
                  <Film className="size-4" aria-hidden="true" />
                  Video
                </a>
                <button
                  type="button"
                  onClick={onAudio}
                  disabled={audioBusy}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm disabled:opacity-50"
                >
                  {audioBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Music2 className="size-4" aria-hidden="true" />}
                  Audio
                </button>
                <a
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"
                  href={mediaHref(clip.coverUrl, `${slug}-cover.jpg`, false)}
                  download={`${slug}-cover.jpg`}
                >
                  <ImageIcon className="size-4" aria-hidden="true" />
                  Cover
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([captionFile(clip)], { type: "text/plain;charset=utf-8" });
                    const href = URL.createObjectURL(blob);
                    triggerDownload(href, `${slug}-caption.txt`);
                    setTimeout(() => URL.revokeObjectURL(href), 4000);
                  }}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"
                >
                  <FileText className="size-4" aria-hidden="true" />
                  Caption
                </button>
              </div>
            </details>
          </div>
          {clip.audioKind === "extract" ? (
            <p className="text-sm text-muted">Audio is pulled out of the video when you save it or the pack.</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StudyNotes({ study }: { study: Study }) {
  const also = [
    ["Format", study.format],
    ["Hook type", study.hookType],
    ["Proof", study.proof],
    ["Loop", study.loop],
    ["Sound", study.sound],
    ["Pacing", study.pacing],
    ["Caption", study.captionRole],
    ["Pattern", study.pattern],
  ];
  return (
    <div className="flex flex-col gap-4">
      <StudyBlock label="Hook" meta={study.hookWindow} accent>
        {study.hook}
      </StudyBlock>
      <StudyBlock label="Content">{study.content}</StudyBlock>
      <StudyBlock label="CTA">{study.cta}</StudyBlock>
      <dl className="grid gap-3">
        {also.map(([label, value]) =>
          value ? (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
              <dd className="text-sm text-pretty">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {study.steal.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Steal</p>
          <ul className="mt-1 flex flex-col gap-1">
            {study.steal.map((line) => (
              <li key={line} className="text-sm text-pretty">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {study.transcript ? (
        <details>
          <summary className="text-sm text-muted">Transcript</summary>
          <p className="mt-2 text-sm whitespace-pre-wrap text-pretty">{study.transcript}</p>
        </details>
      ) : null}
    </div>
  );
}

function StudyBlock({
  label,
  meta,
  accent,
  children,
}: {
  label: string;
  meta?: string;
  accent?: boolean;
  children: string;
}) {
  return (
    <div className={accent ? "border-l-2 border-primary pl-3" : "border-l-2 border-border pl-3"}>
      <p className={accent ? "text-xs uppercase tracking-wide text-primary" : "text-xs uppercase tracking-wide text-muted"}>
        {label}
        {meta ? <span className="text-muted"> \u00b7 {meta}</span> : null}
      </p>
      <p className="mt-1 text-sm whitespace-pre-wrap text-pretty">{children}</p>
    </div>
  );
}
