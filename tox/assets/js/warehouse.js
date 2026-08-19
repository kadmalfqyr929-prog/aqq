const warehouseList = document.querySelector("[data-warehouse-list]");
const warehouseDetail = document.querySelector("[data-warehouse-detail]");
const warehouseCount = document.querySelector("[data-warehouse-count]");
const warehouseSearch = document.querySelector("[data-warehouse-search]");
const warehouseTitle = document.querySelector("[data-warehouse-title]");
const warehouseEyebrow = document.querySelector("[data-warehouse-eyebrow]");
const warehouseSearchLabel = document.querySelector("[data-warehouse-search-label]");
const warehouseAddToggle = document.querySelector("[data-warehouse-add-toggle]");
const warehouseForm = document.querySelector("[data-warehouse-form]");
const warehouseViewButtons = document.querySelectorAll("[data-warehouse-view]");
const warehouseViewPanels = document.querySelectorAll("[data-warehouse-view-panel]");
const unitPresetForm = document.querySelector("[data-unit-preset-form]");
const brandForm = document.querySelector("[data-brand-form]");
const originCountryForm = document.querySelector("[data-origin-country-form]");
const unitPresetList = document.querySelector("[data-unit-preset-list]");
const brandList = document.querySelector("[data-brand-list]");
const originCountryList = document.querySelector("[data-origin-country-list]");
const unitPresetCount = document.querySelector("[data-unit-preset-count]");
const brandCount = document.querySelector("[data-brand-count]");
const originCountryCount = document.querySelector("[data-origin-country-count]");

const unitPresetKindOrder = ["weighted", "packaged", "single", "liquid", "length"];
const unitPresetKindAccents = {
  weighted: "#34d399",
  packaged: "#f97316",
  single: "#64748b",
  liquid: "#38bdf8",
  length: "#8b5cf6"
};

const warehouseSelectionKey = "tox-selected-warehouse";
const warehouseViewKey = "tox-warehouse-view";
let selectedWarehouseId = sessionStorage.getItem(warehouseSelectionKey) || "";
let activeWarehouseView = sessionStorage.getItem(warehouseViewKey) || "manage";
let editingProductId = "";
let savingWarehouseProductId = "";
let highlightedProductId = "";
let warehouseDetailQuery = "";
let warehouseDetailSearchFrame = 0;
const warehouseImageDrafts = new Map();

function escapeWarehouseHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function captureWarehouseDetailSearchFocus() {
  const input = warehouseDetail?.querySelector("[data-warehouse-detail-search]");
  if (!input || document.activeElement !== input) return null;
  return {
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection || "none"
  };
}

function restoreWarehouseDetailSearchFocus(snapshot) {
  if (!snapshot) return;
  const input = warehouseDetail?.querySelector("[data-warehouse-detail-search]");
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
  } catch (error) {
    input.focus();
  }
  if (snapshot.start !== null && snapshot.end !== null && typeof input.setSelectionRange === "function") {
    try {
      input.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction);
    } catch (error) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function safeAccent(value, fallback = "#d6b35a") {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function productHasBarcode(product) {
  if (String(product.barcode || "").trim()) return true;
  return (product.units || []).some((unit) => String(unit.barcode || "").trim());
}

function productImageSource(product) {
  return String(product?.image || product?.imageUrl || "").trim();
}

function productOrigin(product) {
  return String(product?.originCountry || product?.origin || product?.origin_country || "").trim();
}

function originCountryMarkup(name, fallback = "") {
  const text = String(name || "").trim();
  if (!text) return fallback;
  const color = ToxStore.originCountryColor?.(text) || "";
  if (!color) return escapeWarehouseHtml(text);
  return `<span class="origin-country-token" style="--origin-accent:${escapeWarehouseHtml(color)}"><span class="origin-country-dot" aria-hidden="true"></span>${escapeWarehouseHtml(text)}</span>`;
}

function productMetaMarkup(parts) {
  return parts.filter(Boolean).join(`<span class="meta-separator">|</span>`);
}

function warehouseOriginOptions() {
  return (ToxStore.smartOriginCountries?.() || [])
    .map((country) => `<option value="${escapeWarehouseHtml(country)}"></option>`)
    .join("");
}

function warehouseOriginPickerItems(state) {
  const origins = ToxStore.smartOriginCountries?.() || [];
  return origins.length
    ? origins.slice(0, 14).map((country) => {
      const color = ToxStore.originCountryColor?.(country) || "";
      return `
        <button class="brand-suggestion-chip warehouse-origin-choice" type="button" data-origin-pick="${escapeWarehouseHtml(country)}">
          <strong>${originCountryMarkup(country)}</strong>
          <span>${color ? (state.lang === "ar" ? "مثبت" : "Saved") : (state.lang === "ar" ? "اقتراح" : "Suggestion")}</span>
        </button>
      `;
    }).join("")
    : `<small>${state.lang === "ar" ? "لا توجد منشأات مقترحة" : "No origin suggestions"}</small>`;
}

function productHasImage(product) {
  return Boolean(productImageSource(product));
}

function productFallbackText(product) {
  return escapeWarehouseHtml(String(product?.name || "TOX").trim().slice(0, 2) || "TOX");
}

function productMediaMarkup(product, className = "product-card-media", source = productImageSource(product), extraAttributes = "") {
  const image = String(source || "").trim();
  return `
    <div class="${className} ${image ? "" : "is-empty"}" ${extraAttributes}>
      ${image ? `<img src="${escapeWarehouseHtml(image)}" alt="" />` : `<span>${productFallbackText(product)}</span>`}
    </div>
  `;
}

function warehouseImagePreviewMarkup(product, source) {
  return productMediaMarkup(
    product,
    "product-card-media warehouse-image-preview",
    source,
    `data-warehouse-image-preview="${escapeWarehouseHtml(product.id)}"`
  );
}

function renderWarehouseImagePreview(productId, source, product) {
  const preview = warehouseDetail?.querySelector(`[data-warehouse-image-preview="${productId}"]`);
  if (!preview) return;
  const image = String(source || "").trim();
  preview.classList.toggle("is-empty", !image);
  preview.innerHTML = image
    ? `<img src="${escapeWarehouseHtml(image)}" alt="" />`
    : `<span>${productFallbackText(product)}</span>`;
}

function warehouseImageErrorMessage(error) {
  const lang = ToxStore.getState().lang;
  if (["IMAGE_TOO_LARGE", "IMAGE_COMPRESSED_TOO_LARGE"].includes(error?.message)) {
    return lang === "ar"
      ? "الصورة كبيرة جداً. اختر صورة واضحة بحجم أقل من 10MB."
      : "The image is too large. Choose a clear image under 10MB.";
  }
  return lang === "ar" ? "تعذر قراءة صورة المنتج." : "Could not read product image.";
}

function productAlertCount(product) {
  let count = 0;
  const stock = Number(product.stockQuantity || 0);
  if (stock <= 0 || stock <= ToxStore.thresholdQuantity(product)) count += 1;
  if (product.expiresAt) {
    const days = Math.ceil((new Date(product.expiresAt).getTime() - Date.now()) / 86400000);
    if (Number.isFinite(days) && days <= 30) count += 1;
  }
  if (!productHasBarcode(product)) count += 1;
  if (!productHasImage(product)) count += 1;
  return count;
}

function setWarehouseView(view) {
  activeWarehouseView = view === "presets" ? "presets" : "manage";
  sessionStorage.setItem(warehouseViewKey, activeWarehouseView);
  if (warehouseTitle) warehouseTitle.textContent = activeWarehouseView === "presets" ? "الوحدات والبرندات والمنشأ" : "المستودعات";
  if (warehouseEyebrow) warehouseEyebrow.textContent = activeWarehouseView === "presets" ? "تنظيم اقتراحات المنتجات" : "تنظيم عدة مستودعات";
  if (warehouseSearchLabel) warehouseSearchLabel.textContent = activeWarehouseView === "presets" ? "بحث الوحدات والبرندات والمنشأ" : "بحث المستودعات";
  if (warehouseSearch) warehouseSearch.placeholder = activeWarehouseView === "presets" ? "ابحث عن وحدة أو برند أو منشأ" : "ابحث عن مستودع أو منتج أو بلد منشأ";
  warehouseViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.warehouseView === activeWarehouseView);
  });
  warehouseViewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.warehouseViewPanel !== activeWarehouseView;
  });
}

