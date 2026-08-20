const reportsApiUrl = window.ToxApi?.url?.("/analytics/reports/") || "../api/analytics/reports/";
const reportsLiveApiUrl = window.ToxApi?.url?.("/analytics/reports/live/") || "../api/analytics/reports/live/";
const reportsNetworkApiUrl = window.ToxApi?.url?.("/system/network/") || "../api/system/network/";
const reportsRepairCostsApiUrl = window.ToxApi?.url?.("/invoice-costs/repair/") || "../api/invoice-costs/repair/";
let reportsPayload = null;
let activeReport = "sales";
let reportsEventSource = null;
let reportsPollingTimer = null;
let reportsLastRevision = "";
let reportsManualRefresh = false;
let activePeriod = "today";
let activeSaleKind = "all";
let activeCostSource = "all";
let activeDrawerKind = "";
let reportFilterTimer = null;
const reportFilterPanel = document.querySelector("[data-report-filter-panel]");

const reportsEls = {
  kpis: document.querySelector("[data-reports-kpis]"),
  featuredCards: document.querySelector("[data-report-featured-cards]"),
  financeBridge: document.querySelector("[data-report-finance-bridge]"),
  updated: document.querySelector("[data-reports-updated]"),
  tabs: document.querySelectorAll("[data-report-tab]"),
  title: document.querySelector("[data-report-section-title]"),
  subtitle: document.querySelector("[data-report-section-subtitle]"),
  metrics: document.querySelector("[data-report-section-metrics]"),
  monthlySales: document.querySelector("[data-report-monthly-sales]"),
  insights: document.querySelector("[data-report-insights]"),
  topProducts: document.querySelector("[data-report-top-products]"),
  topCustomers: document.querySelector("[data-report-top-customers]"),
  customerDebt: document.querySelector("[data-report-customer-debt]"),
  supplierDebt: document.querySelector("[data-report-supplier-debt]"),
  lowStock: document.querySelector("[data-report-low-stock]"),
  installments: document.querySelector("[data-report-installments]"),
  refresh: document.querySelector("[data-reports-refresh]"),
  score: document.querySelector("[data-report-score]"),
  scoreRing: document.querySelector("[data-report-score-ring]"),
  scoreLabel: document.querySelector("[data-report-score-label]"),
  scoreSummary: document.querySelector("[data-report-score-summary]"),
  priorityActions: document.querySelector("[data-report-priority-actions]"),
  dataSource: document.querySelector("[data-report-data-source]"),
  liveStatus: document.querySelector("[data-report-live-status]"),
  trend: document.querySelector("[data-report-trend]"),
  profitTrend: document.querySelector("[data-report-profit-trend]"),
  invoiceProfit: document.querySelector("[data-report-invoice-profit]"),
  productProfit: document.querySelector("[data-report-product-profit]"),
  productAccounting: document.querySelector("[data-report-product-accounting]"),
  stockBatches: document.querySelector("[data-report-stock-batches]"),
  missingCosts: document.querySelector("[data-report-missing-costs]"),
  readinessBoard: document.querySelector("[data-report-readiness-board]"),
  readinessStatus: document.querySelector("[data-report-readiness-status]"),
  readinessMetrics: document.querySelector("[data-report-readiness-metrics]"),
  readinessIssues: document.querySelector("[data-report-readiness-issues]"),
  periodButtons: reportFilterPanel?.querySelectorAll("[data-report-period]") || document.querySelectorAll("[data-report-period]"),
  detailToggles: document.querySelectorAll("[data-report-toggle-details]"),
  detailButtons: document.querySelectorAll("[data-report-detail]"),
  exportButtons: document.querySelectorAll("[data-report-export]"),
  localLink: document.querySelector("[data-report-local-link]"),
  drawer: document.querySelector("[data-report-drawer]"),
  drawerTitle: document.querySelector("[data-report-drawer-title]"),
  drawerKicker: document.querySelector("[data-report-drawer-kicker]"),
  drawerSubtitle: document.querySelector("[data-report-drawer-subtitle]"),
  drawerSummary: document.querySelector("[data-report-drawer-summary]"),
  drawerBody: document.querySelector("[data-report-drawer-body]"),
  drawerClose: document.querySelectorAll("[data-report-drawer-close]"),
  detailPage: document.querySelector("[data-report-detail-page]"),
  detailPageTitle: document.querySelector("[data-report-page-title]"),
  detailPageKicker: document.querySelector("[data-report-page-kicker]"),
  detailPageSubtitle: document.querySelector("[data-report-page-subtitle]"),
  detailPageSummary: document.querySelector("[data-report-page-summary]"),
  detailPageBody: document.querySelector("[data-report-page-body]"),
  detailPageSearch: document.querySelector("[data-report-page-search]"),
  detailPageBack: document.querySelector("[data-report-page-back]"),
  detailPageExportButtons: document.querySelectorAll("[data-report-page-export]"),
  startDate: reportFilterPanel?.querySelector("[data-report-filter-start]") || document.querySelector("[data-report-start]"),
  endDate: reportFilterPanel?.querySelector("[data-report-filter-end]") || document.querySelector("[data-report-end]"),
  saleKindButtons: reportFilterPanel?.querySelectorAll("[data-report-filter-sale-kind]") || document.querySelectorAll("[data-report-sale-kind]"),
  costSourceButtons: reportFilterPanel?.querySelectorAll("[data-report-filter-cost-source]") || document.querySelectorAll("[data-report-cost-source]"),
  search: reportFilterPanel?.querySelector("[data-report-filter-search]") || document.querySelector("[data-report-search]"),
  marginMin: reportFilterPanel?.querySelector("[data-report-filter-margin-min]") || document.querySelector("[data-report-margin-min]"),
  marginMax: reportFilterPanel?.querySelector("[data-report-filter-margin-max]") || document.querySelector("[data-report-margin-max]"),
  filterApply: reportFilterPanel?.querySelector("[data-report-filter-apply]"),
  filterClear: reportFilterPanel?.querySelector("[data-report-filter-clear]")
};
reportsEls.stockPanel = reportsEls.stockBatches?.closest(".accounting-report-panel");
reportsEls.missingPanel = reportsEls.missingCosts?.closest(".accounting-report-panel");
reportsEls.decisionBoard = document.querySelector(".smart-decision-board");
reportsEls.widgetGrid = document.querySelector(".smart-widget-grid");
reportsEls.workspace = document.querySelector(".workspace.reports-dashboard-2026") || document.querySelector(".workspace.smart-reports-2026");

const kpiOrder = [
  "revenue",
  "saleReturns",
  "netSales",
  "trustedGrossProfit",
  "netProfit",
  "cogs"
];

function reportLanguage() {
  return window.ToxStore?.getState?.().lang === "en" ? "en" : "ar";
}

function reportCopy(ar, en) {
  return reportLanguage() === "en" ? en : ar;
}

function syncReportChromeLanguage() {
  const en = reportLanguage() === "en";
  const title = document.querySelector(".smart-report-title h1");
  const intro = document.querySelector(".smart-report-title > span");
  const bridgeTitle = document.querySelector(".report-finance-bridge-head h2");
  const bridgeNote = document.querySelector(".report-finance-bridge-head small");
  if (title) title.textContent = en ? "Smart Reports" : "التقرير الذكي";
  if (intro) intro.textContent = en ? "Profit" : "الأرباح";
  if (bridgeTitle) bridgeTitle.textContent = en ? "Sales, returns, and operating costs" : "المبيعات والمرتجعات والمصروفات التشغيلية";
  if (bridgeNote) bridgeNote.textContent = en ? "One period, one decision-ready view." : "من نفس الفترة المختارة، لقرار إداري أوضح.";
  const periodLabels = { today: ["اليوم", "Today"], week: ["هذا الأسبوع", "This week"], month: ["هذا الشهر", "This month"], last_month: ["الشهر الماضي", "Last month"], year: ["هذه السنة", "This year"], custom: ["مخصص", "Custom"] };
  document.querySelectorAll("[data-report-period]").forEach((button) => {
    const pair = periodLabels[button.dataset.reportPeriod];
    if (pair) button.textContent = en ? pair[1] : pair[0];
  });
  const actions = { invoices: ["عرض الفواتير", "Invoices"], profits: ["عرض الأرباح", "Profit"], sales: ["عرض المبيعات", "Sales"], topProducts: ["أفضل المنتجات", "Top products"], topCustomers: ["أفضل العملاء", "Top customers"], export: ["تصدير التقرير", "Export"] };
  document.querySelectorAll("[data-report-detail]").forEach((button) => {
    const pair = actions[button.dataset.reportDetail];
    if (pair) button.textContent = en ? pair[1] : pair[0];
  });
  const filterPanel = document.querySelector("[data-report-filter-panel]");
  if (filterPanel) {
    const labels = filterPanel.querySelectorAll(".report-date-row > label > span, .report-search-row > label > span");
    const arabicLabels = ["\u0645\u0646 \u062a\u0627\u0631\u064a\u062e", "\u0625\u0644\u0649 \u062a\u0627\u0631\u064a\u062e", "\u0628\u062d\u062b", "\u0647\u0627\u0645\u0634 \u0645\u0646 %", "\u0625\u0644\u0649 %"];
    const englishLabels = ["From date", "To date", "Search", "Margin from %", "To %"];
    labels.forEach((label, index) => { label.textContent = en ? englishLabels[index] : arabicLabels[index]; });
    const filterLabel = filterPanel.querySelector(".report-filter-label");
    if (filterLabel) filterLabel.textContent = en ? "Period" : "\u0627\u0644\u0641\u062a\u0631\u0629";
    filterPanel.querySelectorAll(".report-segmented").forEach((group, index) => {
      const heading = group.querySelector("span");
      if (heading) heading.textContent = en ? (index === 0 ? "Sale type" : "Cost source") : (index === 0 ? "\u0646\u0648\u0639 \u0627\u0644\u0628\u064a\u0639" : "\u0645\u0635\u062f\u0631 \u0627\u0644\u0643\u0644\u0641\u0629");
      const values = index === 0
        ? [["all", "\u0627\u0644\u0643\u0644", "All"], ["direct_pos", "POS", "POS"], ["invoice", "\u0641\u0627\u062a\u0648\u0631\u0629", "Invoice"], ["installment", "\u0623\u0642\u0633\u0627\u0637", "Installments"]]
        : [["all", "\u0627\u0644\u0643\u0644", "All"], ["fifo", "FIFO \u0641\u0642\u0637", "FIFO only"], ["review", "\u064a\u062d\u062a\u0627\u062c \u0645\u0631\u0627\u062c\u0639\u0629", "Needs review"]];
      group.querySelectorAll("button").forEach((button) => {
        const match = values.find(([value]) => value === button.dataset.reportFilterSaleKind || value === button.dataset.reportFilterCostSource);
        if (match) button.textContent = en ? match[2] : match[1];
      });
    });
    const search = filterPanel.querySelector("[data-report-filter-search]");
    if (search) search.placeholder = en ? "Product, customer, invoice, warehouse" : "\u0645\u0646\u062a\u062c\u060c \u0639\u0645\u064a\u0644\u060c \u0641\u0627\u062a\u0648\u0631\u0629\u060c \u0645\u062e\u0632\u0646";
    const apply = filterPanel.querySelector("[data-report-filter-apply]");
    const clear = filterPanel.querySelector("[data-report-filter-clear]");
    if (apply) apply.textContent = en ? "Apply filters" : "\u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0641\u0644\u0627\u062a\u0631";
    if (clear) clear.textContent = en ? "Clear" : "\u0645\u0633\u062d \u0627\u0644\u0641\u0644\u0627\u062a\u0631";
  }
}

const insightRank = {
  danger: 1,
  warning: 2,
  positive: 3,
  opportunity: 3,
  info: 4
};

const reportTitles = {
  sales: ["تحليل المبيعات", "الإيراد، مبيعات اليوم، متوسط الفاتورة، ومعدل التحصيل."],
  customers: ["تحليل العملاء", "ديون العملاء، التحصيل، وأعلى العملاء إيراداً."],
  suppliers: ["تحليل الموردين", "إجمالي المشتريات، المدفوعات، وديون الموردين."],
  products: ["تحليل المنتجات", "الأكثر مبيعاً وتنبيهات المخزون المنخفض."],
  warehouses: ["تحليل المخازن", "حالة المخازن والمنتجات التي تحتاج متابعة."],
  ledger: ["الدفتر المالي", "إيرادات ومشتريات ومصاريف وصافي ربح من قيود غير قابلة للتعديل."]
};

