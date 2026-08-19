const cart = [];
let mode = "direct";

const productInput = document.querySelector("[data-product-input]");
const warehouseInput = document.querySelector("[data-sale-warehouse]");
const productSearchInput = document.querySelector("[data-product-search]");
const barcodeSearchInput = document.querySelector("[data-barcode-search]");
const filterCount = document.querySelector("[data-filter-count]");
const qtyInput = document.querySelector("[data-qty-input]");
const unitInput = document.querySelector("[data-unit-input]");
const lineDiscountInput = document.querySelector("[data-discount-input]");
const invoiceDiscountType = document.querySelector("[data-invoice-discount-type]");
const invoiceDiscountValue = document.querySelector("[data-invoice-discount-value]");
const invoiceTitleInput = document.querySelector("[data-invoice-title]");
const invoiceNoteInput = document.querySelector("[data-invoice-note]");
const paidInput = document.querySelector("[data-paid-input]");
const cartTable = document.querySelector("[data-cart-table]");
const clientSelect = document.querySelector("[data-client-select]");
const clientField = document.querySelector("[data-client-field]");
const quickClientForm = document.querySelector("[data-quick-client-form]");
const directCustomerField = document.querySelector("[data-direct-customer-field]");
const directCustomerInput = document.querySelector("[data-direct-customer]");
const previewPrice = document.querySelector("[data-preview-price]");
const previewMeta = document.querySelector("[data-preview-meta]");
const saleProductPreview = document.querySelector("[data-sale-product-preview]");
const flowbar = document.querySelector("[data-flowbar]");
const suspendedList = document.querySelector("[data-suspended-list]");
const suspendedCount = document.querySelector("[data-suspended-count]");
const checkoutButton = document.querySelector("[data-checkout]");
const suspendButton = document.querySelector("[data-suspend-invoice]");
const printButton = document.querySelector("[data-print-invoice]");
const exportButton = document.querySelector("[data-export-draft]");
const invoiceSalePanels = document.querySelectorAll("[data-invoice-sale-panel]");
const directPosPanel = document.querySelector("[data-direct-pos-panel]");
const directProductShowcase = document.querySelector("[data-direct-product-showcase]");
const directQuickAdd = document.querySelector("[data-direct-quick-add]");
const directProductGrid = document.querySelector("[data-direct-product-grid]");
const directPosCount = document.querySelector("[data-direct-pos-count]");
const directCartList = document.querySelector("[data-direct-cart-list]");
const directCartCount = document.querySelector("[data-direct-cart-count]");
const directPosTotal = document.querySelector("[data-direct-pos-total]");
const directPosPaid = document.querySelector("[data-direct-pos-paid]");
const directPosDebt = document.querySelector("[data-direct-pos-debt]");
const directCheckoutButton = document.querySelector("[data-direct-checkout]");
const directCustomerModeButtons = document.querySelectorAll("[data-direct-customer-mode]");
const directPosGuestField = document.querySelector("[data-direct-pos-guest-field]");
const directPosClientField = document.querySelector("[data-direct-pos-client-field]");
const directPosCustomerInput = document.querySelector("[data-direct-pos-customer]");
const directPosClientSelect = document.querySelector("[data-direct-pos-client]");
let directCustomerMode = "guest";
let selectedDirectProductId = "";
let selectedDirectUnitId = "";
let selectedDirectQty = 1;
// Keep the cashier's typed quantity per product. Rendering a new image or
// refreshing the catalogue must never silently reset a pending sale to 1.
const directQtyByProduct = new Map();
let directShowcaseImageIndex = 0;
let directShowcaseTimer = 0;
let directCheckoutSaving = false;
let invoiceCheckoutSaving = false;
const POS_PRODUCT_PAGE_SIZE = 48;
const posProductCache = new Map();
let directCatalogItems = [];
let directCatalogNextCursor = "";
let directCatalogHasMore = false;
let directCatalogLoading = false;
let directCatalogTotalApprox = 0;
let directCatalogAbort = null;
let directCatalogRequestId = 0;
let directCatalogSearchTimer = 0;
let directCatalogObserver = null;
let fullStateLoadRequested = false;
let directPosApiUnavailable = false;
let directPosApiModeChecked = false;
let directLegacyProductsLoaded = false;
let directLegacyProductsCache = [];

function currentSalesView() {
  return window.location.hash === "#create" ? "create" : "pos";
}

function applySalesHash(options = {}) {
  const view = currentSalesView();
  const state = ToxStore.getState();
  const titleKey = view === "create" ? "salesCreateTitle" : "salesTitle";
  const eyebrowKey = view === "create" ? "salesCreateEyebrow" : "salesPosEyebrow";
  const title = document.querySelector("[data-sales-page-title]");
  const eyebrow = document.querySelector("[data-sales-page-eyebrow]");

  document.body.dataset.salesView = view;
  document.querySelectorAll("[data-sales-nav]").forEach((link) => {
    const active = link.dataset.salesNav === view;
    link.classList.toggle("primary", active);
    link.classList.toggle("ghost", !active);
    link.classList.toggle("active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
  });
  invoiceSalePanels.forEach((panel) => {
    panel.hidden = view !== "create";
  });
  if (directPosPanel) directPosPanel.hidden = view !== "pos";
  document.querySelector(".app-shell")?.classList.toggle("with-flowbar", view === "create");
  if (title) {
    title.dataset.i18n = titleKey;
    title.textContent = t(titleKey, state.lang);
  }
  if (eyebrow) {
    eyebrow.dataset.i18n = eyebrowKey;
    eyebrow.textContent = t(eyebrowKey, state.lang);
  }
  document.title = `TOX | ${t(titleKey, state.lang)}`;

  if (options.focus === false) return;
  if (view === "create") {
    window.setTimeout(() => (invoiceTitleInput || productInput)?.focus(), 120);
  } else if (window.location.hash === "#pos") {
    window.setTimeout(() => productSearchInput?.focus(), 120);
  }
  if (view === "create" && !state.products.length && window.ToxStore?.refreshFromBackend && !fullStateLoadRequested) {
    fullStateLoadRequested = true;
    ToxStore.refreshFromBackend({ scope: "full" }).catch((error) => console.warn("Full state load failed", error)).finally(() => {
      fullStateLoadRequested = false;
    });
  }
  if (view === "pos" && !directCatalogItems.length && !directCatalogLoading) {
    scheduleDirectProductsFetch(true);
  }
  renderDirectProducts(state);
  renderDirectCart(state);
}

function saleDict(lang) {
  return lang === "ar"
    ? {
        allWarehouses: "كل المخازن",
        noProduct: "لا يوجد منتج مطابق",
        guestCustomer: "زبون مباشر",
        draftInvoice: "مسودة فاتورة",
        invoiceNo: "رقم الفاتورة",
        date: "التاريخ",
        customer: "الزبون",
        currency: "العملة",
        exchangeRate: "سعر الصرف",
        items: "الأصناف",
        product: "المنتج",
        warehouse: "المخزن",
        qty: "الكمية",
        unit: "الوحدة",
        price: "السعر",
        discount: "الخصم",
        total: "الإجمالي",
        subtotal: "المجموع الفرعي",
        paid: "المدفوع",
        debt: "الدين",
        modeDirect: "بيع مباشر",
        modeClient: "بيع عميل",
        stock: "المتبقي",
        insufficientStock: "الكمية غير كافية بالمخزن",
        noItems: "لم تتم إضافة أصناف بعد",
        directPaid: "\u0627\u0644\u0645\u062f\u0641\u0648\u0639",
        directDebt: "\u0627\u0644\u062f\u064a\u0646",
        directPaidStatus: "\u0645\u062f\u0641\u0648\u0639 \u0628\u0627\u0644\u0643\u0627\u0645\u0644",
        quickAdd: "إضافة سريعة",
        addToCart: "إضافة للسلة",
        select: "اختيار",
        remove: "حذف",
        paidDirectSaleDone: "تم إنهاء بيع مباشر مدفوع بالكامل.",
        directStockError: "تعذر إنهاء البيع بسبب نقص المخزون.",
        requestedExceedsStock: "الكمية المطلوبة أكبر من المتوفر."
      }
    : {
        allWarehouses: "All warehouses",
        noProduct: "No product in this filter",
        guestCustomer: "Guest customer",
        draftInvoice: "Draft Invoice",
        invoiceNo: "Invoice No",
        date: "Date",
        customer: "Customer",
        currency: "Currency",
        exchangeRate: "Exchange Rate",
        items: "Items",
        product: "Product",
        warehouse: "Warehouse",
        qty: "Qty",
        unit: "Unit",
        price: "Price",
        discount: "Discount",
        total: "Total",
        subtotal: "Subtotal",
        paid: "Paid",
        debt: "Debt",
        modeDirect: "Direct Sale",
        modeClient: "Client Sale",
        stock: "Stock",
        insufficientStock: "Insufficient stock",
        noItems: "No items added yet",
        directPaid: "Paid",
        directDebt: "Debt",
        directPaidStatus: "Paid in full",
        quickAdd: "Quick add",
        addToCart: "Add to cart",
        select: "Select",
        remove: "Remove",
        paidDirectSaleDone: "Paid direct sale completed.",
        directStockError: "Could not complete sale due to stock.",
        requestedExceedsStock: "Requested quantity exceeds stock."
      };
}

function currentProduct(state) {
  return state.products.find((item) => item.id === productInput.value);
}

function saleEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function productImages(product = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  if (images.length) return images;
  const fallback = product.image || product.imageUrl || "";
  return fallback ? [{ id: "legacy-image", imageUrl: fallback, largeUrl: fallback, catalogUrl: fallback, thumbUrl: fallback, isPrimary: true }] : [];
}

function primaryProductImage(product = {}) {
  const images = productImages(product);
  return images.find((image) => image.isPrimary) || images[0] || {};
}

function productImageFor(product = {}, variant = "catalog", index = 0) {
  const images = productImages(product);
  const image = variant === "large" ? (images[index] || images[0] || {}) : primaryProductImage(product);
  if (variant === "thumb") return image.thumbUrl || image.catalogUrl || image.imageUrl || image.url || product.image || product.imageUrl || "";
  if (variant === "large") return image.largeUrl || image.imageUrl || image.url || product.image || product.imageUrl || "";
  return image.catalogUrl || image.imageUrl || image.url || product.image || product.imageUrl || "";
}

function directCatalogImageFor(product = {}) {
  const image = primaryProductImage(product);
  return image.largeUrl || image.imageUrl || image.url || image.catalogUrl || product.image || product.imageUrl || "";
}

function directProductMediaClasses(product = {}, hasImage = false) {
  const identity = [
    product.name,
    product.brand,
    product.category,
    product.categoryName,
    product.type,
    product.sku
  ].filter(Boolean).join(" ").toLowerCase();
  const isDevice = /(iphone|apple|samsung|galaxy|mobile|phone|ipad|ابل|آيفون|ايفون|سامسونج|كالكسي|جالكسي|هاتف|موبايل|جهاز)/i.test(identity);
  return [
    "direct-product-media",
    hasImage ? "" : "is-empty",
    isDevice ? "is-device-photo" : ""
  ].filter(Boolean).join(" ");
}

function classifyDirectCatalogImage(img) {
  const media = img?.closest?.(".direct-product-media, .direct-showcase-media, .direct-quick-media, .direct-cart-thumb");
  if (!media || !img.naturalWidth || !img.naturalHeight) return;
  const ratio = img.naturalWidth / img.naturalHeight;
  media.classList.toggle("is-landscape", ratio > 1.08);
  media.classList.toggle("is-portrait", ratio < 0.92);
  media.classList.toggle("is-tall", ratio < 0.82);
  media.classList.toggle("is-wide", ratio > 1.48);
  media.classList.toggle("is-balanced", ratio >= 0.82 && ratio <= 1.48);
  media.classList.add("has-image");
  try {
    const canvas = document.createElement("canvas");
    const sampleSize = 18;
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(img, 0, 0, sampleSize, sampleSize);
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    let edgeLight = 0;
    let edgeDark = 0;
    let edgeCount = 0;
    let centerContent = 0;
    let centerCount = 0;
    for (let y = 0; y < sampleSize; y += 1) {
      for (let x = 0; x < sampleSize; x += 1) {
        const index = (y * sampleSize + x) * 4;
        const alpha = pixels[index + 3] / 255;
        if (alpha < 0.18) continue;
        const luminance = ((pixels[index] * 0.2126) + (pixels[index + 1] * 0.7152) + (pixels[index + 2] * 0.0722)) / 255;
        const maxChannel = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) / 255;
        const minChannel = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) / 255;
        const saturation = maxChannel ? (maxChannel - minChannel) / maxChannel : 0;
        if (x <= 1 || x >= sampleSize - 2 || y <= 1 || y >= sampleSize - 2) {
          edgeLight += luminance;
          edgeDark += 1 - luminance;
          edgeCount += 1;
        } else if (x >= 4 && x <= sampleSize - 5 && y >= 4 && y <= sampleSize - 5) {
          centerContent += luminance < 0.9 || saturation > 0.12 ? 1 : 0;
          centerCount += 1;
        }
      }
    }
    if (!edgeCount) return;
    const lightScore = edgeLight / edgeCount;
    const darkScore = edgeDark / edgeCount;
    const centerContentScore = centerCount ? centerContent / centerCount : 0;
    media.classList.toggle("is-light-image", lightScore > 0.78);
    media.classList.toggle("is-dark-image", darkScore > 0.62);
    media.classList.toggle("is-padded-product", lightScore > 0.84 && centerContentScore < 0.42);
    media.classList.toggle("is-very-padded-product", lightScore > 0.9 && centerContentScore < 0.24);
  } catch (error) {
    media.classList.add("is-unreadable-image");
  }
}

