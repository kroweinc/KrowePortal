"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { driver, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { buildSteps, type TourStep } from "@/lib/tour/steps";
import { setTourStatus } from "@/lib/actions/tour";

interface TutorialProviderProps {
  /** Auto-open the tour once on mount (first-visit builders, desktop only). */
  autoStart: boolean;
  /** Validated project id for deep-link steps (null when none/unowned). */
  projectId: string | null;
  hasProject: boolean;
  children: React.ReactNode;
}

// Resolves once the selector exists in the DOM, or null after `timeout` ms.
// Cross-route steps await this so driver.js highlights an element that has
// actually mounted on the destination page.
function waitForElement(selector: string, timeout = 6000): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }
    let settled = false;
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        settled = true;
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      if (!settled) {
        observer.disconnect();
        resolve(null);
      }
    }, timeout);
  });
}

export function TutorialProvider({
  autoStart,
  projectId,
  hasProject,
  children,
}: TutorialProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const driverRef = useRef<Driver | null>(null);
  const stepsRef = useRef<TourStep[]>([]);
  const tourNavRef = useRef(false); // true while the tour itself is navigating
  const finishedRef = useRef(false); // guards against double status writes
  const autoStartedRef = useRef(false);
  // Only dismiss on pathname *changes* — the effect also runs after auto-start on
  // the initial mount, which previously marked the tour dismissed before step 1.
  const prevPathnameRef = useRef(pathname);

  // Records the terminal status once and tears the overlay down. The public
  // driver.destroy() does NOT re-fire onDestroyStarted, so this never recurses.
  const finish = useCallback((status: "completed" | "dismissed") => {
    if (!finishedRef.current) {
      finishedRef.current = true;
      void setTourStatus(status);
    }
    driverRef.current?.destroy();
  }, []);

  const start = useCallback(() => {
    if (driverRef.current) return; // already running
    finishedRef.current = false;

    const steps = buildSteps({ projectId, hasProject });
    stepsRef.current = steps;

    const driveSteps: DriveStep[] = steps.map((s) => ({
      element: s.selector ? `[data-tour="${s.selector}"]` : undefined,
      popover: {
        title: s.title,
        description: s.body,
        side: s.placement ?? "bottom",
        align: "start",
      },
    }));

    const instance = driver({
      showProgress: true,
      allowClose: true,
      overlayColor: "#1a140e", // warm near-black; alpha via overlayOpacity
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 8,
      popoverClass: "krowe-tour",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      steps: driveSteps,
      onNextClick: async () => {
        const d = driverRef.current;
        if (!d) return;
        const idx = d.getActiveIndex() ?? 0;
        if (idx >= stepsRef.current.length - 1) {
          finish("completed");
          return;
        }
        const cur = stepsRef.current[idx];
        if (cur?.navigateOnNext) {
          tourNavRef.current = true;
          router.push(cur.navigateOnNext);
          const next = stepsRef.current[idx + 1];
          if (next?.selector) {
            await waitForElement(`[data-tour="${next.selector}"]`);
          }
        }
        // The tour may have been closed during the await.
        if (!driverRef.current) return;
        driverRef.current.moveNext();
      },
      onPrevClick: () => {
        // Back steps within the current route only. Cross-route transitions are
        // forward-only (navigateOnNext), so Back never needs to un-navigate.
        driverRef.current?.movePrevious();
      },
      onDestroyStarted: () => {
        // Fires for Esc / overlay click / the X button. Anything that isn't the
        // Done button (which routes through onNextClick) is a dismissal.
        finish("dismissed");
      },
      onDestroyed: () => {
        driverRef.current = null;
      },
    });

    driverRef.current = instance;
    instance.drive();
  }, [projectId, hasProject, router, finish]);

  // Auto-start once, desktop only, after the initial mount.
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    autoStartedRef.current = true;
    start();
  }, [autoStart, start]);

  // Relaunch bus — the top-bar Help button dispatches this.
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener("krowe:start-tour", onStart);
    return () => window.removeEventListener("krowe:start-tour", onStart);
  }, [start]);

  // If the user navigates away on their own mid-tour, dismiss it cleanly so no
  // orphaned overlay lingers. Tour-initiated navigations set tourNavRef first.
  useEffect(() => {
    if (!driverRef.current) {
      prevPathnameRef.current = pathname;
      return;
    }
    if (prevPathnameRef.current === pathname) return;
    prevPathnameRef.current = pathname;
    if (tourNavRef.current) {
      tourNavRef.current = false;
      return;
    }
    finish("dismissed");
  }, [pathname, finish]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
    };
  }, []);

  return <>{children}</>;
}