function authHeaders() {
  return window.ToxAuth?.authHeaders?.() || window.ToxApi?.authHeaders?.() || {};
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function number(value) {
  return new Intl.NumberFormat("ar-IQ").format(Number(value || 0));
}

function money(value, payload = reportsPayload) {
  const rate = Number(payload?.exchangeRate || 1460);
  return `${number(Math.round(Number(value || 0) * rate))} د.ع`;
}

function formattedMoney(item, formattedKey, valueKey, payload = reportsPayload) {
  return item?.[formattedKey] || money(item?.[valueKey], payload);
}

function netProfitDisplay(sales, payload = reportsPayload) {
  return sales?.netProfitReliable === false ? "غير معروض مع الفلاتر الجزئية" : money(sales?.netProfitUsd, payload);
}

function kpiValue(item, payload) {
  if (!item) return "0";
  if (item.formatted) return item.formatted;
  if (item.valueUsd !== undefined) return money(item.valueUsd, payload);
  return number(item.value || 0);
}

function toneOf(item, fallback = "info") {
  return item?.tone || fallback;
}

function dateKey(date) {
  const value = date ? new Date(date) : new Date();
  if (Number.isNaN(value.getTime())) return new Date().toISOString().slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function monthKey(date) {
  const value = date ? new Date(date) : new Date();
  if (Number.isNaN(value.getTime())) return new Date().toISOString().slice(0, 7);
  return value.toISOString().slice(0, 7);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function safeReportPeriod(value) {
  return ["today", "week", "month", "last_month", "year", "last12", "custom", "all"].includes(value) ? value : "today";
}

function safeSaleKind(value) {
  return ["all", "direct_pos", "invoice", "installment"].includes(value) ? value : "all";
}

function safeCostSource(value) {
  return ["all", "fifo", "review"].includes(value) ? value : "all";
}

function initReportPeriod() {
  const params = new URLSearchParams(window.location.search);
  activePeriod = safeReportPeriod(params.get("period") || activePeriod);
  activeSaleKind = safeSaleKind(params.get("saleKind") || activeSaleKind);
  activeCostSource = safeCostSource(params.get("costSource") || activeCostSource);
  if (reportsEls.startDate && params.get("start")) reportsEls.startDate.value = params.get("start");
  if (reportsEls.endDate && params.get("end")) reportsEls.endDate.value = params.get("end");
  if (reportsEls.endDate && !reportsEls.endDate.value) reportsEls.endDate.value = todayKey();
  if (reportsEls.search) reportsEls.search.value = params.get("q") || "";
  if (reportsEls.marginMin) reportsEls.marginMin.value = params.get("marginMin") || "";
  if (reportsEls.marginMax) reportsEls.marginMax.value = params.get("marginMax") || "";
}

function updateReportPeriodControls() {
  reportsEls.periodButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.reportPeriod === activePeriod);
    button.setAttribute("aria-pressed", button.dataset.reportPeriod === activePeriod ? "true" : "false");
  });
  reportsEls.saleKindButtons.forEach((button) => {
    const value = button.dataset.reportFilterSaleKind || button.value || "all";
    button.classList.toggle("active", value === activeSaleKind);
    button.setAttribute("aria-pressed", value === activeSaleKind ? "true" : "false");
  });
  reportsEls.costSourceButtons.forEach((button) => {
    const value = button.dataset.reportFilterCostSource || button.value || "all";
    button.classList.toggle("active", value === activeCostSource);
    button.setAttribute("aria-pressed", value === activeCostSource ? "true" : "false");
  });
}

function reportPeriodParams() {
  const params = new URLSearchParams();
  params.set("period", activePeriod);
  if (activePeriod === "custom") {
    const start = reportsEls.startDate?.value || "";
    const end = reportsEls.endDate?.value || todayKey();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
  }
  const saleKind = activeSaleKind || "all";
  const costSource = activeCostSource || "all";
  const q = (reportsEls.search?.value || "").trim();
  const marginMin = reportsEls.marginMin?.value || "";
  const marginMax = reportsEls.marginMax?.value || "";
  if (saleKind !== "all") params.set("saleKind", saleKind);
  if (costSource !== "all") params.set("costSource", costSource);
  if (q) params.set("q", q);
  if (marginMin !== "") params.set("marginMin", marginMin);
  if (marginMax !== "") params.set("marginMax", marginMax);
  return params;
}

function reportApiPath(path) {
  const params = reportPeriodParams().toString();
  return params ? `${path}?${params}` : path;
}

function reportApiUrl(base) {
  const url = new URL(base, window.location.href);
  reportPeriodParams().forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}

function invoiceValue(invoice) {
  if (window.ToxStore?.invoiceNet) return ToxStore.invoiceNet(invoice);
  return Number(invoice?.netUsd ?? invoice?.totalUsd ?? invoice?.subtotalUsd ?? 0) || 0;
}

function compactEmpty(message) {
  return `<div class="empty-2026" data-report-empty-state>${esc(message)}</div>`;
}

function setLiveStatus(mode, message) {
  if (!reportsEls.liveStatus) return;
  reportsEls.liveStatus.dataset.liveMode = mode;
  reportsEls.liveStatus.textContent = message;
}

function liveReportsUrl() {
  const url = new URL(reportsLiveApiUrl, window.location.href);
  reportPeriodParams().forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}

function stopPolling() {
  if (reportsPollingTimer) {
    clearInterval(reportsPollingTimer);
    reportsPollingTimer = null;
  }
}

function startPolling() {
  stopPolling();
  setLiveStatus("polling", "التحديث الحي: احتياطي كل 10 ثواني");
  reportsPollingTimer = setInterval(() => {
    loadReports({ showSkeleton: false, quiet: true }).catch((error) => console.warn(error));
  }, 10000);
}

function applyReportsPayload(payload, source = "api") {
  if (!payload) return;
  const revision = payload.revision || payload.analyticsRevision || "";
  const period = payload.period || {};
  const filters = payload.filters || {};
  const signature = [
    revision,
    period.key || activePeriod,
    period.startDate || "",
    period.endDate || "",
    filters.saleKind || "all",
    filters.costSource || "all",
    filters.q || "",
    filters.marginMin ?? "",
    filters.marginMax ?? ""
  ].join("|");
  if (signature && signature === reportsLastRevision && source !== "manual") return;
  reportsLastRevision = signature || reportsLastRevision;
  reportsPayload = { ...payload, source };
  renderReports(reportsPayload);
}

function setupCompactLayout() {
  // The redesigned reports page keeps secondary panels visible and ordered in HTML.
}

function setReportsSkeletons() {
  if (reportsEls.kpis) {
    reportsEls.kpis.innerHTML = Array.from({ length: 4 }).map(() => `<article class="erp-kpi-card-2026 skeleton-card"></article>`).join("");
  }
  if (reportsEls.featuredCards) {
    reportsEls.featuredCards.innerHTML = Array.from({ length: 6 }).map(() => `<article class="report-feature-card skeleton-card"></article>`).join("");
  }
  [
    reportsEls.metrics,
    reportsEls.monthlySales,
    reportsEls.insights,
    reportsEls.priorityActions,
    reportsEls.topProducts,
    reportsEls.topCustomers,
    reportsEls.customerDebt,
    reportsEls.supplierDebt,
    reportsEls.lowStock,
    reportsEls.installments,
    reportsEls.invoiceProfit,
    reportsEls.productProfit,
    reportsEls.profitTrend,
    reportsEls.stockBatches,
    reportsEls.missingCosts
  ].forEach((target) => {
    if (target) target.innerHTML = `<div class="skeleton-stack"><i></i><i></i><i></i></div>`;
  });
  if (reportsEls.score) reportsEls.score.textContent = "0";
  if (reportsEls.scoreLabel) reportsEls.scoreLabel.textContent = "قيد التحميل";
  if (reportsEls.scoreSummary) reportsEls.scoreSummary.textContent = "يتم قراءة بيانات التقارير.";
  if (reportsEls.dataSource) reportsEls.dataSource.textContent = "مصدر البيانات: جاري التحميل";
}

function renderKpis(payload) {
  const kpis = payload.kpis || {};
  const entries = kpiOrder.map((key) => [key, kpis[key]]).filter(([, item]) => item);
  reportsEls.kpis.innerHTML = entries.map(([key, item], index) => `
    <article class="erp-kpi-card-2026" data-tone="${esc(toneOf(item, key))}" style="--delay:${index * 30}ms">
      <div class="erp-kpi-top-2026">
        <span>${esc(reportLanguage() === "en" ? (item.labelEn || key) : (item.labelAr || key))}</span>
        <small>${esc(item.labelEn || "")}</small>
      </div>
      <strong>${esc(kpiValue(item, payload))}</strong>
      <em>${esc(kpiMicrocopy(key, item, payload))}</em>
      <i><b style="width:${Math.max(8, Math.min(100, Number(item.value || item.valueUsd || 0) % 100 || 48))}%"></b></i>
    </article>
  `).join("");
}

function kpiMicrocopy(key, item, payload) {
  const health = payload.health || {};
  if (reportLanguage() === "en") {
    return {
      revenue: `${payload.reports?.sales?.invoiceCount || 0} invoices`,
      saleReturns: "Sales returned in period",
      netSales: "After sales returns",
      cogs: "Cost of goods sold",
      trustedGrossProfit: `${payload.reports?.sales?.trustedGrossMargin || payload.reports?.sales?.grossMargin || 0}% trusted margin`,
      netProfit: `${payload.reports?.sales?.netProfitMargin || 0}% net margin`
    }[key] || "Executive metric";
  }
  const map = {
    todaySales: "حركة اليوم",
    revenue: `${payload.reports?.sales?.invoiceCount || 0} فاتورة`,
    cogs: "كلفة البضاعة المباعة",
    grossProfit: `${payload.reports?.sales?.grossMargin || payload.reports?.sales?.profitMargin || 0}% هامش`,
    trustedGrossProfit: `${payload.reports?.sales?.trustedGrossMargin || payload.reports?.sales?.grossMargin || 0}% هامش معتمد`,
    reviewProfit: `${number(payload.reports?.sales?.reviewProfitRowsCount || 0)} صف يحتاج مراجعة`,
    expenses: "مصاريف تشغيلية",
    netProfit: `${payload.reports?.sales?.netProfitMargin || 0}% صافي`,
    grossMargin: "مجمل الربح ÷ الإيراد",
    invoiceCount: "فاتورة ضمن الفترة",
    activeCustomers: "عميل مسجل",
    missingCost: "يحتاج مراجعة",
    pendingPayments: "متابعة التحصيل",
    collectionRate: `${health.collectionRate ?? item.value ?? 0}% من الديون`,
    lowStockAlerts: "مخزون يحتاج فحص"
  };
  return map[key] || "مؤشر تنفيذي";
}

function renderScore(payload) {
  const health = payload.health || {};
  const score = Number(health.score ?? payload.smartScore ?? payload.healthScore ?? 0);
  if (reportsEls.score) reportsEls.score.textContent = number(score);
  if (reportsEls.scoreRing) reportsEls.scoreRing.style.setProperty("--score", score);
  if (reportsEls.scoreLabel) reportsEls.scoreLabel.textContent = health.label || "مؤشر الصحة";
  if (reportsEls.scoreSummary) reportsEls.scoreSummary.textContent = health.summary || "لا توجد ملاحظات حرجة في البيانات الحالية.";
}

function renderBars(target, items, payload) {
  const rows = items || [];
  if (!target) return;
  const hasValues = rows.some((item) => Number(item.valueUsd || item.value || 0) > 0);
  if (!rows.length || !hasValues) {
    target.innerHTML = compactEmpty("لا توجد بيانات كافية لرسم الاتجاه");
    return;
  }
  const values = rows.map((item) => Number(item.valueUsd ?? item.value ?? 0));
  const max = Math.max(...values, 1);
  const width = 640;
  const height = 220;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = Math.round(index * step);
    const y = Math.round(height - (value / max) * 150 - 34);
    return `${x},${y}`;
  }).join(" ");
  const area = `0,${height - 16} ${points} ${width},${height - 16}`;
  target.innerHTML = `
    <svg class="report-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="اتجاه المبيعات">
      <defs>
        <linearGradient id="reportTrendLine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="var(--report-sales)" />
          <stop offset="100%" stop-color="var(--report-profit)" />
        </linearGradient>
        <linearGradient id="reportTrendArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--report-sales)" stop-opacity=".22" />
          <stop offset="100%" stop-color="var(--report-sales)" stop-opacity=".02" />
        </linearGradient>
      </defs>
      <polygon class="report-trend-area" points="${area}"></polygon>
      <polyline class="report-trend-line" points="${points}"></polyline>
      ${values.map((value, index) => {
        const [x, y] = points.split(" ")[index].split(",");
        return `<circle class="report-trend-dot" cx="${x}" cy="${y}" r="${value > 0 ? 5 : 3}"></circle>`;
      }).join("")}
    </svg>
    <div class="report-trend-labels">
      ${rows.map((item) => `<span><strong>${esc(item.formatted || money(item.valueUsd ?? item.value, payload))}</strong><small>${esc(item.label || "")}</small></span>`).join("")}
    </div>
  `;
}

