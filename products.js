const productForm = document.querySelector("[data-product-form]");
const warehouseSelect = document.querySelector("[data-product-warehouse]");
const warehouseFilter = document.querySelector("[data-product-filter-warehouse]");
const productsCatalog = document.querySelector("[data-products-table]");
const totalProductsCount = document.querySelector("[data-products-count]");
const filteredProductsCount = document.querySelector("[data-filtered-products-count]");
const productsSearch = document.querySelector("[data-products-search]");
const productsSearchClear = document.querySelector("[data-products-search-clear]");
const kindSelect = document.querySelector("[data-product-kind]");
const kindPreview = document.querySelector("[data-product-kind-preview]");
const preProductUnits = document.querySelector("[data-pre-product-units]");
const addPreProductUnitButton = document.querySelector("[data-add-pre-product-unit]");
const openingStockUnitSelect = document.querySelector("[data-opening-stock-unit]");
const stockUnitNameInput = document.querySelector("[data-stock-unit-name]");
const stockUnitMultiplierInput = document.querySelector("[data-stock-unit-multiplier]");
const stockSalePriceInput = document.querySelector("[data-stock-sale-price]");
const basePriceInput = document.querySelector("[data-base-price]");
const purchaseCostInput = document.querySelector("[data-purchase-cost]");
const productCurrencySelect = document.querySelector("[data-product-currency]");
const productPricingSummary = document.querySelector("[data-product-pricing-summary]");
const productsViewButtons = document.querySelectorAll("[data-products-view]");
const productsViewPanels = document.querySelectorAll("[data-products-view-panel]");
const brandSuggestions = document.querySelector("[data-brand-suggestions]");
const brandChipSuggestions = document.querySelector("[data-brand-chip-suggestions]");
const brandPickerButton = document.querySelector("[data-open-brand-picker]");
const originSuggestions = document.querySelector("[data-origin-suggestions]");
const unitPresetSuggestions = document.querySelector("[data-unit-preset-suggestions]");
const productImageInput = document.querySelector("[data-product-image]");
const productImagePreview = document.querySelector("[data-product-image-preview]");
const productBarcodeInput = document.querySelector("[data-product-barcode]");

const warehouseSelectionKey = "tox-selected-warehouse";
const purchasePrefillProductKey = "tox-prefill-purchase-product";
let preProductUnitRows = [];
let activeProductsView = sessionStorage.getItem("tox-products-view") || "create";
let openUnitPresetMenuId = "";
let brandPickerOpen = false;
let productDraftRestoring = false;
let productDraftReady = false;
let productCatalogRenderTimer = 0;
let pendingProductImages = [];
let basePriceManual = false;
let stockUnitBarcodeDraft = "";

if (productForm) {
  productForm.dataset.draftKey = "products-create";
  productForm.dataset.draftManual = "true";
  productForm.dataset.noDraft = "true";
  try {
    sessionStorage.removeItem("tox-form-draft-v1:products-create");
  } catch (error) {
    console.warn("Could not clear product draft", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function productNotice(message, tone = "info") {
  if (typeof showNotice === "function") showNotice(message, tone);
}

function productMessage(key, fallbackAr, fallbackEn) {
  const lang = ToxStore.getState().lang;
  return typeof t === "function" ? t(key, lang) : (lang === "ar" ? fallbackAr : fallbackEn);
}

function productImages(product = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  if (images.length) return images;
  const fallback = product.image || product.imageUrl || "";
  return fallback ? [{ id: "legacy-image", imageUrl: fallback, largeUrl: fallback, catalogUrl: fallback, thumbUrl: fallback, isPrimary: true }] : [];
}

function productImageFor(product = {}, variant = "catalog") {
  const image = productImages(product)[0] || {};
  if (variant === "thumb") return image.thumbUrl || image.catalogUrl || image.imageUrl || image.url || product.image || product.imageUrl || "";
  if (variant === "large") return image.largeUrl || image.imageUrl || image.url || product.image || product.imageUrl || "";
  return image.catalogUrl || image.imageUrl || image.url || product.image || product.imageUrl || "";
}

function renderProductImagePreview(images = pendingProductImages) {
  if (!productImagePreview) return;
  productImagePreview.innerHTML = images.length
    ? `<div class="product-image-preview-grid">
        ${images.map((image, index) => `
          <button class="product-image-preview-tile ${index === 0 ? "is-primary" : ""}" type="button" data-pending-image-remove="${escapeHtml(image.id)}" title="${index === 0 ? "الصورة الرئيسية" : "حذف الصورة"}">
            <img src="${escapeHtml(image.preview || image.imageUrl || "")}" alt="" />
            <span>${index + 1}</span>
          </button>
        `).join("")}
      </div>`
    : `<span>${ToxStore.getState().lang === "ar" ? "بدون صورة" : "No image"}</span>`;
}

function productApiFetch(path, options = {}) {
  if (window.ToxApi?.fetch) return window.ToxApi.fetch(path, options);
  const base = window.ToxApi?.baseUrl?.() || `${window.location.origin.includes(":5500") ? "http://127.0.0.1:8765" : ""}/api`;
  return fetch(`${base}${path}`, { credentials: "include", ...options });
}

async function uploadProductImage(productId, image, isPrimary = false) {
  const form = new FormData();
  form.append("isPrimary", isPrimary ? "true" : "false");
  form.append("image", image.files.original);
  form.append("large", image.files.large);
  form.append("catalog", image.files.catalog);
  form.append("thumb", image.files.thumb);
  const response = await productApiFetch(`/products/${encodeURIComponent(productId)}/images/`, {
    method: "POST",
    body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.reason || "IMAGE_UPLOAD_FAILED");
    error.payload = result;
    throw error;
  }
  return result;
}

async function uploadPendingProductImages(product) {
  if (!product?.id || !pendingProductImages.length) return null;
  if (typeof ToxStore.syncNow === "function") await ToxStore.syncNow();
  let latest = null;
  for (let index = 0; index < pendingProductImages.length; index += 1) {
    latest = await uploadProductImage(product.id, pendingProductImages[index], index === 0);
  }
  if (latest?.product) {
    ToxStore.updateProduct?.(product.id, {
      image: latest.product.image || "",
      imageUrl: latest.product.imageUrl || "",
      images: latest.product.images || latest.images || []
    });
  }
  return latest;
}

function applyProductImagePayload(productId, payload = {}) {
  const product = payload.product || {};
  ToxStore.updateProduct?.(productId, {
    image: product.image || "",
    imageUrl: product.imageUrl || "",
    images: product.images || payload.images || []
  });
}

async function patchProductImages(productId, payload) {
  const response = await productApiFetch(`/products/${encodeURIComponent(productId)}/images/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.reason || "IMAGE_UPDATE_FAILED");
  applyProductImagePayload(productId, result);
  return result;
}

async function deleteProductImage(productId, imageId) {
  const response = await productApiFetch(`/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/`, {
    method: "DELETE"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.reason || "IMAGE_DELETE_FAILED");
  applyProductImagePayload(productId, result);
  return result;
}

function renderProductImageManager(productId) {
  const state = ToxStore.getState();
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) return;
  const images = productImages(product);
  let modal = document.querySelector("[data-product-image-manager]");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "product-image-manager-backdrop";
    modal.dataset.productImageManager = "true";
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <section class="product-image-manager" role="dialog" aria-modal="true">
      <div class="product-image-manager-head">
        <strong>${escapeHtml(product.name || "منتج")}</strong>
        <button class="icon-button" type="button" data-product-image-close>×</button>
      </div>
      <div class="product-image-manager-grid">
        ${images.length ? images.map((image, index) => `
          <article class="product-image-manager-tile ${image.isPrimary ? "is-primary" : ""}">
            <img src="${escapeHtml(image.catalogUrl || image.imageUrl || image.url || "")}" alt="" />
            <div class="product-image-manager-actions">
              <button class="button ghost" type="button" data-image-move="${escapeHtml(image.id)}" data-image-move-dir="-1" ${index <= 0 || image.isLegacy ? "disabled" : ""}>‹</button>
              <button class="button ghost" type="button" data-image-primary="${escapeHtml(image.id)}" ${image.isPrimary || image.isLegacy ? "disabled" : ""}>رئيسية</button>
              <button class="button ghost" type="button" data-image-delete="${escapeHtml(image.id)}" ${image.isLegacy ? "disabled" : ""}>حذف</button>
              <button class="button ghost" type="button" data-image-move="${escapeHtml(image.id)}" data-image-move-dir="1" ${index >= images.length - 1 || image.isLegacy ? "disabled" : ""}>›</button>
            </div>
          </article>
        `).join("") : `<div class="warehouse-empty">لا توجد صور</div>`}
      </div>
      <label class="product-image-manager-upload">
        <input type="file" accept="image/*" multiple data-manager-image-upload />
        <span>إضافة صور</span>
      </label>
    </section>
  `;
  modal.dataset.productId = productId;
}

function ownerText(owner = {}) {
  const lang = ToxStore.getState().lang;
  const productName = owner.productName || owner.name || "";
  const unitName = owner.unitName || "";
  if (lang === "ar") {
    if (owner.source === "product") return `منتج ${productName || "-"}`;
    return `وحدة ${unitName || "-"} في منتج ${productName || "-"}`;
  }
  if (owner.source === "product") {
    return lang === "ar"
      ? `منتج ${productName || "-"}`
      : `product ${productName || "-"}`;
  }
  return lang === "ar"
    ? `وحدة ${unitName || "-"} في منتج ${productName || "-"}`
    : `unit ${unitName || "-"} in product ${productName || "-"}`;
}

function duplicateBarcodeMessage(error) {
  const lang = ToxStore.getState().lang;
  const barcode = error?.barcode || error?.second?.barcode || error?.first?.barcode || "";
  if (lang === "ar") {
    const arOwners = [ownerText(error?.first), ownerText(error?.second)].filter(Boolean).join(" و ");
    return `الباركود ${barcode || "-"} مستخدم في ${arOwners || "منتج أو وحدة أخرى"}. لا يمكن تكرار الباركود بين المنتج ووحدات البيع. غيّر الباركود أو عدله من المنتج الموجود.`;
  }
  const owners = [ownerText(error?.first), ownerText(error?.second)].filter(Boolean).join(lang === "ar" ? " و " : " and ");
  return lang === "ar"
    ? `الباركود ${barcode || "-"} مستخدم في ${owners}. غيّر الباركود حتى ينحفظ المنتج.`
    : `Barcode ${barcode || "-"} is already used by ${owners}. Change it before saving.`;
}

function clearProductErrors() {
  productForm?.querySelectorAll(".product-form-alert,.product-field-error").forEach((node) => node.remove());
  productForm?.querySelectorAll(".field-error-target").forEach((field) => field.classList.remove("field-error-target"));
}

function addFieldError(input, message) {
  const field = input?.closest(".field") || input?.parentElement;
  if (!field) return;
  field.classList.add("field-error-target");
  const note = document.createElement("small");
  note.className = "product-field-error";
  note.textContent = message;
  field.appendChild(note);
}

function ownerInputSelector(owner = {}) {
  if (owner.source === "product") return "[data-product-barcode], [data-unit-base-barcode]";
  if (owner.source === "unit") return "[data-pre-unit-barcode], [data-unit-storage-barcode]";
  return "[data-product-barcode], [data-unit-base-barcode], [data-pre-unit-barcode], [data-unit-storage-barcode]";
}

function showProductErrors(result) {
  clearProductErrors();
  const errors = result?.errors || [];
  const message = result?.reason === "PURCHASE_COST_REQUIRED"
    ? productMessage("purchaseCostRequired", "سعر الشراء مطلوب حتى يحسب النظام الربح الحقيقي.", "Purchase cost is required for accurate profit.")
    : errors.length
    ? duplicateBarcodeMessage(errors[0])
    : productMessage("productCreateError", "تعذر إنشاء المنتج. راجع البيانات وحاول مرة ثانية.", "Could not create the product. Check the data and try again.");
  const alert = document.createElement("div");
  alert.className = "product-form-alert";
  alert.textContent = message;
  productForm.prepend(alert);
  const normalized = errors[0]?.normalized || ToxStore.normalizeBarcode?.(errors[0]?.barcode || "");
  const owners = [errors[0]?.second, errors[0]?.first].filter(Boolean);
  let highlighted = 0;
  owners.forEach((owner) => {
    productForm.querySelectorAll(ownerInputSelector(owner)).forEach((input) => {
      if (!normalized || ToxStore.normalizeBarcode?.(input.value) === normalized) {
        addFieldError(input, message);
        highlighted += 1;
      }
    });
  });
  if (!highlighted) {
    productForm.querySelectorAll("[data-product-barcode], [data-unit-base-barcode], [data-pre-unit-barcode], [data-unit-storage-barcode]").forEach((input) => {
      if (!normalized || ToxStore.normalizeBarcode?.(input.value) === normalized) addFieldError(input, message);
    });
    if (result?.reason === "PURCHASE_COST_REQUIRED") {
      const purchaseInput = productForm.querySelector("[data-purchase-cost]");
      if (purchaseInput) addFieldError(purchaseInput, message);
    }
  }
  productNotice(message, "error");
  playUiSound("error");
}

function readinessIssueMessage(issue = {}) {
  const detail = issue.details || {};
  const unit = detail.unitName ? ` (${detail.unitName})` : "";
  const marginText = Number.isFinite(Number(detail.margin)) ? ` (${formatProductPercent(detail.margin)})` : "";
  const messages = {
    NO_PRODUCT: "لا يوجد منتج للفحص.",
    INVALID_STORAGE_UNIT: "معامل وحدة التخزين غير صحيح.",
    MISSING_UNITS: "لا توجد وحدات بيع مرتبطة بالمنتج.",
    MISSING_BASE_UNIT: "يجب وجود وحدة أساس ×1.",
    INVALID_UNIT_MULTIPLIER: `معامل الوحدة غير صحيح${unit}.`,
    MISSING_PURCHASE_COST: "سعر الشراء مطلوب لحساب الربح.",
    MISSING_SELLING_PRICE: "لا توجد وحدة بيع بسعر صالح.",
    UNIT_SALE_LOSS: `سعر البيع أقل من الكلفة${unit}.`,
    LOW_UNIT_MARGIN: `هامش الربح منخفض${marginText}${unit}.`,
    IRAQI_ROUNDING: `السعر غير مقرب عراقياً${unit}.`,
    MISSING_STORAGE_SELL_UNIT: "وحدة التخزين غير موجودة كوحدة بيع.",
    LIQUID_BASE_UNIT: "وحدة أساس السوائل يجب أن تكون مل.",
    LENGTH_BASE_UNIT: "وحدة أساس الأطوال يجب أن تكون سم.",
    WEIGHT_BASE_UNIT: "وحدة أساس الوزن يفضل أن تكون غرام."
  };
  return messages[issue.code] || issue.message || "مشكلة في جاهزية المنتج.";
}

function showProductReadinessErrors(validation) {
  clearProductErrors();
  const issues = (validation?.blocking?.length ? validation.blocking : validation?.issues || []).slice(0, 4);
  const message = `لا يمكن حفظ المنتج قبل معالجة: ${issues.map(readinessIssueMessage).join(" | ")}`;
  const alert = document.createElement("div");
  alert.className = "product-form-alert";
  alert.textContent = message;
  productForm.prepend(alert);
  productNotice(message, "error");
  playUiSound("error");
}

function showProductReadinessWarnings(validation) {
  const warnings = (validation?.issues || []).filter((issue) => issue.severity === "warning").slice(0, 3);
  if (!warnings.length) return;
  productNotice(`تنبيه تسعير: ${warnings.map(readinessIssueMessage).join(" | ")}`, "warning");
}

function scheduleProductDraftSave() {
  if (productDraftRestoring) return;
  window.ToxFormDrafts?.save?.(productForm);
}

function scheduleCatalogRender() {
  clearTimeout(productCatalogRenderTimer);
  productCatalogRenderTimer = setTimeout(() => renderCatalog(ToxStore.getState()), 120);
}

function setProductsView(view) {
  activeProductsView = view === "list" ? "list" : "create";
  sessionStorage.setItem("tox-products-view", activeProductsView);
  productsViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.productsView === activeProductsView);
  });
  productsViewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.productsViewPanel !== activeProductsView;
  });
}

