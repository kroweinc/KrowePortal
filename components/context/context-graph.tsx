"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Minus,
  Maximize,
  SlidersHorizontal,
  ChevronDown,
  X,
  Info,
  Share2,
  ArrowUpRight,
  CheckCircle2,
  GitBranch,
  GitCommitHorizontal,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import type {
  ClientGraph,
  GraphNode,
  SyncedContextMeta,
  TaskCompletionMeta,
  DocLinkRef,
} from "@/lib/actions/context-graph";
import type { DocEventKind } from "@/lib/context/document-events";
import { CATS, CAT_ORDER, catOf, noteOf, nodeColor, type CatKey } from "@/components/context/categories";
import { DocumentTimeline } from "@/components/context/document-timeline";
import { ProfileHistory } from "@/components/context/profile-history";
import { ProjectHistory } from "@/components/context/project-history";
import { TaskHistory } from "@/components/context/task-history";
import "@/components/context/context-graph.css";

/* ============================================================
   Client context graph — a warm, light, Obsidian-style force map.
   Ported from the Claude Design "Context Graph" prototype: a custom
   canvas force-simulation (flat solid discs on a dotted light stage)
   with floating glass panels — search, legend/filters, node detail,
   display settings, zoom controls — wired to the live ClientGraph.
   Category metadata (colors / icons / labels / catOf / noteOf) lives in
   ./categories so the List view renders the exact same buckets.
   ============================================================ */

function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// RAG-readiness label + tone for a document's folded-in context mirror.
function syncedStatus(s: SyncedContextMeta): {
  label: string;
  tone: "ready" | "pending" | "failed" | "skipped";
} {
  switch (s.embeddingStatus) {
    case "ready":
      return { label: `Indexed · ${s.chunkCount} chunk${s.chunkCount === 1 ? "" : "s"}`, tone: "ready" };
    case "pending":
      return { label: "Indexing…", tone: "pending" };
    case "failed":
      return { label: "Indexing failed", tone: "failed" };
    default:
      return { label: "Not indexed", tone: "skipped" };
  }
}

// Internal simulation node (the live GraphNode + mutable physics state).
interface SimNode {
  src: GraphNode;
  cat: CatKey;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
  R: number;
  adj: Set<string>;
}

interface DisplaySettings {
  repel: number;
  linkDist: number;
  center: number;
  fade: number;
  labels: boolean;
  links: boolean;
}

const DEFAULT_SETTINGS: DisplaySettings = {
  repel: 2800,
  linkDist: 58,
  center: 22,
  fade: 90,
  labels: true,
  links: true,
};

