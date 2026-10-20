export const HOSTED_API_ORIGIN = "https://decision-assistant.fly.dev";

function configuredOrigin(): string | undefined {
  try {
    const value = import.meta.env?.VITE_API_ORIGIN;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function apiOrigin(raw?: string): string {
  const origin = (raw?.trim() || configuredOrigin() || HOSTED_API_ORIGIN).replace(/\/$/, "");
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
    throw new Error("VITE_API_ORIGIN must start with http:// or https://");
  }
  return origin;
}
