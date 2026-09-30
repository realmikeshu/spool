import { createFileRoute } from "@tanstack/react-router";
import { AdsBench } from "@/components/ads-bench";
import { SpoolBench } from "@/components/spool-bench";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "ads" ? ("ads" as const) : ("social" as const),
  }),
  component: Home,
});

function Home() {
  const { mode } = Route.useSearch();
  return mode === "ads" ? <AdsBench /> : <SpoolBench />;
}