function applyProductsHash() {
  if (window.location.hash === "#list") {
    setProductsView("list");
  } else if (window.location.hash === "#create") {
    setProductsView("create");
  }
}

const productPresets = {
  weighted: {
    baseUnit: "غرام",
    stockUnit: "كيس",
    stockMultiplier: 50000,
    stock: 50,
    alert: 5,
    unit1: { name: "كيلو", multiplier: 1000 },
    unit2: { name: "كيس 25 كيلو", multiplier: 25000 },
    guide: "مخصص للسكر والرز والبقوليات. التسعير يبدأ من الوزن ثم الجملة."
  },
  liquid: {
    stockUnit: "جالون",
    stockMultiplier: 20000,
    baseUnit: "مل",
    stock: 10,
    alert: 2,
    unit1: { name: "250 مل", multiplier: 250 },
    unit2: { name: "لتر", multiplier: 1000 },
    guide: "مخصص للمنظفات والعصائر والزيوت."
  },
  length: {
    stockUnit: "رول",
    stockMultiplier: 10000,
    baseUnit: "سم",
    stock: 5,
    alert: 1,
    unit1: { name: "نصف متر", multiplier: 50 },
    unit2: { name: "متر", multiplier: 100 },
    guide: "مخصص للأسلاك والأقمشة وكل ما يباع بالطول."
  },
  packaged: {
    baseUnit: "قطعة",
    stockUnit: "كارتون",
    stockMultiplier: 24,
    stock: 50,
    alert: 5,
    unit1: { name: "باك 12 قطعة", multiplier: 12 },
    unit2: { name: "", multiplier: "" },
    guide: "مخصص للبضائع المعبأة. الوحدة الأساسية قطعة ثم باك ثم كارتون."
  },
  single: {
    stockUnit: "قطعة",
    stockMultiplier: 1,
    baseUnit: "قطعة",
    stock: 25,
    alert: 5,
    unit1: { name: "", multiplier: "" },
    unit2: { name: "", multiplier: "" },
    guide: "مخصص للمنتج الذي يباع مفرد فقط مثل جهاز أو أداة."
  }
};

function setField(selector, value) {
  const field = document.querySelector(selector);
  if (field) field.value = value ?? "";
}

function productNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function iraqiRoundStep(amount) {
  const value = Math.abs(productNumber(amount));
  if (value >= 25000) return 1000;
  if (value >= 5000) return 500;
  return 250;
}

function roundIraqiPrice(amount, currency = productCurrencySelect?.value || "IQD") {
  const value = productNumber(amount);
  if (currency !== "IQD" || value <= 0) return value;
  const step = iraqiRoundStep(value);
  return Math.max(step, Math.round(value / step) * step);
}

function formatProductPercent(value) {
  const number = productNumber(value);
  return `${number.toLocaleString("ar-IQ", { maximumFractionDigits: 1 })}%`;
}

