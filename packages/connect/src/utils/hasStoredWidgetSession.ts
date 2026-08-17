import { FLUENT_WIDGET_SESSION_STORAGE_KEY } from "../core/storageKeys";

type ReadableStorage = Pick<Storage, "getItem">;

export function hasStoredWidgetSession(
  storage: ReadableStorage | undefined = globalThis.window?.localStorage,
) {
  if (!storage) return false;
  try {
    return Boolean(storage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY));
  } catch {
    return false;
  }
}
