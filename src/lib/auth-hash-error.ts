export type AuthHashError = {
  error: string;
  errorCode: string | null;
  description: string | null;
};

// Module-level guard: even if the root effect re-runs (StrictMode double
// invoke, route re-mount, fast HMR), the same hash payload is parsed at most
// once per page load. The hash is also stripped from the URL synchronously,
// so a refresh re-reads a clean URL and returns null.
let consumed = false;

export function consumeAuthHashError(): AuthHashError | null {
  if (typeof window === "undefined") return null;
  if (consumed) return null;
  const hash = window.location.hash;
  if (!hash || !hash.includes("error=")) return null;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const error = params.get("error");
  if (!error) return null;
  const errorCode = params.get("error_code");
  const description = params.get("error_description");
  // Clear the hash so refresh doesn't keep re-triggering.
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", pathname + search);
  consumed = true;
  return {
    error,
    errorCode,
    description: description ? description.replace(/\+/g, " ") : null,
  };
}