function profitMetrics(price, cost) {
  const sellPrice = productNumber(price);
  const unitCost = productNumber(cost);
  const profit = sellPrice - unitCost;
  return {
    price: sellPrice,
    cost: unitCost,
    profit,
    margin: sellPrice > 0 ? (profit / sellPrice) * 100 : 0,
    markup: unitCost > 0 ? (profit / unitCost) * 100 : 0,
    tone: productProfitTone(profit)
  };
}

function productMoneyInputValue(value) {
  return productNumber(value).toFixed(4).replace(/\.?0+$/, "");
}

function formatProductInputMoney(value, currency = productCurrencySelect?.value || "IQD") {
  const amount = productNumber(value);
  if (currency === "IQD") {
    return `${amount.toLocaleString("ar-IQ", { maximumFractionDigits: 3 })} د.ع`;
  }
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} USD`;
}

function productUnitLabel() {
  return document.querySelector("[data-base-unit]")?.value || (ToxStore.getState().lang === "ar" ? "قطعة" : "Piece");
}

function stockUnitLabel() {
  return stockUnitNameInput?.value || productUnitLabel();
}

function stockUnitMultiplierValue() {
  return Math.max(0.0001, productNumber(stockUnitMultiplierInput?.value, 1));
}

function isSingleProductKind() {
  return kindSelect.value === "single";
}

function isPackagedProductKind() {
  return kindSelect.value === "packaged";
}

function readonlyPrice(product, unitId) {
  const unit = ToxStore.getProductUnit(product, unitId);
  return `<span class="price-stack"><strong>${ToxStore.formatProductMoney(product, unit?.priceUsd || 0)}</strong><small>${product.currency || "IQD"}</small></span>`;
}

function isInternalMeasureKind(kind) {
  return ["weighted", "liquid", "length"].includes(kind);
}

function syncInternalMeasureFields() {
  const internal = isInternalMeasureKind(kindSelect.value);
  const basePrice = document.querySelector("[data-base-price]");
  const productBarcode = document.querySelector("[data-product-barcode]");
  [basePrice, productBarcode].forEach((field) => {
    const wrapper = field?.closest(".field");
    if (!wrapper) return;
    wrapper.hidden = internal;
    wrapper.style.display = internal ? "none" : "";
    field.disabled = internal;
    if (internal) field.value = field === basePrice ? "0" : "";
  });
}

function productOrigin(product) {
  return String(product?.originCountry || product?.origin || product?.origin_country || "").trim();
}

function originCountryMarkup(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  const color = ToxStore.originCountryColor?.(text) || "";
  if (!color) return escapeHtml(text);
  return `<span class="origin-country-token" style="--origin-accent:${escapeHtml(color)}"><span class="origin-country-dot" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
}

function productMetaMarkup(parts) {
  return parts.filter(Boolean).join(`<span class="meta-separator">|</span>`);
}

