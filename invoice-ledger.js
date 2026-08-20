const invoiceLedgerIsPurchase = document.body.dataset.page === "purchase-invoices";
const invoiceLedgerEndpoint = invoiceLedgerIsPurchase ? "/purchases-ledger/" : "/invoices/";
const invoiceLedgerKey = invoiceLedgerIsPurchase ? "purchases" : "invoices";
const invoiceLedgerTitle = invoiceLedgerIsPurchase ? "فواتير الشراء" : "فواتير البيع";

const invoiceLedgerEls = {
  q: document.querySelector("[data-invoice-filter-q]"),
  party: document.querySelector("[data-invoice-filter-party]"),
  warehouse: document.querySelector("[data-invoice-filter-warehouse]"),
  status: document.querySelector("[data-invoice-filter-status]"),
  kind: document.querySelector("[data-invoice-filter-kind]"),
  currency: document.querySelector("[data-invoice-filter-currency]"),
  minTotal: document.querySelector("[data-invoice-filter-min-total]"),
  maxTotal: document.querySelector("[data-invoice-filter-max-total]"),
  hasDebt: document.querySelector("[data-invoice-filter-has-debt]"),
  dateFrom: document.querySelector("[data-invoice-filter-date-from]"),
  dateTo: document.querySelector("[data-invoice-filter-date-to]"),
  apply: document.querySelector("[data-invoice-filter-apply]"),
  clear: document.querySelector("[data-invoice-filter-clear]"),
  tbody: document.querySelector("[data-invoice-ledger-body]"),
  count: document.querySelector("[data-invoice-ledger-count]"),
  total: document.querySelector("[data-invoice-ledger-total]"),
  paid: document.querySelector("[data-invoice-ledger-paid]"),
  debt: document.querySelector("[data-invoice-ledger-debt]"),
  empty: document.querySelector("[data-invoice-ledger-empty]"),
  updated: document.querySelector("[data-invoice-ledger-updated]")
};

let invoiceLedgerRecords = [];
let invoiceLedgerReady = false;

function invoiceLedgerApiFetch(path, options = {}) {
  if (window.ToxApi?.fetch) return window.ToxApi.fetch(path, options);
  const base = window.ToxApi?.baseUrl?.() || `${window.location.origin.includes(":5500") ? "http://127.0.0.1:8765" : ""}/api`;
  return fetch(`${base}${path}`, { credentials: "include", ...options });
}

function invoiceEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function invoiceNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function invoiceMoney(value, state = ToxStore.getState()) {
  const currency = invoiceLedgerEls.currency?.value || state.currency || "IQD";
  return ToxStore.formatMoney(invoiceNumber(value), currency);
}

