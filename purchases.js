const purchaseCart = [];
const purchaseLineForm = document.querySelector("[data-purchase-line-form]");
const purchaseProduct = document.querySelector("[data-purchase-product]");
const purchaseProductSearch = document.querySelector("[data-purchase-product-search]");
const purchaseWarehouse = document.querySelector("[data-purchase-warehouse]");
const purchaseUnit = document.querySelector("[data-purchase-unit]");
const purchaseQty = document.querySelector("[data-purchase-qty-input]");
const purchaseUnitCost = document.querySelector("[data-purchase-unit-cost]");
const purchaseLineCost = document.querySelector("[data-purchase-line-cost]");
const purchaseLineDiscount = document.querySelector("[data-purchase-line-discount]");
const purchaseBatchCode = document.querySelector("[data-purchase-batch-code]");
const purchaseReceivedAt = document.querySelector("[data-purchase-received-at]");
const purchaseExpiryDate = document.querySelector("[data-purchase-expiry-date]");
const purchaseExpiry = document.querySelector("[data-purchase-expiry]");
const purchaseCurrency = document.querySelector("[data-purchase-currency]");
const purchaseLandedCost = document.querySelector("[data-purchase-landed-cost]");
const purchaseDiscount = document.querySelector("[data-purchase-discount]");
const purchasePaid = document.querySelector("[data-purchase-paid]");
const purchaseSupplier = document.querySelector("[data-purchase-supplier]");
const purchaseTitle = document.querySelector("[data-purchase-title]");
const purchaseCartTable = document.querySelector("[data-purchase-cart]");
const purchaseTable = document.querySelector("[data-purchase-table]");
const purchaseSearch = document.querySelector("[data-purchase-search]");
const purchaseSupplierCard = document.querySelector("[data-purchase-supplier-card]");
const purchaseProductPreview = document.querySelector("[data-purchase-product-preview]");
const purchaseProductResults = document.querySelector("[data-purchase-product-results]");
const purchaseProductPager = document.querySelector("[data-purchase-product-pager]");
const purchaseCostPreview = document.querySelector("[data-purchase-cost-preview]");
const purchaseSuspendedList = document.querySelector("[data-purchase-suspended-list]");
const purchaseSuspendedCount = document.querySelector("[data-purchase-suspended-count]");
const finalizePurchaseButton = document.querySelector("[data-finalize-purchase]");
const suspendPurchaseButton = document.querySelector("[data-suspend-purchase]");
const printPurchaseButton = document.querySelector("[data-print-purchase]");
const exportPurchaseDraftButton = document.querySelector("[data-export-purchase-draft]");
const purchaseFormalBlocks = document.querySelectorAll("[data-purchase-formal]");
const purchaseSupplierLabel = document.querySelector("[data-purchase-supplier-label]");
const purchasePageTitle = document.querySelector("[data-purchase-page-title]");
const purchasePageEyebrow = document.querySelector("[data-purchase-page-eyebrow]");
const purchasePanelTitle = document.querySelector("[data-purchase-panel-title]");
const purchaseSummaryTitle = document.querySelector("[data-purchase-summary-title]");
const purchasePrefillProductKey = "tox-prefill-purchase-product";
let pendingPurchaseProductId = sessionStorage.getItem(purchasePrefillProductKey) || "";
let activePurchaseView = window.location.hash === "#create" ? "create" : "receive";
let purchaseProductPage = 1;
const purchaseProductPageSize = 12;
const purchaseMoneyPrecision = 10000;

function purchaseMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * purchaseMoneyPrecision) / purchaseMoneyPrecision;
}

function purchaseWholeAmount(value) {
  return Math.round(Number(value || 0));
}

function purchaseInputAmountToUsd(input) {
  return purchaseMoney(ToxStore.moneyToUsd(input?.value || 0, currentPurchaseCurrency()));
}

function purchaseUsdToAmount(value, currency = currentPurchaseCurrency()) {
  return ToxStore.convertUsd(purchaseMoney(value), currency);
}

function purchaseSafeDateValue(value) {
  return String(value || "").trim();
}

function todayPurchaseDate() {
  return new Date().toISOString().slice(0, 10);
}

function purchaseLineTotalUsd(quantity, unitCostUsd, currency = currentPurchaseCurrency()) {
  const unitCostAmount = ToxStore.convertUsd(unitCostUsd, currency);
  const totalAmount = purchaseWholeAmount(purchaseMoney(quantity) * unitCostAmount);
  return purchaseMoney(ToxStore.moneyToUsd(totalAmount, currency));
}

function selectedPurchaseProduct(state = ToxStore.getState()) {
  return state.products.find((item) => item.id === purchaseProduct.value) || null;
}

function selectedPurchaseUnit(product = selectedPurchaseProduct()) {
  return ToxStore.sellableUnits(product).find((entry) => entry.id === purchaseUnit.value)
    || ToxStore.sellableUnits(product)[0]
    || null;
}

function defaultPurchaseUnitCostAmount(product, unit, currency = currentPurchaseCurrency()) {
  if (!product || !unit) return 0;
  const storageCostUsd = Number(product.purchaseCostUsd || product.costUsd || 0);
  const unitMultiplier = Math.max(0.0001, Number(unit.multiplier || 1));
  const storageMultiplier = Math.max(0.0001, Number(product.stockUnitMultiplier || 1));
  return purchaseMoney(ToxStore.convertUsd(storageCostUsd * (unitMultiplier / storageMultiplier), currency));
}

function fillPurchaseLineDefaults(product, unit, { forceCost = false } = {}) {
  if (!product || !unit) return;
  if (purchaseQty && Number(purchaseQty.value || 0) <= 0) purchaseQty.value = "1";
  if (purchaseUnitCost && (forceCost || !Number(purchaseUnitCost.value || 0))) {
    purchaseUnitCost.value = String(defaultPurchaseUnitCostAmount(product, unit));
  }
}

function purchaseLineCostModel({ product = selectedPurchaseProduct(), unit = selectedPurchaseUnit(product), quantity = Number(purchaseQty?.value || 0), unitCostValue = purchaseUnitCost?.value } = {}) {
  const currency = currentPurchaseCurrency();
  const qty = purchaseMoney(quantity);
  const supplierUnitCostUsd = purchaseMoney(ToxStore.moneyToUsd(unitCostValue || 0, currency));
  const grossTotalUsd = purchaseLineTotalUsd(qty, supplierUnitCostUsd, currency);
  const landedCostShareUsd = purchaseInputAmountToUsd(purchaseLineCost);
  const discountShareUsd = purchaseInputAmountToUsd(purchaseLineDiscount);
  const totalUsd = purchaseMoney(Math.max(0, grossTotalUsd + landedCostShareUsd - discountShareUsd));
  const unitCostUsd = qty > 0 ? purchaseMoney(totalUsd / qty) : 0;
  const qtyInBase = product && unit ? ToxStore.quantityInBase(product, qty, unit.id) : 0;
  const baseUnitCostUsd = qtyInBase > 0 ? purchaseMoney(totalUsd / qtyInBase) : 0;
  const stockMultiplier = Math.max(0.0001, Number(product?.stockUnitMultiplier || 1));
  const storageUnitCostUsd = purchaseMoney(baseUnitCostUsd * stockMultiplier);
  const salePriceUsd = Number(unit?.priceUsd || 0);
  const profitUsd = salePriceUsd - unitCostUsd;
  const margin = salePriceUsd > 0 ? (profitUsd / salePriceUsd) * 100 : 0;
  const markup = unitCostUsd > 0 ? (profitUsd / unitCostUsd) * 100 : 0;
  return {
    currency,
    quantity: qty,
    supplierUnitCostUsd,
    grossTotalUsd,
    landedCostShareUsd,
    discountShareUsd,
    totalUsd,
    unitCostUsd,
    qtyInBase,
    baseUnitCostUsd,
    storageUnitCostUsd,
    profitUsd,
    margin,
    markup,
    status: profitUsd < 0 ? "loss" : salePriceUsd > 0 && margin < 8 ? "weak" : "ok"
  };
}

async function readBackendError(response) {
  try {
    const payload = await response.json();
    return payload?.message || payload?.reason || `HTTP_${response.status}`;
  } catch (error) {
    return `HTTP_${response.status}`;
  }
}

async function savePurchaseToBackend(payload) {
  const response = await ToxApi.fetch("/purchases-ledger/", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readBackendError(response));
  }
  return response.json();
}

