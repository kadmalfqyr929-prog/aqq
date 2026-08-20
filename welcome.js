(() => {
  const AUTH_KEY = "tox-authenticated";
  const USER_KEY = "tox-session-user";
  const TOKEN_KEY = "tox-access-token";
  const splash = document.querySelector("[data-welcome-splash]");
  const isAuthenticated = sessionStorage.getItem(AUTH_KEY) === "true";
  let sessionVerified = false;
  const apiBase = window.ToxApi?.baseUrl?.() || `${window.location.origin.includes(":5500") ? "http://127.0.0.1:8765" : ""}/api`;
  const isExternalFrontend = window.ToxApi?.isExternalFrontend?.() || window.location.protocol === "file:" || /:(5500)$/.test(window.location.origin);
  const pagePermissions = {
    dashboard: "dashboard.open",
    sales: "sales.open",
    "sales-invoices": "sales.open",
    installments: "sales.installments",
    labels: "warehouse.print_labels",
    products: "warehouse.open",
    "product-alerts": "warehouse.open",
    warehouse: "warehouse.open",
    purchases: "purchase.open",
    "purchase-invoices": "purchase.open",
    clients: "accounts.manage_debts",
    suppliers: "accounts.manage_debts",
    finance: "accounts.open",
    reports: "accounts.view_profits",
    employees: "admin.manage_employees",
    settings: "admin.settings"
  };
  const navPermissions = [
    ["sales.html", "sales.open"],
    ["sales-invoices.html", "sales.open"],
    ["installments.html", "sales.installments"],
    ["products.html", "warehouse.open"],
    ["product-alerts.html", "warehouse.open"],
    ["labels.html", "warehouse.print_labels"],
    ["warehouse.html", "warehouse.open"],
    ["purchases.html", "purchase.open"],
    ["purchase-invoices.html", "purchase.open"],
    ["clients.html", "accounts.manage_debts"],
    ["suppliers.html", "accounts.manage_debts"],
    ["employees.html", "admin.manage_employees"],
    ["reports.html", "accounts.view_profits"],
    ["settings.html", "admin.settings"],
    ["index.html", "dashboard.open"]
  ];

  function loginPath() {
    return window.location.pathname.includes("/pages/") ? "../index.html" : "index.html";
  }

  function pagePath(page) {
    return window.location.pathname.includes("/pages/") ? `${page}.html` : `pages/${page}.html`;
  }

  function firstAllowedPage(user) {
    if (user?.role === "super_admin") return pagePath("super-admin");
    const permissions = new Set(user?.permissions || []);
    if (permissions.has("dashboard.open") || permissions.has("admin.settings")) return window.location.pathname.includes("/pages/") ? "../index.html" : "index.html";
    if (permissions.has("sales.open")) return pagePath("sales");
    if (permissions.has("sales.installments")) return pagePath("installments");
    if (permissions.has("purchase.open")) return pagePath("purchases");
    if (permissions.has("warehouse.open")) return pagePath("warehouse");
    if (permissions.has("accounts.open") || permissions.has("accounts.manage_debts") || permissions.has("accounts.view_profits")) return pagePath("finance");
    return loginPath();
  }

  function currentPage() {
    return document.body?.dataset.page || "dashboard";
  }

  function can(user, permission) {
    const permissions = user?.permissions || [];
    return !permission || permissions.includes(permission) || permissions.includes("admin.settings");
  }

  function readSessionUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY)) || null;
    } catch (error) {
      return null;
    }
  }

  function storeSession(user, accessToken = "") {
    sessionStorage.setItem(AUTH_KEY, "true");
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    if (accessToken) sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionVerified = true;
  }

  function clearSession() {
    sessionVerified = false;
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function backendFetch(path, options = {}) {
    if (window.ToxApi?.fetch) return window.ToxApi.fetch(path, options);
    return fetch(`${apiBase}${path}`, { credentials: "include", ...options });
  }

  function backendHomeUrl() {
    return `${window.ToxApi?.origin?.() || "http://127.0.0.1:8765"}/`;
  }

  function notifyAuthenticated() {
    window.dispatchEvent(new CustomEvent("tox:authenticated", { detail: { user: readSessionUser() } }));
  }

  function expireSession(options = {}) {
    const redirect = options.redirect !== false;
    clearSession();
    window.dispatchEvent(new CustomEvent("tox:auth-expired", { detail: { reason: options.reason || "AUTH_REQUIRED" } }));
    if (redirect) window.location.replace(loginPath());
  }

  function applyPermissions(user = readSessionUser()) {
    if (!user) return;
    document.querySelectorAll(".nav-link").forEach((link) => {
      const href = link.getAttribute("href") || "";
      const matched = navPermissions.find(([fragment]) => href.includes(fragment));
      if (matched && !can(user, matched[1])) link.hidden = true;
    });
    window.refreshSidebarNavigation?.();
    const required = pagePermissions[currentPage()];
    if (user?.role === "super_admin" && currentPage() !== "super-admin") {
      window.location.replace(firstAllowedPage(user));
    } else if (required && !can(user, required)) {
      window.location.replace(firstAllowedPage(user));
    }
  }

  window.ToxAuth = {
    can: (permission) => can(readSessionUser(), permission),
    user: readSessionUser,
    token: () => sessionStorage.getItem(TOKEN_KEY) || "",
    isLoggedIn: () => sessionStorage.getItem(AUTH_KEY) === "true",
    isSessionVerified: () => sessionVerified,
    isExternalFrontend: () => isExternalFrontend,
    backendHomeUrl,
    authHeaders: () => {
      const token = sessionStorage.getItem(TOKEN_KEY);
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    logout: async () => {
      // Clear the local bearer/session state first so logout is fail-closed even
      // when the loopback backend is restarting or temporarily unavailable.
      const token = sessionStorage.getItem(TOKEN_KEY) || "";
      clearSession();
      try {
        await backendFetch("/auth/logout/", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          keepalive: true,
        });
      } catch (error) {
        console.warn("Backend logout unavailable; local session was cleared.", error);
      }
      window.location.replace(loginPath());
    },
    expireSession,
    applyPermissions
  };

  if (!splash && isExternalFrontend) {
    window.location.replace(backendHomeUrl());
    return;
  }

  if (!splash && !isAuthenticated) {
    window.location.replace(loginPath());
    return;
  }

  if (!splash) {
    checkBackendSession().then((ok) => {
      if (!ok) {
        expireSession();
        return;
      }
      applyPermissions();
      notifyAuthenticated();
      document.body.classList.remove("app-booting");
    });
    return;
  }

  const loginForm = splash.querySelector("[data-login-form]");
  const userInput = splash.querySelector("[data-login-user]");
  const passInput = splash.querySelector("[data-login-pass]");
  const accountTypeInput = splash.querySelector("[data-login-account-type]");
  const rememberInput = splash.querySelector("[data-login-remember]");
  const serverStatus = splash.querySelector("[data-login-server-status]");
  const errorBox = splash.querySelector("[data-login-error]");
  const enterButton = splash.querySelector("[data-welcome-enter]");
  const loginShell = splash.querySelector(".login-shell-2026");
  const layoutToggle = splash.querySelector("[data-login-layout-toggle]");
  let closed = false;

  function enhanceLoginSelect(select) {
    if (window.ToxSelects?.enhance) {
      window.ToxSelects.enhance(select, {
        className: "login-role-select",
        placeholder: "\u0627\u062e\u062a\u064a\u0627\u0631"
      });
      window.ToxSelects.observe?.();
      return;
    }
    if (!select || select.closest(".tox-select-shell")) return;
    const shell = document.createElement("span");
    shell.className = `tox-select-shell login-role-select ${select.className || ""}`.trim();
    const button = document.createElement("button");
    button.className = "tox-select-button";
    button.type = "button";
    const menu = document.createElement("span");
    menu.className = "tox-select-menu";

    function sync() {
      const selected = select.options[select.selectedIndex];
      button.textContent = selected?.textContent?.trim() || "اختيار";
      menu.innerHTML = [...select.options].map((option, index) => `
        <button class="tox-select-option" type="button" data-login-select-index="${index}" ${option.disabled ? "disabled" : ""} aria-selected="${option.selected ? "true" : "false"}">
          ${option.textContent}
        </button>
      `).join("");
      menu.querySelectorAll("[data-login-select-index]").forEach((item) => {
        item.addEventListener("click", () => {
          const option = select.options[Number(item.dataset.loginSelectIndex)];
          if (!option || option.disabled) return;
          select.value = option.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          shell.classList.remove("is-open");
          sync();
        });
      });
    }

    select.parentNode.insertBefore(shell, select);
    shell.appendChild(select);
    shell.appendChild(button);
    shell.appendChild(menu);
    select.classList.add("tox-native-select");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelectorAll(".tox-select-shell.is-open").forEach((entry) => {
        if (entry !== shell) entry.classList.remove("is-open");
      });
      sync();
      shell.classList.toggle("is-open");
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".tox-select-shell")) shell.classList.remove("is-open");
    });
    select.addEventListener("change", sync);
    sync();
  }

  function wireLoginRoleButtons(select) {
    const buttons = [...splash.querySelectorAll("[data-login-role-choice]")];
    if (!select || !buttons.length) return false;

    function syncRoleButtons() {
      buttons.forEach((button) => {
        const isActive = button.dataset.loginRoleChoice === select.value;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.loginRoleChoice;
        if (!value) return;
        select.value = value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncRoleButtons();
      });
    });
    select.addEventListener("change", syncRoleButtons);
    syncRoleButtons();
    return true;
  }

  function readBusinessState() {
    try {
      return JSON.parse(localStorage.getItem("tox-business-state-v4")) || {};
    } catch (error) {
      return {};
    }
  }

  function formatCompact(value) {
    return new Intl.NumberFormat("ar-IQ", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
  }

  function animateNumber(element, target, formatter = (value) => String(value)) {
    if (!element) return;
    const duration = 900;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = formatter(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function hydrateLiveStats() {
    const state = readBusinessState();
    const invoices = Array.isArray(state.invoices) ? state.invoices : [];
    const products = Array.isArray(state.products) ? state.products : [];
    const totalSales = invoices.reduce((sum, invoice) => sum + Number(invoice.totalUsd || invoice.netUsd || invoice.total || 0), 0);
    animateNumber(splash.querySelector('[data-live-stat="sales"]'), totalSales, formatCompact);
    animateNumber(splash.querySelector('[data-live-stat="invoices"]'), invoices.length);
    animateNumber(splash.querySelector('[data-live-stat="products"]'), products.length);
  }

  function wirePointerGlow() {
    const core = splash.querySelector(".welcome-core");
    if (!core) return;
    splash.addEventListener("pointermove", (event) => {
      const rect = core.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      core.style.setProperty("--glow-x", `${Math.max(0, Math.min(100, x))}%`);
      core.style.setProperty("--glow-y", `${Math.max(0, Math.min(100, y))}%`);
    });
  }

  function wireLoginLayoutToggle() {
    if (!loginShell || !layoutToggle) return;
    const storageKey = "tox-login-layout-side";

    function applyLayout(value) {
      const visualFirst = value === "visual-first";
      loginShell.classList.toggle("is-visual-first", visualFirst);
      layoutToggle.setAttribute("aria-pressed", String(visualFirst));
    }

    try {
      applyLayout(localStorage.getItem(storageKey) || "form-first");
    } catch (error) {
      applyLayout("form-first");
    }

    layoutToggle.addEventListener("click", () => {
      const nextValue = loginShell.classList.contains("is-visual-first") ? "form-first" : "visual-first";
      applyLayout(nextValue);
      try {
        localStorage.setItem(storageKey, nextValue);
      } catch (error) {
        // Layout preference is optional.
      }
    });
  }

  function hydrateRememberedUser() {
    try {
      const remembered = localStorage.getItem("tox-remembered-login") || "";
      if (remembered && userInput) {
        userInput.value = remembered;
        if (rememberInput) rememberInput.checked = true;
      }
    } catch (error) {
      // Remember-me is optional; login must keep working without storage.
    }
  }

  function setLoginErrorState(active) {
    [userInput, passInput].forEach((input) => {
      if (!input) return;
      if (active) {
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-invalid");
      }
    });
    if (!splash) return;
    if (active) {
      splash.classList.remove("is-login-error");
      void splash.offsetWidth;
      splash.classList.add("is-login-error");
    } else {
      splash.classList.remove("is-login-error");
    }
  }

  function updateServerStatus(ok, reason = "") {
    if (!serverStatus) return;
    const external = reason === "external";
    serverStatus.classList.toggle("is-offline", !ok || external);
    serverStatus.innerHTML = external
      ? "<i></i>&#1575;&#1601;&#1578;&#1581; &#1605;&#1606; &#1587;&#1610;&#1585;&#1601;&#1585; &#1576;&#1575;&#1610;&#1579;&#1608;&#1606;"
      : ok
        ? "<i></i>&#1575;&#1604;&#1587;&#1610;&#1585;&#1601;&#1585; &#1605;&#1578;&#1589;&#1604;"
        : "<i></i>&#1608;&#1590;&#1593; &#1605;&#1581;&#1604;&#1610;";
  }

  function closeSplash() {
    if (closed) return;
    closed = true;
    window.playUiSound?.("welcome");
    splash.classList.add("is-complete");
    splash.classList.add("is-leaving");
    document.body.classList.remove("app-booting");
    notifyAuthenticated();
    window.setTimeout(() => splash.remove(), 760);
  }

  async function checkBackendSession() {
    try {
      const response = await backendFetch("/session/");
      if (!response.ok) return false;
      const payload = await response.json();
      if (payload.authenticated) {
        storeSession(payload.user, payload.accessToken);
        applyPermissions(payload.user);
        return true;
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  async function checkServerStatus() {
    if (isExternalFrontend) {
      updateServerStatus(false, "external");
      return;
    }
    try {
      const response = await backendFetch("/session/");
      updateServerStatus(response.ok);
    } catch (error) {
      updateServerStatus(false);
    }
  }

  async function loginWithBackend(username, password, accountType) {
    if (isExternalFrontend) {
      return { ok: false, reason: "BACKEND_REQUIRED_ORIGIN" };
    }
    try {
      const response = await backendFetch("/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, accountType })
      });
      const payload = await response.json();
      return response.ok && payload.ok === true ? payload : { ok: false, reason: payload.reason || "INVALID_CREDENTIALS" };
    } catch (error) {
      updateServerStatus(false);
      return { ok: false, reason: "BACKEND_OFFLINE" };
    }
  }

  if (isAuthenticated && isExternalFrontend) {
    clearSession();
  } else if (isAuthenticated) {
    checkBackendSession().then((ok) => {
      if (!ok) {
        expireSession();
        return;
      }
      applyPermissions();
      closed = true;
      notifyAuthenticated();
      splash.remove();
      document.body.classList.remove("app-booting");
    });
    return;
  }

  hydrateLiveStats();
  hydrateRememberedUser();
  checkServerStatus();
  wirePointerGlow();
  wireLoginLayoutToggle();
  if (!wireLoginRoleButtons(accountTypeInput)) {
    enhanceLoginSelect(accountTypeInput);
  }
  [userInput, passInput].forEach((input) => {
    input?.addEventListener("input", () => setLoginErrorState(false));
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginErrorState(false);
    const username = userInput?.value.trim() || "";
    const password = passInput?.value || "";
    const accountType = accountTypeInput?.value || "admin";

    if (enterButton) {
      enterButton.disabled = true;
      enterButton.classList.add("is-checking");
      enterButton.textContent = "\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0642\u0642...";
    }

    const loginResult = await loginWithBackend(username, password, accountType);
    const backendOk = loginResult.ok === true;

    if (backendOk) {
      try {
        if (rememberInput?.checked) {
          localStorage.setItem("tox-remembered-login", username);
        } else {
          localStorage.removeItem("tox-remembered-login");
        }
      } catch (error) {
        // Storage is not required for authentication.
      }
      storeSession(loginResult.user, loginResult.accessToken || "");
      if (errorBox) errorBox.textContent = "";
      setLoginErrorState(false);
      applyPermissions(readSessionUser());
      window.setTimeout(() => {
        const user = readSessionUser();
        if (user?.role === "super_admin" && currentPage() !== "super-admin") {
          window.location.href = firstAllowedPage(user);
          return;
        }
        if (!can(user, pagePermissions[currentPage()])) {
          window.location.href = firstAllowedPage(user);
          return;
        }
        closeSplash();
      }, 420);
      return;
    }

    if (enterButton) {
      enterButton.disabled = false;
      enterButton.classList.remove("is-checking");
      enterButton.textContent = enterButton.dataset.defaultText || "\u062f\u062e\u0648\u0644 \u0644\u0644\u0646\u0638\u0627\u0645";
    }
    if (errorBox) {
      errorBox.textContent = loginResult.reason === "ACCOUNT_EXPIRED"
        ? "انتهت صلاحية الحساب. يرجى تجديد الاشتراك."
        : loginResult.reason === "ROLE_MISMATCH"
        ? "\u0646\u0648\u0639 \u0627\u0644\u062d\u0633\u0627\u0628 \u0644\u0627 \u064a\u0637\u0627\u0628\u0642 \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645"
        : loginResult.reason === "BACKEND_REQUIRED_ORIGIN"
          ? `\u0627\u0641\u062a\u062d \u0627\u0644\u0646\u0638\u0627\u0645 \u0645\u0646 ${backendHomeUrl()} \u062d\u062a\u0649 \u064a\u0639\u0645\u0644 \u0645\u0646 \u0627\u0644\u0628\u0627\u0643 \u0627\u0646\u062f \u0648\u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.`
        : loginResult.reason === "BACKEND_OFFLINE"
          ? "\u0627\u0644\u0633\u064a\u0631\u0641\u0631 \u063a\u064a\u0631 \u0634\u063a\u0627\u0644. \u0634\u063a\u0644 \u0627\u0644\u0628\u0627\u0643\u0646\u062f \u062b\u0645 \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649."
        : "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629";
    }
    setLoginErrorState(true);
    window.playUiSound?.("error");
    passInput?.select();
  });
})();
