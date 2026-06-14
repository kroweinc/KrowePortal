import {
  siAngular,
  siAnthropic,
  siAstro,
  siBootstrap,
  siBun,
  siC,
  siChakraui,
  siClaude,
  siCloudflare,
  siContentful,
  siCplusplus,
  siCss,
  siDart,
  siDeno,
  siDjango,
  siDocker,
  siDotnet,
  siElectron,
  siElixir,
  siExpo,
  siExpress,
  siFastapi,
  siFigma,
  siFirebase,
  siFlask,
  siFlutter,
  siFramer,
  siGit,
  siGithub,
  siGitlab,
  siGo,
  siGooglecloud,
  siGraphql,
  siHtml5,
  siHuggingface,
  siJavascript,
  siJest,
  siJquery,
  siKotlin,
  siKubernetes,
  siLangchain,
  siLaravel,
  siMongodb,
  siMui,
  siMysql,
  siNetlify,
  siNextdotjs,
  siNodedotjs,
  siNuxt,
  siPhp,
  siPostgresql,
  siPrisma,
  siPython,
  siPytorch,
  siR,
  siReact,
  siReactrouter,
  siRedis,
  siRedux,
  siRemix,
  siRuby,
  siRubyonrails,
  siRust,
  siSanity,
  siSass,
  siScala,
  siShopify,
  siStrapi,
  siStripe,
  siSupabase,
  siSvelte,
  siSwift,
  siTailwindcss,
  siTensorflow,
  siThreedotjs,
  siTypescript,
  siVercel,
  siVite,
  siVitest,
  siVuedotjs,
  siWebpack,
  siWordpress,
  siZod,
  type SimpleIcon,
} from "simple-icons";

