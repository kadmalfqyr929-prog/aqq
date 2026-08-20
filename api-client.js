(() => {
  const API_PREFIX = "/api";
  const DEFAULT_DEV_ORIGIN = "http://127.0.0.1:8765";
  const TOKEN_KEY = "tox-access-token";

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function localOnlyOrigin(value) {
    const origin = trimTrailingSlash(value);
    if (!origin) return "";
    try {
      const url = new URL(origin);
      return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname) ? origin : "";
    } catch (error) {
      return "";
    }
  }

  function explicitOrigin() {
    const meta = document.querySelector('meta[name="tox-api-origin"]')?.content;
    try {
      return localOnlyOrigin(window.TOX_API_ORIGIN || meta || localStorage.getItem("tox-api-origin") || "");
    } catch (error) {
      return localOnlyOrigin(window.TOX_API_ORIGIN || meta || "");
    }
  }

  function isExternalFrontend() {
    return window.location.protocol === "file:" || /:(5500)$/.test(window.location.origin);
  }

  function origin() {
    const explicit = explicitOrigin();
    if (explicit) return explicit;

    if (isExternalFrontend()) {
      return DEFAULT_DEV_ORIGIN;
    }

    // Use current window origin for same-origin desktop requests.
    return trimTrailingSlash(window.location.origin);
  }

  function url(path = "") {
    if (/^https?:\/\//i.test(path)) return path;
    const cleanPath = String(path || "").startsWith("/") ? String(path || "") : `/${path}`;
    const apiPath = cleanPath.startsWith(`${API_PREFIX}/`) ? cleanPath : `${API_PREFIX}${cleanPath}`;
    return `${origin()}${apiPath}`;
  }

  function token() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function authHeaders(headers = {}) {
    const accessToken = token();
    return accessToken && !("Authorization" in headers)
      ? { Authorization: `Bearer ${accessToken}`, ...headers }
      : { ...headers };
  }

  function request(path, options = {}) {
    const headers = authHeaders({
      Accept: "application/json",
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    });
    return fetch(url(path), {
      credentials: "include",
      ...options,
      headers
    });
  }

  window.ToxApi = {
    baseUrl: () => `${origin()}${API_PREFIX}`,
    origin,
    isExternalFrontend,
    url,
    token,
    authHeaders,
    fetch: request
  };
})();