function classifyLoadedDirectImages(root = document) {
  root.querySelectorAll?.(".direct-product-media img, .direct-showcase-media img, .direct-quick-media img, .direct-cart-thumb img").forEach((img) => {
    if (img.complete && img.naturalWidth) classifyDirectCatalogImage(img);
  });
}

function saleApiFetch(path, options = {}) {
  if (window.ToxApi?.fetch) return window.ToxApi.fetch(path, options);
  const base = window.ToxApi?.baseUrl?.() || `${window.location.origin.includes(":5500") ? "http://127.0.0.1:8765" : ""}/api`;
  return fetch(`${base}${path}`, { credentials: "include", ...options });
}

function isDirectPosView() {
  return currentSalesView() === "pos";
}

function cacheDirectProduct(product, options = {}) {
  if (!product?.id) return null;
  const existing = posProductCache.get(product.id) || {};
  const detailLoaded = Boolean(options.detail || existing._posDetailLoaded || product._posDetailLoaded);
  const merged = { ...existing, ...product, _posDetailLoaded: detailLoaded };
  if (!options.detail && existing._posDetailLoaded) {
    merged.images = Array.isArray(existing.images) ? existing.images : merged.images;
  }
  if (!Array.isArray(merged.units) || !merged.units.length) {
    merged.units = Array.isArray(existing.units) ? existing.units : [];
  }
  posProductCache.set(merged.id, merged);
  return merged;
}

function directProductById(productId, state = ToxStore.getState()) {
  if (!productId) return null;
  return posProductCache.get(productId) || state.products.find((entry) => entry.id === productId) || null;
}

function directWarehouseName(product, state = ToxStore.getState()) {
  return product?.warehouseName || ToxStore.getWarehouseName(product?.warehouseId) || "";
}

function directStockSummary(product) {
  return product?.stockSummary || ToxStore.stockSummary(product);
}

function directProductsApiPath(cursor = "") {
  const params = new URLSearchParams();
  params.set("limit", String(POS_PRODUCT_PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  const query = productSearchInput?.value?.trim() || "";
  const barcode = barcodeSearchInput?.value?.trim() || "";
  const warehouseId = warehouseInput?.value || "all";
  if (query) params.set("q", query);
  if (barcode) params.set("barcode", barcode);
  if (warehouseId && warehouseId !== "all") params.set("warehouseId", warehouseId);
  return `/pos/products/?${params.toString()}`;
}

async function ensureDirectPosApiMode(signal = null) {
  if (directPosApiModeChecked) return;
  directPosApiModeChecked = true;
  try {
    const response = await saleApiFetch("/health/", { signal });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({}));
    directPosApiUnavailable = payload.posProductsApi !== true;
  } catch (error) {
    if (error?.name === "AbortError") {
      directPosApiModeChecked = false;
    } else {
      directPosApiUnavailable = false;
    }
  }
}

function directNormalizeText(value) {
  return String(value || "")
    .replace(/[٠-٩۰-۹]/g, (digit) => "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10)
    .replace(/[\u0640\u200c\u200d]+/g, "")
    .trim()
    .toLowerCase();
}

function directNormalizeBarcode(value) {
  return directNormalizeText(value).replace(/\s+/g, "");
}

function directLegacyProductMatches(product) {
  const units = ToxStore.sellableUnits(product);
  if (!units.length) return false;
  const warehouseId = warehouseInput?.value || "all";
  const query = directNormalizeText(productSearchInput?.value || "");
  const barcode = directNormalizeBarcode(barcodeSearchInput?.value || "");
  const matchesWarehouse = !warehouseId || warehouseId === "all" || product.warehouseId === warehouseId;
  const haystack = directNormalizeText([
    product.name,
    product.brand,
    product.sku,
    product.barcode,
    product.baseUnit,
    product.origin,
    product.originCountry,
    ...units.flatMap((unit) => [unit.name, unit.barcode])
  ].filter(Boolean).join(" "));
  const matchesSearch = !query || haystack.includes(query);
  const matchesBarcode = !barcode || directNormalizeBarcode(product.barcode) === barcode || units.some((unit) => directNormalizeBarcode(unit.barcode) === barcode);
  return matchesWarehouse && matchesSearch && matchesBarcode;
}

async function fetchLegacyDirectProductsPayload(cursor = "", signal = null) {
  if (!directLegacyProductsLoaded) {
    const response = await saleApiFetch("/products/", { signal });
    if (!response.ok) throw new Error(`Legacy POS product fallback failed: ${response.status}`);
    const payload = await response.json();
    directLegacyProductsCache = Array.isArray(payload.products) ? payload.products : [];
    directLegacyProductsLoaded = true;
  }
  const offset = Math.max(0, Number(cursor || 0));
  const barcode = directNormalizeBarcode(barcodeSearchInput?.value || "");
  const products = directLegacyProductsCache
    .filter(directLegacyProductMatches)
    .sort((left, right) => `${left.brand || ""} ${left.name || ""}`.localeCompare(`${right.brand || ""} ${right.name || ""}`, ToxStore.getState().lang));
  const items = products.slice(offset, offset + POS_PRODUCT_PAGE_SIZE).map((product) => cacheDirectProduct(product, { detail: true }));
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < products.length ? String(nextOffset) : "",
    hasMore: nextOffset < products.length,
    totalApprox: products.length,
    exactBarcodeMatch: Boolean(barcode && products.length)
  };
}

async function fetchDirectProductDetail(productId) {
  const existing = directProductById(productId);
  if (!productId || existing?._posDetailLoaded) return existing;
  await ensureDirectPosApiMode();
  if (directPosApiUnavailable) {
    await fetchLegacyDirectProductsPayload();
    const legacyProduct = directProductById(productId);
    if (legacyProduct) return cacheDirectProduct(legacyProduct, { detail: true });
  }
  const response = await saleApiFetch(`/pos/products/${encodeURIComponent(productId)}/`);
  if (response.status === 404) {
    directPosApiUnavailable = true;
    await fetchLegacyDirectProductsPayload();
    const legacyProduct = directProductById(productId);
    if (legacyProduct) return cacheDirectProduct(legacyProduct, { detail: true });
  }
  if (!response.ok) throw new Error(`POS product detail failed: ${response.status}`);
  const product = await response.json();
  return cacheDirectProduct(product, { detail: true });
}

function observeDirectCatalogSentinel() {
  if (!directProductGrid || typeof IntersectionObserver !== "function") return;
  if (directCatalogObserver) {
    directCatalogObserver.disconnect();
    directCatalogObserver = null;
  }
  const sentinel = directProductGrid.querySelector("[data-direct-catalog-sentinel]");
  if (!sentinel || !directCatalogHasMore) return;
  directCatalogObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && directCatalogHasMore && !directCatalogLoading) {
      fetchDirectProducts({ append: true });
    }
  }, { root: directProductGrid, threshold: 0.1 });
  directCatalogObserver.observe(sentinel);
}

async function fetchDirectProducts(options = {}) {
  if (!directProductGrid || !isDirectPosView()) return;
  const append = options.append === true;
  const reset = options.reset === true || !append;
  if (directCatalogLoading && append) return;
  if (reset && directCatalogAbort) directCatalogAbort.abort();
  const requestId = ++directCatalogRequestId;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  directCatalogAbort = controller;
  directCatalogLoading = true;
  if (reset) {
    directCatalogItems = [];
    directCatalogNextCursor = "";
    directCatalogHasMore = false;
    renderDirectProducts(ToxStore.getState(), { loading: true });
  }
  try {
    await ensureDirectPosApiMode(controller?.signal);
    let payload = null;
    if (directPosApiUnavailable) {
      payload = await fetchLegacyDirectProductsPayload(append ? directCatalogNextCursor : "", controller?.signal);
    } else {
      const response = await saleApiFetch(directProductsApiPath(append ? directCatalogNextCursor : ""), {
        signal: controller?.signal
      });
      if (response.status === 404) {
        directPosApiUnavailable = true;
        payload = await fetchLegacyDirectProductsPayload(append ? directCatalogNextCursor : "", controller?.signal);
      } else {
        if (!response.ok) throw new Error(`POS product search failed: ${response.status}`);
        payload = await response.json();
      }
    }
    if (requestId !== directCatalogRequestId) return;
    const incoming = Array.isArray(payload.items) ? payload.items.map((product) => cacheDirectProduct(product)).filter(Boolean) : [];
    const byId = new Map((append ? directCatalogItems : []).map((product) => [product.id, product]));
    incoming.forEach((product) => byId.set(product.id, product));
    directCatalogItems = Array.from(byId.values());
    directCatalogNextCursor = payload.nextCursor || "";
    directCatalogHasMore = Boolean(payload.hasMore && directCatalogNextCursor);
    directCatalogTotalApprox = Number(payload.totalApprox || directCatalogItems.length);
    const firstProduct = incoming[0] || directCatalogItems[0] || null;
    const selectedExists = selectedDirectProductId && directProductById(selectedDirectProductId);
    if ((payload.exactBarcodeMatch || reset && !selectedExists) && firstProduct) {
      await selectDirectProduct(firstProduct.id, ToxStore.getState(), { restartShowcase: true });
    } else {
      renderDirectProducts(ToxStore.getState(), { restartShowcase: false });
      renderDirectShowcase(ToxStore.getState());
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("POS product search failed", error);
      window.showNotice?.(ToxStore.getState().lang === "ar" ? "تعذر تحميل منتجات نقطة البيع." : "Could not load POS products.", "error");
    }
  } finally {
    if (requestId === directCatalogRequestId) {
      directCatalogLoading = false;
      renderDirectProducts(ToxStore.getState(), { restartShowcase: false });
    }
  }
}

function scheduleDirectProductsFetch(reset = true) {
  clearTimeout(directCatalogSearchTimer);
  directCatalogSearchTimer = window.setTimeout(() => fetchDirectProducts({ reset }), 180);
}

async function refreshDirectProductsAfterSale() {
  if (!isDirectPosView()) return;
  if (selectedDirectProductId && posProductCache.has(selectedDirectProductId)) {
    const cached = posProductCache.get(selectedDirectProductId);
    posProductCache.set(selectedDirectProductId, { ...cached, _posDetailLoaded: false });
  }
  await fetchDirectProducts({ reset: true });
}

async function refreshDirectProductAfterInventoryUpdate(productId) {
  if (!productId || !isDirectPosView()) return;
  posProductCache.delete(productId);
  directLegacyProductsLoaded = false;
  directLegacyProductsCache = [];
  const index = directCatalogItems.findIndex((product) => product.id === productId);
  try {
    const product = await fetchDirectProductDetail(productId);
    if (product && index >= 0) {
      directCatalogItems[index] = product;
    }
  } catch (error) {
    if (index >= 0) directCatalogItems.splice(index, 1);
  }
  renderDirectProducts(ToxStore.getState(), { restartShowcase: selectedDirectProductId === productId });
  renderDirectShowcase(ToxStore.getState());
}

function saleBackendErrorDetail(error, state = ToxStore.getState()) {
  const ar = state.lang === "ar";
  const payload = error?.payload || {};
  const reason = payload.reason || "";
  if (["SUBTOTAL_MISMATCH", "TOTAL_MISMATCH", "LINE_TOTAL_MISMATCH"].includes(reason)) {
    const details = payload.details || {};
    const expected = ToxStore.formatMoney(Number(details.expectedUsd || 0), state.currency);
    const provided = ToxStore.formatMoney(Number(details.providedUsd || 0), state.currency);
    const difference = ToxStore.formatMoney(Math.abs(Number(details.differenceUsd || 0)), state.currency);
    return ar
      ? `يوجد فرق في حساب الفاتورة. المفروض ${expected}، والمرسل ${provided}، والفرق ${difference}. حدّث الصفحة أو راجع سعر الصرف ثم حاول مرة ثانية.`
      : `Invoice totals do not match. Expected ${expected}, sent ${provided}, difference ${difference}. Refresh or review the exchange rate, then try again.`;
  }
  if (reason === "MISSING_PURCHASE_COST") {
    const product = payload.details?.productName || payload.details?.productId || "";
    return ar
      ? `\u0623\u062f\u062e\u0644 \u0633\u0639\u0631 \u0634\u0631\u0627\u0621 \u0644\u0644\u0645\u0646\u062a\u062c${product ? ` (${product})` : ""} \u062d\u062a\u0649 \u064a\u062d\u0633\u0628 \u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u0631\u0628\u062d \u0648\u064a\u062d\u0641\u0638 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629.`
      : `Enter a purchase cost for the product${product ? ` (${product})` : ""} so profit can be calculated and the invoice can be saved.`;
  }
  if (reason === "INSUFFICIENT_COST_BATCH") {
    return ar
      ? "\u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0645\u0648\u062c\u0648\u062f \u0644\u0643\u0646 \u062f\u0641\u0639\u0627\u062a \u0627\u0644\u0643\u0644\u0641\u0629 \u0646\u0627\u0642\u0635\u0629. \u0631\u0645\u0645 \u0643\u0644\u0641\u0629 \u0627\u0644\u0645\u0646\u062a\u062c \u0645\u0646 \u0633\u0639\u0631 \u0627\u0644\u0634\u0631\u0627\u0621 \u062b\u0645 \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u062b\u0627\u0646\u064a\u0629."
      : "Stock exists, but FIFO cost batches are missing. Repair the product cost from the purchase cost, then try again.";
  }
  if (reason === "INSUFFICIENT_STOCK") {
    return ar
      ? "\u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u062a\u0627\u062d."
      : "The requested quantity is greater than the available stock.";
  }
  if (reason === "INVALID_WHOLE_QUANTITY") {
    return ar ? "هذه الوحدة تباع بعدد صحيح فقط (مثال: 1، 2، 3). اختر وحدة وزن/قياس إذا كنت تحتاج كسورًا." : "This unit is sold as whole quantities only. Choose a measured unit for fractions.";
  }
  return payload.message || reason || error?.message || "";
}

