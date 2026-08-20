// ═══════════════════════════════════════════════════════════
//  TOX Returns — Smart Invoice Search System
//  Server-side filtering with debounce, paginated results
// ═══════════════════════════════════════════════════════════

// DOM refs — mode / header
const returnsModeLinks = document.querySelectorAll("[data-return-mode-link]");
const returnsTitle = document.querySelector("[data-return-title]");
const returnsEyebrow = document.querySelector("[data-return-eyebrow]");
const returnsSourceHeading = document.querySelector("[data-return-source-heading]");
const returnsSourceStatus = document.querySelector("[data-return-source-status]");
const returnsSelectedStatus = document.querySelector("[data-return-selected-status]");
const returnsFormHeading = document.querySelector("[data-return-form-heading]");
const returnsHistoryHeading = document.querySelector("[data-return-history-heading]");
const returnsSearchLabel = document.querySelector("[data-return-search-label]");
const returnsSearch = document.querySelector("[data-return-search]");
const returnsSearchClear = document.querySelector("[data-src-search-clear]");
const returnSourceList = document.querySelector("[data-return-source-list]");
const returnSourceResults = document.querySelector("[data-return-source-results]");
const returnSourceEmpty = document.querySelector("[data-return-source-empty]");
const returnSourceLoading = document.querySelector("[data-return-source-loading]");
const returnsSourceSummary = document.querySelector("[data-return-source-summary]");
const returnsLines = document.querySelector("[data-return-lines]");
const returnsConditionHead = document.querySelector("[data-return-condition-head]");
const returnsSettlement = document.querySelector("[data-return-settlement]");
const returnsReason = document.querySelector("[data-return-reason]");
const returnsNote = document.querySelector("[data-return-note]");
const returnsCurrentTotal = document.querySelector("[data-return-current-total]");
const returnsSave = document.querySelector("[data-return-save]");
const returnsReset = document.querySelector("[data-return-reset]");
const returnsPrint = document.querySelector("[data-return-print]");
const returnsStatus = document.querySelector("[data-return-status]");
const returnsHistory = document.querySelector("[data-return-history]");
const returnsHistoryEmpty = document.querySelector("[data-return-history-empty]");
const returnsUpdated = document.querySelector("[data-return-updated]");
const returnsReceipt = document.querySelector("[data-return-receipt]");
const returnsCount = document.querySelector("[data-return-count]");
const returnsTotal = document.querySelector("[data-return-total]");
const returnsDamaged = document.querySelector("[data-return-damaged]");
const returnsSourceCount = document.querySelector("[data-return-source-count]");
const returnsStockImpact = document.querySelector("[data-return-stock-impact]");
const returnsLedgerImpact = document.querySelector("[data-return-ledger-impact]");
const returnsSelectedLines = document.querySelector("[data-return-selected-lines]");
const returnsFormPanel = document.querySelector("[data-return-form-panel]");

// Source filter DOM refs
const srcPeriodGroup = document.querySelector("[data-return-period-group]");
const srcPeriodBtns = document.querySelectorAll("[data-src-period]");
const srcCustomDates = document.querySelector("[data-src-custom-dates]");
const srcDateFrom = document.querySelector("[data-src-date-from]");
const srcDateTo = document.querySelector("[data-src-date-to]");
const srcKindRow = document.querySelector("[data-src-kind-row]");
const srcKindGroup = document.querySelector("[data-src-kind-group]");
const srcKindBtns = document.querySelectorAll("[data-src-kind]");
const srcStatusGroup = document.querySelector("[data-src-status-group]");
const srcStatusBtns = document.querySelectorAll("[data-src-status]");
const srcSearchBtn = document.querySelector("[data-src-search-btn]");

// History filter DOM refs
const historyPeriodButtons = document.querySelectorAll("[data-return-filter-period]");
const historyKindButtons = document.querySelectorAll("[data-return-filter-kind]");
const historyKindGroup = document.querySelector("[data-return-filter-kind-group]");
const historySearchInput = document.querySelector("[data-return-history-search]");
const historySearchClear = document.querySelector("[data-return-history-clear]");
const historyFilterDescription = document.querySelector("[data-return-history-filter-description]");

// ── State ────────────────────────────────────────────────────
let returnMode = window.location.hash === "#purchases" ? "purchases" : "sales";
let returnSources = [];   // current page of invoice results from server
let returnDocs = [];      // history list
let selectedSourceId = "";
let lastReturnDocument = null;
let returnsBusy = false;

// Source search filter state
let srcPeriod = "today";
let srcKind = "all";
let srcStatus = "all";
let srcSearchText = "";
let srcSearchTimer = null;

// History filter state
let historyPeriod = "today";
let historySaleKind = "all";
let historySearch = "";
let historyFilterTimer = null;