function invoiceDate(value, state = ToxStore.getState()) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(state.lang === "ar" ? "ar-IQ" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

function invoiceTotal(record) {
  if (record?.isVoided || record?.paymentStatus === "void") return 0;
  return invoiceLedgerIsPurchase ? invoiceNumber(record.costUsd) : invoiceNumber(record.totalUsd || record.subtotalUsd);
}

function invoicePaid(record) {
  return invoiceNumber(record.paidUsd);
}

function invoiceDebt(record) {
  if (record?.isVoided || record?.paymentStatus === "void") return 0;
  return invoiceNumber(record.remainingUsd ?? record.debtUsd);
}

function invoiceItemsText(record) {
  return invoiceItems(record)
    .slice(0, 3)
    .map((item) => [item.productBrand, item.productName || item.name, item.unitName].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" | ") || "-";
}

function invoiceItems(record) {
  if (invoiceLedgerIsPurchase && window.ToxStore?.purchaseItems) return ToxStore.purchaseItems(record);
  return Array.isArray(record.items) ? record.items : [];
}

function invoicePartyName(record, state = ToxStore.getState()) {
  if (invoiceLedgerIsPurchase) {
    const supplier = state.suppliers?.find((entry) => entry.id === record.supplierId);
    return record.supplierName || supplier?.name || record.supplierId || "مورد";
  }
  const client = state.clients?.find((entry) => entry.id === record.clientId);
  return record.customerName || record.clientName || client?.name || record.clientId || "زبون مباشر";
}

function invoiceDisplayTitle(record) {
  if (record.title) return record.title;
  if (record.installmentPlan?.type === "installment") return "فاتورة أقساط";
  return invoiceLedgerIsPurchase ? "فاتورة شراء" : "فاتورة بيع";
}

function invoiceKind(record) {
  if (invoiceLedgerIsPurchase) return "شراء";
  if (record.installmentPlan?.type === "installment" || record.kind === "installment") return "بيع بالأقساط";
  if (record.kind === "direct_pos" || record.type === "direct_pos") {
    return invoiceDebt(record) > 0.0001 ? "بيع مباشر دين" : "بيع مباشر نقدي";
  }
  return "بيع بفاتورة";
}

function invoiceStatusLabel(record) {
  if (record.isVoided || record.paymentStatus === "void") return ["ملغاة", "danger"];
  const debt = invoiceDebt(record);
  const paid = invoicePaid(record);
  if (debt <= 0.0001) return ["مسددة", "success"];
  if (paid > 0) return ["جزئية", "warning"];
  return ["غير مسددة", "danger"];
}

function invoiceVoidReasonMessage(reason, state = ToxStore.getState()) {
  const ar = state.lang === "ar";
  const messages = {
    INVOICE_HAS_DEBT: ar ? "لا يمكن إلغاء فاتورة بيع عليها دين." : "Cannot void a sales invoice with debt.",
    PURCHASE_HAS_DEBT: ar ? "لا يمكن إلغاء فاتورة شراء عليها دين." : "Cannot void a purchase invoice with debt.",
    INVOICE_HAS_INSTALLMENTS: ar ? "لا يمكن إلغاء فاتورة أقساط من سجل الفواتير." : "Cannot void an installment invoice from the ledger.",
    INVOICE_HAS_LINKED_PAYMENTS: ar ? "لا يمكن الإلغاء لأن الفاتورة مرتبطة بدفعات منفصلة." : "Cannot void because linked payments exist.",
    PURCHASE_HAS_LINKED_PAYMENTS: ar ? "لا يمكن الإلغاء لأن فاتورة الشراء مرتبطة بدفعات منفصلة." : "Cannot void because linked payments exist.",
    VOID_STOCK_UNAVAILABLE: ar ? "لا يمكن الإلغاء لأن المخزون الحالي لا يكفي لعكس الشراء." : "Current stock is too low to reverse this purchase.",
    NO_INVOICE: ar ? "الفاتورة غير موجودة." : "Invoice was not found.",
    NO_PURCHASE: ar ? "فاتورة الشراء غير موجودة." : "Purchase invoice was not found."
  };
  return messages[reason] || (ar ? "تعذر إلغاء الفاتورة بأمان." : "Could not void the invoice safely.");
}

function hydrateInvoiceFilters(state) {
  const selectedParty = invoiceLedgerEls.party?.value || "";
  const selectedWarehouse = invoiceLedgerEls.warehouse?.value || "";
  const parties = invoiceLedgerIsPurchase ? state.suppliers : state.clients;
  if (invoiceLedgerEls.party) {
    invoiceLedgerEls.party.innerHTML = `<option value="">${invoiceEscape(invoiceLedgerIsPurchase ? "كل الموردين" : "كل العملاء")}</option>${
      parties.map((party) => `<option value="${invoiceEscape(party.id)}">${invoiceEscape(party.name)}</option>`).join("")
    }`;
    invoiceLedgerEls.party.value = parties.some((party) => party.id === selectedParty) ? selectedParty : "";
  }
  if (invoiceLedgerEls.warehouse) {
    invoiceLedgerEls.warehouse.innerHTML = `<option value="">${invoiceEscape("كل المخازن")}</option>${
      state.warehouses.map((warehouse) => `<option value="${invoiceEscape(warehouse.id)}">${invoiceEscape(warehouse.name)}</option>`).join("")
    }`;
    invoiceLedgerEls.warehouse.value = state.warehouses.some((warehouse) => warehouse.id === selectedWarehouse) ? selectedWarehouse : "";
  }
  if (invoiceLedgerEls.kind) {
    invoiceLedgerEls.kind.closest(".field")?.classList.toggle("hidden", invoiceLedgerIsPurchase);
  }
}

function invoiceQueryString() {
  const params = new URLSearchParams();
  params.set("limit", "300");
  if (!invoiceLedgerIsPurchase) params.set("entityType", "customer");
  const mapping = [
    ["q", invoiceLedgerEls.q],
    [invoiceLedgerIsPurchase ? "supplierId" : "customerId", invoiceLedgerEls.party],
    ["warehouseId", invoiceLedgerEls.warehouse],
    ["paymentStatus", invoiceLedgerEls.status],
    ["kind", invoiceLedgerEls.kind],
    ["currency", invoiceLedgerEls.currency],
    ["minTotal", invoiceLedgerEls.minTotal],
    ["maxTotal", invoiceLedgerEls.maxTotal],
    ["hasDebt", invoiceLedgerEls.hasDebt],
    ["dateFrom", invoiceLedgerEls.dateFrom],
    ["dateTo", invoiceLedgerEls.dateTo]
  ];
  mapping.forEach(([key, element]) => {
    const value = element?.value || "";
    if (value) params.set(key, value);
  });
  return `?${params.toString()}`;
}

function localInvoiceFilter(records, state) {
  const q = (invoiceLedgerEls.q?.value || "").trim().toLowerCase();
  const party = invoiceLedgerEls.party?.value || "";
  const warehouse = invoiceLedgerEls.warehouse?.value || "";
  const status = invoiceLedgerEls.status?.value || "";
  const kind = invoiceLedgerEls.kind?.value || "";
  const minTotal = invoiceNumber(invoiceLedgerEls.minTotal?.value || "");
  const maxTotal = invoiceNumber(invoiceLedgerEls.maxTotal?.value || "");
  const hasDebt = invoiceLedgerEls.hasDebt?.value || "";
  const dateFrom = invoiceLedgerEls.dateFrom?.value ? new Date(invoiceLedgerEls.dateFrom.value) : null;
  const dateTo = invoiceLedgerEls.dateTo?.value ? new Date(invoiceLedgerEls.dateTo.value) : null;

  return records.filter((record) => {
    if (party && (invoiceLedgerIsPurchase ? record.supplierId : record.clientId) !== party) return false;
    if (status && record.paymentStatus !== status) return false;
    if (kind && !invoiceLedgerIsPurchase) {
      const invoiceType = record.installmentPlan?.type === "installment" ? "installment" : (record.kind || record.type || "invoice");
      if (kind === "installment" && invoiceType !== "installment") return false;
      if (kind === "direct_pos" && invoiceType !== "direct_pos") return false;
      if ((kind === "invoice" || kind === "direct") && invoiceType !== "invoice") return false;
    }
    if (warehouse && !invoiceItems(record).some((item) => item.warehouseId === warehouse)) return false;
    const total = invoiceTotal(record);
    if (invoiceLedgerEls.minTotal?.value && total < minTotal) return false;
    if (invoiceLedgerEls.maxTotal?.value && total > maxTotal) return false;
    if (hasDebt === "true" && invoiceDebt(record) <= 0.0001) return false;
    if (hasDebt === "false" && invoiceDebt(record) > 0.0001) return false;
    const created = new Date(record.createdAt || Date.now());
    if (dateFrom && created < dateFrom) return false;
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      if (created > end) return false;
    }
    if (!q) return true;
    const exactBarcodeProducts = ToxStore.exactBarcodeProductMatches?.(q, state.products || []) || [];
    if (exactBarcodeProducts.length) {
      const productIds = new Set(exactBarcodeProducts.map((product) => product.id));
      return invoiceItems(record).some((item) => productIds.has(item.productId));
    }
    const haystack = [
      record.id,
      record.title,
      invoicePartyName(record),
      record.note,
      invoiceKind(record),
      ...invoiceItems(record).flatMap((item) => [
        item.productName,
        item.name,
        item.productBrand,
        item.unitId,
        item.unitName,
        item.warehouseName
      ])
    ].flat().filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

function mergeInvoiceLedgerRecords(remoteRecords, state = ToxStore.getState()) {
  const localRecords = invoiceLedgerIsPurchase ? state.purchases : state.invoices;
  const merged = [];
  const seen = new Set();
  const addRecord = (record) => {
    if (!record || typeof record !== "object") return;
    const id = String(record.id || "").trim();
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    merged.push(record);
  };
  (remoteRecords || []).forEach(addRecord);
  localInvoiceFilter(localRecords || [], state).forEach(addRecord);
  return localInvoiceFilter(merged, state).sort((left, right) => (
    new Date(right.createdAt || 0) - new Date(left.createdAt || 0)
  ));
}

function invoiceShortDate(value, state = ToxStore.getState()) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(state.lang === "ar" ? "ar-IQ" : "en-US");
}

function invoiceItemName(item, state) {
  const product = state.products?.find((entry) => entry.id === item.productId);
  return item.productName || item.name || product?.name || item.productId || "-";
}

function invoiceItemMeta(item, state) {
  const product = state.products?.find((entry) => entry.id === item.productId);
  return [
    item.productBrand || item.brand || product?.brand,
    item.warehouseName || (item.warehouseId && ToxStore.getWarehouseName?.(item.warehouseId)),
    item.barcode
  ].filter(Boolean).join(" | ");
}

function invoiceItemQty(item) {
  return item.qty ?? item.quantity ?? item.cartons ?? "-";
}

function invoiceItemUnit(item) {
  return item.unitName || item.unit || item.unitId || "-";
}

function invoiceItemTotal(item) {
  return invoiceNumber(item.totalUsd ?? item.costUsd ?? item.lineTotalUsd);
}

function invoiceItemPrice(item) {
  const directPrice = item.priceUsd ?? item.unitPriceUsd ?? item.unitCostUsd ?? item.costPriceUsd;
  if (directPrice !== undefined && directPrice !== null && directPrice !== "") return invoiceNumber(directPrice);
  const qty = invoiceNumber(item.qty ?? item.quantity ?? item.cartons);
  return qty > 0 ? invoiceItemTotal(item) / qty : 0;
}

function linkedInvoicePayments(record, state = ToxStore.getState()) {
  const source = invoiceLedgerIsPurchase ? state.supplierPayments : state.clientPayments;
  const key = invoiceLedgerIsPurchase ? "purchaseId" : "invoiceId";
  return (source || []).flatMap((payment) => {
    const appliedRows = (payment.appliedTo || []).filter((item) => item[key] === record.id);
    if (!appliedRows.length && payment[key] !== record.id) return [];
    const rows = appliedRows.length ? appliedRows : [{ [key]: record.id, amountUsd: payment.amountUsd }];
    return rows.map((item) => ({
      id: payment.id || "-",
      amountUsd: invoiceNumber(item.amountUsd ?? payment.amountUsd),
      date: payment.receivedAt || payment.paidAt || payment.createdAt,
      note: payment.note || "",
      kind: payment.paymentKind || (item.installmentNumber ? "installment" : "payment"),
      installmentNumber: item.installmentNumber || ""
    }));
  }).sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0));
}

