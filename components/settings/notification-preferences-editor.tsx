"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/settings-section";
import {
  updateNotificationPreferences,
  type NotificationPreferenceFlags,
} from "@/lib/actions/notification-preferences";

const ROWS: { key: keyof NotificationPreferenceFlags; label: string; hint: string }[] = [
  {
    key: "notify_doc_signed",
    label: "Document signed",
    hint: "When a quote, contract, or PRD you sent gets signed.",
  },
  {
    key: "notify_change_order",
    label: "Change order signed",
    hint: "When an operator signs a change order you sent.",
  },
  {
    key: "notify_invite_accepted",
    label: "Invite accepted",
    hint: "When an operator accepts your invite and joins a client.",
  },
  {
    key: "notify_task_approval_requested",
    label: "Task sent for approval",
    hint: "When a builder sends a task for your review.",
  },
  {
    key: "notify_task_approved",
    label: "Task approved",
    hint: "When an operator approves a task you sent for review.",
  },
  {
    key: "notify_task_changes_requested",
    label: "Changes requested",
    hint: "When an operator sends a task back with changes.",
  },
  {
    key: "notify_task_delivered",
    label: "Task delivered",
    hint: "When a builder marks a task done and delivers it.",
  },
  {
    key: "notify_task_comment",
    label: "New comment",
    hint: "When someone comments on a task you're working on together.",
  },
];

export function NotificationPreferencesEditor({ initial }: { initial: NotificationPreferenceFlags }) {
  const [prefs, setPrefs] = useState<NotificationPreferenceFlags>(initial);
  const [saved, setSaved] = useState<NotificationPreferenceFlags>(initial);
  const [isPending, startTransition] = useTransition();

  const dirty = ROWS.some((r) => prefs[r.key] !== saved[r.key]);

  function save(next: NotificationPreferenceFlags) {
    startTransition(async () => {
      const result = await updateNotificationPreferences(next);
      if ("error" in result) {
        toast.error(result.error);
        setPrefs(saved); // roll back the optimistic flip
        return;
      }
      setSaved(next);
      toast.success("Saved");
    });
  }

  function toggle(key: keyof NotificationPreferenceFlags, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    save(next);
  }

  return (
    <SettingsSection title="Email notifications" hint="Choose which emails Krowe sends you.">
      <ul className="divide-y divide-neutral-100">
        {ROWS.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900">{row.label}</p>
              <p className="text-xs text-neutral-500">{row.hint}</p>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(v) => toggle(row.key, v)}
              disabled={isPending && dirty}
              aria-label={row.label}
            />
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