function applyWarehouseHash() {
  if (window.location.hash === "#catalog") {
    setWarehouseView("presets");
  } else if (window.location.hash === "#warehouses") {
    setWarehouseView("manage");
  }
}

function kindLabel(kind, lang = ToxStore.getState().lang) {
  const map = {
    weighted: lang === "ar" ? "موزون" : "Weighted",
    packaged: lang === "ar" ? "معبأ" : "Packaged",
    single: lang === "ar" ? "مفرد" : "Single",
    liquid: lang === "ar" ? "سائل" : "Liquid",
    length: lang === "ar" ? "طولي" : "Length"
  };
  return map[kind] || kind;
}

function barcodeOwnerLabel(owner = {}, lang = ToxStore.getState().lang) {
  const productName = owner.productName || owner.name || "-";
  const unitName = owner.unitName || "-";
  if (lang === "ar") {
    return owner.source === "unit"
      ? `وحدة ${unitName} في منتج ${productName}`
      : `منتج ${productName}`;
  }
  return owner.source === "unit"
    ? `unit ${unitName} in product ${productName}`
    : `product ${productName}`;
}

function duplicateBarcodeNotice(error = {}) {
  const lang = ToxStore.getState().lang;
  if (lang === "ar") return "هذا الباركود مستخدم لمنتج آخر، الرجاء إدخال رقم مختلف";
  const barcode = error.barcode || error.second?.barcode || error.first?.barcode || "-";
  const owners = [barcodeOwnerLabel(error.first, lang), barcodeOwnerLabel(error.second, lang)].filter(Boolean).join(lang === "ar" ? " و " : " and ");
  return `Barcode ${barcode} is already used by ${owners}.`;
}

function clearWarehouseBarcodeErrors(productId) {
  warehouseDetail?.querySelectorAll(`[data-warehouse-product-barcode="${productId}"], [data-warehouse-unit-barcode^="${productId}:"]`).forEach((input) => {
    input.closest("label")?.classList.remove("field-error-target");
    input.closest("label")?.querySelectorAll(".product-field-error").forEach((node) => node.remove());
  });
}

function markWarehouseBarcodeError(productId, error) {
  const normalized = error?.normalized || ToxStore.normalizeBarcode?.(error?.barcode || "");
  const message = duplicateBarcodeNotice(error);
  let marked = 0;
  warehouseDetail?.querySelectorAll(`[data-warehouse-product-barcode="${productId}"], [data-warehouse-unit-barcode^="${productId}:"]`).forEach((input) => {
    if (normalized && ToxStore.normalizeBarcode?.(input.value) !== normalized) return;
    const label = input.closest("label");
    if (!label) return;
    label.classList.add("field-error-target");
    const note = document.createElement("small");
    note.className = "product-field-error";
    note.textContent = message;
    label.appendChild(note);
    marked += 1;
  });
  showNotice(message, "error");
  return marked;
}

function warehouseProducts(state, warehouseId) {
  return state.products.filter((product) => product.warehouseId === warehouseId);
}

function warehouseProductSearchFields(product, state) {
  return [
    product.name,
    product.brand,
    productOrigin(product),
    product.baseUnit,
    ...(product.units || []).map((unit) => unit.name),
    ToxStore.productKindLabel?.(product, state.lang) || ""
  ];
}

function warehouseOptions(state, selectedId) {
  return state.warehouses
    .map((warehouse) => `<option value="${escapeWarehouseHtml(warehouse.id)}" ${warehouse.id === selectedId ? "selected" : ""}>${escapeWarehouseHtml(warehouse.name)}</option>`)
    .join("");
}

function isWarehouseBaseUnit(unit, index = 0) {
  return index === 0 || Math.abs(Number(unit?.multiplier || 1) - 1) < 0.0001;
}

function warehouseUnitBarcode(product, unit, index = 0) {
  if (isWarehouseBaseUnit(unit, index)) return String(unit?.barcode || product?.barcode || "").trim();
  return String(unit?.barcode || "").trim();
}

function warehouseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function warehouseNumbersEqual(left, right, tolerance = 0.0001) {
  return Math.abs(warehouseNumber(left) - warehouseNumber(right)) <= tolerance;
}

function warehouseClean(value) {
  return String(value ?? "").trim();
}

function warehouseSetPatchValue(patch, key, value, current) {
  if (warehouseClean(value) !== warehouseClean(current)) patch[key] = value;
}

function warehouseSyncBarcodeError(error) {
  const payload = error?.payload || {};
  const first = payload.syncReport?.errors?.[0] || payload;
  if ((first.code || first.reason || payload.reason) !== "DUPLICATE_BARCODE") return null;
  return first.details || payload.details || first;
}

