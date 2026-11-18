/** Build-time constants from vite.config.ts (`define`). */
declare const __KENNING_VERSION__: string;
declare const __KENNING_COMMIT__: string;

/** The app version (root package.json), e.g. "0.1.0". */
const APP_VERSION: string = __KENNING_VERSION__;
/** Short commit of an image build ("" in development). */
const APP_COMMIT: string = __KENNING_COMMIT__;
/** "0.1.0" or "0.1.0 (abc1234)". */
export const appVersionLabel = (): string =>
  APP_COMMIT ? `${APP_VERSION} (${APP_COMMIT})` : APP_VERSION;
