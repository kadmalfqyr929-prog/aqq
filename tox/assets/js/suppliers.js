let activeSupplierId = "";
let activeSupplierTab = "overview";
let selectedPurchaseId = "";
let purchasePage = 1;
let paymentPage = 1;
let statementPage = 1;

const PURCHASE_PAGE_SIZE = 10;
const PAYMENT_PAGE_SIZE = 10;
const STATEMENT_PAGE_SIZE = 14;

const suppliersList = document.querySelector("[data-suppliers-list]");
const profile = document.querySelector("[data-supplier-profile]");
const supplierForm = document.querySelector("[data-supplier-form]");
const supplierSearch = document.querySelector("[data-supplier-search]");
const supplierCount = document.querySelector("[data-supplier-count]");
const supplierTotalDebt = document.querySelector("[data-supplier-total-debt]");
const supplierTotalPaid = document.querySelector("[data-supplier-total-paid]");
const supplierOpenInvoices = document.querySelector("[data-supplier-open-invoices]");

function supplierFromHash() {
  const match = location.hash.match(/supplier=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readBackendError(response) {
  try {
    const payload = await response.json();
    return payload?.message || payload?.reason || `HTTP_${response.status}`;
  } catch (error) {
    return `HTTP_${response.status}`;
  }
}

async function saveSupplierPaymentToBackend(payload) {
  const response = await ToxApi.fetch("/payments/", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readBackendError(response));
  }
  return response.json();
}

function localeFor(state) {
  return state.lang === "ar" ? "ar-IQ" : "en-US";
}

function formatDate(value, state) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString(localeFor(state));
}

function money(value, state) {
  return ToxStore.formatMoney(number(value), "IQD");
}

function cleanText(value) {
  const repaired = ToxStore.repairText ? ToxStore.repairText(value) : value;
  return String(repaired ?? "").trim();
}

const unknownProductLabel = "\u0645\u0646\u062a\u062c \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641";

function looksLikeProductId(value, item = {}) {
  const text = cleanText(value);
  if (!text) return false;
  const productId = cleanText(item.productId || "");
  return text === productId || /^p-\d+/i.test(text);
}

function productForPurchaseItem(item, state) {
  const productId = cleanText(item.productId || "");
  if (!productId) return null;
  return state.products.find((product) => product.id === productId) || null;
}

function purchaseProductName(item, state) {
  const product = productForPurchaseItem(item, state);
  const candidates = [
    item.productName,
    item.name,
    product?.name
  ].map(cleanText).filter((value) => value && !looksLikeProductId(value, item));
  return candidates[0] || unknownProductLabel;
}

function purchaseProductMeta(item, state) {
  const product = productForPurchaseItem(item, state);
  const parts = [
    cleanText(item.unitName || ""),
    cleanText(item.productBrand || item.brand || product?.brand || ""),
  ].filter((value) => value && !looksLikeProductId(value, item));
  return [...new Set(parts)].join(" / ");
}

function initials(name) {
  return String(name || "م").trim().charAt(0).toUpperCase();
}

function supplierPurchases(supplierId, state) {
  return state.purchases
    .filter((purchase) => purchase.supplierId === supplierId)
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
}

function supplierPayments(supplierId, state) {
  return state.supplierPayments
    .filter((payment) => payment.supplierId === supplierId)
    .sort((left, right) => new Date(right.paidAt || right.createdAt || 0) - new Date(left.paidAt || left.createdAt || 0));
}

function purchaseItems(purchase) {
  return ToxStore.purchaseItems(purchase);
}

function purchaseStatus(purchase) {
  const debt = ToxStore.purchaseDebt(purchase);
  if (debt <= 0.0001) return { label: "مسددة بالكامل", tone: "success" };
  if (number(purchase.paidUsd) > 0) return { label: "مسددة جزئيا", tone: "warning" };
  return { label: "غير مسددة", tone: "danger" };
}

function badge(label, tone = "neutral") {
  return `<span class="erp-badge erp-badge-${tone}">${escapeHtml(label)}</span>`;
}

function supplierMetrics(supplier, state) {
  const stats = ToxStore.supplierStats(supplier.id);
  const purchases = supplierPurchases(supplier.id, state);
  const payments = supplierPayments(supplier.id, state);
  const totalPaid = number(stats.totalPaid);
  const totalDebt = number(stats.totalDebt);
  const accountBase = totalDebt + totalPaid;
  const paidRatio = accountBase > 0 ? Math.min(100, Math.round((totalPaid / accountBase) * 100)) : 100;
  const pendingInvoices = purchases.filter((purchase) => ToxStore.purchaseDebt(purchase) > 0.0001).length;
  const lastPurchase = purchases[0];
  const lastPayment = payments[0];
  const statementRows = [...stats.movements].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  return {
    ...stats,
    purchases,
    payments,
    totalPaid,
    totalDebt,
    paidRatio,
    pendingInvoices,
    lastPurchase,
    lastPayment,
    statementRows,
  };
}