function warehouseFormatMoney(value, currency = "IQD") {
  const amount = warehouseNumber(value);
  if (currency === "IQD") return `${Math.round(amount).toLocaleString("ar-IQ")} د.ع`;
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} USD`;
}

function warehousePercent(value) {
  return `${warehouseNumber(value).toLocaleString("ar-IQ", { maximumFractionDigits: 1 })}%`;
}

function warehouseProfitMetrics(product, unit, currency) {
  const purchaseCost = ToxStore.convertUsd?.(product?.purchaseCostUsd || 0, currency) || 0;
  const stockMultiplier = Math.max(0.0001, warehouseNumber(product?.stockUnitMultiplier, 1));
  const unitMultiplier = Math.max(0.0001, warehouseNumber(unit?.multiplier, 1));
  const cost = purchaseCost * (unitMultiplier / stockMultiplier);
  const price = ToxStore.convertUsd?.(unit?.priceUsd || 0, currency) || 0;
  const profit = price - cost;
  return {
    cost,
    price,
    profit,
    margin: price > 0 ? (profit / price) * 100 : 0,
    markup: cost > 0 ? (profit / cost) * 100 : 0,
    tone: profit > 0 ? "profit" : profit < 0 ? "loss" : "neutral"
  };
}

function warehouseUnitProfitMarkup(product, unit, currency) {
  const metrics = warehouseProfitMetrics(product, unit, currency);
  return `
    <small class="unit-profit-preview ${metrics.tone}" data-warehouse-unit-profit-preview="${escapeWarehouseHtml(product.id)}:${escapeWarehouseHtml(unit.id)}">
      <b>${warehouseFormatMoney(metrics.profit, currency)} ربح</b>
      <span>كلفة ${warehouseFormatMoney(metrics.cost, currency)} | هامش ${warehousePercent(metrics.margin)} | زيادة ${warehousePercent(metrics.markup)}</span>
    </small>
  `;
}

function unitInput(product, unit, currency, index, editing, state) {
  const decimals = currency === "IQD" ? 0 : 2;
  const disabled = editing ? "" : "disabled";
  const barcodeValue = warehouseUnitBarcode(product, unit, index);
  const lockBaseMultiplier = index === 0 ? "disabled" : disabled;
  const barcodeLabel = state.lang === "ar" ? "باركود الوحدة" : "Unit barcode";
  return `
    <label>
      <span>${index === 0 ? t("baseUnit", state.lang) : t("customUnit", state.lang)}</span>
      <input value="${unit.name}" data-warehouse-unit-name="${product.id}:${unit.id}" ${disabled} />
    </label>
    <label>
      <span>${t("unitPieces", state.lang)}</span>
      <input type="number" min="${index === 0 ? "1" : "0.01"}" step="0.01" value="${Number(unit.multiplier || 1)}" data-warehouse-unit-multiplier="${product.id}:${unit.id}" ${lockBaseMultiplier} />
    </label>
    <label>
      <span>${t("unitPrice", state.lang)}</span>
      <input
        type="number"
        min="0"
        step="${currency === "IQD" ? "1" : "0.01"}"
        value="${ToxStore.convertUsd(unit.priceUsd, currency).toFixed(decimals)}"
        data-warehouse-price="${product.id}:${unit.id}"
        data-price-currency="${currency}"
        ${disabled}
      />
      ${warehouseUnitProfitMarkup(product, unit, currency)}
    </label>
    <label>
      <span>${barcodeLabel}</span>
      <input value="${escapeWarehouseHtml(barcodeValue)}" data-warehouse-unit-barcode="${product.id}:${unit.id}" ${disabled} />
    </label>
  `;
}

function productInfoModal(product, state) {
  const barcodeLabel = t("barcode", state.lang);
  const origin = productOrigin(product);
  const units = (product.units || []).map((unit, index) => `
    <div class="product-info-unit">
      <span>${index === 0 ? t("baseUnit", state.lang) : t("customUnit", state.lang)}</span>
      <strong>${localizedUnitName(unit, state.lang)}</strong>
      <small>${Number(unit.multiplier || 1).toLocaleString()} ${ToxStore.productBaseUnit(product)} | ${barcodeLabel}: ${escapeWarehouseHtml(warehouseUnitBarcode(product, unit, index) || "-")}</small>
    </div>
  `).join("");

  const shell = document.createElement("div");
  shell.className = "global-modal-shell";
  shell.innerHTML = `
    <div class="global-modal-backdrop" data-info-close></div>
    <div class="global-modal-card info-modal-card product-details-modal warehouse-info-modal">
      <div class="product-info-hero">
        <div>
          <span class="eyebrow">${ToxStore.getWarehouseName(product.warehouseId)}</span>
          <h3>${escapeWarehouseHtml(product.name)}</h3>
          <p>${productMetaMarkup([
            product.brand ? escapeWarehouseHtml(product.brand) : "",
            origin ? originCountryMarkup(origin) : "",
            escapeWarehouseHtml(ToxStore.productKindLabel(product, state.lang))
          ]) || "-"}</p>
        </div>
        <div class="product-info-stock">
          <span>${t("stock", state.lang)}</span>
          <strong>${ToxStore.stockSummary(product)}</strong>
        </div>
      </div>
      <div class="product-info-grid">
        <div><span>${t("baseUnit", state.lang)}</span><strong>${ToxStore.productBaseUnit(product)}</strong></div>
        <div><span>${state.lang === "ar" ? "بلد المنشأ" : "Origin country"}</span><strong>${originCountryMarkup(origin, "-")}</strong></div>
        <div><span>${state.lang === "ar" ? "وحدة التخزين" : "Storage unit"}</span><strong>${product.stockUnitName || ToxStore.productBaseUnit(product)}</strong></div>
        <div><span>${state.lang === "ar" ? "معامل التخزين" : "Storage multiplier"}</span><strong>${Number(product.stockUnitMultiplier || 1).toLocaleString()}</strong></div>
        <div><span>${t("alertQty", state.lang)}</span><strong>${ToxStore.stockSummary({ ...product, stockQuantity: product.alertQuantity })}</strong></div>
        <div><span>${t("unit", state.lang)}</span><strong>${(product.units || []).length}</strong></div>
        <div><span>${t("expiryDate", state.lang)}</span><strong>${product.expiresAt ? new Date(product.expiresAt).toLocaleDateString() : "-"}</strong></div>
      </div>
      <div class="product-info-units">${units}</div>
      <div class="toolbar modal-actions">
        <button class="button primary" type="button" data-info-close>${state.lang === "ar" ? "إغلاق" : "Close"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(shell);
  shell.querySelectorAll("[data-info-close]").forEach((button) => {
    button.addEventListener("click", () => shell.remove());
  });
}

