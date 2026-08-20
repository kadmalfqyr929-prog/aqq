/* ═══════════════════════════════════════════════════════
   TOX 2026 — Installment Dashboard (Full Module)
   All balances derived from backend ledger data ONLY.
   NO frontend financial calculations — display only.
   ═══════════════════════════════════════════════════════ */

let activeInstFilter = "all";
let activeInstPlanId = "";
let installmentProfitDefaultsApplied = false;
let selectedInstallmentProducts = [];

/* ── DOM References ── */
const installmentClient = document.querySelector("[data-installment-client]");
const installmentClientBtn = document.querySelector("[data-inst-client-btn]");
const installmentWarehouse = document.querySelector("[data-installment-warehouse]");
const installmentAddProductBtn = document.querySelector("[data-inst-add-product-btn]");
const installmentProductsTable = document.querySelector("[data-installment-products-table]");
const installmentDownPayment = document.querySelector("[data-installment-down-payment]");
const installmentProfitModes = [...document.querySelectorAll("[data-installment-profit-mode]")];
const installmentProfitPercent = document.querySelector("[data-installment-profit-percent]");
const installmentProfitFixed = document.querySelector("[data-installment-profit-fixed]");
const installmentProfitMin = document.querySelector("[data-installment-profit-min]");
const installmentProfitMax = document.querySelector("[data-installment-profit-max]");
const installmentProfitPercentWrap = document.querySelector("[data-installment-profit-percent-wrap]");
const installmentProfitFixedWrap = document.querySelector("[data-installment-profit-fixed-wrap]");
const installmentProfitPermission = document.querySelector("[data-installment-profit-permission]");
const installmentCashPrice = document.querySelector("[data-installment-cash-price]");
const installmentProfitValue = document.querySelector("[data-installment-profit-value]");
const installmentFinalPrice = document.querySelector("[data-installment-final-price]");
const installmentCountPreview = document.querySelector("[data-installment-count-preview]");
const installmentEachPayment = document.querySelector("[data-installment-each-payment]");
const installmentRemaining = document.querySelector("[data-installment-remaining]");
const installmentCount = document.querySelector("[data-installment-count]");
const installmentCycle = document.querySelector("[data-installment-cycle]");
const installmentTotal = document.querySelector("[data-installment-total]");
const installmentMeta = document.querySelector("[data-installment-meta]");
const installmentSchedule = document.querySelector("[data-installment-schedule]");
const installmentForm = document.querySelector("[data-installment-form]");
const installmentSubmit = document.querySelector("[data-installment-submit]");
const instSummaryEl = document.querySelector("[data-inst-summary]");
const instFiltersEl = document.querySelector("[data-inst-filters]");
const instDashboardEl = document.querySelector("[data-inst-dashboard]");
const installmentCreatePanel = document.querySelector("[data-installment-create-panel]");
const openInstallmentCreate = document.querySelector("[data-open-installment-create]");
const closeInstallmentCreate = document.querySelector("[data-close-installment-create]");

/* ── Helpers ── */
function escH(v) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function money(v, state) { return ToxStore.formatMoney(Number(v || 0), state.currency); }
function roundUsd(value) { return Number(Number(value || 0).toFixed(4)); }
function roundMoneyUsd(value, state = ToxStore.getState()) {
  return ToxStore.moneyToUsd(ToxStore.convertUsd(Number(value || 0), state.currency), state.currency);
}
function fmtDate(v, state) {
  if (!v) return "-";
  const d = new Date(v);
  return isNaN(d.getTime()) ? escH(v) : d.toLocaleDateString(state.lang === "ar" ? "ar-IQ" : "en-US");
}

function localSessionUser() {
  try {
    return JSON.parse(sessionStorage.getItem("tox-session-user") || "null");
  } catch (error) {
    return null;
  }
}

function profitSettings(state) {
  const source = state.installmentProfitSettings || {};
  return {
    defaultMode: source.defaultMode === "fixed" ? "fixed" : "percent",
    defaultPercent: Math.max(0, Number(source.defaultPercent || 0)),
    defaultFixedAmountUsd: Math.max(0, Number(source.defaultFixedAmountUsd || 0)),
    minProfitAmountUsd: Math.max(0, Number(source.minProfitAmountUsd || 0)),
    maxProfitAmountUsd: Math.max(0, Number(source.maxProfitAmountUsd || 0)),
    allowEmployeeProfitEdit: source.allowEmployeeProfitEdit !== false
  };
}

function canEditInstallmentProfit(state) {
  const settings = profitSettings(state);
  const user = localSessionUser();
  if (!user) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (user.isSuperuser || user.role === "admin" || permissions.includes("admin.settings")) return true;
  if (!settings.allowEmployeeProfitEdit) return false;
  return permissions.includes("sales.edit_installment_profit");
}

function setMoneyInput(input, amountUsd, state) {
  if (!input) return;
  const amount = ToxStore.convertUsd(Number(amountUsd || 0), state.currency);
  input.value = String(amount);
}

function selectedProfitMode() {
  return installmentProfitModes.find((input) => input.checked)?.value === "fixed" ? "fixed" : "percent";
}

function setSelectedProfitMode(mode) {
  const safeMode = mode === "fixed" ? "fixed" : "percent";
  installmentProfitModes.forEach((input) => {
    input.checked = input.value === safeMode;
  });
}

function syncProfitModeVisibility() {
  const fixed = selectedProfitMode() === "fixed";
  installmentProfitPercentWrap?.classList.toggle("hidden", fixed);
  installmentProfitFixedWrap?.classList.toggle("hidden", !fixed);
}

function applyInstallmentProfitDefaults(state, force = false) {
  if (!force && installmentProfitDefaultsApplied) {
    syncProfitModeVisibility();
    return;
  }
  const settings = profitSettings(state);
  setSelectedProfitMode(settings.defaultMode);
  if (installmentProfitPercent) installmentProfitPercent.value = String(settings.defaultPercent || 0);
  setMoneyInput(installmentProfitFixed, settings.defaultFixedAmountUsd, state);
  setMoneyInput(installmentProfitMin, settings.minProfitAmountUsd, state);
  setMoneyInput(installmentProfitMax, settings.maxProfitAmountUsd, state);
  installmentProfitDefaultsApplied = true;
  syncProfitModeVisibility();
}