// ── Mode helpers ─────────────────────────────────────────────
function returnType() {
  return returnMode === "purchases" ? "purchase_return" : "sale_return";
}
function returnSourceKey() {
  return returnMode === "purchases" ? "purchaseId" : "invoiceId";
}
function returnPartyLabel() {
  return returnMode === "purchases" ? "المورد" : "الزبون";
}
function returnSourceLabel() {
  return returnMode === "purchases" ? "فاتورة الشراء" : "فاتورة البيع";
}
function returnsEndpoint() {
  return returnMode === "purchases" ? "/purchases-ledger/" : "/invoices/";
}
function returnsRecordsKey() {
  return returnMode === "purchases" ? "purchases" : "invoices";
}
function returnSourceId(doc) {
  return doc?.sourceId || doc?.[returnSourceKey()] || "";
}

// ── Utilities ────────────────────────────────────────────────
function returnsEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function returnsNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function returnsItems(source) {
  if (returnMode === "purchases" && window.ToxStore?.purchaseItems) return ToxStore.purchaseItems(source);
  return Array.isArray(source?.items) ? source.items : [];
}
function returnsSourceTotal(source) {
  if (returnMode === "purchases") return returnsNumber(source?.costUsd || source?.totalUsd);
  return returnsNumber(source?.totalUsd || source?.subtotalUsd);
}
function returnsSourceDebt(source) {
  return returnsNumber(source?.remainingUsd ?? source?.debtUsd);
}
function returnsCurrency(source) {
  return source?.currency || ToxStore.getState().currency || "IQD";
}
function returnsMoney(value, source = selectedSource()) {
  return ToxStore.formatMoney(returnsNumber(value), returnsCurrency(source));
}
function returnsDate(value) {
  const state = ToxStore.getState();
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(state.lang === "ar" ? "ar-IQ" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}
function selectedSource() {
  return returnSources.find((s) => s.id === selectedSourceId) || null;
}
function returnDocsForSource(source) {
  if (!source) return [];
  return returnDocs.filter((doc) => returnSourceId(doc) === source.id);
}
function sourcePartyName(source) {
  const state = ToxStore.getState();
  if (returnMode === "purchases") {
    const supplier = state.suppliers?.find((e) => e.id === source?.supplierId);
    return source?.supplierName || supplier?.name || "مورد مباشر";
  }
  const client = state.clients?.find((e) => e.id === source?.clientId);
  return source?.customerName || source?.clientName || client?.name || "زبون مباشر";
}
function sourceTitle(source) {
  if (!source) return "";
  if (source.title) return source.title;
  if (returnMode === "purchases") return "فاتورة شراء";
  if (source.installmentPlan?.type === "installment" || source.kind === "installment") return "فاتورة أقساط";
  if (source.kind === "direct_pos") return "بيع مباشر POS";
  return "فاتورة بيع";
}
function sourceReturnStatus(source) {
  const total = returnsSourceTotal(source);
  const returned = returnsNumber(source?.returnedUsd);
  if (returned <= 0) return { label: "قابل للإرجاع", cls: "returnable" };
  if (returned >= total - 0.001) return { label: "مرتجع كامل", cls: "full" };
  return { label: "مرتجع جزئي", cls: "partial" };
}
function returnItemMatchesLine(returnItem, sourceItem, lineIndex) {
  if (returnItem?.lineIndex !== undefined && returnItem?.lineIndex !== null && returnItem.lineIndex !== "") {
    return Number(returnItem.lineIndex) === Number(lineIndex);
  }
  const itemProduct = String(returnItem?.productId || "").trim();
  const sourceProduct = String(sourceItem?.productId || sourceItem?.id || "").trim();
  const itemUnit = String(returnItem?.unitId || returnItem?.unitName || "").trim();
  const sourceUnit = String(sourceItem?.unitId || sourceItem?.unitName || "").trim();
  if (itemProduct && sourceProduct && itemProduct !== sourceProduct) return false;
  if (itemUnit && sourceUnit && itemUnit !== sourceUnit) return false;
  return Boolean(itemProduct || itemUnit);
}
function lineReturnedQty(source, lineIndex) {
  const sourceItem = returnsItems(source)[lineIndex];
  if (!source || !sourceItem) return 0;
  return returnDocsForSource(source)
    .flatMap((doc) => (Array.isArray(doc.items) ? doc.items : []))
    .filter((item) => returnItemMatchesLine(item, sourceItem, lineIndex))
    .reduce((sum, item) => sum + returnsNumber(item.quantity ?? item.qty), 0);
}
function lineUnitPrice(item) {
  const quantity = returnsNumber(item?.quantity ?? item?.qty);
  if (returnMode === "purchases") {
    return quantity > 0 ? returnsNumber(item?.totalUsd) / quantity : returnsNumber(item?.unitCostUsd);
  }
  return quantity > 0 ? returnsNumber(item?.totalUsd) / quantity : returnsNumber(item?.priceUsd);
}
function selectedReturnLines() {
  const source = selectedSource();
  if (!source) return [];
  return returnsItems(source).map((item, index) => {
    const original = returnsNumber(item.quantity ?? item.qty);
    const returned = lineReturnedQty(source, index);
    const available = Math.max(0, original - returned);
    const input = document.querySelector(`[data-return-qty="${index}"]`);
    const qty = Math.min(available, Math.max(0, returnsNumber(input?.value)));
    if (qty <= 0) return null;
    const condition = document.querySelector(`[data-return-condition="${index}"]`)?.value || "resellable";
    return {
      lineIndex: index,
      item,
      quantity: qty,
      qty,
      condition: returnMode === "sales" ? condition : "resellable",
      totalUsd: qty * lineUnitPrice(item),
    };
  }).filter(Boolean);
}
function lineReturnAmount(lineIndex) {
  const line = selectedReturnLines().find((e) => Number(e.lineIndex) === Number(lineIndex));
  return line?.totalUsd || 0;
}
function currentReturnTotal() {
  return selectedReturnLines().reduce((sum, line) => sum + returnsNumber(line.totalUsd), 0);
}
function setReturnStatus(message = "", tone = "") {
  if (!returnsStatus) return;
  returnsStatus.textContent = message;
  returnsStatus.dataset.tone = tone;
}

// ── Error handling ───────────────────────────────────────────
async function readReturnError(response) {
  try {
    const payload = await response.json();
    const reason = payload?.reason || payload?.message || `HTTP_${response.status}`;
    const messages = {
      RETURN_QTY_EXCEEDS_AVAILABLE: "الكمية المطلوبة أكبر من المتبقي القابل للإرجاع.",
      PURCHASE_RETURN_STOCK_UNAVAILABLE: "لا يمكن إرجاع الشراء لأن المخزون الحالي غير كاف.",
      PURCHASE_RETURN_BATCH_SOLD: "جزء من دفعة الشراء انباع، لذلك لا يمكن إرجاع هذه الكمية.",
      EMPTY_RETURN: "اختر كمية مرتجعة واحدة على الأقل.",
      RETURN_EXISTS: "رقم المرتجع موجود مسبقاً.",
      NO_INVOICE: "فاتورة البيع غير موجودة.",
      NO_PURCHASE: "فاتورة الشراء غير موجودة.",
      INVOICE_VOIDED: "لا يمكن عمل مرتجع لفاتورة ملغاة.",
      PURCHASE_VOIDED: "لا يمكن عمل مرتجع لفاتورة شراء ملغاة.",
      PERMISSION_DENIED: "ليست لديك صلاحية لتنفيذ هذا المرتجع.",
      AUTH_REQUIRED: "سجل الدخول حتى تكمل العملية.",
    };
    return messages[reason] || reason;
  } catch {
    return `HTTP_${response.status}`;
  }
}
async function returnsFetch(path, options = {}) {
  const response = await ToxApi.fetch(path, options);
  if (!response.ok) throw new Error(await readReturnError(response));
  return response.json();
}

// ── Source search filter UI ───────────────────────────────────
function buildSourceUrl() {
  const base = returnsEndpoint();
  const params = new URLSearchParams({ limit: "50" });

  if (srcPeriod !== "all") {
    if (srcPeriod === "custom") {
      const from = srcDateFrom?.value;
      const to = srcDateTo?.value;
      if (from) params.set("start", from);
      if (to) params.set("end", to);
      params.set("period", "custom");
    } else {
      params.set("period", srcPeriod);
    }
  }

  if (returnMode === "sales" && srcKind !== "all") {
    params.set("saleKind", srcKind);
  }
  if (srcStatus !== "all") {
    params.set("returnStatus", srcStatus);
  }
  if (srcSearchText) {
    params.set("q", srcSearchText);
  }
  return `${base}?${params.toString()}`;
}

function updateSrcFilterUI() {
  srcPeriodBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.srcPeriod === srcPeriod));
  srcKindBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.srcKind === srcKind));
  srcStatusBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.srcStatus === srcStatus));
  if (srcCustomDates) srcCustomDates.hidden = srcPeriod !== "custom";
  if (srcKindRow) srcKindRow.hidden = returnMode === "purchases";
}

