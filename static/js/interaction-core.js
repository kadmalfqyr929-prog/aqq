(function () {
  const soundAliases = {
    tap: "press",
    click: "press",
    barcode: "print",
    checkout: "sale",
    open: "notify",
    window: "notify"
  };

  let audioContext = null;
  let masterGain = null;
  let compressor = null;
  let unlocked = false;
  const lastPlayedAt = new Map();

  function clamp(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
  }

  function soundSettings() {
    const state = window.ToxStore?.getState?.() || {};
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("tox-business-settings-v2")) || {};
    } catch (error) {
      saved = {};
    }
    return {
      enabled: (state.soundEnabled ?? saved.soundEnabled) !== false,
      volume: clamp(state.soundVolume ?? saved.soundVolume ?? 0.85, 0, 1)
    };
  }

  function ensureAudioGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (audioContext) return audioContext;

    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, audioContext.currentTime);
    compressor.knee.setValueAtTime(18, audioContext.currentTime);
    compressor.ratio.setValueAtTime(9, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
    compressor.release.setValueAtTime(0.12, audioContext.currentTime);
    masterGain.gain.setValueAtTime(0.72, audioContext.currentTime);
    masterGain.connect(compressor);
    compressor.connect(audioContext.destination);
    return audioContext;
  }

  function unlock() {
    const context = ensureAudioGraph();
    if (!context) return Promise.resolve(false);
    if (context.state === "suspended") {
      return context.resume().then(() => {
        unlocked = true;
        return true;
      }).catch(() => false);
    }
    unlocked = true;
    return Promise.resolve(true);
  }

  const soundPresets = {
    press: [
      { frequency: 620, endFrequency: 760, duration: 0.052, gain: 0.12, wave: "triangle", cutoff: 4200 },
      { frequency: 1320, duration: 0.036, gain: 0.045, wave: "sine", delay: 0.014, cutoff: 6200 }
    ],
    nav: [
      { frequency: 460, endFrequency: 700, duration: 0.07, gain: 0.105, wave: "triangle", cutoff: 4300 },
      { frequency: 980, duration: 0.06, gain: 0.05, wave: "sine", delay: 0.035, cutoff: 6200 }
    ],
    select: [
      { frequency: 760, endFrequency: 520, duration: 0.055, gain: 0.095, wave: "triangle", cutoff: 3800 },
      { frequency: 1180, duration: 0.035, gain: 0.04, wave: "sine", delay: 0.018, cutoff: 6000 }
    ],
    success: [
      { frequency: 520, endFrequency: 760, duration: 0.065, gain: 0.12, wave: "triangle", cutoff: 4600 },
      { frequency: 820, endFrequency: 1080, duration: 0.085, gain: 0.105, wave: "sine", delay: 0.052, cutoff: 6200 },
      { frequency: 1320, duration: 0.075, gain: 0.055, wave: "sine", delay: 0.122, cutoff: 7000 }
    ],
    sale: [
      { frequency: 420, endFrequency: 650, duration: 0.07, gain: 0.13, wave: "triangle", cutoff: 4200 },
      { frequency: 760, endFrequency: 1060, duration: 0.095, gain: 0.12, wave: "sine", delay: 0.06, cutoff: 6400 },
      { frequency: 1560, duration: 0.06, gain: 0.055, wave: "sine", delay: 0.155, cutoff: 8200 }
    ],
    error: [
      { frequency: 260, endFrequency: 190, duration: 0.11, gain: 0.105, wave: "sawtooth", cutoff: 1700 },
      { frequency: 170, duration: 0.12, gain: 0.065, wave: "triangle", delay: 0.055, cutoff: 1400 }
    ],
    delete: [
      { frequency: 210, endFrequency: 120, duration: 0.13, gain: 0.12, wave: "sawtooth", cutoff: 1500 },
      { frequency: 90, duration: 0.14, gain: 0.07, wave: "triangle", delay: 0.04, cutoff: 1200 }
    ],
    print: [
      { frequency: 980, duration: 0.035, gain: 0.08, wave: "square", cutoff: 5200 },
      { frequency: 1240, duration: 0.035, gain: 0.075, wave: "square", delay: 0.044, cutoff: 5600 },
      { frequency: 1480, duration: 0.045, gain: 0.06, wave: "sine", delay: 0.088, cutoff: 6500 }
    ],
    notify: [
      { frequency: 650, endFrequency: 870, duration: 0.08, gain: 0.09, wave: "sine", cutoff: 5000 },
      { frequency: 1160, duration: 0.07, gain: 0.05, wave: "triangle", delay: 0.07, cutoff: 6500 }
    ],
    welcome: [
      { frequency: 392, endFrequency: 523.25, duration: 0.11, gain: 0.105, wave: "triangle", cutoff: 4200 },
      { frequency: 659.25, endFrequency: 783.99, duration: 0.12, gain: 0.1, wave: "sine", delay: 0.095, cutoff: 6000 },
      { frequency: 1046.5, duration: 0.13, gain: 0.06, wave: "sine", delay: 0.21, cutoff: 7200 }
    ]
  };

  function play(type = "press", options = {}) {
    const normalizedType = soundAliases[type] || type || "press";
    const preset = soundPresets[normalizedType] || soundPresets.press;
    const settings = soundSettings();
    if (!settings.enabled || settings.volume <= 0) return;

    const nowMs = performance.now();
    const throttleKey = ["press", "nav", "select"].includes(normalizedType) ? normalizedType : "";
    if (throttleKey && nowMs - (lastPlayedAt.get(throttleKey) || 0) < 42) return;
    if (throttleKey) lastPlayedAt.set(throttleKey, nowMs);

    const context = ensureAudioGraph();
    if (!context) return;
    if (context.state === "suspended") {
      unlock().then((ok) => {
        if (ok && unlocked) play(normalizedType, options);
      });
      return;
    }

    const now = context.currentTime;
    const volume = clamp(options.volume ?? settings.volume, 0, 1);
    preset.forEach((tone) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const start = now + (tone.delay || 0);
      const end = start + tone.duration;
      oscillator.type = tone.wave || "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      if (tone.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, tone.endFrequency), end);
      }
      filter.type = tone.filterType || "lowpass";
      filter.frequency.setValueAtTime(tone.cutoff || 5200, start);
      filter.Q.setValueAtTime(tone.q || 0.55, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, tone.gain * volume), start + 0.009);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      oscillator.start(start);
      oscillator.stop(end + 0.025);
    });
  }

  const userInputEvents = ["pointerdown", "keydown", "touchend"];
  function unlockFromUserInput() {
    unlock();
    userInputEvents.forEach((name) => document.removeEventListener(name, unlockFromUserInput, true));
  }
  userInputEvents.forEach((name) => document.addEventListener(name, unlockFromUserInput, true));

  const selectState = new WeakMap();
  let selectUid = 0;
  let repositionFrame = 0;

  function selectedOptionText(select) {
    const option = select.options[select.selectedIndex];
    return option ? option.textContent.trim() : "";
  }

  function clearMenuPosition(menu) {
    if (!menu) return;
    ["position", "top", "bottom", "left", "right", "width", "max-height", "max-width", "min-width", "inset-inline", "transform-origin", "overflow-x", "overflow-y"].forEach((prop) => {
      menu.style.removeProperty(prop);
    });
  }

  function selectSurface(shell) {
    return shell?.closest(".panel, .flowbar, .login-panel, .login-form-panel, .login-v2026");
  }

  function stateForShell(shell) {
    const select = shell?.querySelector("select");
    return select ? selectState.get(select) : null;
  }

  function menuForShell(shell) {
    return stateForShell(shell)?.menu || shell?.querySelector("[data-tox-select-menu]");
  }

  function restoreMenu(shell, menu) {
    if (!shell || !menu || menu.parentNode === shell) return;
    shell.appendChild(menu);
  }

  function deactivateMenu(menu) {
    if (!menu) return;
    menu.classList.remove("is-portal", "is-open");
    menu.removeAttribute("data-open-direction");
    clearMenuPosition(menu);
  }

  function closeShell(shell) {
    if (!shell) return;
    const state = stateForShell(shell);
    const menu = menuForShell(shell);
    selectSurface(shell)?.classList.remove("select-panel-open");
    shell.classList.remove("is-open", "opens-up");
    state?.button?.setAttribute("aria-expanded", "false");
    state?.button?.removeAttribute("aria-activedescendant");
    deactivateMenu(menu);
    restoreMenu(shell, menu);
  }

  function closeAll(except = null) {
    document.querySelectorAll(".tox-select-shell.is-open").forEach((shell) => {
      if (shell !== except) closeShell(shell);
    });
  }

  function selectedMenuOption(menu) {
    return menu?.querySelector('.tox-select-option[aria-selected="true"]');
  }

  function optionButtonAt(menu, index) {
    return menu?.querySelector(`.tox-select-option[data-select-index="${index}"]`);
  }

  function scrollOptionIntoMenu(menu, option, block = "nearest") {
    if (!menu || !option) return;
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    const maxScroll = Math.max(0, menu.scrollHeight - menu.clientHeight);
    if (block === "center") {
      menu.scrollTop = Math.min(maxScroll, Math.max(0, optionTop - (menu.clientHeight - option.offsetHeight) / 2));
      return;
    }
    if (optionTop < menu.scrollTop) menu.scrollTop = optionTop;
    if (optionBottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = Math.min(maxScroll, optionBottom - menu.clientHeight);
  }

  function firstEnabledIndex(select) {
    return [...select.options].findIndex((option) => !option.disabled);
  }

  function lastEnabledIndex(select) {
    for (let index = select.options.length - 1; index >= 0; index -= 1) {
      if (!select.options[index].disabled) return index;
    }
    return -1;
  }

  function nearestEnabledIndex(select, index, direction = 1) {
    const options = [...select.options];
    if (!options.length) return -1;
    const bounded = Math.min(Math.max(Number(index) || 0, 0), options.length - 1);
    if (!options[bounded].disabled) return bounded;
    for (let offset = 1; offset < options.length; offset += 1) {
      const forward = bounded + offset * direction;
      if (forward >= 0 && forward < options.length && !options[forward].disabled) return forward;
      const backward = bounded - offset * direction;
      if (backward >= 0 && backward < options.length && !options[backward].disabled) return backward;
    }
    return -1;
  }

  function moveEnabledIndex(select, currentIndex, delta, amount = 1) {
    if (!select.options.length) return -1;
    let index = nearestEnabledIndex(select, currentIndex, delta);
    if (index < 0) return -1;
    for (let step = 0; step < amount; step += 1) {
      let next = index + delta;
      let found = index;
      while (next >= 0 && next < select.options.length) {
        if (!select.options[next].disabled) {
          found = next;
          break;
        }
        next += delta;
      }
      if (found === index) break;
      index = found;
    }
    return index;
  }

  function setActiveIndex(select, index, options = {}) {
    const state = selectState.get(select);
    if (!state) return -1;
    const activeIndex = nearestEnabledIndex(select, index, index >= (state.activeIndex ?? select.selectedIndex) ? 1 : -1);
    state.activeOption?.removeAttribute("data-active");
    if (activeIndex < 0) {
      state.activeIndex = -1;
      state.activeOption = null;
      state.button.removeAttribute("aria-activedescendant");
      return -1;
    }
    const item = optionButtonAt(state.menu, activeIndex);
    state.activeIndex = activeIndex;
    state.activeOption = item || null;
    if (item) {
      item.dataset.active = "true";
      state.button.setAttribute("aria-activedescendant", item.id);
      if (options.scroll) scrollOptionIntoMenu(state.menu, item, options.block || "nearest");
    }
    return activeIndex;
  }

  function alignSelectedOption(select, block = "nearest") {
    const state = selectState.get(select);
    if (!state) return;
    const selectedIndex = select.selectedIndex >= 0 ? select.selectedIndex : firstEnabledIndex(select);
    setActiveIndex(select, selectedIndex, { scroll: true, block });
  }

  function positionShell(shell, options = {}) {
    if (!shell?.classList.contains("is-open")) return;
    const button = shell.querySelector("[data-tox-select-button]");
    const menu = menuForShell(shell);
    if (!button || !menu) return;
    if (!button.isConnected || !document.body?.contains(button)) {
      closeShell(shell);
      return;
    }

    shell.classList.remove("opens-up");
    clearMenuPosition(menu);

    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      closeShell(shell);
      return;
    }
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
    const gap = 6;
    const edgePadding = 12;
    const flowbarSurface = shell.closest(".flowbar");
    const flowbarRect = flowbarSurface?.getBoundingClientRect();
    const hasFlowbarBounds = Boolean(flowbarRect?.width);
    const boundaryLeft = hasFlowbarBounds ? Math.max(edgePadding, flowbarRect.left + edgePadding / 2) : edgePadding;
    const boundaryRight = hasFlowbarBounds ? Math.min(viewportWidth - edgePadding, flowbarRect.right - edgePadding / 2) : viewportWidth - edgePadding;
    const maxViewportWidth = Math.max(120, boundaryRight - boundaryLeft);
    const select = stateForShell(shell)?.select;
    const wideSelect = Boolean(select?.matches?.("[data-wide-select],[data-product-input]"));
    const wideSelectWidth = flowbarSurface ? 500 : 560;
    const minWidth = wideSelect ? Math.min(wideSelectWidth, maxViewportWidth) : Math.min(180, maxViewportWidth);
    const width = Math.min(Math.max(rect.width, minWidth), maxViewportWidth);
    const direction = getComputedStyle(button).direction || document.dir || "ltr";
    const preferredLeft = direction === "rtl" ? rect.right - width : rect.left;
    const left = Math.min(Math.max(boundaryLeft, preferredLeft), Math.max(boundaryLeft, boundaryRight - width));

    if (menu.parentNode !== document.body) document.body.appendChild(menu);
    menu.classList.add("is-portal", "is-open");
    menu.dir = direction;
    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("inset-inline", "auto", "important");
    menu.style.setProperty("left", `${left}px`, "important");
    menu.style.setProperty("right", "auto", "important");
    menu.style.setProperty("width", `${width}px`, "important");
    menu.style.setProperty("max-width", `${maxViewportWidth}px`, "important");
    menu.style.setProperty("overflow-x", "hidden", "important");
    menu.style.setProperty("overflow-y", "auto", "important");

    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - edgePadding);
    const spaceAbove = Math.max(0, rect.top - gap - edgePadding);
    const maxMenuHeight = Math.min(420, Math.max(120, viewportHeight - edgePadding * 2));
    menu.style.setProperty("max-height", `${maxMenuHeight}px`, "important");
    const desiredHeight = Math.min(menu.scrollHeight || 260, maxMenuHeight);
    const prefersUp = Boolean(shell.closest(".flowbar"));
    const opensUp = (prefersUp && spaceAbove >= Math.min(desiredHeight, 120))
      || (spaceBelow < Math.min(desiredHeight, 180) && spaceAbove > spaceBelow);
    const available = opensUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(84, Math.min(Math.max(available, 84), desiredHeight, maxMenuHeight));

    shell.classList.toggle("opens-up", opensUp);
    menu.style.setProperty("max-height", `${maxHeight}px`, "important");
    menu.style.setProperty("top", opensUp ? `${Math.max(edgePadding, rect.top - gap - maxHeight)}px` : `${Math.min(rect.bottom + gap, viewportHeight - edgePadding - maxHeight)}px`, "important");
    menu.style.setProperty("bottom", "auto", "important");
    menu.style.setProperty("transform-origin", opensUp ? "bottom center" : "top center", "important");
    menu.dataset.openDirection = opensUp ? "up" : "down";

    if (options.alignSelected) {
      const state = stateForShell(shell);
      requestAnimationFrame(() => alignSelectedOption(state?.select, "nearest"));
    }
  }

  function repositionOpen() {
    if (repositionFrame) return;
    repositionFrame = requestAnimationFrame(() => {
      repositionFrame = 0;
      document.querySelectorAll(".tox-select-shell.is-open").forEach((shell) => positionShell(shell));
    });
  }

  function chooseOption(select, index) {
    const state = selectState.get(select);
    const shell = select.closest(".tox-select-shell");
    const option = select.options[Number(index)];
    if (!state || !shell || !option || option.disabled) return;
    select.selectedIndex = Number(index);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    update(select);
    closeShell(shell);
    state.button.focus({ preventScroll: true });
    play("select");
  }

  function openShell(select, shell) {
    const state = selectState.get(select);
    if (!state || !shell) return;
    closeAll(shell);
    update(select);
    shell.classList.add("is-open");
    state.button.setAttribute("aria-expanded", "true");
    selectSurface(shell)?.classList.add("select-panel-open");
    positionShell(shell, { alignSelected: true });
  }

  function pageMoveAmount(menu) {
    const option = menu.querySelector(".tox-select-option");
    if (!option) return 6;
    return Math.max(2, Math.floor(menu.clientHeight / Math.max(1, option.offsetHeight)) - 1);
  }

  function handleSelectKeydown(select, event) {
    const state = selectState.get(select);
    const shell = select.closest(".tox-select-shell");
    if (!state || !shell) return;
    const isOpen = shell.classList.contains("is-open");
    const openKeys = ["ArrowDown", "ArrowUp", "Enter", " ", "Spacebar"];
    if (!isOpen && openKeys.includes(event.key)) {
      event.preventDefault();
      openShell(select, shell);
      return;
    }
    if (!isOpen) return;

    const current = state.activeIndex ?? select.selectedIndex;
    if (event.key === "Escape") {
      event.preventDefault();
      closeShell(shell);
      state.button.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Tab") {
      closeShell(shell);
      return;
    }
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      chooseOption(select, state.activeIndex ?? select.selectedIndex);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(select, moveEnabledIndex(select, current, event.key === "ArrowDown" ? 1 : -1), { scroll: true });
      return;
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      setActiveIndex(select, moveEnabledIndex(select, current, event.key === "PageDown" ? 1 : -1, pageMoveAmount(state.menu)), { scroll: true });
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(select, event.key === "Home" ? firstEnabledIndex(select) : lastEnabledIndex(select), { scroll: true });
    }
  }

  function update(select) {
    if (!select) {
      document.querySelectorAll(".tox-native-select").forEach(update);
      return;
    }
    const state = selectState.get(select);
    const shell = select.closest(".tox-select-shell");
    const button = shell?.querySelector("[data-tox-select-button]");
    const menu = state?.menu || shell?.querySelector("[data-tox-select-menu]");
    if (!state || !shell || !button || !menu) return;

    const buttonText = selectedOptionText(select) || state.placeholder;
    button.textContent = buttonText;
    if (buttonText) {
      button.title = buttonText;
    } else {
      button.removeAttribute("title");
    }
    button.disabled = select.disabled;
    button.setAttribute("aria-disabled", String(select.disabled));
    menu.replaceChildren();
    state.activeOption = null;
    const fragment = document.createDocumentFragment();
    [...select.options].forEach((option, index) => {
      const item = document.createElement("button");
      item.className = "tox-select-option";
      item.type = "button";
      item.id = `${state.uid}-option-${index}`;
      item.setAttribute("role", "option");
      item.dataset.selectIndex = String(index);
      item.disabled = option.disabled;
      item.setAttribute("aria-selected", String(option.selected));
      item.textContent = option.textContent;
      item.title = option.textContent.trim();
      fragment.appendChild(item);
    });
    menu.appendChild(fragment);
    const selectedIndex = select.selectedIndex >= 0 ? select.selectedIndex : firstEnabledIndex(select);
    const activeIndex = shell.classList.contains("is-open") ? state.activeIndex ?? selectedIndex : selectedIndex;
    setActiveIndex(select, activeIndex);
    if (shell.classList.contains("is-open")) positionShell(shell);
  }

  function enhance(select, options = {}) {
    if (!select || select.multiple || select.dataset.nativeSelect === "true" || select.closest(".tox-select-shell")) return select;
    const shell = document.createElement("span");
    const extraClass = options.className || "";
    shell.className = `tox-select-shell ${extraClass} ${select.className || ""}`.trim();
    const button = document.createElement("button");
    button.className = "tox-select-button";
    button.type = "button";
    button.dataset.toxSelectButton = "true";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("span");
    menu.className = "tox-select-menu";
    menu.dataset.toxSelectMenu = "true";
    menu.setAttribute("role", "listbox");
    menu.tabIndex = -1;

    select.parentNode.insertBefore(shell, select);
    shell.appendChild(select);
    shell.appendChild(button);
    shell.appendChild(menu);
    select.classList.add("tox-native-select");
    selectState.set(select, {
      uid: `tox-select-${++selectUid}`,
      select,
      placeholder: options.placeholder || "\u0627\u062e\u062a\u064a\u0627\u0631",
      button,
      menu,
      activeIndex: select.selectedIndex
    });

    select.addEventListener("change", () => update(select));
    menu.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const item = target?.closest(".tox-select-option");
      if (!item || !menu.contains(item)) return;
      chooseOption(select, item.dataset.selectIndex);
    });
    menu.addEventListener("keydown", (event) => handleSelectKeydown(select, event));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const wasOpen = shell.classList.contains("is-open");
      closeAll(shell);
      if (wasOpen) {
        closeShell(shell);
        return;
      }
      openShell(select, shell);
    });
    button.addEventListener("keydown", (event) => handleSelectKeydown(select, event));
    new MutationObserver(() => update(select)).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["selected", "disabled", "label", "value"]
    });
    update(select);
    return select;
  }

  function enhanceAll(root = document) {
    root.querySelectorAll?.("select").forEach((select) => enhance(select));
  }

  let observerReady = false;
  function observe() {
    if (observerReady || !document.body) return;
    observerReady = true;
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target?.closest(".tox-select-shell") && !target?.closest("[data-tox-select-menu]")) closeAll();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAll();
    });
    document.addEventListener("reset", (event) => {
      requestAnimationFrame(() => {
        event.target?.querySelectorAll?.("select").forEach(update);
      });
    }, true);
    window.addEventListener("resize", repositionOpen);
    window.addEventListener("scroll", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-tox-select-menu]")) return;
      repositionOpen();
    }, true);
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches?.(".tox-select-shell")) closeShell(node);
          node.querySelectorAll?.(".tox-select-shell").forEach(closeShell);
        });
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches?.("select")) enhance(node);
          enhanceAll(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  const draftPrefix = "tox-form-draft-v1:";
  const draftTimers = new WeakMap();
  const draftOptions = new WeakMap();
  const draftTracked = new WeakSet();
  let draftObserverReady = false;

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  const smartSearchSelector = [
    "input.quick-search",
    "input[data-product-search]",
    "input[data-barcode-search]",
    "input[data-invoice-filter-q]"
  ].join(",");
  const smartSearchEnhanced = new WeakSet();
  let smartSearchObserverReady = false;

  function smartSearchLabel(input) {
    const lang = document.documentElement.lang || document.body?.dataset.lang || "ar";
    return lang === "ar" ? "مسح البحث" : "Clear search";
  }

  function isInvoiceFilterSearch(input) {
    return input.matches("[data-invoice-filter-q]") || Boolean(input.closest(".invoice-filter-panel"));
  }

  function updateSmartSearchClear(input, clearButton) {
    if (!clearButton) return;
    const hasValue = Boolean(input.value);
    clearButton.hidden = !hasValue;
    clearButton.setAttribute("aria-hidden", String(!hasValue));
  }

  function dispatchSmartSearchClear(input) {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus({ preventScroll: true });
    play("tap");
  }

  function enhanceSmartSearch(input) {
    if (!(input instanceof HTMLInputElement) || smartSearchEnhanced.has(input) || input.closest(".smart-search-pill")) return input;
    const filterSearch = isInvoiceFilterSearch(input);
    const wrapper = document.createElement("div");
    wrapper.className = `smart-search-pill${filterSearch ? " smart-search-filter" : ""}`;
    const icon = document.createElement("span");
    icon.className = "smart-search-icon";
    icon.setAttribute("aria-hidden", "true");
    const parent = input.parentNode;
    if (!parent) return input;
    parent.insertBefore(wrapper, input);
    wrapper.appendChild(icon);
    wrapper.appendChild(input);
    input.classList.add("smart-search-input");

    let clearButton = null;
    if (!filterSearch) {
      clearButton = document.createElement("button");
      clearButton.className = "smart-search-clear";
      clearButton.type = "button";
      clearButton.setAttribute("aria-label", smartSearchLabel(input));
      clearButton.textContent = "×";
      wrapper.appendChild(clearButton);
      clearButton.addEventListener("click", () => dispatchSmartSearchClear(input));
      updateSmartSearchClear(input, clearButton);
    }

    input.addEventListener("input", () => updateSmartSearchClear(input, clearButton));
    input.addEventListener("change", () => updateSmartSearchClear(input, clearButton));
    smartSearchEnhanced.add(input);
    return input;
  }

  function enhanceSmartSearches(root = document) {
    root.querySelectorAll?.(smartSearchSelector).forEach((input) => enhanceSmartSearch(input));
  }

  function observeSmartSearches() {
    if (smartSearchObserverReady) return;
    smartSearchObserverReady = true;
    ready(() => {
      enhanceSmartSearches(document);
      new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            if (node.matches?.(smartSearchSelector)) enhanceSmartSearch(node);
            enhanceSmartSearches(node);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  function firstDataKey(element) {
    const key = Object.keys(element.dataset || {}).find((entry) => !["draftKey", "draftManual", "noDraft"].includes(entry));
    return key ? `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}` : "";
  }

  function formDraftKey(form) {
    if (!form) return "";
    if (form.dataset.draftKey) return `${draftPrefix}${form.dataset.draftKey}`;
    const page = document.body?.dataset.page || location.pathname.replace(/[^\w-]+/g, "-") || "page";
    const identity = form.id || form.getAttribute("name") || firstDataKey(form) || [...document.forms].indexOf(form);
    return `${draftPrefix}${page}:${identity}`;
  }

  function isSensitiveDraftField(field) {
    const type = String(field.type || "").toLowerCase();
    const key = `${field.name || ""} ${field.id || ""} ${firstDataKey(field)}`.toLowerCase();
    return field.dataset.noDraft === "true"
      || ["password", "file", "submit", "button", "reset"].includes(type)
      || /(password|token|csrf|secret|authorization|access|refresh|login-pass)/i.test(key);
  }

  function fieldDraftKey(field) {
    return field.name || field.id || firstDataKey(field);
  }

  function draftFields(form) {
    return [...form.querySelectorAll("input, textarea, select")]
      .filter((field) => fieldDraftKey(field) && !isSensitiveDraftField(field));
  }

  function serializeForm(form) {
    const fields = {};
    draftFields(form).forEach((field) => {
      const key = fieldDraftKey(field);
      if (field.type === "checkbox") {
        fields[key] = { type: "checkbox", checked: field.checked };
      } else if (field.type === "radio") {
        if (field.checked) fields[key] = { type: "radio", value: field.value };
      } else if (field.tagName === "SELECT" && field.multiple) {
        fields[key] = { type: "select-multiple", value: [...field.selectedOptions].map((option) => option.value) };
      } else {
        fields[key] = { type: field.tagName.toLowerCase(), value: field.value };
      }
    });
    const options = draftOptions.get(form) || {};
    return {
      fields,
      extra: typeof options.serializeExtra === "function" ? options.serializeExtra(form) : undefined,
      updatedAt: new Date().toISOString()
    };
  }

  function applyDraftFields(form, draft) {
    const fields = draft?.fields || {};
    draftFields(form).forEach((field) => {
      const item = fields[fieldDraftKey(field)];
      if (!item) return;
      if (field.type === "checkbox") {
        field.checked = Boolean(item.checked);
      } else if (field.type === "radio") {
        field.checked = field.value === item.value;
      } else if (field.tagName === "SELECT" && field.multiple && Array.isArray(item.value)) {
        [...field.options].forEach((option) => {
          option.selected = item.value.includes(option.value);
        });
      } else if (Object.prototype.hasOwnProperty.call(item, "value")) {
        field.value = item.value;
      }
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    window.ToxSelects?.update?.();
  }

  function loadDraft(form) {
    try {
      const raw = sessionStorage.getItem(formDraftKey(form));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveDraft(form) {
    if (!form || form.dataset.noDraft === "true") return;
    try {
      sessionStorage.setItem(formDraftKey(form), JSON.stringify(serializeForm(form)));
    } catch (error) {
      console.warn("Could not save form draft", error);
    }
  }

  function scheduleDraftSave(form) {
    if (!form || form.dataset.noDraft === "true") return;
    clearTimeout(draftTimers.get(form));
    draftTimers.set(form, setTimeout(() => saveDraft(form), 180));
  }

  function clearDraft(form) {
    if (!form) return;
    try {
      sessionStorage.removeItem(formDraftKey(form));
    } catch (error) {
      console.warn("Could not clear form draft", error);
    }
  }

  function restoreDraft(form, options = draftOptions.get(form) || {}) {
    const draft = loadDraft(form);
    if (!draft) return null;
    if (typeof options.beforeRestore === "function") options.beforeRestore(draft, form);
    applyDraftFields(form, draft);
    if (typeof options.afterRestore === "function") options.afterRestore(draft, form);
    return draft;
  }

  function trackDraftForm(form, options = {}) {
    if (!form || form.dataset.noDraft === "true") return form;
    draftOptions.set(form, { ...(draftOptions.get(form) || {}), ...options });
    draftTracked.add(form);
    if (options.restore !== false) restoreDraft(form, draftOptions.get(form));
    return form;
  }

  function trackAutoDraftForms(root = document) {
    root.querySelectorAll?.("form").forEach((form) => {
      if (form.dataset.draftManual === "true") return;
      if (!draftTracked.has(form)) trackDraftForm(form, { restore: true });
    });
  }

  function observeDrafts() {
    if (draftObserverReady) return;
    draftObserverReady = true;
    ready(() => {
      trackAutoDraftForms(document);
      document.addEventListener("input", (event) => {
        const field = event.target instanceof Element ? event.target : null;
        const form = field?.closest("form");
        if (!form || isSensitiveDraftField(field)) return;
        if (!draftTracked.has(form) && form.dataset.draftManual !== "true") trackDraftForm(form, { restore: false });
        scheduleDraftSave(form);
      }, true);
      document.addEventListener("change", (event) => {
        const field = event.target instanceof Element ? event.target : null;
        const form = field?.closest("form");
        if (!form || isSensitiveDraftField(field)) return;
        if (!draftTracked.has(form) && form.dataset.draftManual !== "true") trackDraftForm(form, { restore: false });
        scheduleDraftSave(form);
      }, true);
      document.addEventListener("reset", (event) => {
        if (event.target instanceof HTMLFormElement) clearDraft(event.target);
      }, true);
      new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            if (node.matches?.("form")) trackAutoDraftForms(node.parentElement || document);
            trackAutoDraftForms(node);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  window.ToxSound = { play, unlock };
  window.playUiSound = play;
  window.ToxSelects = { enhance, enhanceAll, update, closeAll, repositionOpen, observe };
  window.ToxSmartSearch = { enhance: enhanceSmartSearch, enhanceAll: enhanceSmartSearches };
  window.ToxFormDrafts = {
    track: trackDraftForm,
    observe: observeDrafts,
    restore: restoreDraft,
    save: saveDraft,
    clear: clearDraft,
    load: loadDraft,
    keyFor: formDraftKey
  };
  observeSmartSearches();
  observeDrafts();
})();