function renderList(target, items, formatter, empty = "لا توجد بيانات") {
  if (!target) return;
  target.innerHTML = items?.length ? items.map(formatter).join("") : compactEmpty(empty);
}

function sectionMetrics(payload) {
  const reports = payload.reports || {};
  const health = payload.health || {};
  const map = {
    sales: [
      ["إجمالي المبيعات", money(reports.sales?.revenueUsd, payload), "sales"],
      ["مرتجعات البيع", money(reports.sales?.saleReturnsUsd, payload), "debt"],
      ["صافي المبيعات", money(reports.sales?.netSalesUsd, payload), "sales"],
      ["الربح قبل المرتجعات", money(reports.sales?.grossProfitUsd, payload), "profit"],
      ["الربح الملغى", money(reports.sales?.canceledProfitUsd, payload), "debt"],
      ["صافي الربح", money(reports.sales?.netProfitUsd, payload), "profit"]
    ],
    customers: [
      ["عدد العملاء", reports.customers?.count || 0, "customers"],
      ["ديون العملاء", money(reports.customers?.debtUsd, payload), "debt"],
      ["المحصل من العملاء", money(reports.customers?.collectedUsd, payload), "profit"],
      ["أعلى عملاء", reports.customers?.topRevenue?.length || 0, "customers"]
    ],
    suppliers: [
      ["إجمالي المشتريات", money(reports.suppliers?.purchasesUsd, payload), "suppliers"],
      ["مرتجعات الشراء", money(reports.suppliers?.purchaseReturnsUsd, payload), "profit"],
      ["صافي المشتريات", money(reports.suppliers?.netPurchasesUsd, payload), "suppliers"],
      ["مدفوع للموردين", money(reports.suppliers?.paidUsd, payload), "profit"]
    ],
    products: [
      ["عدد المنتجات", reports.products?.count || 0, "stock"],
      ["منتجات منخفضة", reports.products?.lowStock?.length || 0, "debt"],
      ["الأعلى مبيعاً", reports.products?.topSelling?.length || 0, "sales"],
      ["تنبيهات مخزون", payload.counts?.lowStock || 0, "stock"]
    ],
    warehouses: [
      ["عدد المخازن", reports.warehouses?.count || 0, "stock"],
      ["مخازن مراقبة", reports.warehouses?.status?.length || 0, "stock"],
      ["تنبيهات مخزون", payload.kpis?.lowStockAlerts?.value || 0, "debt"],
      ["مؤشر الصحة", `${health.score || 0}/100`, "score"]
    ],
    ledger: [
      ["Ledger العملاء", money(reports.ledger?.customerLedgerUsd, payload), "sales"],
      ["COGS", money(reports.ledger?.cogsUsd, payload), "suppliers"],
      ["مجمل الربح", money(reports.ledger?.grossProfitUsd, payload), "profit"],
      ["المصاريف", money(reports.ledger?.expensesUsd, payload), "debt"],
      ["صافي الربح", money(reports.ledger?.netProfitUsd, payload), "profit"]
    ]
  };
  return map[activeReport] || map.sales;
}

function renderSection(payload) {
  const [title, subtitle] = reportTitles[activeReport] || reportTitles.sales;
  if (reportsEls.title) reportsEls.title.textContent = title;
  if (reportsEls.subtitle) reportsEls.subtitle.textContent = subtitle;
  if (reportsEls.metrics) {
    reportsEls.metrics.innerHTML = sectionMetrics(payload).map(([label, value, tone]) => `
      <div class="report-metric-card-2026" data-tone="${esc(tone)}">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `).join("");
  }
  reportsEls.tabs.forEach((button) => button.classList.toggle("active", button.dataset.reportTab === activeReport));
}

function renderInsights(payload) {
  const insights = [...(payload.insights || [])].sort((left, right) => (
    (insightRank[left.tone] || 9) - (insightRank[right.tone] || 9)
  ));
  renderList(reportsEls.insights, insights, (item) => `
    <div class="insight-card-2026 ${esc(item.tone || "info")}">
      <strong>${esc(item.title)}</strong>
      <span>${esc(item.body)}</span>
    </div>
  `, "لا توجد مخاطر حالياً");
}

function priorityLabel(item) {
  const title = String(item?.title || "");
  if (/مخزون|نفاد|Stock/i.test(title)) return "راجع المخزون";
  if (/تحصيل|ديون|Balances|debt/i.test(title)) return "تابع التحصيل";
  if (/أقساط|Install/i.test(title)) return "راجع الأقساط";
  if (/مبيعات|عميل|إيراد|Sales|Customer/i.test(title)) return "استثمر الفرصة";
  return "متابعة";
}

function priorityActions(payload) {
  const insights = [...(payload.insights || [])].sort((left, right) => (
    (insightRank[left.tone] || 9) - (insightRank[right.tone] || 9)
  ));
  const actions = insights.map((item) => ({
    tone: item.tone || "info",
    title: item.title || "متابعة النظام",
    body: item.body || "راجع تفاصيل التقرير الحالي.",
    action: priorityLabel(item)
  }));
  const lowStockCount = Number(payload.counts?.lowStock || payload.widgets?.lowStock?.length || 0);
  const installmentCount = Number(payload.counts?.installmentRisks || payload.widgets?.installmentRisks?.length || 0);
  const collectionRate = Number(payload.health?.collectionRate || 0);
  if (lowStockCount && !actions.some((item) => /مخزون/.test(item.title))) {
    actions.push({ tone: "danger", title: "مخزون يحتاج فحص", body: `${lowStockCount} منتج عند حد التنبيه أو أقل.`, action: "راجع المخزون" });
  }
  if (installmentCount && !actions.some((item) => /أقساط/.test(item.title))) {
    actions.push({ tone: "warning", title: "أقساط تحتاج متابعة", body: `${installmentCount} قسط متأخر أو مستحق.`, action: "راجع الأقساط" });
  }
  if (collectionRate > 0 && collectionRate < 70 && !actions.some((item) => /تحصيل/.test(item.title))) {
    actions.push({ tone: "warning", title: "التحصيل أقل من المطلوب", body: `معدل التحصيل الحالي ${collectionRate}%.`, action: "تابع التحصيل" });
  }
  return actions.slice(0, 3);
}

function renderPriorityActions(payload) {
  if (!reportsEls.priorityActions) return;
  const actions = priorityActions(payload);
  renderList(reportsEls.priorityActions, actions, (item, index) => `
    <div class="priority-action-card ${esc(item.tone || "info")}">
      <span>${index + 1}</span>
      <strong>${esc(item.title)}</strong>
      <small>${esc(item.body)}</small>
      <em>${esc(item.action)}</em>
    </div>
  `, "لا توجد أولويات حرجة اليوم");
}

function renderWidgets(payload) {
  const debtAmount = (item) => Number(item?.balanceUsd ?? item?.debtUsd ?? 0);
  renderList(reportsEls.topProducts, payload.widgets?.topProducts, (item) => `
    <div class="compact-row-2026" data-tone="sales"><span><strong>${esc(item.name)}</strong><small>${esc(item.warehouse || "بدون مخزن")}</small></span><b>${esc(item.formattedTotal || money(item.totalUsd, payload))}</b></div>
  `, "لا توجد مبيعات منتجات");
  renderList(reportsEls.topCustomers, payload.widgets?.topCustomers, (item) => `
    <div class="compact-row-2026" data-tone="customers"><span><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></span><b>${esc(item.formattedTotal || money(item.totalUsd, payload))}</b></div>
  `, "لا توجد إيرادات عملاء");
  renderList(reportsEls.customerDebt, payload.widgets?.customerDebt, (item) => `
    <div class="compact-row-2026 danger" data-tone="debt"><span><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></span><b>${esc(item.formattedBalance || money(debtAmount(item), payload))}</b></div>
  `, "لا توجد ديون عملاء");
  renderList(reportsEls.supplierDebt, payload.widgets?.supplierDebt, (item) => `
    <div class="compact-row-2026 warning" data-tone="suppliers"><span><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></span><b>${esc(item.formattedBalance || money(debtAmount(item), payload))}</b></div>
  `, "لا توجد ديون موردين");
  renderList(reportsEls.lowStock, payload.widgets?.lowStock, (item) => `
    <div class="compact-row-2026 danger" data-tone="stock"><span><strong>${esc(item.name)}</strong><small>${esc(item.warehouse || "بدون مخزن")}</small></span><b>${esc(item.formattedStock || `${item.stock} / ${item.alert}`)}</b></div>
  `, "المخزون مستقر");
  renderList(reportsEls.installments, payload.widgets?.installmentRisks, (item) => `
    <div class="compact-row-2026 warning" data-tone="installments"><span><strong>${esc(item.customer)}</strong><small>${esc(item.invoiceId)} | ${number(item.daysLate)} يوم</small></span><b>${esc(item.formattedRemaining || money(item.remainingUsd, payload))}</b></div>
  `, "لا توجد أقساط متأخرة");
}