function invoicePaymentRows(record, state = ToxStore.getState()) {
  const linked = linkedInvoicePayments(record, state);
  if (linked.length) return linked;
  const paid = invoicePaid(record);
  if (paid <= 0.0001) return [];
  return [{
    id: record.initialPaymentId || "-",
    amountUsd: paid,
    date: record.createdAt,
    note: "دفع عند الإنشاء",
    kind: record.installmentPlan?.type === "installment" ? "down_payment" : "payment",
    installmentNumber: ""
  }];
}

function invoiceInstallmentStatus(item, state = ToxStore.getState()) {
  const amount = invoiceNumber(item.amountUsd);
  const paid = invoiceNumber(item.paidUsd);
  if (item.status === "paid" || paid >= amount - 0.0001) return ["مدفوع", "success"];
  if (paid > 0) return ["جزئي", "warning"];
  if (item.dueDate) {
    const due = new Date(item.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!Number.isNaN(due.getTime()) && due < today) return ["متأخر", "danger"];
  }
  return [state.lang === "ar" ? "مستحق" : "Due", "neutral"];
}

function invoiceVoidBlockReason(record, state = ToxStore.getState()) {
  if (invoiceDebt(record) > 0.0001) return invoiceLedgerIsPurchase ? "PURCHASE_HAS_DEBT" : "INVOICE_HAS_DEBT";
  if (!invoiceLedgerIsPurchase && record.installmentPlan?.type === "installment") return "INVOICE_HAS_INSTALLMENTS";
  if (invoiceLedgerIsPurchase && window.ToxStore?.baseToStorageQuantity) {
    const stockUnavailable = invoiceItems(record).some((item) => {
      const product = state.products?.find((entry) => entry.id === item.productId);
      if (!product) return false;
      const delta = ToxStore.baseToStorageQuantity(product, item.qtyInBase);
      return invoiceNumber(product.stockQuantity) < delta - 0.0001;
    });
    if (stockUnavailable) return "VOID_STOCK_UNAVAILABLE";
  }
  return "";
}

