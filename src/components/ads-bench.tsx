import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Film, Image as ImageIcon, Loader2, Music2, Square } from "lucide-react";
import { DeskHeader } from "@/components/desk-header";
import {
  AD_COPY_MAX,
  AD_COPY_MIN,
  AD_HISTORY_KEY,
  adFile,
  adStudyFromUnknown,
  blankAdStudy,
  groupAngles,
  savedAdFromUnknown,
  type AdStudy,
  type SavedAd,
} from "@/lib/media/ad";
import {
  clipSlug,
  extractUrls,
  formatDuration,
  mediaHref,
  type Clip,
  type ClipResult,
  type Platform,
} from "@/lib/media/shared";

type Row = {
  url: string;
  state: "loading" | "done";
  result?: ClipResult;
};

type CopyCard = {
  id: string;
  text: string;
  state: "loading" | "done";
  study?: AdStudy;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function triggerDownload(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function loadSaved(): SavedAd[] {
  try {
    const raw = localStorage.getItem(AD_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(savedAdFromUnknown).filter((item): item is SavedAd => item !== null).slice(0, 16);
  } catch {
    return [];
  }
}

const SAMPLE_AD = `Still paying for leads that never book?

Northline Dental. New-patient special.
Exam, X-rays, and a cleaning for $79, usually $240.
Only for new patients in Denver this month.
No insurance needed. Two chairs left this week.

Book the $79 visit.`;

function firstLine(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "Pasted ad";
  return line.slice(0, 90);
}

async function readStudy(body: unknown): Promise<{ study?: AdStudy; error?: string }> {
  const response = await fetch("/api/ad-study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: { ok?: boolean; study?: unknown; error?: string } = {};
  try {
    data = JSON.parse(text) as { ok?: boolean; study?: unknown; error?: string };
  } catch {
    data = {};
  }
  const study = adStudyFromUnknown(data.study);
  if (data.ok && study) return { study };
  return { error: data.error || "Could not read that ad." };
}

export function AdsBench() {
  const [links, setLinks] = useState("");
  const [copy, setCopy] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [copies, setCopies] = useState<CopyCard[]>([]);
  const [studies, setStudies] = useState<Record<string, AdStudy>>({});
  const [saved, setSaved] = useState<SavedAd[]>([]);
  const [focus, setFocus] = useState<SavedAd | null>(null);
  const [running, setRunning] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<"pack" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const parsed = useMemo(() => extractUrls(links), [links]);
  const copyReady = copy.trim().length >= AD_COPY_MIN;
  const readPrimary = copyReady && parsed.urls.length === 0;

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  function remember(entry: SavedAd) {
    setSaved((current) => {
      const merged = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 16);
      localStorage.setItem(AD_HISTORY_KEY, JSON.stringify(merged));
      return merged;
    });
  }

  function clearSaved() {
    localStorage.removeItem(AD_HISTORY_KEY);
    setSaved([]);
    setFocus(null);
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

  async function readClip(clip: Clip) {
    if (busyKey) return;
    setBusyKey(clip.sourceUrl);
    setNotice(null);
    try {
      const result = await readStudy(clip);
      if (!result.study) {
        setNotice(result.error || "Could not read that ad.");
        return;
      }
      setStudies((current) => ({ ...current, [clip.sourceUrl]: result.study as AdStudy }));
      remember({
        id: clip.sourceUrl,
        savedAt: Date.now(),
        title: clip.title,
        subtitle: `${platformLabel(clip.platform)} · @${clip.handle}`,
        study: result.study,
        clip,
        copy: null,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not read that ad.");
    } finally {
      setBusyKey(null);
    }
  }

  async function readCopy() {
    const text = copy.trim().slice(0, AD_COPY_MAX);
    if (text.length < AD_COPY_MIN || busyKey) return;
    const id = `copy-${Date.now()}`;
    setBusyKey(id);
    setNotice(null);
    setCopies((current) => [{ id, text, state: "loading" as const }, ...current].slice(0, 8));
    try {
      const result = await readStudy({ kind: "copy", text });
      if (!result.study) {
        setCopies((current) =>
          current.map((card) => (card.id === id ? { ...card, state: "done", error: result.error } : card)),
        );
        return;
      }
      const study = result.study;
      setCopies((current) => current.map((card) => (card.id === id ? { ...card, state: "done", study } : card)));
      remember({
        id,
        savedAt: Date.now(),
        title: firstLine(text),
        subtitle: "Pasted ad",
        study,
        clip: null,
        copy: text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read that ad.";
      setCopies((current) => current.map((card) => (card.id === id ? { ...card, state: "done", error: message } : card)));
    } finally {
      setBusyKey(null);
    }
  }

  async function savePack(clip: Clip) {
    const slug = clipSlug(clip);
    const key = `${clip.sourceUrl}:pack`;
    if (busyKey) return;
    setBusyKey(key);
    setPhase("pack");
    setNotice(null);
    const study = studies[clip.sourceUrl] ?? blankAdStudy();
    try {
      const response = await fetch("/api/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...clip,
          filename: slug,
          studyText: adFile(clip.title, `${platformLabel(clip.platform)} · @${clip.handle}`, clip.sourceUrl, study),
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text.replace(/\s+/g, " ").trim().slice(0, 240) || "Could not build that pack.");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      triggerDownload(href, `${slug}.zip`);
      setTimeout(() => URL.revokeObjectURL(href), 8000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not build that pack.");
    } finally {
      setBusyKey(null);
      setPhase(null);
    }
  }

  async function saveAudio(clip: Clip) {
    const slug = clipSlug(clip);
    const key = `${clip.sourceUrl}:audio`;
    if (busyKey) return;
    setBusyKey(key);
    setNotice(null);
    try {
      if (clip.audioUrl) {
        triggerDownload(mediaHref(clip.audioUrl, `${slug}-audio.mp3`, false), `${slug}-audio.mp3`);
      } else {
        const params = new URLSearchParams({ u: clip.videoUrl, name: `${slug}-audio.aac` });
        const response = await fetch(`/api/audio?${params.toString()}`);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text.replace(/\s+/g, " ").trim().slice(0, 240) || "Could not save the audio.");
        }
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        triggerDownload(href, `${slug}-audio.aac`);
        setTimeout(() => URL.revokeObjectURL(href), 8000);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the audio.");
    } finally {
      setBusyKey(null);
    }
  }

  function saveSheet(title: string, subtitle: string, source: string, study: AdStudy) {
    const blob = new Blob([adFile(title, subtitle, source, study)], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const slug = title.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "ad";
    triggerDownload(href, `${slug}-ad.txt`);
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  }

  const board = useMemo(() => {
    const fromSaved = saved.map((item) => item.study);
    const fromSession = Object.values(studies);
    const fromCopies = copies.flatMap((card) => (card.study ? [card.study] : []));
    const seen = new Set<string>();
    const all: AdStudy[] = [];
    for (const study of [...fromCopies, ...fromSession, ...fromSaved]) {
      const key = `${study.angle}|${study.offer}|${study.hook}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(study);
    }
    return groupAngles(all);
  }, [saved, studies, copies]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <DeskHeader mode="ads" />
      <div className="desk">
        <div className="flex min-w-0 flex-col gap-21">
          <form
            className="panel flex flex-col gap-4 rounded-3xl bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <div>
              <label htmlFor="ad-links" className="px-2 pt-1 text-sm font-medium">
                Ad links
              </label>
              <textarea
                id="ad-links"
                value={links}
                onChange={(event) => setLinks(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void run();
                  }
                }}
                rows={4}
                spellCheck={false}
                placeholder={"One public ad link per line\nhttps://www.instagram.com/reel/…\nhttps://www.tiktok.com/@…/video/…\nhttps://www.youtube.com/shorts/…"}
                className="mt-2 w-full resize-y rounded-2xl border border-border bg-bg px-4 py-3 text-base leading-normal text-fg outline-none placeholder:text-muted focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="ad-copy" className="px-2 text-sm font-medium">
                Written ad
              </label>
              <textarea
                id="ad-copy"
                value={copy}
                onChange={(event) => setCopy(event.target.value.slice(0, AD_COPY_MAX))}
                rows={4}
                placeholder="Primary text, headline, and offer. Use this when the creative is not a public link."
                className="mt-2 w-full resize-y rounded-2xl border border-border bg-bg px-4 py-3 text-base leading-normal text-fg outline-none placeholder:text-muted focus:border-primary"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 px-2 pb-1">
              <p className="text-sm text-muted">
                {parsed.urls.length === 0
                  ? "Reels, TikToks, and Shorts, read as ads."
                  : `${parsed.urls.length} ${parsed.urls.length === 1 ? "link" : "links"}`}
                {parsed.truncated ? " · first 12 only" : ""}
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-2">
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
                  type="button"
                  onClick={() => void readCopy()}
                  disabled={!copyReady || Boolean(busyKey)}
                  className={
                    readPrimary
                      ? "inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-bg disabled:opacity-50"
                      : "inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium disabled:opacity-50"
                  }
                >
                  {busyKey?.startsWith("copy-") ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {busyKey?.startsWith("copy-") ? "Reading" : "Read"}
                </button>
                <button
                  type="submit"
                  disabled={running || parsed.urls.length === 0}
                  className={
                    readPrimary
                      ? "inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium disabled:opacity-50"
                      : "inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-bg disabled:opacity-50"
                  }
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

          {focus ? (
            <FocusedAd
              entry={focus}
              onSheet={() => saveSheet(focus.title, focus.subtitle, focus.clip?.sourceUrl || "pasted", focus.study)}
              onClose={() => setFocus(null)}
            />
          ) : null}

          {copies.map((card) => (
            <CopyResult
              key={card.id}
              card={card}
              onSheet={
                card.study
                  ? () => saveSheet(firstLine(card.text), "Pasted ad", "pasted copy", card.study as AdStudy)
                  : undefined
              }
            />
          ))}

          {rows.length === 0 && copies.length === 0 && !focus ? (
            <div className="flex flex-col items-start gap-3 px-1">
              <p className="text-sm text-pretty text-muted">
                Fetch a public ad, or paste the written one. Read shows the hook, the offer, and the proof on the card.
                Save comes after. Nothing is sent until you ask.
              </p>
              <button
                type="button"
                onClick={() => setCopy(SAMPLE_AD)}
                className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium"
              >
                Use a sample ad
              </button>
            </div>
          ) : null}

          {rows.length > 0 ? (
            <ul className="flex flex-col gap-4">
              {rows.map((row, index) => (
                <li key={`${row.url}-${index}`}>
                  {row.state === "loading" || !row.result ? (
                    <article className="panel flex items-center gap-3 rounded-3xl bg-surface px-4 py-4">
                      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
                      <p className="min-w-0 truncate text-sm text-muted">{row.url}</p>
                    </article>
                  ) : row.result.ok ? (
                    <AdClipCard
                      clip={row.result}
                      study={studies[row.result.sourceUrl]}
                      busy={busyKey}
                      phase={phase}
                      onRead={() => void readClip(row.result as Clip)}
                      onPack={() => void savePack(row.result as Clip)}
                      onAudio={() => void saveAudio(row.result as Clip)}
                      onSheet={() => {
                        const clip = row.result as Clip;
                        saveSheet(
                          clip.title,
                          `${platformLabel(clip.platform)} · @${clip.handle}`,
                          clip.sourceUrl,
                          studies[clip.sourceUrl] ?? blankAdStudy(),
                        );
                      }}
                    />
                  ) : (
                    <article className="panel rounded-3xl bg-surface px-4 py-4">
                      <p className="text-sm font-medium">Could not open</p>
                      <p className="mt-1 break-all text-sm text-muted">{row.result.sourceUrl || row.url}</p>
                      <p className="mt-2 text-sm">{row.result.error}</p>
                      <p className="mt-2 text-sm text-muted">
                        If the post is private, paste the written ad above and press Read.
                      </p>
                    </article>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-sm text-pretty text-muted">
            Save only ads you have the right to keep. Login-only and library pages that are not the creative itself
            will not open. Switch to Social for organic cuts. Nothing is installed on your Mac. A pack or sheet saves
            to Downloads.
          </p>
        </div>

        <aside className="desk-side flex flex-col gap-34">
          <div>
            <h2 className="font-display text-side">Angle board</h2>
            {board.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Angles collect here after you read an ad.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {board.map((group) => (
                  <li key={group.angle} className="panel rounded-2xl bg-surface px-3 py-3">
                    <p className="text-sm text-pretty">{group.angle}</p>
                    <p className="mt-1 text-xs tracking-wide text-muted">
                      {group.count} {group.count === 1 ? "ad" : "ads"}
                    </p>
                    {group.offers.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {group.offers.slice(0, 3).map((offer) => (
                          <li key={offer} className="text-sm text-pretty text-muted">
                            {offer}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-side">On this browser</h2>
              {saved.length > 0 ? (
                <button type="button" onClick={clearSaved} className="h-11 px-2 text-sm text-muted">
                  Clear
                </button>
              ) : null}
            </div>
            {saved.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nothing read here yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {saved.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setFocus(item)}
                      className="panel w-full rounded-2xl bg-surface px-3 py-3 text-left"
                    >
                      <span className="block text-xs tracking-wide text-muted">{item.subtitle}</span>
                      <span className="mt-1 block line-clamp-2 text-sm">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function AdClipCard({
  clip,
  study,
  busy,
  phase,
  onRead,
  onPack,
  onAudio,
  onSheet,
}: {
  clip: Clip;
  study?: AdStudy;
  busy: string | null;
  phase: "pack" | null;
  onRead: () => void;
  onPack: () => void;
  onAudio: () => void;
  onSheet: () => void;
}) {
  const slug = clipSlug(clip);
  const duration = formatDuration(clip.durationSec);
  const reading = busy === clip.sourceUrl;
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
              {duration ? <span className="tabular-nums"> · {duration}</span> : null}
            </p>
            <h3 className="mt-13 font-display text-card text-balance">{clip.title}</h3>
            <p className="mt-1 text-sm text-muted">@{clip.handle}</p>
          </div>
          {clip.caption && clip.caption !== clip.title ? (
            <p className="line-clamp-4 text-sm whitespace-pre-wrap text-pretty">{clip.caption}</p>
          ) : null}
          {study?.filled ? <AdNotes study={study} /> : null}
          <div className="mt-auto flex flex-wrap gap-2">
            {filled ? (
              <button
                type="button"
                onClick={onPack}
                disabled={Boolean(busy)}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-bg disabled:opacity-50"
              >
                {packing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                {packing && phase === "pack" ? "Saving" : "Save pack"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onRead}
                disabled={Boolean(busy)}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-bg disabled:opacity-50"
              >
                {reading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {reading ? "Reading the ad" : "Read"}
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
                {reading ? "Reading the ad" : "Read again"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSheet}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"
            >
              <FileText className="size-4" aria-hidden="true" />
              Save sheet
            </button>
            {filled ? null : (
              <button
                type="button"
                onClick={onPack}
                disabled={Boolean(busy)}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm disabled:opacity-50"
              >
                {packing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                {packing && phase === "pack" ? "Saving" : "Save pack"}
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
                  disabled={Boolean(busy)}
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
              </div>
            </details>
          </div>
        </div>
      </div>
    </article>
  );
}

function CopyResult({ card, onSheet }: { card: CopyCard; onSheet?: () => void }) {
  return (
    <article className="panel rounded-3xl bg-surface px-4 py-4">
      {card.state === "loading" ? (
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted">Reading the written ad</p>
        </div>
      ) : card.error ? (
        <>
          <p className="text-sm font-medium">Could not read that ad</p>
          <p className="mt-2 text-sm">{card.error}</p>
        </>
      ) : card.study ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Pasted ad</p>
            <h3 className="mt-13 font-display text-card text-balance">{firstLine(card.text)}</h3>
          </div>
          <AdNotes study={card.study} />
          {onSheet ? (
            <button
              type="button"
              onClick={onSheet}
              className="inline-flex h-11 w-fit items-center gap-2 rounded-xl border border-border px-3 text-sm"
            >
              <FileText className="size-4" aria-hidden="true" />
              Save sheet
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function FocusedAd({ entry, onSheet, onClose }: { entry: SavedAd; onSheet: () => void; onClose: () => void }) {
  return (
    <article className="panel rounded-3xl bg-surface px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{entry.subtitle}</p>
          <h3 className="mt-13 font-display text-card text-balance">{entry.title}</h3>
        </div>
        <button type="button" onClick={onClose} className="h-11 shrink-0 px-2 text-sm text-muted">
          Close
        </button>
      </div>
      {entry.copy ? <p className="mt-3 line-clamp-4 text-sm whitespace-pre-wrap text-pretty">{entry.copy}</p> : null}
      <div className="mt-3">
        <AdNotes study={entry.study} />
      </div>
      <button
        type="button"
        onClick={onSheet}
        className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"
      >
        <FileText className="size-4" aria-hidden="true" />
        Save sheet
      </button>
    </article>
  );
}

function AdNotes({ study }: { study: AdStudy }) {
  const also = [
    ["Format", study.format],
    ["Hook type", study.hookType],
    ["Mechanism", study.mechanism],
    ["Landing", study.landing],
    ["Fatigue", study.fatigue],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Note label="Hook" meta={study.hookWindow} accent>
        {study.hook}
      </Note>
      <Note label="Offer">{study.offer}</Note>
      <Note label="Audience">{study.audience}</Note>
      <Note label="Objection">{study.objection}</Note>
      <Note label="Proof">{study.proof}</Note>
      <Note label="CTA">{study.cta}</Note>
      <Note label="Angle">{study.angle}</Note>
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
      {study.test.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Test</p>
          <ul className="mt-1 flex flex-col gap-1">
            {study.test.map((line) => (
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

function Note({
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
        {meta ? <span className="text-muted"> · {meta}</span> : null}
      </p>
      <p className="mt-1 text-sm whitespace-pre-wrap text-pretty">{children}</p>
    </div>
  );
}
