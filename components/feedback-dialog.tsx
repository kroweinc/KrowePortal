"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StarRating } from "@/components/ui/star-rating";
import { cn } from "@/lib/utils";
import { submitFeedback } from "@/lib/actions/product-feedback";
import type { FeedbackCategory } from "@/lib/types";

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

export function FeedbackDialog() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<FeedbackCategory>("other");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setRating(0);
    setCategory("other");
    setMessage("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleSubmit() {
    if (rating === 0) {
      setError("Pick a star rating first.");
      return;
    }
    if (!message.trim()) {
      setError("Tell us a bit more.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitFeedback({
        rating,
        category,
        message: message.trim(),
        pagePath: pathname ?? undefined,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      toast.success("Thanks for the feedback!");
      handleOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className="krowe-sidebar-link">
          <span className="krowe-sidebar-ic">
            <MessageSquare size={17} strokeWidth={1.9} />
          </span>
          Feedback
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Tell the Krowe team what&apos;s working, what&apos;s broken, or what you wish existed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-6">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">
              How&apos;s your experience?
            </label>
            <StarRating value={rating} onChange={setRating} />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">Type</label>
            <div className="flex gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors",
                    category === c.value
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-hover)] font-medium"
                      : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">Message</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Share the details…"
              maxLength={2000}
              rows={4}
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? "Sending…" : "Send feedback"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