function supplierAccountState(metrics) {
  if (metrics.totalDebt > 0.0001) return { label: "مطلوب للمورد", tone: "danger", amount: metrics.totalDebt };
  if (metrics.openingUsd < -0.0001) return { label: "رصيد لصالحنا", tone: "success", amount: Math.abs(metrics.openingUsd) };
  return { label: "متوازن", tone: "success", amount: 0 };
}

function renderSupplierSummary(state) {
  const suppliers = state.suppliers || [];
  const summary = suppliers.reduce((totals, supplier) => {
    const metrics = supplierMetrics(supplier, state);
    totals.debt += metrics.totalDebt;
    totals.paid += metrics.totalPaid;
    totals.openInvoices += metrics.pendingInvoices;
    return totals;
  }, { debt: 0, paid: 0, openInvoices: 0 });

  if (supplierCount) supplierCount.textContent = suppliers.length;
  if (supplierTotalDebt) supplierTotalDebt.textContent = money(summary.debt, state);
  if (supplierTotalPaid) supplierTotalPaid.textContent = money(summary.paid, state);
  if (supplierOpenInvoices) supplierOpenInvoices.textContent = summary.openInvoices;
}

function renderSupplierList(suppliers, state) {
  const cards = suppliers.map((supplier) => {
    const metrics = supplierMetrics(supplier, state);
    const account = supplierAccountState(metrics);
    return `
      <button class="client-card smart-client-card supplier-account-card ${supplier.id === activeSupplierId ? "active" : ""}" data-supplier-id="${escapeHtml(supplier.id)}">
        <span class="client-card-top">
          <strong>${escapeHtml(supplier.name)}</strong>
          <b class="${account.tone === "danger" ? "danger-text" : "success-text"}">${money(account.amount, state)}</b>
        </span>
        <span class="supplier-card-company">${escapeHtml(supplier.companyName || "بدون شركة")}</span>
        <span class="client-card-meta">${escapeHtml(supplier.phone || "بدون هاتف")} - ${account.label}</span>
        <div class="mini-ratios supplier-card-ratios">
          <small>${metrics.orderCount} فواتير</small>
          <small>${metrics.payments.length} دفعات</small>
          <small>${metrics.pendingInvoices} غير مسددة</small>
        </div>
      </button>
    `;
  }).join("");

  suppliersList.innerHTML = `
    <div class="supplier-list-head">
      <span>قائمة الموردين</span>
      <strong>${suppliers.length}</strong>
    </div>
    <div class="supplier-card-stack">
      ${cards || `<div class="warehouse-empty supplier-empty-box">لا يوجد موردون مطابقون</div>`}
    </div>
  `;

  document.querySelectorAll("[data-supplier-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSupplierId = button.dataset.supplierId;
      activeSupplierTab = "overview";
      selectedPurchaseId = "";
      purchasePage = 1;
      paymentPage = 1;
      statementPage = 1;
      renderSuppliers(ToxStore.getState());
    });
  });
}

function kpiCard(label, value, tone, sub = "") {
  return `
    <div class="client-kpi client-kpi-${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
      ${sub ? `<small>${escapeHtml(sub)}</small>` : ""}
    </div>
  `;
}

function profileHeader(supplier, state) {
  const metrics = supplierMetrics(supplier, state);
  const account = supplierAccountState(metrics);
  return `
    <section class="client-profile-hero supplier-profile-hero">
      <div class="client-identity">
        <div class="client-avatar"><span>${escapeHtml(initials(supplier.name))}</span></div>
        <div>
          <div class="client-hero-line">
            <h2>${escapeHtml(supplier.name)}</h2>
            ${badge(account.label, account.tone)}
          </div>
          <div class="client-meta-strip">
            <span>${escapeHtml(supplier.companyName || "بدون شركة")}</span>
            <span>${escapeHtml(supplier.phone || "بدون هاتف")}</span>
            <span>${escapeHtml(supplier.address || supplier.city || "بدون عنوان")}</span>
            <span>آخر فاتورة: ${formatDate(metrics.lastPurchase?.createdAt, state)}</span>
            <span>آخر دفعة: ${formatDate(metrics.lastPayment?.paidAt || metrics.lastPayment?.createdAt, state)}</span>
          </div>
        </div>
      </div>
      <div class="client-payment-ring" style="--paid:${metrics.paidRatio}">
        <strong>${metrics.paidRatio}%</strong>
        <span>نسبة التسديد</span>
      </div>
      <div class="supplier-hero-actions">
        <button class="button primary compact-action" type="button" data-open-supplier-payment="${escapeHtml(supplier.id)}">سداد مورد</button>
        <button class="button ghost compact-action" type="button" data-supplier-tab-jump="statement">كشف الحساب</button>
        <button class="button ghost compact-action" type="button" data-print-supplier-statement="${escapeHtml(supplier.id)}">طباعة الكشف</button>
      </div>
    </section>
    <section class="client-kpi-grid">
      ${kpiCard("إجمالي الدين", money(metrics.totalDebt, state), "danger", account.label)}
      ${kpiCard("إجمالي المدفوع", money(metrics.totalPaid, state), "success")}
      ${kpiCard("المتبقي بذمة النظام", money(metrics.totalDebt, state), "warning")}
      ${kpiCard("عدد الفواتير", String(metrics.orderCount), "info")}
      ${kpiCard("عدد المنتجات", String(metrics.itemsCount), "violet")}
      ${kpiCard("فواتير غير مسددة", String(metrics.pendingInvoices), "danger")}
    </section>
    <nav class="client-tabs" aria-label="Supplier sections">
      ${[
        ["overview", "نظرة عامة"],
        ["invoices", "الفواتير"],
        ["payments", "الدفعات"],
        ["statement", "كشف الحساب"],
        ["settings", "إعدادات الحساب"],
      ].map(([key, label]) => `
        <button type="button" class="${activeSupplierTab === key ? "active" : ""}" data-supplier-tab="${key}">
          ${label}
        </button>
      `).join("")}
    </nav>
  `;
}