// Map of common project technologies to their official brand icons (simple-icons).
// Each entry lists the simple-icons glyph plus the free-text aliases a builder might
// type. Aliases are matched case-insensitively after stripping non-alphanumerics,
// so "Next.js", "nextjs", and "NEXT" all resolve to the same logo.
const TECH_ENTRIES: { icon: SimpleIcon; aliases: string[] }[] = [
  { icon: siNextdotjs, aliases: ["nextjs", "next"] },
  { icon: siReact, aliases: ["react", "reactjs"] },
  { icon: siReactrouter, aliases: ["reactrouter"] },
  { icon: siVuedotjs, aliases: ["vue", "vuejs"] },
  { icon: siNuxt, aliases: ["nuxt", "nuxtjs"] },
  { icon: siAngular, aliases: ["angular", "angularjs"] },
  { icon: siSvelte, aliases: ["svelte", "sveltekit"] },
  { icon: siAstro, aliases: ["astro"] },
  { icon: siRemix, aliases: ["remix"] },
  { icon: siThreedotjs, aliases: ["threejs", "three", "threedotjs"] },
  { icon: siRedux, aliases: ["redux"] },
  { icon: siFramer, aliases: ["framer", "framermotion"] },
  { icon: siTypescript, aliases: ["typescript", "ts"] },
  { icon: siJavascript, aliases: ["javascript", "js"] },
  { icon: siNodedotjs, aliases: ["nodejs", "node"] },
  { icon: siExpress, aliases: ["express", "expressjs"] },
  { icon: siBun, aliases: ["bun"] },
  { icon: siDeno, aliases: ["deno"] },
  { icon: siPython, aliases: ["python", "py"] },
  { icon: siDjango, aliases: ["django"] },
  { icon: siFlask, aliases: ["flask"] },
  { icon: siFastapi, aliases: ["fastapi"] },
  { icon: siPhp, aliases: ["php"] },
  { icon: siLaravel, aliases: ["laravel"] },
  { icon: siRuby, aliases: ["ruby"] },
  { icon: siRubyonrails, aliases: ["rails", "rubyonrails", "ror"] },
  { icon: siGo, aliases: ["go", "golang"] },
  { icon: siRust, aliases: ["rust"] },
  { icon: siC, aliases: ["c"] },
  { icon: siCplusplus, aliases: ["cplusplus", "cpp"] },
  { icon: siDotnet, aliases: ["dotnet", "net"] },
  { icon: siKotlin, aliases: ["kotlin"] },
  { icon: siSwift, aliases: ["swift", "swiftui"] },
  { icon: siDart, aliases: ["dart"] },
  { icon: siFlutter, aliases: ["flutter"] },
  { icon: siElixir, aliases: ["elixir"] },
  { icon: siScala, aliases: ["scala"] },
  { icon: siR, aliases: ["r"] },
  { icon: siHtml5, aliases: ["html", "html5"] },
  { icon: siCss, aliases: ["css", "css3"] },
  { icon: siSass, aliases: ["sass", "scss"] },
  { icon: siTailwindcss, aliases: ["tailwindcss", "tailwind"] },
  { icon: siBootstrap, aliases: ["bootstrap"] },
  { icon: siMui, aliases: ["mui", "materialui"] },
  { icon: siChakraui, aliases: ["chakraui", "chakra"] },
  { icon: siJquery, aliases: ["jquery"] },
  { icon: siPostgresql, aliases: ["postgresql", "postgres", "psql"] },
  { icon: siMysql, aliases: ["mysql"] },
  { icon: siMongodb, aliases: ["mongodb", "mongo"] },
  { icon: siRedis, aliases: ["redis"] },
  { icon: siPrisma, aliases: ["prisma"] },
  { icon: siGraphql, aliases: ["graphql", "gql"] },
  { icon: siSupabase, aliases: ["supabase"] },
  { icon: siFirebase, aliases: ["firebase"] },
  { icon: siDocker, aliases: ["docker"] },
  { icon: siKubernetes, aliases: ["kubernetes", "k8s"] },
  { icon: siVercel, aliases: ["vercel"] },
  { icon: siNetlify, aliases: ["netlify"] },
  { icon: siCloudflare, aliases: ["cloudflare"] },
  { icon: siGooglecloud, aliases: ["googlecloud", "gcp"] },
  { icon: siGit, aliases: ["git"] },
  { icon: siGithub, aliases: ["github"] },
  { icon: siGitlab, aliases: ["gitlab"] },
  { icon: siVite, aliases: ["vite"] },
  { icon: siWebpack, aliases: ["webpack"] },
  { icon: siJest, aliases: ["jest"] },
  { icon: siVitest, aliases: ["vitest"] },
  { icon: siZod, aliases: ["zod"] },
  { icon: siElectron, aliases: ["electron"] },
  { icon: siExpo, aliases: ["expo"] },
  { icon: siStripe, aliases: ["stripe"] },
  { icon: siWordpress, aliases: ["wordpress"] },
  { icon: siShopify, aliases: ["shopify"] },
  { icon: siSanity, aliases: ["sanity"] },
  { icon: siContentful, aliases: ["contentful"] },
  { icon: siStrapi, aliases: ["strapi"] },
  { icon: siTensorflow, aliases: ["tensorflow"] },
  { icon: siPytorch, aliases: ["pytorch"] },
  { icon: siHuggingface, aliases: ["huggingface", "hf"] },
  { icon: siLangchain, aliases: ["langchain"] },
  { icon: siAnthropic, aliases: ["anthropic"] },
  { icon: siClaude, aliases: ["claude"] },
];

// Free-text aliases whose punctuation matters and would collide once stripped to
// alphanumerics (e.g. "c++" and "c#" both reduce to "c"). Checked before normalizing.
const RAW_ALIASES: Record<string, SimpleIcon> = {
  "c++": siCplusplus,
  ".net": siDotnet,
};

const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const TECH_ICONS: Record<string, SimpleIcon> = (() => {
  const map: Record<string, SimpleIcon> = {};
  for (const { icon, aliases } of TECH_ENTRIES) {
    for (const alias of aliases) map[normalize(alias)] = icon;
  }
  return map;
})();

function lookupTechIcon(tech: string): SimpleIcon | null {
  const raw = tech.trim().toLowerCase();
  if (RAW_ALIASES[raw]) return RAW_ALIASES[raw];
  return TECH_ICONS[normalize(tech)] ?? null;
}

/**
 * Renders a single project tech tag as a rounded pill. When the tag matches a
 * known technology, its official brand logo (in brand color) is shown alongside
 * the canonical name; unknown tags fall back to the plain text pill.
 */
export function TechBadge({ tech }: { tech: string }) {
  const icon = lookupTechIcon(tech);

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
      {icon && (
        <svg
          role="img"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-3 w-3 shrink-0"
          style={{ color: `#${icon.hex}` }}
          aria-hidden="true"
        >
          <path d={icon.path} />
        </svg>
      )}
      {icon ? icon.title : tech}
    </span>
  );
}
