import { blankStudy, type Clip, type Study } from "./shared";
import { downloadMedia, studyAudioFromVideo } from "./transfer.server";

type Word = { text: string; start: number; end: number };

const NOTE = "Not in the audio.";

function stamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function transcriptFromWords(words: Word[], fallback: string): string {
  if (!words.length) return fallback.trim();
  const lines: string[] = [];
  let bucket: Word[] = [];
  let start = words[0]?.start ?? 0;
  const flush = () => {
    if (!bucket.length) return;
    lines.push(`${stamp(start)}  ${bucket.map((word) => word.text).join(" ")}`.trimEnd());
    bucket = [];
  };
  for (const word of words) {
    if (bucket.length && word.start - start >= 4) {
      flush();
      start = word.start;
    }
    bucket.push(word);
  }
  flush();
  return lines.join("\n").slice(0, 8000);
}

function line(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || fallback;
}

function beats(value: unknown): string {
  if (typeof value !== "string") return NOTE;
  const text = value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 900);
  return text || NOTE;
}

function stealFrom(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  return raw
    .map((item) => (typeof item === "string" ? item.replace(/^[-*•]\s*/, "").replace(/\s+/g, " ").trim().slice(0, 160) : ""))
    .filter(Boolean)
    .slice(0, 4);
}

function sheetFromModel(raw: string, transcript: string): Study {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Could not write the study notes.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Could not write the study notes.");
  }
  const study: Study = {
    filled: true,
    hook: line(parsed.hook, 500, NOTE),
    hookWindow: line(parsed.hookWindow, 40, ""),
    content: beats(parsed.content),
    cta: line(parsed.cta, 400, "No ask."),
    format: line(parsed.format, 80, "Unknown"),
    hookType: line(parsed.hookType, 80, "Unknown"),
    proof: line(parsed.proof, 240, NOTE),
    loop: line(parsed.loop, 240, "None"),
    captionRole: line(parsed.captionRole, 320, NOTE),
    sound: line(parsed.sound, 200, NOTE),
    pacing: line(parsed.pacing, 240, NOTE),
    pattern: line(parsed.pattern, 280, NOTE),
    steal: stealFrom(parsed.steal),
    transcript,
  };
  return study;
}

async function transcribe(audio: Uint8Array): Promise<{ text: string; words: Word[] }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("Study notes are unavailable right now.");
  const form = new FormData();
  form.append("model", "grok-voice-transcribe-2.0");
  form.append("file", new Blob([Buffer.from(audio)], { type: "application/octet-stream" }), "clip.audio");
  const response = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(70_000),
  });
  if (!response.ok) throw new Error("Could not read the speech in this one.");
  const body = (await response.json()) as {
    text?: string;
    words?: { text?: string; start?: number; end?: number }[];
  };
  const words: Word[] = [];
  for (const word of body.words ?? []) {
    if (typeof word.text !== "string" || typeof word.start !== "number" || typeof word.end !== "number") continue;
    words.push({ text: word.text, start: word.start, end: word.end });
  }
  return { text: typeof body.text === "string" ? body.text : "", words };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

async function ask(clip: Clip, transcript: string): Promise<Study> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("Study notes are unavailable right now.");
  const duration = clip.durationSec && clip.durationSec > 0 ? `${Math.round(clip.durationSec)}s` : "unknown";
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content:
            "You break down short-form competitor videos so a creator can study the cut. Use only the transcript, timestamps, title, posted caption, and sound name. You cannot see the picture. Never invent on-screen text, cuts, or B-roll. If the picture would matter, say it is not in the audio. Hook is the open, usually the first line or the first 3 seconds, until the promise is clear. Quote it. Content is the middle: steps, story, demo, or proof, as 2 to 4 short lines separated by newlines, not praise. CTA is the spoken or caption ask (follow, comment a word, save, link, share, DM). If there is no ask, write exactly “No ask.” Return JSON with keys hook, hookWindow, content, cta, format, hookType, proof, loop, captionRole, sound, pacing, pattern, steal. hookWindow looks like 0:00–0:03 from the word timestamps, or “caption” when there is no speech. format is one of Talking head, Voiceover, Text-led, Demo, Skit, Unknown. hookType is one of Question, Bold claim, Result first, POV, Controversy, Pattern interrupt, Story open, None. proof is the specific evidence, or “Not in the audio.” loop is the open loop or rewatch device, or “None”. captionRole is how the posted caption adds to or differs from the spoken words. sound says whether speech carries the video and names the track if given. pacing is one sentence on how fast the beats land, from the timestamps. pattern is one sentence, the reusable structure, with no advice voice. steal is an array of 3 short fragments a creator could reuse. Plain text only, no markdown headings.",
        },
        {
          role: "user",
          content: [
            `Platform: ${clip.platform}`,
            `Handle: @${clip.handle}`,
            `Title: ${clip.title}`,
            `Duration: ${duration}`,
            `Sound: ${clip.musicTitle || "unknown"}`,
            "Posted caption:",
            clip.caption || "(none)",
            "",
            "Timestamped transcript:",
            transcript || "(no speech detected)",
          ].join("\n"),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error("Could not write the study notes.");
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = messageText(body.choices?.[0]?.message?.content);
  if (typeof content !== "string" || !content.trim()) throw new Error("Could not write the study notes.");
  return sheetFromModel(content, transcript);
}

export async function clipTranscript(clip: Clip): Promise<string> {
  try {
    let audio: Uint8Array;
    if (clip.audioUrl) {
      audio = (await downloadMedia(clip.audioUrl)).bytes;
    } else {
      const video = await downloadMedia(clip.videoUrl);
      audio = await studyAudioFromVideo(video.bytes);
    }
    const spoken = await transcribe(audio);
    return transcriptFromWords(spoken.words, spoken.text);
  } catch (error) {
    if (error instanceof Error && error.message === "Study notes are unavailable right now.") throw error;
    return "(speech could not be read)";
  }
}

export async function studyClip(clip: Clip): Promise<Study> {
  if (!process.env.XAI_API_KEY) return blankStudy();
  const transcript = await clipTranscript(clip);
  try {
    return await ask(clip, transcript);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("That one took too long to read. Try it again.");
    }
    throw error instanceof Error ? error : new Error("Could not write the study notes.");
  }
}