function syncProfitPermission(state) {
  const editable = canEditInstallmentProfit(state);
  [
    ...installmentProfitModes,
    installmentProfitPercent,
    installmentProfitFixed,
    installmentProfitMin,
    installmentProfitMax
  ].filter(Boolean).forEach((input) => {
    input.disabled = !editable;
  });
  installmentProfitPermission?.classList.toggle("hidden", editable);
}

function readProfitDraft(state) {
  const settings = profitSettings(state);
  const editable = canEditInstallmentProfit(state);
  const mode = editable ? selectedProfitMode() : settings.defaultMode;
  const percent = editable ? Math.max(0, Number(installmentProfitPercent?.value || 0)) : settings.defaultPercent;
  const fixedAmountUsd = editable
    ? Math.max(0, ToxStore.moneyToUsd(installmentProfitFixed?.value || 0, state.currency))
    : settings.defaultFixedAmountUsd;
  const minAmountUsd = editable
    ? Math.max(0, ToxStore.moneyToUsd(installmentProfitMin?.value || 0, state.currency))
    : settings.minProfitAmountUsd;
  const maxAmountUsd = editable
    ? Math.max(0, ToxStore.moneyToUsd(installmentProfitMax?.value || 0, state.currency))
    : settings.maxProfitAmountUsd;
  const source = (
    mode === settings.defaultMode
    && Math.abs(percent - settings.defaultPercent) < 0.0001
    && Math.abs(fixedAmountUsd - settings.defaultFixedAmountUsd) < 0.0001
    && Math.abs(minAmountUsd - settings.minProfitAmountUsd) < 0.0001
    && Math.abs(maxAmountUsd - settings.maxProfitAmountUsd) < 0.0001
  ) ? "default_settings" : "manual";
  return { mode, percent, fixedAmountUsd, minAmountUsd, maxAmountUsd, source };
}

function calculateInstallmentProfit(cashPriceUsd, state) {
  const draft = readProfitDraft(state);
  let baseProfitUsd = draft.mode === "fixed"
    ? draft.fixedAmountUsd
    : (Math.max(0, cashPriceUsd) * draft.percent / 100);
  if (draft.minAmountUsd > 0) baseProfitUsd = Math.max(baseProfitUsd, draft.minAmountUsd);
  if (draft.maxAmountUsd > 0) baseProfitUsd = Math.min(baseProfitUsd, draft.maxAmountUsd);
  const profitUsd = roundMoneyUsd(Math.max(0, baseProfitUsd), state);
  const finalPriceUsd = roundMoneyUsd(Math.max(0, cashPriceUsd) + profitUsd, state);
  return {
    ...draft,
    cashPriceUsd: roundMoneyUsd(cashPriceUsd, state),
    profitUsd,
    finalPriceUsd,
    calculatedAt: new Date().toISOString()
  };
}

function profitProblemForSnapshot(snap) {
  if (snap.profit.maxAmountUsd > 0 && snap.profit.maxAmountUsd + 0.0001 < snap.profit.minAmountUsd) {
    return "الحد الأعلى للربح يجب أن يكون أكبر من الحد الأدنى";
  }
  return "";
}

function cleanText(v) {
  return String((ToxStore.repairText ? ToxStore.repairText(v) : v) ?? "").trim();
}

function productForInstallmentItem(item, state) {
  return state.products.find((product) => product.id === item.productId) || null;
}

const unknownProductLabel = "\u0645\u0646\u062a\u062c \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641";

function looksLikeProductId(value, item = {}) {
  const text = cleanText(value);
  if (!text) return false;
  return text === cleanText(item.productId || "") || /^p-\d+/i.test(text);
}

function productNameForInstallmentItem(item, state) {
  const product = productForInstallmentItem(item, state);
  const candidates = [
    item.productName,
    item.name,
    product?.name
  ].map(cleanText).filter((value) => value && !looksLikeProductId(value, item));
  return candidates[0] || unknownProductLabel;
}

function productMetaForInstallmentItem(item, state) {
  const product = productForInstallmentItem(item, state);
  const parts = [
    cleanText(item.unitName || ""),
    cleanText(item.productBrand || item.brand || product?.brand || ""),
  ].filter((value) => value && !looksLikeProductId(value, item));
  return [...new Set(parts)].join(" / ");
}

function invoiceProductName(invoice, state) {
  const names = (invoice.items || []).map((item) => productNameForInstallmentItem(item, state)).filter(Boolean);
  return [...new Set(names)].join(" + ") || invoice.id;
}

function nextInstallment(invoice) {
  return getScheduleItems(invoice)
    .filter((item) => !isItemPaid(item))
    .sort((left, right) => new Date(left.dueDate || 0) - new Date(right.dueDate || 0))[0] || null;
}