function productCard(product, state) {
  const isLow = Number(product.stockQuantity || 0) <= ToxStore.thresholdQuantity(product);
  const currency = ToxStore.productCurrency(product);
  const editing = editingProductId === product.id;
  const expiryStart = product.expiryStart ? String(product.expiryStart).slice(0, 10) : "";
  const expiresAt = product.expiresAt ? String(product.expiresAt).slice(0, 10) : "";
  const currentImage = productImageSource(product);
  const editingImage = warehouseImageDrafts.has(product.id) ? warehouseImageDrafts.get(product.id) : currentImage;
  const origin = productOrigin(product);
  const productMeta = [
    product.brand,
    origin,
    ToxStore.getWarehouseName(product.warehouseId),
    ToxStore.productKindLabel(product, state.lang),
    ToxStore.stockSummary(product)
  ].filter(Boolean).join(" | ");
  const productMetaHtml = productMetaMarkup([
    product.brand ? escapeWarehouseHtml(product.brand) : "",
    origin ? originCountryMarkup(origin) : "",
    escapeWarehouseHtml(ToxStore.getWarehouseName(product.warehouseId)),
    escapeWarehouseHtml(ToxStore.productKindLabel(product, state.lang)),
    escapeWarehouseHtml(ToxStore.stockSummary(product))
  ]);

  return `
    <article class="warehouse-product-card ${isLow ? "low-stock" : ""}">
      <div class="warehouse-product-head">
        <div class="warehouse-product-identity">
          ${productMediaMarkup(product, "product-card-media warehouse-product-media", currentImage)}
          <div>
            <strong>${escapeWarehouseHtml(product.name)}</strong>
            <small title="${escapeWarehouseHtml(productMeta)}">${productMetaHtml}</small>
          </div>
        </div>
        <div class="toolbar">
          <button class="button ghost" type="button" data-product-info="${product.id}">${state.lang === "ar" ? "معلومات المنتج" : "Product info"}</button>
          <button class="button ${editing ? "primary" : "ghost"}" type="button" data-product-edit="${product.id}">${editing ? (state.lang === "ar" ? "حفظ" : "Save") : (state.lang === "ar" ? "تعديل" : "Edit")}</button>
          <button class="button ghost" type="button" data-product-delete="${product.id}">${t("delete", state.lang)}</button>
        </div>
      </div>

      <div class="warehouse-product-summary">
        <div><span>${t("stock", state.lang)}</span><strong>${ToxStore.stockSummary(product)}</strong></div>
        <div><span>${state.lang === "ar" ? "وحدة التخزين" : "Storage unit"}</span><strong>${product.stockUnitName || ToxStore.productBaseUnit(product)}</strong></div>
        <div><span>${t("alertQty", state.lang)}</span><strong>${ToxStore.stockSummary({ ...product, stockQuantity: product.alertQuantity })}</strong></div>
      </div>

      ${editing ? `<div class="warehouse-product-body is-editing">
        <div class="warehouse-product-image-editor">
          ${warehouseImagePreviewMarkup(product, editingImage)}
          <div class="warehouse-image-actions">
            <span>${state.lang === "ar" ? "صورة المنتج" : "Product image"}</span>
            <input type="file" accept="image/*" data-warehouse-image-input="${product.id}" />
            <button class="button ghost" type="button" data-warehouse-image-clear="${product.id}">${state.lang === "ar" ? "إزالة الصورة" : "Remove image"}</button>
          </div>
        </div>
        <label>
          <span>${t("productName", state.lang)}</span>
          <input value="${escapeWarehouseHtml(product.name)}" data-warehouse-product-name="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${state.lang === "ar" ? "البرند / الماركة" : "Brand"}</span>
          <input value="${escapeWarehouseHtml(product.brand || "")}" data-warehouse-product-brand="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label class="warehouse-origin-field">
          <span>${state.lang === "ar" ? "بلد المنشأ" : "Origin country"}</span>
          <div class="warehouse-origin-control">
            <input value="${escapeWarehouseHtml(origin)}" list="warehouse-origin-suggestions-${escapeWarehouseHtml(product.id)}" data-warehouse-product-origin="${product.id}" ${editing ? "" : "disabled"} />
            <button class="warehouse-origin-picker-button" type="button" data-origin-picker-toggle="${product.id}" title="${state.lang === "ar" ? "اختيار منشأ" : "Choose origin"}" aria-label="${state.lang === "ar" ? "اختيار منشأ" : "Choose origin"}">+</button>
          </div>
          <datalist id="warehouse-origin-suggestions-${escapeWarehouseHtml(product.id)}">${warehouseOriginOptions()}</datalist>
          <div class="warehouse-origin-picker-menu" data-origin-picker-menu="${product.id}" hidden>
            ${warehouseOriginPickerItems(state)}
          </div>
        </label>
        <label>
          <span>${t("warehouse", state.lang)}</span>
          <select data-warehouse-product-warehouse="${product.id}" ${editing ? "" : "disabled"}>${warehouseOptions(state, product.warehouseId)}</select>
        </label>
        <label>
          <span>${t("barcode", state.lang)}</span>
          <input value="${product.barcode || ""}" data-warehouse-product-barcode="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${t("openingStock", state.lang)}</span>
          <input type="number" min="0" step="0.01" value="${Number(product.stockQuantity || 0).toFixed(2)}" data-warehouse-stock="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${t("currency", state.lang)}</span>
          <select data-warehouse-currency="${product.id}" ${editing ? "" : "disabled"}>
            <option value="IQD" ${currency === "IQD" ? "selected" : ""}>IQD</option>
            <option value="USD" ${currency === "USD" ? "selected" : ""}>USD</option>
          </select>
        </label>
        <label>
          <span>${state.lang === "ar" ? "آخر كلفة شراء" : "Last purchase cost"}</span>
          <input type="number" min="0" step="${currency === "IQD" ? "1" : "0.01"}" value="${ToxStore.convertUsd(product.purchaseCostUsd || 0, currency).toFixed(currency === "IQD" ? 0 : 4)}" data-warehouse-purchase-cost="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${state.lang === "ar" ? "وحدة التخزين" : "Storage unit"}</span>
          <input value="${escapeWarehouseHtml(product.stockUnitName || ToxStore.productBaseUnit(product))}" data-warehouse-stock-unit-name="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${state.lang === "ar" ? "عدد الأساس داخل التخزين" : "Storage multiplier"}</span>
          <input type="number" min="0.0001" step="any" value="${Number(product.stockUnitMultiplier || 1)}" data-warehouse-stock-unit-multiplier="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${t("alertQty", state.lang)}</span>
          <input type="number" min="0" step="0.01" value="${Number(ToxStore.thresholdQuantity(product) || 0).toFixed(2)}" data-warehouse-threshold="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${t("expiryStart", state.lang)}</span>
          <input type="date" value="${expiryStart}" data-warehouse-expiry-start="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        <label>
          <span>${t("expiryDate", state.lang)}</span>
          <input type="date" value="${expiresAt}" data-warehouse-expiry-end="${product.id}" ${editing ? "" : "disabled"} />
        </label>
        ${product.units.map((unit, index) => unitInput(product, unit, currency, index, editing, state)).join("")}
      </div>` : ""}
    </article>
  `;
}