function applyPurchasesHash() {
  activePurchaseView = window.location.hash === "#create" ? "create" : "receive";
  applyPurchaseView(ToxStore.getState());
  renderPurchaseCart(ToxStore.getState());
  if (activePurchaseView === "create") {
    window.setTimeout(() => (purchaseTitle || purchaseProduct)?.focus(), 120);
  } else {
    window.setTimeout(() => (purchaseProductSearch || purchaseProduct)?.focus(), 120);
  }
}

function applyPurchaseView(state = ToxStore.getState()) {
  const isCreate = activePurchaseView === "create";
  const titleKey = isCreate ? "purchaseCreateTitle" : "purchaseReceiveTitle";
  const eyebrowKey = isCreate ? "purchaseCreateEyebrow" : "purchaseReceiveEyebrow";
  document.body.dataset.purchaseView = activePurchaseView;
  document.querySelectorAll("[data-purchase-nav]").forEach((link) => {
    const active = link.dataset.purchaseNav === activePurchaseView;
    link.classList.toggle("primary", active);
    link.classList.toggle("ghost", !active);
    link.classList.toggle("active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
  });
  purchaseFormalBlocks.forEach((element) => {
    element.hidden = !isCreate;
  });
  if (purchasePageTitle) {
    purchasePageTitle.dataset.i18n = titleKey;
    purchasePageTitle.textContent = t(titleKey, state.lang);
  }
  if (purchasePageEyebrow) {
    purchasePageEyebrow.dataset.i18n = eyebrowKey;
    purchasePageEyebrow.textContent = t(eyebrowKey, state.lang);
  }
  if (purchasePanelTitle) {
    purchasePanelTitle.dataset.i18n = isCreate ? "purchaseCreateTitle" : "newPurchase";
    purchasePanelTitle.textContent = isCreate ? t("purchaseCreateTitle", state.lang) : t("newPurchase", state.lang);
  }
  if (purchaseSummaryTitle) {
    purchaseSummaryTitle.dataset.i18n = isCreate ? "settlement" : "quickReceiving";
    purchaseSummaryTitle.textContent = isCreate ? t("settlement", state.lang) : t("quickReceiving", state.lang);
  }
  if (purchaseSupplierLabel) {
    purchaseSupplierLabel.textContent = isCreate
      ? t("supplier", state.lang)
      : (state.lang === "ar" ? "المورد (اختياري)" : "Supplier (optional)");
  }
  if (finalizePurchaseButton) {
    finalizePurchaseButton.dataset.i18n = isCreate ? "addPurchase" : "receiveStockAction";
    finalizePurchaseButton.textContent = isCreate ? t("addPurchase", state.lang) : t("receiveStockAction", state.lang);
  }
  if (purchaseProductSearch) {
    purchaseProductSearch.placeholder = state.lang === "ar" ? "ابحث باسم المنتج أو الباركود" : "Search product or barcode";
  }
  document.title = isCreate ? "TOX | إنشاء فاتورة شراء" : "TOX | نقطة الشراء";
}

function currentPurchaseCurrency() {
  return purchaseCurrency.value || ToxStore.getState().currency;
}

function currentBusinessName(state) {
  return ToxStore.businessProfileName?.(state) || state.businessName || "TOX";
}

function currentBusinessMeta(state) {
  return ToxStore.businessProfileLine?.(state, currentBusinessName(state)) || currentBusinessName(state);
}

function productName(state, id) {
  return state.products.find((product) => product.id === id)?.name || "-";
}

function productBrand(state, id) {
  return state.products.find((product) => product.id === id)?.brand || "";
}

function purchaseEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function purchasableProducts(state) {
  return (state.products || []).filter((product) => ToxStore.sellableUnits(product).length);
}

function currentPurchaseWarehouseId() {
  return purchaseWarehouse?.value || "";
}

function purchaseProductSortKey(product = {}) {
  return `${product.brand || ""} ${product.name || ""}`.trim() || product.name || "";
}

function sortPurchaseProducts(products, state) {
  return [...(products || [])].sort((left, right) => (
    purchaseProductSortKey(left).localeCompare(purchaseProductSortKey(right), state.lang)
  ));
}

function uniquePurchaseProducts(products) {
  const seen = new Set();
  return (products || []).filter((product) => {
    const key = product?.id || product?.externalId || "";
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function warehousePurchasableProducts(state) {
  const warehouseId = currentPurchaseWarehouseId();
  if (!warehouseId) return [];
  return uniquePurchaseProducts(purchasableProducts(state).filter((product) => product.warehouseId === warehouseId));
}

function selectedPurchaseProductIsValidForWarehouse(state) {
  const product = state.products.find((item) => item.id === purchaseProduct.value);
  return !!product && !!currentPurchaseWarehouseId() && product.warehouseId === currentPurchaseWarehouseId();
}

function resetPurchaseProductPage() {
  purchaseProductPage = 1;
}

function clampPurchaseProductPage(total) {
  const pageCount = Math.max(1, Math.ceil(total / purchaseProductPageSize));
  purchaseProductPage = Math.min(Math.max(1, purchaseProductPage), pageCount);
  return pageCount;
}

function purchaseProductSearchFields(product, state) {
  return [
    product.name,
    product.brand,
    product.barcode,
    ...(product.units || []).map((unit) => unit.barcode)
  ];
}

function filteredPurchasableProducts(state) {
  const products = warehousePurchasableProducts(state);
  const query = (purchaseProductSearch?.value || "").trim();
  if (!query) return sortPurchaseProducts(products, state);
  return sortPurchaseProducts(uniquePurchaseProducts(products.filter((product) => (
    ToxStore.productMatchesSmartSearch(product, query, (entry) => purchaseProductSearchFields(entry, state), products)
  ))), state);
}

function purchaseProductOptionLabel(product, state) {
  const title = [product.brand, product.name].filter(Boolean).join(" - ") || product.name || "-";
  const meta = [
    ToxStore.getWarehouseName(product.warehouseId),
    ToxStore.sellableUnits(product).map((unit) => localizedUnitName(unit, state.lang)).filter(Boolean).slice(0, 2).join("، ")
  ].filter(Boolean).join(" | ");
  return meta ? `${title} - ${meta}` : title;
}

function purchasePercent(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString("ar-IQ", { maximumFractionDigits: 1 })}%`;
}

function purchaseProfitPreview(product, unit, currency = currentPurchaseCurrency()) {
  if (!product || !unit) return "";
  const model = purchaseLineCostModel({ product, unit });
  const currentCost = ToxStore.convertUsd(model.unitCostUsd, currency);
  const salePrice = ToxStore.convertUsd(unit.priceUsd || 0, currency);
  const profit = ToxStore.convertUsd(model.profitUsd, currency);
  const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;
  const markup = currentCost > 0 ? (profit / currentCost) * 100 : 0;
  const tone = profit > 0 ? "profit" : profit < 0 ? "loss" : "neutral";
  const oldStorageCost = ToxStore.convertUsd(product.purchaseCostUsd || 0, currency);
  const oldUnitCost = oldStorageCost * (Number(unit.multiplier || 1) / Math.max(0.0001, Number(product.stockUnitMultiplier || 1)));
  return `
    <span class="purchase-profit-preview ${tone}">
      <b>${ToxStore.formatMoney(ToxStore.moneyToUsd(profit, currency), currency)} ربح متوقع للوحدة</b>
      <small>سعر البيع الحالي ${ToxStore.formatMoney(unit.priceUsd || 0, currency)} | كلفة قديمة ${ToxStore.formatMoney(ToxStore.moneyToUsd(oldUnitCost, currency), currency)} | كلفة جديدة ${ToxStore.formatMoney(model.unitCostUsd, currency)} | هامش ${purchasePercent(margin)} | زيادة ${purchasePercent(markup)}</small>
    </span>
  `;
}

function purchaseImageMarkup(product, className = "product-choice-thumb") {
  const image = product?.image || product?.imageUrl || "";
  const initials = purchaseEscape((product?.name || "TOX").slice(0, 2));
  return `
    <span class="${className} ${image ? "" : "is-empty"}">
      ${image ? `<img src="${purchaseEscape(image)}" alt="" onerror="this.closest('span').classList.add('is-empty');this.outerHTML='<b>${initials}</b>'" />` : `<b>${initials}</b>`}
    </span>
  `;
}

function choosePurchaseProduct(productId, state = ToxStore.getState(), exactBarcodeMatch = null) {
  const product = warehousePurchasableProducts(state).find((entry) => entry.id === productId);
  if (!product) {
    purchaseProduct.value = "";
    hydrateUnits(state);
    renderPurchaseProductResults(state);
    renderPurchaseProductPreview(state);
    updatePurchaseControlsState(state);
    showNotice("هذا المنتج لا ينتمي إلى المستودع المحدد", "warning");
    return false;
  }
  if (![...purchaseProduct.options].some((option) => option.value === product.id)) {
    const option = document.createElement("option");
    option.value = product.id;
    option.textContent = purchaseProductOptionLabel(product, state);
    purchaseProduct.appendChild(option);
  }
  purchaseProduct.value = product.id;
  hydrateUnits(state);
  if (exactBarcodeMatch?.unit?.id && exactBarcodeMatch.product?.id === product.id && [...purchaseUnit.options].some((option) => option.value === exactBarcodeMatch.unit.id)) {
    purchaseUnit.value = exactBarcodeMatch.unit.id;
  }
  fillPurchaseLineDefaults(product, selectedPurchaseUnit(product), { forceCost: true });
  renderPurchaseProductResults(state);
  renderPurchaseProductPreview(state);
  updatePurchaseControlsState(state);
  purchaseQty?.focus();
  return true;
}

function renderPurchaseProductResults(state = ToxStore.getState()) {
  if (!purchaseProductResults) return;
  const warehouseId = currentPurchaseWarehouseId();
  const query = (purchaseProductSearch?.value || "").trim();
  const matches = warehouseId ? filteredPurchasableProducts(state) : [];
  const pageCount = clampPurchaseProductPage(matches.length);
  const pageStart = (purchaseProductPage - 1) * purchaseProductPageSize;
  const pageMatches = matches.slice(pageStart, pageStart + purchaseProductPageSize);
  const emptyText = !warehouseId
    ? "اختر المستودع أولاً"
    : query
      ? "لا يوجد منتج مطابق داخل هذا المستودع"
      : "لا توجد منتجات في هذا المستودع";
  purchaseProductResults.innerHTML = pageMatches.length
    ? pageMatches.map((product) => {
      const units = ToxStore.sellableUnits(product);
      const firstUnit = units[0] || {};
      return `
        <button class="purchase-product-result ${product.id === purchaseProduct.value ? "active" : ""}" type="button" data-purchase-pick-product="${purchaseEscape(product.id)}">
          ${purchaseImageMarkup(product, "purchase-result-thumb")}
          <span>
            <strong>${purchaseEscape([product.brand, product.name].filter(Boolean).join(" - ") || product.name || "-")}</strong>
            <small>${purchaseEscape([ToxStore.getWarehouseName(product.warehouseId), ToxStore.stockSummary(product), units.map((unit) => unit.name).slice(0, 2).join("، ")].filter(Boolean).join(" | "))}</small>
          </span>
          <b>${ToxStore.formatMoney(firstUnit.priceUsd || 0, currentPurchaseCurrency())}</b>
        </button>
      `;
    }).join("")
    : `<div class="purchase-product-result empty">${purchaseEscape(emptyText)}</div>`;
  if (purchaseProductPager) {
    const rangeEnd = Math.min(matches.length, pageStart + pageMatches.length);
    purchaseProductPager.hidden = !warehouseId || matches.length <= purchaseProductPageSize;
    purchaseProductPager.innerHTML = matches.length > purchaseProductPageSize
      ? `
        <button class="button ghost" type="button" data-purchase-page-prev ${purchaseProductPage <= 1 ? "disabled" : ""}>السابق</button>
        <span>${purchaseEscape(`${pageStart + 1}-${rangeEnd} من ${matches.length}`)}</span>
        <button class="button ghost" type="button" data-purchase-page-next ${purchaseProductPage >= pageCount ? "disabled" : ""}>التالي</button>
      `
      : "";
    purchaseProductPager.querySelector("[data-purchase-page-prev]")?.addEventListener("click", () => {
      purchaseProductPage = Math.max(1, purchaseProductPage - 1);
      renderPurchaseProductResults(state);
    });
    purchaseProductPager.querySelector("[data-purchase-page-next]")?.addEventListener("click", () => {
      purchaseProductPage = Math.min(pageCount, purchaseProductPage + 1);
      renderPurchaseProductResults(state);
    });
  }
  purchaseProductResults.querySelectorAll("[data-purchase-pick-product]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      choosePurchaseProduct(button.dataset.purchasePickProduct, state);
    });
  });
}

function purchaseReadinessMessage(issue = {}) {
  const unit = issue.details?.unitName ? ` (${issue.details.unitName})` : "";
  const margin = Number(issue.details?.margin);
  const marginText = Number.isFinite(margin) ? ` (${purchasePercent(margin)})` : "";
  return ({
    UNIT_SALE_LOSS: `سعر البيع الحالي أقل من كلفة المورد${unit}.`,
    LOW_UNIT_MARGIN: `هامش الربح منخفض بعد كلفة المورد${marginText}${unit}.`,
    MISSING_SELLING_PRICE: "لا توجد وحدة بيع بسعر صالح.",
    MISSING_PURCHASE_COST: "كلفة المورد مطلوبة.",
    IRAQI_ROUNDING: `السعر غير مقرب عراقياً${unit}.`,
    MISSING_STORAGE_SELL_UNIT: "وحدة التخزين غير موجودة كوحدة بيع."
  })[issue.code] || issue.message || "مشكلة في ربح المنتج بعد شراء المورد.";
}

function validatePurchaseLineReadiness(product, unit, unitCostUsd, { show = true } = {}) {
  if (!product || !unit) return false;
  const selectedMultiplier = Math.max(0.0001, Number(unit.multiplier || 1));
  const storageMultiplier = Math.max(0.0001, Number(product.stockUnitMultiplier || 1));
  const candidateStorageCostUsd = Number(unitCostUsd || 0) * (storageMultiplier / selectedMultiplier);
  const validation = ToxStore.validateProductReadiness?.({
    ...product,
    purchaseCostUsd: candidateStorageCostUsd
  }, { minMargin: 8 });
  if (!validation || validation.ok) {
    const warnings = (validation?.issues || []).filter((issue) => issue.severity === "warning").slice(0, 3);
    if (show && warnings.length) showNotice(`تنبيه تسعير: ${warnings.map(purchaseReadinessMessage).join(" | ")}`, "warning");
    return true;
  }
  const issues = (validation.blocking?.length ? validation.blocking : validation.issues || []).slice(0, 4);
  if (show && issues.length) showNotice(`تنبيه كلفة شراء: ${issues.map(purchaseReadinessMessage).join(" | ")}`, "warning");
  return true;
}

function exactPurchaseProductBarcodeMatch(state) {
  const query = (purchaseProductSearch?.value || "").trim();
  const warehouseId = currentPurchaseWarehouseId();
  if (!query) return null;
  if (!warehouseId) return null;
  const match = ToxStore.findProductByBarcode(query);
  if (!match?.product || !ToxStore.sellableUnits(match.product).length) return null;
  if (match.product.warehouseId !== warehouseId) return null;
  if (!warehousePurchasableProducts(state).some((product) => product.id === match.product.id)) return null;
  return match;
}

function renderPurchaseProductPreview(state = ToxStore.getState()) {
  if (!purchaseProductPreview) return;
  const product = state.products.find((item) => item.id === purchaseProduct.value);
  const unit = ToxStore.sellableUnits(product).find((entry) => entry.id === purchaseUnit.value) || ToxStore.sellableUnits(product)[0];
  if (!product) {
    purchaseProductPreview.hidden = true;
    purchaseProductPreview.innerHTML = "";
    if (purchaseCostPreview) purchaseCostPreview.innerHTML = "";
    return;
  }
  const title = [product.brand, product.name].filter(Boolean).join(" - ") || product.name || "-";
  const meta = [
    unit ? localizedUnitName(unit, state.lang) : "",
    ToxStore.getWarehouseName(product.warehouseId),
    ToxStore.stockSummary(product)
  ].filter(Boolean).join(" | ");
  const profitMarkup = purchaseProfitPreview(product, unit, currentPurchaseCurrency());
  purchaseProductPreview.hidden = false;
  purchaseProductPreview.innerHTML = `
    ${purchaseImageMarkup(product)}
    <span class="product-choice-copy">
      <strong>${purchaseEscape(title)}</strong>
      <small>${purchaseEscape(meta)}</small>
      ${profitMarkup}
    </span>
  `;
  renderPurchaseCostPreview(state);
}

function renderPurchaseCostPreview(state = ToxStore.getState()) {
  if (!purchaseCostPreview) return;
  const product = selectedPurchaseProduct(state);
  const unit = selectedPurchaseUnit(product);
  if (!product || !unit) {
    purchaseCostPreview.innerHTML = "";
    return;
  }
  const model = purchaseLineCostModel({ product, unit });
  const tone = model.status === "loss" ? "loss" : model.status === "weak" ? "weak" : "profit";
  const status = model.status === "loss" ? "يحتاج مراجعة سعر" : model.status === "weak" ? "هامش منخفض" : "الكلفة متوازنة";
  purchaseCostPreview.innerHTML = `
    <div class="purchase-cost-grid ${tone}">
      <span><small>كلفة الأساس</small><b>${ToxStore.formatMoney(model.baseUnitCostUsd, model.currency)}</b></span>
      <span><small>كلفة ${purchaseEscape(product.stockUnitName || product.baseUnit || "")}</small><b>${ToxStore.formatMoney(model.storageUnitCostUsd, model.currency)}</b></span>
      <span><small>إجمالي السطر</small><b>${ToxStore.formatMoney(model.totalUsd, model.currency)}</b></span>
      <strong>${status}</strong>
    </div>
  `;
}

function expiryDate(days) {
  const count = Number(days || 0);
  if (!count) return "";
  const date = new Date();
  date.setDate(date.getDate() + count);
  return date.toISOString();
}

function purchaseLineExpiryIso() {
  const explicit = purchaseSafeDateValue(purchaseExpiryDate?.value);
  if (explicit) return new Date(`${explicit}T12:00:00`).toISOString();
  return expiryDate(purchaseExpiry?.value);
}

function purchaseLineReceivedIso() {
  const explicit = purchaseSafeDateValue(purchaseReceivedAt?.value);
  return explicit ? new Date(`${explicit}T12:00:00`).toISOString() : new Date().toISOString();
}

function hydrateUnits(state) {
  const product = state.products.find((item) => item.id === purchaseProduct.value);
  const units = ToxStore.sellableUnits(product);
  purchaseUnit.innerHTML = units.map((unit) => `<option value="${purchaseEscape(unit.id)}">${purchaseEscape(localizedUnitName(unit, state.lang))}</option>`).join("");
  renderPurchaseProductPreview(state);
}

function updatePurchaseControlsState(state) {
  const allPurchasableProducts = purchasableProducts(state);
  const formDisabled = !allPurchasableProducts.length || !state.warehouses.length || !purchaseProduct.value || !currentPurchaseWarehouseId();
  purchaseLineForm.querySelectorAll("input,select,button").forEach((element) => {
    if (element === purchaseCurrency || element === purchaseSupplier || element === purchaseProductSearch || element === purchaseWarehouse) return;
    if (element.closest("[data-purchase-product-results]") || element.closest("[data-purchase-product-pager]")) return;
    element.disabled = formDisabled;
  });
  if (purchaseWarehouse) purchaseWarehouse.disabled = !state.warehouses.length;
  if (purchaseProductSearch) purchaseProductSearch.disabled = !state.warehouses.length;
  finalizePurchaseButton.disabled = !purchaseCart.length;
  suspendPurchaseButton.disabled = activePurchaseView !== "create" || !purchaseCart.length;
  printPurchaseButton.disabled = activePurchaseView !== "create" || !purchaseCart.length;
  exportPurchaseDraftButton.disabled = activePurchaseView !== "create" || !purchaseCart.length;
}

function refreshPurchaseProductPicker(state, { resetPage = false } = {}) {
  if (resetPage) resetPurchaseProductPage();
  const filteredProducts = filteredPurchasableProducts(state);
  if (purchaseProduct.value && !filteredProducts.some((product) => product.id === purchaseProduct.value)) {
    purchaseProduct.value = "";
    hydrateUnits(state);
  }
  renderPurchaseProductResults(state);
  renderPurchaseProductPreview(state);
  updatePurchaseControlsState(state);
}

function hydratePurchaseForm(state) {
  applyPurchaseView(state);
  const selectedProduct = purchaseProduct.value;
  const selectedWarehouse = purchaseWarehouse.value;
  const selectedSupplier = purchaseSupplier.value;
  const allPurchasableProducts = purchasableProducts(state);
  const emptyProductLabel = state.lang === "ar" ? "لا يوجد منتج مطابق" : "No matching product";
  const searchQuery = (purchaseProductSearch?.value || "").trim();
  const warehousePlaceholder = state.lang === "ar" ? "اختر المستودع" : "Select warehouse";
  purchaseWarehouse.innerHTML = state.warehouses.length
    ? `<option value="">${purchaseEscape(warehousePlaceholder)}</option>${state.warehouses.map((warehouse) => `<option value="${purchaseEscape(warehouse.id)}">${purchaseEscape(warehouse.name)}</option>`).join("")}`
    : '<option value="">-</option>';
  if (state.warehouses.some((warehouse) => warehouse.id === selectedWarehouse)) {
    purchaseWarehouse.value = selectedWarehouse;
  } else if (pendingPurchaseProductId) {
    const pendingProductWarehouse = allPurchasableProducts.find((product) => product.id === pendingPurchaseProductId)?.warehouseId || "";
    if (state.warehouses.some((warehouse) => warehouse.id === pendingProductWarehouse)) purchaseWarehouse.value = pendingProductWarehouse;
  }
  const filteredProducts = filteredPurchasableProducts(state);
  const exactBarcodeMatch = exactPurchaseProductBarcodeMatch(state);
  const appliedPrefillProduct = !searchQuery
    && pendingPurchaseProductId
    && filteredProducts.some((product) => product.id === pendingPurchaseProductId);
  const exactProductId = exactBarcodeMatch?.product?.id || "";
  const optionProducts = uniquePurchaseProducts(filteredProducts);
  const currentSelectedProduct = filteredProducts.find((product) => product.id === selectedProduct);
  const pendingProduct = filteredProducts.find((product) => product.id === pendingPurchaseProductId);
  [currentSelectedProduct, pendingProduct, exactBarcodeMatch?.product].forEach((product) => {
    if (product && !optionProducts.some((entry) => entry.id === product.id)) optionProducts.unshift(product);
  });
  const uniqueOptionProducts = uniquePurchaseProducts(optionProducts);
  purchaseProduct.innerHTML = optionProducts.length
    ? `<option value="">${purchaseEscape(state.lang === "ar" ? "اختر المنتج" : "Select product")}</option>${uniqueOptionProducts
      .slice(0, purchaseProductPageSize)
      .map((product) => `<option value="${purchaseEscape(product.id)}">${purchaseEscape(purchaseProductOptionLabel(product, state))}</option>`)
      .join("")}`
    : `<option value="">${purchaseEscape(emptyProductLabel)}</option>`;
  if (appliedPrefillProduct) {
    purchaseProduct.value = pendingPurchaseProductId;
    sessionStorage.removeItem(purchasePrefillProductKey);
    pendingPurchaseProductId = "";
  }
  const supplierPlaceholder = activePurchaseView === "receive"
    ? (state.lang === "ar" ? "استلام مباشر بدون مورد" : "Direct receipt without supplier")
    : t("supplier", state.lang);
  purchaseSupplier.innerHTML = `<option value="">${purchaseEscape(supplierPlaceholder)}</option>${state.suppliers.map((supplier) => `<option value="${purchaseEscape(supplier.id)}">${purchaseEscape(supplier.name)}</option>`).join("")}`;
  if (!appliedPrefillProduct && exactProductId && filteredProducts.some((product) => product.id === exactProductId)) {
    purchaseProduct.value = exactProductId;
  } else if (!appliedPrefillProduct && filteredProducts.some((product) => product.id === selectedProduct)) {
    purchaseProduct.value = selectedProduct;
  } else if (!appliedPrefillProduct && optionProducts.some((product) => product.id === selectedProduct)) {
    purchaseProduct.value = selectedProduct;
  } else if (!optionProducts.length) {
    purchaseProduct.value = "";
  }
  if (!selectedPurchaseProductIsValidForWarehouse(state)) purchaseProduct.value = "";
  if ([...purchaseSupplier.options].some((option) => option.value === selectedSupplier)) purchaseSupplier.value = selectedSupplier;
  hydrateUnits(state);
  if (exactBarcodeMatch?.unit?.id && [...purchaseUnit.options].some((option) => option.value === exactBarcodeMatch.unit.id)) {
    purchaseUnit.value = exactBarcodeMatch.unit.id;
  }
  document.querySelector("[data-purchase-date]").textContent = new Date().toLocaleDateString();
  renderPurchaseProductResults(state);
  renderSupplierCard(state);
  renderPurchaseProductPreview(state);

  updatePurchaseControlsState(state);
}

function renderSupplierCard(state) {
  const supplier = state.suppliers.find((entry) => entry.id === purchaseSupplier.value);
  const title = purchaseSupplierCard.querySelector("strong");
  const meta = purchaseSupplierCard.querySelector("small");
  if (!supplier) {
    title.textContent = currentBusinessName(state);
    meta.textContent = currentBusinessMeta(state);
    return;
  }
  const stats = ToxStore.supplierStats(supplier.id);
  title.textContent = supplier.name;
  meta.textContent = `${supplier.city || "-"} | ${supplier.phone || "-"} | ${ToxStore.formatMoney(stats.debtUsd, state.currency)}`;
}

function purchaseSubtotalUsd() {
  return purchaseMoney(allocatedPurchaseItems().reduce((sum, item) => sum + purchaseMoney(item.totalUsd), 0));
}

function purchaseInvoiceAdjustmentUsd(input) {
  return purchaseInputAmountToUsd(input);
}

function allocatedPurchaseItems() {
  const grossSum = purchaseCart.reduce((sum, item) => sum + purchaseMoney(item.grossTotalUsd ?? item.totalUsd), 0);
  const invoiceLandedUsd = purchaseInvoiceAdjustmentUsd(purchaseLandedCost);
  const invoiceDiscountUsd = purchaseInvoiceAdjustmentUsd(purchaseDiscount);
  return purchaseCart.map((item, index) => {
    const product = ToxStore.getState().products.find((entry) => entry.id === item.productId);
    const weight = grossSum > 0 ? purchaseMoney(item.grossTotalUsd ?? item.totalUsd) / grossSum : 0;
    const allocatedLanded = index === purchaseCart.length - 1
      ? purchaseMoney(invoiceLandedUsd - purchaseCart.slice(0, index).reduce((sum, entry) => sum + purchaseMoney((entry.grossTotalUsd ?? entry.totalUsd) / Math.max(grossSum, 1) * invoiceLandedUsd), 0))
      : purchaseMoney(invoiceLandedUsd * weight);
    const allocatedDiscount = index === purchaseCart.length - 1
      ? purchaseMoney(invoiceDiscountUsd - purchaseCart.slice(0, index).reduce((sum, entry) => sum + purchaseMoney((entry.grossTotalUsd ?? entry.totalUsd) / Math.max(grossSum, 1) * invoiceDiscountUsd), 0))
      : purchaseMoney(invoiceDiscountUsd * weight);
    const landedCostShareUsd = purchaseMoney((item.lineLandedCostUsd || 0) + allocatedLanded);
    const discountShareUsd = purchaseMoney((item.lineDiscountUsd || 0) + allocatedDiscount);
    const totalUsd = purchaseMoney(Math.max(0, (item.grossTotalUsd ?? item.totalUsd) + landedCostShareUsd - discountShareUsd));
    const quantity = purchaseMoney(item.quantity);
    const qtyInBase = product ? ToxStore.quantityInBase(product, quantity, item.unitId) : item.qtyInBase;
    const unitCostUsd = quantity > 0 ? purchaseMoney(totalUsd / quantity) : 0;
    const baseUnitCostUsd = qtyInBase > 0 ? purchaseMoney(totalUsd / qtyInBase) : 0;
    const storageUnitCostUsd = purchaseMoney(baseUnitCostUsd * Math.max(0.0001, Number(product?.stockUnitMultiplier || 1)));
    return {
      ...item,
      allocatedLandedCostUsd: allocatedLanded,
      allocatedDiscountUsd: allocatedDiscount,
      landedCostShareUsd,
      discountShareUsd,
      totalUsd,
      unitCostUsd,
      baseUnitCostUsd,
      storageUnitCostUsd,
      qtyInBase
    };
  });
}

function purchaseLineStatus(product, item) {
  const unit = ToxStore.sellableUnits(product).find((entry) => entry.id === item.unitId);
  const salePrice = Number(unit?.priceUsd || 0);
  const profit = salePrice - Number(item.unitCostUsd || 0);
  const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;
  if (profit < 0) return { tone: "loss", text: "يحتاج مراجعة سعر" };
  if (salePrice > 0 && margin < 8) return { tone: "weak", text: "هامش منخفض" };
  return { tone: "ok", text: "جاهز" };
}

function renderPurchaseCart(state) {
  const subtotal = purchaseSubtotalUsd();
  const paidUsd = activePurchaseView === "receive"
    ? subtotal
    : ToxStore.moneyToUsd(purchasePaid.value, currentPurchaseCurrency());
  const debt = Math.max(0, subtotal - paidUsd);
  document.querySelector("[data-purchase-subtotal]").textContent = ToxStore.formatMoney(subtotal, currentPurchaseCurrency());
  document.querySelector("[data-purchase-balance]").textContent = ToxStore.formatMoney(debt, currentPurchaseCurrency());

  const allocatedItems = allocatedPurchaseItems();
  purchaseCartTable.innerHTML = allocatedItems.length
    ? allocatedItems.map((item, index) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      const status = purchaseLineStatus(product, item);
      return `
      <tr class="cart-row">
        <td>
          <div class="purchase-cart-product">
            ${purchaseImageMarkup(product, "purchase-cart-thumb")}
            <span><strong>${purchaseEscape(productName(state, item.productId))}</strong><small>${purchaseEscape(productBrand(state, item.productId) || "-")}</small></span>
          </div>
        </td>
        <td>${purchaseEscape(ToxStore.getWarehouseName(item.warehouseId))}</td>
        <td>${purchaseEscape(item.quantity)} ${purchaseEscape(item.unitName)}</td>
        <td>${ToxStore.formatMoney(item.unitCostUsd, currentPurchaseCurrency())}</td>
        <td>${ToxStore.formatMoney(item.baseUnitCostUsd, currentPurchaseCurrency())}</td>
        <td><strong>${ToxStore.formatMoney(item.totalUsd, currentPurchaseCurrency())}</strong></td>
        <td>${item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : "-"}</td>
        <td><span class="purchase-line-status ${purchaseEscape(status.tone)}">${purchaseEscape(status.text)}</span></td>
        <td><button class="button ghost" type="button" data-remove-purchase-line="${index}">${t("delete", state.lang)}</button></td>
      </tr>
    `; }).join("")
    : `<tr class="cart-empty-row"><td colspan="9">${t("noProducts", state.lang)}</td></tr>`;

  document.querySelectorAll("[data-remove-purchase-line]").forEach((button) => {
    button.addEventListener("click", () => {
      purchaseCart.splice(Number(button.dataset.removePurchaseLine), 1);
      renderPurchaseCart(ToxStore.getState());
      hydratePurchaseForm(ToxStore.getState());
    });
  });

  finalizePurchaseButton.disabled = !purchaseCart.length;
  suspendPurchaseButton.disabled = activePurchaseView !== "create" || !purchaseCart.length;
  printPurchaseButton.disabled = activePurchaseView !== "create" || !purchaseCart.length;
  exportPurchaseDraftButton.disabled = activePurchaseView !== "create" || !purchaseCart.length;

  return { subtotal, paidUsd, debt };
}

function purchaseMatches(state, purchase, query) {
  if (!query) return true;
  const haystack = [
    purchase.id,
    purchase.supplierName,
    purchase.note,
    ...(ToxStore.purchaseItems(purchase).map((item) => `${productName(state, item.productId)} ${productBrand(state, item.productId)} ${ToxStore.getWarehouseName(item.warehouseId)} ${item.unitName}`))
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function buildPurchaseSnapshot(state) {
  const summary = renderPurchaseCart(state);
  return {
    id: `PDRAFT-${Date.now()}`,
    title: purchaseTitle?.value || "",
    createdAt: new Date().toLocaleString(),
    supplierId: purchaseSupplier.value || null,
    supplierName: purchaseSupplier.options[purchaseSupplier.selectedIndex]?.textContent || currentBusinessName(state),
    currency: currentPurchaseCurrency(),
    exchangeRate: state.exchangeRate,
    paidUsd: summary.paidUsd,
    costUsd: summary.subtotal,
    debtUsd: summary.debt,
    note: document.querySelector("[data-purchase-note]").value || "",
    items: allocatedPurchaseItems()
  };
}

function printThemeClass(state) {
  if (state.theme === "coffee" || state.theme === "summer-orange") return "coffee-print";
  if (state.theme === "neon-blue") return "neon-print";
  if (state.theme === "teal-slate") return "teal-print";
  return "";
}

function purchaseHtml(state, purchase, title) {
  const isArabic = state.lang === "ar";
  const activePrintTheme = printThemeClass(state);
  const label = (value) => purchaseEscape(ToxStore.repairText ? ToxStore.repairText(value) : value);
  const purchaseDate = new Date(purchase.createdAt || Date.now()).toLocaleString(isArabic ? "ar-IQ" : "en-US");
  const purchaseStatus = purchase.debtUsd > 0 ? (isArabic ? "باقي للمورد" : "Supplier Balance") : (isArabic ? "مسددة" : "Paid");
  const rows = purchase.items.map((item, index) => {
    const brand = item.brand || productBrand(state, item.productId);
    const meta = [brand, ToxStore.getWarehouseName(item.warehouseId)].filter(Boolean).join(" | ");
    return `
      <tr>
        <td class="index">${index + 1}</td>
        <td><strong>${purchaseEscape(productName(state, item.productId))}</strong><small class="item-meta">${purchaseEscape(meta || "-")}</small></td>
        <td>${purchaseEscape(item.quantity)}</td>
        <td>${purchaseEscape(localizedUnitName({ id: item.unitId || item.unit, name: item.unitName }, state.lang))}</td>
        <td>${ToxStore.formatMoney(item.unitCostUsd, purchase.currency)}</td>
        <td>${ToxStore.formatMoney(item.totalUsd, purchase.currency)}</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html lang="${state.lang}" dir="${isArabic ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8">
  <title>${label(title)}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:30px;background:#eef2f7;color:#0f172a;font-family:"Segoe UI","Noto Kufi Arabic",Tahoma,Arial,sans-serif}
    .sheet{position:relative;max-width:1040px;margin:auto;background:#fff;border:1px solid #dbe3ee;border-radius:22px;overflow:hidden;box-shadow:0 28px 90px rgba(15,23,42,.14)}
    .hero{display:grid;grid-template-columns:1fr auto;gap:22px;padding:30px 34px;background:linear-gradient(135deg,#064e3b,#047857 60%,#10b981);color:white}
    .brand{display:flex;gap:16px;align-items:center}.mark{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);font-weight:900;font-size:18px}
    h1,h2,p{margin:0}.brand h1{font-size:32px}.brand p,.badge p{color:rgba(255,255,255,.78);margin-top:5px}
    .badge{min-width:250px;text-align:${isArabic ? "left" : "right"};padding:16px 18px;border-radius:18px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25)}
    .badge strong{display:block;font-size:22px}.ribbon{padding:12px 34px;background:#ecfdf5;color:#047857;font-weight:900;border-bottom:1px solid #d1fae5}
    .meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#e2e8f0;border-bottom:1px solid #e2e8f0}
    .meta div{padding:14px 18px;background:#f8fafc}.meta span,.totals span,small{color:#64748b}.meta strong{display:block;margin-top:4px}
    .content{padding:30px 34px}table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #dbe3ee;border-radius:16px;overflow:hidden}
    th{background:#f8fafc;color:#475569;font-size:12px;text-transform:uppercase}th,td{padding:13px 12px;border-bottom:1px solid #e5e7eb;text-align:${isArabic ? "right" : "left"};vertical-align:top}
    tbody tr:nth-child(even) td{background:#fbfdff}tr:last-child td{border-bottom:0}.index{width:42px;color:#94a3b8;font-weight:800}td strong,td small{display:block}
    .item-meta{display:inline-block;margin-top:6px;padding:4px 9px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:11px;font-weight:700}
    .footer{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.42fr);gap:24px;margin-top:24px;align-items:start}
    .note{min-height:132px;border:1px dashed #cbd5e1;border-radius:16px;background:#f8fafc;padding:16px;color:#64748b}
    .totals{border:1px solid #dbe3ee;border-radius:16px;overflow:hidden}.total-row{display:flex;justify-content:space-between;gap:16px;padding:13px 16px;border-bottom:1px solid #e5e7eb}.total-row:last-child{border-bottom:0}
    .grand{background:#ecfdf5}.grand strong{font-size:25px;color:#047857}.debt strong{color:#be123c}.paid strong{color:#047857}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px;color:#64748b}.signatures div{padding-top:18px;border-top:1px solid #cbd5e1}
    .stamp{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border:1px solid #047857;border-radius:999px;background:#fff;color:#047857;font-weight:900}
    .watermark{position:absolute;inset:auto 30px 30px auto;font-size:110px;font-family:Georgia,serif;font-style:italic;font-weight:900;color:rgba(4,120,87,.045);pointer-events:none}
    .mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:18px 34px;border-bottom:1px solid #e5e7eb;background:#fff}
    .mini-grid div{padding:13px 14px;border:1px solid #e5e7eb;border-radius:14px;background:#fbfdff}.mini-grid span{display:block;color:#64748b;font-size:12px}.mini-grid strong{display:block;margin-top:4px;color:#064e3b}
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
      <div class="brand"><div class="mark">TOX</div><div><h1>${purchaseEscape(currentBusinessName(state))}</h1><p>${purchaseEscape(currentBusinessMeta(state))}</p></div></div>
      <div class="badge"><span>${label(title)}</span><strong>${purchaseEscape(purchase.id)}</strong><p>${purchaseEscape(purchaseDate)}</p></div>
    </section>
    <div class="ribbon">${purchaseEscape(purchase.title || (isArabic ? "فاتورة شراء واستلام مخزون" : "Purchase & Stock Receiving Invoice"))}</div>
    <section class="mini-grid">
      <div><span>${isArabic ? "رقم الشراء" : "Purchase No"}</span><strong>${purchaseEscape(purchase.id)}</strong></div>
      <div><span>${isArabic ? "التاريخ" : "Date"}</span><strong>${purchaseEscape(purchaseDate)}</strong></div>
      <div><span>${isArabic ? "الحالة" : "Status"}</span><strong>${purchaseEscape(purchaseStatus)}</strong></div>
    </section>
    <section class="meta">
      <div><span>${label(t("supplier", state.lang))}</span><strong>${purchaseEscape(purchase.supplierName || "-")}</strong></div>
      <div><span>${label(t("exchangeRate", state.lang))}</span><strong>1 USD = ${Number(purchase.exchangeRate || state.exchangeRate || 0).toLocaleString("en-US")} IQD</strong></div>
      <div><span>${label(t("note", state.lang))}</span><strong>${purchaseEscape(purchase.note || "-")}</strong></div>
    </section>
    <section class="content">
      <table><thead><tr><th>#</th><th>${label(t("product", state.lang))}</th><th>${label(t("qty", state.lang))}</th><th>${label(t("unit", state.lang))}</th><th>${label(t("purchaseCost", state.lang))}</th><th>${label(t("total", state.lang))}</th></tr></thead><tbody>${rows}</tbody></table>
      <section class="footer">
        <div class="note">${isArabic ? "ملاحظة: تحفظ هذه الفاتورة لمطابقة المورد والكميات وتاريخ الاستلام وتكلفة المخزون." : "Note: Keep this invoice for supplier reconciliation, received quantities, and inventory cost review."}</div>
        <div class="totals">
          <div class="total-row"><span>${label(t("subtotal", state.lang))}</span><strong>${ToxStore.formatMoney(purchase.costUsd, purchase.currency)}</strong></div>
          <div class="total-row paid"><span>${label(t("paidNow", state.lang))}</span><strong>${ToxStore.formatMoney(purchase.paidUsd, purchase.currency)}</strong></div>
          <div class="total-row grand"><span>${label(t("debt", state.lang))}</span><strong>${ToxStore.formatMoney(purchase.debtUsd, purchase.currency)}</strong></div>
        </div>
      </section>
      <section class="signatures"><div>${isArabic ? "توقيع المستلم" : "Receiver signature"}</div><div>${isArabic ? "توقيع المورد" : "Supplier signature"}</div></section>
    </section>
  </main>
</body>
</html>`;
}

function exportDraftPurchase() {
  if (!purchaseCart.length) return;
  const state = ToxStore.getState();
  const purchase = buildPurchaseSnapshot(state);
  const documentType = activePurchaseView === "receive" ? "directPurchase" : "purchaseInvoice";
  const html = window.ToxPrint?.html
    ? ToxPrint.html(documentType, { ...purchase, title: t("exportDraft", state.lang) }, state)
    : purchaseHtml(state, purchase, t("exportDraft", state.lang));
  const blob = new Blob([html], { type: "text/html" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${purchase.id}.html`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
  playUiSound("success");
}

function printActivePurchase() {
  if (!purchaseCart.length) return;
  const state = ToxStore.getState();
  const purchase = buildPurchaseSnapshot(state);
  const documentType = activePurchaseView === "receive" ? "directPurchase" : "purchaseInvoice";
  if (window.ToxPrint?.render) {
    ToxPrint.render(documentType, { ...purchase, title: t("purchaseTitle", state.lang) }, state);
    return;
  }
  const printWindow = window.open("", "_blank", "width=1100,height=780");
  if (!printWindow) return;
  printWindow.document.write(purchaseHtml(state, purchase, t("purchaseTitle", state.lang)));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  playUiSound("print");
}

function renderSuspendedPurchases(state) {
  purchaseSuspendedCount.textContent = state.suspendedPurchases.length;
  purchaseSuspendedList.innerHTML = state.suspendedPurchases.map((purchase) => `
    <div class="ledger-item">
      <span><strong>${purchaseEscape(purchase.id)}</strong><br><small>${purchaseEscape(purchase.supplierName || t("supplier", state.lang))}</small></span>
      <strong>${ToxStore.formatMoney(purchase.costUsd || 0, purchase.currency || state.currency)}</strong>
      <button class="button ghost" type="button" data-resume-purchase="${purchaseEscape(purchase.id)}">${purchaseEscape(t("activeInvoice", state.lang))}</button>
    </div>
  `).join("") || `<div class="warehouse-empty">${purchaseEscape(t("noInvoices", state.lang))}</div>`;

  document.querySelectorAll("[data-resume-purchase]").forEach((button) => {
    button.addEventListener("click", () => {
      const purchase = ToxStore.resumeSuspendedPurchase(button.dataset.resumePurchase);
      if (!purchase) return;
      purchaseCart.splice(0, purchaseCart.length, ...(purchase.items || []));
      purchasePaid.value = ToxStore.convertUsd(purchase.paidUsd || 0, purchase.currency || state.currency);
      purchaseCurrency.value = purchase.currency || state.currency;
      purchaseSupplier.value = purchase.supplierId || "";
      if (purchaseTitle) purchaseTitle.value = purchase.title || "";
      document.querySelector("[data-purchase-note]").value = purchase.note || "";
      renderPurchases(ToxStore.getState());
      playUiSound("success");
    });
  });
}

function renderPurchases(state) {
  hydratePurchaseForm(state);
  renderPurchaseCart(state);
  renderSuspendedPurchases(state);
  const activePurchases = state.purchases.filter((purchase) => !purchase.isVoided && purchase.paymentStatus !== "void");
  const total = activePurchases.reduce((sum, purchase) => sum + Number(purchase.costUsd || 0), 0);
  const debt = activePurchases.reduce((sum, purchase) => sum + ToxStore.purchaseDebt(purchase), 0);
  const totalQty = activePurchases.reduce((sum, purchase) => sum + ToxStore.purchaseItems(purchase).reduce((inner, item) => inner + Number(item.quantity || 0), 0), 0);
  const query = purchaseSearch.value.trim().toLowerCase();
  const purchases = state.purchases.filter((purchase) => purchaseMatches(state, purchase, query));

  document.querySelector("[data-purchase-total]").textContent = ToxStore.formatMoney(total, state.currency);
  document.querySelector("[data-purchase-debt]").textContent = ToxStore.formatMoney(debt, state.currency);
  document.querySelector("[data-purchase-qty]").textContent = totalQty.toFixed(2);
  document.querySelector("[data-purchase-count]").textContent = state.purchases.length;
  document.querySelector("[data-purchase-ledger-count]").textContent = purchases.length;

  purchaseTable.innerHTML = purchases.length
    ? purchases.map((purchase) => {
      const details = ToxStore.purchaseItems(purchase).map((item) => {
        const expiry = item.expiresAt ? `${t("expiryDate", state.lang)}: ${new Date(item.expiresAt).toLocaleDateString()}` : "-";
        return `
          <div class="purchase-detail-line">
            <span><strong>${purchaseEscape(productName(state, item.productId))}</strong><small>${purchaseEscape([productBrand(state, item.productId), ToxStore.getWarehouseName(item.warehouseId), expiry].filter(Boolean).join(" | "))}</small></span>
            <b>${purchaseEscape(item.quantity)} ${purchaseEscape(item.unitName)} x ${ToxStore.formatMoney(item.unitCostUsd, state.currency)}</b>
          </div>
        `;
      }).join("");
      return `
        <tr>
          <td><strong>${purchaseEscape(purchase.id)}</strong><br><small>${purchaseEscape(new Date(purchase.createdAt).toLocaleString())}</small></td>
          <td>${purchaseEscape(purchase.supplierName)}</td>
          <td>${details}</td>
          <td>${ToxStore.formatMoney(purchase.costUsd, state.currency)}</td>
          <td>${ToxStore.formatMoney(purchase.paidUsd, state.currency)}</td>
          <td><strong class="${ToxStore.purchaseDebt(purchase) ? "danger-text" : ""}">${ToxStore.formatMoney(ToxStore.purchaseDebt(purchase), state.currency)}</strong></td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="6">${purchaseEscape(t("noInvoices", state.lang))}</td></tr>`;
}

purchaseProduct.addEventListener("change", () => {
  const state = ToxStore.getState();
  const product = state.products.find((item) => item.id === purchaseProduct.value);
  if (product && product.warehouseId !== currentPurchaseWarehouseId()) {
    purchaseProduct.value = "";
    hydrateUnits(state);
    renderPurchaseProductResults(state);
    renderPurchaseProductPreview(state);
    updatePurchaseControlsState(state);
    showNotice("هذا المنتج لا ينتمي إلى المستودع المحدد", "warning");
    return;
  }
  hydrateUnits(state);
  renderPurchaseProductPreview(state);
  renderPurchaseProductResults(state);
  updatePurchaseControlsState(state);
});
purchaseWarehouse.addEventListener("change", () => {
  const state = ToxStore.getState();
  resetPurchaseProductPage();
  if (!selectedPurchaseProductIsValidForWarehouse(state)) {
    purchaseProduct.value = "";
    hydrateUnits(state);
  }
  refreshPurchaseProductPicker(state);
});
purchaseUnit.addEventListener("change", () => {
  const state = ToxStore.getState();
  fillPurchaseLineDefaults(selectedPurchaseProduct(state), selectedPurchaseUnit(selectedPurchaseProduct(state)));
  renderPurchaseProductPreview(state);
});
[purchaseUnitCost, purchaseQty, purchaseLineCost, purchaseLineDiscount, purchaseExpiry, purchaseExpiryDate, purchaseReceivedAt].forEach((input) => {
  input?.addEventListener("input", () => renderPurchaseProductPreview(ToxStore.getState()));
  input?.addEventListener("change", () => renderPurchaseProductPreview(ToxStore.getState()));
});
purchaseExpiryDate?.addEventListener("change", () => {
  if (!purchaseExpiryDate.value) return;
  const expiry = new Date(`${purchaseExpiryDate.value}T12:00:00`);
  const today = new Date();
  const days = Math.max(0, Math.round((expiry - today) / (24 * 60 * 60 * 1000)));
  if (purchaseExpiry) purchaseExpiry.value = String(days);
});
purchaseProductSearch?.addEventListener("input", () => refreshPurchaseProductPicker(ToxStore.getState(), { resetPage: true }));
purchaseProductSearch?.addEventListener("change", () => refreshPurchaseProductPicker(ToxStore.getState(), { resetPage: true }));
purchaseProductSearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const state = ToxStore.getState();
  const matches = filteredPurchasableProducts(state);
  const exactBarcodeMatch = exactPurchaseProductBarcodeMatch(state);
  const productToPick = exactBarcodeMatch?.product || (matches.length === 1 ? matches[0] : null);
  if (!productToPick) return;
  choosePurchaseProduct(productToPick.id, state, exactBarcodeMatch);
});
[purchasePaid, purchaseCurrency, purchaseLandedCost, purchaseDiscount].forEach((input) => {
  input?.addEventListener("input", () => {
    renderPurchaseCart(ToxStore.getState());
    if (input === purchaseCurrency) renderPurchaseProductPreview(ToxStore.getState());
  });
  input?.addEventListener("change", () => {
    renderPurchaseCart(ToxStore.getState());
    renderPurchaseProductPreview(ToxStore.getState());
  });
});
purchaseSupplier.addEventListener("change", () => renderSupplierCard(ToxStore.getState()));
purchaseSearch.addEventListener("input", () => renderPurchases(ToxStore.getState()));

purchaseLineForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const state = ToxStore.getState();
  const currency = currentPurchaseCurrency();
  const product = state.products.find((item) => item.id === purchaseProduct.value);
  const unit = ToxStore.sellableUnits(product).find((entry) => entry.id === purchaseUnit.value);
  const quantity = purchaseMoney(Number(purchaseQty.value || 0));
  const lineModel = purchaseLineCostModel({ product, unit, quantity });
  const expiresAt = purchaseLineExpiryIso();
  const receivedAt = purchaseLineReceivedIso();
  if (!product || !unit || quantity <= 0 || !purchaseWarehouse.value) return;
  if (product.warehouseId !== purchaseWarehouse.value) {
    showNotice("هذا المنتج لا ينتمي إلى المستودع المحدد", "warning");
    purchaseProduct.value = "";
    hydrateUnits(state);
    refreshPurchaseProductPicker(state);
    return;
  }
  if (!validatePurchaseLineReadiness(product, unit, lineModel.unitCostUsd)) return;
  purchaseCart.push({
    productId: purchaseProduct.value,
    warehouseId: product.warehouseId,
    brand: product.brand || "",
    productImage: product.image || product.imageUrl || "",
    quantity,
    unitId: unit.id,
    unitName: unit.name,
    qtyInBase: lineModel.qtyInBase,
    currency,
    exchangeRate: state.exchangeRate,
    unitCostCurrency: currency,
    supplierUnitCostUsd: lineModel.supplierUnitCostUsd,
    unitCostUsd: lineModel.unitCostUsd,
    unitCost: ToxStore.convertUsd(lineModel.unitCostUsd, currency),
    lineTotal: ToxStore.convertUsd(lineModel.totalUsd, currency),
    grossTotalUsd: lineModel.grossTotalUsd,
    lineLandedCostUsd: lineModel.landedCostShareUsd,
    lineDiscountUsd: lineModel.discountShareUsd,
    landedCostShareUsd: lineModel.landedCostShareUsd,
    discountShareUsd: lineModel.discountShareUsd,
    baseUnitCostUsd: lineModel.baseUnitCostUsd,
    storageUnitCostUsd: lineModel.storageUnitCostUsd,
    totalUsd: lineModel.totalUsd,
    batchCode: purchaseBatchCode?.value || "",
    expiryDays: Number(purchaseExpiry.value || 0),
    expiresAt,
    receivedAt
  });
  renderPurchaseCart(ToxStore.getState());
  hydratePurchaseForm(ToxStore.getState());
  if (purchaseLineCost) purchaseLineCost.value = "0";
  if (purchaseLineDiscount) purchaseLineDiscount.value = "0";
  if (purchaseBatchCode) purchaseBatchCode.value = "";
  playUiSound("success");
});

exportPurchaseDraftButton.addEventListener("click", exportDraftPurchase);
printPurchaseButton.addEventListener("click", printActivePurchase);

suspendPurchaseButton.addEventListener("click", () => {
  if (activePurchaseView !== "create" || !purchaseCart.length) return;
  const state = ToxStore.getState();
  const summary = renderPurchaseCart(state);
  ToxStore.suspendPurchase({
    supplierId: purchaseSupplier.value || null,
    title: purchaseTitle?.value || "",
    supplierName: purchaseSupplier.options[purchaseSupplier.selectedIndex]?.textContent || "",
    paidUsd: summary.paidUsd,
    note: document.querySelector("[data-purchase-note]").value,
    currency: currentPurchaseCurrency(),
    items: allocatedPurchaseItems()
  });
  purchaseCart.splice(0);
  document.querySelector("[data-purchase-note]").value = "";
  if (purchaseTitle) purchaseTitle.value = "";
  purchasePaid.value = 0;
  if (purchaseLandedCost) purchaseLandedCost.value = "0";
  if (purchaseDiscount) purchaseDiscount.value = "0";
  renderPurchases(ToxStore.getState());
  playUiSound("tap");
});

finalizePurchaseButton.addEventListener("click", async () => {
  if (!purchaseCart.length) return;
  const state = ToxStore.getState();
  const summary = renderPurchaseCart(state);
  const isQuickReceive = activePurchaseView === "receive";
  const purchaseItems = allocatedPurchaseItems();
  const cartReady = purchaseItems.every((item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    const unit = ToxStore.sellableUnits(product).find((entry) => entry.id === item.unitId);
    return validatePurchaseLineReadiness(product, unit, item.unitCostUsd);
  });
  if (!cartReady) return;
  const payloadItems = purchaseItems.map((item) => {
    const quantity = purchaseMoney(item.quantity);
    const unitCostUsd = purchaseMoney(item.unitCostUsd);
    const currency = item.currency || currentPurchaseCurrency();
    const totalUsd = purchaseMoney(item.totalUsd);
    const product = state.products.find((entry) => entry.id === item.productId);
    return {
      productId: item.productId,
      warehouseId: item.warehouseId,
      quantity,
      unitId: item.unitId,
      unitName: item.unitName,
      qtyInBase: product ? ToxStore.quantityInBase(product, quantity, item.unitId) : item.qtyInBase,
      currency,
      exchangeRate: state.exchangeRate,
      unitCostCurrency: currency,
      unitCost: ToxStore.convertUsd(unitCostUsd, currency),
      unitCostUsd,
      supplierUnitCostUsd: item.supplierUnitCostUsd,
      baseUnitCostUsd: item.baseUnitCostUsd,
      storageUnitCostUsd: item.storageUnitCostUsd,
      landedCostShareUsd: item.landedCostShareUsd,
      discountShareUsd: item.discountShareUsd,
      batchCode: item.batchCode,
      lineTotal: ToxStore.convertUsd(totalUsd, currency),
      totalUsd,
      expiryDays: item.expiryDays,
      expiresAt: item.expiresAt,
      receivedAt: item.receivedAt || new Date().toISOString()
    };
  });
  // Let the backend own purchase totals so frontend/server rounding can never block saving.
  const costUsd = purchaseMoney(ToxStore.moneyToUsd(
    ToxStore.convertUsd(payloadItems.reduce((sum, item) => sum + item.totalUsd, 0), currentPurchaseCurrency()),
    currentPurchaseCurrency()
  ));
  const payload = {
    supplierId: purchaseSupplier.value || null,
    title: isQuickReceive ? t("quickStockReceiptTitle", state.lang) : (purchaseTitle?.value || ""),
    supplierName: purchaseSupplier.value
      ? (purchaseSupplier.options[purchaseSupplier.selectedIndex]?.textContent || "")
      : (isQuickReceive ? t("quickStockReceiptSupplier", state.lang) : ""),
    currency: currentPurchaseCurrency(),
    exchangeRate: state.exchangeRate,
    paidUsd: isQuickReceive ? costUsd : summary.paidUsd,
    note: isQuickReceive ? "" : document.querySelector("[data-purchase-note]").value,
    items: payloadItems
  };
  finalizePurchaseButton.disabled = true;
  try {
    await savePurchaseToBackend(payload);
    await ToxStore.refreshFromBackend();
    purchaseCart.splice(0);
    document.querySelector("[data-purchase-note]").value = "";
    if (purchaseTitle) purchaseTitle.value = "";
    purchasePaid.value = 0;
    if (purchaseLandedCost) purchaseLandedCost.value = "0";
    if (purchaseDiscount) purchaseDiscount.value = "0";
    renderPurchases(ToxStore.getState());
    playUiSound("success");
    showNotice("تم حفظ الشراء كدفعة FIFO جديدة. راجع ربح الوحدات إذا تغيرت كلفة المورد؛ الأسعار لا تتغير تلقائياً.", "success");
  } catch (error) {
    console.error("Purchase save failed", error);
    showNotice(`تعذر حفظ فاتورة الشراء: ${error.message || "خطأ غير معروف"}`, "error");
  } finally {
    finalizePurchaseButton.disabled = false;
  }
});

ToxStore.subscribe(renderPurchases);
if (purchaseReceivedAt && !purchaseReceivedAt.value) purchaseReceivedAt.value = todayPurchaseDate();
applyPurchasesHash();
window.addEventListener("hashchange", applyPurchasesHash);
