import { assertMediaUrl, type Clip, type Platform } from "./shared";
import { resolveYouTube, youtubeTarget } from "./youtube.server";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const EMBED_UAS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "TelegramBot (like TwitterBot)",
];

type IgNode = {
  is_video?: boolean;
  video_url?: string;
  video_versions?: { url?: string }[];
  display_url?: string;
  thumbnail_src?: string;
  video_duration?: number;
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  owner?: { username?: string; full_name?: string };
  clips_music_attribution_info?: { artist_name?: string; song_name?: string } | null;
  edge_sidecar_to_children?: { edges?: { node?: IgNode }[] };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireMedia(url: string | null | undefined, label: string): string {
  if (!url) throw new Error(`${label} did not include a file.`);
  assertMediaUrl(url);
  return url;
}

async function expandUrl(input: string): Promise<string> {
  try {
    const response = await fetch(input, {
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
    });
    const finalUrl = response.url || input;
    await response.body?.cancel().catch(() => undefined);
    return unwrapLogin(finalUrl);
  } catch {
    return input;
  }
}

function unwrapLogin(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("instagram.com") && parsed.pathname.startsWith("/accounts/login")) {
      const next = parsed.searchParams.get("next");
      if (!next) return url;
      return next.startsWith("http") ? next : `https://www.instagram.com${next}`;
    }
  } catch {
    return url;
  }
  return url;
}

function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function instagramShortcode(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)instagram\.com$|(^|\.)instagr\.am$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isTikTok(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function readJsonString(source: string, quoteStart: number): string {
  if (source[quoteStart] !== '"') throw new Error("Instagram returned an unexpected page.");
  let index = quoteStart + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === '"') {
      return JSON.parse(source.slice(quoteStart, index + 1)) as string;
    }
    index += 1;
  }
  throw new Error("Instagram returned an unexpected page.");
}

function videoUrlOf(node: IgNode): string | null {
  if (typeof node.video_url === "string" && node.video_url.startsWith("http")) return node.video_url;
  const version = node.video_versions?.find((item) => typeof item.url === "string" && item.url.startsWith("http"));
  return version?.url ?? null;
}

function pickVideo(media: IgNode): IgNode | null {
  if (media.is_video && videoUrlOf(media)) return media;
  for (const edge of media.edge_sidecar_to_children?.edges ?? []) {
    const node = edge.node;
    if (node && (node.is_video || videoUrlOf(node)) && videoUrlOf(node)) return node;
  }
  return null;
}

async function fetchEmbed(shortcode: string): Promise<string> {
  let lastStatus = 0;
  for (const userAgent of EMBED_UAS) {
    const response = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
      headers: { "User-Agent": userAgent, Accept: "text/html" },
      redirect: "follow",
    });
    lastStatus = response.status;
    const html = await response.text();
    if (html.includes("contextJSON")) return html;
  }
  if (lastStatus === 404) throw new Error("That Instagram post was not found.");
  throw new Error("Instagram did not share this video. It may be private, deleted, or age-gated.");
}

async function resolveInstagram(sourceUrl: string, shortcode: string): Promise<Clip> {
  const html = await fetchEmbed(shortcode);
  const marker = '"contextJSON":';
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) {
    throw new Error("Instagram did not share this video. It may be private, deleted, or age-gated.");
  }
  const encoded = readJsonString(html, markerAt + marker.length);
  const parsed = JSON.parse(encoded) as {
    context?: { copyright_blocked?: boolean };
    gql_data?: { shortcode_media?: IgNode };
  };
  if (parsed.context?.copyright_blocked) {
    throw new Error("Instagram blocked this post.");
  }
  const media = parsed.gql_data?.shortcode_media;
  if (!media) throw new Error("Instagram did not share this video.");
  const videoNode = pickVideo(media);
  const videoUrl = videoNode ? videoUrlOf(videoNode) : null;
  if (!videoNode || !videoUrl) {
    throw new Error("This Instagram post has no video. Spool saves Reels and video posts.");
  }
  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() || videoNode.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() || "";
  const handle = media.owner?.username || videoNode.owner?.username || "instagram";
  const music = media.clips_music_attribution_info || videoNode.clips_music_attribution_info;
  const musicTitle = music?.song_name
    ? [music.song_name, music.artist_name].filter(Boolean).join(" · ")
    : null;
  const title = caption.split("\n")[0]?.trim().slice(0, 140) || "Instagram video";
  const cover = videoNode.display_url || media.display_url || videoNode.thumbnail_src || media.thumbnail_src || "";
  return {
    ok: true,
    sourceUrl,
    platform: "instagram",
    title,
    handle,
    caption,
    coverUrl: requireMedia(cover, "The cover"),
    videoUrl: requireMedia(videoUrl, "The video"),
    audioUrl: null,
    audioKind: "extract",
    durationSec: typeof videoNode.video_duration === "number" ? videoNode.video_duration : null,
    musicTitle,
  };
}