async function saveProductFromWarehouse(productId) {
  if (savingWarehouseProductId) return;
  const product = ToxStore.getState().products.find((entry) => entry.id === productId);
  if (!product) return;
  clearWarehouseBarcodeErrors(productId);
  const currency = document.querySelector(`[data-warehouse-currency="${productId}"]`)?.value || product.currency || "IQD";
  const productPatch = {};
  warehouseSetPatchValue(productPatch, "name", document.querySelector(`[data-warehouse-product-name="${productId}"]`)?.value, product.name);
  warehouseSetPatchValue(productPatch, "brand", document.querySelector(`[data-warehouse-product-brand="${productId}"]`)?.value, product.brand || "");
  warehouseSetPatchValue(productPatch, "originCountry", document.querySelector(`[data-warehouse-product-origin="${productId}"]`)?.value, productOrigin(product));
  warehouseSetPatchValue(productPatch, "warehouseId", document.querySelector(`[data-warehouse-product-warehouse="${productId}"]`)?.value, product.warehouseId);
  warehouseSetPatchValue(productPatch, "barcode", document.querySelector(`[data-warehouse-product-barcode="${productId}"]`)?.value, product.barcode || "");
  if (warehouseImageDrafts.has(productId)) {
    const nextImage = warehouseImageDrafts.get(productId);
    if (nextImage !== productImageSource(product)) productPatch.image = nextImage;
  }
  const nextStock = warehouseNumber(document.querySelector(`[data-warehouse-stock="${productId}"]`)?.value, product.stockQuantity || 0);
  if (!warehouseNumbersEqual(nextStock, product.stockQuantity || 0)) productPatch.stockQuantity = nextStock;
  if (currency !== (product.currency || "IQD")) productPatch.currency = currency;
  const purchaseCostUsd = ToxStore.moneyToUsd(
    document.querySelector(`[data-warehouse-purchase-cost="${productId}"]`)?.value || 0,
    currency
  );
  if (!warehouseNumbersEqual(purchaseCostUsd, product.purchaseCostUsd || 0)) productPatch.purchaseCostUsd = purchaseCostUsd;
  warehouseSetPatchValue(productPatch, "stockUnitName", document.querySelector(`[data-warehouse-stock-unit-name="${productId}"]`)?.value, product.stockUnitName || ToxStore.productBaseUnit(product));
  const nextStockMultiplier = warehouseNumber(document.querySelector(`[data-warehouse-stock-unit-multiplier="${productId}"]`)?.value, product.stockUnitMultiplier || 1);
  if (!warehouseNumbersEqual(nextStockMultiplier, product.stockUnitMultiplier || 1)) productPatch.stockUnitMultiplier = nextStockMultiplier;
  const nextAlert = warehouseNumber(document.querySelector(`[data-warehouse-threshold="${productId}"]`)?.value, product.alertQuantity || 0);
  if (!warehouseNumbersEqual(nextAlert, product.alertQuantity || 0)) productPatch.alertQuantity = nextAlert;
  warehouseSetPatchValue(productPatch, "expiryStart", document.querySelector(`[data-warehouse-expiry-start="${productId}"]`)?.value, product.expiryStart ? String(product.expiryStart).slice(0, 10) : "");
  warehouseSetPatchValue(productPatch, "expiresAt", document.querySelector(`[data-warehouse-expiry-end="${productId}"]`)?.value, product.expiresAt ? String(product.expiresAt).slice(0, 10) : "");

  const unitPatches = product.units.map((unit, index) => {
    const key = `${productId}:${unit.id}`;
    const barcodeInput = document.querySelector(`[data-warehouse-unit-barcode="${key}"]`)?.value;
    const isBase = isWarehouseBaseUnit(unit, index);
    if (isBase && barcodeInput !== undefined) {
      const baseChanged = String(barcodeInput || "").trim() !== warehouseUnitBarcode(product, unit, index);
      const topChanged = String(productPatch.barcode || "").trim() !== String(product.barcode || "").trim();
      if (baseChanged || !topChanged) productPatch.barcode = barcodeInput;
    }
    const patch = { unitId: unit.id };
    warehouseSetPatchValue(patch, "name", document.querySelector(`[data-warehouse-unit-name="${key}"]`)?.value, unit.name);
    const nextMultiplier = warehouseNumber(document.querySelector(`[data-warehouse-unit-multiplier="${key}"]`)?.value, unit.multiplier || 1);
    if (!warehouseNumbersEqual(nextMultiplier, unit.multiplier || 1)) patch.multiplier = nextMultiplier;
    const priceInput = document.querySelector(`[data-warehouse-price="${key}"]`);
    const priceCurrency = currency || priceInput?.dataset.priceCurrency || product.currency || "IQD";
    const nextPriceUsd = ToxStore.moneyToUsd(priceInput?.value || 0, priceCurrency);
    if (!warehouseNumbersEqual(nextPriceUsd, unit.priceUsd || 0)) {
      patch.price = priceInput?.value;
      patch.currency = priceCurrency;
    }
    if (!isBase && barcodeInput !== undefined && warehouseClean(barcodeInput) !== warehouseClean(unit.barcode || "")) {
      patch.barcode = barcodeInput;
    }
    return Object.keys(patch).length > 1 ? patch : null;
  }).filter(Boolean);

  const barcodeChanged = String(productPatch.barcode || "").trim() !== String(product.barcode || "").trim()
    || unitPatches.some((patch) => {
      const index = product.units.findIndex((unit) => unit.id === patch.unitId);
      const unit = product.units[index];
      if (!unit) return false;
      const current = isWarehouseBaseUnit(unit, index) ? warehouseUnitBarcode(product, unit, index) : String(unit.barcode || "").trim();
      const next = isWarehouseBaseUnit(unit, index) ? String(productPatch.barcode || "").trim() : String(patch.barcode || "").trim();
      return next !== current;
    });
  if (barcodeChanged) {
    const validation = ToxStore.validateProductBarcodePatch?.(productId, productPatch, unitPatches);
    if (validation && !validation.ok) {
      markWarehouseBarcodeError(productId, validation.errors?.[0] || {});
      return;
    }
  }
  if (!validateWarehouseProductBeforeSave(product, productPatch, unitPatches)) return;
  const result = ToxStore.updateProductWithUnits
    ? ToxStore.updateProductWithUnits(productId, productPatch, unitPatches)
    : ToxStore.updateProduct(productId, productPatch);
  if (!result?.ok) {
    if (result?.reason === "DUPLICATE_BARCODE") markWarehouseBarcodeError(productId, result.errors?.[0] || {});
    return;
  }
  savingWarehouseProductId = productId;
  try {
    showNotice("جاري حفظ المنتج في قاعدة البيانات...", "info");
    await ToxStore.syncNow();
    warehouseImageDrafts.delete(productId);
    editingProductId = "";
    window.dispatchEvent(new CustomEvent("tox:product-updated", { detail: { productId } }));
    renderWarehouses(ToxStore.getState());
    showNotice(t("actionDone", ToxStore.getState().lang), "success");
  } catch (error) {
    const barcodeError = warehouseSyncBarcodeError(error);
    if (barcodeError) {
      markWarehouseBarcodeError(productId, barcodeError);
    } else {
      showNotice(error?.message || "لم يتم حفظ المنتج في قاعدة البيانات.", "error");
    }
  } finally {
    savingWarehouseProductId = "";
  }
}

function refreshWarehouseProfitPreview(productId) {
  const product = ToxStore.getState().products.find((entry) => entry.id === productId);
  if (!product) return;
  const currency = document.querySelector(`[data-warehouse-currency="${productId}"]`)?.value || product.currency || "IQD";
  const purchaseCostUsd = ToxStore.moneyToUsd(
    document.querySelector(`[data-warehouse-purchase-cost="${productId}"]`)?.value || ToxStore.convertUsd(product.purchaseCostUsd || 0, currency),
    currency
  );
  const stockUnitMultiplier = Math.max(0.0001, warehouseNumber(
    document.querySelector(`[data-warehouse-stock-unit-multiplier="${productId}"]`)?.value,
    product.stockUnitMultiplier || 1
  ));
  product.units.forEach((unit) => {
    const key = `${productId}:${unit.id}`;
    const priceInput = document.querySelector(`[data-warehouse-price="${key}"]`);
    const multiplierInput = document.querySelector(`[data-warehouse-unit-multiplier="${key}"]`);
    const preview = document.querySelector(`[data-warehouse-unit-profit-preview="${key}"]`);
    if (!preview) return;
    const unitMultiplier = Math.max(0.0001, warehouseNumber(multiplierInput?.value, unit.multiplier || 1));
    const price = warehouseNumber(priceInput?.value, ToxStore.convertUsd(unit.priceUsd || 0, currency));
    const purchaseCost = ToxStore.convertUsd(purchaseCostUsd || 0, currency);
    const cost = purchaseCost * (unitMultiplier / stockUnitMultiplier);
    const profit = price - cost;
    const margin = price > 0 ? (profit / price) * 100 : 0;
    const markup = cost > 0 ? (profit / cost) * 100 : 0;
    preview.classList.toggle("profit", profit > 0);
    preview.classList.toggle("loss", profit < 0);
    preview.classList.toggle("neutral", profit === 0);
    preview.innerHTML = `
      <b>${warehouseFormatMoney(profit, currency)} ربح</b>
      <span>كلفة ${warehouseFormatMoney(cost, currency)} | هامش ${warehousePercent(margin)} | زيادة ${warehousePercent(markup)}</span>
    `;
  });
}

function warehouseReadinessMessage(issue = {}) {
  const unit = issue.details?.unitName ? ` (${issue.details.unitName})` : "";
  const margin = Number(issue.details?.margin);
  const marginText = Number.isFinite(margin) ? ` (${warehousePercent(margin)})` : "";
  return ({
    INVALID_STORAGE_UNIT: "معامل وحدة التخزين غير صحيح.",
    MISSING_UNITS: "لا توجد وحدات بيع.",
    MISSING_BASE_UNIT: "لا توجد وحدة أساس ×1.",
    INVALID_UNIT_MULTIPLIER: `معامل الوحدة غير صحيح${unit}.`,
    MISSING_PURCHASE_COST: "آخر كلفة شراء مطلوبة.",
    MISSING_SELLING_PRICE: "لا توجد وحدة بيع بسعر صالح.",
    UNIT_SALE_LOSS: `سعر البيع أقل من الكلفة${unit}.`,
    LOW_UNIT_MARGIN: `هامش الربح منخفض${marginText}${unit}.`,
    IRAQI_ROUNDING: `السعر غير مقرب عراقياً${unit}.`,
    MISSING_STORAGE_SELL_UNIT: "وحدة التخزين غير موجودة كوحدة بيع.",
    LIQUID_BASE_UNIT: "وحدة أساس السوائل يجب أن تكون مل.",
    LENGTH_BASE_UNIT: "وحدة أساس الأطوال يجب أن تكون سم.",
    WEIGHT_BASE_UNIT: "وحدة أساس الوزن يفضل أن تكون غرام."
  })[issue.code] || issue.message || "مشكلة في جاهزية المنتج.";
}