async function loadReturnSources() {
  if (returnSourceLoading) returnSourceLoading.hidden = false;
  if (returnSourceEmpty) returnSourceEmpty.hidden = true;
  if (returnSourceList) returnSourceList.innerHTML = "";

  try {
    const url = buildSourceUrl();
    const payload = await returnsFetch(url);
    const allRecords = payload[returnsRecordsKey()] || payload.invoices || [];
    returnSources = allRecords.filter((s) => {
      if (s.isVoided || s.paymentStatus === "void") return false;
      const status = sourceReturnStatus(s);
      if (status.cls === "full") return false; // Hide fully returned invoices
      return true;
    });
    renderSourceList();
  } catch (error) {
    if (returnSourceList) returnSourceList.innerHTML = `<div class="warehouse-empty">تعذر تحميل الفواتير: ${returnsEscape(error.message)}</div>`;
  } finally {
    if (returnSourceLoading) returnSourceLoading.hidden = true;
  }
}

function triggerSourceSearch() {
  clearTimeout(srcSearchTimer);
  srcSearchTimer = setTimeout(loadReturnSources, 400);
}

// ── History loading ───────────────────────────────────────────
async function loadReturnDocs() {
  let url = `/returns/?type=${returnType()}&limit=250&period=${historyPeriod}`;
  if (returnMode === "sales" && historySaleKind !== "all") {
    url += `&saleKind=${historySaleKind}`;
  }
  if (historySearch) {
    url += `&q=${encodeURIComponent(historySearch)}`;
  }
  const payload = await returnsFetch(url);
  returnDocs = payload.returns || [];
}