function accountingTable(headers, rows, emptyMessage) {
  if (!rows?.length) return compactEmpty(emptyMessage);
  return `
    <table class="accounting-report-table">
      <thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

function readinessStatusLabel(status) {
  if (status === "ready") return "جاهز للبيع";
  if (status === "needs_review") return "يحتاج مراجعة";
  if (status === "blocked") return "غير جاهز";
  return "قيد الفحص";
}

function readinessSeverityLabel(severity) {
  if (severity === "critical") return "حرج";
  if (severity === "warning") return "تحذير";
  return "معلومة";
}

function costSourceLabel(item) {
  const source = item?.costSource || item?.costStatus || "";
  if (item?.costSourceLabelAr) return item.costSourceLabelAr;
  if (source === "fifo_ok") return "FIFO حقيقي";
  if (source === "repaired_from_purchase_cost") return "كلفة مرممة";
  if (source === "estimated_from_product_cost") return "كلفة تقديرية";
  if (source === "missing_cost") return "نقص كلفة";
  return source || "-";
}

function costSourceClass(item) {
  const source = item?.costSource || item?.costStatus || "";
  return source === "fifo_ok" ? "ok" : "warn";
}

function trustedProfitDisplay(item, payload = reportsPayload) {
  return item?.formattedTrustedGrossProfit || money(item?.trustedGrossProfitUsd, payload);
}

function reviewProfitDisplay(item, payload = reportsPayload) {
  const value = Number(item?.estimatedGrossProfitUsd || 0);
  return value ? (item?.formattedEstimatedGrossProfit || money(value, payload)) : "-";
}

function reportUnitProfitStatus(productId, payload) {
  const product = (window.ToxStore?.getState?.()?.products || []).find((item) => item.id === productId);
  if (!product) return { label: "غير متاح", className: "warn" };
  const ratePayload = payload || reportsPayload;
  const rate = Number(ratePayload?.exchangeRate || 1460);
  const storageCostUsd = Number(product.purchaseCostUsd || 0);
  const storageMultiplier = Math.max(0.0001, Number(product.stockUnitMultiplier || 1));
  const pricedUnits = (product.units || []).filter((unit) => Number(unit.priceUsd || 0) > 0);
  if (!storageCostUsd || !pricedUnits.length) return { label: "نقص تسعير", className: "warn" };
  const rows = pricedUnits.map((unit) => {
    const costUsd = storageCostUsd * (Number(unit.multiplier || 1) / storageMultiplier);
    const profitUsd = Number(unit.priceUsd || 0) - costUsd;
    const margin = Number(unit.priceUsd || 0) > 0 ? (profitUsd / Number(unit.priceUsd || 0)) * 100 : 0;
    return { unit, profitUsd, margin };
  });
  const losses = rows.filter((row) => row.profitUsd < 0);
  if (losses.length) return { label: `خسارة: ${losses[0].unit.name}`, className: "warn" };
  const weak = rows.filter((row) => row.margin < 8);
  if (weak.length) return { label: `ربح ضعيف: ${weak[0].unit.name} ${number(weak[0].margin)}%`, className: "warn" };
  const best = rows.sort((left, right) => left.margin - right.margin)[0];
  return {
    label: `جيد ${number(best.margin)}% | ${money(best.profitUsd, { exchangeRate: rate })}`,
    className: "ok"
  };
}

function renderReadiness(payload) {
  const readiness = payload.readiness || payload.reports?.readiness || {};
  if (!reportsEls.readinessBoard || !readiness || !Object.keys(readiness).length) return;
  const counts = readiness.counts || {};
  if (reportsEls.readinessStatus) {
    const blocked = readiness.status === "blocked";
    reportsEls.readinessStatus.className = `cost-status-pill ${readiness.status === "ready" ? "ok" : "warn"}`;
    reportsEls.readinessStatus.textContent = readinessStatusLabel(readiness.status);
    reportsEls.readinessStatus.title = blocked ? "توجد مشاكل حرجة تمنع الاعتماد التجاري." : "";
  }
  if (reportsEls.readinessMetrics) {
    const backup = readiness.backup || {};
    const backupText = backup.messageAr || (backup.status === "ok" ? "النسخ الاحتياطي جيد" : "راجع النسخ الاحتياطي");
    reportsEls.readinessMetrics.innerHTML = [
      ["مؤشر الجاهزية", `${number(readiness.score || 0)}/100`, readiness.status === "ready" ? "profit" : "debt"],
      ["مشاكل حرجة", number(counts.critical || 0), counts.critical ? "debt" : "profit"],
      ["تحذيرات", number(counts.warning || 0), counts.warning ? "suppliers" : "profit"],
      ["النسخ الاحتياطي", backupText, backup.status === "ok" ? "profit" : "debt"]
    ].map(([label, value, tone]) => `
      <article class="report-metric-card-2026" data-tone="${esc(tone)}">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </article>
    `).join("");
  }
  if (reportsEls.readinessIssues) {
    reportsEls.readinessIssues.innerHTML = accountingTable(
      ["الحالة", "الفحص", "المنتج", "المخزن", "الإجراء المطلوب"],
      (readiness.issues || []).slice(0, 40).map((item) => `
        <tr>
          <td><span class="cost-status-pill ${item.severity === "critical" ? "warn" : item.severity === "warning" ? "warn" : "ok"}">${esc(readinessSeverityLabel(item.severity))}</span></td>
          <td>${esc(item.titleAr || item.titleEn || item.code || "-")}</td>
          <td>${esc(item.productName || "-")}</td>
          <td>${esc(item.warehouse || "-")}</td>
          <td>${esc(item.actionAr || item.actionEn || "-")}</td>
        </tr>
      `),
      "لا توجد مشاكل جاهزية واضحة. النظام أقرب للاعتماد التجاري."
    );
  }
}

function renderAccountingTables(payload) {
  const reports = payload.reports || {};
  if (reportsEls.missingPanel) {
    reportsEls.missingPanel.hidden = !(reports.missingCosts || []).length;
  }
  if (reportsEls.invoiceProfit) {
    reportsEls.invoiceProfit.innerHTML = accountingTable(
      ["الفاتورة", "العميل", "الإيراد", "COGS", "ربح البيع", "ربح التقسيط", "الربح المعتمد", "للمراجعة", "الهامش", "مصدر الكلفة"],
      (reports.profitInvoices || []).map((item) => `
        <tr>
          <td>${esc(item.id)}</td>
          <td>${esc(item.customerName || "-")}</td>
          <td>${esc(formattedMoney(item, "formattedRevenue", "revenueUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedCogs", "cogsUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedCashSaleProfit", "cashSaleProfitUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedInstallmentProfit", "installmentProfitUsd", payload))}</td>
          <td>${esc(trustedProfitDisplay(item, payload))}</td>
          <td>${esc(reviewProfitDisplay(item, payload))}</td>
          <td>${number(item.trustedGrossMargin ?? item.grossMargin ?? 0)}%</td>
          <td><span class="cost-status-pill ${costSourceClass(item)}">${esc(costSourceLabel(item))}</span></td>
        </tr>
      `),
      "لا توجد فواتير بيع لعرض الربح"
    );
  }
  if (reportsEls.productProfit) {
    reportsEls.productProfit.innerHTML = accountingTable(
      ["المنتج", "المخزن", "الكمية", "المرتجع", "الإيراد", "مرتجع إيراد", "الربح", "الربح الملغى", "صافي الربح", "الهامش", "مصدر الكلفة"],
      (reports.profitProducts || []).map((item) => `
        <tr>
          <td>${esc(item.name)}</td>
          <td>${esc(item.warehouse || "-")}</td>
          <td>${number(item.quantity || 0)} ${esc(item.unitName || "")}</td>
          <td>${number(item.returnQuantity || 0)} ${esc(item.unitName || "")}</td>
          <td>${esc(formattedMoney(item, "formattedRevenue", "revenueUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedReturnRevenue", "returnRevenueUsd", payload))}</td>
          <td>${esc(trustedProfitDisplay(item, payload))}</td>
          <td>${esc(formattedMoney(item, "formattedCanceledProfit", "canceledProfitUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedNetProfit", "netProfitUsd", payload))}</td>
          <td>${number(item.trustedGrossMargin ?? item.grossMargin ?? 0)}%</td>
          <td><span class="cost-status-pill ${costSourceClass(item)}">${esc(costSourceLabel(item))}</span></td>
        </tr>
      `),
      "لا توجد منتجات مباعة بعد"
    );
  }
  if (reportsEls.productAccounting) {
    reportsEls.productAccounting.innerHTML = accountingTable(
      ["المنتج", "المخزن", "المخزون/FIFO", "قيمة المخزون", "سعر الشراء", "المبيعات", "COGS", "الربح", "الوحدات", "ربح الوحدات", "الباركود", "الثقة"],
      (reports.productAccounting || []).map((item) => `
        <tr>
          <td><strong>${esc(item.name)}</strong><br><small>${esc(item.stockUnitName || "")} × ${number(item.stockUnitMultiplier || 1)}</small></td>
          <td>${esc(item.warehouse || "-")}</td>
          <td>${number(item.stockQuantity || 0)} / ${number(item.batchQuantity || 0)}<br><small>فرق ${number(item.fifoGapQuantity || 0)}</small></td>
          <td>${esc(formattedMoney(item, "formattedInventoryValue", "inventoryValueUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedPurchaseCost", "purchaseCostUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedRevenue", "revenueUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedCogs", "cogsUsd", payload))}</td>
          <td>${esc(trustedProfitDisplay(item, payload))}<br><small>مراجعة: ${esc(reviewProfitDisplay(item, payload))} | ${number(item.trustedGrossMargin ?? item.grossMargin ?? 0)}%</small></td>
          <td><span class="cost-status-pill ${item.unitStatus === "ok" ? "ok" : "warn"}">${esc(item.unitStatusLabelAr || item.unitStatus || "-")}</span></td>
          <td>${(() => {
            const status = reportUnitProfitStatus(item.id, payload);
            return `<span class="cost-status-pill ${status.className}">${esc(status.label)}</span>`;
          })()}</td>
          <td><span class="cost-status-pill ${item.barcodeStatus === "ok" ? "ok" : "warn"}">${esc(item.barcodeStatusLabelAr || item.barcodeStatus || "-")}</span></td>
          <td><span class="cost-status-pill ${item.inventoryStatus === "ok" ? "ok" : "warn"}">${esc(item.inventoryStatusLabelAr || "-")}</span><br><small>${esc(costSourceLabel(item))}</small></td>
        </tr>
      `),
      "لا توجد منتجات لعرض دفتر المحاسبة"
    );
  }
  if (reportsEls.stockBatches) {
    reportsEls.stockBatches.innerHTML = accountingTable(
      ["الدفعة", "المنتج", "المخزن", "الكمية", "كلفة الوحدة", "القيمة", "المصدر"],
      (reports.stockBatches || []).map((item) => `
        <tr>
          <td>${esc(item.batchCode)}</td>
          <td>${esc(item.productName)}</td>
          <td>${esc(item.warehouse || "-")}</td>
          <td>${number(item.quantity || 0)}</td>
          <td>${esc(formattedMoney(item, "formattedUnitCost", "unitCostUsd", payload))}</td>
          <td>${esc(formattedMoney(item, "formattedTotalValue", "totalValueUsd", payload))}</td>
          <td><span class="cost-status-pill ${costSourceClass(item)}">${esc(costSourceLabel(item))}</span></td>
        </tr>
      `),
      "لا توجد دفعات مخزون مفتوحة"
    );
  }
  if (reportsEls.missingCosts) {
    reportsEls.missingCosts.innerHTML = accountingTable(
      ["النوع", "الفاتورة", "المنتج", "المخزن", "الكمية", "السبب"],
      (reports.missingCosts || []).map((item) => `
        <tr>
          <td>${item.type === "invoice_item" ? "سطر فاتورة" : "منتج"}</td>
          <td>${esc(item.invoiceId || "-")}</td>
          <td>${esc(item.productName || "-")}</td>
          <td>${esc(item.warehouse || "-")}</td>
          <td>${number(item.quantity || 0)}</td>
          <td><span class="cost-status-pill warn">${esc(item.reason || "missing_cost")}</span></td>
        </tr>
      `),
      "لا توجد نواقص كلفة واضحة"
    );
  }
}

function toggleReportDetails(kind) {
  openReportDetail(kind === "product" ? "profits" : "invoices");
}

function reportFeaturedCards(payload) {
  const reports = payload.reports || {};
  const kpis = payload.kpis || {};
  const sales = reports.sales || {};
  const products = reports.products || {};
  const profitProducts = reports.profitProducts || [];
  const profitInvoices = reports.profitInvoices || [];
  const readiness = payload.readiness || reports.readiness || {};
  return [
    {
      title: "عدد الفواتير",
      value: number(sales.invoiceCount || profitInvoices.length || 0),
      meta: `متوسط الفاتورة ${kpiValue(kpis.averageInvoice, payload) || money(sales.averageInvoiceUsd || 0, payload)}`,
      tone: "invoices",
      action: "invoices",
      button: "عرض الفواتير"
    },
    {
      title: "عدد المنتجات",
      value: number(products.count || profitProducts.length || 0),
      meta: `${number(products.lowStock?.length || payload.counts?.lowStock || 0)} تنبيه مخزون`,
      tone: "stock",
      action: "products",
      button: "عرض المنتجات"
    },
    {
      title: "عدد العملاء",
      value: number(reports.customers?.count || kpis.activeCustomers?.value || 0),
      meta: `ديون العملاء ${money(reports.customers?.debtUsd || 0, payload)}`,
      tone: "customers",
      action: "customers",
      button: "عرض العملاء"
    },
    {
      title: "ربح المنتجات",
      value: products.formattedTrustedGrossProfit || money(products.trustedGrossProfitUsd ?? 0, payload),
      meta: `${number(products.soldProductCount || profitProducts.length || 0)} منتج مباع | مراجعة ${money(products.estimatedGrossProfitUsd || 0, payload)}`,
      tone: "profit",
      action: "profits",
      button: "عرض الأرباح"
    },
    {
      title: "تنبيهات المخزون",
      value: number(payload.counts?.lowStock || payload.widgets?.lowStock?.length || 0),
      meta: "منتجات عند حد التنبيه أو أقل",
      tone: "stock",
      action: "stock",
      button: "عرض المخزون"
    },
    {
      title: "جاهزية النظام",
      value: `${number(readiness.score || payload.health?.readinessScore || payload.smartScore || 0)}/100`,
      meta: readiness.summaryAr || payload.health?.summary || "مؤشر الصحة الحالي",
      tone: "score",
      action: "readiness",
      button: "عرض الجاهزية"
    }
  ];
}

function renderFeaturedReports(payload) {
  if (!reportsEls.featuredCards) return;
  reportsEls.featuredCards.innerHTML = reportFeaturedCards(payload).map((item) => `
    <article class="report-feature-card" data-tone="${esc(item.tone)}">
      <span>${esc(item.title)}</span>
      <strong>${esc(item.value)}</strong>
      <small>${esc(item.meta)}</small>
      <button class="button ghost compact-action" type="button" data-report-detail="${esc(item.action)}">${esc(item.button || "عرض التفاصيل")}</button>
    </article>
  `).join("");
}

function renderFinanceBridge(payload) {
  if (!reportsEls.financeBridge) return;
  if (reportLanguage() === "en") {
    const sales = payload.reports?.sales || {}, suppliers = payload.reports?.suppliers || {}, ledger = payload.reports?.ledger || {};
    const grid = reportsEls.financeBridge.querySelector(".report-finance-bridge-grid");
    if (grid) grid.innerHTML = [
      ["Sales returns", money(sales.saleReturnsUsd, payload), "Reduces net sales"],
      ["Purchase returns", money(suppliers.purchaseReturnsUsd, payload), "Reduces net purchases"],
      ["Operating expenses", money(ledger.expensesUsd, payload), "Rent · utilities · tax · payroll"],
      ["Profit after expenses", money(sales.netProfitUsd, payload), "Management decision metric"]
    ].map(([label, value, meta]) => `<article class="report-finance-bridge-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></article>`).join("");
    return;
  }
  const sales = payload.reports?.sales || {}, suppliers = payload.reports?.suppliers || {}, ledger = payload.reports?.ledger || {};
  const items = [["مرتجعات البيع", money(sales.saleReturnsUsd, payload), "تخفض المبيعات الصافية"], ["مرتجعات الشراء", money(suppliers.purchaseReturnsUsd, payload), "تخفض المشتريات الصافية"], ["مصاريف تشغيلية", money(ledger.expensesUsd, payload), "إيجار · كهرباء · ضرائب · رواتب"], ["الربح بعد المصروفات", money(sales.netProfitUsd, payload), "مؤشر القرار الإداري"]];
  const grid = reportsEls.financeBridge.querySelector(".report-finance-bridge-grid");
  if (grid) grid.innerHTML = items.map(([label, value, meta]) => `<article class="report-finance-bridge-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></article>`).join("");
}

