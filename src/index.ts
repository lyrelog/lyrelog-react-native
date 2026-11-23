import { Lyrelog } from "./instance";

export { Lyrelog };
export { DEFAULT_REDACT_KEYS } from "./client";
// A type only: a second client would take over the error hooks. Use `Lyrelog`.
export type { LyrelogClient } from "./client";
export type { Attributes, Config, Consent, ExceptionOptions, Level, LogOptions, Logger } from "./types";
export { LyrelogErrorBoundary, trackNavigation, useLyrelogScreen } from "./react";
export type { LyrelogErrorBoundaryProps, NavigationRefLike, TrackNavigationOptions } from "./react";
export default Lyrelog;
