import type { MetadataRoute } from "next";

/**
 * Web app manifest: what makes "Add to home screen" install a real app icon
 * that opens full-screen instead of a browser tab.
 *
 * start_url is "/" so the locale proxy sends people to their own language;
 * a signed-in provider then lands on their dashboard through the shortcut,
 * or one tap from the header. Arabic is the product's primary language, so
 * the manifest itself is Arabic and RTL.
 *
 * Icons are generated from design/logo.png by scripts/generate-pwa-icons.mjs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "نجدة الطريق 24",
    short_name: "نجدة الطريق",
    description: "مساعدة على الطريق في كل سوريا، على مدار الساعة",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B0B0F",
    theme_color: "#0B0B0F",
    categories: ["travel", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "اطلب مساعدة", short_name: "اطلب مساعدة", url: "/ar/request" },
      { name: "لوحة مقدّم الخدمة", short_name: "مقدّم الخدمة", url: "/ar/provider" },
    ],
  };
}
