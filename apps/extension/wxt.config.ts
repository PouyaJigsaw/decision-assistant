import { defineConfig } from "wxt";

export const manifest = {
  permissions: ["sidePanel", "activeTab", "scripting", "storage"],
  host_permissions: ["http://127.0.0.1:8787/*"],
};

export default defineConfig({
  srcDir: ".",
  manifest,
});