async function loadReturnsPage() {
  setReturnStatus("جاري تحميل بيانات المرتجعات...");
  try {
    await ToxStore.refreshFromBackend?.({ scope: "full" }).catch(() => null);
    await Promise.all([loadReturnSources(), loadReturnDocs()]);
    setReturnStatus("");
  } catch (error) {
    setReturnStatus(error.message || "تعذر تحميل بيانات المرتجعات.", "error");
  }
  renderReturnsPage();
}

// ── Mode setup ───────────────────────────────────────────────
function applyReturnMode() {
  const isPurchase = returnMode === "purchases";
  document.body.dataset.returnMode = returnMode;
  returnsModeLinks.forEach((link) => {
    const active = link.dataset.returnModeLink === returnMode;
    link.classList.toggle("primary", active);
    link.classList.toggle("ghost", !active);
    link.classList.toggle("active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
    link.textContent = link.dataset.returnModeLink === "purchases" ? "مرتجعات شراء" : "مرتجعات مبيعات";
  });
  if (returnsTitle) returnsTitle.textContent = isPurchase ? "مرتجعات شراء" : "مرتجعات مبيعات";
  if (returnsEyebrow) returnsEyebrow.textContent = isPurchase ? "إرجاع للمورد مع فحص توفر المخزون قبل الحفظ" : "إرجاع للزبون مع تحديث المخزون والدين";
  if (returnsSourceHeading) returnsSourceHeading.textContent = `البحث عن ${returnSourceLabel()} الأصلية`;
  if (returnsFormHeading) returnsFormHeading.textContent = isPurchase ? "تفاصيل مرتجع الشراء" : "تفاصيل مرتجع المبيعات";
  if (returnsHistoryHeading) returnsHistoryHeading.textContent = isPurchase ? "سجل مرتجعات الشراء" : "سجل مرتجعات المبيعات";
  if (returnsSearchLabel) returnsSearchLabel.textContent = isPurchase ? "بحث برقم فاتورة الشراء، المورد، المنتج، الباركود" : "بحث برقم الفاتورة، العميل، المنتج، الباركود";
  if (returnsSearch) returnsSearch.placeholder = isPurchase ? "ابحث عن فاتورة شراء أصلية..." : "ابحث عن فاتورة بيع أصلية...";
  if (historySearchInput) historySearchInput.placeholder = isPurchase ? "ابحث برقم المرتجع أو فاتورة الشراء أو اسم المورد..." : "ابحث برقم المرتجع أو فاتورة البيع أو اسم الزبون...";
  if (historyFilterDescription) historyFilterDescription.textContent = isPurchase ? "فلترة المرتجعات المسجلة بحسب التاريخ أو رقم فاتورة الشراء أو اسم المورد" : "فلترة المرتجعات المسجلة بحسب التاريخ أو نوع البيع أو اسم الزبون";
  if (returnsConditionHead) returnsConditionHead.textContent = isPurchase ? "التحقق" : "الحالة";
  if (returnsSettlement) {
    const current = returnsSettlement.value;
    returnsSettlement.innerHTML = isPurchase
      ? `<option value="credit">تخفيض ذمة المورد / رصيد</option><option value="cash">مبلغ مسترجع من المورد</option>`
      : `<option value="credit">تخفيض دين / رصيد للزبون</option><option value="cash">إرجاع نقدي</option>`;
    if (["credit", "cash"].includes(current)) returnsSettlement.value = current;
  }
  document.title = isPurchase ? "TOX | مرتجعات شراء" : "TOX | مرتجعات مبيعات";
  if (historyKindGroup) historyKindGroup.hidden = isPurchase;
  updateSrcFilterUI();
}

// ── Render: source list ───────────────────────────────────────
function renderSourceList() {
  if (returnsSourceCount) returnsSourceCount.textContent = String(returnSources.length);
  if (returnsSourceStatus) returnsSourceStatus.textContent = `${returnSources.length} نتيجة`;
  if (!returnSourceList) return;

  if (!returnSources.length) {
    if (returnSourceEmpty) returnSourceEmpty.hidden = false;
    returnSourceList.innerHTML = "";
    return;
  }
  if (returnSourceEmpty) returnSourceEmpty.hidden = true;

  returnSourceList.innerHTML = returnSources.map((source) => {
    const active = source.id === selectedSourceId ? " active" : "";
    const returnedUsd = returnsNumber(source?.returnedUsd);
    const total = returnsSourceTotal(source);
    const available = Math.max(0, total - returnedUsd);
    const status = sourceReturnStatus(source);
    const isFullyReturned = status.cls === "full";
    const dateStr = source.createdAt ? returnsDate(source.createdAt) : "";
    return `
      <button class="returns-source-card${active}${isFullyReturned ? " is-muted" : ""}" type="button" data-return-source="${returnsEscape(source.id)}">
        <div class="returns-source-card-header">
          <strong class="returns-source-card-id">${returnsEscape(source.id)}</strong>
          <span class="returns-source-status-pill returns-status-${returnsEscape(status.cls)}">${returnsEscape(status.label)}</span>
        </div>
        <div class="returns-source-card-party">${returnsEscape(sourceTitle(source))} · ${returnsEscape(sourcePartyName(source))}</div>
        <div class="returns-source-card-amounts">
          <span>الإجمالي: <b>${returnsMoney(total, source)}</b></span>
          <span>مرتجع سابقاً: <b>${returnsMoney(returnedUsd, source)}</b></span>
          <span>متاح للإرجاع: <b class="${available <= 0 ? 'text-muted' : ''}">${returnsMoney(available, source)}</b></span>
        </div>
        <div class="returns-source-card-date">${returnsEscape(dateStr)}</div>
      </button>
    `;
  }).join("");

  returnSourceList.querySelectorAll("[data-return-source]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSourceId = button.dataset.returnSource;
      lastReturnDocument = null;
      renderReturnsPage();
      // Scroll to form panel
      returnsFormPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ── Render: source summary ────────────────────────────────────
function renderSourceSummary() {
  const source = selectedSource();
  if (!returnsSourceSummary || !returnsSelectedStatus) return;
  if (!source) {
    returnsSelectedStatus.textContent = "لم يتم اختيار فاتورة";
    returnsSourceSummary.innerHTML = `<span>اختر فاتورة أصلية من نتائج البحث أعلاه حتى تظهر المنتجات القابلة للإرجاع.</span>`;
    return;
  }
  const returnedUsd = returnsNumber(source?.returnedUsd);
  const total = returnsSourceTotal(source);
  const available = Math.max(0, total - returnedUsd);
  returnsSelectedStatus.textContent = source.id;
  returnsSourceSummary.innerHTML = `
    <div><span>${returnSourceLabel()}</span><strong>${returnsEscape(source.id)}</strong></div>
    <div><span>${returnPartyLabel()}</span><strong>${returnsEscape(sourcePartyName(source))}</strong></div>
    <div><span>إجمالي الفاتورة</span><strong>${returnsMoney(total, source)}</strong></div>
    <div><span>مرتجع سابقاً</span><strong>${returnsMoney(returnedUsd, source)}</strong></div>
    <div><span>متاح للإرجاع</span><strong>${returnsMoney(available, source)}</strong></div>
  `;
}

// ── Render: return lines ──────────────────────────────────────
function renderReturnLines() {
  const source = selectedSource();
  if (!returnsLines) return;
  if (!source) {
    returnsLines.innerHTML = `<tr><td colspan="7">اختر فاتورة أصلية أولاً من قسم البحث.</td></tr>`;
    updateReturnTotal();
    return;
  }
  const rows = returnsItems(source).map((item, index) => {
    const original = returnsNumber(item.quantity ?? item.qty);
    const returned = lineReturnedQty(source, index);
    const available = Math.max(0, original - returned);
    const disabled = available <= 0 ? " disabled" : "";
    const conditionCell = returnMode === "purchases"
      ? `<span class="status-pill">السيرفر يفحص توفر المخزون</span>`
      : `<select data-return-condition="${index}"${disabled}><option value="resellable">سليمة ترجع للمخزون</option><option value="damaged">تالفة لا تزيد المخزون</option></select>`;
    return `
      <tr class="${available <= 0 ? "is-muted" : ""}">
        <td><strong>${returnsEscape(item.productName || item.name || item.productId || "-")}</strong><br><small>${returnsEscape([item.productBrand, item.warehouseName, item.unitName].filter(Boolean).join(" | "))}</small></td>
        <td>${original}</td>
        <td>${returned > 0 ? `<span class="text-warning">${returned}</span>` : returned}</td>
        <td><strong class="${available <= 0 ? "text-muted" : "text-success"}">${available}</strong></td>
        <td><input type="number" min="0" max="${available}" step="0.01" value="0" data-return-qty="${index}"${disabled} /></td>
        <td>${conditionCell}</td>
        <td><strong data-return-line-total="${index}">${returnsMoney(0, source)}</strong></td>
      </tr>
    `;
  }).join("");
  returnsLines.innerHTML = rows || `<tr><td colspan="7">لا توجد منتجات داخل الفاتورة.</td></tr>`;
  returnsLines.querySelectorAll("[data-return-qty], [data-return-condition]").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.matches("[data-return-qty]")) {
        const max = returnsNumber(input.max);
        if (returnsNumber(input.value) > max) input.value = String(max);
        if (returnsNumber(input.value) < 0) input.value = "0";
      }
      updateReturnTotal();
    });
    input.addEventListener("change", updateReturnTotal);
  });
  updateReturnTotal();
}

