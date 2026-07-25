"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import {
  joinProfileUrl,
  splitProfileUrl,
  LINK_PREFIXES,
  LINK_PLACEHOLDERS,
  type ProfileLinkKind,
} from "@/lib/builder-profile/url-parts";
import { importFromPortfolio } from "@/lib/actions/builder-profile";
import { useProfileDraft, type ProfileTextField } from "./profile-draft-context";

const HEADLINE_MAX = 120;
const BIO_MAX = 2000;

// Basics editor — bound to the shared draft. No Save button: text fields
// autosave (debounced) and URL fields flush on blur via the draft context.
export function BasicsForm() {
  const { draft, accountDisplayName, setField, commitUrls } = useProfileDraft();
  const [isImporting, startImport] = useTransition();
  const router = useRouter();

  function importFromSite() {
    const url = draft.portfolioUrl.trim();
    if (!url) {
      toast.error("Enter your portfolio URL first.");
      return;
    }
    startImport(async () => {
      const result = await importFromPortfolio({ url });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const parts: string[] = [];
      if (result.experienceImported) {
        parts.push(
          `${result.experienceImported} experience ${result.experienceImported === 1 ? "entry" : "entries"} added`
        );
      }
      if (result.projectsImported) {
        parts.push(`${result.projectsImported} project${result.projectsImported === 1 ? "" : "s"} added`);
      }
      if (result.basicsUpdated) parts.push("headline & bio filled in");
      if (result.educationUpdated) parts.push("education added");
      if (result.linksUpdated) parts.push("links filled in");
      if (result.skipped && parts.length === 0) parts.push("already up to date");
      toast.success(
        parts.length > 0 ? `Imported from portfolio: ${parts.join(", ")}.` : "Profile updated from portfolio."
      );
      // Server changed text + collections; the draft merges them on refresh.
      router.refresh();
    });
  }

  return (
    <>
      <div className="ss-field">
        <label htmlFor="bp-display-name">
          Name <span className="req">*</span>
        </label>
        <input
          id="bp-display-name"
          className="ss-input"
          value={draft.displayName}
          onChange={(e) => setField("displayName", e.target.value)}
          maxLength={80}
          placeholder={accountDisplayName}
        />
        <p className="ss-hint">Leave blank to use your account name.</p>
      </div>

      <div className="ss-field">
        <label htmlFor="bp-headline">Headline</label>
        <input
          id="bp-headline"
          className="ss-input"
          value={draft.headline}
          onChange={(e) => setField("headline", e.target.value)}
          maxLength={HEADLINE_MAX}
          placeholder="e.g., Full-stack builder — Next.js, Supabase, AI products"
        />
        <Counter value={draft.headline.length} max={HEADLINE_MAX} />
      </div>

      <div className="ss-field">
        <label htmlFor="bp-bio">About</label>
        <textarea
          id="bp-bio"
          className="ss-input"
          value={draft.bio}
          onChange={(e) => setField("bio", e.target.value)}
          maxLength={BIO_MAX}
          rows={4}
          placeholder="A short intro clients will read first. A sentence or two is fine."
        />
        <Counter value={draft.bio.length} max={BIO_MAX} />
      </div>

      <LinkField
        kind="linkedin"
        id="bp-linkedin"
        label="LinkedIn"
        field="linkedinUrl"
        value={draft.linkedinUrl}
        setField={setField}
        onBlur={commitUrls}
      />

      <LinkField
        kind="github"
        id="bp-github"
        label="GitHub"
        field="githubUrl"
        value={draft.githubUrl}
        setField={setField}
        onBlur={commitUrls}
      />

      <div className="ss-field">
        <label htmlFor="bp-portfolio">Portfolio</label>
        <div className="ss-mediarow" style={{ gap: "var(--spacing-md)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <LinkInput
              kind="portfolio"
              id="bp-portfolio"
              field="portfolioUrl"
              value={draft.portfolioUrl}
              setField={setField}
              onBlur={commitUrls}
              disabled={isImporting}
            />
          </div>
          <button type="button" className="ss-btn" onClick={importFromSite} disabled={isImporting}>
            <Sparkles />
            {isImporting ? "Working…" : "Autofill profile"}
          </button>
        </div>
        <p className="ss-hint">Shown on your profile — we can also fill this profile in from it.</p>
      </div>
    </>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <p className={`ss-count${value > max ? " over" : ""}`}>
      {value.toLocaleString()}/{max.toLocaleString()}
    </p>
  );
}

interface LinkInputProps {
  kind: ProfileLinkKind;
  id: string;
  field: ProfileTextField;
  value: string;
  setField: (key: ProfileTextField, value: string) => void;
  onBlur: () => void;
  disabled?: boolean;
}

// The builder edits the handle; the draft still holds (and the server still
// stores) the whole URL. splitProfileUrl round-trips anything that doesn't fit
// the expected prefix, so an unusual link is shown as-is rather than mangled.
function LinkInput({ kind, id, field, value, setField, onBlur, disabled }: LinkInputProps) {
  return (
    <div className="ss-prefix">
      <span className="fix" aria-hidden>
        {LINK_PREFIXES[kind]}
      </span>
      <input
        id={id}
        value={splitProfileUrl(kind, value)}
        onChange={(e) => setField(field, joinProfileUrl(kind, e.target.value))}
        onBlur={onBlur}
        maxLength={500}
        placeholder={LINK_PLACEHOLDERS[kind]}
        disabled={disabled}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

function LinkField({ label, ...props }: LinkInputProps & { label: string }) {
  return (
    <div className="ss-field">
      <label htmlFor={props.id}>{label}</label>
      <LinkInput {...props} />
    </div>
  );
}
