import { LyrelogClient } from "./client";

/**
 * Lyrelog for React Native: one per app.
 *
 * ```ts
 * import { Lyrelog } from "@lyrelog/react-native";
 *
 * Lyrelog.init({ apiKey: "lyr_ing_..." });
 * Lyrelog.info("checkout_done", { attrs: { items: 3 } });
 * ```
 */
export const Lyrelog = new LyrelogClient();
