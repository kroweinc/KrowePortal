"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, GitCommitHorizontal, Globe, Lock, Pencil, Star } from "lucide-react";
import { ManualProjectForm } from "./manual-project-form";
import { LanguageBar } from "./language-bar";
import { CardActions, CardActionButton, CardGrip, CardDropLane } from "./card-actions";
import { useDragReorder } from "./use-drag-reorder";
import {
  deleteProfileProject,
  reorderProfileProjects,
  updateProfileProject,
} from "@/lib/actions/builder-profile";
import { safeExternalHref } from "@/lib/project/business-context";
import { usePrompt } from "@/components/ui/confirm-dialog";
import type { BuilderProfileProject } from "@/lib/types";

export function ProjectList({ projects }: { projects: BuilderProfileProject[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [prompt, promptDialog] = usePrompt();

  // Local mirror so a drag can paint instantly; re-seeded whenever the server
  // sends a new list (add, delete, sync).
  const [order, setOrder] = useState(projects);
  useEffect(() => setOrder(projects), [projects]);

  const { dropIndex, rowProps, laneProps } = useDragReorder({
    items: order,
    onReorder: setOrder,
    persist: reorderProfileProjects,
  });

  // Manual projects edit their live link in the edit dialog; GitHub rows are
  // otherwise read-only, so this is their only affordance for setting one.
  async function setLiveLink(project: BuilderProfileProject) {
    const value = await prompt({
      title: "Set live demo link",
      description: "Where viewers can interact with the work. Leave empty to remove.",
      placeholder: "https://your-demo.com",
      defaultValue: project.live_url ?? "",
      confirmText: "Save link",
      cancelText: "Cancel",
    });
    if (value === null) return;
    startTransition(async () => {
      const result = await updateProfileProject(project.id, { liveUrl: value.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(value.trim() ? "Live link saved." : "Live link removed.");
      router.refresh();
    });
  }

  if (order.length === 0) {
    return (
      <div className="ss-empty">
        <p>No projects added yet. Feature repos from GitHub or add one by hand.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="ss-items">
        {order.map((project, index) => {
          const isGithub = project.source === "github";
          const href = safeExternalHref(project.url);
          const liveHref = safeExternalHref(project.live_url);
          return (
            <Fragment key={project.id}>
              {dropIndex === index && <CardDropLane {...laneProps} />}
              <li
                className={`ss-item${project.is_hidden ? " hidden-item" : ""}`}
                {...rowProps(index)}
              >
                <div className="body">
                  <div className="titlerow">
                    {href ? (
                      <a className="nm" href={href} target="_blank" rel="noopener noreferrer">
                        {project.name}
                      </a>
                    ) : (
                      <span className="nm">{project.name}</span>
                    )}
                    {isGithub && (
                      <span className="ss-chip verified">
                        <CircleCheck /> Verified
                      </span>
                    )}
                    {project.github_is_private && (
                      <span className="ss-chip tech">
                        <Lock /> private
                      </span>
                    )}
                    {liveHref && (
                      <a
                        className="livelink"
                        href={liveHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Live ↗
                      </a>
                    )}
                  </div>

                  {(isGithub || (project.stars ?? 0) > 0) && (
                    <div className="meta">
                      {isGithub && (
                        <span className="ss-mediarow" style={{ gap: "var(--spacing-md)" }}>
                          <GitCommitHorizontal width={16} height={16} />
                          {(project.commit_count ?? 0).toLocaleString()} commits
                        </span>
                      )}
                      {(project.stars ?? 0) > 0 && (
                        <span className="ss-mediarow" style={{ gap: "var(--spacing-md)" }}>
                          <Star width={16} height={16} />
                          {project.stars}
                        </span>
                      )}
                    </div>
                  )}

                  {project.description && <p className="desc">{project.description}</p>}

                  <LanguageBar languages={project.languages ?? []} />

                  {project.tech.length > 0 && (
                    <div className="ss-chiprow">
                      {project.tech.map((tech) => (
                        <span key={tech} className="ss-chip tech">
                          {tech}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <CardActions
                  kind="project"
                  id={project.id}
                  hidden={project.is_hidden}
                  name={project.name}
                  deleteLabel={isGithub ? "Remove this repo" : "Remove this project"}
                  onDelete={() => deleteProfileProject(project.id)}
                >
                  {isGithub ? (
                    <CardActionButton
                      label="Set live demo link"
                      onClick={() => setLiveLink(project)}
                      disabled={isPending}
                    >
                      <Globe />
                    </CardActionButton>
                  ) : (
                    <ManualProjectForm
                      project={project}
                      trigger={
                        <button
                          type="button"
                          className="ss-cardact"
                          title="Edit project"
                          aria-label="Edit project"
                        >
                          <Pencil />
                        </button>
                      }
                    />
                  )}
                </CardActions>
                <CardGrip />
              </li>
            </Fragment>
          );
        })}
        {dropIndex === order.length && <CardDropLane {...laneProps} />}
      </ul>
      {promptDialog}
    </>
  );
}