function reportPeriodLabel(payload = reportsPayload) {
  const period = payload?.period || {};
  const labels = {
    today: "اليوم",
    week: "هذا الأسبوع",
    month: "هذا الشهر",
    last_month: "الشهر الماضي",
    year: "هذه السنة",
    last12: "آخر 12 شهر",
    all: "كل البيانات"
  };
  if (period.key === "custom") {
    return `${period.startDate || "البداية"} إلى ${period.endDate || "اليوم"}`;
  }
  return labels[period.key] || labels[activePeriod] || "الفترة المختارة";
}

function detailMetricGrid(items) {
  return `
    <div class="report-metric-grid-2026 drawer-metric-grid">
      ${items.map(([label, value, tone]) => `
        <article class="report-metric-card-2026" data-tone="${esc(tone || "sales")}">
          <span>${esc(label)}</span>
          <strong>${esc(value)}</strong>
        </article>
      `).join("")}
    </div>
  `;
}

function detailBlock(title, body) {
  return `
    <section class="report-detail-block">
      <h3>${esc(title)}</h3>
      ${body || compactEmpty("لا توجد بيانات لهذه التفاصيل")}
    </section>
  `;
}

function cachedHtml(target, emptyMessage) {
  const html = target?.innerHTML || "";
  if (!html.trim()) return compactEmpty(emptyMessage);
  return html.includes("accounting-report-table") ? `<div class="accounting-table-wrap">${html}</div>` : html;
}

function drawerList(target, emptyMessage) {
  return `<div class="compact-list-2026 drawer-list">${cachedHtml(target, emptyMessage)}</div>`;
}

function detailSearchPlaceholder(kind) {
  const placeholders = {
    invoices: "ابحث برقم الفاتورة، العميل، أو نوع البيع",
    profits: "ابحث بالمنتج، الفاتورة، العميل، أو المخزن",
    sales: "ابحث داخل ملخص المبيعات والرؤى",
    products: "ابحث باسم المنتج، الباركود، أو المخزن",
    customers: "ابحث باسم العميل أو المعرّف",
    topProducts: "ابحث باسم المنتج أو المخزن",
    topCustomers: "ابحث باسم العميل أو المعرّف",
    stock: "ابحث بالمنتج، المخزن، أو الدفعة",
    readiness: "ابحث بالمشكلة، المنتج، أو الإجراء",
    export: "ابحث داخل خيارات التصدير"
  };
  return placeholders[kind] || "ابحث داخل النتائج";
}

function filterDetailPageRows() {
  if (!reportsEls.detailPage || !reportsEls.detailPageSearch) return;
  const query = reportsEls.detailPageSearch.value.trim().toLowerCase();
  const candidates = reportsEls.detailPage.querySelectorAll(".accounting-report-table tbody tr, .compact-row-2026, .report-detail-block");
  candidates.forEach((item) => {
    if (item.classList.contains("report-detail-block") && item.querySelector(".accounting-report-table, .compact-row-2026")) return;
    const match = !query || item.textContent.toLowerCase().includes(query);
    item.hidden = !match;
  });
}

function salesDetail(payload) {
  const sales = payload.reports?.sales || {};
  return {
    kicker: "تحليل المبيعات",
    title: "تفاصيل المبيعات",
    subtitle: reportPeriodLabel(payload),
    summary: detailMetricGrid([
      ["الإيراد", money(sales.revenueUsd, payload), "sales"],
      ["COGS المعتمد", money(sales.trustedCogsUsd ?? sales.cogsUsd, payload), "suppliers"],
      ["الربح المعتمد", money(sales.trustedGrossProfitUsd ?? sales.grossProfitUsd, payload), "profit"],
      ["للمراجعة", money(sales.estimatedGrossProfitUsd || 0, payload), "debt"],
      ["صافي الربح", netProfitDisplay(sales, payload), sales.netProfitReliable === false ? "debt" : "profit"],
      ["متوسط الفاتورة", money(sales.averageInvoiceUsd, payload), "sales"],
      ["معدل التحصيل", `${number(sales.collectionRate || 0)}%`, "profit"]
    ]),
    body: detailBlock("رؤى الفترة", drawerList(reportsEls.insights, "لا توجد رؤى حالياً"))
  };
}

function detailConfig(kind, payload) {
  const reports = payload.reports || {};
  const readiness = payload.readiness || reports.readiness || {};
  const sales = reports.sales || {};
  const configs = {
    invoices: {
      kicker: "الفواتير",
      title: "فواتير الفترة",
      subtitle: `${number(sales.invoiceCount || 0)} فاتورة | ${reportPeriodLabel(payload)}`,
      summary: detailMetricGrid([
        ["عدد الفواتير", number(sales.invoiceCount || 0), "sales"],
        ["الإيراد", money(sales.revenueUsd, payload), "sales"],
        ["الربح المعتمد", money(sales.trustedGrossProfitUsd ?? sales.grossProfitUsd, payload), "profit"],
        ["متوسط الفاتورة", money(sales.averageInvoiceUsd, payload), "sales"]
      ]),
      body: detailBlock("ربح الفواتير", cachedHtml(reportsEls.invoiceProfit, "لا توجد فواتير ضمن الفترة"))
    },
    profits: {
      kicker: "الأرباح",
      title: "تفاصيل الأرباح",
      subtitle: reportPeriodLabel(payload),
      summary: detailMetricGrid([
        ["الإيراد", money(sales.revenueUsd, payload), "sales"],
        ["COGS المعتمد", money(sales.trustedCogsUsd ?? sales.cogsUsd, payload), "suppliers"],
        ["الربح المعتمد", money(sales.trustedGrossProfitUsd ?? sales.grossProfitUsd, payload), "profit"],
        ["للمراجعة", money(sales.estimatedGrossProfitUsd || 0, payload), "debt"],
        ["الهامش", `${number(sales.grossMargin ?? sales.profitMargin ?? 0)}%`, "profit"],
        ["Markup", `${number(sales.trustedMarkup || 0)}%`, "profit"],
        ["ثقة الربح", `${number(sales.profitConfidence ?? 100)}%`, sales.costTrustStatus === "trusted" ? "profit" : "debt"]
      ]),
      body: [
        detailBlock("ربح المنتجات", cachedHtml(reportsEls.productProfit, "لا توجد منتجات مباعة ضمن الفترة")),
        detailBlock("ربح الفواتير", cachedHtml(reportsEls.invoiceProfit, "لا توجد فواتير ضمن الفترة"))
      ].join("")
    },
    sales: salesDetail(payload),
    products: {
      kicker: "المنتجات",
      title: "دفتر المنتجات",
      subtitle: `${number(reports.products?.count || 0)} منتج`,
      summary: detailMetricGrid([
        ["عدد المنتجات", number(reports.products?.count || 0), "stock"],
        ["قيمة المخزون", reports.products?.formattedInventoryValue || money(reports.products?.inventoryValueUsd, payload), "stock"],
        ["تنبيهات المخزون", number(payload.counts?.lowStock || 0), "debt"],
        ["ربح المنتجات", reports.products?.formattedTrustedGrossProfit || money(reports.products?.trustedGrossProfitUsd || 0, payload), "profit"],
        ["منتجات مباعة", number(reports.products?.soldProductCount || reports.profitProducts?.length || 0), "sales"],
        ["ربح للمراجعة", reports.products?.formattedEstimatedGrossProfit || money(reports.products?.estimatedGrossProfitUsd || 0, payload), "debt"]
      ]),
      body: detailBlock("دفتر محاسبة المنتجات", cachedHtml(reportsEls.productAccounting, "لا توجد منتجات لعرض دفتر المحاسبة"))
    },
    customers: {
      kicker: "العملاء",
      title: "تفاصيل العملاء",
      subtitle: `${number(reports.customers?.count || 0)} عميل`,
      summary: detailMetricGrid([
        ["عدد العملاء", number(reports.customers?.count || 0), "customers"],
        ["ديون العملاء", money(reports.customers?.debtUsd, payload), "debt"],
        ["المحصل", money(reports.customers?.collectedUsd, payload), "profit"],
        ["أفضل العملاء", number(payload.widgets?.topCustomers?.length || 0), "customers"]
      ]),
      body: [
        detailBlock("أفضل العملاء", drawerList(reportsEls.topCustomers, "لا توجد إيرادات عملاء")),
        detailBlock("ديون العملاء", drawerList(reportsEls.customerDebt, "لا توجد ديون عملاء"))
      ].join("")
    },
    topProducts: {
      kicker: "أفضل المنتجات",
      title: "الأكثر مبيعاً",
      subtitle: reportPeriodLabel(payload),
      summary: detailMetricGrid([
        ["منتجات مباعة", number(payload.widgets?.topProducts?.length || 0), "stock"],
        ["إيراد الفترة", money(sales.revenueUsd, payload), "sales"],
        ["الربح المعتمد", money(sales.trustedGrossProfitUsd ?? sales.grossProfitUsd, payload), "profit"]
      ]),
      body: detailBlock("أفضل المنتجات", drawerList(reportsEls.topProducts, "لا توجد مبيعات منتجات"))
    },
    topCustomers: {
      kicker: "أفضل العملاء",
      title: "أفضل العملاء",
      subtitle: reportPeriodLabel(payload),
      summary: detailMetricGrid([
        ["عملاء ظاهرون", number(payload.widgets?.topCustomers?.length || 0), "customers"],
        ["إيراد الفترة", money(sales.revenueUsd, payload), "sales"],
        ["التحصيل", `${number(payload.health?.collectionRate || 0)}%`, "profit"]
      ]),
      body: detailBlock("أفضل العملاء", drawerList(reportsEls.topCustomers, "لا توجد إيرادات عملاء"))
    },
    stock: {
      kicker: "المخزون",
      title: "تنبيهات المخزون و FIFO",
      subtitle: `${number(payload.counts?.lowStock || 0)} تنبيه`,
      summary: detailMetricGrid([
        ["تنبيهات المخزون", number(payload.counts?.lowStock || 0), "debt"],
        ["دفعات FIFO", number(reports.stockBatches?.length || 0), "stock"],
        ["نواقص الكلفة", number(reports.missingCosts?.length || 0), "debt"]
      ]),
      body: [
        detailBlock("تنبيهات المخزون", drawerList(reportsEls.lowStock, "المخزون مستقر")),
        detailBlock("دفعات FIFO", cachedHtml(reportsEls.stockBatches, "لا توجد دفعات مخزون مفتوحة")),
        detailBlock("نواقص الكلفة", cachedHtml(reportsEls.missingCosts, "لا توجد نواقص كلفة واضحة"))
      ].join("")
    },
    readiness: {
      kicker: "جاهزية النظام",
      title: "جاهزية البيع التجاري",
      subtitle: readiness.summaryAr || payload.health?.summary || "فحص النظام",
      summary: cachedHtml(reportsEls.readinessMetrics, "لا توجد مؤشرات جاهزية"),
      body: [
        detailBlock("مشاكل الجاهزية", cachedHtml(reportsEls.readinessIssues, "لا توجد مشاكل جاهزية واضحة")),
        detailBlock("أولويات اليوم", drawerList(reportsEls.priorityActions, "لا توجد أولويات حرجة اليوم")),
        detailBlock("ديون الموردين", drawerList(reportsEls.supplierDebt, "لا توجد ديون موردين")),
        detailBlock("مخاطر الأقساط", drawerList(reportsEls.installments, "لا توجد أقساط متأخرة"))
      ].join("")
    },
    export: {
      kicker: "التصدير",
      title: "طباعة وتصدير الأرباح",
      subtitle: reportPeriodLabel(payload),
      summary: detailMetricGrid([
        ["الفترة", reportPeriodLabel(payload), "sales"],
        ["الفواتير", number(sales.invoiceCount || 0), "sales"],
        ["الربح المعتمد", money(sales.trustedGrossProfitUsd ?? sales.grossProfitUsd ?? 0, payload), "profit"],
        ["للمراجعة", money(sales.estimatedGrossProfitUsd || 0, payload), "debt"]
      ]),
      body: `
        ${Number(sales.missingCostRowsCount || sales.missingCostCount || 0) ? `
          <section class="report-cost-repair-callout" data-report-cost-repair-callout>
            <div>
              <strong>توجد فواتير ناقصة الكلفة</strong>
              <span>أي ربح بلا كلفة محفوظة لا يعتمد. الكلف المرممة تُحسب وتبقى للمراجعة.</span>
            </div>
            <button class="button warning" type="button" data-report-repair-costs>إصلاح الكلف الناقصة</button>
          </section>
        ` : ""}
        <section class="report-export-actions">
          <button class="button primary" type="button" data-report-export="print">طباعة / حفظ PDF</button>
          <button class="button ghost" type="button" data-report-export="excel">تصدير Excel</button>
        </section>
      `
    }
  };
  return configs[kind] || configs.sales;
}