// ── Render: review panel ──────────────────────────────────────
function renderReturnReview() {
  const source = selectedSource();
  const lines = selectedReturnLines();
  const total = currentReturnTotal();
  if (returnsSelectedLines) returnsSelectedLines.textContent = `${lines.length} صنف`;
  if (!source || !lines.length) {
    if (returnsStockImpact) returnsStockImpact.textContent = "اختر كمية مرتجعة";
    if (returnsLedgerImpact) returnsLedgerImpact.textContent = "لا توجد تسوية بعد";
    return;
  }
  if (returnsStockImpact) {
    if (returnMode === "purchases") {
      returnsStockImpact.textContent = "سيتم خصم الكميات من المخزون وإرجاعها للمورد";
    } else {
      const resellable = lines.filter((l) => l.condition !== "damaged").length;
      const damaged = lines.length - resellable;
      returnsStockImpact.textContent = `${resellable} يرجع للمخزون${damaged ? ` | ${damaged} تالف لا يزيد المخزون` : ""}`;
    }
  }
  if (returnsLedgerImpact) {
    const settlement = returnsSettlement?.value === "cash" ? "تسوية نقدية" : "تخفيض ذمة/رصيد";
    returnsLedgerImpact.textContent = `${settlement} بقيمة ${returnsMoney(total, source)} على ${returnPartyLabel()}`;
  }
}

