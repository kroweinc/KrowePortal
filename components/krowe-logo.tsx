import Image from "next/image";
import { cn } from "@/lib/utils";

/** Intrinsic pixel size of `public/images/KroweLogo.png`. */
const LOGO_WIDTH = 526;
const LOGO_HEIGHT = 191;

export type KroweLogoProps = {
  className?: string;
  priority?: boolean;
};

/**
 * Krowe wordmark via next/image.
 *
 * Height is set in CSS (`h-[26px]`, overridable via `className`); `width: auto`
 * in `style` lets the width follow the aspect ratio and satisfies next/image's
 * "size set via CSS" guidance. Do NOT also set `height: auto` here — inline style
 * beats the height class and the logo balloons to its intrinsic 526×191 (see
 * next/image docs).
 */
export function KroweLogo({ className, priority }: KroweLogoProps) {
  return (
    <Image
      src="/images/KroweLogo.png"
      alt="Krowe"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      priority={priority}
      className={cn("h-[26px] w-auto max-w-none object-contain", className)}
      style={{ width: "auto" }}
    />
  );
}