/* ── Installment Data Extraction (from ToxStore state) ── */
function getInstallmentInvoices(state) {
  return state.invoices
    .filter(inv => inv.installmentPlan?.type === "installment")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getScheduleItems(invoice) {
  return invoice.installmentPlan?.schedule || [];
}

function isItemPaid(item) {
  return item.status === "paid" || Number(item.paidUsd || 0) >= Number(item.amountUsd || 0) - 0.0001;
}

function isItemOverdue(item) {
  if (isItemPaid(item) || !item.dueDate) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(item.dueDate) < today;
}

function planStatus(invoice) {
  const schedule = getScheduleItems(invoice);
  if (!schedule.length) return "active";
  if (schedule.every(isItemPaid)) return "completed";
  if (schedule.some(isItemOverdue)) return "overdue";
  return "active";
}

function planPaidCount(invoice) {
  return getScheduleItems(invoice).filter(isItemPaid).length;
}

function planProgress(invoice) {
  const schedule = getScheduleItems(invoice);
  if (!schedule.length) return 0;
  return planPaidCount(invoice) / schedule.length;
}

/* ── Summary Cards ── */
function renderSummaryCards(invoices, state) {
  const total = invoices.length;
  const active = invoices.filter(inv => planStatus(inv) === "active").length;
  const completed = invoices.filter(inv => planStatus(inv) === "completed").length;
  const overdue = invoices.filter(inv => planStatus(inv) === "overdue").length;

  let totalDebt = 0;
  let totalPaid = 0;
  invoices.forEach(inv => {
    totalDebt += Number(ToxStore.invoiceDebt(inv) || 0);
    totalPaid += Number(inv.installmentPlan?.downPaymentUsd || 0);
    getScheduleItems(inv).forEach(item => { totalPaid += Number(item.paidUsd || 0); });
  });

  instSummaryEl.innerHTML = `
    <div class="dash-card card-blue">
      <span class="dash-card-title">إجمالي الخطط</span>
      <span class="dash-card-value text-blue">${total}</span>
      <span class="dash-card-sub">كل فواتير الأقساط</span>
    </div>
    <div class="dash-card card-orange">
      <span class="dash-card-title">نشطة</span>
      <span class="dash-card-value text-orange">${active}</span>
      <span class="dash-card-sub">قيد التسديد</span>
    </div>
    <div class="dash-card card-green">
      <span class="dash-card-title">مكتملة</span>
      <span class="dash-card-value text-green">${completed}</span>
      <span class="dash-card-sub">مسددة بالكامل</span>
    </div>
    <div class="dash-card card-red">
      <span class="dash-card-title">متأخرة</span>
      <span class="dash-card-value text-red">${overdue}</span>
      <span class="dash-card-sub">تحتاج متابعة</span>
    </div>
  `;
}

/* ── Filter Pills ── */
function renderFilterPills() {
  const filters = [
    { key: "all", label: "الكل", cls: "" },
    { key: "active", label: "نشطة", cls: "pill-orange" },
    { key: "completed", label: "مكتملة", cls: "pill-green" },
    { key: "overdue", label: "متأخرة", cls: "pill-red" },
  ];
  instFiltersEl.innerHTML = filters.map(f =>
    `<button class="dash-pill ${f.cls} ${activeInstFilter === f.key ? 'active' : ''}" type="button" data-inst-filter="${f.key}">${f.label}</button>`
  ).join("");

  instFiltersEl.querySelectorAll("[data-inst-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeInstFilter = btn.dataset.instFilter;
      renderInstDashboard(ToxStore.getState());
    });
  });
}

/* ── Installment Plan List ── */
function filterInvoices(invoices) {
  if (activeInstFilter === "all") return invoices;
  return invoices.filter(inv => planStatus(inv) === activeInstFilter);
}

function statusBadge(status) {
  const map = {
    active: '<span class="profile-badge status-orange">نشطة</span>',
    completed: '<span class="profile-badge status-green">مكتملة</span>',
    overdue: '<span class="profile-badge status-red">متأخرة</span>',
  };
  return map[status] || map.active;
}

