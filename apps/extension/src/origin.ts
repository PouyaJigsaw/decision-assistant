export function apiOrigin(raw: string | undefined = import.meta.env.VITE_API_ORIGIN): string {
  const origin = raw?.replace(/\/$/, "") ?? "";
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
    throw new Error("VITE_API_ORIGIN is required and must start with http:// or https://");
  }
  return origin;
}