function supplierAlerts(supplier, state) {
  const metrics = supplierMetrics(supplier, state);
  const alerts = [];
  if (metrics.totalDebt > 0.0001) {
    alerts.push({ tone: "danger", title: "رصيد مستحق للمورد", text: `المتبقي حاليا ${money(metrics.totalDebt, state)}` });
  }
  if (!metrics.purchases.length) {
    alerts.push({ tone: "info", title: "لا توجد فواتير شراء", text: "يمكنك ربط هذا المورد بصفحة المشتريات وبدء الأرشفة." });
  }
  const unpaid = metrics.purchases.find((purchase) => ToxStore.purchaseDebt(purchase) > 0.0001);
  if (unpaid) {
    alerts.push({ tone: "warning", title: "فاتورة تحتاج تسديد", text: `${unpaid.id} - متبقي ${money(ToxStore.purchaseDebt(unpaid), state)}` });
  }
  if (number(supplier.openingBalanceUsd) > 0.0001) {
    alerts.push({ tone: "info", title: "رصيد افتتاحي مرحل", text: `تم ترحيل ${money(supplier.openingBalanceUsd, state)} في كشف الحساب.` });
  }
  return alerts;
}

function renderOverview(supplier, state) {
  const metrics = supplierMetrics(supplier, state);
  const recentPurchases = metrics.purchases.slice(0, 5);
  const recentPayments = metrics.payments.slice(0, 5);
  return `
    <section class="client-overview-grid">
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>الملف المالي</h3>
          <button class="button primary compact-action" type="button" data-open-supplier-payment="${escapeHtml(supplier.id)}">سداد مورد</button>
        </div>
        <div class="client-progress-large">
          <div class="client-progress-top">
            <span>نسبة التسديد</span>
            <strong>${metrics.paidRatio}%</strong>
          </div>
          <div class="client-progress"><i style="width:${metrics.paidRatio}%"></i></div>
        </div>
        <div class="client-alert-stack">
          ${supplierAlerts(supplier, state).map((alert) => `
            <div class="client-alert client-alert-${alert.tone}">
              <strong>${escapeHtml(alert.title)}</strong>
              <span>${escapeHtml(alert.text)}</span>
            </div>
          `).join("") || `<div class="client-empty-slim">لا توجد تنبيهات حالية</div>`}
        </div>
      </div>
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>آخر الفواتير</h3>
          <button class="button ghost compact-action" type="button" data-supplier-tab-jump="invoices">عرض الكل</button>
        </div>
        <div class="client-mini-list">
          ${recentPurchases.map((purchase) => {
            const status = purchaseStatus(purchase);
            return `
              <button type="button" data-open-purchase="${escapeHtml(purchase.id)}">
                <span><strong>${escapeHtml(purchase.id)}</strong><small>${formatDate(purchase.createdAt, state)} - ${purchaseItems(purchase).length} صنف</small></span>
                <b>${money(ToxStore.purchaseDebt(purchase), state)}</b>
                ${badge(status.label, status.tone)}
              </button>
            `;
          }).join("") || `<div class="client-empty-slim">لا توجد فواتير شراء لهذا المورد</div>`}
        </div>
      </div>
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>آخر الدفعات</h3>
          <button class="button ghost compact-action" type="button" data-supplier-tab-jump="payments">عرض الكل</button>
        </div>
        <div class="client-timeline compact">
          ${recentPayments.map((payment) => `
            <article>
              <time>${formatDate(payment.paidAt || payment.createdAt, state)}</time>
              <div>
                <strong>${escapeHtml(payment.id)}</strong>
                <span>${escapeHtml(payment.note || "دفعة تسديد مورد")}</span>
              </div>
              <b class="text-green">${money(payment.amountUsd, state)}</b>
            </article>
          `).join("") || `<div class="client-empty-slim">لا توجد دفعات مسجلة لهذا المورد</div>`}
        </div>
      </div>
    </section>
  `;
}

