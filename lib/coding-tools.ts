/* Curated directory of popular coding / AI tools used to power the "Add coding
   tool" picker. Selecting a preset autofills the form (category + url) and the
   `domain` feeds the BrandLogo so every entry shows its real product logo with
   zero AI calls. The long tail is still handled by typing a tool in manually. */

import type { CodingToolCategory } from "@/lib/types";

export interface CodingToolPreset {
  name: string;
  category: CodingToolCategory;
  /** Product page shown as the entry's external link. */
  url: string;
  /** Website host used to resolve the brand logo (see components/prd/brand-logo). */
  domain: string;
}

export const CODING_TOOL_PRESETS: CodingToolPreset[] = [
  // AI Assistant
  { name: "Claude Code", category: "AI Assistant", url: "https://claude.com/claude-code", domain: "claude.com" },
  { name: "Cursor", category: "AI Assistant", url: "https://cursor.com", domain: "cursor.com" },
  { name: "GitHub Copilot", category: "AI Assistant", url: "https://github.com/features/copilot", domain: "github.com" },
  { name: "Windsurf", category: "AI Assistant", url: "https://windsurf.com", domain: "windsurf.com" },
  { name: "Claude", category: "AI Assistant", url: "https://claude.ai", domain: "claude.ai" },
  { name: "ChatGPT", category: "AI Assistant", url: "https://chatgpt.com", domain: "chatgpt.com" },
  { name: "Gemini", category: "AI Assistant", url: "https://gemini.google.com", domain: "gemini.google.com" },
  { name: "v0", category: "AI Assistant", url: "https://v0.app", domain: "v0.app" },
  { name: "Bolt", category: "AI Assistant", url: "https://bolt.new", domain: "bolt.new" },
  { name: "Lovable", category: "AI Assistant", url: "https://lovable.dev", domain: "lovable.dev" },
  { name: "Replit", category: "AI Assistant", url: "https://replit.com", domain: "replit.com" },
  { name: "Codeium", category: "AI Assistant", url: "https://codeium.com", domain: "codeium.com" },
  { name: "Aider", category: "AI Assistant", url: "https://aider.chat", domain: "aider.chat" },
  { name: "Cline", category: "AI Assistant", url: "https://cline.bot", domain: "cline.bot" },

  // Editor / IDE
  { name: "VS Code", category: "Editor / IDE", url: "https://code.visualstudio.com", domain: "code.visualstudio.com" },
  { name: "Zed", category: "Editor / IDE", url: "https://zed.dev", domain: "zed.dev" },
  { name: "JetBrains", category: "Editor / IDE", url: "https://jetbrains.com", domain: "jetbrains.com" },
  { name: "IntelliJ IDEA", category: "Editor / IDE", url: "https://jetbrains.com/idea", domain: "jetbrains.com" },
  { name: "WebStorm", category: "Editor / IDE", url: "https://jetbrains.com/webstorm", domain: "jetbrains.com" },
  { name: "PyCharm", category: "Editor / IDE", url: "https://jetbrains.com/pycharm", domain: "jetbrains.com" },
  { name: "Neovim", category: "Editor / IDE", url: "https://neovim.io", domain: "neovim.io" },
  { name: "Sublime Text", category: "Editor / IDE", url: "https://sublimetext.com", domain: "sublimetext.com" },
  { name: "Xcode", category: "Editor / IDE", url: "https://developer.apple.com/xcode", domain: "developer.apple.com" },
  { name: "Android Studio", category: "Editor / IDE", url: "https://developer.android.com/studio", domain: "developer.android.com" },
  { name: "Visual Studio", category: "Editor / IDE", url: "https://visualstudio.microsoft.com", domain: "visualstudio.microsoft.com" },

  // CLI / Terminal
  { name: "Warp", category: "CLI / Terminal", url: "https://warp.dev", domain: "warp.dev" },
  { name: "iTerm2", category: "CLI / Terminal", url: "https://iterm2.com", domain: "iterm2.com" },
  { name: "Ghostty", category: "CLI / Terminal", url: "https://ghostty.org", domain: "ghostty.org" },
  { name: "Git", category: "CLI / Terminal", url: "https://git-scm.com", domain: "git-scm.com" },
  { name: "GitHub CLI", category: "CLI / Terminal", url: "https://cli.github.com", domain: "cli.github.com" },
  { name: "Homebrew", category: "CLI / Terminal", url: "https://brew.sh", domain: "brew.sh" },
  { name: "Oh My Zsh", category: "CLI / Terminal", url: "https://ohmyz.sh", domain: "ohmyz.sh" },

  // DevOps / Cloud
  { name: "Vercel", category: "DevOps / Cloud", url: "https://vercel.com", domain: "vercel.com" },
  { name: "Netlify", category: "DevOps / Cloud", url: "https://netlify.com", domain: "netlify.com" },
  { name: "AWS", category: "DevOps / Cloud", url: "https://aws.amazon.com", domain: "aws.amazon.com" },
  { name: "Docker", category: "DevOps / Cloud", url: "https://docker.com", domain: "docker.com" },
  { name: "Kubernetes", category: "DevOps / Cloud", url: "https://kubernetes.io", domain: "kubernetes.io" },
  { name: "GitHub Actions", category: "DevOps / Cloud", url: "https://github.com/features/actions", domain: "github.com" },
  { name: "GitLab", category: "DevOps / Cloud", url: "https://gitlab.com", domain: "gitlab.com" },
  { name: "Railway", category: "DevOps / Cloud", url: "https://railway.app", domain: "railway.app" },
  { name: "Render", category: "DevOps / Cloud", url: "https://render.com", domain: "render.com" },
  { name: "Fly.io", category: "DevOps / Cloud", url: "https://fly.io", domain: "fly.io" },
  { name: "Cloudflare", category: "DevOps / Cloud", url: "https://cloudflare.com", domain: "cloudflare.com" },
  { name: "Supabase", category: "DevOps / Cloud", url: "https://supabase.com", domain: "supabase.com" },
  { name: "Terraform", category: "DevOps / Cloud", url: "https://terraform.io", domain: "terraform.io" },

  // Design
  { name: "Figma", category: "Design", url: "https://figma.com", domain: "figma.com" },
  { name: "Sketch", category: "Design", url: "https://sketch.com", domain: "sketch.com" },
  { name: "Framer", category: "Design", url: "https://framer.com", domain: "framer.com" },
  { name: "Penpot", category: "Design", url: "https://penpot.app", domain: "penpot.app" },
  { name: "Excalidraw", category: "Design", url: "https://excalidraw.com", domain: "excalidraw.com" },
  { name: "Canva", category: "Design", url: "https://canva.com", domain: "canva.com" },

  // Productivity
  { name: "Notion", category: "Productivity", url: "https://notion.so", domain: "notion.so" },
  { name: "Linear", category: "Productivity", url: "https://linear.app", domain: "linear.app" },
  { name: "Jira", category: "Productivity", url: "https://atlassian.com/software/jira", domain: "atlassian.com" },
  { name: "Slack", category: "Productivity", url: "https://slack.com", domain: "slack.com" },
  { name: "GitHub", category: "Productivity", url: "https://github.com", domain: "github.com" },
  { name: "Raycast", category: "Productivity", url: "https://raycast.com", domain: "raycast.com" },
  { name: "Obsidian", category: "Productivity", url: "https://obsidian.md", domain: "obsidian.md" },
  { name: "Postman", category: "Productivity", url: "https://postman.com", domain: "postman.com" },
  { name: "Arc", category: "Productivity", url: "https://arc.net", domain: "arc.net" },
];

const PRESET_BY_NAME = new Map(CODING_TOOL_PRESETS.map((p) => [p.name.toLowerCase(), p]));

/** Find the preset for a tool name (case-insensitive), if it's a known tool.
    Used to surface the right brand logo on already-saved entries. */
export function findCodingToolPreset(name: string): CodingToolPreset | undefined {
  return PRESET_BY_NAME.get(name.trim().toLowerCase());
}