function renderPlanList(invoices, state) {
  const filtered = filterInvoices(invoices);
  if (!filtered.length) {
    return `<div class="dash-empty"><span class="dash-empty-icon">📭</span><span>لا توجد خطط أقساط مطابقة</span></div>`;
  }

  return filtered.map(inv => {
    const status = planStatus(inv);
    const progress = planProgress(inv);
    const paidCount = planPaidCount(inv);
    const totalCount = getScheduleItems(inv).length;
    const client = state.clients.find(c => c.id === inv.clientId);

    return `
      <div class="inst-plan-card ${inv.id === activeInstPlanId ? 'active' : ''}" data-open-plan="${inv.id}">
        <div class="inst-plan-header">
          <strong>${escH(invoiceProductName(inv, state))}</strong>
          ${statusBadge(status)}
        </div>
        <div class="inst-plan-meta">
          <span>${escH(client?.name || inv.customerName || "-")}</span>
          <span>💰 ${money(ToxStore.invoiceNet(inv), state)}</span>
          <span>${fmtDate(inv.createdAt, state)}</span>
          <span>${paidCount}/${totalCount} دفعات</span>
          <span>${escH(inv.id)}</span>
        </div>
        <div class="inst-progress-bar">
          <div class="inst-progress-fill" style="width: ${(progress * 100).toFixed(1)}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

/* ── Schedule Detail View ── */
function renderScheduleDetail(invoice, state) {
  if (!invoice) return `<div class="dash-empty"><span class="dash-empty-icon">📋</span><span>اختر خطة لعرض الجدول</span></div>`;

  const schedule = getScheduleItems(invoice);
  const status = planStatus(invoice);
  const client = state.clients.find(c => c.id === invoice.clientId);
  const totalAmount = Number(ToxStore.invoiceNet(invoice) || 0);
  const paidAmount = totalAmount - Number(ToxStore.invoiceDebt(invoice) || 0);
  const next = nextInstallment(invoice);

  return `
    <div class="dash-view-content">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h3 style="margin: 0;">${escH(invoiceProductName(invoice, state))}</h3>
          <p style="color: var(--muted); margin: 4px 0 0;">العميل: ${escH(client?.name || "-")} | ${escH(invoice.id)} | ${fmtDate(invoice.createdAt, state)}</p>
        </div>
        ${statusBadge(status)}
      </div>
      <div class="drawer-actions" style="margin-bottom:16px;">
        <a class="button ghost compact-action" href="clients.html#client=${encodeURIComponent(invoice.clientId || "")}">عرض حساب العميل</a>
        <button class="button ghost compact-action" type="button" data-view-inst-invoice="${escH(invoice.id)}">عرض الفاتورة</button>
      </div>

      <div class="dash-stats-row">
        <div class="dash-stat bg-blue">
          <span>الإجمالي</span>
          <strong class="text-blue">${money(totalAmount, state)}</strong>
        </div>
        <div class="dash-stat bg-green">
          <span>المدفوع</span>
          <strong class="text-green">${money(paidAmount, state)}</strong>
        </div>
        <div class="dash-stat bg-red">
          <span>المتبقي</span>
          <strong class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</strong>
        </div>
        <div class="dash-stat bg-orange">
          <span>القسط القادم</span>
          <strong class="text-orange">${next ? money(Number(next.amountUsd || 0) - Number(next.paidUsd || 0), state) : "مكتمل"}</strong>
        </div>
      </div>

      <div class="inst-progress-bar" style="margin-bottom: 20px; height: 8px;">
        <div class="inst-progress-fill" style="width: ${(planProgress(invoice) * 100).toFixed(1)}%"></div>
      </div>

      <h4 style="margin: 0 0 12px;">دفعات المنتج</h4>
      <div class="inst-schedule-grid">
        ${schedule.map(item => {
          const paid = isItemPaid(item);
          const overdue = isItemOverdue(item);
          const cls = paid ? "is-paid" : overdue ? "is-overdue" : "is-pending";
          const statusLabel = paid ? "مدفوع" : overdue ? "متأخر" : "قيد الانتظار";
          return `
            <div class="inst-schedule-item ${cls}">
              <div class="inst-number">${item.number}</div>
              <div class="inst-info">
                <strong>دفعة ${item.number} من ${schedule.length}</strong>
                <small>الاستحقاق: ${fmtDate(item.dueDate, state)}</small>
              </div>
              <div class="inst-amount">${money(item.amountUsd, state)}<br><small>${statusLabel}</small></div>
              <div>
                ${paid
                  ? `<span class="text-green" style="font-size: 0.82rem;">مدفوع ${fmtDate(item.paidAt, state)}</span>`
                  : `<button class="button primary" type="button" data-pay-inst="${invoice.id}" data-inst-num="${item.number}" style="padding: 6px 14px; min-height: unset; font-size: 0.82rem;">تسديد</button>`
                }
              </div>
            </div>
          `;
        }).join("") || `<div class="dash-empty">لا توجد أقساط مجدولة</div>`}
      </div>
    </div>
  `;
}

/* ── Main Dashboard Render ── */
function renderInstDashboard(state) {
  const invoices = getInstallmentInvoices(state);

  renderSummaryCards(invoices, state);
  renderFilterPills();

  if (!activeInstPlanId || !invoices.find(inv => inv.id === activeInstPlanId)) {
    const filtered = filterInvoices(invoices);
    activeInstPlanId = filtered[0]?.id || "";
  }

  const selectedInvoice = invoices.find(inv => inv.id === activeInstPlanId);

  instDashboardEl.innerHTML = `
    <div style="display: grid; grid-template-columns: 340px 1fr; gap: 20px; min-height: 400px;">
      <div style="display: flex; flex-direction: column; gap: 10px; max-height: 600px; overflow-y: auto;">
        ${renderPlanList(invoices, state)}
      </div>
      <div>
        ${renderScheduleDetail(selectedInvoice, state)}
      </div>
    </div>
  `;

  // Bind plan card clicks
  instDashboardEl.querySelectorAll("[data-open-plan]").forEach(card => {
    card.addEventListener("click", () => {
      activeInstPlanId = card.dataset.openPlan;
      renderInstDashboard(ToxStore.getState());
    });
  });

  // Bind pay buttons
  instDashboardEl.querySelectorAll("[data-pay-inst]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const invoiceId = btn.dataset.payInst;
      const num = Number(btn.dataset.instNum);
      const inv = state.invoices.find(i => i.id === invoiceId);
      const item = getScheduleItems(inv).find(i => Number(i.number) === num);
      if (!inv || !item || isItemPaid(item)) return;
      const remaining = Number(item.amountUsd || 0) - Number(item.paidUsd || 0);
      openInstallmentPaymentModal({
        invoiceId,
        installmentNumber: num,
        amountUsd: remaining,
        title: `تسديد قسط ${num} - ${invoiceId}`
      });
    });
  });

  instDashboardEl.querySelectorAll("[data-view-inst-invoice]").forEach((button) => {
    button.addEventListener("click", () => openInstallmentInvoiceModal(button.dataset.viewInstInvoice));
  });
}

function openInstallmentPaymentModal({ invoiceId, installmentNumber, amountUsd, title }) {
  const state = ToxStore.getState();
  const invoice = state.invoices.find((entry) => entry.id === invoiceId);
  const client = state.clients.find((entry) => entry.id === invoice?.clientId);
  document.querySelector("[data-inst-modal-root]")?.remove();
  const root = document.createElement("div");
  root.dataset.instModalRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-inst-modal></div>
    <form class="client-pay-modal client-payment-modal-pro" data-inst-pay-modal>
      <header>
        <div><span>تسديد قسط</span><h2>${escH(title)}</h2></div>
        <button class="button ghost compact-action" type="button" data-close-inst-modal>إغلاق</button>
      </header>
      <section class="client-modal-summary">
        <div><span>العميل</span><strong>${escH(client?.name || "-")}</strong></div>
        <div><span>المنتج</span><strong>${escH(invoice ? invoiceProductName(invoice, state) : "-")}</strong></div>
        <div><span>رقم الدفعة</span><strong>${installmentNumber}</strong></div>
      </section>
      <label><span>مبلغ الدفع</span><input type="number" min="1" step="1" name="amount" value="${ToxStore.convertUsd(amountUsd, state.currency)}" required /></label>
      <div class="client-modal-grid">
        <label><span>العملة</span><select name="currency"><option value="IQD" ${state.currency === "IQD" ? "selected" : ""}>IQD</option><option value="USD" ${state.currency === "USD" ? "selected" : ""}>USD</option></select></label>
        <label><span>تاريخ الدفع</span><input type="date" name="receivedAt" value="${new Date().toISOString().slice(0, 10)}" /></label>
      </div>
      <label><span>ملاحظات</span><input name="note" value="دفع قسط ${installmentNumber}" /></label>
      <button class="button primary" type="submit">تأكيد الدفع</button>
    </form>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-inst-modal]").forEach((item) => item.addEventListener("click", () => root.remove()));
  root.querySelector("[data-inst-pay-modal]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = ToxStore.payClientInstallment({
        invoiceId,
      installmentNumber,
      amount: form.amount.value,
      currency: form.currency.value,
      note: form.note.value,
      receivedAt: form.receivedAt.value
    });
    if (!result?.ok) {
      showNotice(result?.reason === "INSTALLMENT_ALREADY_PAID" ? "القسط مدفوع مسبقا" : "تعذر تسجيل الدفع", "error");
      return;
    }
    root.remove();
    showNotice("تم تسجيل الدفع وتحديث حساب العميل", "success");
  });
}

function openInstallmentInvoiceModal(invoiceId) {
  const state = ToxStore.getState();
  const invoice = state.invoices.find((entry) => entry.id === invoiceId);
  if (!invoice) return;
  document.querySelector("[data-inst-invoice-root]")?.remove();
  const root = document.createElement("div");
  root.dataset.instInvoiceRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-inst-invoice></div>
    <section class="client-invoice-modal" role="dialog" aria-modal="true">
      <header>
        <div><span>فاتورة أقساط</span><h2>${escH(invoice.id)}</h2></div>
        <button class="button ghost compact-action" type="button" data-close-inst-invoice>إغلاق</button>
      </header>
      <section class="drawer-summary">
        <div><span>الإجمالي</span><strong>${money(ToxStore.invoiceNet(invoice), state)}</strong></div>
        <div><span>المدفوع</span><strong class="text-green">${money(invoice.paidUsd, state)}</strong></div>
        <div><span>المتبقي</span><strong class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
        <div><span>الأقساط</span><strong>${getScheduleItems(invoice).length}</strong></div>
      </section>
      <div class="client-table-wrap">
        <table class="client-fast-table compact">
          <thead><tr><th>المنتج</th><th>الكمية</th><th>الوحدة</th><th>السعر</th><th>الإجمالي</th></tr></thead>
          <tbody>${(invoice.items || []).map((item) => {
            const meta = productMetaForInstallmentItem(item, state);
            return `<tr><td class="invoice-product-name"><strong>${escH(productNameForInstallmentItem(item, state))}</strong>${meta ? `<small>${escH(meta)}</small>` : ""}</td><td>${escH(item.qty || 0)}</td><td>${escH(item.unitName || "-")}</td><td>${money(item.priceUsd, state)}</td><td>${money(item.totalUsd, state)}</td></tr>`;
          }).join("") || `<tr><td colspan="5">لا توجد منتجات</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-inst-invoice]").forEach((item) => item.addEventListener("click", () => root.remove()));
}

/* ── Installment Creator (form logic) ── */

function hydrateInstallments(state) {
  // Always render the dashboard (no early return)
  if (installmentWarehouse) {
    const selWarehouse = installmentWarehouse.value;
    installmentWarehouse.innerHTML = (state.warehouses || []).map(function(w) {
      return '<option value="' + escH(w.id) + '">' + escH(w.name) + '</option>';
    }).join("");
    if ((state.warehouses || []).some(function(w) { return w.id === selWarehouse; })) {
      installmentWarehouse.value = selWarehouse;
    }
  }
  
  if (installmentProductsTable) {
    if (selectedInstallmentProducts.length === 0) {
      installmentProductsTable.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--tox-muted);">\u0644\u0645 \u064a\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0645\u0646\u062a\u062c\u0627\u062a</td></tr>';
    } else {
      installmentProductsTable.innerHTML = selectedInstallmentProducts.map(function(item, index) {
        var total = item.qty * item.priceUsd;
        return '<tr>' +
          '<td class="invoice-product-name"><strong>' + escH(item.product.name) + '</strong></td>' +
          '<td>' + escH(ToxStore.getWarehouseName(item.warehouseId)) + '</td>' +
          '<td><input type="number" min="0.01" step="0.01" value="' + item.qty + '" style="width: 80px;" onchange="updateInstItemQty(' + index + ', this.value)" /></td>' +
          '<td>' + escH(localizedUnitName(item.unit, state.lang)) + '</td>' +
          '<td><input type="number" min="0" step="0.01" value="' + ToxStore.convertUsd(item.priceUsd, state.currency) + '" style="width: 100px;" onchange="updateInstItemPrice(' + index + ', this.value, \'' + state.currency + '\')" /></td>' +
          '<td>' + money(total, state) + '</td>' +
          '<td><button type="button" class="button ghost compact-action" onclick="removeInstItem(' + index + ')" style="color: var(--tox-red);">\u062d\u0630\u0641</button></td>' +
          '</tr>';
      }).join("");
    }
  }

  if (installmentTotal) renderPreview(state);
  renderInstDashboard(state);
}