function purchaseRow(purchase, state) {
  const status = purchaseStatus(purchase);
  return `
    <tr>
      <td><strong>${escapeHtml(purchase.id)}</strong></td>
      <td>${formatDate(purchase.createdAt, state)}</td>
      <td>${escapeHtml(purchase.supplierName || "مورد")}</td>
      <td>${purchaseItems(purchase).length}</td>
      <td>${money(purchase.costUsd, state)}</td>
      <td class="text-green">${money(purchase.paidUsd, state)}</td>
      <td class="text-red">${money(ToxStore.purchaseDebt(purchase), state)}</td>
      <td>${badge(status.label, status.tone)}</td>
      <td><button class="button ghost compact-action" type="button" data-open-purchase="${escapeHtml(purchase.id)}">عرض</button></td>
    </tr>
  `;
}

function pagination(total, page, pageSize, key) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `
    <div class="client-pagination">
      <span>${page} / ${pages}</span>
      <button type="button" class="button ghost compact-action" data-page-target="${key}" data-page-value="${page - 1}" ${page <= 1 ? "disabled" : ""}>السابق</button>
      <button type="button" class="button ghost compact-action" data-page-target="${key}" data-page-value="${page + 1}" ${page >= pages ? "disabled" : ""}>التالي</button>
    </div>
  `;
}

function renderInvoices(supplier, state) {
  const purchases = supplierPurchases(supplier.id, state);
  const start = (purchasePage - 1) * PURCHASE_PAGE_SIZE;
  const pageItems = purchases.slice(start, start + PURCHASE_PAGE_SIZE);
  return `
    <section class="client-work-card">
      <div class="client-section-title">
        <h3>فواتير الشراء</h3>
        <span>${purchases.length} فاتورة</span>
      </div>
      <div class="client-table-wrap">
        <table class="client-fast-table">
          <thead>
            <tr>
              <th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>المنتجات</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map((purchase) => purchaseRow(purchase, state)).join("") || `<tr><td colspan="9">لا توجد فواتير شراء لهذا المورد</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pagination(purchases.length, purchasePage, PURCHASE_PAGE_SIZE, "purchases")}
    </section>
  `;
}

function renderPayments(supplier, state) {
  const payments = supplierPayments(supplier.id, state);
  const start = (paymentPage - 1) * PAYMENT_PAGE_SIZE;
  const pageItems = payments.slice(start, start + PAYMENT_PAGE_SIZE);
  return `
    <section class="client-work-card">
      <div class="client-section-title">
        <h3>دفعات المورد</h3>
        <button class="button primary compact-action" type="button" data-open-supplier-payment="${escapeHtml(supplier.id)}">+ سداد مورد</button>
      </div>
      <div class="client-table-wrap">
        <table class="client-fast-table compact">
          <thead><tr><th>التاريخ</th><th>المبلغ</th><th>التوزيع</th><th>الملاحظات</th></tr></thead>
          <tbody>
            ${pageItems.map((payment) => `
              <tr>
                <td>${formatDate(payment.paidAt || payment.createdAt, state)}</td>
                <td class="text-green">${money(payment.amountUsd, state)}</td>
                <td>${(payment.appliedTo || []).length ? `${(payment.appliedTo || []).length} فاتورة` : "رصيد غير موزع"}</td>
                <td>${escapeHtml(payment.note || "دفعة تسديد مورد")}</td>
              </tr>
            `).join("") || `<tr><td colspan="4">لا توجد دفعات مسجلة</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pagination(payments.length, paymentPage, PAYMENT_PAGE_SIZE, "payments")}
    </section>
  `;
}

function renderStatement(supplier, state) {
  const rows = supplierMetrics(supplier, state).statementRows;
  const start = (statementPage - 1) * STATEMENT_PAGE_SIZE;
  const pageItems = rows.slice(start, start + STATEMENT_PAGE_SIZE);
  return `
    <section class="client-work-card">
      <div class="client-section-title">
        <h3>كشف الحساب</h3>
        <span>${rows.length} حركة</span>
      </div>
      <div class="client-timeline">
        ${pageItems.map((row) => {
          const debit = number(row.debitUsd);
          const credit = number(row.creditUsd);
          const tone = credit > debit ? "success" : "danger";
          const amountText = credit > debit ? money(credit, state) : money(debit, state);
          const subtitle = row.referenceId
            ? `${row.title || "حركة"} - ${row.referenceId}`
            : (row.note || row.title || "حركة مالية");
          return `
            <article>
              <time>${formatDate(row.createdAt, state)}</time>
              <div>
                <strong>${escapeHtml(row.title || "حركة مالية")}</strong>
                <span>${escapeHtml(subtitle)}</span>
              </div>
              <b class="${tone === "success" ? "text-green" : "text-red"}">${amountText}</b>
            </article>
          `;
        }).join("") || `<div class="client-empty-slim">لا توجد حركات مالية لهذا المورد</div>`}
      </div>
      ${pagination(rows.length, statementPage, STATEMENT_PAGE_SIZE, "statement")}
    </section>
  `;
}

