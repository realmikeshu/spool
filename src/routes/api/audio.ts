import { createFileRoute } from "@tanstack/react-router";
import { safeFilename } from "@/lib/media/shared";
import { extractAudio } from "@/lib/media/transfer.server";

export const Route = createFileRoute("/api/audio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const site = request.headers.get("sec-fetch-site");
        if (site === "cross-site") return new Response("Blocked", { status: 403 });
        const target = new URL(request.url).searchParams.get("u") || "";
        const name = safeFilename(new URL(request.url).searchParams.get("name") || "audio.aac", "audio.aac");
        if (!target) return new Response("Missing video", { status: 400 });
        try {
          const bytes = await extractAudio(target);
          return new Response(Buffer.from(bytes), {
            headers: {
              "Content-Type": "audio/aac",
              "Content-Disposition": `attachment; filename="${name}"`,
              "Cache-Control": "private, max-age=120",
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not separate the audio.";
          return new Response(message, { status: 422 });
        }
      },
    },
  },
});
