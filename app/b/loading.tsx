import { PageSkeleton } from "@/components/page-skeleton";

// Shown instantly while any /b page renders on the server, so clicking a sidebar
// tab gives immediate feedback instead of a frozen UI.
export default function Loading() {
  return <PageSkeleton />;
}
