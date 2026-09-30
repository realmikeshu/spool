import { createFileRoute } from "@tanstack/react-router";
import { openMedia, proxyMedia } from "@/lib/media/transfer.server";

function blocked(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site";
}

export const Route = createFileRoute("/api/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (blocked(request)) return new Response("Blocked", { status: 403 });
        const url = new URL(request.url);
        const target = url.searchParams.get("u") || "";
        const name = url.searchParams.get("name") || "spool.bin";
        const inline = url.searchParams.get("inline") === "1";
        if (!target) return new Response("Missing file", { status: 400 });
        try {
          const upstream = await openMedia(target, request.headers.get("range"));
          return proxyMedia(upstream, name, inline);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not fetch that file.";
          return new Response(message, { status: 400 });
        }
      },
    },
  },
});
