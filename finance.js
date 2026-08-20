const cashVoucherForm = document.querySelector("[data-cash-voucher-form]");
const salaryList = document.querySelector("[data-salary-list]");
const voucherTable = document.querySelector("[data-cash-voucher-table]");
const voucherCount = document.querySelector("[data-cash-voucher-count]");
const financeTabs = document.querySelectorAll("[data-finance-tab]");
let financeServerReport = null;
let financeReportLoading = false;

function financeText(key, state = ToxStore.getState()) {
  return typeof t === "function" ? t(key, state.lang) : key;
}

function financeLocale(state = ToxStore.getState()) {
  return state.lang === "ar" ? "ar-IQ" : "en-US";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function dateKey(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function sameDay(value, date = new Date()) {
  return dateKey(value) === dateKey(date);
}

function setFinanceText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function financeNotice(key, state, tone = "info") {
  if (typeof showNotice === "function") showNotice(financeText(key, state), tone);
}

function financeSound(name) {
  if (typeof playUiSound === "function") playUiSound(name);
}

function formatDateTime(value, state) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(financeLocale(state), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCount(value, state) {
  return new Intl.NumberFormat(financeLocale(state)).format(Number(value || 0));
}

function financeReportApiPath() {
  return "/analytics/reports/?period=year";
}

function financeReportValue(path, fallback = 0) {
  const parts = path.split(".");
  let value = financeServerReport;
  for (const part of parts) {
    value = value?.[part];
  }
  return Number(value ?? fallback ?? 0);
}

async function loadFinanceReport() {
  if (financeReportLoading) return;
  financeReportLoading = true;
  try {
    const response = window.ToxApi?.fetch
      ? await window.ToxApi.fetch(financeReportApiPath(), { headers: { Accept: "application/json" } })
      : await fetch(`../api${financeReportApiPath()}`, { credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Finance report ${response.status}`);
    financeServerReport = await response.json();
    renderFinance(ToxStore.getState());
  } catch (error) {
    console.warn("Finance API unavailable; using local finance snapshot.", error);
    financeServerReport = null;
  } finally {
    financeReportLoading = false;
  }
}

function renderCashCards(state, cashbox, report) {
  const customers = financeServerReport?.reports?.customers || {};
  const suppliers = financeServerReport?.reports?.suppliers || {};
  const netProfitUsd = financeServerReport ? financeReportValue("reports.sales.netProfitUsd", report.summary.estimatedNetUsd) : report.summary.estimatedNetUsd;
  const clientDebtUsd = financeServerReport ? Number(customers.debtUsd || 0) : report.summary.salesDebtUsd;
  const supplierDebtUsd = financeServerReport ? Number(suppliers.debtUsd || 0) : report.summary.purchasesDebtUsd;
  setFinanceText("[data-cash-balance]", ToxStore.formatMoney(cashbox.balanceUsd, state.currency));
  setFinanceText("[data-cash-receipts]", ToxStore.formatMoney(cashbox.totalReceiptsUsd, state.currency));
  setFinanceText("[data-cash-payments]", ToxStore.formatMoney(cashbox.totalPaymentsUsd, state.currency));
  setFinanceText("[data-cash-net]", ToxStore.formatMoney(netProfitUsd || 0, state.currency));
  setFinanceText("[data-finance-client-debt]", ToxStore.formatMoney(clientDebtUsd || 0, state.currency));
  setFinanceText("[data-finance-supplier-debt]", ToxStore.formatMoney(supplierDebtUsd || 0, state.currency));
  setFinanceText(
    "[data-cash-rate]",
    `${financeText("financeRatePrefix", state)}: 1 USD = ${new Intl.NumberFormat(financeLocale(state)).format(Number(state.exchangeRate || 0))} IQD | ${financeServerReport ? "API" : "Local"}`
  );
}

function renderTodayMovement(state) {
  const todaySales = state.invoices.filter((invoice) => sameDay(invoice.createdAt));
  const todayPurchases = state.purchases.filter((purchase) => sameDay(purchase.createdAt));
  const todaySalesTotal = todaySales.reduce((sum, invoice) => sum + ToxStore.invoiceNet(invoice), 0);
  const todayPurchasesTotal = todayPurchases.reduce((sum, purchase) => sum + Number(purchase.costUsd || 0), 0);

  setFinanceText("[data-today-sales-total]", ToxStore.formatMoney(todaySalesTotal, state.currency));
  setFinanceText(
    "[data-today-purchases-summary]",
    `${financeText("movementCount", state)}: ${formatCount(todayPurchases.length, state)} | ${ToxStore.formatMoney(todayPurchasesTotal, state.currency)}`
  );
}

function renderSalaries(state) {
  if (!salaryList) return;
  if (!state.employees.length) {
    salaryList.innerHTML = `<div class="warehouse-empty finance-empty">${financeText("noEmployees", state)}</div>`;
    return;
  }
  salaryList.innerHTML = state.employees.map((employee) => {
    const salaryUsd = ToxStore.moneyToUsd(employee.salary || 0, state.currency);
    return `
      <div class="ledger-item finance-ledger-item">
        <span>
          <strong>${escapeHtml(employee.name || "-")}</strong>
          <small>${escapeHtml(employee.role || "-")}</small>
        </span>
        <strong>${ToxStore.formatMoney(salaryUsd, state.currency)}</strong>
        <button class="button ghost" type="button" data-pay-salary="${escapeHtml(employee.id)}">${financeText("paySalary", state)}</button>
      </div>
    `;
  }).join("");
}

function renderVouchers(state, cashbox) {
  if (voucherCount) voucherCount.textContent = formatCount(state.cashVouchers.length, state);
  if (!voucherTable) return;
  if (!cashbox.vouchers.length) {
    voucherTable.innerHTML = `<tr class="cart-empty-row"><td colspan="5">${financeText("noCashVouchers", state)}</td></tr>`;
    return;
  }
  voucherTable.innerHTML = cashbox.vouchers.map((voucher) => {
    const typeKey = voucher.type === "payment" ? "payment" : "receipt";
    return `
      <tr class="finance-voucher-row" data-type="${voucher.type}">
        <td>${formatDateTime(voucher.createdAt, state)}</td>
        <td><span class="finance-type-pill" data-type="${voucher.type}">${financeText(typeKey, state)}</span></td>
        <td>${escapeHtml(voucher.party || "-")}</td>
        <td><strong>${ToxStore.formatMoney(voucher.amountUsd, state.currency)}</strong></td>
        <td>${escapeHtml(voucher.note || "-")}</td>
      </tr>
    `;
  }).join("");
}

function renderFinance(state) {
  const safeState = {
    ...state,
    cashVouchers: state.cashVouchers || [],
    employees: state.employees || [],
    invoices: state.invoices || [],
    purchases: state.purchases || []
  };
  const cashbox = ToxStore.cashboxSnapshot();
  const report = ToxStore.reportSnapshot();
  renderCashCards(safeState, cashbox, report);
  renderTodayMovement(safeState);
  renderSalaries(safeState);
  renderVouchers(safeState, cashbox);
}

cashVoucherForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const state = ToxStore.getState();
  const voucher = ToxStore.addCashVoucher({
    type: cashVoucherForm.querySelector("[data-cash-type]")?.value,
    amount: cashVoucherForm.querySelector("[data-cash-amount]")?.value,
    currency: cashVoucherForm.querySelector("[data-cash-currency]")?.value,
    party: cashVoucherForm.querySelector("[data-cash-party]")?.value,
    note: `[${cashVoucherForm.querySelector("[data-cash-category]")?.value || "other"}] ${cashVoucherForm.querySelector("[data-cash-note]")?.value || ""}`.trim()
  });
  if (!voucher) {
    financeNotice("voucherError", state, "error");
    financeSound("error");
    return;
  }
  event.currentTarget.reset();
  window.ToxSelects?.update?.();
  financeNotice("voucherSaved", state, "success");
  financeSound("success");
  loadFinanceReport();
});

salaryList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pay-salary]");
  if (!button) return;
  const state = ToxStore.getState();
  const employee = (state.employees || []).find((entry) => entry.id === button.dataset.paySalary);
  if (!employee) return;
  const voucher = ToxStore.addCashVoucher({
    type: "payment",
    amount: employee.salary || 0,
    currency: state.currency,
    party: employee.name,
    note: `[salary] ${financeText("salaryPayments", state)}${employee.role ? ` - ${employee.role}` : ""}`
  });
  if (!voucher) {
    financeNotice("voucherError", state, "error");
    financeSound("error");
    return;
  }
  financeNotice("voucherSaved", state, "success");
  financeSound("success");
  loadFinanceReport();
});

financeTabs.forEach((button) => {
  button.addEventListener("click", () => {
    financeTabs.forEach((entry) => entry.classList.toggle("active", entry === button));
    document.querySelector(`[data-finance-panel="${button.dataset.financeTab}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
});

ToxStore.subscribe(renderFinance);
loadFinanceReport();
