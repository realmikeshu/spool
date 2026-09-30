import { createFileRoute } from "@tanstack/react-router";
import { AD_COPY_MAX, AD_COPY_MIN } from "@/lib/media/ad";
import { studyAdClip, studyAdCopy } from "@/lib/media/ad.server";
import type { ClipError } from "@/lib/media/shared";
import { clipFromUnknown } from "@/lib/media/transfer.server";

function fail(error: string, status = 422) {
  return Response.json({ ok: false, sourceUrl: "", error } satisfies ClipError, { status });
}

export const Route = createFileRoute("/api/ad-study")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const site = request.headers.get("sec-fetch-site");
        if (site === "cross-site") return new Response("Blocked", { status: 403 });
        try {
          const body = (await request.json()) as unknown;
          const kind = body && typeof body === "object" && "kind" in body ? (body as { kind?: unknown }).kind : null;
          if (kind === "copy") {
            const raw = (body as { text?: unknown }).text;
            const text = typeof raw === "string" ? raw.replace(/\u0000/g, "").trim().slice(0, AD_COPY_MAX) : "";
            if (text.length < AD_COPY_MIN) return fail("Paste a little more of the ad.", 400);
            const study = await studyAdCopy(text);
            if (!study.filled) return fail("Ad notes are unavailable right now.");
            return Response.json({ ok: true, study });
          }
          const clip = clipFromUnknown(body);
          if (!clip) return fail("Missing ad.", 400);
          const study = await studyAdClip(clip);
          if (!study.filled) {
            return Response.json({
              ok: false,
              sourceUrl: clip.sourceUrl,
              error: "Ad notes are unavailable right now.",
            } satisfies ClipError);
          }
          return Response.json({ ok: true, study });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not read that ad.";
          return fail(message);
        }
      },
    },
  },
});