export function ContextGraph({
  graph,
  engagementId,
  showIndexStatus = false,
}: {
  graph: ClientGraph;
  engagementId: string;
  showIndexStatus?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── React state: drives the overlay UI only (the canvas reads refs) ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<CatKey, boolean>>(() => {
    const e = {} as Record<CatKey, boolean>;
    CAT_ORDER.forEach((k) => (e[k] = true));
    return e;
  });
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [zoomPct, setZoomPct] = useState(100);
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [hintGone, setHintGone] = useState(false);

  // Live id maps + adjacency (shared by the canvas closure and the detail card).
  const { byId, adj } = useMemo(() => {
    const byId = new Map<string, GraphNode>();
    graph.nodes.forEach((n) => byId.set(n.id, n));
    const adj = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    return { byId, adj };
  }, [graph]);

  const counts = useMemo(() => {
    const c = {} as Record<CatKey, number>;
    CAT_ORDER.forEach((k) => (c[k] = 0));
    graph.nodes.forEach((n) => (c[catOf(n.group)] += 1));
    return c;
  }, [graph]);

  // Refs the animation loop reads each tick without triggering re-renders.
  const ctrlRef = useRef({ enabled, settings });
  ctrlRef.current = { enabled, settings };
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // Imperative handles the overlay buttons call into the simulation.
  const apiRef = useRef<{
    zoomBy: (f: number) => void;
    fit: () => void;
    centerOn: (id: string) => void;
  } | null>(null);

  // Surviving node positions, persisted across simulation rebuilds. The effect
  // tears down and rebuilds whenever `graph` changes (e.g. a context item is
  // added or deleted in the List); seeding surviving nodes from their last
  // position means an edit nudges the map instead of re-randomizing the whole
  // layout — only the removed node vanishes.
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Last view transform (zoom/pan) + whether we've fit once, both persisted
  // across rebuilds so an add/delete keeps the user's current zoom and framing
  // instead of snapping back to fit-all.
  const viewRef = useRef<{ zoom: number; ox: number; oy: number } | null>(null);
  const fittedRef = useRef(false);

  const hasNodes = graph.nodes.length > 0;

  // Selecting from the UI (chip / search / legend): mirror to canvas + recenter.
  function selectFromUI(id: string | null, recenter = false) {
    setSelectedId(id);
    if (id && recenter) apiRef.current?.centerOn(id);
    dismissHint();
  }
  function dismissHint() {
    setHintGone(true);
  }

  // ── The canvas force-simulation (ported from the design prototype) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const stageEl = wrapRef.current;
    if (!canvas || !stageEl || graph.nodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // First time we lay this graph out vs. a rebuild after an add/delete. On a
    // rebuild the surviving nodes keep their positions, so we skip the hard
    // warm-up and start cool — just enough energy to close the gap a removed
    // node leaves, without re-throwing the whole map.
    const firstLayout = !fittedRef.current;

    let W = 0;
    let H = 0;
    let DPR = Math.min(window.devicePixelRatio || 1, 2);

    // Build sim nodes + links from the live graph.
    const nodes: SimNode[] = graph.nodes.map((src) => ({
      src,
      cat: catOf(src.group),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      deg: 0,
      R: 0,
      adj: adj.get(src.id) ?? new Set(),
    }));
    const simById = new Map<string, SimNode>();
    nodes.forEach((n) => simById.set(n.src.id, n));
    const links = graph.edges
      .map((e) => {
        const s = simById.get(e.source);
        const t = simById.get(e.target);
        if (s && t) {
          s.deg++;
          t.deg++;
        }
        return s && t ? { s, t } : null;
      })
      .filter((l): l is { s: SimNode; t: SimNode } => l !== null);
    nodes.forEach((n) => (n.R = CATS[n.cat].r * 0.6 + Math.sqrt(n.deg) * 3.6));

    // Seed positions: surviving nodes resume their last spot (so an add/delete
    // doesn't scramble the map), client at the origin, everything else radial.
    nodes.forEach((n, i) => {
      const saved = posRef.current.get(n.src.id);
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
        return;
      }
      if (n.cat === "client") {
        n.x = 0;
        n.y = 0;
        return;
      }
      const ang = (i / nodes.length) * Math.PI * 2;
      const rad =
        120 + (n.cat === "task" || n.cat === "context" ? 180 : 90) + Math.random() * 60;
      n.x = Math.cos(ang) * rad + (Math.random() - 0.5) * 40;
      n.y = Math.sin(ang) * rad + (Math.random() - 0.5) * 40;
    });

    // View transform: screen = world * zoom + offset. Resume the last view on a
    // rebuild so edits don't reset the user's zoom/pan.
    let zoom = viewRef.current?.zoom ?? 1;
    let ox = viewRef.current?.ox ?? 0;
    let oy = viewRef.current?.oy ?? 0;
    const P = { alpha: firstLayout ? 1 : 0.15 };

    // Interaction state.
    let hoverNode: SimNode | null = null;
    let dragNode: SimNode | null = null;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    let raf = 0;
    let viewAnim = 0;

    const isOn = (n: SimNode) => ctrlRef.current.enabled[n.cat];

    function resize() {
      const r = stageEl!.getBoundingClientRect();
      W = r.width;
      H = r.height;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(W * DPR);
      canvas!.height = Math.round(H * DPR);
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    const worldToScreen = (x: number, y: number) => ({ x: x * zoom + ox, y: y * zoom + oy });
    const screenToWorld = (x: number, y: number) => ({ x: (x - ox) / zoom, y: (y - oy) / zoom });

    function updateZoomLabel() {
      setZoomPct(Math.round(zoom * 100));
    }

    function animateView(tz: number, tox: number, toy: number) {
      const sz = zoom;
      const sox = ox;
      const soy = oy;
      const t0 = performance.now();
      const dur = 520;
      if (viewAnim) cancelAnimationFrame(viewAnim);
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        zoom = sz + (tz - sz) * e;
        ox = sox + (tox - sox) * e;
        oy = soy + (toy - soy) * e;
        updateZoomLabel();
        if (k < 1) viewAnim = requestAnimationFrame(step);
      };
      viewAnim = requestAnimationFrame(step);
    }

    function fitView(animate = true) {
      const ns = nodes.filter(isOn);
      if (!ns.length) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ns.forEach((n) => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x);
        maxY = Math.max(maxY, n.y);
      });
      const pad = 110;
      const gw = maxX - minX || 1;
      const gh = maxY - minY || 1;
      const z = Math.min((W - pad * 2) / gw, (H - pad * 2) / gh, 1.5);
      const tz = Math.max(0.3, z);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      // Bias right so the cluster clears the left-hand search + legend panels.
      const leftInset = W > 760 ? 280 : 0;
      const tox = (leftInset + W) / 2 - cx * tz;
      const toy = H / 2 - cy * tz;
      if (!animate) {
        zoom = tz;
        ox = tox;
        oy = toy;
        updateZoomLabel();
        return;
      }
      animateView(tz, tox, toy);
    }

    // Fit + center the first time the stage actually has a size. The graph
    // mounts hidden inside the (initially inactive) Context tab, so at boot it
    // reports 0×0 and a fit then would frame nothing; this fits the moment the
    // tab becomes visible, so the map always opens zoomed-to-fit and centered.
    function fitOnce() {
      if (fittedRef.current || W <= 0 || H <= 0) return;
      fittedRef.current = true;
      fitView(false);
    }

    function centerOn(id: string) {
      const n = simById.get(id);
      if (!n) return;
      const tz = Math.max(zoom, 1.1);
      animateView(tz, W / 2 - n.x * tz, H / 2 - n.y * tz);
    }

    function reheat(v = 1) {
      P.alpha = Math.max(P.alpha, v);
    }

    function tick() {
      const { settings: S } = ctrlRef.current;
      const active = nodes.filter(isOn);
      const n = active.length;
      let cxg = 0;
      let cyg = 0;
      for (const a of active) {
        cxg += a.x;
        cyg += a.y;
      }
      cxg /= n || 1;
      cyg /= n || 1;

      // Many-body repulsion (O(n²) — graphs here are small).
      for (let i = 0; i < n; i++) {
        const a = active[i];
        for (let j = i + 1; j < n; j++) {
          const b = active[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            d2 = 1;
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
          }
          const d = Math.sqrt(d2);
          const f = Math.min((S.repel * P.alpha) / d2, 36);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      // Spring links — rest length includes both radii so hubs sit further out.
      links.forEach((l) => {
        if (!isOn(l.s) || !isOn(l.t)) return;
        const dx = l.t.x - l.s.x;
        const dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const target = S.linkDist + l.s.R + l.t.R;
        const f = (d - target) * 0.045 * P.alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        l.s.vx += fx;
        l.s.vy += fy;
        l.t.vx -= fx;
        l.t.vy -= fy;
      });
      // Gravity toward the centroid.
      const gp = S.center * 0.0012 * P.alpha;
      for (const a of active) {
        a.vx += (cxg - a.x) * gp;
        a.vy += (cyg - a.y) * gp;
      }
      // Integrate with a velocity clamp.
      for (const a of active) {
        if (a === dragNode) {
          a.vx = 0;
          a.vy = 0;
          continue;
        }
        a.vx *= 0.84;
        a.vy *= 0.84;
        const sp = Math.hypot(a.vx, a.vy);
        if (sp > 14) {
          a.vx = (a.vx / sp) * 14;
          a.vy = (a.vy / sp) * 14;
        }
        a.x += a.vx;
        a.y += a.vy;
      }
      // Collision relaxation — even, non-overlapping spacing.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const a = active[i];
          for (let j = i + 1; j < n; j++) {
            const b = active[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 0.01;
            const min = a.R + b.R + 10;
            if (d < min) {
              const push = (min - d) * 0.5;
              const ux = dx / d;
              const uy = dy / d;
              if (a !== dragNode) {
                a.x -= ux * push;
                a.y -= uy * push;
              }
              if (b !== dragNode) {
                b.x += ux * push;
                b.y += uy * push;
              }
            }
          }
        }
      }
      P.alpha += (0.04 - P.alpha) * 0.02;
      if (P.alpha < 0.05) P.alpha = 0.05;
    }

    function draw() {
      const { settings: S } = ctrlRef.current;
      ctx!.clearRect(0, 0, W, H); // transparent — the dotted stage shows through

      const selId = selectedIdRef.current;
      const selNode = selId ? simById.get(selId) ?? null : null;
      const focus = hoverNode || selNode;
      const focusSet = focus ? new Set<string>([focus.src.id, ...focus.adj]) : null;

      // Links — warm-neutral on the light canvas.
      if (S.links) {
        ctx!.lineCap = "round";
        links.forEach((l) => {
          if (!isOn(l.s) || !isOn(l.t)) return;
          const s = worldToScreen(l.s.x, l.s.y);
          const t = worldToScreen(l.t.x, l.t.y);
          const inFocus = focusSet && (l.s === focus || l.t === focus);
          let alpha: number;
          let color: string;
          let width: number;
          if (!focusSet) {
            alpha = 0.26;
            color = "128,116,102";
            width = 1;
          } else if (inFocus) {
            const c = hexToRgb(CATS[focus!.cat].color);
            color = `${c.r},${c.g},${c.b}`;
            alpha = 0.85;
            width = 1.6;
          } else {
            alpha = 0.09;
            color = "128,116,102";
            width = 1;
          }
          ctx!.strokeStyle = `rgba(${color},${alpha})`;
          ctx!.lineWidth = width;
          ctx!.beginPath();
          ctx!.moveTo(s.x, s.y);
          ctx!.lineTo(t.x, t.y);
          ctx!.stroke();
        });
      }

      // Nodes — flat solid discs with a hairline rim.
      nodes.forEach((n) => {
        if (!isOn(n)) return;
        const s = worldToScreen(n.x, n.y);
        const R = n.R * zoom;
        const dim = focusSet && !focusSet.has(n.src.id);
        const isFocus = focus === n;
        const col = nodeColor(n.src); // done tasks render green; everything else by category
        const rgb = hexToRgb(col);

        ctx!.globalAlpha = dim ? 0.26 : 1;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, R, 0, Math.PI * 2);
        ctx!.fillStyle = col;
        ctx!.fill();

        ctx!.lineWidth = 1;
        ctx!.strokeStyle = "rgba(40,30,20,0.12)";
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, Math.max(0, R - 0.5), 0, Math.PI * 2);
        ctx!.stroke();

        if (isFocus || selNode === n) {
          ctx!.globalAlpha = 1;
          ctx!.strokeStyle =
            selNode === n ? "rgba(32,26,20,0.85)" : `rgba(${rgb.r},${rgb.g},${rgb.b},1)`;
          ctx!.lineWidth = 2;
          ctx!.beginPath();
          ctx!.arc(s.x, s.y, R + 4.5, 0, Math.PI * 2);
          ctx!.stroke();
        }
        ctx!.globalAlpha = 1;
      });

      // Labels — dark text with a light halo, level-of-detail + de-collided.
      if (S.labels) {
        ctx!.textAlign = "center";
        ctx!.textBaseline = "top";
        const placed: { x: number; y: number; w: number; h: number }[] = [];
        const order = nodes
          .filter(isOn)
          .slice()
          .sort((a, b) => b.R - a.R);
        order.forEach((n) => {
          const s = worldToScreen(n.x, n.y);
          const R = n.R * zoom;
          const dim = focusSet && !focusSet.has(n.src.id);
          const inFocus = focusSet && focusSet.has(n.src.id);
          const important = n.cat === "client" || n.cat === "project";
          const big = R >= (S.fade / 100) * 12;
          const show = inFocus || important || n === hoverNode || (big && !focusSet);
          if (!show) return;
          let a = 1;
          if (!focusSet && !important && n !== hoverNode) {
            a = Math.max(0, Math.min(1, (R - (S.fade / 100) * 9) / 8));
          }
          if (a <= 0.02) return;
          if (dim) a = 0.34;
          const fs = Math.max(10.5, Math.min(15, 9 + R * 0.3));
          ctx!.font = `${important ? 600 : 500} ${fs}px Geist, var(--font-sans), sans-serif`;
          const txt = n.src.label;
          const tw = ctx!.measureText(txt).width;
          const lx = s.x;
          const ly = s.y + R + 7;
          const rect = { x: lx - tw / 2 - 4, y: ly - 2, w: tw + 8, h: fs + 5 };
          if (!inFocus && n !== hoverNode) {
            const clash = placed.some(
              (p) =>
                !(
                  rect.x > p.x + p.w ||
                  rect.x + rect.w < p.x ||
                  rect.y > p.y + p.h ||
                  rect.y + rect.h < p.y
                )
            );
            if (clash) return;
          }
          placed.push(rect);
          ctx!.globalAlpha = a;
          ctx!.shadowColor = "rgba(255,250,244,0.95)";
          ctx!.shadowBlur = 7;
          ctx!.fillStyle =
            n === hoverNode || selNode === n ? "#17120c" : "rgba(58,49,39,0.95)";
          ctx!.fillText(txt, lx, ly);
          ctx!.shadowBlur = 0;
          ctx!.fillText(txt, lx, ly);
          ctx!.globalAlpha = 1;
        });
      }
    }

    function loop() {
      tick();
      draw();
      // Remember where everything settled, and the current view, so the next
      // rebuild resumes from here instead of re-laying-out / re-fitting.
      for (const n of nodes) posRef.current.set(n.src.id, { x: n.x, y: n.y });
      viewRef.current = { zoom, ox, oy };
      raf = requestAnimationFrame(loop);
    }

    function nodeAt(sx: number, sy: number): SimNode | null {
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        if (!isOn(n)) continue;
        const s = worldToScreen(n.x, n.y);
        const R = n.R * zoom + 5;
        const dx = sx - s.x;
        const dy = sy - s.y;
        const d = dx * dx + dy * dy;
        if (d <= R * R && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }

    const localPos = (e: PointerEvent | WheelEvent) => {
      const r = canvas!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      const p = localPos(e);
      const n = nodeAt(p.x, p.y);
      moved = false;
      lastX = p.x;
      lastY = p.y;
      if (n) {
        dragNode = n;
        reheat(0.7);
      } else {
        panning = true;
        canvas!.classList.add("is-grabbing");
      }
    }
    function onPointerMove(e: PointerEvent) {
      const p = localPos(e);
      if (dragNode) {
        const w = screenToWorld(p.x, p.y);
        dragNode.x = w.x;
        dragNode.y = w.y;
        dragNode.vx = 0;
        dragNode.vy = 0;
        reheat(0.5);
        moved = true;
        return;
      }
      if (panning) {
        ox += p.x - lastX;
        oy += p.y - lastY;
        lastX = p.x;
        lastY = p.y;
        moved = true;
        return;
      }
      const n = nodeAt(p.x, p.y);
      if (n !== hoverNode) {
        hoverNode = n;
        canvas!.classList.toggle("is-pointing", !!n);
      }
    }
    function onPointerUp() {
      if (dragNode && !moved) {
        setSelectedId(dragNode.src.id);
        setHintGone(true);
      } else if (panning && !moved) {
        setSelectedId(null);
      }
      dragNode = null;
      panning = false;
      canvas!.classList.remove("is-grabbing");
    }
    function onPointerLeave() {
      hoverNode = null;
      canvas!.classList.remove("is-pointing");
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const p = localPos(e);
      const w = screenToWorld(p.x, p.y);
      const factor = Math.exp(-e.deltaY * 0.0014);
      const nz = Math.max(0.3, Math.min(4, zoom * factor));
      ox = p.x - w.x * nz;
      oy = p.y - w.y * nz;
      zoom = nz;
      updateZoomLabel();
      setHintGone(true);
    }

    function zoomBy(f: number) {
      const cx = W / 2;
      const cy = H / 2;
      const w = screenToWorld(cx, cy);
      const nz = Math.max(0.3, Math.min(4, zoom * f));
      ox = cx - w.x * nz;
      oy = cy - w.y * nz;
      zoom = nz;
      updateZoomLabel();
    }

    // Expose the imperative API the overlays drive.
    apiRef.current = { zoomBy, fit: () => fitView(true), centerOn };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Resize the canvas on container changes, and fit the first time the stage
    // gains a real size (i.e. when the Context tab is opened after mount).
    const ro = new ResizeObserver(() => {
      resize();
      fitOnce();
    });
    ro.observe(stageEl);

    // Boot: size, warm the sim (first layout only), fit (if already visible),
    // then run. A rebuild after an edit skips the hard warm-up and re-fit so the
    // map keeps its current positions, zoom, and framing.
    resize();
    updateZoomLabel();
    if (firstLayout) for (let i = 0; i < 340; i++) tick();
    fitOnce();
    reheat(firstLayout ? 0.8 : 0.3);
    loop();

    return () => {
      cancelAnimationFrame(raf);
      if (viewAnim) cancelAnimationFrame(viewAnim);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      apiRef.current = null;
    };
  }, [graph, adj]);

  // Auto-dismiss the hint pill.
  useEffect(() => {
    const t = setTimeout(() => setHintGone(true), 6500);
    return () => clearTimeout(t);
  }, []);

  // "/" focuses search, Escape clears — only while the stage is on screen, so
  // it never hijacks typing elsewhere on the engagement page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const editing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (e.key === "Escape") {
        setSelectedId(null);
        searchRef.current?.blur();
        return;
      }
      if (e.key === "/" && !editing) {
        const r = wrapRef.current?.getBoundingClientRect();
        const visible =
          r && r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
        if (visible) {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Run a search: jump to + select the first label match.
  function runSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit = graph.nodes.find(
      (n) => enabled[catOf(n.group)] && n.label.toLowerCase().includes(q)
    );
    if (hit) {
      selectFromUI(hit.id, true);
      searchRef.current?.blur();
    }
  }

  function toggleType(k: CatKey) {
    setEnabled((e) => ({ ...e, [k]: !e[k] }));
  }
  function allTypes(on: boolean) {
    setEnabled(() => {
      const e = {} as Record<CatKey, boolean>;
      // "None" keeps the client pinned so the map never goes fully empty.
      CAT_ORDER.forEach((k) => (e[k] = on ? true : k === "client"));
      return e;
    });
  }

  const allOn = CAT_ORDER.every((k) => enabled[k]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const selectedCat = selected ? catOf(selected.group) : null;
  // The selected node's render color (done tasks are green) — drives the kind swatch.
  const selectedColor = selected ? nodeColor(selected) : null;
  // A done task carries its completion context (duration, materials, commits) on meta.
  const taskCompletion =
    selected?.type === "task" && selected.meta?.completion
      ? (selected.meta.completion as unknown as TaskCompletionMeta)
      : null;
  const selectedNeighbors = selectedId
    ? [...(adj.get(selectedId) ?? [])].map((id) => byId.get(id)).filter((n): n is GraphNode => !!n)
    : [];
  const selectedHref = typeof selected?.meta?.href === "string" ? (selected.meta.href as string) : null;
  // A document or person node — and a task / milestone node — carries its synced
  // context mirror (embedding status + text preview) on meta, surfaced inline
  // instead of as a separate graph node.
  const syncedContext =
    (selected?.type === "document" ||
      selected?.type === "person" ||
      selected?.type === "task" ||
      selected?.type === "milestone") &&
    selected.meta?.syncedContext
      ? (selected.meta.syncedContext as unknown as SyncedContextMeta)
      : null;
  const syncedInfo = syncedContext ? syncedStatus(syncedContext) : null;

  // Quote↔PRD provenance folded onto the document node's meta. On a quote:
  // the single PRD it was priced from. On a PRD: the quotes priced from it.
  // Both render as labeled chips that jump to the linked node, so the wiring
  // reads as "generated with this specific PRD" rather than a bare edge.
  const sourcePrd =
    selected?.type === "document" && selected.meta?.sourcePrd
      ? (selected.meta.sourcePrd as unknown as DocLinkRef)
      : null;
  const derivedQuotes =
    selected?.type === "document" && Array.isArray(selected.meta?.derivedQuotes)
      ? (selected.meta.derivedQuotes as unknown as DocLinkRef[])
      : [];

  return (
    <div className="ctx-stage" ref={wrapRef}>
      {!hasNodes && (
        <div className="ctx-graph-empty">
          Nothing to map yet — once this client has documents, tasks, or context, they&apos;ll
          appear here.
        </div>
      )}

      {hasNodes && <canvas ref={canvasRef} className="ctx-graph-canvas" />}

      {hasNodes && (
        <>
          {/* search */}
          <div className="ctx-panel ctx-search">
            <Search size={16} strokeWidth={1.9} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Find in context…"
            />
            <kbd>/</kbd>
          </div>

          {/* legend / filters — collapsible dropdown */}
          <div className={`ctx-panel ctx-legend${legendOpen ? " open" : ""}`}>
            <button
              type="button"
              className="ctx-lg-toggle"
              aria-expanded={legendOpen}
              onClick={() => setLegendOpen((v) => !v)}
            >
              <span className="ctx-lg-title">Legend</span>
              {!allOn && <span className="ctx-lg-dot" title="Filters applied" aria-hidden="true" />}
              <ChevronDown className="ctx-lg-chev" size={15} strokeWidth={2} />
            </button>
            <div className="ctx-lg-body-wrap">
              <div className="ctx-lg-body">
                <div className="ctx-lg-actions">
                  <button type="button" onClick={() => allTypes(true)}>
                    All
                  </button>
                  <button type="button" onClick={() => allTypes(false)}>
                    None
                  </button>
                </div>
                <div className="ctx-lg-grid">
                  {CAT_ORDER.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`ctx-lg-item${enabled[k] ? "" : " off"}`}
                      style={{ ["--sw-c" as string]: CATS[k].color }}
                      onClick={() => toggleType(k)}
                    >
                      <span className="sw" style={{ background: CATS[k].color }} />
                      {CATS[k].label}
                      <span className="ct">{counts[k]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* node detail */}
          {selected && selectedCat && (
            <div className="ctx-panel ctx-detail show">
              <div className="ctx-detail-scroll">
                <div className="ctx-gd-top">
                  <span
                    className="ctx-gd-kind"
                    style={{ color: selectedColor ?? CATS[selectedCat].color }}
                  >
                    <span
                      className="sw"
                      style={{ background: selectedColor ?? CATS[selectedCat].color }}
                    />
                    {selectedCat === "task" && selected.status === "done"
                      ? "Task · Done"
                      : CATS[selectedCat].label}
                  </span>
                  <button
                    type="button"
                    className="ctx-gd-close"
                    aria-label="Close"
                    onClick={() => setSelectedId(null)}
                  >
                    <X size={15} strokeWidth={2} />
                  </button>
                  <div className="ctx-gd-name">{selected.label}</div>
                </div>

                <div className="ctx-gd-meta">
                  <div className="ctx-gd-row">
                    <Info size={14} strokeWidth={1.9} />
                    {noteOf(selected)}
                  </div>
                  <div className="ctx-gd-row">
                    <Share2 size={14} strokeWidth={1.9} />
                    <b>{selectedNeighbors.length}</b> connection
                    {selectedNeighbors.length === 1 ? "" : "s"}
                  </div>
                </div>

                {/* Quote node → the one PRD it was priced from. A purpose-built
                    lineage block (accented source card → flow → this node) so the
                    wiring reads "generated with this specific PRD", not a bare edge. */}
                {sourcePrd && selected && (
                  <div className="ctx-gd-lineage">
                    <div className="ctx-gd-links-h">Generated from</div>
                    <ProvCard
                      title={sourcePrd.title}
                      typeLabel="PRD"
                      status={sourcePrd.status}
                      color={
                        byId.has(sourcePrd.nodeId)
                          ? nodeColor(byId.get(sourcePrd.nodeId)!)
                          : CATS.prd.color
                      }
                      Icon={CATS.prd.Icon}
                      onClick={() => selectFromUI(sourcePrd.nodeId, true)}
                    />
                    <div className="ctx-gd-flow">
                      <span className="ctx-gd-flow-rail" aria-hidden="true" />
                      <span className="ctx-gd-flow-txt">generated this quote</span>
                    </div>
                    <div className="ctx-gd-prov-self">
                      <span className="sw" style={{ background: selectedColor ?? CATS.quote.color }} />
                      <span className="nm">{selected.label}</span>
                    </div>
                  </div>
                )}

                {/* PRD node → every quote priced from it (reverse lineage). */}
                {derivedQuotes.length > 0 && selected && (
                  <div className="ctx-gd-lineage">
                    <div className="ctx-gd-links-h">
                      Quote{derivedQuotes.length === 1 ? "" : "s"} priced from this
                    </div>
                    <div className="ctx-gd-prov-self">
                      <span className="sw" style={{ background: selectedColor ?? CATS.prd.color }} />
                      <span className="nm">{selected.label}</span>
                    </div>
                    <div className="ctx-gd-flow">
                      <span className="ctx-gd-flow-rail" aria-hidden="true" />
                      <span className="ctx-gd-flow-txt">
                        priced into{" "}
                        {derivedQuotes.length === 1
                          ? "this quote"
                          : `these ${derivedQuotes.length} quotes`}
                      </span>
                    </div>
                    <div className="ctx-gd-prov-group">
                      {derivedQuotes.map((q) => (
                        <ProvCard
                          key={q.nodeId}
                          title={q.title}
                          typeLabel="Quote"
                          status={q.status}
                          color={
                            byId.has(q.nodeId) ? nodeColor(byId.get(q.nodeId)!) : CATS.quote.color
                          }
                          Icon={CATS.quote.Icon}
                          onClick={() => selectFromUI(q.nodeId, true)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {selectedNeighbors.length > 0 && (
                  <div className="ctx-gd-links">
                    <div className="ctx-gd-links-h">Connected to</div>
                    {selectedNeighbors.map((m) => {
                      const mc = catOf(m.group);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className="ctx-gd-chip"
                          onClick={() => selectFromUI(m.id, true)}
                        >
                          <span className="sw" style={{ background: nodeColor(m) }} />
                          <span className="nm">{m.label}</span>
                          <span className="ty">{CATS[mc].label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedHref && (
                  <Link href={selectedHref} className="ctx-gd-open">
                    <ArrowUpRight size={14} strokeWidth={2} />
                    Open {CATS[selectedCat].label.toLowerCase()}
                  </Link>
                )}

                {taskCompletion && (
                  <div className="ctx-gd-completed">
                    <div className="ctx-gd-links-h">Completed</div>
                    <div className="ctx-gd-completed-stat">
                      <CheckCircle2 size={14} strokeWidth={2} />
                      <span>
                        Done
                        {taskCompletion.durationLabel ? (
                          <>
                            {" "}
                            in <b>{taskCompletion.durationLabel}</b>
                          </>
                        ) : null}
                      </span>
                    </div>
                    {taskCompletion.pushedToMain && (
                      <div className="ctx-gd-completed-stat sub">
                        <GitBranch size={13} strokeWidth={2} />
                        <span>Pushed to main</span>
                      </div>
                    )}
                    {taskCompletion.note && (
                      <p className="ctx-gd-completed-note">{taskCompletion.note}</p>
                    )}
                    {taskCompletion.deliverables.length > 0 && (
                      <div className="ctx-gd-completed-grp">
                        <div className="ctx-gd-completed-sub-h">Materials</div>
                        {taskCompletion.deliverables.map((d, i) => (
                          <div key={i} className="ctx-gd-completed-item">
                            <Paperclip size={12} strokeWidth={2} />
                            {d.url ? (
                              <a href={d.url} target="_blank" rel="noreferrer" className="nm">
                                {d.name}
                              </a>
                            ) : (
                              <span className="nm">{d.name}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {taskCompletion.commits.length > 0 && (
                      <div className="ctx-gd-completed-grp">
                        <div className="ctx-gd-completed-sub-h">Commits</div>
                        {taskCompletion.commits.map((c, i) => (
                          <div key={i} className="ctx-gd-completed-item commit">
                            <GitCommitHorizontal size={13} strokeWidth={2} />
                            <code className="sha">{c.shortSha}</code>
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noreferrer" className="msg">
                                {c.message || "(no message)"}
                              </a>
                            ) : (
                              <span className="msg">{c.message || "(no message)"}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selected.type === "task" && selected.meta?.taskId ? (
                  <div className="ctx-gd-timeline">
                    <div className="ctx-gd-links-h">History</div>
                    <TaskHistory engagementId={engagementId} taskId={selected.meta.taskId as string} />
                  </div>
                ) : null}

                {syncedContext ? (
                  <div className="ctx-gd-synced">
                    <div className="ctx-gd-links-h">
                      {selected.type === "person" ? "Profile" : "In AI context"}
                    </div>
                    {/* The RAG-readiness badge is plumbing — keep it behind the
                        Index status toggle. The content preview itself is the
                        point of clicking the node (a person's profile, a
                        document's mirror), so it always shows. */}
                    {showIndexStatus && syncedInfo && (
                      <div className={`ctx-gd-synced-status tone-${syncedInfo.tone}`}>
                        <span className="ctx-gd-synced-dot" />
                        {syncedInfo.label}
                      </div>
                    )}
                    {syncedContext.preview.trim() && (
                      <pre className="ctx-gd-synced-preview">{syncedContext.preview.trim()}</pre>
                    )}
                  </div>
                ) : null}

                {selected.type === "document" && selected.meta?.docId ? (
                  <div className="ctx-gd-timeline">
                    <div className="ctx-gd-links-h">History</div>
                    <DocumentTimeline
                      docKind={selected.meta.docKind as DocEventKind}
                      docId={selected.meta.docId as string}
                      engagementId={engagementId}
                    />
                  </div>
                ) : null}

                {selected.type === "person" &&
                (selectedCat === "builder" || selectedCat === "operator") ? (
                  <div className="ctx-gd-timeline">
                    <div className="ctx-gd-links-h">History</div>
                    <ProfileHistory engagementId={engagementId} role={selectedCat} />
                  </div>
                ) : null}

                {selected.type === "project" ? (
                  <div className="ctx-gd-timeline">
                    <div className="ctx-gd-links-h">History</div>
                    <ProjectHistory engagementId={engagementId} />
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* settings */}
          {showSettings && (
            <div className="ctx-panel ctx-settings show">
              <div className="ctx-gs-head">
                <span className="t">Display</span>
                <button type="button" aria-label="Close" onClick={() => setShowSettings(false)}>
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
              <div className="ctx-gs-body">
                <div className="ctx-gs-sec">
                  <div className="ctx-gs-sec-t">Forces</div>
                  <Slider
                    label="Repel force"
                    min={800}
                    max={6000}
                    step={50}
                    value={settings.repel}
                    fmt={(v) => `${Math.round(v)}`}
                    onChange={(v) => setSettings((s) => ({ ...s, repel: v }))}
                  />
                  <Slider
                    label="Link distance"
                    min={20}
                    max={160}
                    step={2}
                    value={settings.linkDist}
                    fmt={(v) => `${v}px`}
                    onChange={(v) => setSettings((s) => ({ ...s, linkDist: v }))}
                  />
                  <Slider
                    label="Center pull"
                    min={0}
                    max={100}
                    step={1}
                    value={settings.center}
                    fmt={(v) => `${v}%`}
                    onChange={(v) => setSettings((s) => ({ ...s, center: v }))}
                  />
                </div>
                <div className="ctx-gs-sec">
                  <div className="ctx-gs-sec-t">Display</div>
                  <Toggle
                    label="Show labels"
                    on={settings.labels}
                    onClick={() => setSettings((s) => ({ ...s, labels: !s.labels }))}
                  />
                  <Slider
                    label="Label fade"
                    min={20}
                    max={220}
                    step={5}
                    value={settings.fade}
                    fmt={(v) => `${v}%`}
                    onChange={(v) => setSettings((s) => ({ ...s, fade: v }))}
                  />
                  <Toggle
                    label="Link lines"
                    on={settings.links}
                    onClick={() => setSettings((s) => ({ ...s, links: !s.links }))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* zoom controls */}
          <div className="ctx-panel ctx-controls">
            <button type="button" title="Zoom out" onClick={() => apiRef.current?.zoomBy(0.8)}>
              <Minus size={17} strokeWidth={1.9} />
            </button>
            <span className="ctx-zlabel">{zoomPct}%</span>
            <button type="button" title="Zoom in" onClick={() => apiRef.current?.zoomBy(1.25)}>
              <Plus size={17} strokeWidth={1.9} />
            </button>
            <span className="ctx-ctrl-sep" />
            <button type="button" title="Fit to view" onClick={() => apiRef.current?.fit()}>
              <Maximize size={16} strokeWidth={1.9} />
            </button>
          </div>

          {!showSettings && (
            <button
              type="button"
              className="ctx-panel ctx-gear"
              title="Display settings"
              onClick={() => setShowSettings(true)}
            >
              <SlidersHorizontal size={17} strokeWidth={1.9} />
            </button>
          )}

          <div className={`ctx-hint${hintGone ? " gone" : ""}`}>
            <Ember className="em" />
            Scroll to zoom · drag the canvas to pan · click a node to focus
          </div>
        </>
      )}
    </div>
  );
}

// One source/derived document in a provenance lineage: an accent-tinted card
// (icon badge + name + type · status + a navigate arrow) that jumps to the
// linked node on click. The `--prov-c` accent is the linked doc's render color.
function ProvCard({
  title,
  typeLabel,
  status,
  color,
  Icon,
  onClick,
}: {
  title: string;
  typeLabel: string;
  status: string | null;
  color: string;
  Icon: LucideIcon;
  onClick: () => void;
}) {
  const statusLabel = status ? status.replace(/_/g, " ") : null;
  return (
    <button
      type="button"
      className="ctx-gd-prov"
      style={{ ["--prov-c" as string]: color }}
      onClick={onClick}
    >
      <span className="ctx-gd-prov-ico">
        <Icon size={15} strokeWidth={2} />
      </span>
      <span className="ctx-gd-prov-main">
        <span className="ctx-gd-prov-name">{title}</span>
        <span className="ctx-gd-prov-sub">
          {typeLabel}
          {statusLabel ? (
            <>
              {" · "}
              <span className="ctx-gd-prov-status">{statusLabel}</span>
            </>
          ) : null}
        </span>
      </span>
      <ArrowUpRight className="ctx-gd-prov-go" size={14} strokeWidth={2} />
    </button>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  fmt,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="ctx-gs-ctl">
      <div className="ctx-gs-lab">
        <span>{label}</span>
        <span className="v">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="ctx-gs-toggle">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`ctx-sw-track${on ? " on" : ""}`}
        onClick={onClick}
      />
    </div>
  );
}

// The little ember mark from the design (matches the section header glyph).
function Ember({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="var(--primary)" opacity="0.2" />
      <circle cx="8" cy="8" r="4" fill="var(--primary)" opacity="0.4" />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle cx="9" cy="7" r="1" fill="var(--primary-accent)" />
    </svg>
  );
}
