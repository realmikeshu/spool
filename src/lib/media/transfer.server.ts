import { spawn } from "node:child_process";
import { zipSync } from "fflate";
import { MAX_MEDIA_BYTES, assertMediaUrl, safeFilename, type Clip } from "./shared";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function upstreamHeaders(url: string, range: string | null): Headers {
  const headers = new Headers({
    "User-Agent": BROWSER_UA,
    Accept: "*/*",
  });
  const host = new URL(url).hostname;
  const referer =
    host.includes("instagram") || host.includes("fbcdn") || host.includes("cdninstagram")
      ? "https://www.instagram.com/"
      : host.includes("googlevideo") || host.includes("ytimg") || host.includes("ggpht") || host.includes("youtube")
        ? "https://www.youtube.com/"
        : "https://www.tiktok.com/";
  headers.set("Referer", referer);
  if (range) headers.set("Range", range);
  return headers;
}

export async function openMedia(rawUrl: string, range: string | null): Promise<Response> {
  const target = assertMediaUrl(rawUrl);
  const response = await fetch(target, {
    headers: upstreamHeaders(target.toString(), range),
    redirect: "follow",
  });
  assertMediaUrl(response.url);
  return response;
}

export function proxyMedia(upstream: Response, filename: string, inline: boolean): Response {
  const headers = new Headers();
  const type = upstream.headers.get("content-type");
  if (type) headers.set("Content-Type", type);
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=120");
  const ascii = safeFilename(filename, "spool.bin");
  const disposition = inline ? "inline" : "attachment";
  headers.set(
    "Content-Disposition",
    `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(ascii)}`,
  );
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function readBody(response: Response): Promise<{ bytes: Uint8Array; contentType: string }> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_MEDIA_BYTES) {
    throw new Error("This file is too large to pack. Save the video on its own.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new Error("This file is too large to pack. Save the video on its own.");
  }
  return { bytes, contentType: response.headers.get("content-type") || "application/octet-stream" };
}

const mediaCache = new Map<string, { bytes: Uint8Array; contentType: string; at: number }>();

export async function downloadMedia(rawUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const cached = mediaCache.get(rawUrl);
  if (cached && Date.now() - cached.at < 3 * 60_000) {
    return { bytes: cached.bytes, contentType: cached.contentType };
  }
  const upstream = await openMedia(rawUrl, null);
  if (!upstream.ok && upstream.status !== 206) {
    throw new Error(`The file host returned ${upstream.status}.`);
  }
  const result = await readBody(upstream);
  if (result.bytes.byteLength <= 48 * 1024 * 1024) {
    mediaCache.delete(rawUrl);
    mediaCache.set(rawUrl, { ...result, at: Date.now() });
    while (mediaCache.size > 3) {
      const oldest = mediaCache.keys().next().value;
      if (!oldest) break;
      mediaCache.delete(oldest);
    }
  }
  return result;
}

function extensionFor(contentType: string, fallback: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("mp4")) return "mp4";
  return fallback;
}

const AAC_ARGS = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-c:a", "aac", "-b:a", "160k", "-f", "adts", "pipe:1"];
const STUDY_AAC_ARGS = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  "pipe:0",
  "-vn",
  "-ac",
  "1",
  "-ar",
  "16000",
  "-c:a",
  "aac",
  "-b:a",
  "64k",
  "-f",
  "adts",
  "pipe:1",
];

function runFfmpeg(video: Uint8Array, args: string[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Uint8Array[] = [];
    let errorText = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Uint8Array) => {
      if (errorText.length < 500) errorText += Buffer.from(chunk).toString("utf8");
    });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      if (code === 0 && size > 0) {
        const out = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(out);
        return;
      }
      reject(new Error(errorText.trim() || "Could not separate the audio from this video."));
    });
    child.stdin.write(video);
    child.stdin.end();
  });
}

export async function extractAudio(videoUrl: string): Promise<Uint8Array> {
  const { bytes } = await downloadMedia(videoUrl);
  return audioFromVideo(bytes);
}

export async function audioFromVideo(video: Uint8Array): Promise<Uint8Array> {
  try {
    return await runFfmpeg(video, AAC_ARGS);
  } catch (error) {
    if (error instanceof Error && /ENOENT|not found/i.test(error.message)) {
      throw new Error("A separate audio file is not available on this server. The sound is inside the video.");
    }
    throw new Error("Could not separate the audio. The sound is still inside the video file.");
  }
}

export async function studyAudioFromVideo(video: Uint8Array): Promise<Uint8Array> {
  try {
    return await runFfmpeg(video, STUDY_AAC_ARGS);
  } catch {
    return audioFromVideo(video);
  }
}

export async function buildPack(input: {
  filename: string;
  captionText: string;
  coverUrl: string;
  videoUrl: string;
  audioUrl: string | null;
  studyText?: string | null;
}): Promise<Uint8Array> {
  const folder = safeFilename(input.filename, "spool-pack");
  const video = await downloadMedia(input.videoUrl);
  const files: Record<string, Uint8Array> = {
    [`${folder}/video.mp4`]: video.bytes,
    [`${folder}/caption.txt`]: new TextEncoder().encode(input.captionText),
  };
  if (input.studyText) {
    files[`${folder}/study.txt`] = new TextEncoder().encode(input.studyText);
  }
  try {
    const cover = await downloadMedia(input.coverUrl);
    files[`${folder}/cover.${extensionFor(cover.contentType, "jpg")}`] = cover.bytes;
  } catch {
    files[`${folder}/cover-unavailable.txt`] = new TextEncoder().encode("The cover image could not be fetched.\n");
  }
  try {
    if (input.audioUrl) {
      const audio = await downloadMedia(input.audioUrl);
      files[`${folder}/audio.${extensionFor(audio.contentType, "mp3")}`] = audio.bytes;
    } else {
      const audio = await runFfmpeg(video.bytes, AAC_ARGS);
      files[`${folder}/audio.aac`] = audio;
    }
  } catch {
    files[`${folder}/audio-note.txt`] = new TextEncoder().encode(
      "A separate audio file could not be made. The sound is included in video.mp4.\n",
    );
  }
  return zipSync(files, { level: 0 });
}

export function clipFromUnknown(value: unknown): Clip | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Clip>;
  if (row.ok !== true) return null;
  if (row.platform !== "tiktok" && row.platform !== "instagram" && row.platform !== "youtube") return null;
  if (typeof row.videoUrl !== "string" || typeof row.coverUrl !== "string") return null;
  if (typeof row.sourceUrl !== "string" || typeof row.handle !== "string") return null;
  return row as Clip;
}