function renderSettings(supplier, state) {
  const metrics = supplierMetrics(supplier, state);
  const canDelete = metrics.totalDebt <= 0.0001;
  return `
    <section class="client-grid-two">
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>تعديل بيانات المورد</h3>
          <span>تحديث مباشر</span>
        </div>
        <form class="supplier-settings-form" data-edit-supplier-form>
          <label><span>اسم المورد</span><input name="name" value="${escapeHtml(supplier.name)}" required /></label>
          <label><span>اسم الشركة</span><input name="companyName" value="${escapeHtml(supplier.companyName || "")}" /></label>
          <label><span>رقم الهاتف</span><input name="phone" value="${escapeHtml(supplier.phone || "")}" /></label>
          <label><span>العنوان</span><input name="address" value="${escapeHtml(supplier.address || supplier.city || "")}" /></label>
          <label><span>ملاحظة مالية</span><input name="financialNote" value="${escapeHtml(supplier.financialNote || "")}" /></label>
          <button class="button primary" type="submit">حفظ التعديلات</button>
        </form>
      </div>
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>حذف الحساب</h3>
          <span>شرط الحذف الذكي</span>
        </div>
        <div class="supplier-delete-card">
          <p>يمكن حذف المورد فقط إذا كان الرصيد صفراً ولا توجد ذمة مالية مفتوحة.</p>
          <div class="supplier-delete-stats">
            <span>الرصيد الحالي</span>
            <strong class="${canDelete ? "text-green" : "text-red"}">${money(metrics.totalDebt, state)}</strong>
          </div>
          <button class="btn-danger" type="button" data-delete-supplier="${escapeHtml(supplier.id)}" ${canDelete ? "" : "disabled"}>
            حذف حساب المورد
          </button>
        </div>
      </div>
    </section>
  `;
}

function tabContent(supplier, state) {
  if (activeSupplierTab === "invoices") return renderInvoices(supplier, state);
  if (activeSupplierTab === "payments") return renderPayments(supplier, state);
  if (activeSupplierTab === "statement") return renderStatement(supplier, state);
  if (activeSupplierTab === "settings") return renderSettings(supplier, state);
  return renderOverview(supplier, state);
}