function renderLedgerProductRows(record, state) {
  return invoiceItems(record).map((item, index) => {
    const meta = invoiceItemMeta(item, state);
    return `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${invoiceEscape(invoiceItemName(item, state))}</strong>${meta ? `<small>${invoiceEscape(meta)}</small>` : ""}</td>
        <td>${invoiceEscape(invoiceItemQty(item))}</td>
        <td>${invoiceEscape(invoiceItemUnit(item))}</td>
        <td>${invoiceMoney(invoiceItemPrice(item), state)}</td>
        <td><strong>${invoiceMoney(invoiceItemTotal(item), state)}</strong></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">لا توجد منتجات في هذه الفاتورة.</td></tr>`;
}

function renderLedgerInstallments(record, state) {
  const plan = record.installmentPlan;
  if (!plan || plan.type !== "installment") return "";
  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  const guarantorName = plan.guarantorName || record.guarantorName || "";
  const guarantorPhone = plan.guarantorPhone || record.guarantorPhone || "";
  return `
    <section class="ledger-detail-section">
      <div class="ledger-detail-section-title">
        <h3>خطة الأقساط</h3>
        <span>${schedule.length} قسط</span>
      </div>
      ${(guarantorName || guarantorPhone) ? `
        <div class="ledger-guarantor-card">
          <span>الكفيل</span>
          <strong>${invoiceEscape(guarantorName || "-")}</strong>
          <small>${invoiceEscape(guarantorPhone || "-")}</small>
        </div>
      ` : ""}
      <div class="ledger-detail-table-wrap">
        <table class="ledger-detail-table compact">
          <thead><tr><th>القسط</th><th>الاستحقاق</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
          <tbody>${schedule.map((item) => {
            const [label, tone] = invoiceInstallmentStatus(item, state);
            const amount = invoiceNumber(item.amountUsd);
            const paid = invoiceNumber(item.paidUsd);
            return `
              <tr>
                <td>${invoiceEscape(item.number || "-")}</td>
                <td>${invoiceShortDate(item.dueDate, state)}</td>
                <td>${invoiceMoney(amount, state)}</td>
                <td>${invoiceMoney(paid, state)}</td>
                <td>${invoiceMoney(Math.max(0, amount - paid), state)}</td>
                <td><span class="ledger-status ${tone}">${invoiceEscape(label)}</span></td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="6">لا توجد أقساط مجدولة.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderLedgerPayments(record, state) {
  const payments = invoicePaymentRows(record, state);
  return `
    <section class="ledger-detail-section">
      <div class="ledger-detail-section-title">
        <h3>سجل التسديدات</h3>
        <span>${payments.length} حركة</span>
      </div>
      <div class="ledger-detail-table-wrap">
        <table class="ledger-detail-table compact">
          <thead><tr><th>التاريخ</th><th>المبلغ</th><th>النوع</th><th>ملاحظات</th></tr></thead>
          <tbody>${payments.map((payment) => `
            <tr>
              <td>${invoiceShortDate(payment.date, state)}</td>
              <td><strong class="success-text">${invoiceMoney(payment.amountUsd, state)}</strong></td>
              <td>${payment.installmentNumber ? `قسط ${invoiceEscape(payment.installmentNumber)}` : invoiceEscape(payment.kind === "down_payment" ? "دفعة أولى" : "دفعة")}</td>
              <td>${invoiceEscape(payment.note || payment.id || "-")}</td>
            </tr>
          `).join("") || `<tr><td colspan="4">لا توجد تسديدات مسجلة لهذه الفاتورة.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderLedgerDetailModal(record, state = ToxStore.getState()) {
  const [statusLabel, statusTone] = invoiceStatusLabel(record);
  const blockReason = invoiceVoidBlockReason(record, state);
  const canShowVoid = !(record.isVoided || record.paymentStatus === "void");
  const voidTitle = blockReason ? invoiceVoidReasonMessage(blockReason, state) : "إلغاء آمن مع عكس حركة المخزون";
  return `
    <div class="ledger-detail-backdrop" data-close-ledger-detail></div>
    <section class="ledger-detail-modal" role="dialog" aria-modal="true" aria-label="تفاصيل الفاتورة">
      <header class="ledger-detail-header">
        <div>
          <span class="ledger-detail-kind">${invoiceEscape(invoiceKind(record))}</span>
          <h2>${invoiceEscape(record.id)}</h2>
          <p>${invoiceEscape(invoiceDisplayTitle(record))} - ${invoiceDate(record.createdAt, state)}</p>
        </div>
        <button class="button ghost compact-action" type="button" data-close-ledger-detail>إغلاق</button>
      </header>
      <div class="ledger-detail-actions">
        <button class="button primary compact-action" type="button" data-modal-print-ledger-invoice="${invoiceEscape(record.id)}">طباعة</button>
        ${canShowVoid ? `<button class="button ghost danger-action compact-action" type="button" data-modal-void-ledger-invoice="${invoiceEscape(record.id)}" ${blockReason ? "disabled" : ""} title="${invoiceEscape(voidTitle)}">إلغاء</button>` : ""}
      </div>
      <section class="ledger-detail-summary">
        <div><span>${invoiceLedgerIsPurchase ? "المورد" : "العميل"}</span><strong>${invoiceEscape(invoicePartyName(record, state))}</strong></div>
        <div><span>الحالة</span><strong><span class="ledger-status ${statusTone}">${invoiceEscape(statusLabel)}</span></strong></div>
        <div><span>الإجمالي</span><strong>${invoiceMoney(invoiceTotal(record), state)}</strong></div>
        <div><span>المدفوع</span><strong class="success-text">${invoiceMoney(invoicePaid(record), state)}</strong></div>
        <div><span>المتبقي</span><strong class="${invoiceDebt(record) > 0.0001 ? "danger-text" : "success-text"}">${invoiceMoney(invoiceDebt(record), state)}</strong></div>
        <div><span>عدد المنتجات</span><strong>${invoiceItems(record).length}</strong></div>
      </section>
      <section class="ledger-detail-section">
        <div class="ledger-detail-section-title">
          <h3>تفاصيل المنتجات</h3>
          <span>${invoiceItems(record).length} صنف</span>
        </div>
        <div class="ledger-detail-table-wrap">
          <table class="ledger-detail-table">
            <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الوحدة</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>${renderLedgerProductRows(record, state)}</tbody>
          </table>
        </div>
      </section>
      ${renderLedgerInstallments(record, state)}
      ${renderLedgerPayments(record, state)}
    </section>
  `;
}

function closeLedgerDetailModal() {
  document.querySelector("[data-ledger-detail-root]")?.remove();
}

function openLedgerInvoiceDetail(record, state = ToxStore.getState()) {
  if (!record) return;
  closeLedgerDetailModal();
  const root = document.createElement("div");
  root.dataset.ledgerDetailRoot = "true";
  root.className = "ledger-detail-root";
  root.innerHTML = renderLedgerDetailModal(record, state);
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-ledger-detail]").forEach((button) => {
    button.addEventListener("click", closeLedgerDetailModal);
  });
  root.querySelector("[data-modal-print-ledger-invoice]")?.addEventListener("click", () => {
    const current = invoiceLedgerRecords.find((entry) => entry.id === record.id) || record;
    printLedgerInvoice(current, ToxStore.getState());
  });
  root.querySelector("[data-modal-void-ledger-invoice]")?.addEventListener("click", async () => {
    const current = invoiceLedgerRecords.find((entry) => entry.id === record.id) || record;
    const ok = await voidLedgerInvoice(current);
    if (ok) closeLedgerDetailModal();
  });
}

function renderInvoiceLedger(records, state = ToxStore.getState()) {
  const total = records.reduce((sum, record) => sum + invoiceTotal(record), 0);
  const paid = records.reduce((sum, record) => sum + invoicePaid(record), 0);
  const debt = records.reduce((sum, record) => sum + invoiceDebt(record), 0);
  if (invoiceLedgerEls.count) invoiceLedgerEls.count.textContent = records.length;
  if (invoiceLedgerEls.total) invoiceLedgerEls.total.textContent = invoiceMoney(total, state);
  if (invoiceLedgerEls.paid) invoiceLedgerEls.paid.textContent = invoiceMoney(paid, state);
  if (invoiceLedgerEls.debt) invoiceLedgerEls.debt.textContent = invoiceMoney(debt, state);
  if (invoiceLedgerEls.updated) invoiceLedgerEls.updated.textContent = new Date().toLocaleTimeString(state.lang === "ar" ? "ar-IQ" : "en-US", { hour: "2-digit", minute: "2-digit" });
  if (invoiceLedgerEls.empty) invoiceLedgerEls.empty.hidden = records.length > 0;
  if (!invoiceLedgerEls.tbody) return;

  invoiceLedgerEls.tbody.innerHTML = records.map((record) => {
    const [statusLabel, tone] = invoiceStatusLabel(record);
    return `
      <tr>
        <td><strong>${invoiceEscape(record.id)}</strong><small>${invoiceDate(record.createdAt, state)}</small></td>
        <td><strong>${invoiceEscape(invoicePartyName(record, state))}</strong><small>${invoiceEscape(invoiceItemsText(record))}</small></td>
        <td>${invoiceEscape(invoiceKind(record))}</td>
        <td><span class="ledger-status ${tone}">${invoiceEscape(statusLabel)}</span></td>
        <td><strong>${invoiceMoney(invoiceTotal(record), state)}</strong></td>
        <td>${invoiceMoney(invoicePaid(record), state)}</td>
        <td><strong class="${invoiceDebt(record) > 0.0001 ? "danger-text" : "success-text"}">${invoiceMoney(invoiceDebt(record), state)}</strong></td>
        <td><div class="invoice-row-actions"><button class="button primary" type="button" data-view-ledger-invoice="${invoiceEscape(record.id)}">عرض</button></div></td>
      </tr>
    `;
  }).join("") || `<tr class="invoice-empty-row"><td colspan="8">لا توجد فواتير مطابقة.</td></tr>`;

  invoiceLedgerEls.tbody.querySelectorAll("[data-view-ledger-invoice]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = invoiceLedgerRecords.find((entry) => entry.id === button.dataset.viewLedgerInvoice);
      if (record) openLedgerInvoiceDetail(record, ToxStore.getState());
    });
  });
}