function directSaleSaveErrorMessage(error, state = ToxStore.getState()) {
  const ar = state.lang === "ar";
  const detail = saleBackendErrorDetail(error, state);
  return ar
    ? `\u0644\u0645 \u064a\u0643\u062a\u0645\u0644 \u062d\u0641\u0638 \u0627\u0644\u0628\u064a\u0639 \u0627\u0644\u0645\u0628\u0627\u0634\u0631 \u0641\u064a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a${detail ? `: ${detail}` : ""}. \u0628\u0642\u064a \u0645\u062d\u0641\u0648\u0638\u0627\u064b \u0645\u062d\u0644\u064a\u0627\u064b.`
    : `Direct sale was not saved to the database${detail ? `: ${detail}` : ""}. It remains saved locally.`;
}

function invoiceSaveErrorMessage(error, state = ToxStore.getState()) {
  const ar = state.lang === "ar";
  {
    const detail = saleBackendErrorDetail(error, state);
    return ar
      ? `\u0641\u0634\u0644 \u062d\u0641\u0638 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0641\u064a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a${detail ? `: ${detail}` : ""}. \u0644\u0645 \u064a\u062a\u0645 \u0625\u0646\u0647\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629.`
      : `Invoice was not saved to the database${detail ? `: ${detail}` : ""}. Checkout was not completed.`;
  }
}

async function saveInvoiceToBackend(payload) {
  const response = await saleApiFetch("/invoices/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = result?.reason || result?.message || "";
    const error = new Error(`Invoice save failed: ${response.status}${reason ? ` (${reason})` : ""}`);
    error.payload = result;
    error.status = response.status;
    throw error;
  }
  return result.invoice || result;
}

const saveDirectInvoiceToBackend = saveInvoiceToBackend;

