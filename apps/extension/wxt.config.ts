import { defineConfig } from "wxt";
import { apiOrigin } from "./src/origin";

export function manifestForOrigin(origin: string) {
  return {
    permissions: ["sidePanel", "activeTab", "scripting", "storage"],
    host_permissions: [`${apiOrigin(origin)}/*`],
  };
}

export const manifest = manifestForOrigin(apiOrigin());

export default defineConfig({
  srcDir: ".",
  modules: ["@wxt-dev/module-react"],
  manifest,
});