function validateWarehouseProductBeforeSave(product, productPatch, unitPatches) {
  const candidate = {
    ...product,
    ...productPatch,
    units: product.units.map((unit) => {
      const patch = unitPatches.find((entry) => entry.unitId === unit.id) || {};
      const currency = patch.currency || productPatch.currency || product.currency || "IQD";
      return {
        ...unit,
        name: patch.name ?? unit.name,
        multiplier: patch.multiplier !== undefined ? Number(patch.multiplier || 0) : unit.multiplier,
        priceUsd: patch.price !== undefined ? ToxStore.moneyToUsd(patch.price || 0, currency) : unit.priceUsd,
        priceCurrency: currency
      };
    })
  };
  const validation = ToxStore.validateProductReadiness?.(candidate, { minMargin: 8 });
  if (!validation || validation.ok) {
    const warnings = (validation?.issues || []).filter((issue) => issue.severity === "warning").slice(0, 3);
    if (warnings.length) showNotice(`تنبيه تسعير: ${warnings.map(warehouseReadinessMessage).join(" | ")}`, "warning");
    return true;
  }
  const issues = (validation.blocking?.length ? validation.blocking : validation.issues || []).slice(0, 4);
  showNotice(`لا يمكن حفظ المنتج قبل معالجة: ${issues.map(warehouseReadinessMessage).join(" | ")}`, "error");
  playUiSound?.("error");
  return false;
}

async function handleWarehouseImageInput(event) {
  const input = event.currentTarget;
  const productId = input.dataset.warehouseImageInput;
  const product = ToxStore.getState().products.find((entry) => entry.id === productId);
  const file = input.files?.[0];
  if (!product || !file) return;

  try {
    const image = await window.ToxMedia.compressProductImage(file);
    warehouseImageDrafts.set(productId, image);
    renderWarehouseImagePreview(productId, image, product);
  } catch (error) {
    input.value = "";
    renderWarehouseImagePreview(
      productId,
      warehouseImageDrafts.has(productId) ? warehouseImageDrafts.get(productId) : productImageSource(product),
      product
    );
    showNotice(warehouseImageErrorMessage(error), "error");
  }
}

function clearWarehouseProductImage(event) {
  const productId = event.currentTarget.dataset.warehouseImageClear;
  const product = ToxStore.getState().products.find((entry) => entry.id === productId);
  if (!product) return;
  warehouseImageDrafts.set(productId, "");
  renderWarehouseImagePreview(productId, "", product);
  const input = warehouseDetail?.querySelector(`[data-warehouse-image-input="${productId}"]`);
  if (input) input.value = "";
}