function renderPurchaseModal(purchase, state) {
  if (!purchase) return "";
  const supplier = state.suppliers.find((entry) => entry.id === purchase.supplierId);
  const linkedPayments = state.supplierPayments
    .filter((payment) => (payment.appliedTo || []).some((item) => item.purchaseId === purchase.id))
    .sort((left, right) => new Date(right.paidAt || right.createdAt || 0) - new Date(left.paidAt || left.createdAt || 0));
  const status = purchaseStatus(purchase);
  const items = purchaseItems(purchase);
  const supplierName = supplier?.name || purchase.supplierName || "مورد";
  return `
    <div class="client-drawer-shell account-invoice-shell" data-supplier-drawer>
      <div class="client-drawer-backdrop ledger-detail-backdrop" data-close-supplier-drawer></div>
      <section class="client-invoice-modal supplier-invoice-modal ledger-detail-modal account-invoice-modal" role="dialog" aria-modal="true" aria-label="تفاصيل فاتورة المورد">
        <header class="ledger-detail-header account-invoice-header">
          <div>
            <span class="ledger-detail-kind">فاتورة شراء</span>
            <h2>${escapeHtml(purchase.id)}</h2>
            <p>${escapeHtml(supplierName)} - ${formatDate(purchase.createdAt, state)}</p>
          </div>
          <button class="button ghost compact-action" type="button" data-close-supplier-drawer>إغلاق</button>
        </header>
        <div class="drawer-actions ledger-detail-actions">
          <button class="button primary compact-action" type="button" data-open-payment-for-purchase="${escapeHtml(purchase.id)}">سداد هذه الفاتورة</button>
          <button class="button ghost compact-action" type="button" data-supplier-tab-jump="statement">كشف الحساب</button>
          <button class="button ghost compact-action" type="button" data-print-supplier-purchase="${escapeHtml(purchase.id)}">طباعة الفاتورة</button>
        </div>
        <section class="drawer-summary ledger-detail-summary">
          <div><span>الإجمالي</span><strong>${money(purchase.costUsd, state)}</strong></div>
          <div><span>المدفوع</span><strong class="text-green">${money(purchase.paidUsd, state)}</strong></div>
          <div><span>المتبقي</span><strong class="text-red">${money(ToxStore.purchaseDebt(purchase), state)}</strong></div>
          <div><span>الحالة</span><strong><span class="ledger-status ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span></strong></div>
          <div><span>عدد المنتجات</span><strong>${items.length}</strong></div>
        </section>
        <section class="drawer-block ledger-detail-section">
          <div class="ledger-detail-section-title">
            <h3>معلومات الفاتورة</h3>
            <span>بيانات المورد والملاحظة</span>
          </div>
          <div class="account-invoice-info-grid">
            <div class="ledger-guarantor-card">
              <span>المورد</span>
              <strong>${escapeHtml(supplierName)}</strong>
              <small>${formatDate(purchase.createdAt, state)}</small>
            </div>
            <div class="ledger-guarantor-card">
              <span>الشركة</span>
              <strong>${escapeHtml(supplier?.companyName || "غير محددة")}</strong>
              <small>${escapeHtml(purchase.note || "لا توجد ملاحظات")}</small>
            </div>
          </div>
        </section>
        <section class="drawer-block ledger-detail-section">
          <div class="ledger-detail-section-title">
            <h3>تفاصيل المنتجات</h3>
            <span>${items.length} صنف</span>
          </div>
          <div class="client-table-wrap ledger-detail-table-wrap">
            <table class="client-fast-table compact ledger-detail-table">
              <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                ${items.map((item, index) => {
                  const meta = purchaseProductMeta(item, state);
                  return `
                  <tr>
                    <td>${index + 1}</td>
                    <td class="invoice-product-name"><strong>${escapeHtml(purchaseProductName(item, state))}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</td>
                    <td>${number(item.quantity)}</td>
                    <td>${escapeHtml(cleanText(item.unitName || "وحدة"))}</td>
                    <td>${money(item.unitCostUsd, state)}</td>
                    <td>${money(item.totalUsd, state)}</td>
                  </tr>
                `;
                }).join("") || `<tr><td colspan="6">لا توجد منتجات داخل هذه الفاتورة</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="drawer-block ledger-detail-section">
          <div class="ledger-detail-section-title">
            <h3>سجل التسديدات المرتبطة</h3>
            <span>${linkedPayments.length} حركة</span>
          </div>
          <div class="client-table-wrap ledger-detail-table-wrap">
            <table class="client-fast-table compact ledger-detail-table">
              <thead><tr><th>التاريخ</th><th>المبلغ</th><th>المرجع</th><th>ملاحظات</th></tr></thead>
              <tbody>
                ${linkedPayments.map((payment) => {
                  const applied = (payment.appliedTo || []).find((item) => item.purchaseId === purchase.id);
                  return `
                    <tr>
                      <td>${formatDate(payment.paidAt || payment.createdAt, state)}</td>
                      <td class="text-green">${money(applied?.amountUsd || payment.amountUsd, state)}</td>
                      <td>${escapeHtml(payment.id)}</td>
                      <td>${escapeHtml(payment.note || "دفعة مورد")}</td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="4">لا توجد دفعات مرتبطة مباشرة بهذه الفاتورة</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  `;
}

function closePurchaseModal() {
  selectedPurchaseId = "";
  document.querySelector("[data-supplier-drawer]")?.remove();
}

function openPurchaseModal(purchaseId) {
  selectedPurchaseId = purchaseId;
  const state = ToxStore.getState();
  document.querySelector("[data-supplier-drawer]")?.remove();
  const root = document.createElement("div");
  root.innerHTML = renderPurchaseModal(state.purchases.find((purchase) => purchase.id === purchaseId), state);
  const modal = root.firstElementChild;
  if (!modal) return;
  document.body.appendChild(modal);
  bindPurchaseModalEvents();
}

function openSupplierPaymentModal({ supplierId, purchaseId = "", amountUsd = 0, title = "سداد مورد", note = "دفعة تسديد مورد" }) {
  const state = ToxStore.getState();
  document.querySelector("[data-supplier-payment-modal-root]")?.remove();
  const root = document.createElement("div");
  root.dataset.supplierPaymentModalRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-supplier-payment></div>
    <form class="client-pay-modal" data-supplier-pay-modal>
      <header>
        <div><span>تسوية مالية</span><h2>${escapeHtml(title)}</h2></div>
        <button class="button ghost compact-action" type="button" data-close-supplier-payment>إغلاق</button>
      </header>
      <label><span>مبلغ التسديد</span><input type="number" min="0.01" step="0.01" name="amount" value="${ToxStore.convertUsd(amountUsd, "IQD").toFixed(0)}" required /></label>
      <label><span>العملة</span><select name="currency"><option value="IQD" selected>IQD</option><option value="USD">USD</option></select></label>
      <label><span>ملاحظات</span><input name="note" value="${escapeHtml(note)}" /></label>
      <button class="button primary" type="submit">تأكيد السداد</button>
    </form>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-supplier-payment]").forEach((button) => {
    button.addEventListener("click", () => root.remove());
  });
  root.querySelector("[data-supplier-pay-modal]").addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await saveSupplierPaymentToBackend({
        entityType: "supplier",
        supplierId,
        purchaseId,
        amountUsd: ToxStore.moneyToUsd(form.amount.value, form.currency.value),
        note: form.note.value,
        paidAt: new Date().toISOString().slice(0, 10)
      });
      await ToxStore.refreshFromBackend();
      showNotice("تم تسجيل دفعة المورد وتحديث الرصيد مباشرة", "success");
      root.remove();
      if (selectedPurchaseId) {
        const openId = selectedPurchaseId;
        closePurchaseModal();
        openPurchaseModal(openId);
      }
      renderSuppliers(ToxStore.getState());
    } catch (error) {
      console.error("Supplier payment save failed", error);
      showNotice(`تعذر تسجيل دفعة المورد: ${error.message || "خطأ غير معروف"}`, "error");
    } finally {
      submitButton.disabled = false;
    }
  }, true);
  root.querySelector("[data-supplier-pay-modal]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payment = ToxStore.addSupplierPayment({
      supplierId,
      amount: form.amount.value,
      currency: form.currency.value,
      note: form.note.value,
      paidAt: new Date().toISOString().slice(0, 10),
      allocationMode: purchaseId ? "invoice" : "fifo",
      purchaseId,
    });
    if (!payment) {
      showNotice("تعذر تسجيل دفعة المورد", "error");
      return;
    }
    showNotice("تم تسجيل دفعة المورد وتحديث الرصيد مباشرة", "success");
    root.remove();
    if (selectedPurchaseId) {
      const openId = selectedPurchaseId;
      closePurchaseModal();
      openPurchaseModal(openId);
    }
    renderSuppliers(ToxStore.getState());
  });
}