function ledgerPrintHtml(record, state) {
  const rows = invoiceItems(record).map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${invoiceEscape(item.productName || item.name || "-")}</strong><small>${invoiceEscape([item.productBrand, item.warehouseName].filter(Boolean).join(" | "))}</small></td>
      <td>${invoiceEscape(item.qty || item.quantity || "-")}</td>
      <td>${invoiceEscape(item.unitName || "-")}</td>
      <td>${invoiceMoney(item.priceUsd || item.unitCostUsd || 0, state)}</td>
      <td>${invoiceMoney(item.totalUsd || 0, state)}</td>
    </tr>
  `).join("");
  return `<!doctype html><html lang="${state.lang}" dir="${state.dir || "rtl"}"><head><meta charset="utf-8"><title>${invoiceEscape(record.id)}</title>
  <style>
    body{margin:0;padding:28px;background:#eef2f7;color:#0f172a;font-family:"Segoe UI",Tahoma,Arial,sans-serif}
    main{max-width:1000px;margin:auto;background:#fff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden}
    header{display:flex;justify-content:space-between;gap:18px;padding:28px 32px;background:#0f172a;color:#fff}
    h1,p{margin:0} header p{margin-top:6px;color:#cbd5e1}.badge{text-align:end}.badge strong{display:block;font-size:24px}
    section{padding:22px 32px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e2e8f0;padding:0}
    .meta div{background:#f8fafc;padding:14px}.meta span,small{color:#64748b}.meta strong,td strong{display:block}
    table{width:100%;border-collapse:collapse;border:1px solid #e2e8f0}th,td{padding:12px;border-bottom:1px solid #e2e8f0;text-align:start}th{background:#f8fafc;color:#475569}
    .totals{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.totals div{padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}
    @media print{body{padding:0;background:#fff}main{border:0;border-radius:0}}
  </style></head><body><main>
    <header><div><h1>${invoiceEscape(ToxStore.businessProfileName?.(state) || state.businessName || "TOX")}</h1><p>${invoiceEscape(ToxStore.businessProfileLine?.(state, invoiceDisplayTitle(record)) || invoiceDisplayTitle(record))}</p></div><div class="badge"><span>${invoiceEscape(invoiceDisplayTitle(record))}</span><strong>${invoiceEscape(record.id)}</strong><p>${invoiceDate(record.createdAt, state)}</p></div></header>
    <section class="meta"><div><span>${invoiceLedgerIsPurchase ? "المورد" : "العميل"}</span><strong>${invoiceEscape(invoicePartyName(record))}</strong></div><div><span>النوع</span><strong>${invoiceEscape(invoiceKind(record))}</strong></div><div><span>الحالة</span><strong>${invoiceEscape(invoiceStatusLabel(record)[0])}</strong></div><div><span>العناصر</span><strong>${invoiceItems(record).length}</strong></div></section>
    <section><table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows || `<tr><td colspan="6">لا توجد عناصر</td></tr>`}</tbody></table>
    <div class="totals"><div><span>الإجمالي</span><strong>${invoiceMoney(invoiceTotal(record), state)}</strong></div><div><span>المدفوع</span><strong>${invoiceMoney(invoicePaid(record), state)}</strong></div><div><span>المتبقي</span><strong>${invoiceMoney(invoiceDebt(record), state)}</strong></div></div></section>
  </main></body></html>`;
}

function printLedgerInvoice(record, state) {
  if (window.ToxPrint?.render) {
    ToxPrint.render(invoiceLedgerIsPurchase ? "purchaseInvoice" : "saleInvoice", record, state);
    return;
  }
  const printWindow = window.open("", "_blank", "width=1100,height=780");
  if (!printWindow) return;
  printWindow.document.write(ledgerPrintHtml(record, state));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  playUiSound?.("print");
}

async function voidLedgerInvoice(record) {
  const state = ToxStore.getState();
  if (invoiceDebt(record) > 0.0001) {
    showNotice?.(state.lang === "ar" ? "لا يمكن إلغاء فاتورة عليها دين." : "Cannot void an invoice with debt.", "error");
    return false;
  }
  const confirmed = window.confirm(
    state.lang === "ar"
      ? "سيتم إلغاء الفاتورة وعكس حركة المخزون. هل تريد المتابعة؟"
      : "Void this invoice and reverse stock?"
  );
  if (!confirmed) return false;
  try {
    const response = await invoiceLedgerApiFetch(`${invoiceLedgerEndpoint}${encodeURIComponent(record.id)}/`, {
      method: "DELETE",
      body: JSON.stringify({ reason: "voided from invoice ledger" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.reason || `VOID_FAILED_${response.status}`);
      error.reason = payload.reason || "";
      throw error;
    }
    if (invoiceLedgerIsPurchase) {
      ToxStore.voidPurchase?.(record.id, "voided from invoice ledger");
    } else {
      ToxStore.voidInvoice?.(record.id, "voided from invoice ledger");
    }
    showNotice?.(state.lang === "ar" ? "تم إلغاء الفاتورة بأمان." : "Invoice voided safely.", "success");
    loadInvoiceLedger();
    return true;
  } catch (error) {
    console.warn("Could not void invoice", error);
    showNotice?.(invoiceVoidReasonMessage(error.reason || error.message, state), "error");
    return false;
  }
}

async function loadInvoiceLedger() {
  const state = ToxStore.getState();
  invoiceLedgerEls.apply?.setAttribute("disabled", "disabled");
  try {
    const separator = invoiceQueryString().includes("?") ? "&" : "?";
    const response = await invoiceLedgerApiFetch(`${invoiceLedgerEndpoint}${invoiceQueryString()}${separator}_refresh=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" }
    });
    if (!response.ok) throw new Error(`Invoice load failed: ${response.status}`);
    const payload = await response.json();
    invoiceLedgerRecords = mergeInvoiceLedgerRecords(payload[invoiceLedgerKey] || payload.invoices || payload.results || [], state);
  } catch (error) {
    console.warn("Invoice ledger backend unavailable; using local state.", error);
    const localRecords = invoiceLedgerIsPurchase ? state.purchases : state.invoices;
    invoiceLedgerRecords = localInvoiceFilter(localRecords || [], state);
  } finally {
    renderInvoiceLedger(invoiceLedgerRecords, ToxStore.getState());
    invoiceLedgerEls.apply?.removeAttribute("disabled");
  }
}

function clearInvoiceFilters() {
  [
    invoiceLedgerEls.q,
    invoiceLedgerEls.party,
    invoiceLedgerEls.warehouse,
    invoiceLedgerEls.status,
    invoiceLedgerEls.kind,
    invoiceLedgerEls.currency,
    invoiceLedgerEls.minTotal,
    invoiceLedgerEls.maxTotal,
    invoiceLedgerEls.hasDebt,
    invoiceLedgerEls.dateFrom,
    invoiceLedgerEls.dateTo
  ].forEach((element) => {
    if (element) element.value = "";
  });
  loadInvoiceLedger();
}

invoiceLedgerEls.apply?.addEventListener("click", loadInvoiceLedger);
invoiceLedgerEls.clear?.addEventListener("click", clearInvoiceFilters);
[
  invoiceLedgerEls.q,
  invoiceLedgerEls.party,
  invoiceLedgerEls.warehouse,
  invoiceLedgerEls.status,
  invoiceLedgerEls.kind,
  invoiceLedgerEls.currency,
  invoiceLedgerEls.hasDebt,
  invoiceLedgerEls.dateFrom,
  invoiceLedgerEls.dateTo
].forEach((element) => {
  element?.addEventListener("change", loadInvoiceLedger);
});
invoiceLedgerEls.q?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadInvoiceLedger();
});

ToxStore.subscribe((state) => {
  hydrateInvoiceFilters(state);
  if (!invoiceLedgerReady) {
    invoiceLedgerReady = true;
    loadInvoiceLedger();
  } else {
    renderInvoiceLedger(invoiceLedgerRecords, state);
  }
});

// Re-fetch after returning from a sale so newly saved invoices and their line
// products are visible immediately without requiring a hard browser refresh.
window.addEventListener("focus", () => loadInvoiceLedger());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadInvoiceLedger();
});
