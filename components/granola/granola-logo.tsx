import Image from "next/image";

/** Official Granola app mark (black spiral on green, from granola.ai).
    Decorative — always rendered inside a labeled integration card. */
export function GranolaLogo({ size = 52 }: { size?: number }) {
  return (
    <Image
      src="/images/granola-logo.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}