function updateReturnTotal() {
  const source = selectedSource();
  const total = currentReturnTotal();
  returnsItems(source).forEach((item, index) => {
    const target = document.querySelector(`[data-return-line-total="${index}"]`);
    if (target) target.textContent = returnsMoney(lineReturnAmount(index), source);
  });
  if (returnsCurrentTotal) returnsCurrentTotal.textContent = returnsMoney(total, source);
  renderReturnReview();
}

// ── Render: history ───────────────────────────────────────────
function renderHistory() {
  if (!returnsHistory) return;
  const total = returnDocs.reduce((sum, doc) => sum + returnsNumber(doc.totalUsd), 0);
  const damagedCount = returnDocs.flatMap((doc) => doc.items || []).filter((item) => item.condition === "damaged").length;
  if (returnsCount) returnsCount.textContent = String(returnDocs.length);
  if (returnsTotal) returnsTotal.textContent = returnsMoney(total);
  if (returnsDamaged) returnsDamaged.textContent = String(damagedCount);
  if (returnsUpdated) returnsUpdated.textContent = new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
  if (returnsHistoryEmpty) returnsHistoryEmpty.hidden = returnDocs.length > 0;
  returnsHistory.innerHTML = returnDocs.map((doc) => `
    <tr>
      <td><strong>${returnsEscape(doc.id)}</strong></td>
      <td>${returnsEscape(returnSourceId(doc) || "-")}</td>
      <td>${returnsEscape(doc.partyName || "-")}</td>
      <td>${(doc.items || []).length}</td>
      <td>${doc.settlementMethod === "cash" ? "نقدي" : "رصيد/ذمة"}</td>
      <td><strong>${returnsMoney(doc.totalUsd)}</strong></td>
      <td>${returnsDate(doc.createdAt)}</td>
      <td><button class="button ghost compact-action" type="button" data-return-history-print="${returnsEscape(doc.id)}">طباعة</button></td>
    </tr>
  `).join("");
  returnsHistory.querySelectorAll("[data-return-history-print]").forEach((button) => {
    button.addEventListener("click", () => {
      const doc = returnDocs.find((e) => e.id === button.dataset.returnHistoryPrint);
      if (!doc) return;
      lastReturnDocument = doc;
      renderReceipt(doc);
      window.print();
    });
  });
}

