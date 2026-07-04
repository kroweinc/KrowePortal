"use client";

import { useState } from "react";
import { submitterInitials, submitterName } from "@/lib/utils";
import type { Task } from "@/lib/types";

/** Small circle avatar for the card footers: uploaded profile photo → Google
 *  account photo (both resolved server-side into creator.avatar_url) →
 *  initials. no-referrer because googleusercontent 403s referred requests. */
export function SubmitterAvatar({ creator }: { creator: Task["creator"] }) {
  const [failed, setFailed] = useState(false);
  const src = creator?.avatar_url;

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed/remote URLs; next/image would need remotePatterns per host
      <img
        className="krowe-avatar"
        src={src}
        alt={submitterName(creator)}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="krowe-avatar krowe-avatar-initials" aria-hidden="true">
      {submitterInitials(creator)}
    </span>
  );
}