function saleDocumentKey(prefix = "INV") {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

function cartLinePriceLock(product, unit, priceUsd, currency) {
  return {
    priceLockedUsd: priceUsd,
    priceLock: {
      productId: product?.id || "",
      unitId: unit?.id || "",
      currency,
      priceUsd,
      lockedAt: new Date().toISOString(),
      source: "product"
    }
  };
}

function renderSaleProductPreview(state = ToxStore.getState()) {
  if (!saleProductPreview) return;
  const product = currentProduct(state);
  const unit = currentUnit(product);
  if (!product) {
    saleProductPreview.hidden = true;
    saleProductPreview.innerHTML = "";
    return;
  }
  const image = productImageFor(product, "thumb");
  const title = [product.brand, product.name].filter(Boolean).join(" - ") || product.name || "-";
  const meta = [
    unit ? localizedUnitName(unit, state.lang) : "",
    ToxStore.formatProductMoney(product, unit?.priceUsd || 0),
    ToxStore.stockSummary(product)
  ].filter(Boolean).join(" | ");
  saleProductPreview.hidden = false;
  saleProductPreview.innerHTML = `
    <span class="product-choice-thumb ${image ? "" : "is-empty"}">
      ${image ? `<img src="${saleEscape(image)}" alt="" />` : `<b>${saleEscape((product.name || "TOX").slice(0, 2))}</b>`}
    </span>
    <span class="product-choice-copy">
      <strong>${saleEscape(title)}</strong>
      <small>${saleEscape(meta)}</small>
    </span>
  `;
}

function filteredProducts(state) {
  const warehouseId = warehouseInput.value;
  const query = productSearchInput.value.trim().toLowerCase();
  const barcodeQuery = barcodeSearchInput.value.trim();
  const exactBarcodeProducts = barcodeQuery ? ToxStore.exactBarcodeProductMatches(barcodeQuery) : null;
  return state.products
    .filter((product) => {
      const units = ToxStore.sellableUnits(product);
      if (!units.length) return false;
      const matchesWarehouse = !warehouseId || warehouseId === "all" || product.warehouseId === warehouseId;
      const matchesSearch = !query || `${product.name} ${product.brand || ""} ${product.baseUnit} ${units.map((unit) => unit.name).join(" ")}`.toLowerCase().includes(query);
      const matchesBarcode = !barcodeQuery || exactBarcodeProducts.some((entry) => entry.id === product.id);
      return matchesWarehouse && matchesSearch && matchesBarcode;
    })
    .sort((left, right) => `${left.brand || ""} ${left.name}`.localeCompare(`${right.brand || ""} ${right.name}`, state.lang));
}

function currentUnit(product) {
  const units = ToxStore.sellableUnits(product);
  return units.find((unit) => unit.id === unitInput.value) || units[0];
}

function productSaleLabel(product, state, unitId = "") {
  const units = ToxStore.sellableUnits(product);
  const unit = units.find((entry) => entry.id === unitId) || units[0];
  const price = unit ? ` - ${ToxStore.formatProductMoney(product, unit.priceUsd)}` : "";
  const unitName = unit ? ` | ${localizedUnitName(unit, state.lang)}` : "";
  return `${[product.brand, product.name].filter(Boolean).join(" - ")}${unitName} - ${ToxStore.getWarehouseName(product.warehouseId)}${price}`;
}

function cartLineFromProduct(product, unit, qty = 1) {
  const quantity = normalizeSaleQuantity(product, unit, qty);
  const qtyInBase = ToxStore.quantityInBase(product, quantity, unit.id);
  const currency = ToxStore.productCurrency(product);
  const priceUsd = moneyUsdForCurrency(unit.priceUsd, currency);
  const totalUsd = saleLineTotalUsd({ qty: quantity, priceUsd, currency });
  return {
    productId: product.id,
    warehouseId: product.warehouseId,
    warehouseName: directWarehouseName(product),
    name: product.name,
    brand: product.brand || "",
    imageUrl: productImageFor(product, "thumb"),
    catalogUrl: productImageFor(product, "catalog"),
    thumbUrl: productImageFor(product, "thumb"),
    qty: quantity,
    qtyInBase,
    unit: unit.id,
    unitId: unit.id,
    unitName: unit.name,
    currency,
    price: ToxStore.convertUsd(priceUsd, currency),
    priceCurrency: currency,
    priceUsd,
    lineDiscountPercent: 0,
    lineDiscountUsd: 0,
    lineTotal: ToxStore.convertUsd(totalUsd, currency),
    totalUsd,
    ...cartLinePriceLock(product, unit, priceUsd, currency)
  };
}

function saleUnitQuantityConfig(product, unit) {
  const text = [product?.baseUnit, product?.kind, product?.type, unit?.name, unit?.id]
    .filter(Boolean).join(" ").toLowerCase();
  // Retail packs/pieces are counted items. Fractions remain available only
  // for explicitly measurable goods (weight, liquid, length).
  const measurable = /(kg|كغم|كيلو|gram|غرام|g\b|liter|لتر|ml|مليلتر|meter|متر|cm|سم|وزن|سائل)/i.test(text);
  const integer = !measurable;
  return { min: integer ? 1 : 0.01, step: integer ? 1 : 0.01, integer };
}

function normalizeSaleQuantity(product, unit, value) {
  const config = saleUnitQuantityConfig(product, unit);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return config.min;
  return config.integer ? Math.max(config.min, Math.round(numeric)) : Math.max(config.min, numeric);
}

function invoiceLineHasMoneyValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function inferredInvoiceLineRate(item, currency, fallbackRate) {
  if (String(currency || "").toUpperCase() !== "IQD") return fallbackRate;
  const lineTotal = Number(item.lineTotal ?? item.total ?? item.amount);
  const totalUsd = Number(item.totalUsd);
  if (!Number.isFinite(lineTotal) || lineTotal <= 0 || !Number.isFinite(totalUsd) || totalUsd <= 0) {
    return fallbackRate;
  }
  return lineTotal / totalUsd;
}

function normalizeInvoiceItemsForBackend(items, state = ToxStore.getState()) {
  const invoiceCurrency = state.currency || "IQD";
  const exchangeRate = state.exchangeRate || 1460;
  return (items || []).map((item) => {
    const currency = item.currency || item.priceCurrency || invoiceCurrency;
    const lineRate = item.exchangeRate || item.rate || inferredInvoiceLineRate(item, currency, exchangeRate);
    const normalized = {
      ...item,
      currency,
      priceCurrency: item.priceCurrency || item.currency || invoiceCurrency,
      exchangeRate: lineRate,
      unitId: item.unitId || item.unit || "",
      unit: item.unit || item.unitId || "",
      unitName: item.unitName || ""
    };
    if (invoiceLineHasMoneyValue(normalized.lineTotal) && invoiceLineHasMoneyValue(normalized.totalUsd)) {
      const lineTotal = Math.round(Number(normalized.lineTotal));
      normalized.lineTotal = lineTotal;
      normalized.totalUsd = currency === "IQD" ? lineTotal / lineRate : lineTotal;
    }
    return normalized;
  });
}

function mergeBackendInvoiceItems(localItems, backendItems) {
  const backendRows = Array.isArray(backendItems) ? backendItems : [];
  return (localItems || []).map((localItem, index) => {
    const backendItem = backendRows[index] || backendRows.find((item) => (
      item.productId === localItem.productId
      && (item.unitId || "") === (localItem.unitId || localItem.unit || "")
      && Number(item.qty ?? item.quantity ?? 0) === Number(localItem.qty ?? localItem.quantity ?? 0)
    ));
    if (!backendItem) return localItem;
    return {
      ...localItem,
      ...backendItem,
      name: localItem.name || backendItem.productName || "",
      brand: localItem.brand || backendItem.productBrand || "",
      unit: localItem.unit || backendItem.unitId || "",
      unitId: backendItem.unitId || localItem.unitId || localItem.unit || "",
      unitName: backendItem.unitName || localItem.unitName || "",
      warehouseId: backendItem.warehouseId || localItem.warehouseId || "",
      qty: backendItem.qty ?? backendItem.quantity ?? localItem.qty,
      quantity: backendItem.quantity ?? backendItem.qty ?? localItem.quantity ?? localItem.qty,
      qtyInBase: backendItem.qtyInBase ?? localItem.qtyInBase,
      priceUsd: backendItem.priceUsd ?? localItem.priceUsd,
      totalUsd: backendItem.totalUsd ?? localItem.totalUsd,
      unitCostUsd: backendItem.unitCostUsd ?? localItem.unitCostUsd ?? 0,
      totalCostUsd: backendItem.totalCostUsd ?? localItem.totalCostUsd ?? 0,
      grossProfitUsd: backendItem.grossProfitUsd ?? localItem.grossProfitUsd ?? 0,
      costStatus: backendItem.costStatus || localItem.costStatus || "",
      costBreakdown: Array.isArray(backendItem.costBreakdown) ? backendItem.costBreakdown : (localItem.costBreakdown || []),
      currency: localItem.currency,
      priceCurrency: localItem.priceCurrency
    };
  });
}

function uniqueSafeUnitForCartItem(product, item) {
  const units = product?.units || [];
  const currentId = item.unitId || item.unit || "";
  const exact = units.find((unit) => unit.id === currentId);
  if (exact) return exact;
  const name = String(item.unitName || "").trim();
  const nameMatches = name ? units.filter((unit) => String(unit.name || "").trim() === name) : [];
  if (nameMatches.length === 1) return nameMatches[0];
  return units.length === 1 ? units[0] : null;
}

function cartLinePriceStatus(item, state = ToxStore.getState()) {
  const product = directProductById(item.productId, state);
  const unit = uniqueSafeUnitForCartItem(product, item);
  const currency = item.currency || item.priceCurrency || ToxStore.productCurrency(product) || state.currency;
  const currentPriceUsd = unit ? moneyUsdForCurrency(unit.priceUsd || 0, currency) : Number(item.priceUsd || 0);
  const lockedPriceUsd = Number(item.priceLockedUsd ?? item.priceUsd ?? 0);
  return {
    product,
    unit,
    currency,
    currentPriceUsd,
    lockedPriceUsd,
    changed: Math.abs(currentPriceUsd - lockedPriceUsd) > 0.0001
  };
}

function refreshCartLinePrice(index, state = ToxStore.getState()) {
  const item = cart[index];
  if (!item) return false;
  const status = cartLinePriceStatus(item, state);
  if (!status.unit) return false;
  const discountPercent = Number(item.lineDiscountPercent || 0);
  const totalUsd = saleLineTotalUsd({
    qty: item.qty,
    priceUsd: status.currentPriceUsd,
    discountPercent,
    currency: status.currency
  });
  cart[index] = {
    ...item,
    unit: status.unit.id,
    unitId: status.unit.id,
    unitName: status.unit.name,
    currency: status.currency,
    price: ToxStore.convertUsd(status.currentPriceUsd, status.currency),
    priceCurrency: status.currency,
    priceUsd: status.currentPriceUsd,
    lineTotal: ToxStore.convertUsd(totalUsd, status.currency),
    totalUsd,
    ...cartLinePriceLock(status.product, status.unit, status.currentPriceUsd, status.currency)
  };
  return true;
}

async function refreshAndRepairInvoiceCart(error) {
  const reason = error?.payload?.reason || "";
  if (!["NO_UNIT", "NO_PRODUCT"].includes(reason) || !window.ToxStore?.refreshFromBackend) return false;
  if (isDirectPosView()) {
    await Promise.all(cart.map((item) => fetchDirectProductDetail(item.productId).catch(() => null)));
  } else {
    await window.ToxStore.refreshFromBackend({ scope: "full" });
  }
  const state = ToxStore.getState();
  let repaired = false;
  for (const item of cart) {
    const product = directProductById(item.productId, state);
    if (!product) return false;
    const unit = uniqueSafeUnitForCartItem(product, item);
    if (!unit) return false;
    if ((item.unitId || item.unit) !== unit.id || item.unitName !== unit.name) repaired = true;
    item.unit = unit.id;
    item.unitId = unit.id;
    item.unitName = unit.name;
    item.qtyInBase = ToxStore.quantityInBase(product, item.qty, unit.id);
    item.priceUsd = item.priceUsd || unit.priceUsd;
    if (item.priceLockedUsd === undefined) {
      Object.assign(item, cartLinePriceLock(product, unit, item.priceUsd, item.currency || ToxStore.productCurrency(product)));
    }
  }
  if (repaired) recalc(state);
  return repaired;
}

function directCartTotal() {
  return cart.reduce((sum, item) => sum + Number(item.totalUsd || 0), 0);
}

function directCustomerLabel(state) {
  if (directCustomerMode === "client") {
    return directPosClientSelect?.selectedOptions?.[0]?.textContent || t("client", state.lang);
  }
  return directPosCustomerInput?.value?.trim() || saleDict(state.lang).guestCustomer;
}

function setDirectCustomerMode(nextMode) {
  directCustomerMode = nextMode === "client" ? "client" : "guest";
  directCustomerModeButtons.forEach((button) => {
    const active = button.dataset.directCustomerMode === directCustomerMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  directPosGuestField?.classList.toggle("hidden", directCustomerMode !== "guest");
  directPosClientField?.classList.toggle("hidden", directCustomerMode !== "client");
}

function addProductToDirectCart(productId, unitId = "", qty = 1, source = null) {
  const state = ToxStore.getState();
  const dict = saleDict(state.lang);
  const product = directProductById(productId, state);
  const units = ToxStore.sellableUnits(product);
  const unit = units.find((entry) => entry.id === unitId) || units[0];
  if (!product || !unit) return false;
  const line = cartLineFromProduct(product, unit, qty);
  if (line.qtyInBase + cartQtyInBase(product.id) > ToxStore.stockBaseQuantity(product)) {
    previewMeta.textContent = `${t("saleBlocked", state.lang)} | ${dict.insufficientStock}: ${ToxStore.stockSummary(product)}`;
    previewMeta.classList.add("danger-text");
    window.showNotice?.(dict.insufficientStock, "error");
    playUiSound("error");
    return false;
  }
  cart.push(line);
  previewMeta.classList.remove("danger-text");
  recalc(state);
  animateMagneticAdd(source);
  playUiSound("success");
  return true;
}

function updateDirectCartLine(index, patch = {}) {
  const state = ToxStore.getState();
  const existing = cart[index];
  const product = directProductById(existing?.productId, state);
  if (!existing || !product) return;
  const units = ToxStore.sellableUnits(product);
  const unit = units.find((entry) => entry.id === (patch.unit || existing.unit)) || units[0];
  const qty = normalizeSaleQuantity(product, unit, patch.qty ?? existing.qty ?? 1);
  const unitChanged = patch.unit !== undefined && patch.unit !== existing.unit;
  const currency = existing.currency || ToxStore.productCurrency(product);
  const priceUsd = unitChanged ? moneyUsdForCurrency(unit.priceUsd, currency) : Number(existing.priceUsd || 0);
  const totalUsd = saleLineTotalUsd({
    qty,
    priceUsd,
    discountPercent: Number(existing.lineDiscountPercent || 0),
    currency
  });
  const next = {
    ...existing,
    qty,
    qtyInBase: ToxStore.quantityInBase(product, qty, unit.id),
    unit: unit.id,
    unitId: unit.id,
    unitName: unit.name,
    currency,
    price: ToxStore.convertUsd(priceUsd, currency),
    priceCurrency: currency,
    priceUsd,
    lineTotal: ToxStore.convertUsd(totalUsd, currency),
    totalUsd,
    ...(unitChanged ? cartLinePriceLock(product, unit, priceUsd, currency) : {})
  };
  const otherQty = cart
    .filter((item, itemIndex) => itemIndex !== index && item.productId === product.id)
    .reduce((sum, item) => sum + Number(item.qtyInBase || 0), 0);
  if (next.qtyInBase + otherQty > ToxStore.stockBaseQuantity(product)) {
    window.showNotice?.(saleDict(state.lang).requestedExceedsStock, "error");
    playUiSound("error");
    renderDirectCart(state);
    return;
  }
  cart[index] = next;
  recalc(state);
  playUiSound("select");
}

function directProductTitle(product) {
  return [product?.brand, product?.name].filter(Boolean).join(" - ") || product?.name || "-";
}

function stopDirectShowcaseAuto() {
  clearInterval(directShowcaseTimer);
  directShowcaseTimer = 0;
}

async function selectDirectProduct(productId, state = ToxStore.getState(), options = {}) {
  let product = directProductById(productId, state);
  if (isDirectPosView() && product && !product._posDetailLoaded) {
    product = await fetchDirectProductDetail(product.id).catch(() => product);
  }
  const units = ToxStore.sellableUnits(product);
  if (!product || !units.length) return;
  const previousProductId = selectedDirectProductId;
  if (previousProductId) directQtyByProduct.set(previousProductId, selectedDirectQty);
  const changedProduct = previousProductId !== product.id;
  selectedDirectProductId = product.id;
  if (changedProduct) directShowcaseImageIndex = 0;
  if (!units.some((unit) => unit.id === selectedDirectUnitId)) selectedDirectUnitId = units[0].id;
  selectedDirectQty = normalizeSaleQuantity(product, units.find((entry) => entry.id === selectedDirectUnitId) || units[0], directQtyByProduct.get(product.id) ?? (changedProduct ? 1 : selectedDirectQty));
  directQtyByProduct.set(product.id, selectedDirectQty);
  renderDirectProducts(state, { restartShowcase: options.restartShowcase ?? changedProduct });
  if (options.silent !== true) playUiSound("select");
}

function scheduleDirectShowcaseAuto(state = ToxStore.getState()) {
  stopDirectShowcaseAuto();
  const product = directProductById(selectedDirectProductId, state);
  const images = productImages(product);
  if (!product || images.length <= 1) return;
  directShowcaseTimer = setInterval(() => {
    const latestState = ToxStore.getState();
    const latestProduct = directProductById(selectedDirectProductId, latestState);
    const latestImages = productImages(latestProduct);
    if (!latestProduct || latestImages.length <= 1) {
      stopDirectShowcaseAuto();
      return;
    }
    directShowcaseImageIndex = (directShowcaseImageIndex + 1) % latestImages.length;
    renderDirectShowcase(latestState);
  }, 2000);
}

function renderDirectShowcase(state = ToxStore.getState(), options = {}) {
  if (!directProductShowcase) return;
  const dict = saleDict(state.lang);
  const product = directProductById(selectedDirectProductId, state);
  const units = ToxStore.sellableUnits(product);
  if (!product || !units.length) {
    stopDirectShowcaseAuto();
    directProductShowcase.innerHTML = `<div class="direct-showcase-empty">${saleEscape(dict.noProduct)}</div>`;
    return;
  }
  const unit = units.find((entry) => entry.id === selectedDirectUnitId) || units[0];
  selectedDirectUnitId = unit.id;
  const images = productImages(product);
  directShowcaseImageIndex = Math.min(Math.max(0, directShowcaseImageIndex), Math.max(0, images.length - 1));
  const imageUrl = productImageFor(product, "large", directShowcaseImageIndex);
  const unitMultiplier = Math.max(0.0001, Number(unit.multiplier || 1));
  const remainingBase = Math.max(0, ToxStore.stockBaseQuantity(product) - cartQtyInBase(product.id));
  const maxQty = Math.max(0, remainingBase / unitMultiplier);
  const qty = Math.min(Math.max(0.01, Number(selectedDirectQty || 1)), Math.max(0.01, maxQty || 0.01));
  selectedDirectQty = normalizeSaleQuantity(product, unit, qty);
  directQtyByProduct.set(product.id, selectedDirectQty);
  const barcode = unit.barcode || product.barcode || "-";
  const disabled = remainingBase <= 0;
  directProductShowcase.innerHTML = `
    <article class="direct-showcase-card ${disabled ? "is-disabled" : ""}">
      <div class="direct-showcase-media ${imageUrl ? "" : "is-empty"}">
        ${imageUrl ? `<img src="${saleEscape(imageUrl)}" alt="" loading="eager" decoding="async" fetchpriority="high" />` : `<span>${saleEscape((product.name || "TOX").slice(0, 2))}</span>`}
        ${images.length > 1 ? `
          <button class="direct-showcase-arrow prev" type="button" data-showcase-image-step="-1">‹</button>
          <button class="direct-showcase-arrow next" type="button" data-showcase-image-step="1">›</button>
          <div class="direct-showcase-counter">${directShowcaseImageIndex + 1}/${images.length}</div>
        ` : ""}
      </div>
      <div class="direct-showcase-info">
        <span class="direct-showcase-kicker">${saleEscape(directWarehouseName(product, state))}</span>
        <h2>${saleEscape(directProductTitle(product))}</h2>
        <strong class="direct-showcase-price">${saleEscape(ToxStore.formatProductMoney(product, unit.priceUsd))}</strong>
        <p>${saleEscape([product.brand, localizedUnitName(unit, state.lang), ToxStore.productKindLabel?.(product, state.lang)].filter(Boolean).join(" | "))}</p>
        <div class="direct-showcase-facts">
          <span>${saleEscape(dict.stock)}: <b>${saleEscape(directStockSummary(product))}</b></span>
          <span>${saleEscape(t("barcode", state.lang))}: <b>${saleEscape(barcode)}</b></span>
        </div>
        <div class="direct-showcase-controls">
          <select data-showcase-unit>
            ${units.map((entry) => `<option value="${saleEscape(entry.id)}" ${entry.id === unit.id ? "selected" : ""}>${saleEscape(localizedUnitName(entry, state.lang))}</option>`).join("")}
          </select>
          <input type="number" min="${saleUnitQuantityConfig(product, unit).min}" step="${saleUnitQuantityConfig(product, unit).step}" max="${saleEscape(maxQty || 0)}" value="${saleEscape(qty)}" data-showcase-qty ${disabled ? "disabled" : ""} />
          <button class="button primary" type="button" data-showcase-add ${disabled ? "disabled" : ""}>${dict.addToCart}</button>
          <button class="button ghost" type="button" data-showcase-details>عرض التفاصيل</button>
        </div>
        ${images.length > 1 ? `<div class="direct-showcase-dots">
          ${images.map((image, index) => `<button type="button" class="${index === directShowcaseImageIndex ? "active" : ""}" data-showcase-dot="${index}" aria-label="${index + 1}"></button>`).join("")}
        </div>` : ""}
      </div>
    </article>
  `;
  window.enhanceCustomSelects?.(directProductShowcase);
  classifyLoadedDirectImages(directProductShowcase);
  if (options.restartTimer) scheduleDirectShowcaseAuto(state);
}

function renderDirectQuickAdd(state = ToxStore.getState()) {
  if (!directQuickAdd) return;
  if (currentSalesView() === "pos") {
    directQuickAdd.hidden = true;
    directQuickAdd.innerHTML = "";
    return;
  }
  const dict = saleDict(state.lang);
  const product = directProductById(selectedDirectProductId, state);
  const units = ToxStore.sellableUnits(product);
  if (!product || !units.length) {
    directQuickAdd.hidden = true;
    directQuickAdd.innerHTML = "";
    return;
  }
  const unit = units.find((entry) => entry.id === selectedDirectUnitId) || units[0];
  selectedDirectUnitId = unit.id;
  const unitMultiplier = Math.max(0.0001, Number(unit.multiplier || 1));
  const remainingBase = Math.max(0, ToxStore.stockBaseQuantity(product) - cartQtyInBase(product.id));
  const maxQty = Math.max(0, remainingBase / unitMultiplier);
  const qty = Math.min(Math.max(0.01, Number(selectedDirectQty || 1)), Math.max(0.01, maxQty || 0.01));
  selectedDirectQty = normalizeSaleQuantity(product, unit, qty);
  directQtyByProduct.set(product.id, selectedDirectQty);
  const image = productImageFor(product, "catalog");
  const title = directProductTitle(product);
  const total = qty * Number(unit.priceUsd || 0);
  const disabled = remainingBase <= 0;
  directQuickAdd.hidden = false;
  directQuickAdd.innerHTML = `
    <article class="direct-quick-card ${disabled ? "is-disabled" : ""}">
      <div class="direct-quick-media ${image ? "" : "is-empty"}">
        ${image ? `<img src="${saleEscape(image)}" alt="" loading="lazy" decoding="async" />` : `<span>${saleEscape((product.name || "TOX").slice(0, 2))}</span>`}
      </div>
      <div class="direct-quick-main">
        <div class="direct-quick-title">
          <span>${dict.quickAdd}</span>
          <strong title="${saleEscape(title)}">${saleEscape(title)}</strong>
          <small>${saleEscape(ToxStore.getWarehouseName(product.warehouseId))} | ${saleEscape(ToxStore.stockSummary(product))}</small>
        </div>
        <div class="direct-quick-controls">
          <label class="field">
            <span>${t("unit", state.lang)}</span>
            <select data-direct-quick-unit>
              ${units.map((entry) => `<option value="${saleEscape(entry.id)}" ${entry.id === unit.id ? "selected" : ""}>${saleEscape(localizedUnitName(entry, state.lang))} | ${saleEscape(ToxStore.formatProductMoney(product, entry.priceUsd))}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>${t("qty", state.lang)}</span>
            <div class="direct-qty-stepper">
              <button class="icon-button" type="button" data-direct-quick-step="-1" ${disabled ? "disabled" : ""}>-</button>
              <input type="number" min="${saleUnitQuantityConfig(product, unit).min}" step="${saleUnitQuantityConfig(product, unit).step}" max="${saleEscape(maxQty || 0)}" value="${saleEscape(qty)}" data-direct-quick-qty ${disabled ? "disabled" : ""} />
              <button class="icon-button" type="button" data-direct-quick-step="1" ${disabled ? "disabled" : ""}>+</button>
            </div>
          </label>
        </div>
      </div>
      <div class="direct-quick-side">
        <span>${t("total", state.lang)}</span>
        <strong>${saleEscape(ToxStore.formatMoney(total, ToxStore.productCurrency(product) || state.currency))}</strong>
        <button class="button primary" type="button" data-direct-quick-submit ${disabled ? "disabled" : ""}>${dict.addToCart}</button>
      </div>
    </article>
  `;
  window.enhanceCustomSelects?.(directQuickAdd);
  classifyLoadedDirectImages(directQuickAdd);
}

function renderDirectProducts(state = ToxStore.getState(), options = {}) {
  if (!directProductGrid) return;
  const dict = saleDict(state.lang);
  const posMode = isDirectPosView();
  const products = posMode ? directCatalogItems : filteredProducts(state);
  const previousProductId = selectedDirectProductId;
  if (directPosCount) directPosCount.textContent = posMode ? (directCatalogTotalApprox || products.length) : products.length;
  if (selectedDirectProductId && !products.some((product) => product.id === selectedDirectProductId)) {
    if (!posMode || !directProductById(selectedDirectProductId, state)) {
      selectedDirectProductId = "";
      selectedDirectUnitId = "";
    }
  }
  if (!selectedDirectProductId && products.length) {
    selectedDirectProductId = products[0].id;
    selectedDirectUnitId = ToxStore.sellableUnits(products[0])[0]?.id || "";
    directShowcaseImageIndex = 0;
  }
  const selectionChanged = options.restartShowcase || previousProductId !== selectedDirectProductId;
  directProductGrid.innerHTML = products.length ? products.map((product) => {
    const units = ToxStore.sellableUnits(product);
    const unit = units[0];
    const image = directCatalogImageFor(product);
    const title = directProductTitle(product);
    const remainingBase = ToxStore.stockBaseQuantity(product) - cartQtyInBase(product.id);
    const disabled = !unit || remainingBase <= 0;
    return `
      <article class="direct-product-card ${disabled ? "is-disabled" : ""} ${selectedDirectProductId === product.id ? "is-selected" : ""}" data-direct-add-product="${saleEscape(product.id)}">
        <div class="${saleEscape(directProductMediaClasses(product, Boolean(image)))}">
          ${image ? `<img src="${saleEscape(image)}" alt="" loading="lazy" decoding="async" />` : `<span>${saleEscape((product.name || "TOX").slice(0, 2))}</span>`}
        </div>
        <div class="direct-product-copy">
          <strong title="${saleEscape(title)}">${saleEscape(title)}</strong>
          <small>${saleEscape(directWarehouseName(product, state))}</small>
          <span>${saleEscape(unit ? localizedUnitName(unit, state.lang) : "-")} | ${saleEscape(unit ? ToxStore.formatProductMoney(product, unit.priceUsd) : "-")}</span>
          <em>${saleEscape(directStockSummary(product))}</em>
        </div>
        <button class="button primary compact-action" type="button" ${disabled ? "disabled" : ""}>${dict.select}</button>
      </article>
    `;
  }).join("") : `<div class="warehouse-empty">${options.loading || directCatalogLoading ? "جاري تحميل المنتجات..." : saleDict(state.lang).noProduct}</div>`;
  if (posMode && products.length) {
    directProductGrid.insertAdjacentHTML("beforeend", `
      <div class="direct-catalog-sentinel" data-direct-catalog-sentinel>
        ${directCatalogLoading ? "جاري تحميل المزيد..." : directCatalogHasMore ? "تحميل المزيد" : ""}
      </div>
    `);
    observeDirectCatalogSentinel();
  }
  renderDirectQuickAdd(state);
  renderDirectShowcase(state, { restartTimer: selectionChanged });
  classifyLoadedDirectImages(directProductGrid);
}

function renderDirectCart(state = ToxStore.getState()) {
  if (!directCartList) return;
  const dict = saleDict(state.lang);
  const total = directCartTotal();
  if (directCartCount) directCartCount.textContent = cart.length;
  if (directPosTotal) directPosTotal.textContent = ToxStore.formatMoney(total, state.currency);
  if (directPosPaid) directPosPaid.textContent = ToxStore.formatMoney(total, state.currency);
  if (directPosDebt) directPosDebt.textContent = ToxStore.formatMoney(0, state.currency);
  if (directCheckoutButton) directCheckoutButton.disabled = !cart.length || directCheckoutSaving;
  directCartList.innerHTML = cart.length ? cart.map((item, index) => {
    const product = directProductById(item.productId, state);
    const units = ToxStore.sellableUnits(product);
    const image = productImageFor(product, "thumb") || item.thumbUrl || item.imageUrl || "";
    const priceStatus = cartLinePriceStatus(item, state);
    const priceWarning = priceStatus.changed
      ? `<small class="danger-text">السعر الحالي ${saleEscape(ToxStore.formatMoney(priceStatus.currentPriceUsd, priceStatus.currency))} <button class="button ghost compact-action" type="button" data-direct-cart-refresh-price="${index}">تحديث</button></small>`
      : `<small>سعر مقفل</small>`;
    return `
      <article class="direct-cart-item">
        <div class="direct-cart-thumb ${image ? "" : "is-empty"}">
          ${image ? `<img src="${saleEscape(image)}" alt="" loading="lazy" decoding="async" />` : `<span>${saleEscape((item.name || "TOX").slice(0, 2))}</span>`}
        </div>
        <div class="direct-cart-main">
          <strong>${saleEscape([item.brand, item.name].filter(Boolean).join(" - ") || item.name)}</strong>
          <div class="direct-cart-controls">
            <input type="number" min="${saleUnitQuantityConfig(product, units.find((entry) => entry.id === item.unit) || units[0]).min}" step="${saleUnitQuantityConfig(product, units.find((entry) => entry.id === item.unit) || units[0]).step}" value="${saleEscape(item.qty)}" data-direct-cart-qty="${index}" />
            <select data-direct-cart-unit="${index}">
              ${(units.length ? units : [{ id: item.unit, name: item.unitName }]).map((unit) => `<option value="${saleEscape(unit.id)}" ${unit.id === item.unit ? "selected" : ""}>${saleEscape(localizedUnitName(unit, state.lang))}</option>`).join("")}
            </select>
          </div>
          <small>${saleEscape(item.warehouseName || directWarehouseName(product, state))}</small>
          ${priceWarning}
        </div>
        <div class="direct-cart-side">
          <strong>${saleEscape(ToxStore.formatMoney(item.totalUsd, itemCurrency(item, state)))}</strong>
          <button class="button ghost compact-action" type="button" data-direct-cart-remove="${index}">${dict.remove}</button>
        </div>
      </article>
    `;
  }).join("") : `<div class="warehouse-empty">${saleDict(state.lang).noItems}</div>`;
  window.enhanceCustomSelects?.(directCartList);
  classifyLoadedDirectImages(directCartList);
}

let flowbarSelectRefreshFrame = 0;
const pendingFlowbarSelects = new Set();

function queueFlowbarSelectRefresh(selects = []) {
  selects.filter(Boolean).forEach((select) => pendingFlowbarSelects.add(select));
  if (flowbarSelectRefreshFrame) return;
  const refresh = () => {
    flowbarSelectRefreshFrame = 0;
    pendingFlowbarSelects.forEach((select) => window.updateCustomSelect?.(select));
    pendingFlowbarSelects.clear();
    window.ToxSelects?.repositionOpen?.();
  };
  flowbarSelectRefreshFrame = window.requestAnimationFrame
    ? window.requestAnimationFrame(refresh)
    : window.setTimeout(refresh, 0);
}

function syncSelectedProductLabel(state = ToxStore.getState()) {
  const product = currentProduct(state);
  const option = productInput.selectedOptions?.[0];
  if (product && option) {
    option.textContent = productSaleLabel(product, state, unitInput.value);
    queueFlowbarSelectRefresh([productInput]);
  }
}

function cartQtyInBase(productId) {
  return cart
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + Number(item.qtyInBase || 0), 0);
}

function itemCurrency(item, state) {
  return item.currency || state.currency;
}

function moneyUsdForCurrency(amountUsd, currency) {
  return ToxStore.moneyToUsd(ToxStore.convertUsd(amountUsd, currency), currency);
}

function saleLineTotalUsd({ qty, priceUsd, discountPercent = 0, currency }) {
  const grossAmount = ToxStore.convertUsd(Number(qty || 0) * Number(priceUsd || 0), currency);
  const discountAmount = Math.round(grossAmount * Math.min(Math.max(Number(discountPercent || 0), 0), 100) / 100);
  return ToxStore.moneyToUsd(Math.max(0, grossAmount - discountAmount), currency);
}

function discountAmount(subtotal) {
  const rawValue = Number(invoiceDiscountValue.value || 0);
  const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
  if (invoiceDiscountType.value === "percent") {
    return ToxStore.moneyToUsd(
      Math.round(ToxStore.convertUsd(subtotal, ToxStore.getState().currency) * Math.min(value, 100) / 100),
      ToxStore.getState().currency
    );
  }
  return ToxStore.moneyToUsd(value, ToxStore.getState().currency);
}

function hydrateInputs(state) {
  const dict = saleDict(state.lang);
  const posMode = isDirectPosView();
  const selectedProduct = productInput.value;
  const selectedWarehouse = warehouseInput.value || "all";
  productSearchInput.placeholder = t("searchByName", state.lang);
  barcodeSearchInput.placeholder = t("barcodeSearch", state.lang);
  directCustomerInput.placeholder = dict.guestCustomer;
  if (directPosCustomerInput) directPosCustomerInput.placeholder = dict.guestCustomer;
  flowbar.querySelector("[data-discount-input]").placeholder = t("lineDiscount", state.lang);
  warehouseInput.innerHTML = `<option value="all">${saleEscape(dict.allWarehouses)}</option>${state.warehouses.map((warehouse) => `<option value="${saleEscape(warehouse.id)}">${saleEscape(warehouse.name)}</option>`).join("")}`;
  warehouseInput.value = state.warehouses.some((warehouse) => warehouse.id === selectedWarehouse) ? selectedWarehouse : "all";
  const products = posMode ? [] : filteredProducts(state);
  filterCount.textContent = posMode ? (directCatalogTotalApprox || directCatalogItems.length) : products.length;
  if (!posMode) {
    productInput.innerHTML = products.length
      ? products
        .map((product) => {
          const unitId = product.id === selectedProduct ? unitInput.value : "";
          return `<option value="${saleEscape(product.id)}">${saleEscape(productSaleLabel(product, state, unitId))}</option>`;
        })
        .join("")
      : `<option value="">${saleEscape(dict.noProduct)}</option>`;
    if (selectedProduct && products.some((product) => product.id === selectedProduct)) {
      productInput.value = selectedProduct;
    }
  }
  clientSelect.innerHTML = state.clients.map((client) => `<option value="${saleEscape(client.id)}">${saleEscape(client.name)}</option>`).join("");
  if (directPosClientSelect) {
    const selectedDirectClient = directPosClientSelect.value;
    directPosClientSelect.innerHTML = state.clients.map((client) => `<option value="${saleEscape(client.id)}">${saleEscape(client.name)}</option>`).join("");
    if (state.clients.some((client) => client.id === selectedDirectClient)) directPosClientSelect.value = selectedDirectClient;
  }
  if (!posMode) {
    const flowDisabled = !products.length;
    [productInput, qtyInput, unitInput, lineDiscountInput].forEach((element) => {
      element.disabled = flowDisabled;
    });
    checkoutButton.disabled = !cart.length || invoiceCheckoutSaving;
    suspendButton.disabled = !cart.length;
    printButton.disabled = !cart.length;
    exportButton.disabled = !cart.length;
    renderSuspended(state);
    hydrateUnits(state);
    syncSelectedProductLabel(state);
    updatePricePreview(state);
    renderSaleProductPreview(state);
  }
  setDirectCustomerMode(directCustomerMode);
  renderDirectProducts(state);
  renderDirectCart(state);
}

function hydrateUnits(state) {
  const product = currentProduct(state);
  if (!product) {
    unitInput.innerHTML = "";
    queueFlowbarSelectRefresh([productInput, unitInput]);
    return;
  }
  const selectedUnit = unitInput.value;
  const units = ToxStore.sellableUnits(product);
  unitInput.innerHTML = units.map((unit) => `<option value="${saleEscape(unit.id)}">${saleEscape(localizedUnitName(unit, state.lang))}</option>`).join("");
  if (selectedUnit && units.some((unit) => unit.id === selectedUnit)) unitInput.value = selectedUnit;
  syncSelectedProductLabel(state);
  queueFlowbarSelectRefresh([productInput, unitInput]);
}

function updatePricePreview(state = ToxStore.getState()) {
  const dict = saleDict(state.lang);
  const product = currentProduct(state);
  const unit = currentUnit(product);
  if (!product || !unit) {
    previewPrice.textContent = ToxStore.formatMoney(0, state.currency);
    previewMeta.textContent = dict.noProduct;
    renderSaleProductPreview(state);
    return;
  }

  const qty = Number(qtyInput.value || 1);
  const lineDiscountPercent = Math.min(100, Math.max(0, Number(lineDiscountInput.value || 0)));
  const net = saleLineTotalUsd({
    qty,
    priceUsd: moneyUsdForCurrency(unit.priceUsd, ToxStore.productCurrency(product)),
    discountPercent: lineDiscountPercent,
    currency: ToxStore.productCurrency(product)
  });
  previewMeta.classList.remove("danger-text");
  previewPrice.textContent = ToxStore.formatProductMoney(product, unit.priceUsd);
  previewMeta.textContent = `${product.name} | ${qty} x ${localizedUnitName(unit, state.lang)} | ${ToxStore.formatProductMoney(product, net)} | ${dict.stock}: ${ToxStore.stockSummary(product)}`;
  syncSelectedProductLabel(state);
  renderSaleProductPreview(state);
}

function recalc(state) {
  const dict = saleDict(state.lang);
  const subtotal = moneyUsdForCurrency(cart.reduce((sum, item) => sum + item.totalUsd, 0), state.currency);
  const invoiceDiscount = Math.min(subtotal, discountAmount(subtotal));
  const paid = ToxStore.moneyToUsd(paidInput.value, state.currency);
  const total = moneyUsdForCurrency(Math.max(0, subtotal - invoiceDiscount), state.currency);
  const debt = Math.max(0, total - paid);

  checkoutButton.disabled = !cart.length;
  suspendButton.disabled = !cart.length;
  printButton.disabled = !cart.length;
  exportButton.disabled = !cart.length;

  const removeLabel = dict.remove;
  cartTable.innerHTML = cart
    .map((item, index) => {
      const priceStatus = cartLinePriceStatus(item, state);
      const priceWarning = priceStatus.changed
        ? `<small class="danger-text">السعر الحالي ${saleEscape(ToxStore.formatMoney(priceStatus.currentPriceUsd, priceStatus.currency))} <button class="button ghost compact-action" type="button" data-refresh-cart-price="${index}">تحديث السعر</button></small>`
        : `<small>سعر مقفل</small>`;
      return `
      <tr class="cart-row">
        <td><strong>${item.name}</strong><br><small>${[item.brand, ToxStore.getWarehouseName(item.warehouseId)].filter(Boolean).join(" | ")}</small>${priceWarning}</td>
        <td>${item.qty}</td>
        <td>${localizedUnitName({ id: item.unit, name: item.unitName }, state.lang)}</td>
        <td>${ToxStore.formatMoney(item.priceUsd, itemCurrency(item, state))}</td>
        <td><strong>${ToxStore.formatMoney(item.totalUsd, itemCurrency(item, state))}</strong></td>
        <td><button class="button ghost compact-action cart-remove-button" type="button" data-remove-cart-line="${index}" aria-label="${removeLabel}">${removeLabel}</button></td>
      </tr>
    `;
    })
    .join("") || `
      <tr class="cart-empty-row">
        <td colspan="6">${dict.noItems}</td>
      </tr>
    `;
  cartTable.querySelectorAll("[data-refresh-cart-price]").forEach((button) => {
    button.addEventListener("click", () => {
      if (refreshCartLinePrice(Number(button.dataset.refreshCartPrice), ToxStore.getState())) {
        recalc(ToxStore.getState());
        window.showNotice?.("تم تحديث سعر السطر", "success");
      }
    });
  });
  cartTable.querySelectorAll("[data-remove-cart-line]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeCartLine);
      if (!Number.isInteger(index) || index < 0 || index >= cart.length) return;
      cart.splice(index, 1);
      recalc(ToxStore.getState());
      playUiSound("tap");
    });
  });

  document.querySelector("[data-subtotal]").textContent = ToxStore.formatMoney(subtotal, state.currency);
  document.querySelector("[data-discount]").textContent = ToxStore.formatMoney(invoiceDiscount, state.currency);
  document.querySelector("[data-total]").textContent = ToxStore.formatMoney(total, state.currency);
  document.querySelector("[data-debt]").textContent = ToxStore.formatMoney(debt, state.currency);
  updatePricePreview(state);
  renderDirectProducts(state);
  renderDirectCart(state);

  return { subtotal, invoiceDiscount, paid, total, debt };
}

function animateMagneticAdd(source) {
  if (!source) return;
  const table = cartTable.getBoundingClientRect();
  const rect = source.getBoundingClientRect();
  const clone = document.createElement("div");
  clone.className = "magnetic-clone";
  clone.textContent = t("added");
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.setProperty("--tx", `${table.left - rect.left + 24}px`);
  clone.style.setProperty("--ty", `${table.top - rect.top + 28}px`);
  document.body.appendChild(clone);
  clone.addEventListener("animationend", () => clone.remove(), { once: true });
}

function revealNextStep(event) {
  const step = event.target.closest(".flow-step");
  const next = step?.nextElementSibling;
  if (next?.classList.contains("flow-step")) next.classList.add("revealed", "active");
}

function buildInvoiceSnapshot(state) {
  const totals = recalc(state);
  const dict = saleDict(state.lang);
  const clientName = mode === "client"
    ? state.clients.find((client) => client.id === clientSelect.value)?.name || t("client", state.lang)
    : directCustomerInput.value || dict.guestCustomer;

  return {
    id: `DRAFT-${Date.now()}`,
    title: invoiceTitleInput?.value || "",
    createdAt: new Date().toLocaleString(),
    mode,
    clientName,
    currency: state.currency,
    exchangeRate: state.exchangeRate,
    note: invoiceNoteInput?.value || "",
    items: cart.slice(),
    ...totals
  };
}

function printThemeClass(state) {
  if (state.theme === "coffee" || state.theme === "summer-orange") return "coffee-print";
  if (state.theme === "neon-blue") return "neon-print";
  if (state.theme === "teal-slate") return "teal-print";
  return "";
}

function invoiceHtml(state, invoice, title) {
  const dict = saleDict(state.lang);
  const label = (value) => ToxStore.repairText ? ToxStore.repairText(value) : value;
  const isArabic = state.lang === "ar";
  const activePrintTheme = printThemeClass(state);
  const businessName = ToxStore.businessProfileName?.(state) || state.businessName || "TOX";
  const businessMeta = ToxStore.businessProfileParts?.(state) || [state.businessSubtitle, state.businessPhone, state.businessAddress].filter(Boolean);
  const invoiceDate = new Date(invoice.createdAt || Date.now()).toLocaleString(isArabic ? "ar-IQ" : "en-US");
  const paidStatus = invoice.debt > 0 ? (isArabic ? "غير مسددة بالكامل" : "Balance Due") : (isArabic ? "مسددة" : "Paid");
  const rows = invoice.items
    .map((item, index) => {
      const product = directProductById(item.productId, state);
      const brand = item.brand || product?.brand || "";
      const meta = [brand, ToxStore.getWarehouseName(item.warehouseId)].filter(Boolean).join(" | ");
      return `
        <tr>
          <td class="index">${index + 1}</td>
          <td><strong>${item.name}</strong><small class="item-meta">${meta || "-"}</small></td>
          <td>${item.qty}</td>
          <td>${localizedUnitName({ id: item.unit, name: item.unitName }, state.lang)}</td>
          <td>${ToxStore.formatMoney(item.priceUsd, itemCurrency(item, state))}</td>
          <td>${ToxStore.formatMoney(item.totalUsd, itemCurrency(item, state))}</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="${state.lang}" dir="${isArabic ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8">
  <title>${label(title)}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:30px;background:#eef2f7;color:#0f172a;font-family:"Segoe UI","Noto Kufi Arabic",Tahoma,Arial,sans-serif}
    .sheet{position:relative;max-width:1040px;margin:auto;background:#fff;border:1px solid #dbe3ee;border-radius:22px;overflow:hidden;box-shadow:0 28px 90px rgba(15,23,42,.14)}
    .hero{display:grid;grid-template-columns:1fr auto;gap:22px;padding:30px 34px;background:linear-gradient(135deg,#111827,#0f172a 60%,#374151);color:white}
    .brand{display:flex;gap:16px;align-items:center}.mark{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);font-weight:900;font-size:18px}
    h1,h2,p{margin:0}.brand h1{font-size:32px;letter-spacing:0}.brand p,.badge p{color:rgba(255,255,255,.78);margin-top:5px}
    .badge{min-width:250px;text-align:${isArabic ? "left" : "right"};padding:16px 18px;border-radius:18px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25)}
    .badge strong{display:block;font-size:22px}.ribbon{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px 34px;background:#f8fafc;color:#111827;font-weight:900;border-bottom:1px solid #e5e7eb}
    .stamp{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border:1px solid #111827;border-radius:999px;background:#fff;color:#111827;font-weight:900}
    .watermark{position:absolute;inset:auto 30px 30px auto;font-size:110px;font-family:Georgia,serif;font-style:italic;font-weight:900;color:rgba(15,23,42,.035);pointer-events:none}
    .mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:18px 34px;border-bottom:1px solid #e5e7eb;background:#fff}
    .mini-grid div{padding:13px 14px;border:1px solid #e5e7eb;border-radius:14px;background:#fbfdff}.mini-grid span{display:block;color:#64748b;font-size:12px}.mini-grid strong{display:block;margin-top:4px;color:#111827}
    .meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:#e2e8f0;border-bottom:1px solid #e2e8f0}
    .meta div{padding:14px 18px;background:#f8fafc}.meta span,.totals span,small{color:#64748b}.meta strong{display:block;margin-top:4px}
    .content{padding:30px 34px}table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #dbe3ee;border-radius:16px;overflow:hidden}
    th{background:#f8fafc;color:#475569;font-size:12px;text-transform:uppercase}th,td{padding:13px 12px;border-bottom:1px solid #e5e7eb;text-align:${isArabic ? "right" : "left"};vertical-align:top}
    tbody tr:nth-child(even) td{background:#fbfdff}tr:last-child td{border-bottom:0}.index{width:42px;color:#94a3b8;font-weight:800}td strong,td small{display:block}
    .item-meta{display:inline-block;margin-top:6px;padding:4px 9px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:700}
    .footer{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.42fr);gap:24px;margin-top:24px;align-items:start}
    .note{min-height:138px;border:1px dashed #cbd5e1;border-radius:16px;background:#f8fafc;padding:16px;color:#64748b}
    .totals{border:1px solid #dbe3ee;border-radius:16px;overflow:hidden}.total-row{display:flex;justify-content:space-between;gap:16px;padding:13px 16px;border-bottom:1px solid #e5e7eb}.total-row:last-child{border-bottom:0}
    .grand{background:#f8fafc}.grand strong{font-size:25px;color:#111827}.debt strong{color:#e11d48}.paid strong{color:#047857}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px;color:#64748b}.signatures div{padding-top:18px;border-top:1px solid #cbd5e1}
    @media print{body{padding:0;background:white}.sheet{box-shadow:none;border-radius:0;border:0}.hero,.ribbon{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    body.coffee-print{background:#efe3d1;color:#211711}
    body.coffee-print .sheet{background:#fff8ed;border-color:#d8b98a;box-shadow:0 28px 90px rgba(33,23,17,.16)}
    body.coffee-print .hero{background:linear-gradient(135deg,#140f0b,#211711 58%,#8b542f);color:#fff8ed}
    body.coffee-print .mark{border-color:rgba(246,199,108,.38);background:rgba(246,199,108,.14)}
    body.coffee-print .ribbon{background:#f6c76c;color:#211711;border-bottom-color:#d8b98a}
    body.coffee-print .meta{background:#d8b98a}.coffee-print .meta div,.coffee-print .mini-grid div,.coffee-print th,.coffee-print .grand{background:#fff3df}
    body.coffee-print .item-meta{background:#f7e2bf;color:#6f4528}.coffee-print .note{background:#fff3df;border-color:#d8b98a;color:#6f4528}
    body.coffee-print .grand strong{color:#6f4528}.coffee-print .watermark{color:rgba(111,69,40,.05)}
    body.neon-print{background:#e8f3ff;color:#071124}
    body.neon-print .sheet{background:#f8fbff;border-color:#b9d8f0;box-shadow:0 28px 90px rgba(7,17,36,.16)}
    body.neon-print .hero{background:linear-gradient(135deg,#030716,#2323ff 58%,#22d3ee);color:#f8fbff}
    body.neon-print .mark{border-color:rgba(74,211,255,.42);background:rgba(74,211,255,.16)}
    body.neon-print .ribbon{background:#dff8ff;color:#071124;border-bottom-color:#b9d8f0}
    body.neon-print .meta{background:#b9d8f0}.neon-print .meta div,.neon-print .mini-grid div,.neon-print th,.neon-print .grand{background:#eef8ff}
    body.neon-print .item-meta{background:#dff8ff;color:#155e75}.neon-print .note{background:#eef8ff;border-color:#b9d8f0;color:#155e75}
    body.neon-print .grand strong{color:#1d4ed8}.neon-print .watermark{color:rgba(35,35,255,.05)}
    body.teal-print{background:#eaf8f8;color:#102a2e}
    body.teal-print .sheet{background:#ffffff;border-color:#b8dada;box-shadow:0 28px 90px rgba(5,118,118,.14)}
    body.teal-print .hero{background:linear-gradient(135deg,#102a2e,#057676 58%,#13d4d4);color:#ffffff}
    body.teal-print .mark{border-color:rgba(19,212,212,.38);background:rgba(19,212,212,.16)}
    body.teal-print .ribbon{background:#ddf7f7;color:#102a2e;border-bottom-color:#b8dada}
    body.teal-print .meta{background:#b8dada}.teal-print .meta div,.teal-print .mini-grid div,.teal-print th,.teal-print .grand{background:#effafa}
    body.teal-print .item-meta{background:#ddf7f7;color:#057676}.teal-print .note{background:#effafa;border-color:#b8dada;color:#057676}
    body.teal-print .grand strong{color:#057676}.teal-print .watermark{color:rgba(5,118,118,.05)}
  </style>
</head>
<body class="${activePrintTheme}">
  <main class="sheet">
    <div class="watermark">TOX</div>
    <section class="hero">
      <div class="brand"><div class="mark">TOX</div><div><h1>${businessName}</h1><p>${businessMeta.join(" | ") || label(title)}</p></div></div>
      <div class="badge"><span>${label(title)}</span><strong>${invoice.id}</strong><p>${invoiceDate}</p></div>
    </section>
    <div class="ribbon">${invoice.title || (isArabic ? "فاتورة بيع رسمية" : "Official Sales Invoice")}</div>
    <section class="meta">
      <div><span>${dict.customer}</span><strong>${invoice.clientName || dict.guestCustomer}</strong></div>
      <div><span>${dict.currency}</span><strong>${state.currency}</strong></div>
      <div><span>${dict.exchangeRate}</span><strong>1 USD = ${Number(state.exchangeRate || 0).toLocaleString("en-US")} IQD</strong></div>
      <div><span>${dict.items}</span><strong>${invoice.items.length}</strong></div>
    </section>
    <section class="mini-grid">
      <div><span>${label(dict.invoiceNo)}</span><strong>${invoice.id}</strong></div>
      <div><span>${label(dict.date)}</span><strong>${invoiceDate}</strong></div>
      <div><span>${isArabic ? "حالة الدفع" : "Payment Status"}</span><strong>${paidStatus}</strong></div>
    </section>
    <section class="content">
      <table><thead><tr><th>#</th><th>${label(dict.product)}</th><th>${label(dict.qty)}</th><th>${label(dict.unit)}</th><th>${label(dict.price)}</th><th>${label(dict.total)}</th></tr></thead><tbody>${rows}</tbody></table>
      <section class="footer">
        <div class="note">${invoice.note || (isArabic ? "ملاحظة: يرجى الاحتفاظ بالفاتورة للمراجعة أو الضمان. شكرا لتعاملكم معنا." : "Note: Please keep this invoice for review or warranty. Thank you for your business.")}</div>
        <div class="totals">
          <div class="total-row"><span>${label(dict.subtotal)}</span><strong>${ToxStore.formatMoney(invoice.subtotal, state.currency)}</strong></div>
          <div class="total-row"><span>${label(dict.discount)}</span><strong>${ToxStore.formatMoney(invoice.invoiceDiscount, state.currency)}</strong></div>
          <div class="total-row grand"><span>${label(dict.total)}</span><strong>${ToxStore.formatMoney(invoice.total, state.currency)}</strong></div>
          <div class="total-row paid"><span>${label(dict.paid)}</span><strong>${ToxStore.formatMoney(invoice.paid, state.currency)}</strong></div>
          <div class="total-row debt"><span>${label(dict.debt)}</span><strong>${ToxStore.formatMoney(invoice.debt, state.currency)}</strong></div>
        </div>
      </section>
      <section class="signatures"><div>${isArabic ? "توقيع الزبون" : "Customer signature"}</div><div>${isArabic ? "توقيع الموظف" : "Staff signature"}</div></section>
    </section>
  </main>
</body>
</html>`;
}

function exportDraftInvoice() {
  if (!cart.length) return;
  const state = ToxStore.getState();
  const invoice = buildInvoiceSnapshot(state);
  const html = window.ToxPrint?.html
    ? ToxPrint.html("saleInvoice", { ...invoice, title: saleDict(state.lang).draftInvoice }, state)
    : invoiceHtml(state, invoice, saleDict(state.lang).draftInvoice);
  const blob = new Blob([html], { type: "text/html" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${invoice.id}.html`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
  playUiSound("success");
}

function printActiveInvoice() {
  if (!cart.length) return;
  const state = ToxStore.getState();
  const invoice = buildInvoiceSnapshot(state);
  if (window.ToxPrint?.render) {
    ToxPrint.render("saleInvoice", { ...invoice, title: saleDict(state.lang).draftInvoice }, state);
    return;
  }
  const printWindow = window.open("", "_blank", "width=1100,height=780");
  if (!printWindow) return;
  printWindow.document.write(invoiceHtml(state, invoice, saleDict(state.lang).draftInvoice));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  playUiSound("print");
}

function renderSuspended(state) {
  if (!suspendedList) return;
  suspendedCount.textContent = state.suspendedInvoices.length;
  suspendedList.innerHTML = state.suspendedInvoices
    .map((invoice) => `
      <div class="ledger-item">
        <span><strong>${invoice.id}</strong><br><small>${invoice.customerName || state.clients.find((client) => client.id === invoice.clientId)?.name || t("client", state.lang)}</small></span>
        <strong>${ToxStore.formatMoney(ToxStore.invoiceNet(invoice), state.currency)}</strong>
        <button class="button ghost" type="button" data-resume-invoice="${invoice.id}">${t("activeInvoice", state.lang)}</button>
      </div>
    `)
    .join("") || `<div class="warehouse-empty">${t("noInvoices", state.lang)}</div>`;

  document.querySelectorAll("[data-resume-invoice]").forEach((button) => {
    button.addEventListener("click", () => {
      const invoice = ToxStore.resumeSuspendedInvoice(button.dataset.resumeInvoice);
      if (!invoice) return;
      cart.splice(0, cart.length, ...(invoice.items || []));
      paidInput.value = ToxStore.convertUsd(invoice.paidUsd || 0, state.currency);
      invoiceDiscountType.value = "amount";
      invoiceDiscountValue.value = ToxStore.convertUsd(invoice.discountUsd || 0, state.currency);
      if (invoiceTitleInput) invoiceTitleInput.value = invoice.title || "";
      if (invoiceNoteInput) invoiceNoteInput.value = invoice.note || "";
      if (invoice.clientId) {
        mode = "client";
        clientSelect.value = invoice.clientId;
      } else {
        mode = "direct";
        directCustomerInput.value = invoice.customerName || "";
      }
      document.querySelectorAll("[data-mode]").forEach((entry) => entry.classList.toggle("active", entry.dataset.mode === mode));
      clientField.classList.toggle("hidden", mode !== "client");
      quickClientForm.classList.toggle("hidden", mode !== "client");
      directCustomerField.classList.toggle("hidden", mode !== "direct");
      recalc(ToxStore.getState());
      playUiSound("success");
    });
  });
}

directCustomerModeButtons.forEach((button) => {
  button.addEventListener("click", () => setDirectCustomerMode(button.dataset.directCustomerMode));
});

directProductGrid?.addEventListener("click", (event) => {
  const loadMore = event.target.closest?.("[data-direct-catalog-sentinel]");
  if (loadMore && directCatalogHasMore && !directCatalogLoading) {
    fetchDirectProducts({ append: true });
    return;
  }
  const card = event.target.closest?.("[data-direct-add-product]");
  if (!card || card.classList.contains("is-disabled")) return;
  selectDirectProduct(card.dataset.directAddProduct, ToxStore.getState());
});

directProductGrid?.addEventListener("load", (event) => {
  if (event.target?.matches?.(".direct-product-media img")) {
    classifyDirectCatalogImage(event.target);
  }
}, true);

[directProductShowcase, directQuickAdd, directCartList].forEach((container) => {
  container?.addEventListener("load", (event) => {
    if (event.target?.matches?.(".direct-showcase-media img, .direct-quick-media img, .direct-cart-thumb img")) {
      classifyDirectCatalogImage(event.target);
    }
  }, true);
});

directQuickAdd?.addEventListener("change", (event) => {
  const unitSelectTarget = event.target.closest?.("[data-direct-quick-unit]");
  const qtyInputTarget = event.target.closest?.("[data-direct-quick-qty]");
  if (unitSelectTarget) {
    selectedDirectUnitId = unitSelectTarget.value;
    renderDirectQuickAdd(ToxStore.getState());
  }
  if (qtyInputTarget) {
    const product = directProductById(selectedDirectProductId, ToxStore.getState());
    const units = ToxStore.sellableUnits(product);
    const unit = units.find((entry) => entry.id === selectedDirectUnitId) || units[0];
    selectedDirectQty = normalizeSaleQuantity(product, unit, qtyInputTarget.value || 1);
    directQtyByProduct.set(selectedDirectProductId, selectedDirectQty);
    renderDirectQuickAdd(ToxStore.getState());
  }
});

directQuickAdd?.addEventListener("input", (event) => {
  const qtyInputTarget = event.target.closest?.("[data-direct-quick-qty]");
  if (qtyInputTarget) {
    const product = directProductById(selectedDirectProductId, ToxStore.getState());
    const units = ToxStore.sellableUnits(product);
    const unit = units.find((entry) => entry.id === selectedDirectUnitId) || units[0];
    selectedDirectQty = normalizeSaleQuantity(product, unit, qtyInputTarget.value || 1);
    directQtyByProduct.set(selectedDirectProductId, selectedDirectQty);
  }
});

directQuickAdd?.addEventListener("click", (event) => {
  const stepButton = event.target.closest?.("[data-direct-quick-step]");
  const submitButton = event.target.closest?.("[data-direct-quick-submit]");
  if (stepButton) {
    const product = directProductById(selectedDirectProductId, ToxStore.getState());
    const unit = ToxStore.sellableUnits(product).find((entry) => entry.id === selectedDirectUnitId);
    if (!product || !unit) return;
    const unitMultiplier = Math.max(0.0001, Number(unit?.multiplier || 1));
    const remainingBase = Math.max(0, ToxStore.stockBaseQuantity(product) - cartQtyInBase(product.id));
    const maxQty = remainingBase / unitMultiplier;
    const delta = Number(stepButton.dataset.directQuickStep || 0);
    selectedDirectQty = Math.min(normalizeSaleQuantity(product, unit, Number(selectedDirectQty || 1) + delta), Math.max(saleUnitQuantityConfig(product, unit).min, maxQty || saleUnitQuantityConfig(product, unit).min));
    directQtyByProduct.set(selectedDirectProductId, selectedDirectQty);
    renderDirectQuickAdd(ToxStore.getState());
  }
  if (submitButton) {
    addProductToDirectCart(selectedDirectProductId, selectedDirectUnitId, selectedDirectQty, submitButton);
  }
});

directProductShowcase?.addEventListener("change", (event) => {
  const unitSelectTarget = event.target.closest?.("[data-showcase-unit]");
  const qtyInputTarget = event.target.closest?.("[data-showcase-qty]");
  if (unitSelectTarget) {
    selectedDirectUnitId = unitSelectTarget.value;
    renderDirectQuickAdd(ToxStore.getState());
    renderDirectShowcase(ToxStore.getState());
  }
  if (qtyInputTarget) {
    const product = directProductById(selectedDirectProductId, ToxStore.getState());
    const units = ToxStore.sellableUnits(product);
    const unit = units.find((entry) => entry.id === selectedDirectUnitId) || units[0];
    selectedDirectQty = normalizeSaleQuantity(product, unit, qtyInputTarget.value || 1);
    directQtyByProduct.set(selectedDirectProductId, selectedDirectQty);
    renderDirectQuickAdd(ToxStore.getState());
    renderDirectShowcase(ToxStore.getState());
  }
});

directProductShowcase?.addEventListener("input", (event) => {
  const qtyInputTarget = event.target.closest?.("[data-showcase-qty]");
  if (qtyInputTarget) {
    const product = directProductById(selectedDirectProductId, ToxStore.getState());
    const units = ToxStore.sellableUnits(product);
    const unit = units.find((entry) => entry.id === selectedDirectUnitId) || units[0];
    selectedDirectQty = normalizeSaleQuantity(product, unit, qtyInputTarget.value || 1);
    directQtyByProduct.set(selectedDirectProductId, selectedDirectQty);
  }
});

directProductShowcase?.addEventListener("click", (event) => {
  const stepButton = event.target.closest?.("[data-showcase-image-step]");
  const dotButton = event.target.closest?.("[data-showcase-dot]");
  const addButton = event.target.closest?.("[data-showcase-add]");
  const detailsButton = event.target.closest?.("[data-showcase-details]");
  const state = ToxStore.getState();
  const product = directProductById(selectedDirectProductId, state);
  const images = productImages(product);
  if (stepButton && images.length) {
    directShowcaseImageIndex = (directShowcaseImageIndex + Number(stepButton.dataset.showcaseImageStep || 0) + images.length) % images.length;
    renderDirectShowcase(state);
    return;
  }
  if (dotButton) {
    directShowcaseImageIndex = Math.max(0, Math.min(images.length - 1, Number(dotButton.dataset.showcaseDot || 0)));
    renderDirectShowcase(state);
    return;
  }
  if (addButton) {
    addProductToDirectCart(selectedDirectProductId, selectedDirectUnitId, selectedDirectQty, addButton);
    return;
  }
  if (detailsButton) {
    const escapedId = window.CSS?.escape ? CSS.escape(selectedDirectProductId) : selectedDirectProductId.replace(/"/g, '\\"');
    directProductGrid?.querySelector(`[data-direct-add-product="${escapedId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});

directCartList?.addEventListener("change", (event) => {
  const qtyInputTarget = event.target.closest?.("[data-direct-cart-qty]");
  const unitSelectTarget = event.target.closest?.("[data-direct-cart-unit]");
  if (qtyInputTarget) {
    updateDirectCartLine(Number(qtyInputTarget.dataset.directCartQty), { qty: qtyInputTarget.value });
  }
  if (unitSelectTarget) {
    updateDirectCartLine(Number(unitSelectTarget.dataset.directCartUnit), { unit: unitSelectTarget.value });
  }
});

directCartList?.addEventListener("click", (event) => {
  const refreshButton = event.target.closest?.("[data-direct-cart-refresh-price]");
  if (refreshButton) {
    if (refreshCartLinePrice(Number(refreshButton.dataset.directCartRefreshPrice), ToxStore.getState())) {
      recalc(ToxStore.getState());
      window.showNotice?.("تم تحديث سعر السطر", "success");
    }
    return;
  }
  const removeButton = event.target.closest?.("[data-direct-cart-remove]");
  if (!removeButton) return;
  const index = Number(removeButton.dataset.directCartRemove);
  if (!Number.isInteger(index) || index < 0 || index >= cart.length) return;
  cart.splice(index, 1);
  recalc(ToxStore.getState());
  playUiSound("delete");
});

directCheckoutButton?.addEventListener("click", async () => {
  if (!cart.length || directCheckoutSaving) return;
  const state = ToxStore.getState();
  const dict = saleDict(state.lang);
  const total = directCartTotal();
  const clientId = directCustomerMode === "client" ? (directPosClientSelect?.value || null) : null;
  const invoiceKey = saleDocumentKey("POS");
  const paymentId = clientId ? `PAY-${Date.now()}` : "";
  const invoicePayload = {
    id: invoiceKey,
    idempotencyKey: invoiceKey,
    clientId,
    customerId: clientId,
    kind: "direct_pos",
    type: "direct_pos",
    title: state.lang === "ar" ? "\u0628\u064a\u0639 \u0645\u0628\u0627\u0634\u0631 \u0645\u062f\u0641\u0648\u0639" : "Paid Direct POS Sale",
    customerName: directCustomerLabel(state),
    currency: state.currency,
    items: normalizeInvoiceItemsForBackend(cart, state),
    subtotalUsd: total,
    totalUsd: total,
    paidUsd: total,
    remainingUsd: 0,
    discountUsd: 0,
    exchangeRate: state.exchangeRate,
    note: "",
    paymentId
  };
  let backendInvoice = null;
  let backendError = null;
  directCheckoutSaving = true;
  renderDirectCart(state);
  try {
    backendInvoice = await saveDirectInvoiceToBackend(invoicePayload);
  } catch (error) {
    if (await refreshAndRepairInvoiceCart(error)) {
      invoicePayload.items = normalizeInvoiceItemsForBackend(cart, ToxStore.getState());
      try {
        backendInvoice = await saveDirectInvoiceToBackend(invoicePayload);
      } catch (retryError) {
        backendError = retryError;
        console.warn("Direct POS invoice was not saved immediately; keeping local invoice.", retryError);
      }
    } else {
      backendError = error;
      console.warn("Direct POS invoice was not saved immediately; keeping local invoice.", error);
    }
  } finally {
    directCheckoutSaving = false;
  }
  if (!backendInvoice) {
    previewMeta.textContent = directSaleSaveErrorMessage(backendError, state);
    previewMeta.classList.add("danger-text");
    window.showNotice?.(directSaleSaveErrorMessage(backendError, state), "error");
    playUiSound("error");
    renderDirectCart(ToxStore.getState());
    return;
  }
  const invoice = ToxStore.createInvoice({
    ...invoicePayload,
    items: mergeBackendInvoiceItems(invoicePayload.items, backendInvoice?.items),
    id: backendInvoice?.id || backendInvoice?.externalId || "",
    paidUsd: backendInvoice?.paidUsd ?? invoicePayload.paidUsd,
    discountUsd: backendInvoice?.discountUsd ?? invoicePayload.discountUsd,
    initialPaymentId: paymentId,
    initialPaymentNote: state.lang === "ar" ? "دفعة بيع مباشر" : "Direct sale payment"
  });
  if (!invoice) {
    if (backendInvoice) {
      cart.splice(0);
      if (directPosCustomerInput) directPosCustomerInput.value = "";
      await refreshDirectProductsAfterSale();
      recalc(ToxStore.getState());
      window.showNotice?.(dict.paidDirectSaleDone, "success");
      playUiSound("success");
    } else {
      previewMeta.textContent = `${t("saleBlocked", state.lang)} | ${dict.insufficientStock}`;
      previewMeta.classList.add("danger-text");
      window.showNotice?.(dict.directStockError, "error");
      playUiSound("error");
    }
    return;
  }
  cart.splice(0);
  if (directPosCustomerInput) directPosCustomerInput.value = "";
  await refreshDirectProductsAfterSale();
  recalc(ToxStore.getState());
  window.showNotice?.(backendError ? directSaleSaveErrorMessage(backendError, state) : dict.paidDirectSaleDone, backendError ? "warning" : "success");
  playUiSound("success");
});

document.querySelectorAll(".flow-step input, .flow-step select").forEach((input) => {
  input.addEventListener("change", revealNextStep);
});

[productInput, unitInput, qtyInput, lineDiscountInput, productSearchInput].forEach((input) => {
  input.addEventListener("input", () => updatePricePreview(ToxStore.getState()));
  input.addEventListener("change", () => updatePricePreview(ToxStore.getState()));
});

[warehouseInput, productSearchInput, barcodeSearchInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (isDirectPosView()) {
      scheduleDirectProductsFetch(true);
      return;
    }
    hydrateInputs(ToxStore.getState());
  });
  input.addEventListener("change", () => {
    if (isDirectPosView()) {
      scheduleDirectProductsFetch(true);
      return;
    }
    hydrateInputs(ToxStore.getState());
  });
});

barcodeSearchInput.addEventListener("change", () => {
  if (isDirectPosView()) {
    scheduleDirectProductsFetch(true);
    return;
  }
  const state = ToxStore.getState();
  const match = ToxStore.findProductByBarcode(barcodeSearchInput.value);
  const product = match?.product || match;
  if (product) {
    warehouseInput.value = product.warehouseId;
    hydrateInputs(state);
    productInput.value = product.id;
    hydrateUnits(state);
    if (match?.unit?.id) unitInput.value = match.unit.id;
    updatePricePreview(state);
  }
});

productInput.addEventListener("change", () => {
  const state = ToxStore.getState();
  hydrateUnits(state);
  updatePricePreview(state);
});
invoiceDiscountType.addEventListener("change", () => recalc(ToxStore.getState()));
invoiceDiscountValue.addEventListener("input", () => recalc(ToxStore.getState()));
paidInput.addEventListener("input", () => recalc(ToxStore.getState()));

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((entry) => entry.classList.toggle("active", entry === button));
    clientField.classList.toggle("hidden", mode !== "client");
    quickClientForm.classList.toggle("hidden", mode !== "client");
    directCustomerField.classList.toggle("hidden", mode !== "direct");
  });
});

quickClientForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = ToxStore.addClient({
    name: document.querySelector("[data-quick-client-name]").value,
    phone: document.querySelector("[data-quick-client-phone]").value
  });
  if (id) clientSelect.value = id;
  quickClientForm.reset();
  playUiSound("success");
});

document.querySelector("[data-flowbar]").addEventListener("submit", (event) => {
  event.preventDefault();
  const state = ToxStore.getState();
  const product = currentProduct(state);
  const unit = currentUnit(product);
  const qty = Number(qtyInput.value || 1);
  if (!product || !unit) return;
  const qtyInBase = ToxStore.quantityInBase(product, qty, unit.id);
  const lineDiscountPercent = Math.min(100, Math.max(0, Number(lineDiscountInput.value || 0)));

  if (qtyInBase + cartQtyInBase(product.id) > ToxStore.stockBaseQuantity(product)) {
    previewMeta.textContent = `${t("saleBlocked", state.lang)} | ${saleDict(state.lang).insufficientStock}: ${ToxStore.stockSummary(product)}`;
    previewMeta.classList.add("danger-text");
    playUiSound("error");
    return;
  }

  const currency = ToxStore.productCurrency(product);
  const priceUsd = moneyUsdForCurrency(unit.priceUsd, currency);
  const grossAmount = ToxStore.convertUsd(qty * priceUsd, currency);
  const lineDiscountAmount = Math.round(grossAmount * lineDiscountPercent / 100);
  const lineDiscountUsd = ToxStore.moneyToUsd(lineDiscountAmount, currency);
  const totalUsd = ToxStore.moneyToUsd(Math.max(0, grossAmount - lineDiscountAmount), currency);

  cart.push({
    productId: product.id,
    warehouseId: product.warehouseId,
    name: product.name,
    brand: product.brand || "",
    qty,
    qtyInBase,
    unit: unit.id,
    unitId: unit.id,
    unitName: unit.name,
    currency,
    price: ToxStore.convertUsd(priceUsd, currency),
    priceCurrency: currency,
    priceUsd,
    lineDiscountPercent,
    lineDiscountUsd,
    lineTotal: ToxStore.convertUsd(totalUsd, currency),
    totalUsd,
    ...cartLinePriceLock(product, unit, priceUsd, currency)
  });
  previewMeta.classList.remove("danger-text");
  recalc(state);
  animateMagneticAdd(event.submitter || document.querySelector("[data-add-item]"));
  playUiSound("success");
});

document.querySelector("[data-export-draft]").addEventListener("click", exportDraftInvoice);
document.querySelector("[data-print-invoice]").addEventListener("click", printActiveInvoice);

document.querySelector("[data-suspend-invoice]").addEventListener("click", () => {
  if (!cart.length) return;
  const state = ToxStore.getState();
  const totals = recalc(state);
  ToxStore.suspendInvoice({
    clientId: mode === "client" ? clientSelect.value : null,
    kind: "invoice",
    type: "invoice",
    title: invoiceTitleInput?.value || "",
    customerName: mode === "direct" ? directCustomerInput.value || "Guest customer" : "",
    items: cart.splice(0),
    paidUsd: totals.paid,
    discountUsd: totals.invoiceDiscount,
    note: invoiceNoteInput?.value || ""
  });
  paidInput.value = 0;
  invoiceDiscountValue.value = 0;
  if (invoiceTitleInput) invoiceTitleInput.value = "";
  if (invoiceNoteInput) invoiceNoteInput.value = "";
  recalc(ToxStore.getState());
  playUiSound("tap");
});

document.querySelector("[data-checkout]").addEventListener("click", async () => {
  if (!cart.length || invoiceCheckoutSaving) return;
  const state = ToxStore.getState();
  const totals = recalc(state);
  const clientId = mode === "client" ? clientSelect.value : null;
  const invoiceKey = saleDocumentKey("INV");
  const paymentId = clientId && totals.paid > 0 ? `PAY-${Date.now()}` : "";
  const invoicePayload = {
    id: invoiceKey,
    idempotencyKey: invoiceKey,
    clientId,
    customerId: clientId,
    kind: "invoice",
    type: "invoice",
    title: invoiceTitleInput?.value || "",
    customerName: mode === "direct" ? directCustomerInput.value || "Guest customer" : "",
    currency: state.currency,
    items: normalizeInvoiceItemsForBackend(cart, state),
    subtotalUsd: totals.subtotal,
    totalUsd: totals.total,
    paidUsd: totals.paid,
    remainingUsd: totals.debt,
    discountUsd: totals.invoiceDiscount,
    exchangeRate: state.exchangeRate,
    note: invoiceNoteInput?.value || "",
    paymentId
  };
  invoiceCheckoutSaving = true;
  recalc(state);
  let backendInvoice = null;
  try {
    backendInvoice = await saveInvoiceToBackend(invoicePayload);
  } catch (error) {
    if (await refreshAndRepairInvoiceCart(error)) {
      invoicePayload.items = normalizeInvoiceItemsForBackend(cart, ToxStore.getState());
      try {
        backendInvoice = await saveInvoiceToBackend(invoicePayload);
      } catch (retryError) {
        error = retryError;
      }
    }
    if (!backendInvoice) {
    console.warn("Invoice was not saved; checkout remains open.", error);
    window.showNotice?.(invoiceSaveErrorMessage(error, state), "error");
    previewMeta.textContent = invoiceSaveErrorMessage(error, state);
    previewMeta.classList.add("danger-text");
    playUiSound("error");
    invoiceCheckoutSaving = false;
    recalc(ToxStore.getState());
    return;
    }
  }
  invoiceCheckoutSaving = false;
  const invoice = ToxStore.createInvoice({
    ...invoicePayload,
    items: mergeBackendInvoiceItems(invoicePayload.items, backendInvoice?.items),
    id: backendInvoice?.id || backendInvoice?.externalId || "",
    createdAt: backendInvoice?.createdAt || new Date().toISOString(),
    paidUsd: backendInvoice?.paidUsd ?? invoicePayload.paidUsd,
    discountUsd: backendInvoice?.discountUsd ?? invoicePayload.discountUsd,
    initialPaymentId: paymentId,
    initialPaymentNote: state.lang === "ar" ? "دفعة عند إنشاء الفاتورة" : "Initial invoice payment"
  });
  if (!invoice) {
    previewMeta.textContent = `${t("saleBlocked", state.lang)} | ${saleDict(state.lang).insufficientStock}`;
    previewMeta.classList.add("danger-text");
    window.showNotice?.(state.lang === "ar" ? "تم حفظ الفاتورة في قاعدة البيانات، لكن السلة المحلية تحتاج تحديث الصفحة." : "Invoice was saved to the database, but the local cart needs a refresh.", "warning");
    playUiSound("error");
    return;
  }
  cart.splice(0);
  paidInput.value = 0;
  invoiceDiscountValue.value = 0;
  if (invoiceTitleInput) invoiceTitleInput.value = "";
  if (invoiceNoteInput) invoiceNoteInput.value = "";
  lineDiscountInput.value = 0;
  recalc(ToxStore.getState());
  playUiSound("success");
});

ToxStore.subscribe((state) => {
  hydrateInputs(state);
  recalc(state);
  applySalesHash({ focus: false });
});
applySalesHash();
window.addEventListener("hashchange", () => applySalesHash());
window.addEventListener("tox:product-updated", (event) => {
  refreshDirectProductAfterInventoryUpdate(event.detail?.productId).catch((error) => {
    console.warn("Could not refresh updated POS product", error);
  });
});
