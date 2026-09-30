import type { Clip } from "./shared";

export const AD_HISTORY_KEY = "spool.ads.v1";
export const AD_COPY_MIN = 24;
export const AD_COPY_MAX = 6000;

export type AdStudy = {
  filled: boolean;
  hook: string;
  hookWindow: string;
  offer: string;
  audience: string;
  objection: string;
  proof: string;
  cta: string;
  angle: string;
  format: string;
  hookType: string;
  mechanism: string;
  landing: string;
  fatigue: string;
  test: string[];
  transcript: string;
};

export type SavedAd = {
  id: string;
  savedAt: number;
  title: string;
  subtitle: string;
  study: AdStudy;
  clip: Clip | null;
  copy: string | null;
};

export function blankAdStudy(): AdStudy {
  return {
    filled: false,
    hook: "",
    hookWindow: "",
    offer: "",
    audience: "",
    objection: "",
    proof: "",
    cta: "",
    angle: "",
    format: "",
    hookType: "",
    mechanism: "",
    landing: "",
    fatigue: "",
    test: [],
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

export function adStudyFromUnknown(value: unknown): AdStudy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AdStudy>;
  if (row.filled !== true) return null;
  const test = Array.isArray(row.test)
    ? row.test.map((item) => clean(item, 140, false)).filter(Boolean).slice(0, 3)
    : [];
  const study: AdStudy = {
    filled: true,
    hook: clean(row.hook, 500, false),
    hookWindow: clean(row.hookWindow, 40, false),
    offer: clean(row.offer, 320, false),
    audience: clean(row.audience, 240, false),
    objection: clean(row.objection, 280, false),
    proof: clean(row.proof, 320, false),
    cta: clean(row.cta, 400, false),
    angle: clean(row.angle, 280, false),
    format: clean(row.format, 80, false),
    hookType: clean(row.hookType, 80, false),
    mechanism: clean(row.mechanism, 280, false),
    landing: clean(row.landing, 240, false),
    fatigue: clean(row.fatigue, 280, false),
    test,
    transcript: clean(row.transcript, 8000, true),
  };
  if (!study.hook && !study.offer && !study.cta) return null;
  return study;
}

function clipOrNull(value: unknown): Clip | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Clip>;
  if (row.ok !== true) return null;
  if (row.platform !== "tiktok" && row.platform !== "instagram" && row.platform !== "youtube") return null;
  if (typeof row.sourceUrl !== "string" || typeof row.videoUrl !== "string" || typeof row.coverUrl !== "string") return null;
  if (typeof row.title !== "string" || typeof row.handle !== "string") return null;
  return row as Clip;
}

export function savedAdFromUnknown(value: unknown): SavedAd | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SavedAd>;
  const study = adStudyFromUnknown(row.study);
  if (!study) return null;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.savedAt !== "number") return null;
  return {
    id: row.id.slice(0, 180),
    savedAt: row.savedAt,
    title: row.title.slice(0, 140),
    subtitle: typeof row.subtitle === "string" ? row.subtitle.slice(0, 80) : "",
    study,
    clip: clipOrNull(row.clip),
    copy: typeof row.copy === "string" ? row.copy.slice(0, AD_COPY_MAX) : null,
  };
}

export function adFile(title: string, subtitle: string, source: string, study: AdStudy): string {
  const head = ["SPOOL AD", subtitle, title, source, ""];
  if (!study.filled) {
    return [
      ...head,
      "HOOK",
      "The open. Quote the first line.",
      "",
      "OFFER",
      "What is being sold or promised.",
      "",
      "AUDIENCE",
      "Who the words address.",
      "",
      "OBJECTION",
      "The doubt it answers. Write “none” if it doesn’t.",
      "",
      "PROOF",
      "",
      "CTA",
      "",
      "ANGLE",
      "",
      "TEST",
      "- ",
      "- ",
      "- ",
      "",
    ].join("\n");
  }
  const tests = study.test.length ? study.test.map((line) => `- ${line}`).join("\n") : "- ";
  return [
    ...head,
    `HOOK  ${study.hookWindow || ""}`.trimEnd(),
    study.hook,
    "",
    "OFFER",
    study.offer,
    "",
    "AUDIENCE",
    study.audience,
    "",
    "OBJECTION",
    study.objection,
    "",
    "PROOF",
    study.proof,
    "",
    "CTA",
    study.cta,
    "",
    "ANGLE",
    study.angle,
    "",
    "ALSO",
    `Format: ${study.format}`,
    `Hook type: ${study.hookType}`,
    `Mechanism: ${study.mechanism}`,
    `Landing: ${study.landing}`,
    `Fatigue: ${study.fatigue}`,
    "",
    "TEST",
    tests,
    "",
    "TRANSCRIPT",
    study.transcript || "(no spoken words)",
    "",
  ].join("\n");
}

export type AngleGroup = { angle: string; offers: string[]; count: number };

export function groupAngles(studies: AdStudy[]): AngleGroup[] {
  const map = new Map<string, AngleGroup>();
  for (const study of studies) {
    const angle = study.angle.trim() || "Unstated angle";
    const row = map.get(angle) ?? { angle, offers: [], count: 0 };
    row.count += 1;
    const offer = study.offer.trim();
    if (offer && offer !== "Not stated." && offer !== "Not stated" && !row.offers.includes(offer)) {
      row.offers.push(offer);
    }
    map.set(angle, row);
  }
  return [...map.values()];
}
