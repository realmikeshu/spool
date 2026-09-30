export const MAX_LINKS = 12;
export const MAX_MEDIA_BYTES = 72 * 1024 * 1024;

export type Platform = "tiktok" | "instagram" | "youtube";

export type Clip = {
  ok: true;
  sourceUrl: string;
  platform: Platform;
  title: string;
  handle: string;
  caption: string;
  coverUrl: string;
  videoUrl: string;
  audioUrl: string | null;
  audioKind: "file" | "extract";
  durationSec: number | null;
  musicTitle: string | null;
};

export type ClipError = {
  ok: false;
  sourceUrl: string;
  error: string;
};

export type ClipResult = Clip | ClipError;

export function isAllowedMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return (
    host === "tikwm.com" ||
    host.endsWith(".tikwm.com") ||
    host === "tiktokcdn.com" ||
    host.endsWith(".tiktokcdn.com") ||
    host.endsWith(".tiktokcdn-us.com") ||
    host === "tiktok.com" ||
    host.endsWith(".tiktok.com") ||
    host.endsWith(".cdninstagram.com") ||
    host === "cdninstagram.com" ||
    host.endsWith(".fbcdn.net") ||
    host === "instagram.com" ||
    host.endsWith(".instagram.com") ||
    host === "googlevideo.com" ||
    host.endsWith(".googlevideo.com") ||
    host === "ytimg.com" ||
    host.endsWith(".ytimg.com") ||
    host === "ggpht.com" ||
    host.endsWith(".ggpht.com")
  );
}

export function assertMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That file address is not valid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("That file address is not valid.");
  }
  if (!isAllowedMediaHost(url.hostname)) {
    throw new Error("That file host is not one Spool can pass through.");
  }
  return url;
}

export function extractUrls(text: string): { urls: string[]; truncated: boolean } {
  const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const url = raw.replace(/[),.;!?]+$/g, "");
    const key = url.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return { urls: out.slice(0, MAX_LINKS), truncated: out.length > MAX_LINKS };
}

