interface EmberGlyphProps {
  size?: number;
  animated?: boolean;
}

export function EmberGlyph({ size = 14, animated = false }: EmberGlyphProps) {
  const breatheStyle = animated
    ? { animation: "breathe 3.5s ease-in-out infinite", transformOrigin: "8px 8px" as const }
    : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ flexShrink: 0, overflow: "visible" }}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" fill="var(--primary)" opacity="0.14" />
      <circle cx="8" cy="8" r="4" fill="var(--primary)" opacity="0.4" style={breatheStyle} />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle
        cx="9"
        cy="7"
        r="1"
        fill="var(--primary-accent)"
        style={animated ? { ...breatheStyle, animationDelay: "0.4s" } : undefined}
      />
    </svg>
  );
}
