import { describe, expect, it } from "vitest";
import { manifestForOrigin } from "../wxt.config";

describe("manifest", () => {
  it("grants only the listed permissions and registers no content scripts", () => {
    const manifest = manifestForOrigin("http://127.0.0.1:8787");
    expect(manifest.permissions).toEqual(["sidePanel", "activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:8787/*"]);
    expect(manifest.content_scripts).toBeUndefined();
  });

  it("uses the hosted origin and omits localhost for the store build", () => {
    const manifest = manifestForOrigin("https://decision-assistant.fly.dev");
    expect(manifest.host_permissions).toEqual(["https://decision-assistant.fly.dev/*"]);
    expect(JSON.stringify(manifest)).not.toContain("http://127.0.0.1:8787");
  });
});