function smartOriginCountries(state) {
  if (typeof ToxStore.smartOriginCountries === "function") return ToxStore.smartOriginCountries();
  const seen = new Set();
  return [
    ...(state.originCountries || []).map((origin) => origin.name),
    ...(state.products || []).map(productOrigin),
    "العراق", "تركيا", "الصين", "إيران", "الإمارات", "السعودية", "الهند", "ألمانيا", "إيطاليا", "أمريكا"
  ].map((country) => String(country || "").trim())
    .filter((country) => {
      const key = country.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function filteredProducts(state) {
  const warehouseId = warehouseFilter.value;
  const query = productsSearch.value.trim().toLowerCase();
  const searchableProducts = state.products || [];
  return state.products
    .filter((product) => {
      const matchesWarehouse = !warehouseId || warehouseId === "all" || product.warehouseId === warehouseId;
      const matchesSearch = ToxStore.productMatchesSmartSearch(product, query, (entry) => [
        entry.name,
        entry.brand,
        productOrigin(entry),
        ToxStore.getWarehouseName(entry.warehouseId),
        entry.baseUnit,
        ...(entry.units || []).map((unit) => unit.name),
        ToxStore.productKindLabel(entry, state.lang)
      ], searchableProducts);
      return matchesWarehouse && matchesSearch;
    })
    .sort((left, right) => `${left.brand || ""} ${left.name}`.localeCompare(`${right.brand || ""} ${right.name}`, state.lang));
}

function warehouseOptions(state, includeAll = false) {
  const options = state.warehouses.map((warehouse) => `<option value="${warehouse.id}">${warehouse.name}</option>`).join("");
  return includeAll ? `<option value="all">${t("warehouses", state.lang)}</option>${options}` : options;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function expiryLabel(product, state) {
  if (!product.expiresAt) return "-";
  const expired = new Date(product.expiresAt).getTime() <= Date.now();
  return `<span class="${expired ? "danger-text" : ""}">${expired ? t("expired", state.lang) : t("expiryDate", state.lang)}: ${new Date(product.expiresAt).toLocaleDateString()}</span>`;
}

function openWarehouse(warehouseId) {
  sessionStorage.setItem(warehouseSelectionKey, warehouseId);
  window.location.href = "warehouse.html";
}

function openLabelPage(product) {
  if (!product) return;
  playUiSound("print");
  window.location.href = `labels.html?productId=${product.id}`;
}

function openPurchaseForProduct(product) {
  if (!product) return;
  sessionStorage.setItem(purchasePrefillProductKey, product.id);
  window.location.href = "purchases.html#receive";
}

function productPricingModel() {
  const currency = productCurrencySelect?.value || "IQD";
  const multiplier = stockUnitMultiplierValue();
  const purchaseCost = productNumber(purchaseCostInput?.value);
  const stockSalePrice = productNumber(stockSalePriceInput?.value);
  const basePrice = productNumber(basePriceInput?.value);
  const computedBasePrice = multiplier > 0 ? stockSalePrice / multiplier : 0;
  const effectiveBasePrice = basePrice;
  const unitCost = multiplier > 0 ? purchaseCost / multiplier : 0;
  const stockProfit = stockSalePrice - purchaseCost;
  const stockMetrics = profitMetrics(stockSalePrice, purchaseCost);
  const baseMetrics = profitMetrics(effectiveBasePrice, unitCost);
  return {
    currency,
    multiplier,
    purchaseCost,
    stockSalePrice,
    basePrice,
    computedBasePrice,
    effectiveBasePrice,
    unitCost,
    stockProfit,
    unitProfit: effectiveBasePrice - unitCost,
    stockMargin: stockMetrics.margin,
    stockMarkup: stockMetrics.markup,
    unitMargin: baseMetrics.margin,
    unitMarkup: baseMetrics.markup
  };
}

function updateStockSalePriceFromBase() {
  if (!stockSalePriceInput || !basePriceInput) return;
  if (isSingleProductKind()) stockSalePriceInput.value = basePriceInput.value || "0";
}

function syncSmartPricing({ forceBase = false, fillUnitPrices = true } = {}) {
  const internal = isInternalMeasureKind(kindSelect.value);
  if (!basePriceInput || !stockSalePriceInput) return productPricingModel();
  if (isSingleProductKind()) {
    if (stockUnitNameInput) stockUnitNameInput.value = productUnitLabel();
    if (stockUnitMultiplierInput) stockUnitMultiplierInput.value = "1";
    if (!stockSalePriceInput.value || forceBase) stockSalePriceInput.value = basePriceInput.value || "0";
  }
  renderProductPricingSummary();
  return productPricingModel();
}

function productProfitTone(value) {
  if (value > 0) return "profit";
  if (value < 0) return "loss";
  return "neutral";
}

function productLowMarginWarningPercent() {
  const value = Number(ToxStore.getState().productPricingSettings?.lowMarginWarningPercent ?? 8);
  return Number.isFinite(value) && value >= 0 ? value : 8;
}

function productAllowsSaleBelowCost() {
  return ToxStore.getState().productPricingSettings?.allowSaleBelowCost === true;
}

function unitCostForMultiplier(multiplier, model = productPricingModel()) {
  return model.multiplier > 0 ? model.purchaseCost * (productNumber(multiplier) / model.multiplier) : 0;
}

function unitPricingMetrics(multiplier, price, model = productPricingModel()) {
  return profitMetrics(productNumber(price), unitCostForMultiplier(multiplier, model));
}

function unitPricingTone(metrics) {
  if (metrics.profit < 0) return "loss";
  if (metrics.price > 0 && metrics.margin < productLowMarginWarningPercent()) return "weak";
  if (metrics.profit > 0) return "profit";
  return "neutral";
}

function unitPricingWarning(metrics) {
  if (metrics.profit < 0) return productAllowsSaleBelowCost() ? "خسارة مسموحة" : "خسارة تمنع الحفظ";
  if (metrics.price > 0 && metrics.margin < productLowMarginWarningPercent()) return "هامش منخفض";
  return "";
}

function refreshUnitPriceRow(rowNode, model = productPricingModel()) {
  if (!rowNode) return null;
  const multiplier = productNumber(rowNode.querySelector("[data-unit-multiplier-value]")?.value || rowNode.dataset.unitMultiplier, 1);
  const price = productNumber(rowNode.querySelector("[data-unit-price-input]")?.value);
  const metrics = unitPricingMetrics(multiplier, price, model);
  const tone = unitPricingTone(metrics);
  rowNode.classList.toggle("profit", tone === "profit");
  rowNode.classList.toggle("loss", tone === "loss");
  rowNode.classList.toggle("weak", tone === "weak");
  rowNode.classList.toggle("neutral", tone === "neutral");
  rowNode.querySelectorAll("[data-unit-cost]").forEach((node) => {
    node.textContent = formatProductInputMoney(metrics.cost, model.currency);
  });
  rowNode.querySelectorAll("[data-unit-profit]").forEach((node) => {
    node.textContent = formatProductInputMoney(metrics.profit, model.currency);
  });
  rowNode.querySelectorAll("[data-unit-margin]").forEach((node) => {
    node.textContent = formatProductPercent(metrics.margin);
  });
  rowNode.querySelectorAll("[data-unit-markup]").forEach((node) => {
    node.textContent = formatProductPercent(metrics.markup);
  });
  rowNode.querySelectorAll("[data-unit-warning]").forEach((node) => {
    node.textContent = unitPricingWarning(metrics);
    node.hidden = !node.textContent;
  });
  return { ...metrics, tone };
}

function refreshUnitPricingStatus() {
  if (!productPricingSummary) return;
  const model = productPricingModel();
  const rows = [...productForm.querySelectorAll("[data-unit-price-row]")];
  const metrics = rows.map((row) => refreshUnitPriceRow(row, model)).filter(Boolean);
  const priced = metrics.filter((entry) => entry.price > 0);
  const losses = metrics.filter((entry) => entry.profit < 0).length;
  const lowMarginLimit = productLowMarginWarningPercent();
  const lowMargins = metrics.filter((entry) => entry.price > 0 && entry.profit >= 0 && entry.margin < lowMarginLimit).length;
  const minMargin = priced.length ? Math.min(...priced.map((entry) => entry.margin)) : 0;
  const countNode = productPricingSummary.querySelector("[data-pricing-unit-count]");
  const marginNode = productPricingSummary.querySelector("[data-pricing-min-margin]");
  const warningNode = productPricingSummary.querySelector("[data-pricing-warning]");
  if (countNode) countNode.textContent = String(rows.length);
  if (marginNode) marginNode.textContent = formatProductPercent(minMargin);
  if (warningNode) {
    warningNode.textContent = losses
      ? `${losses} وحدة بسعر خسارة`
      : lowMargins
        ? `${lowMargins} وحدة بهامش منخفض`
        : "الأسعار جاهزة";
    warningNode.dataset.tone = losses ? "loss" : lowMargins ? "weak" : "profit";
  }
}

function fixedPricingRowTemplate({ role, name, multiplier, price, barcode, badge, locked = true }) {
  const model = productPricingModel();
  const metrics = unitPricingMetrics(multiplier, price, model);
  const tone = unitPricingTone(metrics);
  const priceAttr = role === "base" ? "data-unit-base-price" : "data-unit-storage-price";
  const barcodeAttr = role === "base" ? "data-unit-base-barcode" : "data-unit-storage-barcode";
  return `
    <div class="unit-price-row ${tone}" data-unit-price-row data-fixed-unit="${role}" data-unit-multiplier="${escapeHtml(multiplier)}">
      <div class="unit-price-cell unit-price-name">
        <span>${escapeHtml(badge)}</span>
        <strong>${escapeHtml(name)}</strong>
      </div>
      <label class="unit-price-cell">
        <span>التحويل</span>
        <input type="number" value="${escapeHtml(multiplier)}" data-unit-multiplier-value ${locked ? "disabled" : ""} />
      </label>
      <label class="unit-price-cell">
        <span>سعر البيع</span>
        <input type="number" min="0" step="any" value="${escapeHtml(productMoneyInputValue(price))}" data-unit-price-input ${priceAttr} />
      </label>
      <div class="unit-price-cell unit-price-stat">
        <span>الكلفة</span>
        <b data-unit-cost>${formatProductInputMoney(metrics.cost, model.currency)}</b>
      </div>
      <div class="unit-price-cell unit-price-stat">
        <span>الربح</span>
        <b data-unit-profit>${formatProductInputMoney(metrics.profit, model.currency)}</b>
      </div>
      <div class="unit-price-cell unit-price-stat">
        <span>الهامش / الزيادة</span>
        <b><i data-unit-margin>${formatProductPercent(metrics.margin)}</i> / <i data-unit-markup>${formatProductPercent(metrics.markup)}</i></b>
        <em data-unit-warning ${unitPricingWarning(metrics) ? "" : "hidden"}>${unitPricingWarning(metrics)}</em>
      </div>
      <label class="unit-price-cell">
        <span>باركود الوحدة</span>
        <input value="${escapeHtml(barcode || "")}" ${barcodeAttr} />
      </label>
    </div>
  `;
}

function renderProductPricingSummary() {
  if (!productPricingSummary) return;
  const model = productPricingModel();
  const baseUnit = productUnitLabel();
  const stockUnit = stockUnitLabel();
  const showBaseRow = !isInternalMeasureKind(kindSelect.value);
  const showStorageRow = !isSingleProductKind() && model.multiplier > 1;
  const fixedRows = [
    showBaseRow ? fixedPricingRowTemplate({
      role: "base",
      name: baseUnit,
      multiplier: 1,
      price: model.effectiveBasePrice,
      barcode: productBarcodeInput?.value || "",
      badge: "أساس"
    }) : "",
    showStorageRow ? fixedPricingRowTemplate({
      role: "storage",
      name: stockUnit,
      multiplier: model.multiplier,
      price: model.stockSalePrice,
      barcode: stockUnitBarcodeDraft,
      badge: "تخزين"
    }) : ""
  ].filter(Boolean).join("");
  productPricingSummary.innerHTML = `
    <div class="unit-pricing-toolbar">
      <span><b data-pricing-unit-count>0</b><small>وحدة بيع</small></span>
      <span><b data-pricing-min-margin>0%</b><small>أقل هامش</small></span>
      <strong data-pricing-warning data-tone="profit">الأسعار جاهزة</strong>
    </div>
    <div class="unit-price-table-head">
      <span>الوحدة</span>
      <span>التحويل</span>
      <span>سعر البيع</span>
      <span>الكلفة</span>
      <span>الربح</span>
      <span>الهامش</span>
      <span>الباركود</span>
    </div>
    <div class="unit-price-fixed-list">
      ${fixedRows || `<div class="unit-pricing-empty">أضف وحدة بيع فعلية مثل كيلو، لتر، متر، أو كارتون حتى يظهر التسعير.</div>`}
    </div>
  `;
  productPricingSummary.querySelector("[data-unit-base-price]")?.addEventListener("input", (event) => {
    basePriceInput.value = event.currentTarget.value || "0";
    if (isSingleProductKind()) stockSalePriceInput.value = basePriceInput.value || "0";
    refreshUnitPricingStatus();
  });
  productPricingSummary.querySelector("[data-unit-storage-price]")?.addEventListener("input", (event) => {
    stockSalePriceInput.value = event.currentTarget.value || "0";
    refreshUnitPricingStatus();
  });
  productPricingSummary.querySelector("[data-unit-base-barcode]")?.addEventListener("input", (event) => {
    if (productBarcodeInput) productBarcodeInput.value = event.currentTarget.value || "";
  });
  productPricingSummary.querySelector("[data-unit-storage-barcode]")?.addEventListener("input", (event) => {
    stockUnitBarcodeDraft = event.currentTarget.value || "";
  });
  refreshUnitPricingStatus();
}

function refreshRenderedUnitPricing() {
  const model = productPricingModel();
  preProductUnits?.querySelectorAll("[data-pre-unit-row]").forEach((rowNode) => {
    const row = preProductUnitRows.find((entry) => entry.id === rowNode.dataset.preUnitRow);
    if (!row) return;
    const priceInput = rowNode.querySelector("[data-pre-unit-price]");
    if (priceInput && document.activeElement !== priceInput) priceInput.value = row.price || "";
    refreshUnitPriceRow(rowNode, model);
  });
  refreshUnitPricingStatus();
}

function unitRowTemplate(row, index) {
  const model = productPricingModel();
  const multiplier = productNumber(row.multiplier);
  const price = productNumber(row.price);
  const metrics = unitPricingMetrics(multiplier, price, model);
  const tone = unitPricingTone(metrics);
  return `
    <div class="unit-price-row pre-product-unit-row ${tone}" data-unit-price-row data-pre-unit-row="${row.id}" data-unit-multiplier="${escapeHtml(multiplier || "")}">
      <label class="unit-price-cell unit-price-name editable">
        <span>وحدة بيع</span>
        <div class="unit-name-actions">
          <input data-pre-unit-name value="${escapeHtml(row.name || "")}" />
          <button class="icon-button unit-preset-trigger" type="button" data-open-unit-preset-menu="${row.id}" title="اختيار وحدة مثبتة" aria-label="اختيار وحدة مثبتة">
            <span class="unit-preset-dots"><i></i><i></i><i></i></span>
            <em>${t("unit")}</em>
          </button>
        </div>
        <div class="unit-preset-menu" data-unit-preset-menu="${row.id}" hidden></div>
      </label>
      <label class="unit-price-cell">
        <span>التحويل</span>
        <input type="number" min="0.01" step="0.01" data-pre-unit-multiplier data-unit-multiplier-value value="${escapeHtml(row.multiplier || "")}" />
      </label>
      <label class="unit-price-cell">
        <span>سعر البيع</span>
        <div class="unit-price-actions">
          <input type="number" min="0" step="any" data-pre-unit-price data-unit-price-input value="${escapeHtml(row.price || "")}" />
        </div>
      </label>
      <div class="unit-price-cell unit-price-stat">
        <span>الكلفة</span>
        <b data-unit-cost>${formatProductInputMoney(metrics.cost, model.currency)}</b>
      </div>
      <div class="unit-price-cell unit-price-stat">
        <span>الربح</span>
        <b data-unit-profit>${formatProductInputMoney(metrics.profit, model.currency)}</b>
      </div>
      <div class="unit-price-cell unit-price-stat">
        <span>الهامش / الزيادة</span>
        <b><i data-unit-margin>${formatProductPercent(metrics.margin)}</i> / <i data-unit-markup>${formatProductPercent(metrics.markup)}</i></b>
        <em data-unit-warning ${unitPricingWarning(metrics) ? "" : "hidden"}>${unitPricingWarning(metrics)}</em>
      </div>
      <label class="unit-price-cell unit-price-barcode">
        <span>باركود الوحدة</span>
        <input data-pre-unit-barcode value="${escapeHtml(row.barcode || "")}" />
      </label>
      <button class="icon-button unit-price-remove" type="button" data-remove-pre-unit="${row.id}" title="${t("delete")}" aria-label="${t("delete")}">×</button>
    </div>
  `;
}

function smartUnitPresets(state = ToxStore.getState()) {
  const kind = kindSelect.value || "packaged";
  return (state.unitPresets || [])
    .filter((unit) => unit.kind === kind)
    .slice(0, 12);
}

function quickUnitSuggestions(state = ToxStore.getState()) {
  const kind = kindSelect.value || "packaged";
  if (kind === "single") return [];
  const preset = productPresets[kind] || productPresets.packaged;
  const baseUnit = document.querySelector("[data-base-unit]")?.value || preset.baseUnit || t("baseUnit", state.lang);
  const stockName = stockUnitNameInput?.value || preset.stockUnit || baseUnit;
  const stockMultiplier = Number(stockUnitMultiplierInput?.value || preset.stockMultiplier || 1);
  const quick = [
    !isInternalMeasureKind(kind) ? { id: "quick-base-unit", name: baseUnit, multiplier: 1 } : null,
    preset.unit1?.name ? { id: "quick-unit-1", ...preset.unit1 } : null,
    kind === "packaged" ? { id: "quick-dozen", name: "درزن", multiplier: 12 } : null,
    stockMultiplier > 1 ? { id: "quick-storage-unit", name: stockName, multiplier: stockMultiplier } : null
  ].filter((unit) => String(unit?.name || "").trim() && Number(unit?.multiplier) > 0);
  const saved = (state.unitPresets || []).filter((unit) => unit.kind === kind);
  const seen = new Set();
  return [...quick, ...saved].map((unit, index) => ({ ...unit, id: unit.id || `suggested-unit-${index}` })).filter((unit) => {
    const key = `${String(unit.name || "").trim()}:${Number(unit.multiplier || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function unitKindTitle(kind, lang = ToxStore.getState().lang) {
  const titles = {
    weighted: lang === "ar" ? "وحدات الوزن" : "Weight units",
    liquid: lang === "ar" ? "وحدات السوائل" : "Liquid units",
    length: lang === "ar" ? "وحدات الطول" : "Length units",
    packaged: lang === "ar" ? "وحدات التعبئة" : "Packaging units",
    single: lang === "ar" ? "وحدات المفرد" : "Single units"
  };
  return titles[kind] || (lang === "ar" ? "الوحدات المثبتة" : "Saved units");
}

function applyPresetToRow(rowId, unit) {
  if (!unit) return;
  const name = String(unit.name || "").trim();
  const multiplier = Number(unit.multiplier || 1);
  if (!name || !Number.isFinite(multiplier) || multiplier <= 0) return;
  syncPreProductRowsFromDom();
  preProductUnitRows = preProductUnitRows.map((row) => (
    row.id === rowId ? { ...row, name, multiplier, priceManual: false } : row
  ));
  if (multiplier > 1 && (!stockUnitNameInput.value || Number(stockUnitMultiplierInput.value || 1) <= 1)) {
    stockUnitNameInput.value = name;
    stockUnitMultiplierInput.value = multiplier;
  }
  openUnitPresetMenuId = "";
  syncSmartPricing();
  renderPreProductRows();
}

function renderUnitPresetMenu(rowId) {
  const menu = preProductUnits?.querySelector(`[data-unit-preset-menu="${rowId}"]`);
  if (!menu) return;
  menu.hidden = openUnitPresetMenuId !== rowId;
  if (menu.hidden) return;
  const state = ToxStore.getState();
  const units = smartUnitPresets(state);
  const baseUnit = document.querySelector("[data-base-unit]")?.value || t("baseUnit", state.lang);
  const kind = kindSelect.value || "packaged";
  menu.innerHTML = units.length
    ? `
      <div class="unit-preset-menu-head">
        <strong>${escapeHtml(unitKindTitle(kind, state.lang))}</strong>
        <span>${state.lang === "ar" ? "من وحدات المستودع المثبتة" : "From saved warehouse units"}</span>
      </div>
      ${units.map((unit) => `
        <button type="button" data-choose-unit-preset="${escapeHtml(unit.id)}">
          <span>
            <strong>${escapeHtml(unit.name)}</strong>
            <small>${escapeHtml(unitKindTitle(unit.kind, state.lang))}</small>
          </span>
          <b>${Number(unit.multiplier).toLocaleString()} ${escapeHtml(baseUnit)}</b>
        </button>
      `).join("")}
    `
    : `
      <div class="unit-preset-menu-empty">
        <strong>${escapeHtml(unitKindTitle(kind, state.lang))}</strong>
        <span>${state.lang === "ar" ? "لا توجد وحدات مثبتة لهذا النوع. أضفها من صفحة المستودعات." : "No saved units for this type. Add them from Warehouse."}</span>
      </div>
    `;
  menu.querySelectorAll("[data-choose-unit-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const unit = units.find((entry) => entry.id === button.dataset.chooseUnitPreset);
      applyPresetToRow(rowId, unit);
    });
  });
}

function syncPreProductRowsFromDom() {
  const previous = new Map(preProductUnitRows.map((row) => [row.id, row]));
  preProductUnitRows = [...document.querySelectorAll("[data-pre-unit-row]")].map((row) => ({
    id: row.dataset.preUnitRow,
    name: row.querySelector("[data-pre-unit-name]")?.value || "",
    multiplier: row.querySelector("[data-pre-unit-multiplier]")?.value || "",
    price: row.querySelector("[data-pre-unit-price]")?.value || "",
    barcode: row.querySelector("[data-pre-unit-barcode]")?.value || "",
    priceManual: previous.get(row.dataset.preUnitRow)?.priceManual === true
  }));
}

function setPreProductRows(rows) {
  preProductUnitRows = rows.map((row, index) => ({
    id: row.id || `pre-unit-${Date.now()}-${index}`,
    name: row.name || "",
    multiplier: row.multiplier || "",
    price: row.price || "",
    barcode: row.barcode || "",
    priceManual: row.priceManual === true
  }));
  renderPreProductRows();
}

function renderPreProductRows() {
  if (!preProductUnits) return;
  if (isSingleProductKind()) {
    preProductUnitRows = [];
    preProductUnits.innerHTML = "";
    renderOpeningStockUnitOptions();
    syncInternalMeasureFields();
    renderProductPricingSummary();
    return;
  }
  syncSmartPricing({ fillUnitPrices: false });
  preProductUnits.innerHTML = preProductUnitRows.map(unitRowTemplate).join("");
  preProductUnits.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const rowNode = event.target?.closest("[data-pre-unit-row]");
      syncPreProductRowsFromDom();
      if (event.target?.matches("[data-pre-unit-price]")) {
        preProductUnitRows = preProductUnitRows.map((entry) => (
          entry.id === rowNode?.dataset.preUnitRow ? { ...entry, priceManual: true } : entry
        ));
      }
      syncSmartPricing({ fillUnitPrices: false });
      refreshRenderedUnitPricing();
      renderOpeningStockUnitOptions();
    });
  });
  preProductUnits.querySelectorAll("[data-remove-pre-unit]").forEach((button) => {
    button.addEventListener("click", () => {
      syncPreProductRowsFromDom();
      preProductUnitRows = preProductUnitRows.filter((row) => row.id !== button.dataset.removePreUnit);
      renderPreProductRows();
    });
  });
  preProductUnits.querySelectorAll("[data-open-unit-preset-menu]").forEach((button) => {
    button.title = ToxStore.getState().lang === "ar" ? "اختيار وحدة مثبتة" : "Choose saved unit";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openUnitPresetMenuId = openUnitPresetMenuId === button.dataset.openUnitPresetMenu ? "" : button.dataset.openUnitPresetMenu;
      renderPreProductRows();
    });
  });
  preProductUnitRows.forEach((row) => renderUnitPresetMenu(row.id));
  renderOpeningStockUnitOptions();
  syncInternalMeasureFields();
  renderProductPricingSummary();
  if (productDraftReady) scheduleProductDraftSave();
}

function addPreProductUnit(row = {}) {
  syncPreProductRowsFromDom();
  preProductUnitRows.push({
    id: `pre-unit-${Date.now()}-${preProductUnitRows.length}`,
    name: row.name || "",
    multiplier: row.multiplier || "",
    price: row.price || "",
    barcode: row.barcode || "",
    priceManual: row.priceManual === true
  });
  syncSmartPricing();
  renderPreProductRows();
}

function applyUnitSuggestion(unit) {
  const name = String(unit.name || "").trim();
  const multiplier = Number(unit.multiplier || 1);
  if (!name || !Number.isFinite(multiplier) || multiplier <= 0) return;
  syncPreProductRowsFromDom();
  if (Math.abs(multiplier - 1) < 0.0001) {
    renderProductPricingSummary();
    return;
  }
  const currentStockName = String(stockUnitNameInput?.value || "").trim();
  const currentStockMultiplier = Number(stockUnitMultiplierInput?.value || 1);
  if (currentStockName === name && Math.abs(currentStockMultiplier - multiplier) < 0.0001) {
    renderProductPricingSummary();
    return;
  }
  if (multiplier > 1 && (!stockUnitNameInput.value || Number(stockUnitMultiplierInput.value || 1) <= 1)) {
    stockUnitNameInput.value = name;
    stockUnitMultiplierInput.value = multiplier;
  }
  if (!preProductUnitRows.some((row) => row.name === name && Number(row.multiplier) === multiplier)) {
    addPreProductUnit({ name, multiplier, price: "" });
  }
  renderOpeningStockUnitOptions();
}

function renderSuggestionControls(state) {
  if (brandSuggestions) {
    brandSuggestions.innerHTML = (state.brands || [])
      .map((brand) => `<option value="${escapeHtml(brand.name)}"></option>`)
      .join("");
  }
  if (brandChipSuggestions) {
    const brandInput = document.querySelector("[data-product-brand]");
    brandChipSuggestions.innerHTML = (state.brands || []).slice(0, 8)
      .map((brand) => `<button class="brand-suggestion-chip" type="button" data-use-brand="${escapeHtml(brand.name)}">${escapeHtml(brand.name)}</button>`)
      .join("") || `<small>${state.lang === "ar" ? "البراندات المثبتة تظهر هنا" : "Saved brands appear here"}</small>`;
    brandChipSuggestions.querySelectorAll("[data-use-brand]").forEach((button) => {
      button.addEventListener("click", () => {
        if (brandInput) brandInput.value = button.dataset.useBrand;
      });
    });
  }
  if (brandChipSuggestions) {
    const brandInput = document.querySelector("[data-product-brand]");
    const brandItems = (state.brands || []).slice(0, 12);
    brandChipSuggestions.hidden = !brandPickerOpen;
    brandChipSuggestions.classList.add("brand-picker-menu");
    brandChipSuggestions.innerHTML = `
      <div class="brand-picker-head">
        <strong>${state.lang === "ar" ? "اختيار براند مثبت" : "Choose saved brand"}</strong>
        <span>${state.lang === "ar" ? "من البراندات التي أنشأتها في المستودعات" : "From brands saved in warehouse"}</span>
      </div>
      ${brandItems.length
        ? brandItems.map((brand) => `<button class="brand-suggestion-chip" type="button" data-use-brand="${escapeHtml(brand.name)}"><strong>${escapeHtml(brand.name)}</strong><span>Brand</span></button>`).join("")
        : `<small>${state.lang === "ar" ? "لا توجد براندات مثبتة بعد. أضفها من صفحة المستودعات." : "No saved brands yet. Add them from Warehouse."}</small>`
      }
    `;
    brandChipSuggestions.querySelectorAll("[data-use-brand]").forEach((button) => {
      button.addEventListener("click", () => {
        if (brandInput) brandInput.value = button.dataset.useBrand;
        brandPickerOpen = false;
        renderSuggestionControls(ToxStore.getState());
      });
    });
  }
  if (originSuggestions) {
    originSuggestions.innerHTML = smartOriginCountries(state)
      .map((country) => `<option value="${escapeHtml(country)}"></option>`)
      .join("");
  }
  if (!unitPresetSuggestions) return;
  if (isSingleProductKind()) {
    unitPresetSuggestions.innerHTML = "";
    unitPresetSuggestions.hidden = true;
    return;
  }
  unitPresetSuggestions.hidden = false;
  const kind = kindSelect.value || "packaged";
  const units = quickUnitSuggestions(state);
  unitPresetSuggestions.innerHTML = units.length
    ? units.map((unit) => `
      <button class="button ghost" type="button" data-use-unit-preset="${escapeHtml(unit.id)}">
        ${escapeHtml(unit.name)} × ${Number(unit.multiplier).toLocaleString()}
      </button>
    `).join("")
    : `<small>${state.lang === "ar" ? "لا توجد وحدات مقترحة لهذا النوع" : "No unit suggestions for this type"}</small>`;
  unitPresetSuggestions.querySelectorAll("[data-use-unit-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const unit = units.find((entry) => entry.id === button.dataset.useUnitPreset);
      applyUnitSuggestion(unit);
    });
  });
}

function openingStockUnits() {
  const stockUnit = stockUnitNameInput?.value || document.querySelector("[data-base-unit]")?.value || t("baseUnit");
  const stockMultiplier = Number(stockUnitMultiplierInput?.value || 1);
  const baseUnit = document.querySelector("[data-base-unit]")?.value || t("baseUnit");
  const units = [
    { label: stockUnit, multiplier: Math.max(0.0001, stockMultiplier) },
    { label: baseUnit, multiplier: 1 },
    ...preProductUnitRows
      .filter((unit) => String(unit.name || "").trim() && Number(unit.multiplier) > 0)
      .map((unit) => ({ label: unit.name, multiplier: Number(unit.multiplier) }))
  ];
  const seen = new Set();
  return units.filter((unit) => {
    const key = `${unit.label}:${unit.multiplier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderOpeningStockUnitOptions() {
  if (!openingStockUnitSelect) return;
  const selected = openingStockUnitSelect.value;
  const options = openingStockUnits();
  openingStockUnitSelect.innerHTML = options
    .map((unit) => `<option value="${unit.multiplier}" data-label="${unit.label}" ${String(unit.multiplier) === selected ? "selected" : ""}>${unit.label}</option>`)
    .join("");
}

function applyKindPreset(force = false) {
  if (force) basePriceManual = false;
  const preset = productPresets[kindSelect.value] || productPresets.single;
  const baseUnitField = document.querySelector("[data-base-unit]");
  if (force || !baseUnitField.value) baseUnitField.value = preset.baseUnit;
  if (force || !stockUnitNameInput.value) stockUnitNameInput.value = preset.stockUnit || preset.unit2.name || preset.baseUnit;
  if (force || !stockUnitMultiplierInput.value || Number(stockUnitMultiplierInput.value) <= 0) {
    stockUnitMultiplierInput.value = preset.stockMultiplier || preset.unit2.multiplier || 1;
  }
  if (force || !document.querySelector("[data-opening-stock]").value || Number(document.querySelector("[data-opening-stock]").value) === 0) {
    setField("[data-opening-stock]", preset.stock);
  }
  if (force || !document.querySelector("[data-alert-qty]").value || Number(document.querySelector("[data-alert-qty]").value) === 0) {
    setField("[data-alert-qty]", preset.alert);
  }
  if (force || !preProductUnitRows.length) {
    const defaultRows = kindSelect.value === "single"
      ? []
      : [
        { name: preset.unit1.name, multiplier: preset.unit1.multiplier, price: "" },
        { name: preset.unit2.name, multiplier: preset.unit2.multiplier, price: "" }
      ].filter((row) => String(row.name || "").trim() && Number(row.multiplier) > 0);
    setPreProductRows(defaultRows);
  }

  preProductUnits?.querySelectorAll("input,button").forEach((field) => {
    const disabled = kindSelect.value === "single";
    field.disabled = disabled;
  });

  kindPreview.innerHTML = `
    <div class="kind-preview-badge">${t(kindSelect.value === "length" ? "lengthType" : kindSelect.value, ToxStore.getState().lang)}</div>
    <strong>${preset.baseUnit}</strong>
    <small>${preset.guide}</small>
  `;
  renderOpeningStockUnitOptions();
  syncSmartPricing({ forceBase: force, fillUnitPrices: true });
  renderSuggestionControls(ToxStore.getState());
}

function renderCatalog(state) {
  renderSuggestionControls(state);
  const selectedFilter = warehouseFilter.value || sessionStorage.getItem(warehouseSelectionKey) || "all";
  const selectedWarehouse = warehouseSelect.value;
  warehouseSelect.innerHTML = warehouseOptions(state);
  warehouseFilter.innerHTML = warehouseOptions(state, true);
  const hasWarehouses = state.warehouses.length > 0;
  productForm.querySelectorAll("input,select,button").forEach((element) => {
    if (element === productsSearch || element === warehouseFilter) return;
    element.disabled = !hasWarehouses;
  });
  if (hasWarehouses && [...warehouseSelect.options].some((option) => option.value === selectedWarehouse)) {
    warehouseSelect.value = selectedWarehouse;
  }

  if ([...warehouseFilter.options].some((option) => option.value === selectedFilter)) {
    warehouseFilter.value = selectedFilter;
  } else {
    warehouseFilter.value = "all";
  }

  totalProductsCount.textContent = `${state.products.length}`;

  const products = filteredProducts(state);
  filteredProductsCount.textContent = `${products.length}`;
  productsCatalog.innerHTML = products.length
    ? products
        .map((product) => {
          const customUnits = product.units
            .slice(1)
            .map((unit) => `
              <div class="catalog-unit-chip" title="${escapeHtml(unit.name)}">
                <span>${escapeHtml(unit.name)}</span>
                <strong>${Number(unit.multiplier).toLocaleString()} ${escapeHtml(ToxStore.productBaseUnit(product))}</strong>
                ${readonlyPrice(product, unit.id)}
              </div>
            `)
            .join("");
          const unitBarcodeSummary = (product.units.length ? product.units : [{ name: ToxStore.productBaseUnit(product), multiplier: 1 }])
            .map((unit, index) => {
              const isBase = index === 0 || Math.abs(Number(unit.multiplier || 1) - 1) < 0.0001;
              const barcode = String(unit.barcode || (isBase ? product.barcode : "") || "").trim();
              return barcode ? `${unit.name}: ${barcode}` : "";
            })
            .filter(Boolean)
            .join(" | ") || "-";
          const productBarcodeLabel = state.lang === "ar" ? "باركود المنتج" : "Product barcode";
          const unitBarcodeLabel = state.lang === "ar" ? "باركود الوحدات" : "Unit barcodes";
          const productTitle = product.name || (state.lang === "ar" ? "منتج بدون اسم" : "Unnamed product");
          const origin = productOrigin(product);
          const productMeta = [product.brand, origin, ToxStore.getWarehouseName(product.warehouseId), ToxStore.productKindLabel(product, state.lang), ToxStore.productBaseUnit(product)]
            .filter(Boolean)
            .join(" | ");
          const productMetaHtml = productMetaMarkup([
            product.brand ? escapeHtml(product.brand) : "",
            origin ? originCountryMarkup(origin) : "",
            escapeHtml(ToxStore.getWarehouseName(product.warehouseId)),
            escapeHtml(ToxStore.productKindLabel(product, state.lang)),
            escapeHtml(ToxStore.productBaseUnit(product))
          ]);
          const storageUnitLabel = state.lang === "ar" ? "وحدة التخزين الرئيسية" : "Main storage unit";
          const internalPriceLabel = state.lang === "ar" ? "وحدة قياس داخلية لا تسعر" : "Internal measure, no price";
          const safeBarcode = isInternalMeasureKind(product.kind) ? "-" : (product.barcode || "-");

          const cardImage = productImageFor(product, "catalog");
          return `
            <article class="catalog-card inventory-product-card ${product.stockQuantity <= ToxStore.thresholdQuantity(product) ? "low-stock" : ""}">
              <div class="catalog-card-head">
                <div class="product-card-media ${cardImage ? "" : "is-empty"}">
                  ${cardImage ? `<img src="${escapeHtml(cardImage)}" alt="" />` : `<span>${escapeHtml((product.name || "TOX").slice(0, 2))}</span>`}
                </div>
                <div class="catalog-title-copy">
                  <strong title="${escapeHtml(productTitle)}">${escapeHtml(productTitle)}</strong>
                  <small title="${escapeHtml(productMeta)}">${productMetaHtml}</small>
                </div>
                <div class="catalog-shortcuts">
                  <button class="button ghost" type="button" data-open-warehouse="${product.warehouseId}">${t("warehouse", state.lang)}</button>
                  <button class="button ghost" type="button" data-buy-product="${product.id}">شراء هذا المنتج</button>
                  <button class="button ghost" type="button" data-print-label="${product.id}">${t("labelPrint", state.lang)}</button>
                  <button class="button ghost" type="button" data-manage-product-images="${product.id}">إدارة الصور</button>
                  <button class="button ghost" type="button" data-regenerate-barcode="${product.id}">${t("regenBarcode", state.lang)}</button>
                </div>
              </div>
              <div class="catalog-grid">
                <div class="catalog-stat">
                  <span>${t("stock", state.lang)}</span>
                  <strong>${ToxStore.stockSummary(product)}</strong>
                  <small>${storageUnitLabel}: ${escapeHtml(product.stockUnitName || ToxStore.productBaseUnit(product))}</small>
                </div>
                <div class="catalog-stat">
                  <span>${t("alertQty", state.lang)}</span>
                  <strong>${ToxStore.stockSummary({ ...product, stockQuantity: product.alertQuantity })}</strong>
                </div>
                <div class="catalog-stat">
                  <span>${t("unitPrice", state.lang)}</span>
                  ${isInternalMeasureKind(product.kind) ? `<strong>-</strong><small>${internalPriceLabel}</small>` : readonlyPrice(product, product.units[0]?.id)}
                </div>
                <div class="catalog-stat">
                  <span>${productBarcodeLabel}</span>
                  <strong title="${escapeHtml(safeBarcode)}">${escapeHtml(safeBarcode)}</strong>
                  <small title="${escapeHtml(unitBarcodeSummary)}">${unitBarcodeLabel}: ${escapeHtml(unitBarcodeSummary)}</small>
                </div>
              </div>
              ${customUnits ? `<div class="catalog-unit-strip">${customUnits}</div>` : ""}
              <div class="catalog-card-foot">
                <span>${product.units.length} ${t("unit", state.lang)} | ${expiryLabel(product, state)}</span>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="warehouse-empty">${t("noProducts", state.lang)}</div>`;

  document.querySelectorAll("[data-open-warehouse]").forEach((button) => {
    button.addEventListener("click", (event) => {
      openWarehouse(event.currentTarget.dataset.openWarehouse);
    });
  });

  document.querySelectorAll("[data-print-label]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = state.products.find((entry) => entry.id === button.dataset.printLabel);
      openLabelPage(product);
    });
  });

  document.querySelectorAll("[data-manage-product-images]").forEach((button) => {
    button.addEventListener("click", () => {
      renderProductImageManager(button.dataset.manageProductImages);
    });
  });

  document.querySelectorAll("[data-buy-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = state.products.find((entry) => entry.id === button.dataset.buyProduct);
      openPurchaseForProduct(product);
    });
  });

  document.querySelectorAll("[data-regenerate-barcode]").forEach((button) => {
    button.addEventListener("click", () => {
      ToxStore.regenerateProductBarcode(button.dataset.regenerateBarcode);
      playUiSound("success");
    });
  });

}

function restoreProductDraft() {
  if (productDraftReady || !window.ToxFormDrafts) return;
  productDraftReady = true;
  window.ToxFormDrafts.track(productForm, {
    beforeRestore(draft) {
      const rows = draft?.extra?.preProductUnitRows;
      stockUnitBarcodeDraft = String(draft?.extra?.stockUnitBarcodeDraft || "");
      if (!Array.isArray(rows) || !rows.length) return;
      productDraftRestoring = true;
      setPreProductRows(rows);
      productDraftRestoring = false;
    },
    afterRestore(draft) {
      const view = draft?.extra?.activeProductsView;
      if (view) setProductsView(view);
      renderOpeningStockUnitOptions();
      syncInternalMeasureFields();
      syncSmartPricing({ fillUnitPrices: false });
      renderPreProductRows();
      productForm.querySelectorAll("select").forEach((select) => window.ToxSelects?.update?.(select));
      productNotice(productMessage("productDraftRestored", "تم استرجاع مسودة المنتج.", "Product draft restored."), "info");
    },
    serializeExtra() {
      syncPreProductRowsFromDom();
      return {
        preProductUnitRows,
        stockUnitBarcodeDraft,
        activeProductsView
      };
    }
  });
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncPreProductRowsFromDom();
  syncSmartPricing({ fillUnitPrices: true });

  const extraUnits = (isSingleProductKind() ? [] : preProductUnitRows).map((unit) => ({
    name: unit.name,
    multiplier: unit.multiplier,
    price: unit.price,
    barcode: unit.barcode
  }));
  const internalMeasure = isInternalMeasureKind(kindSelect.value);
  const productCurrency = document.querySelector("[data-product-currency]").value;
  const storageMultiplier = Number(stockUnitMultiplierInput?.value || 1);
  const purchaseCostUsd = ToxStore.moneyToUsd(document.querySelector("[data-purchase-cost]")?.value || 0, productCurrency);
  const candidateUnits = [
    {
      id: "candidate-base",
      name: document.querySelector("[data-base-unit]").value,
      multiplier: 1,
      priceUsd: internalMeasure ? 0 : ToxStore.moneyToUsd(document.querySelector("[data-base-price]").value || 0, productCurrency),
      priceCurrency: productCurrency
    },
    ...(isSingleProductKind() ? [] : [
      {
        id: "candidate-storage",
        name: stockUnitNameInput?.value || document.querySelector("[data-base-unit]").value,
        multiplier: storageMultiplier,
        priceUsd: ToxStore.moneyToUsd(stockSalePriceInput?.value || 0, productCurrency),
        priceCurrency: productCurrency
      },
      ...extraUnits.map((unit, index) => ({
        id: `candidate-extra-${index}`,
        name: unit.name,
        multiplier: Number(unit.multiplier || 0),
        priceUsd: ToxStore.moneyToUsd(unit.price || 0, productCurrency),
        priceCurrency: productCurrency
      }))
    ])
  ];

  clearProductErrors();
  const readiness = ToxStore.validateProductReadiness?.({
    id: "candidate-product",
    name: document.querySelector("[data-product-name]").value,
    kind: kindSelect.value,
    baseUnit: document.querySelector("[data-base-unit]").value,
    currency: productCurrency,
    purchaseCostUsd,
    stockUnitName: stockUnitNameInput?.value || document.querySelector("[data-base-unit]").value,
    stockUnitMultiplier: storageMultiplier,
    units: candidateUnits
  }, { minMargin: productLowMarginWarningPercent() });
  if (readiness && !readiness.ok) {
    showProductReadinessErrors(readiness);
    return;
  }
  showProductReadinessWarnings(readiness);
  const result = ToxStore.addProduct({
    name: document.querySelector("[data-product-name]").value,
    brand: document.querySelector("[data-product-brand]")?.value || "",
    originCountry: document.querySelector("[data-product-origin-country]")?.value || "",
    kind: kindSelect.value,
    warehouseId: warehouseSelect.value,
    baseUnit: document.querySelector("[data-base-unit]").value,
    stockUnitName: stockUnitNameInput?.value || document.querySelector("[data-base-unit]").value,
    stockUnitMultiplier: Number(stockUnitMultiplierInput?.value || 1),
    stockUnitPrice: stockSalePriceInput?.value || "",
    stockUnitBarcode: stockUnitBarcodeDraft,
    stockQuantity: Number(document.querySelector("[data-opening-stock]").value || 0),
    openingStockUnitMultiplier: Number(openingStockUnitSelect?.value || stockUnitMultiplierInput?.value || 1),
    alertQuantity: document.querySelector("[data-alert-qty]").value,
    purchaseCost: document.querySelector("[data-purchase-cost]")?.value,
    purchaseCostCurrency: productCurrency,
    baseUnitPrice: internalMeasure ? 0 : document.querySelector("[data-base-price]").value,
    currency: productCurrency,
    barcode: internalMeasure ? "" : document.querySelector("[data-product-barcode]").value,
    image: pendingProductImages[0]?.preview || "",
    expiryStart: document.querySelector("[data-expiry-start]").value || null,
    expiresAt: document.querySelector("[data-expiry-end]").value || null,
    extraUnits
  });
  if (!result?.ok) {
    showProductErrors(result);
    return;
  }

  try {
    await uploadPendingProductImages(result.product);
  } catch (error) {
    console.warn("Product images were not uploaded", error);
    productNotice(productMessage("productImageUploadWarning", "تم حفظ المنتج، لكن تعذر رفع بعض الصور. يمكنك إضافتها لاحقاً من إدارة الصور.", "Product saved, but some images were not uploaded. You can add them later."), "warning");
  }

  playUiSound("success");
  productDraftRestoring = true;
  productForm.reset();
  pendingProductImages = [];
  stockUnitBarcodeDraft = "";
  renderProductImagePreview([]);
  window.ToxFormDrafts?.clear?.(productForm);
  document.querySelector("[data-expiry-start]").value = todayInputValue();
  applyKindPreset(true);
  productDraftRestoring = false;
  window.ToxFormDrafts?.clear?.(productForm);
  productForm.querySelectorAll("select").forEach((select) => window.ToxSelects?.update?.(select));
  productNotice(productMessage("productCreateSuccess", "تم إنشاء المنتج وحفظه.", "Product created and saved."), "success");
  setProductsView("list");
});

productForm.addEventListener("input", () => {
  clearProductErrors();
});

productImageInput?.addEventListener("change", async () => {
  clearProductErrors();
  try {
    const files = Array.from(productImageInput.files || []).slice(0, 12);
    const prepared = [];
    for (const file of files) {
      prepared.push(await window.ToxMedia.prepareProductImage(file));
    }
    pendingProductImages = [...pendingProductImages, ...prepared].slice(0, 20);
    renderProductImagePreview();
  } catch (error) {
    pendingProductImages = [];
    renderProductImagePreview([]);
    const lang = ToxStore.getState().lang;
    const message = ["IMAGE_TOO_LARGE", "IMAGE_COMPRESSED_TOO_LARGE"].includes(error.message)
      ? (lang === "ar" ? "الصورة كبيرة جداً. اختر صورة واضحة بحجم أقل من 10MB." : "The image is too large. Choose a clear image under 10MB.")
      : (lang === "ar" ? "تعذر قراءة صورة المنتج." : "Could not read product image.");
    productNotice(message, "error");
  } finally {
    productImageInput.value = "";
  }
});

productImagePreview?.addEventListener("click", (event) => {
  const removeButton = event.target.closest?.("[data-pending-image-remove]");
  if (!removeButton) return;
  pendingProductImages = pendingProductImages.filter((image) => image.id !== removeButton.dataset.pendingImageRemove);
  renderProductImagePreview();
});

addPreProductUnitButton.addEventListener("click", () => addPreProductUnit());
brandPickerButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  brandPickerOpen = !brandPickerOpen;
  renderSuggestionControls(ToxStore.getState());
});
document.addEventListener("click", (event) => {
  const manager = event.target.closest?.("[data-product-image-manager]");
  if (event.target.closest?.("[data-product-image-close]")) {
    document.querySelector("[data-product-image-manager]")?.remove();
    return;
  }
  if (manager && event.target === manager) {
    manager.remove();
    return;
  }
  const primaryButton = event.target.closest?.("[data-image-primary]");
  const deleteButton = event.target.closest?.("[data-image-delete]");
  const moveButton = event.target.closest?.("[data-image-move]");
  if (primaryButton || deleteButton || moveButton) {
    const productId = document.querySelector("[data-product-image-manager]")?.dataset.productId || "";
    const state = ToxStore.getState();
    const product = state.products.find((entry) => entry.id === productId);
    const images = productImages(product).filter((image) => !image.isLegacy);
    const imageId = (primaryButton || deleteButton || moveButton).dataset.imagePrimary
      || (primaryButton || deleteButton || moveButton).dataset.imageDelete
      || (primaryButton || deleteButton || moveButton).dataset.imageMove;
    (async () => {
      try {
        if (primaryButton) {
          await patchProductImages(productId, { primaryImageId: imageId });
        } else if (deleteButton) {
          await deleteProductImage(productId, imageId);
        } else if (moveButton) {
          const index = images.findIndex((image) => image.id === imageId);
          const nextIndex = index + Number(moveButton.dataset.imageMoveDir || 0);
          if (index >= 0 && nextIndex >= 0 && nextIndex < images.length) {
            const next = [...images];
            [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
            await patchProductImages(productId, {
              images: next.map((image, sortOrder) => ({ id: image.id, sortOrder, isPrimary: image.isPrimary }))
            });
          }
        }
        renderProductImageManager(productId);
        productNotice("تم تحديث صور المنتج.", "success");
      } catch (error) {
        console.warn("Could not update product image", error);
        productNotice("تعذر تحديث صور المنتج.", "error");
      }
    })();
    return;
  }
  if (!event.target.closest("[data-open-brand-picker],[data-brand-chip-suggestions]")) {
    brandPickerOpen = false;
    if (brandChipSuggestions) brandChipSuggestions.hidden = true;
  }
  if (!event.target.closest(".unit-name-actions,.unit-preset-menu")) {
    openUnitPresetMenuId = "";
    preProductUnits?.querySelectorAll("[data-unit-preset-menu]").forEach((menu) => {
      menu.hidden = true;
    });
  }
});

document.addEventListener("change", (event) => {
  const uploadInput = event.target.closest?.("[data-manager-image-upload]");
  if (!uploadInput) return;
  const productId = document.querySelector("[data-product-image-manager]")?.dataset.productId || "";
  (async () => {
    try {
      const files = Array.from(uploadInput.files || []).slice(0, 12);
      for (const file of files) {
        const prepared = await window.ToxMedia.prepareProductImage(file);
        await uploadProductImage(productId, prepared, false);
      }
      const response = await productApiFetch(`/products/${encodeURIComponent(productId)}/images/`);
      const result = await response.json().catch(() => ({}));
      if (response.ok) applyProductImagePayload(productId, result);
      renderProductImageManager(productId);
      productNotice("تمت إضافة صور المنتج.", "success");
    } catch (error) {
      console.warn("Could not upload product image", error);
      productNotice("تعذر رفع صور المنتج.", "error");
    } finally {
      uploadInput.value = "";
    }
  })();
});
productsViewButtons.forEach((button) => {
  button.addEventListener("click", () => setProductsView(button.dataset.productsView));
});
document.querySelector("[data-base-unit]").addEventListener("input", renderOpeningStockUnitOptions);
stockUnitNameInput?.addEventListener("input", renderOpeningStockUnitOptions);
stockUnitMultiplierInput?.addEventListener("input", renderOpeningStockUnitOptions);
stockUnitNameInput?.addEventListener("input", () => {
  syncSmartPricing();
  renderPreProductRows();
});
stockUnitMultiplierInput?.addEventListener("input", () => {
  syncSmartPricing({ fillUnitPrices: true });
  renderPreProductRows();
});
openingStockUnitSelect?.addEventListener("change", renderOpeningStockUnitOptions);
kindSelect.addEventListener("change", () => {
  openUnitPresetMenuId = "";
  basePriceManual = false;
  applyKindPreset(true);
});
stockSalePriceInput?.addEventListener("input", () => {
  basePriceManual = false;
  syncSmartPricing({ forceBase: true, fillUnitPrices: true });
  renderPreProductRows();
});
purchaseCostInput?.addEventListener("input", () => {
  syncSmartPricing({ fillUnitPrices: false });
  renderPreProductRows();
});
basePriceInput?.addEventListener("input", () => {
  basePriceManual = true;
  updateStockSalePriceFromBase();
  syncInternalMeasureFields();
  syncSmartPricing({ fillUnitPrices: true });
  renderPreProductRows();
});
productCurrencySelect?.addEventListener("change", () => {
  syncSmartPricing({ fillUnitPrices: false });
  renderPreProductRows();
});
productBarcodeInput?.addEventListener("input", () => {
  const fixedBaseBarcode = productPricingSummary?.querySelector("[data-unit-base-barcode]");
  if (fixedBaseBarcode && document.activeElement !== fixedBaseBarcode) {
    fixedBaseBarcode.value = productBarcodeInput.value || "";
  }
});
document.querySelector("[data-base-unit]").addEventListener("input", () => {
  syncSmartPricing({ fillUnitPrices: false });
  renderProductPricingSummary();
});
warehouseFilter.addEventListener("change", () => renderCatalog(ToxStore.getState()));
productsSearch.addEventListener("focus", () => setProductsView("list"));
productsSearch.addEventListener("input", () => {
  setProductsView("list");
  scheduleCatalogRender();
});
productsSearchClear?.addEventListener("click", () => {
  productsSearch.value = "";
  setProductsView("list");
  renderCatalog(ToxStore.getState());
  productsSearch.focus();
});

document.querySelector("[data-expiry-start]").value = todayInputValue();
applyKindPreset(true);
applyProductsHash();
setProductsView(activeProductsView);
window.addEventListener("hashchange", applyProductsHash);

ToxStore.subscribe((state) => {
  renderCatalog(state);
  requestAnimationFrame(restoreProductDraft);
});