function openSupplierCreateModal() {
  document.querySelector("[data-supplier-create-modal-root]")?.remove();
  const root = document.createElement("div");
  root.dataset.supplierCreateModalRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-supplier-create></div>
    <form class="client-pay-modal client-create-modal" data-supplier-create-modal>
      <header>
        <div><span>حساب جديد</span><h2>إضافة مورد جديد</h2></div>
        <button class="button ghost compact-action" type="button" data-close-supplier-create>إغلاق</button>
      </header>
      <label><span>اسم المورد</span><input name="name" required autofocus /></label>
      <label><span>اسم الشركة</span><input name="companyName" /></label>
      <label><span>رقم الهاتف</span><input name="phone" /></label>
      <label><span>العنوان</span><input name="address" /></label>
      <label><span>الرصيد الافتتاحي</span><input type="number" min="0" step="0.01" name="openingBalance" value="0" /></label>
      <label><span>ملاحظة مالية</span><input name="financialNote" placeholder="دين سابق أو ملاحظات المورد" /></label>
      <button class="button primary" type="submit">إنشاء حساب المورد</button>
    </form>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-supplier-create]").forEach((button) => {
    button.addEventListener("click", () => root.remove());
  });
  root.querySelector("[data-supplier-create-modal]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = ToxStore.addSupplier({
      name: data.get("name"),
      companyName: data.get("companyName"),
      phone: data.get("phone"),
      address: data.get("address"),
      city: data.get("address"),
      openingBalance: data.get("openingBalance"),
      openingBalanceType: "debit",
      financialNote: data.get("financialNote"),
    });
    if (!id) {
      showNotice("يرجى إدخال اسم المورد", "error");
      return;
    }
    activeSupplierId = id;
    activeSupplierTab = "overview";
    root.remove();
    showNotice("تم إنشاء حساب المورد وترحيل الرصيد الافتتاحي", "success");
    renderSuppliers(ToxStore.getState());
  });
}

function bindPurchaseModalEvents() {
  document.querySelectorAll("[data-close-supplier-drawer]").forEach((button) => {
    button.addEventListener("click", closePurchaseModal);
  });
  document.querySelectorAll("[data-open-payment-for-purchase]").forEach((button) => {
    button.addEventListener("click", () => {
      const purchase = ToxStore.getState().purchases.find((entry) => entry.id === button.dataset.openPaymentForPurchase);
      if (!purchase || !purchase.supplierId) return;
      openSupplierPaymentModal({
        supplierId: purchase.supplierId,
        purchaseId: purchase.id,
        amountUsd: ToxStore.purchaseDebt(purchase),
        title: `سداد الفاتورة ${purchase.id}`,
        note: `سداد على الفاتورة ${purchase.id}`,
      });
    });
  });
  document.querySelectorAll("[data-print-supplier-purchase]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = ToxStore.getState();
      const purchase = state.purchases.find((entry) => entry.id === button.dataset.printSupplierPurchase);
      if (purchase) window.ToxPrint?.render?.("purchaseInvoice", purchase, state);
    });
  });
  document.querySelectorAll("[data-supplier-tab-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSupplierTab = button.dataset.supplierTabJump;
      closePurchaseModal();
      renderSuppliers(ToxStore.getState());
    });
  });
}