function openReportDetail(kind) {
  if (!reportsPayload || !reportsEls.detailPage) return;
  activeDrawerKind = kind;
  const config = detailConfig(kind, reportsPayload);
  if (reportsEls.detailPageKicker) reportsEls.detailPageKicker.textContent = config.kicker || "تفاصيل التقرير";
  if (reportsEls.detailPageTitle) reportsEls.detailPageTitle.textContent = config.title || "التفاصيل";
  if (reportsEls.detailPageSubtitle) reportsEls.detailPageSubtitle.textContent = config.subtitle || reportPeriodLabel(reportsPayload);
  if (reportsEls.detailPageSummary) reportsEls.detailPageSummary.innerHTML = config.summary || "";
  if (reportsEls.detailPageBody) reportsEls.detailPageBody.innerHTML = config.body || compactEmpty("لا توجد بيانات");
  if (reportsEls.detailPageSearch) {
    reportsEls.detailPageSearch.value = "";
    reportsEls.detailPageSearch.placeholder = detailSearchPlaceholder(kind);
  }
  reportsEls.detailPage.hidden = false;
  reportsEls.workspace?.classList.add("report-detail-mode");
  document.body.classList.add("report-detail-page-open");
  reportsEls.detailPage.scrollIntoView({ block: "start" });
  filterDetailPageRows();
}

function closeReportDetail() {
  activeDrawerKind = "";
  if (reportsEls.drawer) reportsEls.drawer.hidden = true;
  if (reportsEls.detailPage) reportsEls.detailPage.hidden = true;
  reportsEls.workspace?.classList.remove("report-detail-mode");
  document.body.classList.remove("report-drawer-open");
  document.body.classList.remove("report-detail-page-open");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportCsv(payload) {
  const reports = payload.reports || {};
  const sales = reports.sales || {};
  const rows = [
    ["القسم", "الاسم", "الفترة/الوصف", "الإيراد IQD", "COGS IQD", "ربح البيع IQD", "ربح التقسيط IQD", "الربح المعتمد IQD", "ربح يحتاج مراجعة IQD", "الهامش %", "Markup %", "ثقة الربح %", "مصدر الكلفة"],
    ["ملخص", "الفترة", reportPeriodLabel(payload), money(sales.revenueUsd, payload), money(sales.trustedCogsUsd ?? sales.cogsUsd, payload), sales.formattedCashSaleProfit || money(sales.cashSaleProfitUsd || 0, payload), sales.formattedInstallmentProfit || money(sales.installmentProfitUsd || 0, payload), money(sales.trustedGrossProfitUsd ?? sales.grossProfitUsd, payload), money(sales.estimatedGrossProfitUsd || 0, payload), sales.grossMargin || 0, sales.trustedMarkup || 0, sales.profitConfidence ?? 100, sales.costTrustStatus === "trusted" ? "معتمد" : "يحتاج مراجعة"]
  ];
  (reports.profitInvoices || []).forEach((item) => rows.push([
    "فاتورة",
    item.id,
    item.customerName || "",
    item.formattedRevenue || money(item.revenueUsd, payload),
    item.formattedCogs || money(item.cogsUsd, payload),
    item.formattedCashSaleProfit || money(item.cashSaleProfitUsd || 0, payload),
    item.formattedInstallmentProfit || money(item.installmentProfitUsd || 0, payload),
    item.formattedTrustedGrossProfit || money(item.trustedGrossProfitUsd, payload),
    item.formattedEstimatedGrossProfit || money(item.estimatedGrossProfitUsd, payload),
    item.trustedGrossMargin ?? item.grossMargin ?? 0,
    item.trustedMarkup ?? item.grossMarkup ?? 0,
    item.costTrustStatus === "trusted" ? 100 : 0,
    costSourceLabel(item)
  ]));
  (reports.profitProducts || []).forEach((item) => rows.push([
    "منتج",
    item.name,
    `${item.warehouse || "-"} | ${item.unitName || ""}`,
    item.formattedRevenue || money(item.revenueUsd, payload),
    item.formattedCogs || money(item.cogsUsd, payload),
    item.formattedCashSaleProfit || money(item.cashSaleProfitUsd || 0, payload),
    item.formattedInstallmentProfit || money(item.installmentProfitUsd || 0, payload),
    item.formattedTrustedGrossProfit || money(item.trustedGrossProfitUsd, payload),
    item.formattedEstimatedGrossProfit || money(item.estimatedGrossProfitUsd, payload),
    item.trustedGrossMargin ?? item.grossMargin ?? 0,
    item.trustedMarkup ?? item.grossMarkup ?? 0,
    item.costTrustStatus === "trusted" ? 100 : 0,
    costSourceLabel(item)
  ]));
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function downloadReportFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function reportPrintHtml(payload) {
  const printEnglish = reportLanguage() === "en";
  const printText = (ar, en) => printEnglish ? en : ar;
  const reports = payload.reports || {};
  const sales = reports.sales || {};
  const invoices = reports.profitInvoices || [];
  const products = reports.profitProducts || [];
  const reviewRows = invoices.filter((item) => (
    item?.costTrustStatus !== "trusted"
    || item?.costSource !== "fifo_ok"
    || Number(item?.estimatedGrossProfitUsd || 0) !== 0
  ));
  const invoiceRows = invoices.map((item) => `
    <tr>
      <td>${esc(item.id)}</td>
      <td>${esc(item.customerName || "-")}</td>
      <td>${esc(item.kind || "-")}</td>
      <td>${esc(item.formattedRevenue || money(item.revenueUsd, payload))}</td>
      <td>${esc(item.formattedCogs || money(item.cogsUsd, payload))}</td>
      <td>${esc(item.formattedCashSaleProfit || money(item.cashSaleProfitUsd || 0, payload))}</td>
      <td>${esc(item.formattedInstallmentProfit || money(item.installmentProfitUsd || 0, payload))}</td>
      <td>${esc(item.formattedTrustedGrossProfit || money(item.trustedGrossProfitUsd, payload))}</td>
      <td>${esc(item.formattedEstimatedGrossProfit || money(item.estimatedGrossProfitUsd, payload))}</td>
      <td>${number(item.trustedGrossMargin ?? item.grossMargin ?? 0)}%</td>
      <td>${esc(costSourceLabel(item))}</td>
    </tr>
  `).join("");
  const productRows = products.map((item) => `
    <tr>
      <td>${esc(item.name)}</td>
      <td>${esc(item.warehouse || "-")}</td>
      <td>${number(item.quantity || 0)} ${esc(item.unitName || "")}</td>
      <td>${esc(item.formattedRevenue || money(item.revenueUsd, payload))}</td>
      <td>${esc(item.formattedCogs || money(item.cogsUsd, payload))}</td>
      <td>${esc(item.formattedCashSaleProfit || money(item.cashSaleProfitUsd || 0, payload))}</td>
      <td>${esc(item.formattedInstallmentProfit || money(item.installmentProfitUsd || 0, payload))}</td>
      <td>${esc(item.formattedTrustedGrossProfit || money(item.trustedGrossProfitUsd, payload))}</td>
      <td>${esc(item.formattedEstimatedGrossProfit || money(item.estimatedGrossProfitUsd, payload))}</td>
      <td>${number(item.trustedGrossMargin ?? item.grossMargin ?? 0)}%</td>
      <td>${esc(costSourceLabel(item))}</td>
    </tr>
  `).join("");
  const reviewTableRows = reviewRows.map((item) => `
    <tr>
      <td>${esc(item.id)}</td>
      <td>${esc(item.customerName || "-")}</td>
      <td>${esc(item.formattedRevenue || money(item.revenueUsd, payload))}</td>
      <td>${esc(item.formattedEstimatedGrossProfit || money(item.estimatedGrossProfitUsd || item.grossProfitUsd || 0, payload))}</td>
      <td>${esc(costSourceLabel(item))}</td>
      <td>داخل الربح المحسوب إذا كانت الكلفة محفوظة، ويحتاج تثبيت مصدر الكلفة.</td>
    </tr>
  `).join("");
  const warning = Number(sales.reviewProfitRowsCount || 0)
    ? `<div class="notice">تنبيه محاسبي: يوجد ${number(sales.reviewProfitRowsCount)} صف ربح يحتاج مراجعة، منها ${number(sales.missingCostRowsCount || sales.missingCostCount || 0)} نقص كلفة. الصفوف ذات الكلفة المرممة محسوبة وتبقى للمراجعة.</div>`
    : `<div class="notice ok">كل أرباح الفترة المعروضة معتمدة من FIFO.</div>`;
  return `<!doctype html>
<html lang="${printEnglish ? "en" : "ar"}" dir="${printEnglish ? "ltr" : "rtl"}">
<head>
  <meta charset="utf-8">
  <title>TOX - ${printText("تقرير الأرباح", "Profit report")}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { background: #fff; }
    body { margin: 0; color: #111827; font-family: "Segoe UI", "Noto Kufi Arabic", Tahoma, Arial, sans-serif; line-height: 1.55; }
    .sheet { display: grid; gap: 14px; }
    .top { display: flex; justify-content: space-between; gap: 18px; align-items: start; border: 1px solid #dbe3ee; border-bottom: 4px solid #0f766e; padding: 16px 18px 12px; border-radius: 10px; background: linear-gradient(135deg, #f8fafc, #eef6ff); break-inside: avoid; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 26px; line-height: 1.2; }
    h2 { font-size: 16px; margin: 8px 0; color: #0f172a; }
    .brand { text-align: left; font-weight: 900; }
    .brand strong { display: inline-grid; place-items: center; width: 54px; height: 42px; border: 2px solid #0f766e; border-radius: 8px; font-size: 20px; }
    .brand span { display: block; color: #475569; font-size: 11px; margin-top: 4px; }
    .meta { color: #64748b; font-size: 12px; margin-top: 6px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; break-inside: avoid; }
    .summary div { border: 1px solid #dbe3ee; padding: 10px; border-radius: 8px; background: #f8fafc; min-height: 64px; box-shadow: 0 2px 7px rgba(15,23,42,.04); }
    .summary span { color: #64748b; font-size: 12px; }
    .summary strong { display: block; margin-top: 4px; font-size: 16px; color: #075985; }
    .notice { border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; padding: 10px 12px; border-radius: 8px; font-weight: 800; }
    .notice.ok { border-color: #10b981; background: #ecfdf5; color: #047857; }
    section { break-inside: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    th { background: #0f766e; color: #fff; font-weight: 900; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 6px; text-align: right; vertical-align: top; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    .money { white-space: nowrap; }
    .footer { margin-top: 18px; color: #64748b; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
    @media screen {
      body { background: #eef4fb; padding: 18px; }
      .sheet { width: min(980px, 100%); margin: 0 auto; background: #fff; padding: 18px; box-shadow: 0 20px 60px rgba(15,23,42,.16); border-radius: 8px; }
    }
    @media print {
      body { padding: 0; }
      .sheet { width: 100%; }
    }
    @media screen and (max-width: 760px) {
      .top { flex-direction: column; }
      .summary { grid-template-columns: repeat(2, 1fr); }
      table { font-size: 9px; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <section class="top">
      <div>
        <h1>${printText("تقرير الأرباح المعتمد", "Trusted profit report")}</h1>
        <p class="meta">${printText("الفترة", "Period")}: ${esc(reportPeriodLabel(payload))} | ${printText("الإصدار", "Issued")}: ${esc(payload.updatedAtFormatted || new Date().toLocaleString(printEnglish ? "en-US" : "ar-IQ"))}</p>
      </div>
      <div class="brand"><strong>TOX</strong><span>نظام مبيعات ومخزون</span></div>
    </section>
    <section class="summary">
      <div><span>${printText("الإيراد", "Revenue")}</span><strong>${esc(money(sales.revenueUsd, payload))}</strong></div>
      <div><span>COGS ${printText("المعتمد", "trusted")}</span><strong>${esc(money(sales.trustedCogsUsd ?? sales.cogsUsd, payload))}</strong></div>
      <div><span>${printText("الربح المعتمد", "Trusted profit")}</span><strong>${esc(money(sales.trustedGrossProfitUsd ?? sales.grossProfitUsd, payload))}</strong></div>
      <div><span>${printText("للمراجعة", "For review")}</span><strong>${esc(money(sales.estimatedGrossProfitUsd || 0, payload))}</strong></div>
      <div><span>${printText("عدد الفواتير", "Invoices")}</span><strong>${number(sales.invoiceCount || 0)}</strong></div>
      <div><span>${printText("ثقة الربح", "Profit confidence")}</span><strong>${number(sales.profitConfidence ?? 100)}%</strong></div>
      <div><span>${printText("هامش الربح", "Profit margin")}</span><strong>${number(sales.grossMargin ?? sales.profitMargin ?? 0)}%</strong></div>
      <div><span>Markup</span><strong>${number(sales.trustedMarkup || 0)}%</strong></div>
    </section>
    ${warning}
    <section><h2>تفاصيل الفواتير</h2><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>نوع البيع</th><th>الإيراد</th><th>COGS</th><th>ربح البيع</th><th>ربح التقسيط</th><th>الربح المعتمد</th><th>للمراجعة</th><th>الهامش</th><th>المصدر</th></tr></thead><tbody>${invoiceRows || `<tr><td colspan="11">لا توجد فواتير ضمن الفترة</td></tr>`}</tbody></table></section>
    <section><h2>تفاصيل المنتجات</h2><table><thead><tr><th>المنتج</th><th>المخزن</th><th>الكمية</th><th>الإيراد</th><th>COGS</th><th>ربح البيع</th><th>ربح التقسيط</th><th>الربح المعتمد</th><th>للمراجعة</th><th>الهامش</th><th>المصدر</th></tr></thead><tbody>${productRows || `<tr><td colspan="11">لا توجد منتجات ضمن الفترة</td></tr>`}</tbody></table></section>
    ${reviewRows.length ? `<section><h2>أرباح تحتاج مراجعة</h2><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>الإيراد</th><th>قيمة المراجعة</th><th>سبب الكلفة</th><th>الإجراء المحاسبي</th></tr></thead><tbody>${reviewTableRows}</tbody></table></section>` : ""}
    <p class="footer">الربح المعتمد يحتسب من الكلفة المحفوظة وقت البيع. الكلفة المرممة أو التقديرية تدخل بالحساب وتظهر للمراجعة حتى تثبت من FIFO.</p>
  </main>
</body>
</html>`;
}

function printReport(payload) {
  const html = reportPrintHtml(payload);
  const win = window.open("", "tox_profit_report", "width=980,height=720");
  if (!win) {
    if (window.showNotice) showNotice("المتصفح منع فتح نافذة الطباعة", "error");
    return;
  }
  const runPrint = () => {
    try {
      win.focus();
      win.print();
    } catch (error) {
      console.warn("Report print failed", error);
      if (window.showNotice) showNotice("تعذر تشغيل نافذة الطباعة، افتح النافذة الجديدة واحفظها PDF", "warning");
    }
  };
  try {
    win.document.open("text/html", "replace");
    win.document.write(html);
    win.document.close();
    if (win.document.readyState === "complete") {
      setTimeout(runPrint, 350);
    } else {
      win.addEventListener("load", () => setTimeout(runPrint, 250), { once: true });
      setTimeout(runPrint, 900);
    }
  } catch (error) {
    console.warn("Could not write report print window", error);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    win.location.href = URL.createObjectURL(blob);
    setTimeout(runPrint, 900);
  }
}

async function repairMissingInvoiceCosts(button) {
  const previousText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "جاري الإصلاح...";
  }
  try {
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ dryRun: false })
    };
    const response = window.ToxApi?.fetch
      ? await window.ToxApi.fetch("/invoice-costs/repair/", options)
      : await fetch(reportsRepairCostsApiUrl, { credentials: "include", ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.reason || result.message || `Repair API ${response.status}`);
    }
    const message = `تم فحص ${number(result.scanned || 0)} صف: FIFO ${number(result.fifoRepaired || 0)}، مرمم ${number(result.estimatedRepaired || 0)}، متروك ${number(result.skipped || 0)}.`;
    if (window.showNotice) showNotice(message, "success");
    await loadReports({ showSkeleton: true, source: "manual" });
  } catch (error) {
    console.warn("Missing cost repair failed", error);
    if (window.showNotice) showNotice("تعذر إصلاح الكلف الناقصة. راجع الصلاحيات أو اتصال قاعدة البيانات.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText || "إصلاح الكلف الناقصة";
    }
  }
}

