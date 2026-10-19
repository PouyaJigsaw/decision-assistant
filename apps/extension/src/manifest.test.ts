import { describe, expect, it } from "vitest";
import { manifestForOrigin } from "../wxt.config";

describe("manifest", () => {
  it("grants only the listed permissions and registers no content scripts", () => {
    const manifest = manifestForOrigin("http://127.0.0.1:8787");
    expect(manifest.permissions).toEqual(["sidePanel", "activeTab", "scripting", "storage", "tabs", "webNavigation"]);
    expect(manifest.host_permissions).toEqual([
      "http://127.0.0.1:8787/*",
      "https://www.linkedin.com/*",
      "https://api.openai.com/*",
      "https://auth.openai.com/*",
      "http://127.0.0.1/*",
    ]);
    expect(manifest.name).toBe("Who Fits?");
    expect(manifest.action).toEqual({
      default_title: "Who Fits?",
      default_icon: {
        "16": "icon-16.png",
        "32": "icon-32.png",
        "48": "icon-48.png",
        "128": "icon-128.png",
      },
    });
    expect(manifest.icons).toEqual({
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    });
    expect(manifest.version).toBe("0.0.1");
    expect(manifest.content_scripts).toBeUndefined();
  });

  it("uses the hosted origin and omits localhost for the store build", () => {
    const manifest = manifestForOrigin("https://decision-assistant.fly.dev");
    expect(manifest.host_permissions).toEqual([
      "https://decision-assistant.fly.dev/*",
      "https://www.linkedin.com/*",
      "https://api.openai.com/*",
      "https://auth.openai.com/*",
      "http://127.0.0.1/*",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("http://127.0.0.1:8787");
  });
});