window.updateInstItemQty = function(index, qty) {
  if (selectedInstallmentProducts[index]) {
    selectedInstallmentProducts[index].qty = Math.max(0.01, Number(qty) || 0.01);
    hydrateInstallments(ToxStore.getState());
  }
};
window.updateInstItemPrice = function(index, price, currency) {
  if (selectedInstallmentProducts[index]) {
    selectedInstallmentProducts[index].priceUsd = ToxStore.moneyToUsd(price, currency);
    hydrateInstallments(ToxStore.getState());
  }
};
window.removeInstItem = function(index) {
  selectedInstallmentProducts.splice(index, 1);
  hydrateInstallments(ToxStore.getState());
};

function installmentSnapshot(state) {
  applyInstallmentProfitDefaults(state);
  syncProfitPermission(state);
  
  const rawDown = ToxStore.moneyToUsd(installmentDownPayment?.value, state.currency);
  const count = Math.max(1, Number(installmentCount?.value || 1));
  const cycle = installmentCycle?.value || "monthly";
  
  let cashPriceUsd = 0;
  let totalCostUsd = 0;
  
  selectedInstallmentProducts.forEach(item => {
    cashPriceUsd += roundMoneyUsd(item.qty * Number(item.priceUsd || 0), state);
    const qtyInBase = ToxStore.quantityInBase(item.product, item.qty, item.unit.id);
    const storageQty = ToxStore.baseToStorageQuantity(item.product, qtyInBase);
    totalCostUsd += roundMoneyUsd(storageQty * Number(item.product.purchaseCostUsd || 0), state);
  });
  
  const profit = calculateInstallmentProfit(cashPriceUsd, state);
  const totalUsd = profit.finalPriceUsd;
  const grossProfitUsd = totalCostUsd > 0 ? roundMoneyUsd(totalUsd - totalCostUsd, state) : 0;
  const downUsd = Math.max(0, Math.min(totalUsd, rawDown));
  const remainUsd = roundMoneyUsd(Math.max(0, totalUsd - downUsd), state);
  const eachUsd = count ? roundMoneyUsd(remainUsd / count, state) : remainUsd;
  
  return {
    items: selectedInstallmentProducts,
    count,
    cycle,
    cashPriceUsd,
    profitUsd: profit.profitUsd,
    totalUsd,
    totalCostUsd,
    grossProfitUsd,
    downPaymentUsd: roundMoneyUsd(downUsd, state),
    remainingUsd: remainUsd,
    eachUsd,
    profit
  };
}

