import { createFileRoute } from "@tanstack/react-router";
import { captionFile, safeFilename } from "@/lib/media/shared";
import { buildPack, clipFromUnknown } from "@/lib/media/transfer.server";

export const Route = createFileRoute("/api/pack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const site = request.headers.get("sec-fetch-site");
        if (site === "cross-site") return new Response("Blocked", { status: 403 });
        try {
          const body = (await request.json()) as unknown;
          const clip = clipFromUnknown(body);
          if (!clip) return new Response("Missing pack", { status: 400 });
          const filename = safeFilename(
            typeof (body as { filename?: unknown }).filename === "string"
              ? (body as { filename: string }).filename
              : "spool-pack",
            "spool-pack",
          );
          const studyRaw = (body as { studyText?: unknown }).studyText;
          const studyText = typeof studyRaw === "string" ? studyRaw.slice(0, 20_000) : null;
          const zip = await buildPack({
            filename,
            captionText: captionFile(clip),
            coverUrl: clip.coverUrl,
            videoUrl: clip.videoUrl,
            audioUrl: clip.audioUrl,
            studyText,
          });
          return new Response(Buffer.from(zip), {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${filename}.zip"`,
              "Cache-Control": "private, no-store",
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not build that pack.";
          return new Response(message, { status: 422 });
        }
      },
    },
  },
});
