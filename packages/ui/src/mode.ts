import { createContext, useContext } from "react";

/**
 * True in native mode (Vuurtoren holds the cards): Add, deck and card controls are worded
 * without Anki. Provided by the app shell.
 */
export const NativeModeContext = createContext(false);

export const useNativeMode = (): boolean => useContext(NativeModeContext);
