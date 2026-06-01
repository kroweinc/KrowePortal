import { redirect } from "next/navigation";

// Quotes are now created inside a project (outbound model). The standalone
// engagement-brief creation flow is retired; send builders to Projects.
export default function NewBriefRedirect() {
  redirect("/b/projects");
}
