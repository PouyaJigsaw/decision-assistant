import { defineConfig } from "wxt";
import { PRODUCT_NAME } from "./src/copy";
import { apiOrigin } from "./src/origin";

export function manifestForOrigin(origin: string) {
  const icons = {
    "16": "icon-16.png",
    "32": "icon-32.png",
    "48": "icon-48.png",
    "128": "icon-128.png",
  };
  return {
    name: PRODUCT_NAME,
    version: "0.0.1",
    icons,
    action: { default_title: PRODUCT_NAME, default_icon: icons },
    permissions: [
      "sidePanel",
      "activeTab",
      "scripting",
      "storage",
      "tabs",
      "webNavigation",
      "declarativeNetRequestWithHostAccess",
    ],
    host_permissions: [
      `${apiOrigin(origin)}/*`,
      "https://www.linkedin.com/*",
      "https://api.openai.com/*",
      "https://auth.openai.com/*",
      "http://127.0.0.1/*",
    ],
  };
}

export const manifest = manifestForOrigin(apiOrigin());

export default defineConfig({
  srcDir: ".",
  outDir: "unpacked",
  modules: ["@wxt-dev/module-react"],
  manifest,
});
