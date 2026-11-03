import { useSyncExternalStore } from "react";

const subscribe = (fn: () => void) => {
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
};

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
