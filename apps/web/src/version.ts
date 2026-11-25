/** Build-time constants from vite.config.ts (`define`). */
declare const __VUURTOREN_VERSION__: string;
declare const __VUURTOREN_COMMIT__: string;
declare const __VUURTOREN_STORE__: string;

/** The app version (root package.json), e.g. "0.1.0". */
export const APP_VERSION: string = __VUURTOREN_VERSION__;
/** Short commit of an image build ("" in development). */
const APP_COMMIT: string = __VUURTOREN_COMMIT__;
/** The store this build is for ("play"), or "" for the builds from GitHub. */
export const APP_STORE: string = __VUURTOREN_STORE__;
/** "0.1.0" or "0.1.0 (abc1234)". */
export const appVersionLabel = (): string =>
  APP_COMMIT ? `${APP_VERSION} (${APP_COMMIT})` : APP_VERSION;