function stockProblemForSnapshot(snap) {
  if (!installmentClient?.value) return "اختر العميل أولا";
  if (snap.items.length === 0) return "أضف منتج واحد على الأقل";
  if (snap.count <= 0) return "عدد الأقساط يجب أن يكون أكبر من صفر";
  
  for (const item of snap.items) {
    if (item.qty <= 0) return "الكمية للمنتج " + item.product.name + " يجب أن تكون أكبر من صفر";
    const requestedBase = ToxStore.quantityInBase(item.product, item.qty, item.unit.id);
    const availableBase = ToxStore.stockBaseQuantity(item.product, item.warehouseId);
    if (requestedBase > availableBase + 0.0001) {
      const unitName = localizedUnitName(item.unit, ToxStore.getState().lang);
      return "المخزون غير كافي للمنتج " + item.product.name + ": المطلوب " + item.qty + " " + unitName + "، المتوفر في " + ToxStore.getWarehouseName(item.warehouseId) + " هو " + ToxStore.stockSummary(item.product, item.warehouseId);
    }
  }
  return "";
}

function addCycle(date, cycle, step) {
  const n = new Date(date);
  if (cycle === "daily") n.setDate(n.getDate() + step);
  else if (cycle === "weekly") n.setDate(n.getDate() + (step * 7));
  else if (cycle === "yearly") n.setFullYear(n.getFullYear() + step);
  else n.setMonth(n.getMonth() + step);
  return n;
}

function renderPreview(state) {
  if (!installmentTotal) return;
  const snap = installmentSnapshot(state);
  installmentTotal.textContent = money(snap.totalUsd, state);
  if (installmentCashPrice) installmentCashPrice.textContent = money(snap.cashPriceUsd, state);
  if (installmentProfitValue) installmentProfitValue.textContent = money(snap.profitUsd, state);
  if (installmentFinalPrice) installmentFinalPrice.textContent = money(snap.totalUsd, state);
  if (installmentCountPreview) installmentCountPreview.textContent = String(snap.count || 0);
  if (installmentEachPayment) installmentEachPayment.textContent = money(snap.eachUsd, state);
  if (installmentRemaining) installmentRemaining.textContent = money(snap.remainingUsd, state);
  if (snap.items.length === 0) {
    if (installmentMeta) installmentMeta.textContent = "لم يتم إضافة منتجات";
    if (installmentSchedule) installmentSchedule.innerHTML = "";
    if (installmentSubmit) installmentSubmit.disabled = true;
    return;
  }
  if (installmentMeta) {
    const problem = profitProblemForSnapshot(snap) || stockProblemForSnapshot(snap);
    installmentMeta.classList.toggle("danger-text", Boolean(problem));
    const itemTitle = snap.items.length === 1
      ? (snap.items[0].product.name + " | " + snap.items[0].qty + " " + localizedUnitName(snap.items[0].unit, state.lang))
      : (snap.items.length + " منتجات");
    installmentMeta.textContent = problem || (itemTitle + " | دفعة أولى: " + money(snap.downPaymentUsd, state) + " | المتبقي: " + money(snap.remainingUsd, state));
    if (installmentSubmit) installmentSubmit.disabled = Boolean(problem);
  }
  if (installmentSchedule) {
    const first = snap.downPaymentUsd > 0 ? `<div class="ledger-item success"><span>دفعة أولى<br><small>${new Date().toLocaleDateString()}</small></span><strong>${money(snap.downPaymentUsd, state)}</strong></div>` : "";
    installmentSchedule.innerHTML = first + Array.from({ length: snap.count }, (_, i) => {
      const due = addCycle(new Date(), snap.cycle, i + 1);
      return `<div class="ledger-item"><span>قسط ${i + 1}<br><small>${due.toLocaleDateString()}</small></span><strong>${money(snap.eachUsd, state)}</strong></div>`;
    }).join("");
  }
}

function buildInstallmentPlan(snap, state) {
  let runningUsd = 0;
  const schedule = Array.from({ length: snap.count }, (_, i) => {
    const amountUsd = i < snap.count - 1
      ? snap.eachUsd
      : roundMoneyUsd(snap.remainingUsd - runningUsd, state);
    runningUsd = roundMoneyUsd(runningUsd + amountUsd, state);
    return {
      number: i + 1,
      dueDate: addCycle(new Date(), snap.cycle, i + 1).toISOString().slice(0, 10),
      amountUsd,
      paidUsd: 0,
      status: amountUsd <= 0 ? "paid" : "due"
    };
  });
  return {
    type: "installment",
    productId: snap.items.length === 1 ? snap.items[0].product.id : "",
    productName: snap.items.length === 1 ? snap.items[0].product.name : "منتجات متعددة",
    qty: snap.items.length === 1 ? snap.items[0].qty : 1,
    unitName: snap.items.length === 1 ? snap.items[0].unit.name : "",
    count: snap.count,
    cycle: snap.cycle,
    currency: state.currency,
    cashPriceUsd: snap.cashPriceUsd,
    profitUsd: snap.profitUsd,
    finalPriceUsd: snap.totalUsd,
    totalUsd: snap.totalUsd,
    downPaymentUsd: snap.downPaymentUsd,
    remainingUsd: snap.remainingUsd,
    eachUsd: snap.eachUsd,
    profit: {
      mode: snap.profit.mode,
      percent: snap.profit.percent,
      fixedAmountUsd: snap.profit.fixedAmountUsd,
      minAmountUsd: snap.profit.minAmountUsd,
      maxAmountUsd: snap.profit.maxAmountUsd,
      cashPriceUsd: snap.profit.cashPriceUsd,
      profitUsd: snap.profit.profitUsd,
      finalPriceUsd: snap.profit.finalPriceUsd,
      source: snap.profit.source,
      calculatedAt: snap.profit.calculatedAt
    },
    schedule
  };
}

installmentForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const state = ToxStore.getState();
  const snap = installmentSnapshot(state);
  const problem = profitProblemForSnapshot(snap) || stockProblemForSnapshot(snap);
  if (problem) {
    showNotice(problem, "error");
    playUiSound("error");
    return;
  }
  const selectedClient = state.clients.find((entry) => entry.id === installmentClient.value);
  const invoice = ToxStore.createInvoice({
    clientId: installmentClient.value,
    customerName: selectedClient?.name || "",
    title: "فاتورة أقساط",
    paidUsd: 0,
    discountUsd: 0,
    installmentPlan: buildInstallmentPlan(snap, state),
    items: snap.items.map(item => {
      const qtyInBase = ToxStore.quantityInBase(item.product, item.qty, item.unit.id);
      const storageQty = ToxStore.baseToStorageQuantity(item.product, qtyInBase);
      const totalCostUsd = roundMoneyUsd(storageQty * Number(item.product.purchaseCostUsd || 0), state);
      const unitCostUsd = item.qty > 0 ? roundMoneyUsd(totalCostUsd / item.qty, state) : 0;
      
      const itemRatio = snap.cashPriceUsd > 0 ? (item.qty * item.priceUsd) / snap.cashPriceUsd : 0;
      const itemTotalUsd = roundMoneyUsd(snap.totalUsd * itemRatio, state);
      const itemPriceUsd = item.qty > 0 ? roundMoneyUsd(itemTotalUsd / item.qty, state) : 0;
      const itemProfitUsd = roundMoneyUsd(snap.profitUsd * itemRatio, state);
      const itemGrossProfitUsd = roundMoneyUsd(itemTotalUsd - totalCostUsd, state);
      
      return {
        productId: item.product.id,
        warehouseId: item.warehouseId,
        name: item.product.name,
        qty: item.qty,
        qtyInBase,
        unit: item.unit.id,
        unitName: item.unit.name,
        currency: ToxStore.productCurrency(item.product),
        exchangeRate: state.exchangeRate,
        price: ToxStore.convertUsd(itemPriceUsd, ToxStore.productCurrency(item.product)),
        priceCurrency: ToxStore.productCurrency(item.product),
        priceUsd: itemPriceUsd,
        cashPriceUsd: item.priceUsd,
        profitUsd: itemProfitUsd,
        lineDiscountPercent: 0,
        lineDiscountUsd: 0,
        installmentCount: snap.count,
        installmentCycle: snap.cycle,
        unitCostUsd,
        totalCostUsd,
        grossProfitUsd: itemGrossProfitUsd,
        costStatus: totalCostUsd > 0 ? "ok" : "missing_cost",
        costBreakdown: totalCostUsd > 0 ? [{
          source: "estimated_from_product_cost",
          quantity: storageQty,
          unitCostUsd: item.product.purchaseCostUsd,
          costUsd: totalCostUsd,
          reason: "installment_frontend_product_cost",
          productId: item.product.id,
          productName: item.product.name
        }] : [],
        lineTotal: ToxStore.convertUsd(itemTotalUsd, ToxStore.productCurrency(item.product)),
        totalUsd: itemTotalUsd
      };
    })
  });
  if (!invoice) {
    showNotice(stockProblemForSnapshot(snap) || "تعذر حفظ بيع الأقساط", "error");
    playUiSound("error");
    return;
  }
  if (snap.downPaymentUsd > 0) {
    ToxStore.addClientPayment({
      clientId: installmentClient.value,
      amount: ToxStore.convertUsd(snap.downPaymentUsd, state.currency),
      currency: state.currency,
      receivedAt: new Date().toISOString().slice(0, 10),
      note: `دفعة أولى للفاتورة ${invoice.id}`,
      allocationMode: "invoice",
      invoiceId: invoice.id,
      applyToInstallments: false,
      paymentKind: "down_payment"
    });
  }
  showNotice("تم حفظ بيع الأقساط وربطه بحساب العميل", "success");
  playUiSound("success");
  installmentForm.reset();
  installmentProfitDefaultsApplied = false;
  selectedInstallmentProducts = [];
  if (installmentClientBtn) installmentClientBtn.textContent = "اختيار العميل";
  applyInstallmentProfitDefaults(ToxStore.getState(), true);
  installmentCreatePanel?.classList.add("hidden");
  activeInstPlanId = invoice.id;
  hydrateInstallments(ToxStore.getState());
});

/* ── Event Bindings ── */
[installmentWarehouse, installmentDownPayment, installmentCount, installmentCycle, installmentProfitPercent, installmentProfitFixed, installmentProfitMin, installmentProfitMax, ...installmentProfitModes].forEach(el => {
  if (!el) return;
  el.addEventListener("input", () => hydrateInstallments(ToxStore.getState()));
  el.addEventListener("change", () => {
    syncProfitModeVisibility();
    hydrateInstallments(ToxStore.getState());
  });
});

ToxStore.subscribe(hydrateInstallments);
openInstallmentCreate?.addEventListener("click", () => {
  applyInstallmentProfitDefaults(ToxStore.getState(), true);
  installmentCreatePanel?.classList.remove("hidden");
});
closeInstallmentCreate?.addEventListener("click", () => installmentCreatePanel?.classList.add("hidden"));

installmentClientBtn?.addEventListener("click", openInstClientModal);
installmentAddProductBtn?.addEventListener("click", openInstProductModal);

function openInstClientModal() {
  document.querySelector("[data-inst-client-root]")?.remove();
  const root = document.createElement("div");
  root.dataset.instClientRoot = "true";
  const backdrop = document.createElement("div");
  backdrop.className = "client-modal-backdrop";
  backdrop.setAttribute("data-close-inst-client", "");
  const modal = document.createElement("div");
  modal.className = "client-invoice-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.style.maxWidth = "500px";
  modal.innerHTML = [
    '<header>',
    '<div><h2>\u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0639\u0645\u064a\u0644</h2></div>',
    '<button class="button ghost compact-action" type="button" data-close-inst-client>\u0625\u063a\u0644\u0627\u0642</button>',
    '</header>',
    '<div style="padding:16px">',
    '<input type="text" data-inst-client-search placeholder="\u0627\u0644\u0628\u062d\u062b \u0628\u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644 \u0623\u0648 \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641..." style="width:100%;margin-bottom:12px;font-size:1.1rem;padding:10px;background:var(--tox-surface);color:var(--tox-fg);border:1px solid var(--tox-border);border-radius:4px" autofocus />',
    '<div data-inst-client-results style="max-height:400px;overflow-y:auto"></div>',
    '</div>'
  ].join("");
  root.appendChild(backdrop);
  root.appendChild(modal);
  document.body.appendChild(root);
  const searchInput = root.querySelector("[data-inst-client-search]");
  const resultsDiv = root.querySelector("[data-inst-client-results]");
  
  function renderClients(query) {
    query = query || "";
    const state = ToxStore.getState();
    const q = query.toLowerCase().trim();
    let matches = state.clients;
    if (q) {
      matches = matches.filter(function(c) { return (c.name || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q); });
    }
    matches = matches.slice(0, 50);
    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div class="dash-empty">\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c</div>';
      return;
    }
    resultsDiv.innerHTML = matches.map(function(c) {
      return '<div class="client-search-item" style="padding:12px;border-bottom:1px solid var(--tox-border);cursor:pointer;display:flex;justify-content:space-between;align-items:center" data-id="' + escH(c.id) + '"><div><strong>' + escH(c.name) + '</strong><br><small style="color:var(--tox-muted)">' + escH(c.phone || "") + '</small></div><button type="button" class="button ghost compact-action">\u0627\u062e\u062a\u064a\u0627\u0631</button></div>';
    }).join("");
    resultsDiv.querySelectorAll(".client-search-item").forEach(function(el) {
      el.addEventListener("click", function() {
        if (installmentClient) installmentClient.value = el.dataset.id;
        if (installmentClientBtn) installmentClientBtn.textContent = el.querySelector("strong").textContent;
        hydrateInstallments(state);
        root.remove();
      });
    });
  }
  
  renderClients("");
  setTimeout(function() { if (searchInput) searchInput.focus(); }, 50);
  var debounceTimeout;
  searchInput.addEventListener("input", function(e) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(function() { renderClients(e.target.value); }, 200);
  });
  root.querySelectorAll("[data-close-inst-client]").forEach(function(btn) { btn.addEventListener("click", function() { root.remove(); }); });
}