export function safeFilename(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\r\n"\\]/g, "")
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function clipSlug(clip: Pick<Clip, "handle" | "sourceUrl" | "platform">): string {
  const handle = clip.handle.replace(/[^\w.-]+/g, "").slice(0, 24) || clip.platform;
  let id = "clip";
  try {
    const url = new URL(clip.sourceUrl);
    const ig = url.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    const tt = url.pathname.match(/\/video\/(\d+)/);
    const shorts = url.pathname.match(/\/shorts\/([\w-]{11})/);
    const watch = url.searchParams.get("v");
    const shortHost = url.hostname.replace(/^www\./, "") === "youtu.be";
    const yid = shortHost ? url.pathname.split("/").filter(Boolean)[0] : null;
    if (ig?.[1]) id = ig[1];
    else if (tt?.[1]) id = tt[1].slice(-8);
    else if (shorts?.[1]) id = shorts[1];
    else if (watch && /^[\w-]{11}$/.test(watch)) id = watch;
    else if (yid && /^[\w-]{11}$/.test(yid)) id = yid;
  } catch {
    id = "clip";
  }
  return safeFilename(`${handle}-${id}`, "spool-clip");
}

export function formatDuration(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const total = Math.round(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function captionFile(clip: Pick<Clip, "title" | "handle" | "platform" | "sourceUrl" | "caption" | "musicTitle">): string {
  const platform = clip.platform === "tiktok" ? "TikTok" : clip.platform === "youtube" ? "YouTube" : "Instagram";
  const music = clip.musicTitle ? `\nSound: ${clip.musicTitle}` : "";
  return `${clip.title}\n@${clip.handle} · ${platform}${music}\n${clip.sourceUrl}\n\n${clip.caption}\n`;
}

export function mediaHref(fileUrl: string, filename: string, inline: boolean): string {
  const params = new URLSearchParams({
    u: fileUrl,
    name: filename,
    inline: inline ? "1" : "0",
  });
  return `/api/file?${params.toString()}`;
}

export type Study = {
  filled: boolean;
  hook: string;
  hookWindow: string;
  content: string;
  cta: string;
  format: string;
  hookType: string;
  proof: string;
  loop: string;
  captionRole: string;
  sound: string;
  pacing: string;
  pattern: string;
  steal: string[];
  transcript: string;
};

export function blankStudy(): Study {
  return {
    filled: false,
    hook: "",
    hookWindow: "",
    content: "",
    cta: "",
    format: "",
    hookType: "",
    proof: "",
    loop: "",
    captionRole: "",
    sound: "",
    pacing: "",
    pattern: "",
    steal: [],
    transcript: "",
  };
}

function clean(value: unknown, max: number, keepBreaks: boolean): string {
  if (typeof value !== "string") return "";
  const text = keepBreaks
    ? value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : value.replace(/\s+/g, " ").trim();
  return text.slice(0, max);
}

export function studyFromUnknown(value: unknown): Study | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Study>;
  if (row.filled !== true) return null;
  const steal = Array.isArray(row.steal)
    ? row.steal.map((item) => clean(item, 160, false)).filter(Boolean).slice(0, 4)
    : [];
  const study: Study = {
    filled: true,
    hook: clean(row.hook, 500, false),
    hookWindow: clean(row.hookWindow, 40, false),
    content: clean(row.content, 900, true),
    cta: clean(row.cta, 400, false),
    format: clean(row.format, 80, false),
    hookType: clean(row.hookType, 80, false),
    proof: clean(row.proof, 240, false),
    loop: clean(row.loop, 240, false),
    captionRole: clean(row.captionRole, 320, false),
    sound: clean(row.sound, 200, false),
    pacing: clean(row.pacing, 240, false),
    pattern: clean(row.pattern, 280, false),
    steal,
    transcript: clean(row.transcript, 8000, true),
  };
  if (!study.hook && !study.content && !study.cta) return null;
  return study;
}

export function studyFile(
  clip: Pick<Clip, "title" | "handle" | "platform" | "sourceUrl" | "caption" | "musicTitle" | "durationSec">,
  study: Study,
): string {
  const platform = clip.platform === "tiktok" ? "TikTok" : clip.platform === "youtube" ? "YouTube" : "Instagram";
  const duration = formatDuration(clip.durationSec) ?? "unknown length";
  const head = ["SPOOL STUDY", `${platform} · @${clip.handle} · ${duration}`, clip.title, clip.sourceUrl, ""];
  if (!study.filled) {
    return [
      ...head,
      "HOOK",
      "First 1–3 seconds. Spoken line, on-screen text, and what you see.",
      "",
      "CONTENT",
      "The middle. Steps, story, demo, or proof.",
      "",
      "CTA",
      "The ask: follow, comment, save, share, link, or DM. Write “no ask” if there isn’t one.",
      "",
      "ALSO",
      "Format:",
      "Hook type:",
      "Proof:",
      "Loop:",
      "Sound:",
      "Pacing:",
      "Caption vs spoken:",
      "Pattern:",
      "",
      "STEAL",
      "- ",
      "- ",
      "- ",
      "",
      "TRANSCRIPT",
      "",
      "POSTED CAPTION",
      clip.caption,
      "",
    ].join("\n");
  }
  const steal = study.steal.length ? study.steal.map((line) => `- ${line}`).join("\n") : "- ";
  const sound = clip.musicTitle ? `Posted sound: ${clip.musicTitle}\n${study.sound}` : study.sound;
  return [
    ...head,
    `HOOK  ${study.hookWindow || ""}`.trimEnd(),
    study.hook,
    "",
    "CONTENT",
    study.content,
    "",
    "CTA",
    study.cta,
    "",
    "ALSO",
    `Format: ${study.format}`,
    `Hook type: ${study.hookType}`,
    `Proof: ${study.proof}`,
    `Loop: ${study.loop}`,
    `Sound: ${sound}`,
    `Pacing: ${study.pacing}`,
    `Caption vs spoken: ${study.captionRole}`,
    `Pattern: ${study.pattern}`,
    "",
    "STEAL",
    steal,
    "",
    "TRANSCRIPT",
    study.transcript || "(no spoken words)",
    "",
    "POSTED CAPTION",
    clip.caption,
    "",
  ].join("\n");
}
