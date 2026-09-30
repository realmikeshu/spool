import { blankAdStudy, type AdStudy } from "./ad";
import { clipTranscript } from "./study.server";
import type { Clip } from "./shared";

const MISSING = "Not stated.";

function line(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || fallback;
}

function testsFrom(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  return raw
    .map((item) => (typeof item === "string" ? item.replace(/^[-*•]\s*/, "").replace(/\s+/g, " ").trim().slice(0, 140) : ""))
    .filter(Boolean)
    .slice(0, 3);
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

function sheetFromModel(raw: string, transcript: string): AdStudy {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Could not read that ad.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Could not read that ad.");
  }
  return {
    filled: true,
    hook: line(parsed.hook, 500, MISSING),
    hookWindow: line(parsed.hookWindow, 40, ""),
    offer: line(parsed.offer, 320, MISSING),
    audience: line(parsed.audience, 240, MISSING),
    objection: line(parsed.objection, 280, "None"),
    proof: line(parsed.proof, 320, MISSING),
    cta: line(parsed.cta, 400, "No ask."),
    angle: line(parsed.angle, 280, MISSING),
    format: line(parsed.format, 80, "Unknown"),
    hookType: line(parsed.hookType, 80, "Unknown"),
    mechanism: line(parsed.mechanism, 280, MISSING),
    landing: line(parsed.landing, 240, MISSING),
    fatigue: line(parsed.fatigue, 280, MISSING),
    test: testsFrom(parsed.test),
    transcript,
  };
}

const SYSTEM = [
  "You tear down paid social ads for a media buyer.",
  "Use only the transcript, timestamps, title, posted caption, sound name, and any pasted primary text.",
  "You cannot see the picture. Never invent on-screen text, prices, discounts, or claims that are not in the words.",
  "If a field is not stated, write exactly “Not stated.”",
  "Hook is the open, usually the first line or the first 3 seconds. Quote it.",
  "Offer is the specific thing being sold or promised.",
  "Audience is who the words address.",
  "Objection is the doubt the ad answers, or exactly “None”.",
  "Proof is the specific evidence in the words.",
  "CTA is the spoken or written ask. If there is no ask, write exactly “No ask.”",
  "Angle is one sentence, the strategic angle, with no advice voice.",
  "format is one of Talking head, Voiceover, Text-led, Demo, Skit, UGC, Unknown.",
  "hookType is one of Question, Bold claim, Result first, POV, Controversy, Pattern interrupt, Story open, Offer first, None.",
  "mechanism is how the product is said to work.",
  "landing is what the destination is implied to be.",
  "fatigue is one sentence on what would wear out if this ran a lot, from the words only.",
  "test is an array of 3 short concrete variants, each a different hook or offer line, not generic advice.",
  "hookWindow looks like 0:00–0:03 from the word timestamps, “caption” when there is no speech, or “copy” for a pasted ad.",
  "Return JSON with keys hook, hookWindow, offer, audience, objection, proof, cta, angle, format, hookType, mechanism, landing, fatigue, test.",
  "Plain text only, no markdown headings.",
].join(" ");

async function ask(user: string, transcript: string): Promise<AdStudy> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("Ad notes are unavailable right now.");
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
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error("Could not read that ad.");
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = messageText(body.choices?.[0]?.message?.content);
  if (!content.trim()) throw new Error("Could not read that ad.");
  return sheetFromModel(content, transcript);
}

function wrap(error: unknown): never {
  if (error instanceof Error && error.name === "TimeoutError") {
    throw new Error("That ad took too long to read. Try it again.");
  }
  throw error instanceof Error ? error : new Error("Could not read that ad.");
}

export async function studyAdClip(clip: Clip): Promise<AdStudy> {
  if (!process.env.XAI_API_KEY) return blankAdStudy();
  const transcript = await clipTranscript(clip);
  const duration = clip.durationSec && clip.durationSec > 0 ? `${Math.round(clip.durationSec)}s` : "unknown";
  const user = [
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
  ].join("\n");
  try {
    return await ask(user, transcript);
  } catch (error) {
    return wrap(error);
  }
}

export async function studyAdCopy(text: string): Promise<AdStudy> {
  if (!process.env.XAI_API_KEY) return blankAdStudy();
  const user = ["Pasted ad copy. There is no video transcript.", "", text].join("\n");
  try {
    return await ask(user, "");
  } catch (error) {
    return wrap(error);
  }
}
