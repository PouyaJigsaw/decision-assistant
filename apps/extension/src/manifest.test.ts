import { describe, expect, it } from "vitest";
import { manifest } from "../wxt.config";

describe("manifest", () => {
  it("grants only the listed permissions and registers no content scripts", () => {
    expect(manifest.permissions).toEqual(["sidePanel", "activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:8787/*"]);
    expect(manifest.content_scripts).toBeUndefined();
  });
});