// ── History filter ────────────────────────────────────────────
function updateHistoryFilterUI() {
  historyPeriodButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.returnFilterPeriod === historyPeriod));
  historyKindButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.returnFilterKind === historySaleKind));
}
async function applyHistoryFilters() {
  if (returnsBusy) return;
  returnsBusy = true;
  updateHistoryFilterUI();
  try {
    await loadReturnDocs();
    renderHistory();
  } catch (error) {
    console.error("Failed to load return history", error);
  } finally {
    returnsBusy = false;
  }
}

// ── Full page render ──────────────────────────────────────────
function renderReturnsPage() {
  applyReturnMode();
  renderSourceList();
  renderSourceSummary();
  renderReturnLines();
  renderHistory();
  if (returnsPrint) returnsPrint.disabled = !lastReturnDocument;
}

// ── Payload builders ──────────────────────────────────────────
function selectedReturnItemsPayload() {
  return selectedReturnLines().map((line) => ({
    lineIndex: line.lineIndex,
    quantity: line.quantity,
    qty: line.qty,
    condition: line.condition,
  }));
}

// ── Reset form ────────────────────────────────────────────────
function resetReturnForm() {
  selectedSourceId = "";
  lastReturnDocument = null;
  if (returnsReason) returnsReason.value = "";
  if (returnsNote) returnsNote.value = "";
  if (returnsSearch) returnsSearch.value = "";
  if (returnsSearchClear) returnsSearchClear.hidden = true;
  srcSearchText = "";
  setReturnStatus("");
  renderReturnsPage();
}

