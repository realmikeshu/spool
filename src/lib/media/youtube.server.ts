import { assertMediaUrl, type Clip } from "./shared";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const VR_UA =
  "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

const SHORT_MAX_SEC = 180;
const ID_RE = /^[\w-]{11}$/;

type Target = { id: string; explicitShort: boolean };

type YtFormat = {
  itag?: number;
  url?: string;
  mimeType?: string;
  height?: number;
  bitrate?: number;
};

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    title?: string;
    author?: string;
    shortDescription?: string;
    lengthSeconds?: string;
    isLive?: boolean;
    isLiveContent?: boolean;
    isPrivate?: boolean;
  };
  streamingData?: { formats?: YtFormat[]; adaptiveFormats?: YtFormat[] };
};

let lastYoutubeAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function youtubeTarget(input: string): Target | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return ID_RE.test(id) ? { id, explicitShort: false } : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com" && host !== "youtube-nocookie.com") {
    return null;
  }
  const shorts = url.pathname.match(/\/shorts\/([\w-]{11})/);
  if (shorts?.[1]) return { id: shorts[1], explicitShort: true };
  if (/\/live\//.test(url.pathname)) {
    const id = url.pathname.split("/").filter(Boolean)[1] ?? "";
    return { id: ID_RE.test(id) ? id : "live", explicitShort: false };
  }
  const watch = url.searchParams.get("v");
  if (watch && ID_RE.test(watch)) return { id: watch, explicitShort: false };
  const embed = url.pathname.match(/\/(?:embed|v|e)\/([\w-]{11})/);
  if (embed?.[1]) return { id: embed[1], explicitShort: false };
  return null;
}

function cookieHeader(response: Response): string {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const pairs = ["SOCS=CAI"];
  for (const line of lines) {
    const pair = line.split(";")[0]?.trim();
    if (pair && !pair.startsWith("SOCS=")) pairs.push(pair);
  }
  return pairs.join("; ");
}

function pickMuxed(formats: YtFormat[]): string | null {
  const muxed = formats.filter((format) => {
    const mime = format.mimeType ?? "";
    return typeof format.url === "string" && mime.includes("video/mp4") && mime.includes("mp4a");
  });
  muxed.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return muxed[0]?.url ?? null;
}

async function player(id: string, cookie: string, visitorData: string | null): Promise<PlayerResponse> {
  const wait = 700 - (Date.now() - lastYoutubeAt);
  if (wait > 0) await sleep(wait);
  lastYoutubeAt = Date.now();
  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": VR_UA,
      Cookie: cookie,
      Origin: "https://www.youtube.com",
      Referer: "https://www.youtube.com/",
      "X-Youtube-Client-Name": "28",
      "X-Youtube-Client-Version": "1.65.10",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "ANDROID_VR",
          clientVersion: "1.65.10",
          hl: "en",
          gl: "US",
          userAgent: VR_UA,
          deviceMake: "Oculus",
          deviceModel: "Quest 3",
          androidSdkVersion: 32,
          osName: "Android",
          osVersion: "12L",
          ...(visitorData ? { visitorData } : {}),
        },
      },
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (response.status === 429) {
    throw new Error("YouTube is busy. Wait a moment and try that Short again.");
  }
  if (!response.ok) throw new Error("YouTube did not answer.");
  return (await response.json()) as PlayerResponse;
}

async function fileOpens(url: string): Promise<boolean> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "*/*",
      Range: "bytes=0-31",
      Referer: "https://www.youtube.com/",
    },
  });
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel().catch(() => undefined);
    return false;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mark = Buffer.from(bytes.subarray(4, 12)).toString("latin1");
  return mark.includes("ftyp") || bytes[0] === 0x1a;
}

async function handleFor(id: string, author: string): Promise<string> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/shorts/${id}`)}`,
      { headers: { Accept: "application/json", "User-Agent": BROWSER_UA } },
    );
    if (response.ok) {
      const json = (await response.json()) as { author_url?: string; author_name?: string };
      const match = json.author_url?.match(/@([^/?]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]);
      if (json.author_name) return json.author_name.replace(/\s+/g, "");
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
  } catch {
    /* the display name is enough */
  }
  return author.replace(/\s+/g, "") || "youtube";
}

export async function resolveYouTube(sourceUrl: string, target: Target): Promise<Clip> {
  if (!ID_RE.test(target.id)) throw new Error("That YouTube link has no video.");
  if (sourceUrl.includes("/live/")) throw new Error("Live streams are not supported.");

  const embed = await fetch(`https://www.youtube-nocookie.com/embed/${target.id}`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html", Cookie: "SOCS=CAI" },
  });
  if (embed.status === 429) throw new Error("YouTube is busy. Wait a moment and try that Short again.");
  const html = await embed.text();
  if (!embed.ok) throw new Error("YouTube did not open that Short.");
  const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1] ?? null;
  const body = await player(target.id, cookieHeader(embed), visitorData);
  const status = body.playabilityStatus?.status ?? "UNKNOWN";
  const reason = body.playabilityStatus?.reason ?? "";
  const details = body.videoDetails;
  const title = details?.title?.trim() || "YouTube Short";

  if (details?.isLive || details?.isLiveContent || /live/i.test(reason)) {
    throw new Error("Live streams are not supported.");
  }
  if (status !== "OK") {
    if (/age|confirm your age/i.test(reason)) throw new Error("This Short is age-gated.");
    if (status === "LOGIN_REQUIRED" || details?.isPrivate || /private|sign in/i.test(reason)) {
      throw new Error("This Short is private or needs a sign-in, so Spool cannot save it.");
    }
    throw new Error(reason ? `YouTube would not open this Short. ${reason}` : "YouTube would not open this Short.");
  }

  const durationSec = details?.lengthSeconds ? Number(details.lengthSeconds) : null;
  if (!target.explicitShort && durationSec != null && durationSec > SHORT_MAX_SEC) {
    throw new Error("That is a full YouTube video. Paste a Short.");
  }

  const formats = [...(body.streamingData?.formats ?? []), ...(body.streamingData?.adaptiveFormats ?? [])];
  const videoUrl = pickMuxed(formats);
  if (!videoUrl) throw new Error("YouTube did not share a video file for this Short.");
  if (!(await fileOpens(videoUrl))) {
    throw new Error(`YouTube recognized “${title}”, but it would not hand over the video file.`);
  }

  const author = details?.author?.trim() || "youtube";
  const caption = details?.shortDescription?.trim() || title;
  const cover = `https://i.ytimg.com/vi/${target.id}/hqdefault.jpg`;
  return {
    ok: true,
    sourceUrl,
    platform: "youtube",
    title: title.slice(0, 180),
    handle: await handleFor(target.id, author),
    caption,
    coverUrl: assertMediaUrl(cover).toString(),
    videoUrl: assertMediaUrl(videoUrl).toString(),
    audioUrl: null,
    audioKind: "extract",
    durationSec: Number.isFinite(durationSec) ? durationSec : null,
    musicTitle: null,
  };
}
