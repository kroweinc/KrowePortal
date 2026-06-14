export function getPublicAppOrigin(requestOrigin?: string): string {
  const configured =
    process.env.APP_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();

  const origin = configured || requestOrigin || "";
  return origin.replace(/\/+$/, "");
}
