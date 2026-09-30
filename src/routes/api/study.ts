import { createFileRoute } from "@tanstack/react-router";
import type { ClipError } from "@/lib/media/shared";
import { studyClip } from "@/lib/media/study.server";
import { clipFromUnknown } from "@/lib/media/transfer.server";

export const Route = createFileRoute("/api/study")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const site = request.headers.get("sec-fetch-site");
        if (site === "cross-site") return new Response("Blocked", { status: 403 });
        try {
          const body = (await request.json()) as unknown;
          const clip = clipFromUnknown(body);
          if (!clip) {
            return Response.json({ ok: false, sourceUrl: "", error: "Missing clip." } satisfies ClipError, { status: 400 });
          }
          const study = await studyClip(clip);
          if (!study.filled) {
            return Response.json({
              ok: false,
              sourceUrl: clip.sourceUrl,
              error: "Study notes are unavailable right now. The pack still includes a blank sheet.",
            } satisfies ClipError);
          }
          return Response.json({ ok: true, study });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not write the study notes.";
          return Response.json({ ok: false, sourceUrl: "", error: message } satisfies ClipError, { status: 422 });
        }
      },
    },
  },
});