function exportReport(format = "excel") {
  if (!reportsPayload) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const period = reportsPayload.period?.key || activePeriod || "report";
  if (format === "print") {
    printReport(reportsPayload);
  } else if (format === "json") {
    downloadReportFile(`tox-report-${period}-${stamp}.json`, JSON.stringify(reportsPayload, null, 2), "application/json;charset=utf-8");
  } else {
    downloadReportFile(`tox-profit-report-${period}-${stamp}.csv`, `\ufeff${reportCsv(reportsPayload)}`, "text/csv;charset=utf-8");
  }
  if (window.showNotice) showNotice("تم تجهيز ملف التقرير", "success");
}

function renderReports(payload) {
  syncReportChromeLanguage();
  updateReportPeriodControls();
  renderKpis(payload);
  renderFeaturedReports(payload);
  renderFinanceBridge(payload);
  renderScore(payload);
  renderSection(payload);
  renderBars(reportsEls.monthlySales, payload.charts?.monthlySales || [], payload);
  renderBars(reportsEls.profitTrend, payload.charts?.profitTrend || [], payload);
  renderInsights(payload);
  renderPriorityActions(payload);
  renderWidgets(payload);
  renderReadiness(payload);
  renderAccountingTables(payload);
  if (activeDrawerKind) openReportDetail(activeDrawerKind);
  if (reportsEls.updated) {
    reportsEls.updated.textContent = payload.updatedAtFormatted || new Date(payload.updatedAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
  }
  if (reportsEls.dataSource) {
    reportsEls.dataSource.textContent = payload.source === "local"
      ? "مصدر البيانات: محلي احتياطي"
      : "مصدر البيانات: API مباشر";
  }
}

function buildMonthlySales(invoices, months = 6) {
  const now = new Date();
  const keys = Array.from({ length: months }).map((_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (months - index - 1), 1);
    return monthKey(date);
  });
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  invoices.forEach((invoice) => {
    const key = monthKey(invoice.createdAt || invoice.date || invoice.updatedAt);
    if (Object.prototype.hasOwnProperty.call(totals, key)) {
      totals[key] += invoiceValue(invoice);
    }
  });
  return keys.map((key) => ({ label: key, valueUsd: totals[key], formatted: money(totals[key], { exchangeRate: window.ToxStore?.getState?.().exchangeRate || 1460 }) }));
}

function buildLocalReportsPayload(error) {
  if (!window.ToxStore?.getState) return null;
  const state = ToxStore.getState();
  const snapshot = ToxStore.reportSnapshot?.() || {};
  const summary = snapshot.summary || {};
  const invoices = (state.invoices || []).filter((invoice) => !invoice.isVoided && invoice.paymentStatus !== "void");
  const today = dateKey(new Date());
  const todayUsd = invoices
    .filter((invoice) => dateKey(invoice.createdAt || invoice.date || invoice.updatedAt) === today)
    .reduce((sum, invoice) => sum + invoiceValue(invoice), 0);
  const revenueUsd = Number(summary.salesNetUsd || 0);
  const cogsUsd = invoices.reduce((sum, invoice) => sum + (invoice.items || []).reduce((lineSum, item) => lineSum + Number(item.totalCostUsd || 0), 0), 0);
  const grossProfitUsd = revenueUsd - cogsUsd;
  const expensesUsd = Number(summary.cashVoucherPaymentsUsd || 0);
  const netProfitUsd = grossProfitUsd - expensesUsd;
  const missingCosts = (state.products || [])
    .filter((product) => Number(product.purchaseCostUsd || 0) <= 0)
    .map((product) => ({
      type: "product",
      productId: product.id,
      productName: product.name,
      warehouse: "",
      quantity: Number(product.stockQuantity || 0),
      reason: "missing_default_cost"
    }));
  const pendingUsd = Number(summary.salesDebtUsd || 0) + Number(summary.purchasesDebtUsd || 0);
  const collectionRate = revenueUsd > 0 ? Math.round(Math.max(0, Math.min(100, ((revenueUsd - Number(summary.salesDebtUsd || 0)) / revenueUsd) * 100))) : 0;
  const lowStock = (snapshot.lowStock || []).map((item) => ({ ...item, formattedStock: item.stockText || "" }));
  const clientDebt = snapshot.clientDebt || [];
  const supplierDebt = snapshot.supplierDebt || [];
  const score = Math.max(0, Math.min(100, 100 - Math.min(25, lowStock.length * 4) - Math.min(25, clientDebt.length * 4) - (collectionRate && collectionRate < 60 ? 15 : 0)));
  const insights = [];
  if (lowStock.length) insights.push({ tone: "danger", title: "مخاطر نفاد مخزون", body: `${lowStock.length} منتج يحتاج متابعة مخزون فورية.` });
  if (clientDebt.length) insights.push({ tone: "warning", title: "ديون عملاء تحتاج تحصيل", body: `${clientDebt.length} عميل لديه رصيد مطلوب.` });
  if (revenueUsd > 0) insights.push({ tone: "positive", title: "بيانات مبيعات متوفرة", body: "تم بناء هذا التقرير من بيانات المتصفح المحلية عند تعذر الاتصال." });
  if (!insights.length) insights.push({ tone: "info", title: "لا توجد بيانات كافية", body: "ابدأ بإدخال مبيعات ومنتجات حتى تظهر الرؤى التنفيذية." });
  return {
    ok: true,
    source: "local",
    offlineReason: error?.message || "",
    updatedAt: new Date().toISOString(),
    updatedAtFormatted: new Date().toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" }),
    currency: state.currency || "IQD",
    exchangeRate: Number(state.exchangeRate || 1460),
    smartScore: score,
    healthScore: score,
    health: {
      score,
      label: score >= 82 ? "ممتاز" : score >= 65 ? "مستقر" : score >= 45 ? "يحتاج متابعة" : "خطر",
      summary: `مؤشر الصحة ${score}/100 · معدل التحصيل ${collectionRate}%`,
      collectionRate,
      profitMargin: revenueUsd > 0 ? Math.round((grossProfitUsd / revenueUsd) * 100) : 0,
      netProfitMargin: revenueUsd > 0 ? Math.round((netProfitUsd / revenueUsd) * 100) : 0,
      missingCostCount: missingCosts.length,
      riskCount: lowStock.length + clientDebt.length
    },
    kpis: {
      todaySales: { labelAr: "مبيعات اليوم", labelEn: "Today Sales", tone: "sales", valueUsd: todayUsd },
      revenue: { labelAr: "الإيراد", labelEn: "Revenue", tone: "sales", valueUsd: revenueUsd },
      cogs: { labelAr: "كلفة البضاعة المباعة", labelEn: "COGS", tone: "suppliers", valueUsd: cogsUsd },
      grossProfit: { labelAr: "مجمل الربح", labelEn: "Gross Profit", tone: "profit", valueUsd: grossProfitUsd },
      trustedGrossProfit: { labelAr: "الربح المعتمد", labelEn: "Trusted Profit", tone: "profit", valueUsd: grossProfitUsd },
      reviewProfit: { labelAr: "ربح يحتاج مراجعة", labelEn: "Review Profit", tone: "debt", valueUsd: 0 },
      expenses: { labelAr: "المصاريف", labelEn: "Expenses", tone: "debt", valueUsd: expensesUsd },
      netProfit: { labelAr: "صافي الربح", labelEn: "Net Profit", tone: "profit", valueUsd: netProfitUsd },
      grossMargin: { labelAr: "هامش الربح", labelEn: "Gross Margin", tone: "profit", value: revenueUsd > 0 ? Math.round((grossProfitUsd / revenueUsd) * 100) : 0, formatted: `${revenueUsd > 0 ? Math.round((grossProfitUsd / revenueUsd) * 100) : 0}%` },
      missingCost: { labelAr: "نواقص الكلفة", labelEn: "Missing Cost", tone: "debt", value: missingCosts.length },
      pendingPayments: { labelAr: "ديون معلقة", labelEn: "Pending Balances", tone: "debt", valueUsd: pendingUsd },
      collectionRate: { labelAr: "معدل التحصيل", labelEn: "Collection Rate", tone: "profit", value: collectionRate, formatted: `${collectionRate}%` },
      invoiceCount: { labelAr: "عدد الفواتير", labelEn: "Invoices", tone: "sales", value: invoices.length },
      activeCustomers: { labelAr: "عدد العملاء", labelEn: "Customers", tone: "customers", value: state.clients?.length || 0 },
      lowStockAlerts: { labelAr: "تنبيهات مخزون", labelEn: "Low Stock Alerts", tone: "stock", value: lowStock.length }
    },
    charts: { monthlySales: buildMonthlySales(invoices), profitTrend: buildMonthlySales(invoices) },
    widgets: {
      topProducts: (snapshot.topProducts || []).map((item) => ({ ...item, formattedTotal: money(item.totalUsd, { exchangeRate: state.exchangeRate }) })),
      topCustomers: clientDebt.slice(0, 5).map((item) => ({ ...item, formattedTotal: money(item.debtUsd, { exchangeRate: state.exchangeRate }) })),
      customerDebt: clientDebt,
      supplierDebt,
      lowStock,
      installmentRisks: []
    },
    reports: {
      sales: { revenueUsd, cogsUsd, grossProfitUsd, allCogsUsd: cogsUsd, allGrossProfitUsd: grossProfitUsd, trustedRevenueUsd: revenueUsd, trustedCogsUsd: cogsUsd, trustedGrossProfitUsd: grossProfitUsd, estimatedGrossProfitUsd: 0, reviewProfitRowsCount: missingCosts.length, costTrustStatus: missingCosts.length ? "needs_review" : "trusted", expensesUsd, netProfitUsd, todayUsd, invoiceCount: invoices.length, averageInvoiceUsd: invoices.length ? revenueUsd / invoices.length : 0, collectionRate, profitMargin: revenueUsd > 0 ? Math.round((grossProfitUsd / revenueUsd) * 100) : 0, grossMargin: revenueUsd > 0 ? Math.round((grossProfitUsd / revenueUsd) * 100) : 0, netProfitMargin: revenueUsd > 0 ? Math.round((netProfitUsd / revenueUsd) * 100) : 0, missingCostCount: missingCosts.length },
      customers: { count: state.clients?.length || 0, debtUsd: Number(summary.salesDebtUsd || 0), collectedUsd: Math.max(0, revenueUsd - Number(summary.salesDebtUsd || 0)), topRevenue: clientDebt },
      suppliers: { count: state.suppliers?.length || 0, debtUsd: Number(summary.purchasesDebtUsd || 0), purchasesUsd: Number(summary.purchasesTotalUsd || 0), paidUsd: Math.max(0, Number(summary.purchasesTotalUsd || 0) - Number(summary.purchasesDebtUsd || 0)) },
      products: { count: state.products?.length || 0, topSelling: snapshot.topProducts || [], lowStock },
      warehouses: { count: state.warehouses?.length || 0, status: [] },
      ledger: { customerLedgerUsd: revenueUsd, supplierLedgerUsd: Number(summary.purchasesTotalUsd || 0), cogsUsd, grossProfitUsd, expensesUsd, netProfitUsd, entries: state.accountMovements?.length || 0 },
      profitInvoices: invoices.slice(0, 60).map((invoice) => {
        const invoiceRevenue = invoiceValue(invoice);
        const invoiceCogs = (invoice.items || []).reduce((sum, item) => sum + Number(item.totalCostUsd || 0), 0);
        const invoiceProfit = invoiceRevenue - invoiceCogs;
        return {
          id: invoice.id,
          customerName: invoice.customerName || "",
          revenueUsd: invoiceRevenue,
          cogsUsd: invoiceCogs,
          grossProfitUsd: invoiceProfit,
          trustedGrossProfitUsd: invoiceCogs > 0 ? invoiceProfit : 0,
          estimatedGrossProfitUsd: invoiceCogs > 0 ? 0 : invoiceProfit,
          trustedGrossMargin: invoiceRevenue > 0 && invoiceCogs > 0 ? Math.round((invoiceProfit / invoiceRevenue) * 100) : 0,
          costSource: invoiceCogs > 0 ? "fifo_ok" : "missing_cost",
          costSourceLabelAr: invoiceCogs > 0 ? "FIFO حقيقي" : "نقص كلفة",
          costTrustStatus: invoiceCogs > 0 ? "trusted" : "needs_review",
          grossMargin: invoiceRevenue > 0 ? Math.round((invoiceProfit / invoiceRevenue) * 100) : 0,
          costStatus: invoiceCogs > 0 ? "ok" : "missing_cost",
          missingCostCount: invoiceCogs > 0 ? 0 : 1
        };
      }),
      profitProducts: [],
      stockBatches: [],
      missingCosts
    },
    insights,
    counts: { lowStock: lowStock.length, installmentRisks: 0 }
  };
}

