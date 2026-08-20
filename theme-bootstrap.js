(function () {
  const themeIds = ["tox-blue", "noir"];
  const themeMeta = {
    "tox-blue": {
      mode: "light",
      group: "primary",
      label: "White",
      description: "Primary bright workspace",
      accent: "#0ea5e9"
    },
    noir: {
      mode: "dark",
      group: "primary",
      label: "Black",
      description: "Primary dark workspace",
      accent: "#f8fafc"
    },
    "matte-black": {
      mode: "dark",
      group: "secondary-dark",
      label: "Matte Black",
      description: "Secondary charcoal dark workspace",
      accent: "#c26a2e"
    },
    "summer-orange": {
      mode: "light",
      group: "secondary-light",
      label: "Summer Orange",
      description: "Secondary warm light workspace",
      accent: "#f97316"
    },
    "emerald-ledger": {
      mode: "light",
      group: "secondary-light",
      label: "Emerald Ledger",
      description: "Secondary accounting light workspace",
      accent: "#047857"
    },
    "graphite-lime": {
      mode: "dark",
      group: "secondary-dark",
      label: "Graphite Lime",
      description: "Secondary graphite dark workspace",
      accent: "#84cc16"
    },
    "ruby-slate": {
      mode: "light",
      group: "secondary-light",
      label: "Ruby Slate",
      description: "Secondary slate light workspace",
      accent: "#e11d48"
    },
    "amethyst-control": {
      mode: "light",
      group: "secondary-light",
      label: "Amethyst Control",
      description: "Secondary neutral light workspace",
      accent: "#7c3aed"
    },
    "violet-night": {
      mode: "dark",
      group: "secondary-dark",
      label: "Violet Night",
      description: "Secondary violet dark workspace",
      accent: "#8b5cf6"
    }
  };
  const legacyThemeMap = {
    coffee: "summer-orange",
    "neon-blue": "matte-black",
    "teal-slate": "tox-blue",
    "tox-pro": "tox-blue"
  };
  const loginClasses = [
    "login-light-theme",
    "login-dark-theme",
    "login-coffee-theme",
    "login-neon-theme",
    "login-teal-theme",
    "login-matte-theme",
    "login-summer-theme",
    "login-emerald-theme",
    "login-graphite-theme",
    "login-ruby-theme",
    "login-amethyst-theme",
    "login-violet-theme"
  ];

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch (error) {
      return {};
    }
  }

  function normalizeTheme(theme, fallback = "tox-blue") {
    const mapped = legacyThemeMap[theme] || theme;
    return themeIds.includes(mapped) ? mapped : fallback;
  }

  function getThemeMeta(theme) {
    const normalized = normalizeTheme(theme);
    return themeMeta[normalized] || themeMeta["tox-blue"];
  }

  function resolveInitialTheme() {
    const settings = readJson("tox-business-settings-v2");
    const state = readJson("tox-business-state-v4");
    return normalizeTheme(settings.theme, normalizeTheme(state.theme));
  }

  function applyTheme(theme, root = document.documentElement) {
    const normalized = normalizeTheme(theme);
    const meta = getThemeMeta(normalized);
    root.dataset.theme = normalized;
    root.dataset.themeMode = meta.mode;
    root.dataset.themeGroup = meta.group;
    root.classList.remove(...loginClasses);
    root.classList.toggle("login-light-theme", meta.mode === "light");
    root.classList.toggle("login-dark-theme", meta.mode === "dark");
    root.classList.toggle("login-matte-theme", normalized === "matte-black");
    root.classList.toggle("login-summer-theme", normalized === "summer-orange");
    root.classList.toggle("login-emerald-theme", normalized === "emerald-ledger");
    root.classList.toggle("login-graphite-theme", normalized === "graphite-lime");
    root.classList.toggle("login-ruby-theme", normalized === "ruby-slate");
    root.classList.toggle("login-amethyst-theme", normalized === "amethyst-control");
    root.classList.toggle("login-violet-theme", normalized === "violet-night");
    return normalized;
  }

  function cycleTheme() {
    const currentTheme = document.documentElement.dataset.theme || resolveInitialTheme();
    const currentMode = getThemeMeta(currentTheme).mode;
    
    // Toggle between standard light and dark themes
    const nextTheme = currentMode === "light" ? "noir" : "tox-blue";
    
    applyTheme(nextTheme);
    
    // Save to localStorage
    const settings = readJson("tox-business-settings-v2");
    settings.theme = nextTheme;
    localStorage.setItem("tox-business-settings-v2", JSON.stringify(settings));
    
    return nextTheme;
  }

  window.ToxThemes = {
    all: themeIds.slice(),
    metadata: themeIds.reduce((map, theme) => {
      map[theme] = { ...themeMeta[theme] };
      return map;
    }, {}),
    normalize: normalizeTheme,
    meta: getThemeMeta,
    apply: applyTheme,
    resolveInitialTheme,
    cycle: cycleTheme
  };

  applyTheme(resolveInitialTheme());
})();
