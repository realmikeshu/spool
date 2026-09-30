import { createFileRoute } from "@tanstack/react-router";
import { resolveLink } from "@/lib/media/resolve.server";
import type { ClipError } from "@/lib/media/shared";

export const Route = createFileRoute("/api/resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let sourceUrl = "";
        try {
          const body = (await request.json()) as { url?: unknown };
          if (typeof body.url !== "string") {
            return Response.json({ ok: false, sourceUrl, error: "Paste a full link." } satisfies ClipError, {
              status: 400,
            });
          }
          sourceUrl = body.url.trim();
          const clip = await resolveLink(sourceUrl);
          return Response.json(clip);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not open that link.";
          return Response.json({ ok: false, sourceUrl, error: message } satisfies ClipError);
        }
      },
    },
  },
});