async function loadReports(options = {}) {
  const showSkeleton = options.showSkeleton !== false;
  const quiet = options.quiet === true;
  if (showSkeleton) setReportsSkeletons();
  reportsEls.refresh?.setAttribute("disabled", "disabled");
  try {
    const response = window.ToxApi?.fetch ? await window.ToxApi.fetch(reportApiPath("/analytics/reports/"), {
      headers: authHeaders()
    }) : await fetch(reportApiUrl(reportsApiUrl), {
      credentials: "include",
      headers: { Accept: "application/json", ...authHeaders() }
    });
    if (!response.ok) throw new Error(`Reports API ${response.status}`);
    applyReportsPayload(await response.json(), options.source || "api");
  } catch (error) {
    console.warn(error);
    const localPayload = buildLocalReportsPayload(error);
    if (!localPayload) throw error;
    applyReportsPayload(localPayload, "local");
    if (!quiet && window.showNotice) showNotice("تم عرض تقارير محلية مؤقتة لأن مصدر API غير متاح", "warning");
  } finally {
    reportsEls.refresh?.removeAttribute("disabled");
  }
}

function startLiveReports() {
  setupCompactLayout();
  setReportsSkeletons();
  if (!window.EventSource) {
    loadReports({ showSkeleton: false, quiet: true }).catch((error) => console.warn(error));
    startPolling();
    return;
  }
  try {
    reportsEventSource?.close?.();
    reportsEventSource = new EventSource(liveReportsUrl(), { withCredentials: true });
    setLiveStatus("connecting", "التحديث الحي: جاري الاتصال");
    reportsEventSource.onopen = () => {
      stopPolling();
      setLiveStatus("live", "التحديث الحي: متصل");
    };
    reportsEventSource.addEventListener("reports", (event) => {
      try {
        applyReportsPayload(JSON.parse(event.data), "api-live");
        setLiveStatus("live", "التحديث الحي: متصل");
      } catch (error) {
        console.warn(error);
      }
    });
    reportsEventSource.onerror = () => {
      setLiveStatus("polling", "التحديث الحي: احتياطي كل 10 ثواني");
      reportsEventSource?.close?.();
      reportsEventSource = null;
      loadReports({ showSkeleton: !reportsPayload, quiet: true }).catch((error) => console.warn(error));
      startPolling();
    };
  } catch (error) {
    console.warn(error);
    loadReports({ showSkeleton: !reportsPayload, quiet: true }).catch((loadError) => console.warn(loadError));
    startPolling();
  }
}

function refreshFilteredReports({ immediate = false } = {}) {
  if (reportFilterTimer) {
    clearTimeout(reportFilterTimer);
    reportFilterTimer = null;
  }
  const run = () => {
    reportsLastRevision = "";
    reportsEventSource?.close?.();
    reportsEventSource = null;
    stopPolling();
    loadReports({ showSkeleton: true, source: "manual" }).catch((error) => console.warn(error));
    startLiveReports();
  };
  if (immediate) {
    run();
  } else {
    reportFilterTimer = setTimeout(run, 350);
  }
}

async function loadReportNetworkLink() {
  if (!reportsEls.localLink) return;
  try {
    const response = window.ToxApi?.fetch ? await window.ToxApi.fetch("/system/network/", {
      headers: authHeaders()
    }) : await fetch(reportsNetworkApiUrl, {
      credentials: "include",
      headers: { Accept: "application/json", ...authHeaders() }
    });
    if (!response.ok) throw new Error(`Network API ${response.status}`);
    const payload = await response.json();
    if (payload.localUrl) {
      reportsEls.localLink.innerHTML = `<a href="${esc(payload.localUrl)}" target="_blank" rel="noreferrer">التشغيل: ${esc(payload.localUrl.replace(/^https?:\/\//, ""))}</a>`;
      reportsEls.localLink.dataset.ready = "true";
    } else {
      reportsEls.localLink.textContent = payload.messageAr || "التشغيل: محلي فقط";
      reportsEls.localLink.dataset.ready = "false";
    }
  } catch (error) {
    reportsEls.localLink.textContent = "التشغيل: يحتاج تسجيل دخول";
    reportsEls.localLink.dataset.ready = "false";
  }
}

reportsEls.tabs.forEach((button) => {
  button.addEventListener("click", () => {
    activeReport = button.dataset.reportTab;
    if (reportsPayload) {
      renderSection(reportsPayload);
      renderBars(reportsEls.monthlySales, reportsPayload.charts?.monthlySales || [], reportsPayload);
      renderPriorityActions(reportsPayload);
    }
  });
});

reportsEls.detailToggles.forEach((button) => {
  button.addEventListener("click", () => toggleReportDetails(button.dataset.reportToggleDetails));
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const detailButton = target?.closest("[data-report-detail]");
  if (detailButton) {
    event.preventDefault();
    openReportDetail(detailButton.dataset.reportDetail);
    return;
  }
  const repairButton = target?.closest("[data-report-repair-costs]");
  if (repairButton) {
    event.preventDefault();
    repairMissingInvoiceCosts(repairButton);
    return;
  }
  const exportButton = target?.closest("[data-report-export]");
  if (exportButton) {
    event.preventDefault();
    exportReport(exportButton.dataset.reportExport || "excel");
  }
});

reportsEls.drawerClose.forEach((button) => {
  button.addEventListener("click", closeReportDetail);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ((reportsEls.drawer && !reportsEls.drawer.hidden) || (reportsEls.detailPage && !reportsEls.detailPage.hidden))) {
    closeReportDetail();
  }
});

reportsEls.detailPageBack?.addEventListener("click", closeReportDetail);
reportsEls.detailPageSearch?.addEventListener("input", filterDetailPageRows);
reportsEls.detailPageExportButtons.forEach((button) => {
  button.addEventListener("click", () => exportReport(button.dataset.reportPageExport || "excel"));
});

reportsEls.periodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activePeriod = safeReportPeriod(button.dataset.reportPeriod);
    updateReportPeriodControls();
    refreshFilteredReports({ immediate: true });
  });
});

reportsEls.saleKindButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeSaleKind = safeSaleKind(button.dataset.reportFilterSaleKind || button.value);
    updateReportPeriodControls();
    refreshFilteredReports({ immediate: true });
  });
});

reportsEls.costSourceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeCostSource = safeCostSource(button.dataset.reportFilterCostSource || button.value);
    updateReportPeriodControls();
    refreshFilteredReports({ immediate: true });
  });
});

[reportsEls.startDate, reportsEls.endDate].filter(Boolean).forEach((input) => {
  input.addEventListener("change", () => {
    activePeriod = "custom";
    updateReportPeriodControls();
    refreshFilteredReports({ immediate: true });
  });
});

function applyHeavyReportFilters() {
  if (reportsEls.search) reportsEls.search.value = reportsEls.search.value.trim();
  refreshFilteredReports({ immediate: true });
}

[reportsEls.marginMin, reportsEls.marginMax].filter(Boolean).forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyHeavyReportFilters();
  });
});

reportsEls.search?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyHeavyReportFilters();
});

reportsEls.filterApply?.addEventListener("click", applyHeavyReportFilters);

reportsEls.filterClear?.addEventListener("click", () => {
  activePeriod = "today";
  activeSaleKind = "all";
  activeCostSource = "all";
  if (reportsEls.startDate) reportsEls.startDate.value = "";
  if (reportsEls.endDate) reportsEls.endDate.value = todayKey();
  if (reportsEls.search) reportsEls.search.value = "";
  if (reportsEls.marginMin) reportsEls.marginMin.value = "";
  if (reportsEls.marginMax) reportsEls.marginMax.value = "";
  updateReportPeriodControls();
  refreshFilteredReports({ immediate: true });
});

reportsEls.refresh?.addEventListener("click", () => {
  loadReports({ showSkeleton: false, source: "manual" }).catch((error) => {
    console.warn(error);
    if (window.showNotice) showNotice("تعذر تحديث التقارير", "error");
  });
});

function showFatalReportError(error) {
  console.warn(error);
  if (reportsEls.kpis) {
    reportsEls.kpis.innerHTML = `
      <article class="erp-kpi-card-2026 report-error-card" data-tone="debt">
        <div class="erp-kpi-top-2026"><span>تعذر تحميل التقارير</span><small>API</small></div>
        <strong>تحقق من تسجيل الدخول</strong>
        <em>الواجهة جاهزة، لكن مصدر البيانات لم يستجب.</em>
        <i><b style="width:100%"></b></i>
      </article>
    `;
  }
  if (reportsEls.dataSource) reportsEls.dataSource.textContent = "مصدر البيانات: غير متاح";
  if (reportsEls.insights) {
    reportsEls.insights.innerHTML = compactEmpty("تعذر قراءة الرؤى الآن. أعد المحاولة بعد تشغيل الخادم أو تسجيل الدخول.");
  }
  if (reportsEls.priorityActions) {
    reportsEls.priorityActions.innerHTML = compactEmpty("لا يمكن بناء أولويات بدون مصدر بيانات.");
  }
}

initReportPeriod();
updateReportPeriodControls();
loadReportNetworkLink().catch((error) => console.warn(error));
startLiveReports();
window.ToxStore?.subscribe?.(() => {
  if (reportsPayload) renderReports(reportsPayload);
});

window.addEventListener("beforeunload", () => {
  reportsEventSource?.close?.();
  stopPolling();
});