function openInstProductModal() {
  const warehouseId = installmentWarehouse ? installmentWarehouse.value : "";
  if (!warehouseId) {
    showNotice("\u0627\u0644\u0631\u062c\u0627\u0621 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639 \u0623\u0648\u0644\u0627\u064b", "error");
    return;
  }
  document.querySelector("[data-inst-product-root]")?.remove();
  const root = document.createElement("div");
  root.dataset.instProductRoot = "true";
  const backdrop2 = document.createElement("div");
  backdrop2.className = "client-modal-backdrop";
  backdrop2.setAttribute("data-close-inst-prod", "");
  const modal2 = document.createElement("div");
  modal2.className = "client-invoice-modal";
  modal2.setAttribute("role", "dialog");
  modal2.setAttribute("aria-modal", "true");
  modal2.style.maxWidth = "600px";
  modal2.innerHTML = [
    '<header>',
    '<div><h2>\u0625\u0636\u0627\u0641\u0629 \u0645\u0646\u062a\u062c</h2></div>',
    '<button class="button ghost compact-action" type="button" data-close-inst-prod>\u0625\u063a\u0644\u0627\u0642</button>',
    '</header>',
    '<div style="padding:16px">',
    '<input type="text" data-inst-prod-search placeholder="\u0627\u0644\u0628\u062d\u062b \u0628\u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062a\u062c \u0623\u0648 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f..." style="width:100%;margin-bottom:12px;font-size:1.1rem;padding:10px;background:var(--tox-surface);color:var(--tox-fg);border:1px solid var(--tox-border);border-radius:4px" autofocus />',
    '<div data-inst-prod-results style="max-height:400px;overflow-y:auto"></div>',
    '</div>'
  ].join("");
  root.appendChild(backdrop2);
  root.appendChild(modal2);
  document.body.appendChild(root);
  const searchInput2 = root.querySelector("[data-inst-prod-search]");
  const resultsDiv2 = root.querySelector("[data-inst-prod-results]");
  
  function renderProducts(query) {
    query = query || "";
    const state = ToxStore.getState();
    const q = query.toLowerCase().trim();
    var matches = state.products;
    if (q) {
      matches = matches.filter(function(p) {
        return (p.name || "").toLowerCase().includes(q) || (p.barcode || "").toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q);
      });
    }
    matches = matches.slice(0, 50);
    if (matches.length === 0) {
      resultsDiv2.innerHTML = '<div class="dash-empty">\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0646\u062a\u062c\u0627\u062a</div>';
      return;
    }
    resultsDiv2.innerHTML = matches.map(function(p) {
      var unit = p.units && p.units[0] ? p.units[0] : null;
      var price = unit ? unit.priceUsd : 0;
      var stock = ToxStore.stockSummary(p, warehouseId);
      var isAvailable = ToxStore.stockBaseQuantity(p, warehouseId) > 0;
      var availColor = isAvailable ? "var(--tox-green)" : "var(--tox-red)";
      var btnClass = isAvailable ? "button primary compact-action" : "button ghost compact-action";
      var disabledAttr = isAvailable ? "" : "disabled";
      return '<div class="prod-search-item" style="padding:12px;border-bottom:1px solid var(--tox-border);display:flex;justify-content:space-between;align-items:center' + (!isAvailable ? ';opacity:0.6' : '') + '" data-id="' + escH(p.id) + '"><div><strong>' + escH(p.name) + '</strong><br><small style="color:var(--tox-muted)">\u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u062a\u0648\u0641\u0631: <span style="color:' + availColor + '">' + escH(stock) + '</span> | \u0627\u0644\u0633\u0639\u0631: ' + money(price, state) + '</small></div><button type="button" class="' + btnClass + '" ' + disabledAttr + '>\u0625\u0636\u0627\u0641\u0629</button></div>';
    }).join("");
    resultsDiv2.querySelectorAll(".prod-search-item").forEach(function(el) {
      var btn = el.querySelector("button");
      if (btn && btn.disabled) return;
      el.addEventListener("click", function() {
        var pId = el.dataset.id;
        var prod = state.products.find(function(p) { return p.id === pId; });
        if (prod) {
          var existingIndex = selectedInstallmentProducts.findIndex(function(x) { return x.product.id === pId && x.warehouseId === warehouseId; });
          if (existingIndex >= 0) {
            selectedInstallmentProducts[existingIndex].qty += 1;
          } else {
            selectedInstallmentProducts.push({
              product: prod,
              unit: prod.units && prod.units[0] ? prod.units[0] : null,
              qty: 1,
              priceUsd: prod.units && prod.units[0] ? prod.units[0].priceUsd || 0 : 0,
              warehouseId: warehouseId
            });
          }
          hydrateInstallments(state);
          root.remove();
        }
      });
    });
  }
  
  renderProducts("");
  setTimeout(function() { if (searchInput2) searchInput2.focus(); }, 50);
  var debounceTimeout2;
  searchInput2.addEventListener("input", function(e) {
    clearTimeout(debounceTimeout2);
    debounceTimeout2 = setTimeout(function() { renderProducts(e.target.value); }, 200);
  });
  root.querySelectorAll("[data-close-inst-prod]").forEach(function(btn) { btn.addEventListener("click", function() { root.remove(); }); });
}
hydrateInstallments(ToxStore.getState());