function renderWarehouseList(state) {
  warehouseCount.textContent = `${state.warehouses.length}`;
  if (!state.warehouses.length) {
    selectedWarehouseId = "";
    warehouseList.innerHTML = `<span>${t("warehouses", state.lang)}: 0</span>`;
    return;
  }

  if (!selectedWarehouseId || !state.warehouses.some((warehouse) => warehouse.id === selectedWarehouseId)) {
    selectedWarehouseId = state.warehouses[0].id;
  }

  const globalQuery = activeWarehouseView === "manage" ? warehouseSearch.value.trim().toLowerCase() : "";
  const visibleWarehouses = state.warehouses.filter((warehouse) => {
    if (!globalQuery) return true;
    const products = warehouseProducts(state, warehouse.id);
    return `${warehouse.name} ${warehouse.code || ""} ${warehouse.zone || ""} ${warehouse.manager || ""} ${products.map((product) => `${product.name} ${product.brand || ""} ${productOrigin(product)}`).join(" ")}`
      .toLowerCase()
      .includes(globalQuery);
  });

  if (!visibleWarehouses.length) {
    warehouseList.innerHTML = `<div class="warehouse-empty">لا توجد مستودعات مطابقة</div>`;
    return;
  }

  warehouseList.innerHTML = visibleWarehouses
    .map((warehouse) => {
      const products = warehouseProducts(state, warehouse.id);
      const alertCount = products.reduce((sum, product) => sum + productAlertCount(product), 0);
      return `
        <button class="warehouse-list-item ${warehouse.id === selectedWarehouseId ? "active" : ""}" style="--warehouse-accent:${safeAccent(warehouse.color)}" type="button" data-warehouse-pick="${warehouse.id}">
          <span class="warehouse-color-dot" aria-hidden="true"></span>
          <strong>${escapeWarehouseHtml(warehouse.name)}</strong>
          <small>${escapeWarehouseHtml(warehouse.code || "-")} | ${escapeWarehouseHtml(warehouse.zone || "-")}</small>
          <span class="warehouse-list-metrics">
            <b>${products.length} ${t("product", state.lang)}</b>
            <b class="${alertCount ? "danger-text" : ""}">${alertCount} ${t("alert", state.lang)}</b>
          </span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-warehouse-pick]").forEach((button) => {
    button.addEventListener("click", (event) => {
      selectedWarehouseId = event.currentTarget.dataset.warehousePick;
      sessionStorage.setItem(warehouseSelectionKey, selectedWarehouseId);
      renderWarehouses(ToxStore.getState());
    });
  });
}

function renderWarehouseDetail(state) {
  const detailSearchFocus = captureWarehouseDetailSearchFocus();
  const warehouse = state.warehouses.find((entry) => entry.id === selectedWarehouseId);
  if (!warehouse) {
    warehouseDetail.innerHTML = `<div class="warehouse-empty">${t("warehouses", state.lang)}: 0</div>`;
    return;
  }

  const query = warehouseDetailQuery.trim().toLowerCase();
  const searchableProducts = state.products || [];
  const products = warehouseProducts(state, warehouse.id).filter((product) => {
    return ToxStore.productMatchesSmartSearch(product, query, (entry) => warehouseProductSearchFields(entry, state), searchableProducts);
  });
  const allProducts = warehouseProducts(state, warehouse.id);
  const totalStock = allProducts.reduce((sum, product) => sum + Number(product.stockQuantity || 0), 0);
  const lowCount = allProducts.filter((product) => Number(product.stockQuantity || 0) <= ToxStore.thresholdQuantity(product)).length;
  const alertCount = allProducts.reduce((sum, product) => sum + productAlertCount(product), 0);

  warehouseDetail.innerHTML = `
    <div class="warehouse-detail-hero" style="--warehouse-accent:${safeAccent(warehouse.color)}">
      <div>
        <span class="warehouse-detail-code">${escapeWarehouseHtml(warehouse.code || "-")} | ${escapeWarehouseHtml(warehouse.zone || "-")}</span>
        <h2>${escapeWarehouseHtml(warehouse.name)}</h2>
        <p>${escapeWarehouseHtml(warehouse.note || "مستودع جاهز لإدارة المنتجات والتنبيهات")}</p>
      </div>
      <div class="toolbar">
        <div class="warehouse-stats">
          <span>${allProducts.length} ${t("product", state.lang)}</span>
          <span>${Number(totalStock).toLocaleString()}</span>
          <span class="${alertCount ? "danger-text" : ""}">${alertCount} ${t("alert", state.lang)}</span>
        </div>
        <button class="button ghost" type="button" data-delete-warehouse="${warehouse.id}">${t("deleteWarehouse", state.lang)}</button>
      </div>
    </div>
    <div class="warehouse-meta-grid">
      <div class="catalog-stat"><span>${t("manager", state.lang)}</span><strong>${escapeWarehouseHtml(warehouse.manager || "-")}</strong></div>
      <div class="catalog-stat"><span>${t("zone", state.lang)}</span><strong>${escapeWarehouseHtml(warehouse.zone || "-")}</strong></div>
      <div class="catalog-stat"><span>تنبيهات</span><strong>${alertCount}</strong></div>
    </div>
    <label class="warehouse-inner-search smart-search-pill">
      <i class="smart-search-icon" aria-hidden="true"></i>
      <input value="${escapeWarehouseHtml(warehouseDetailQuery)}" data-warehouse-detail-search placeholder="ابحث داخل ${escapeWarehouseHtml(warehouse.name)} عن منتج أو بلد منشأ أو باركود" />
    </label>
    <div class="warehouse-detail-subhead">
      <strong>${products.length} من ${allProducts.length} منتج</strong>
      <span>${lowCount} منخفض المخزون</span>
    </div>
    <div class="warehouse-products-detail">
      ${products.length ? products.map((product) => `<div class="${product.id === highlightedProductId ? "search-hit" : ""}">${productCard(product, state)}</div>`).join("") : `<div class="warehouse-empty">${t("noProducts", state.lang)}</div>`}
    </div>
  `;

  document.querySelectorAll("[data-product-delete]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const productId = event.currentTarget.dataset.productDelete;
      const product = state.products.find((entry) => entry.id === productId);
      openDeleteModal({
        title: `${t("deleteItem", state.lang)} | ${product?.name || ""}`,
        text: t("deleteConfirmText", state.lang),
        onConfirm: () => {
          const result = ToxStore.deleteProduct(productId);
          showNotice(result?.ok ? t("actionDone", state.lang) : t("deleteBlocked", state.lang), result?.ok ? "success" : "error");
        }
      });
    });
  });

  document.querySelectorAll("[data-product-info]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const product = state.products.find((entry) => entry.id === event.currentTarget.dataset.productInfo);
      if (product) productInfoModal(product, state);
    });
  });

  document.querySelectorAll("[data-warehouse-image-input]").forEach((input) => {
    input.addEventListener("change", handleWarehouseImageInput);
  });

  document.querySelectorAll("[data-warehouse-image-clear]").forEach((button) => {
    button.addEventListener("click", clearWarehouseProductImage);
  });

  warehouseDetail.querySelectorAll("[data-origin-picker-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const productId = event.currentTarget.dataset.originPickerToggle;
      const menu = warehouseDetail.querySelector(`[data-origin-picker-menu="${productId}"]`);
      if (!menu) return;
      warehouseDetail.querySelectorAll("[data-origin-picker-menu]").forEach((entry) => {
        if (entry !== menu) entry.hidden = true;
      });
      menu.hidden = !menu.hidden;
    });
  });

  warehouseDetail.querySelectorAll("[data-origin-pick]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const menu = event.currentTarget.closest("[data-origin-picker-menu]");
      const productId = menu?.dataset.originPickerMenu;
      const input = productId ? warehouseDetail.querySelector(`[data-warehouse-product-origin="${productId}"]`) : null;
      if (input) input.value = event.currentTarget.dataset.originPick || "";
      if (menu) menu.hidden = true;
    });
  });

  document.querySelectorAll("[data-product-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const productId = event.currentTarget.dataset.productEdit;
      if (editingProductId === productId) {
        saveProductFromWarehouse(productId);
        return;
      }
      warehouseImageDrafts.clear();
      editingProductId = productId;
      renderWarehouses(ToxStore.getState());
    });
  });

  warehouseDetail.querySelectorAll("[data-warehouse-purchase-cost],[data-warehouse-stock-unit-multiplier],[data-warehouse-price],[data-warehouse-unit-multiplier],[data-warehouse-currency]").forEach((input) => {
    input.addEventListener("input", () => {
      const productId = input.dataset.warehousePurchaseCost
        || input.dataset.warehouseStockUnitMultiplier
        || input.dataset.warehouseCurrency
        || String(input.dataset.warehousePrice || input.dataset.warehouseUnitMultiplier || "").split(":")[0];
      if (productId) refreshWarehouseProfitPreview(productId);
    });
    input.addEventListener("change", () => {
      const productId = input.dataset.warehousePurchaseCost
        || input.dataset.warehouseStockUnitMultiplier
        || input.dataset.warehouseCurrency
        || String(input.dataset.warehousePrice || input.dataset.warehouseUnitMultiplier || "").split(":")[0];
      if (productId) refreshWarehouseProfitPreview(productId);
    });
  });

  document.querySelectorAll("[data-delete-warehouse]").forEach((button) => {
    button.addEventListener("click", () => {
      const warehouseId = button.dataset.deleteWarehouse;
      openDeleteModal({
        title: `${t("deleteWarehouse", state.lang)} | ${warehouse.name}`,
        text: t("deleteConfirmText", state.lang),
        onConfirm: () => {
          const result = ToxStore.deleteWarehouse(warehouseId);
          if (result?.ok) {
            selectedWarehouseId = result.fallbackWarehouseId || "";
            sessionStorage.setItem(warehouseSelectionKey, selectedWarehouseId);
          }
          showNotice(result?.ok ? t("actionDone", state.lang) : t("warehouseBusy", state.lang), result?.ok ? "success" : "error");
        }
      });
    });
  });

  warehouseDetail.querySelector("[data-warehouse-detail-search]")?.addEventListener("input", (event) => {
    warehouseDetailQuery = event.currentTarget.value;
    if (warehouseDetailSearchFrame) cancelAnimationFrame(warehouseDetailSearchFrame);
    warehouseDetailSearchFrame = requestAnimationFrame(() => {
      warehouseDetailSearchFrame = 0;
      renderWarehouseDetail(ToxStore.getState());
    });
  });
  restoreWarehouseDetailSearchFocus(detailSearchFocus);
}

function renderWarehouses(state) {
  renderWarehouseList(state);
  renderWarehouseDetail(state);
  renderPresets(state);
}

function renderUnitPresetCard(unit, state) {
  return `
    <div class="unit-preset-card inventory-chip-card" style="--inventory-accent:${safeAccent(unit.color, "#34d399")}">
      <span class="warehouse-color-dot" aria-hidden="true"></span>
      <span class="unit-preset-copy">
        <strong>${escapeWarehouseHtml(unit.name)}</strong>
        <small>${kindLabel(unit.kind, state.lang)} | ${Number(unit.multiplier || 1).toLocaleString()}</small>
      </span>
      <button class="button ghost" type="button" data-delete-unit-preset="${unit.id}">${t("delete", state.lang)}</button>
    </div>
  `;
}

function renderUnitPresetGroups(units, state, query) {
  if (!units.length) {
    return `<div class="warehouse-empty preset-empty-state">${state.lang === "ar" ? "لا توجد وحدات مطابقة" : "No matching units"}</div>`;
  }
  const unitKinds = Array.from(new Set(units.map((unit) => unit.kind || "packaged")));
  const orderedKinds = [...unitPresetKindOrder, ...unitKinds.filter((kind) => !unitPresetKindOrder.includes(kind))];
  return orderedKinds
    .filter((kind) => !query || units.some((unit) => (unit.kind || "packaged") === kind))
    .map((kind) => {
      const groupedUnits = units.filter((unit) => (unit.kind || "packaged") === kind);
      const accent = safeAccent(groupedUnits[0]?.color, unitPresetKindAccents[kind] || "#34d399");
      const unitLabel = state.lang === "ar" ? "وحدة" : "units";
      const emptyText = state.lang === "ar" ? "لا توجد وحدات داخل هذا النوع" : "No units in this type";
      return `
        <section class="unit-preset-group" style="--unit-kind-accent:${accent}">
          <div class="unit-preset-group-head">
            <span class="warehouse-color-dot" aria-hidden="true"></span>
            <span>
              <strong>${kindLabel(kind, state.lang)}</strong>
              <small>${groupedUnits.length.toLocaleString()} ${unitLabel}</small>
            </span>
          </div>
          <div class="unit-preset-grid">
            ${groupedUnits.length ? groupedUnits.map((unit) => renderUnitPresetCard(unit, state)).join("") : `<div class="warehouse-empty">${emptyText}</div>`}
          </div>
        </section>
      `;
    }).join("");
}

function renderPresets(state) {
  if (!unitPresetList || !brandList || !originCountryList) return;
  const query = activeWarehouseView === "presets" ? warehouseSearch.value.trim().toLowerCase() : "";
  const units = state.unitPresets.filter((unit) => !query || `${unit.name} ${kindLabel(unit.kind, state.lang)} ${unit.multiplier}`.toLowerCase().includes(query));
  const brands = state.brands.filter((brand) => !query || `${brand.name}`.toLowerCase().includes(query));
  const origins = (state.originCountries || []).filter((origin) => !query || `${origin.name}`.toLowerCase().includes(query));
  unitPresetCount.textContent = units.length;
  brandCount.textContent = brands.length;
  originCountryCount.textContent = origins.length;
  unitPresetList.innerHTML = renderUnitPresetGroups(units, state, query);
  brandList.innerHTML = brands.map((brand) => `
    <div class="preset-item inventory-chip-card preset-compact-card" style="--inventory-accent:${safeAccent(brand.color, "#a78bfa")}">
      <span class="warehouse-color-dot" aria-hidden="true"></span>
      <span><strong>${escapeWarehouseHtml(brand.name)}</strong><small>Brand</small></span>
      <button class="button ghost" type="button" data-delete-brand="${brand.id}">${t("delete", state.lang)}</button>
    </div>
  `).join("") || `<div class="warehouse-empty">لا توجد برندات مقترحة</div>`;
  originCountryList.innerHTML = origins.map((origin) => `
    <div class="preset-item inventory-chip-card preset-compact-card" style="--inventory-accent:${safeAccent(origin.color, "#22c55e")}">
      <span class="warehouse-color-dot" aria-hidden="true"></span>
      <span><strong>${escapeWarehouseHtml(origin.name)}</strong><small>${state.lang === "ar" ? "منشأ" : "Origin"}</small></span>
      <button class="button ghost" type="button" data-delete-origin-country="${origin.id}">${t("delete", state.lang)}</button>
    </div>
  `).join("") || `<div class="warehouse-empty">لا توجد منشأات مقترحة</div>`;

  document.querySelectorAll("[data-delete-unit-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      ToxStore.deleteUnitPreset(button.dataset.deleteUnitPreset);
      showNotice(t("actionDone", state.lang), "success");
    });
  });
  document.querySelectorAll("[data-delete-brand]").forEach((button) => {
    button.addEventListener("click", () => {
      ToxStore.deleteBrand(button.dataset.deleteBrand);
      showNotice(t("actionDone", state.lang), "success");
    });
  });
  document.querySelectorAll("[data-delete-origin-country]").forEach((button) => {
    button.addEventListener("click", () => {
      ToxStore.deleteOriginCountry(button.dataset.deleteOriginCountry);
      showNotice(t("actionDone", state.lang), "success");
    });
  });
}

warehouseAddToggle?.addEventListener("click", () => {
  if (!warehouseForm) return;
  warehouseForm.hidden = !warehouseForm.hidden;
  warehouseAddToggle.textContent = warehouseForm.hidden ? "إضافة مستودع" : "إغلاق الإضافة";
});

document.querySelector("[data-warehouse-form]").addEventListener("submit", (event) => {
  event.preventDefault();
  const warehouseId = ToxStore.addWarehouse({
    name: document.querySelector("[data-warehouse-name]").value,
    code: document.querySelector("[data-warehouse-code]").value,
    zone: document.querySelector("[data-warehouse-zone]").value,
    manager: document.querySelector("[data-warehouse-manager]").value,
    color: document.querySelector("[data-warehouse-color]")?.value,
    note: document.querySelector("[data-warehouse-note]").value
  });
  if (!warehouseId) {
    showNotice("لم يتم حفظ المخزن. شغل السيرفر وافتح النظام من 127.0.0.1:8765.", "error");
    return;
  }
  showNotice(t("actionDone", ToxStore.getState().lang), "success");
  event.currentTarget.reset();
  const colorInput = document.querySelector("[data-warehouse-color]");
  if (colorInput) colorInput.value = "#d6b35a";
  event.currentTarget.hidden = true;
  if (warehouseAddToggle) warehouseAddToggle.textContent = "إضافة مستودع";
});

unitPresetForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const kindSelect = document.querySelector("[data-unit-preset-kind]");
  const selectedKind = kindSelect?.value || "packaged";
  const result = ToxStore.addUnitPreset({
    kind: selectedKind,
    name: document.querySelector("[data-unit-preset-name]")?.value,
    multiplier: document.querySelector("[data-unit-preset-multiplier]")?.value,
    color: document.querySelector("[data-unit-preset-color]")?.value
  });
  showNotice(result?.ok ? t("actionDone", ToxStore.getState().lang) : "الوحدة موجودة أو غير صحيحة", result?.ok ? "success" : "error");
  if (result?.ok) {
    event.currentTarget.reset();
    if (kindSelect) {
      kindSelect.value = selectedKind;
      window.ToxSelects?.update?.(kindSelect);
    }
  }
});

brandForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = ToxStore.addBrand({
    name: document.querySelector("[data-brand-name]")?.value,
    color: document.querySelector("[data-brand-color]")?.value
  });
  showNotice(result?.ok ? t("actionDone", ToxStore.getState().lang) : "البرند موجود أو غير صحيح", result?.ok ? "success" : "error");
  if (result?.ok) event.currentTarget.reset();
});

originCountryForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = ToxStore.addOriginCountry({
    name: document.querySelector("[data-origin-country-name]")?.value,
    color: document.querySelector("[data-origin-country-color]")?.value
  });
  showNotice(result?.ok ? t("actionDone", ToxStore.getState().lang) : "المنشأ موجود أو غير صحيح", result?.ok ? "success" : "error");
  if (result?.ok) {
    event.currentTarget.reset();
    const colorInput = document.querySelector("[data-origin-country-color]");
    if (colorInput) colorInput.value = "#22c55e";
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-origin-picker-toggle],[data-origin-picker-menu]")) return;
  warehouseDetail?.querySelectorAll("[data-origin-picker-menu]").forEach((menu) => {
    menu.hidden = true;
  });
});

warehouseViewButtons.forEach((button) => {
  button.addEventListener("click", () => setWarehouseView(button.dataset.warehouseView));
});

warehouseSearch.addEventListener("input", () => {
  const state = ToxStore.getState();
  if (activeWarehouseView === "presets") {
    renderPresets(state);
    return;
  }
  const query = warehouseSearch.value.trim().toLowerCase();
  highlightedProductId = "";
  if (query) {
    const match = state.products.find((product) => (
      ToxStore.productMatchesSmartSearch(product, query, (entry) => [
        ...warehouseProductSearchFields(entry, state),
        ToxStore.getWarehouseName(entry.warehouseId)
      ], state.products)
    ));
    if (match) {
      selectedWarehouseId = match.warehouseId;
      highlightedProductId = match.id;
      sessionStorage.setItem(warehouseSelectionKey, selectedWarehouseId);
      showNotice(`${t("searchJump", state.lang)}: ${match.name}`, "success");
    }
  }
  renderWarehouses(state);
});

ToxStore.subscribe(renderWarehouses);
applyWarehouseHash();
setWarehouseView(activeWarehouseView);
window.addEventListener("hashchange", applyWarehouseHash);