function bindProfileEvents(supplier, state) {
  document.querySelectorAll("[data-supplier-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSupplierTab = button.dataset.supplierTab;
      purchasePage = 1;
      paymentPage = 1;
      statementPage = 1;
      renderSuppliers(ToxStore.getState());
    });
  });
  document.querySelectorAll("[data-supplier-tab-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSupplierTab = button.dataset.supplierTabJump;
      renderSuppliers(ToxStore.getState());
    });
  });
  document.querySelectorAll("[data-page-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.pageTarget;
      const value = Math.max(1, number(button.dataset.pageValue));
      if (target === "purchases") purchasePage = value;
      if (target === "payments") paymentPage = value;
      if (target === "statement") statementPage = value;
      renderSuppliers(ToxStore.getState());
    });
  });
  document.querySelectorAll("[data-open-purchase]").forEach((button) => {
    button.addEventListener("click", () => openPurchaseModal(button.dataset.openPurchase));
  });
  document.querySelectorAll("[data-open-supplier-payment]").forEach((button) => {
    button.addEventListener("click", () => {
      openSupplierPaymentModal({
        supplierId: button.dataset.openSupplierPayment,
        amountUsd: ToxStore.supplierStats(button.dataset.openSupplierPayment).debtUsd,
      });
    });
  });
  document.querySelectorAll("[data-print-supplier-statement]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = ToxStore.getState();
      const target = state.suppliers.find((entry) => entry.id === button.dataset.printSupplierStatement);
      if (target) window.ToxPrint?.render?.("supplierStatement", target, state);
    });
  });
  document.querySelector("[data-edit-supplier-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = ToxStore.updateSupplier(supplier.id, {
      name: form.get("name"),
      companyName: form.get("companyName"),
      phone: form.get("phone"),
      address: form.get("address"),
      city: form.get("address"),
      financialNote: form.get("financialNote"),
    });
    if (!result.ok) {
      showNotice("تعذر حفظ بيانات المورد", "error");
      return;
    }
    showNotice("تم تحديث بيانات المورد", "success");
    renderSuppliers(ToxStore.getState());
  });
  document.querySelectorAll("[data-delete-supplier]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("سيتم حذف الحساب فقط إذا كان الرصيد صفرا. هل تريد المتابعة؟")) return;
      const result = ToxStore.deleteSupplier(button.dataset.deleteSupplier);
      if (!result.ok) {
        showNotice("لا يمكن حذف المورد لوجود ذمة مالية مفتوحة", "error");
        return;
      }
      activeSupplierId = ToxStore.getState().suppliers[0]?.id || "";
      activeSupplierTab = "overview";
      showNotice("تم حذف حساب المورد", "success");
      renderSuppliers(ToxStore.getState());
    });
  });
}

function renderSuppliers(state) {
  const hashedSupplier = supplierFromHash();
  if (hashedSupplier && state.suppliers.some((supplier) => supplier.id === hashedSupplier)) {
    activeSupplierId = hashedSupplier;
    history.replaceState(null, "", location.pathname);
  }
  if (!state.suppliers.some((supplier) => supplier.id === activeSupplierId)) {
    activeSupplierId = state.suppliers[0]?.id || "";
  }
  renderSupplierSummary(state);
  const query = (supplierSearch?.value || "").trim().toLowerCase();
  const filteredSuppliers = state.suppliers.filter((supplier) => {
    const metrics = supplierMetrics(supplier, state);
    return !query || `${supplier.name} ${supplier.companyName || ""} ${supplier.phone || ""} ${metrics.totalDebt}`.toLowerCase().includes(query);
  });
  if (!filteredSuppliers.some((supplier) => supplier.id === activeSupplierId)) {
    activeSupplierId = filteredSuppliers[0]?.id || "";
  }
  renderSupplierList(filteredSuppliers, state);

  const supplier = state.suppliers.find((entry) => entry.id === activeSupplierId);
  if (!supplier) {
    profile.innerHTML = `<div class="client-empty-state">أضف موردا جديدا لبدء إدارة الذمم وفواتير الشراء والتسديدات.</div>`;
    return;
  }
  profile.innerHTML = profileHeader(supplier, state) + tabContent(supplier, state);
  bindProfileEvents(supplier, state);
}

supplierForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = ToxStore.addSupplier({
    name: document.querySelector("[data-supplier-name]").value,
    companyName: document.querySelector("[data-supplier-company]")?.value || "",
    phone: document.querySelector("[data-supplier-phone]")?.value || "",
    address: document.querySelector("[data-supplier-address]")?.value || "",
    city: document.querySelector("[data-supplier-address]")?.value || "",
    openingBalance: document.querySelector("[data-supplier-opening-balance]")?.value || 0,
    openingBalanceType: "debit",
  });
  if (id) {
    activeSupplierId = id;
    activeSupplierTab = "overview";
    showNotice("تم إضافة المورد", "success");
  }
  supplierForm.reset();
});

supplierSearch?.addEventListener("input", () => renderSuppliers(ToxStore.getState()));
document.querySelector("[data-open-supplier-create]")?.addEventListener("click", openSupplierCreateModal);
window.openToxSupplierPaymentModal = openSupplierPaymentModal;

ToxStore.subscribe((state) => {
  renderSuppliers(state);
  if (selectedPurchaseId) {
    const openId = selectedPurchaseId;
    closePurchaseModal();
    openPurchaseModal(openId);
  }
});

renderSuppliers(ToxStore.getState());