let lastTikwmAt = 0;

async function tikwm(pageUrl: string): Promise<Record<string, unknown>> {
  let lastMessage = "TikTok did not return a video.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const wait = 1100 - (Date.now() - lastTikwmAt);
    if (wait > 0) await sleep(wait);
    lastTikwmAt = Date.now();
    const response = await fetch("https://www.tikwm.com/api/", {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://www.tikwm.com",
        Referer: "https://www.tikwm.com/",
      },
      body: JSON.stringify({ url: pageUrl, hd: 1 }),
    });
    const json = (await response.json()) as { code?: number; msg?: string; data?: Record<string, unknown> };
    if (json.code === 0 && json.data) return json.data;
    lastMessage = json.msg || lastMessage;
    if (!/limit|second|frequen/i.test(lastMessage)) break;
  }
  if (/pars/i.test(lastMessage)) throw new Error("That does not look like a TikTok video.");
  if (/private|unavailable|not found/i.test(lastMessage)) {
    throw new Error("This TikTok is private or unavailable.");
  }
  throw new Error("TikTok did not return a video. It may be private or still processing.");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("http") ? value : null;
}

async function resolveTikTok(sourceUrl: string, pageUrl: string): Promise<Clip> {
  const data = await tikwm(pageUrl);
  const images = data.images;
  const play = asString(data.play) || asString(data.hdplay);
  if (!play) {
    if (Array.isArray(images) && images.length > 0) {
      throw new Error("This TikTok is a photo post, not a video.");
    }
    throw new Error("This TikTok has no video file.");
  }
  const musicInfo = (data.music_info ?? null) as { play?: string; title?: string; author?: string } | null;
  const audio = asString(musicInfo?.play) || asString(data.music);
  const author = (data.author ?? null) as { unique_id?: string; nickname?: string } | null;
  const handle = author?.unique_id || "tiktok";
  const title = (typeof data.title === "string" && data.title.trim()) || "TikTok video";
  const cover = asString(data.cover) || asString(data.origin_cover) || asString(data.ai_dynamic_cover);
  const duration = typeof data.duration === "number" ? data.duration : null;
  const musicTitle = musicInfo?.title
    ? [musicInfo.title, musicInfo.author].filter(Boolean).join(" · ")
    : null;
  if (audio) assertMediaUrl(audio);
  return {
    ok: true,
    sourceUrl,
    platform: "tiktok" satisfies Platform,
    title: title.slice(0, 180),
    handle,
    caption: title,
    coverUrl: requireMedia(cover, "The cover"),
    videoUrl: requireMedia(play, "The video"),
    audioUrl: audio,
    audioKind: audio ? "file" : "extract",
    durationSec: duration,
    musicTitle,
  };
}

export async function resolveLink(input: string): Promise<Clip> {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed) || trimmed.length > 2000) {
    throw new Error("Paste a full link, starting with https://");
  }
  if (/instagram\.com\/stories\//i.test(trimmed)) {
    throw new Error("Stories are not supported. Paste a Reel or a video post.");
  }
  if (/tiktok\.com\/@[^/]+\/live/i.test(trimmed)) {
    throw new Error("Live streams are not supported.");
  }
  const youtube = youtubeTarget(trimmed);
  if (youtube) {
    if (!/^[\w-]{11}$/.test(youtube.id)) throw new Error("Live streams are not supported.");
    return resolveYouTube(trimmed, youtube);
  }
  const expanded = cleanUrl(await expandUrl(trimmed));
  const shortcode = instagramShortcode(expanded) || instagramShortcode(trimmed);
  if (shortcode) return resolveInstagram(expanded.includes("instagram.com") ? expanded : trimmed, shortcode);
  if (isTikTok(expanded) || isTikTok(trimmed)) {
    return resolveTikTok(isTikTok(expanded) ? expanded : trimmed, expanded);
  }
  throw new Error("Spool only opens public Instagram Reels, Instagram video posts, TikToks, and YouTube Shorts.");
}