// ── Save return ───────────────────────────────────────────────
async function saveReturn() {
  if (returnsBusy) return;
  const source = selectedSource();
  if (!source) {
    setReturnStatus("اختر الفاتورة الأصلية أولاً.", "error");
    return;
  }
  const items = selectedReturnItemsPayload();
  if (!items.length) {
    setReturnStatus("حدد كمية مرتجعة لمنتج واحد على الأقل.", "error");
    return;
  }
  const payload = {
    returnType: returnType(),
    [returnSourceKey()]: source.id,
    settlementMethod: returnsSettlement?.value || "credit",
    reason: returnsReason?.value || "",
    note: returnsNote?.value || "",
    items,
  };
  returnsBusy = true;
  if (returnsSave) returnsSave.disabled = true;
  setReturnStatus("جاري حفظ المرتجع...");
  try {
    const response = await returnsFetch("/returns/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    lastReturnDocument = response.returnDocument;
    setReturnStatus(`تم حفظ المرتجع ${lastReturnDocument?.id || ""} بنجاح.`, "success");
    await ToxStore.refreshFromBackend?.({ scope: "full" }).catch(() => null);
    await Promise.all([loadReturnSources(), loadReturnDocs()]);
    selectedSourceId = source.id;
    renderReturnsPage();
  } catch (error) {
    setReturnStatus(error.message || "تعذر حفظ المرتجع.", "error");
    window.showNotice?.(error.message || "تعذر حفظ المرتجع.", "error");
  } finally {
    returnsBusy = false;
    if (returnsSave) returnsSave.disabled = false;
  }
}

// ── Receipt / print ───────────────────────────────────────────
function renderReceipt(returnDocument = lastReturnDocument) {
  if (!returnsReceipt || !returnDocument) return;
  const source = returnSources.find((e) => e.id === returnSourceId(returnDocument)) || selectedSource();
  const isPurchase = returnDocument.returnType === "purchase_return" || returnDocument.type === "purchase_return" || returnMode === "purchases";
  returnsReceipt.hidden = false;
  returnsReceipt.innerHTML = `
    <div class="returns-receipt-card">
      <header>
        <strong>TOX</strong>
        <span>${isPurchase ? "وصل مرتجع شراء" : "وصل مرتجع مبيعات"}</span>
      </header>
      <div class="returns-receipt-meta">
        <span>رقم المرتجع: <b>${returnsEscape(returnDocument.id)}</b></span>
        <span>الفاتورة الأصلية: <b>${returnsEscape(returnSourceId(returnDocument) || "-")}</b></span>
        <span>الجهة: <b>${returnsEscape(returnDocument.partyName || sourcePartyName(source))}</b></span>
        <span>التاريخ: <b>${returnsDate(returnDocument.createdAt)}</b></span>
      </div>
      <table>
        <thead><tr><th>المنتج</th><th>الكمية</th><th>الحالة</th><th>المبلغ</th></tr></thead>
        <tbody>
          ${(returnDocument.items || []).map((item) => `
            <tr>
              <td>${returnsEscape(item.productName || item.productId || "-")}</td>
              <td>${returnsEscape(item.quantity)} ${returnsEscape(item.unitName || "")}</td>
              <td>${item.condition === "damaged" ? "تالف" : "سليم"}</td>
              <td>${returnsMoney(item.totalUsd, source)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="returns-receipt-total">
        <span>${returnDocument.settlementMethod === "cash" ? "تسوية نقدية" : "تسوية ذمة/رصيد"}</span>
        <strong>${returnsMoney(returnDocument.totalUsd, source)}</strong>
      </div>
      <footer>${returnsEscape(returnDocument.reason || returnDocument.note || "")}</footer>
    </div>
  `;
}

function printLastReturn() {
  if (!lastReturnDocument) return;
  renderReceipt(lastReturnDocument);
  window.print();
}

// ═══════════════════════════════════════════════════════════
//  Event listeners
// ═══════════════════════════════════════════════════════════

// Source period buttons
srcPeriodBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    srcPeriod = btn.dataset.srcPeriod;
    updateSrcFilterUI();
    triggerSourceSearch();
  });
});

// Custom date range
srcDateFrom?.addEventListener("change", () => {
  if (srcPeriod === "custom") triggerSourceSearch();
});
srcDateTo?.addEventListener("change", () => {
  if (srcPeriod === "custom") triggerSourceSearch();
});

// Source kind buttons (sales only)
srcKindBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    srcKind = btn.dataset.srcKind;
    updateSrcFilterUI();
    triggerSourceSearch();
  });
});

// Source return status buttons
srcStatusBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    srcStatus = btn.dataset.srcStatus;
    updateSrcFilterUI();
    triggerSourceSearch();
  });
});

// Text search — debounced
returnsSearch?.addEventListener("input", () => {
  srcSearchText = returnsSearch.value.trim();
  if (returnsSearchClear) returnsSearchClear.hidden = !srcSearchText;
  clearTimeout(srcSearchTimer);
  srcSearchTimer = setTimeout(loadReturnSources, 500);
});

// Clear button
returnsSearchClear?.addEventListener("click", () => {
  if (returnsSearch) returnsSearch.value = "";
  srcSearchText = "";
  returnsSearchClear.hidden = true;
  loadReturnSources();
});

// Manual search button
srcSearchBtn?.addEventListener("click", () => {
  clearTimeout(srcSearchTimer);
  loadReturnSources();
});

// Form buttons
returnsSettlement?.addEventListener("change", updateReturnTotal);
returnsReset?.addEventListener("click", resetReturnForm);
returnsSave?.addEventListener("click", saveReturn);
returnsPrint?.addEventListener("click", printLastReturn);

// History period buttons
historyPeriodButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    historyPeriod = btn.dataset.returnFilterPeriod;
    applyHistoryFilters();
  });
});
// History kind buttons
historyKindButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    historySaleKind = btn.dataset.returnFilterKind;
    applyHistoryFilters();
  });
});
// History search — debounced
historySearchInput?.addEventListener("input", () => {
  if (historySearchClear) historySearchClear.hidden = !historySearchInput.value.trim();
  clearTimeout(historyFilterTimer);
  historyFilterTimer = setTimeout(() => {
    historySearch = historySearchInput.value.trim();
    applyHistoryFilters();
  }, 400);
});
historySearchClear?.addEventListener("click", () => {
  if (!historySearchInput) return;
  historySearchInput.value = "";
  historySearch = "";
  historySearchClear.hidden = true;
  clearTimeout(historyFilterTimer);
  applyHistoryFilters();
});

// Hash change (sales ↔ purchases toggle)
window.addEventListener("hashchange", () => {
  const nextMode = window.location.hash === "#purchases" ? "purchases" : "sales";
  if (nextMode === returnMode) return;
  returnMode = nextMode;
  selectedSourceId = "";
  lastReturnDocument = null;
  srcPeriod = "today";
  srcKind = "all";
  srcStatus = "all";
  srcSearchText = "";
  if (returnsSearch) returnsSearch.value = "";
  if (returnsSearchClear) returnsSearchClear.hidden = true;
  loadReturnsPage();
});

ToxStore.subscribe(() => renderReturnsPage());
loadReturnsPage();
