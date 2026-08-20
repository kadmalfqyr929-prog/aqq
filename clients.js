let activeClientId = "";
let activeClientTab = "overview";
let selectedInvoiceId = "";
let invoicePage = 1;
let paymentPage = 1;
let statementPage = 1;
let accountLogFilter = "all";

const PAGE_SIZE = 12;
const PAYMENT_PAGE_SIZE = 10;
const STATEMENT_PAGE_SIZE = 14;

const clientList = document.querySelector("[data-client-list]");
const profile = document.querySelector("[data-client-profile]");
const clientForm = document.querySelector("[data-client-form]");
const clientSearch = document.querySelector("[data-client-search]");

function clientFromHash() {
  const match = location.hash.match(/client=([^&]+)/);
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

function localeFor(state) {
  return state.lang === "ar" ? "ar-IQ" : "en-US";
}

function formatDate(value, state) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString(localeFor(state));
}

function money(value, state) {
  return ToxStore.formatMoney(number(value), state.currency);
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

function productForItem(item, state) {
  const productId = String(item.productId || item.id || "").trim();
  if (!productId) return null;
  return state.products.find((product) => product.id === productId) || null;
}

function productNameForItem(item, state) {
  const product = productForItem(item, state);
  const candidates = [
    item.productName,
    item.name,
    product?.name
  ].map(cleanText).filter((value) => value && !looksLikeProductId(value, item));
  return candidates[0] || unknownProductLabel;
}

function productMetaForItem(item, state) {
  const product = productForItem(item, state);
  const parts = [
    cleanText(item.unitName || ""),
    cleanText(item.productBrand || item.brand || product?.brand || ""),
  ].filter((value) => value && !looksLikeProductId(value, item));
  return [...new Set(parts)].join(" / ");
}

function dateTime(value, state) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? formatDate(value, state) : date.toLocaleString(localeFor(state));
}

function clientNameForInvoice(invoice, state) {
  return state.clients.find((client) => client.id === invoice.clientId)?.name || invoice.customerName || "زبون مباشر";
}

function openPrintWindow(html) {
  const printWindow = window.open("", "_blank", "width=1120,height=820");
  if (!printWindow) {
    showNotice("تعذر فتح نافذة الطباعة", "error");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  if (typeof playUiSound === "function") playUiSound("print");
}

function printThemeClass(state) {
  if (state.theme === "coffee" || state.theme === "summer-orange") return "coffee-print";
  if (state.theme === "neon-blue") return "neon-print";
  if (state.theme === "teal-slate") return "teal-print";
  return "";
}

function printDocumentStyles(state) {
  const isArabic = state.lang === "ar";
  return `
    *{box-sizing:border-box}
    body{margin:0;padding:28px;background:#eef2f7;color:#0f172a;font-family:"Segoe UI","Noto Kufi Arabic",Tahoma,Arial,sans-serif}
    .sheet{max-width:1040px;margin:auto;background:#fff;border:1px solid #dbe3ee;border-radius:10px;overflow:hidden;box-shadow:0 28px 90px rgba(15,23,42,.14)}
    .hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px;align-items:center;padding:30px 34px;background:linear-gradient(135deg,#07111f,#0f766e 55%,#b89239);color:white}
    .brand{display:flex;gap:16px;align-items:center}.mark{width:58px;height:58px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);font-weight:950}
    h1,h2,h3,p{margin:0}.brand h1{font-size:31px;line-height:1.05}.brand p,.badge span{color:rgba(255,255,255,.78);margin-top:5px}
    .badge{min-width:260px;text-align:${isArabic ? "left" : "right"};padding:16px 18px;border-radius:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.24)}
    .badge strong{display:block;margin-top:4px;font-size:24px}.status{display:inline-flex;margin-top:9px;min-height:28px;align-items:center;padding:0 10px;border-radius:999px;background:rgba(255,255,255,.16);font-weight:900}
    .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:#e2e8f0;border-bottom:1px solid #e2e8f0}.summary div{padding:15px 18px;background:#f8fafc}.summary span,.totals span,small{color:#64748b}.summary strong,.totals strong{display:block;margin-top:4px}
    .content{padding:28px 34px}.section-title{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:12px}h2{font-size:18px}
    table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #dbe3ee;border-radius:8px;overflow:hidden}th,td{padding:12px;border-bottom:1px solid #e5e7eb;text-align:${isArabic ? "right" : "left"};vertical-align:top}th{background:#f8fafc;color:#475569;font-size:12px}tr:last-child td{border-bottom:0}tbody tr:nth-child(even) td{background:#fbfdff}
    .footer{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.42fr);gap:24px;margin-top:22px;align-items:start}.note{min-height:128px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;padding:16px;color:#64748b}
    .totals{border:1px solid #dbe3ee;border-radius:8px;overflow:hidden}.row{display:flex;justify-content:space-between;gap:18px;padding:13px 15px;border-bottom:1px solid #e5e7eb}.row:last-child{border-bottom:0}.grand{background:#f8fafc}.grand strong{font-size:24px}.paid strong{color:#047857}.debt strong{color:#dc2626}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px;color:#64748b}.signatures div{padding-top:20px;border-top:1px solid #cbd5e1}
    @media print{body{padding:0;background:white}.sheet{box-shadow:none;border:0;border-radius:0}.hero{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    body.coffee-print{background:#efe3d1;color:#211711}
    body.coffee-print .sheet{background:#fff8ed;border-color:#d8b98a;box-shadow:0 28px 90px rgba(33,23,17,.16)}
    body.coffee-print .hero{background:linear-gradient(135deg,#140f0b,#211711 58%,#8b542f);color:#fff8ed}
    body.coffee-print .mark{border-color:rgba(246,199,108,.38);background:rgba(246,199,108,.14)}
    body.coffee-print .summary{background:#d8b98a}.coffee-print .summary div,.coffee-print th,.coffee-print .grand{background:#fff3df}
    body.coffee-print .note{background:#fff3df;border-color:#d8b98a;color:#6f4528}
    body.coffee-print .grand strong{color:#6f4528}
    body.neon-print{background:#e8f3ff;color:#071124}
    body.neon-print .sheet{background:#f8fbff;border-color:#b9d8f0;box-shadow:0 28px 90px rgba(7,17,36,.16)}
    body.neon-print .hero{background:linear-gradient(135deg,#030716,#2323ff 58%,#22d3ee);color:#f8fbff}
    body.neon-print .mark{border-color:rgba(74,211,255,.42);background:rgba(74,211,255,.16)}
    body.neon-print .summary{background:#b9d8f0}.neon-print .summary div,.neon-print th,.neon-print .grand{background:#eef8ff}
    body.neon-print .note{background:#eef8ff;border-color:#b9d8f0;color:#155e75}
    body.neon-print .grand strong{color:#1d4ed8}
    body.teal-print{background:#eaf8f8;color:#102a2e}
    body.teal-print .sheet{background:#ffffff;border-color:#b8dada;box-shadow:0 28px 90px rgba(5,118,118,.14)}
    body.teal-print .hero{background:linear-gradient(135deg,#102a2e,#057676 58%,#13d4d4);color:#ffffff}
    body.teal-print .mark{border-color:rgba(19,212,212,.38);background:rgba(19,212,212,.16)}
    body.teal-print .summary{background:#b8dada}.teal-print .summary div,.teal-print th,.teal-print .grand{background:#effafa}
    body.teal-print .note{background:#effafa;border-color:#b8dada;color:#057676}
    body.teal-print .grand strong{color:#057676}
  `;
}

function invoicePrintHtml(state, invoice) {
  const status = invoiceStatus(invoice);
  const clientName = clientNameForInvoice(invoice, state);
  const rows = invoiceItems(invoice).map((item, index) => {
    const meta = productMetaForItem(item, state);
    return `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(productNameForItem(item, state))}</strong>${meta ? `<br><small>${escapeHtml(meta)}</small>` : ""}</td>
        <td>${escapeHtml(item.qty ?? item.quantity ?? 0)}</td>
        <td>${money(item.priceUsd, state)}</td>
        <td>${money(item.discountUsd, state)}</td>
        <td><strong>${money(item.totalUsd, state)}</strong></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">لا توجد منتجات داخل هذه الفاتورة</td></tr>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(invoice.id)}</title><style>${printDocumentStyles(state)}</style></head><body class="${printThemeClass(state)}">
    <main class="sheet">
      <section class="hero">
        <div class="brand"><div class="mark">TOX</div><div><h1>${escapeHtml(ToxStore.businessProfileName?.(state) || state.businessName || "TOX")}</h1><p>${escapeHtml(ToxStore.businessProfileLine?.(state, "فاتورة بيع رسمية") || "فاتورة بيع رسمية")}</p></div></div>
        <div class="badge"><span>${escapeHtml(invoiceKindLabel(invoice))}</span><strong>${escapeHtml(invoice.id)}</strong><p>${dateTime(invoice.createdAt, state)}</p><i class="status">${escapeHtml(status.label)}</i></div>
      </section>
      <section class="summary">
        <div><span>العميل</span><strong>${escapeHtml(clientName)}</strong></div>
        <div><span>الإجمالي</span><strong>${money(ToxStore.invoiceNet(invoice), state)}</strong></div>
        <div><span>المدفوع</span><strong>${money(invoice.paidUsd, state)}</strong></div>
        <div><span>المتبقي</span><strong>${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
      </section>
      <section class="content">
        <div class="section-title"><h2>تفاصيل المنتجات</h2><small>${invoiceItems(invoice).length} مادة</small></div>
        <table><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
        <section class="footer">
          <div class="note">${escapeHtml(invoice.note || "يرجى الاحتفاظ بالفاتورة للمراجعة والضمان. شكرا لتعاملكم معنا.")}</div>
          <div class="totals">
            <div class="row"><span>المجموع</span><strong>${money(invoice.subtotalUsd, state)}</strong></div>
            <div class="row"><span>الخصم</span><strong>${money(invoice.discountUsd, state)}</strong></div>
            <div class="row grand"><span>الصافي</span><strong>${money(ToxStore.invoiceNet(invoice), state)}</strong></div>
            <div class="row paid"><span>المدفوع</span><strong>${money(invoice.paidUsd, state)}</strong></div>
            <div class="row debt"><span>المتبقي</span><strong>${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
          </div>
        </section>
        <section class="signatures"><div>توقيع العميل</div><div>توقيع الموظف</div></section>
      </section>
    </main>
  </body></html>`;
}

function receiptPrintHtml(state, invoice) {
  const payments = state.clientPayments.filter((payment) => (payment.appliedTo || []).some((item) => item.invoiceId === invoice.id));
  const lastPayment = payments[0];
  const amount = lastPayment ? lastPayment.amountUsd : Math.max(0, number(invoice.paidUsd));
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>وصل ${escapeHtml(invoice.id)}</title><style>${printDocumentStyles(state)}</style></head><body class="${printThemeClass(state)}">
    <main class="sheet">
      <section class="hero"><div class="brand"><div class="mark">TOX</div><div><h1>${escapeHtml(ToxStore.businessProfileName?.(state) || state.businessName || "TOX")}</h1><p>${escapeHtml(ToxStore.businessProfileLine?.(state, "وصل استلام دفعة") || "وصل استلام دفعة")}</p></div></div><div class="badge"><span>وصل قبض</span><strong>${escapeHtml(lastPayment?.id || invoice.id)}</strong><p>${dateTime(lastPayment?.receivedAt || new Date(), state)}</p></div></section>
      <section class="summary">
        <div><span>العميل</span><strong>${escapeHtml(clientNameForInvoice(invoice, state))}</strong></div>
        <div><span>رقم الفاتورة</span><strong>${escapeHtml(invoice.id)}</strong></div>
        <div><span>مبلغ الوصل</span><strong>${money(amount, state)}</strong></div>
        <div><span>المتبقي بعد الدفع</span><strong>${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
      </section>
      <section class="content">
        <div class="note">${escapeHtml(lastPayment?.note || "وصل قبض مرتبط بالفاتورة أعلاه.")}</div>
        <section class="signatures"><div>توقيع المستلم</div><div>توقيع العميل</div></section>
      </section>
    </main>
  </body></html>`;
}

function statementPrintHtml(state, client) {
  const rows = statementRows(client, state);
  const totalDebit = rows.reduce((sum, row) => sum + number(row.debit), 0);
  const totalCredit = rows.reduce((sum, row) => sum + number(row.credit), 0);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف ${escapeHtml(client.name)}</title><style>${printDocumentStyles(state)}</style></head><body class="${printThemeClass(state)}">
    <main class="sheet">
      <section class="hero"><div class="brand"><div class="mark">TOX</div><div><h1>${escapeHtml(ToxStore.businessProfileName?.(state) || state.businessName || "TOX")}</h1><p>${escapeHtml(ToxStore.businessProfileLine?.(state, "كشف حساب عميل") || "كشف حساب عميل")}</p></div></div><div class="badge"><span>كشف الحساب</span><strong>${escapeHtml(client.name)}</strong><p>${dateTime(new Date(), state)}</p></div></section>
      <section class="summary"><div><span>المدين</span><strong>${money(totalDebit, state)}</strong></div><div><span>الدائن</span><strong>${money(totalCredit, state)}</strong></div><div><span>الرصيد</span><strong>${money(Math.max(0, totalDebit - totalCredit), state)}</strong></div><div><span>عدد الحركات</span><strong>${rows.length}</strong></div></section>
      <section class="content"><table><thead><tr><th>التاريخ</th><th>الحركة</th><th>النوع</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${formatDate(row.date, state)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.type)}</td><td>${row.debit ? money(row.debit, state) : "-"}</td><td>${row.credit ? money(row.credit, state) : "-"}</td></tr>`).join("") || `<tr><td colspan="5">لا توجد حركات</td></tr>`}</tbody></table></section>
    </main>
  </body></html>`;
}

function initials(name) {
  return String(name || "ع").trim().charAt(0).toUpperCase();
}

function clientInvoices(clientId, state) {
  return state.invoices
    .filter((invoice) => invoice.clientId === clientId)
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
}

function clientPayments(clientId, state) {
  return state.clientPayments
    .filter((payment) => payment.clientId === clientId)
    .sort((left, right) => new Date(right.receivedAt || right.createdAt || 0) - new Date(left.receivedAt || left.createdAt || 0));
}

function invoiceItems(invoice) {
  return Array.isArray(invoice.items) ? invoice.items : [];
}

function invoiceSchedule(invoice) {
  return invoice.installmentPlan?.schedule || [];
}

function isInstallmentInvoice(invoice) {
  return invoice.installmentPlan?.type === "installment";
}

function normalizedInvoiceKind(invoice = {}) {
  if (isInstallmentInvoice(invoice)) return "installment";
  const rawKind = String(invoice.kind || invoice.type || "").trim().toLowerCase().replace(/-/g, "_");
  if (["direct_pos", "pos", "directpos", "quick_sale", "quick"].includes(rawKind)) return "direct_pos";
  if (["direct", "direct_sale", "cash", "cash_sale"].includes(rawKind)) return "direct";
  return "invoice";
}

function invoiceTypeMeta(invoice) {
  const kind = normalizedInvoiceKind(invoice);
  const debt = number(ToxStore.invoiceDebt(invoice));
  if (kind === "installment") return { key: "installment", label: "بيع بالأقساط", tone: "violet" };
  if (kind === "direct_pos" || kind === "direct") {
    return {
      key: kind,
      label: debt > 0.0001 ? "بيع مباشر دين" : "بيع مباشر نقدي",
      tone: debt > 0.0001 ? "warning" : "success"
    };
  }
  return { key: "invoice", label: "بيع بفاتورة", tone: debt > 0.0001 ? "warning" : "info" };
}

function directClientInvoices(clientId, state) {
  return clientInvoices(clientId, state).filter((invoice) => !isInstallmentInvoice(invoice));
}

function directClientDebt(clientId, state) {
  return directClientInvoices(clientId, state).reduce((sum, invoice) => sum + ToxStore.invoiceDebt(invoice), 0);
}

function installmentClientInvoices(clientId, state) {
  return clientInvoices(clientId, state).filter(isInstallmentInvoice);
}

function invoiceProductTitle(invoice, state) {
  const names = invoiceItems(invoice).map((item) => productNameForItem(item, state)).filter(Boolean);
  return [...new Set(names)].join(" + ") || invoice.id;
}

function installmentPlanMetrics(invoice) {
  const schedule = invoiceSchedule(invoice);
  const paidCount = schedule.filter(installmentPaid).length;
  const totalCount = schedule.length;
  const paidUsd = schedule.reduce((sum, item) => sum + number(item.paidUsd), 0);
  const scheduledUsd = schedule.reduce((sum, item) => sum + number(item.amountUsd), 0);
  const next = schedule
    .filter((item) => !installmentPaid(item))
    .sort((left, right) => new Date(left.dueDate || 0) - new Date(right.dueDate || 0))[0];
  const progress = totalCount ? Math.round((paidCount / totalCount) * 100) : 100;
  return { schedule, paidCount, totalCount, paidUsd, scheduledUsd, next, progress };
}

function installmentPaid(item) {
  return item.status === "paid" || number(item.paidUsd) >= number(item.amountUsd) - 0.0001;
}

function installmentRemaining(item) {
  return Math.max(0, number(item.amountUsd) - number(item.paidUsd));
}

function installmentOverdue(item) {
  if (installmentPaid(item) || !item.dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(item.dueDate) < today;
}

function installmentDueSoon(item) {
  if (installmentPaid(item) || !item.dueDate || installmentOverdue(item)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(item.dueDate);
  due.setHours(0, 0, 0, 0);
  return due.getTime() - today.getTime() <= 1000 * 60 * 60 * 24 * 7;
}

function nextDueDate(invoice) {
  const item = invoiceSchedule(invoice)
    .filter((entry) => !installmentPaid(entry))
    .sort((left, right) => new Date(left.dueDate || 0) - new Date(right.dueDate || 0))[0];
  return item?.dueDate || invoice.dueDate || "";
}

function invoiceKind(invoice) {
  if (invoice.installmentPlan?.type === "installment") return "أقساط";
  if (number(ToxStore.invoiceDebt(invoice)) <= 0.0001) return "نقد";
  return number(invoice.paidUsd) > 0 ? "دين جزئي" : "دين";
}

function invoiceStatus(invoice) {
  const debt = ToxStore.invoiceDebt(invoice);
  const schedule = invoiceSchedule(invoice);
  if (debt <= 0.0001) return { label: "مدفوعة بالكامل", tone: "success" };
  if (schedule.some(installmentOverdue)) return { label: "متأخرة", tone: "danger" };
  if (number(invoice.paidUsd) > 0 || schedule.some((item) => number(item.paidUsd) > 0)) {
    return { label: "مدفوعة جزئيا", tone: "warning" };
  }
  return { label: "غير مدفوعة", tone: "danger" };
}

function installmentStatus(item) {
  if (installmentPaid(item)) return { label: "مدفوع", tone: "success" };
  if (installmentOverdue(item)) return { label: "متأخر", tone: "danger" };
  if (number(item.paidUsd) > 0) return { label: "جزئي", tone: "warning" };
  return { label: "مستحق", tone: "neutral" };
}

function badge(label, tone = "neutral") {
  return `<span class="erp-badge erp-badge-${tone}">${escapeHtml(label)}</span>`;
}

function invoiceKindLabel(invoice) {
  return invoiceTypeMeta(invoice).label;
}

function clientMetrics(client, state) {
  const stats = ToxStore.clientStats(client.id);
  const invoices = clientInvoices(client.id, state);
  const payments = clientPayments(client.id, state);
  const totalPaid = invoices.reduce((sum, invoice) => sum + Math.max(0, ToxStore.invoiceNet(invoice) - ToxStore.invoiceDebt(invoice)), 0);
  const totalDebt = number(stats.debtUsd);
  const activeInstallments = invoices.reduce((sum, invoice) => (
    sum + invoiceSchedule(invoice).filter((item) => !installmentPaid(item)).length
  ), 0);
  const lastPayment = payments[0];
  const lastInvoice = invoices[0];
  const paymentBase = totalDebt + totalPaid;
  const paidRatio = paymentBase > 0 ? Math.min(100, Math.round((totalPaid / paymentBase) * 100)) : 100;
  const overdueCount = invoices.reduce((sum, invoice) => (
    sum + invoiceSchedule(invoice).filter(installmentOverdue).length
  ), 0);
  const dueSoonCount = invoices.reduce((sum, invoice) => (
    sum + invoiceSchedule(invoice).filter(installmentDueSoon).length
  ), 0);
  return {
    ...stats,
    invoices,
    payments,
    totalPaid,
    totalDebt,
    activeInstallments,
    lastPayment,
    lastInvoice,
    paidRatio,
    overdueCount,
    dueSoonCount,
  };
}

function clientDeleteInfo(client, state) {
  const metrics = clientMetrics(client, state);
  const unpaidInstallments = installmentClientInvoices(client.id, state)
    .flatMap((invoice) => invoiceSchedule(invoice).filter((item) => !installmentPaid(item)));
  const suspendedCount = (state.suspendedInvoices || []).filter((invoice) => invoice.clientId === client.id).length;
  if (metrics.totalDebt > 0.0001) {
    return { canDelete: false, reason: `لا يمكن حذف العميل قبل تسديد الرصيد القائم: ${money(metrics.totalDebt, state)}` };
  }
  if (unpaidInstallments.length) {
    return { canDelete: false, reason: `لا يمكن حذف العميل لأن لديه ${unpaidInstallments.length} قسط غير مسدد.` };
  }
  if (suspendedCount) {
    return { canDelete: false, reason: "لا يمكن حذف العميل لأن لديه فواتير معلقة غير مكتملة." };
  }
  return {
    canDelete: true,
    reason: metrics.invoiceCount || metrics.payments.length
      ? "سيبقى سجل الفواتير والدفعات محفوظاً باسم العميل بعد فك الربط."
      : "لا توجد التزامات على هذا الحساب."
  };
}

function accountState(metrics) {
  if (metrics.totalDebt > 0.0001) return { label: "عليه دين", tone: "danger", amount: metrics.totalDebt };
  if (metrics.openingUsd < -0.0001) return { label: "له رصيد", tone: "success", amount: Math.abs(metrics.openingUsd) };
  return { label: "متوازن", tone: "success", amount: 0 };
}

function renderClientList(clients, state) {
  clientList.innerHTML = clients.map((client) => {
    const metrics = clientMetrics(client, state);
    const account = accountState(metrics);
    return `
      <button class="client-card smart-client-card ${client.id === activeClientId ? "active" : ""}" data-client-id="${escapeHtml(client.id)}">
        <span class="client-card-top">
          <strong>${escapeHtml(client.name)}</strong>
          <b class="${account.tone === "danger" ? "danger-text" : "success-text"}">${money(account.amount, state)}</b>
        </span>
        <span>${escapeHtml(client.phone || "بدون هاتف")}</span>
        <span class="client-card-meta">${escapeHtml(client.address || "بدون عنوان")} - ${account.label}</span>
        <div class="mini-ratios">
          <small>${metrics.invoiceCount} فواتير</small>
          <small>${metrics.activeInstallments} أقساط</small>
          <small>${metrics.payments.length} دفعات</small>
        </div>
      </button>
    `;
  }).join("") || `<div class="warehouse-empty">لا يوجد عملاء مطابقون</div>`;

  document.querySelectorAll("[data-client-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeClientId = button.dataset.clientId;
      selectedInvoiceId = "";
      invoicePage = 1;
      paymentPage = 1;
      statementPage = 1;
      renderClients(ToxStore.getState());
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

function profileHeader(client, state) {
  const metrics = clientMetrics(client, state);
  const account = accountState(metrics);
  const avatar = client.image || client.imageUrl
    ? `<img src="${escapeHtml(client.image || client.imageUrl)}" alt="" />`
    : `<span>${escapeHtml(initials(client.name))}</span>`;
  return `
    <section class="client-profile-hero">
      <div class="client-identity">
        <div class="client-avatar">${avatar}</div>
        <div>
          <div class="client-hero-line">
            <h2>${escapeHtml(client.name)}</h2>
            ${badge(account.label, account.tone)}
          </div>
          <div class="client-meta-strip">
            <span>${escapeHtml(client.phone || "بدون هاتف")}</span>
            <span>${escapeHtml(client.address || "بدون عنوان")}</span>
            <span>آخر دفعة: ${formatDate(metrics.lastPayment?.receivedAt || metrics.lastPayment?.createdAt, state)}</span>
            <span>آخر فاتورة: ${formatDate(metrics.lastInvoice?.createdAt, state)}</span>
          </div>
        </div>
      </div>
      <div class="client-payment-ring" style="--paid:${metrics.paidRatio}">
        <strong>${metrics.paidRatio}%</strong>
        <span>نسبة السداد</span>
      </div>
    </section>
    <section class="client-kpi-grid">
      ${kpiCard("إجمالي الدين", money(metrics.totalDebt, state), "danger", account.label)}
      ${kpiCard("إجمالي المدفوع", money(metrics.totalPaid, state), "success")}
      ${kpiCard("المتبقي الحالي", money(metrics.totalDebt, state), "warning")}
      ${kpiCard("عدد الفواتير", String(metrics.invoiceCount), "info")}
      ${kpiCard("الأقساط المتبقية", String(metrics.activeInstallments), "violet")}
      ${kpiCard("نسبة السداد", `${metrics.paidRatio}%`, "success")}
    </section>
    <nav class="client-tabs" aria-label="Client sections">
      ${[
        ["overview", "نظرة عامة"],
        ["invoices", "الفواتير"],
        ["installments", "الأقساط"],
        ["payments", "الدفعات"],
        ["statement", "كشف الحساب"],
        ["activity", "النشاط"],
      ].map(([key, label]) => `
        <button type="button" class="${activeClientTab === key ? "active" : ""}" data-client-tab="${key}">
          ${label}
        </button>
      `).join("")}
    </nav>
  `;
}

function clientTabKey() {
  return ["overview", "invoices", "installments", "statement"].includes(activeClientTab) ? activeClientTab : "statement";
}

function profileHeaderV2(client, state) {
  const metrics = clientMetrics(client, state);
  const account = accountState(metrics);
  const directDebt = directClientDebt(client.id, state);
  const installmentsDebt = installmentClientInvoices(client.id, state)
    .reduce((sum, invoice) => sum + number(ToxStore.invoiceDebt(invoice)), 0);
  const deleteInfo = clientDeleteInfo(client, state);
  const avatar = client.image || client.imageUrl
    ? `<img src="${escapeHtml(client.image || client.imageUrl)}" alt="" />`
    : `<span>${escapeHtml(initials(client.name))}</span>`;
  const tabs = [
    ["overview", "نظرة عامة"],
    ["invoices", "الفواتير"],
    ["installments", "الأقساط"],
    ["statement", "سجل الحساب"],
  ];
  const activeKey = clientTabKey();
  return `
    <section class="client-profile-hero client-profile-hero-v2">
      <div class="client-identity">
        <div class="client-avatar">${avatar}</div>
        <div>
          <div class="client-hero-line">
            <h2>${escapeHtml(client.name)}</h2>
            ${badge(account.label, account.tone)}
          </div>
          <div class="client-meta-strip">
            <span>${escapeHtml(client.phone || "بدون هاتف")}</span>
            <span>${escapeHtml(client.address || "بدون عنوان")}</span>
            <span>آخر دفعة: ${formatDate(metrics.lastPayment?.receivedAt || metrics.lastPayment?.createdAt, state)}</span>
            <span>آخر فاتورة: ${formatDate(metrics.lastInvoice?.createdAt, state)}</span>
          </div>
        </div>
      </div>
      <div class="client-balance-focus">
        <span>الرصيد القائم</span>
        <strong class="${metrics.totalDebt > 0.0001 ? "text-red" : "text-green"}">${money(metrics.totalDebt, state)}</strong>
        <small>${metrics.totalDebt > 0.0001 ? "يحتاج متابعة" : "الحساب متوازن"}</small>
        ${deleteInfo.canDelete ? `
          <button class="button danger compact-action client-delete-button" type="button" data-delete-client="${escapeHtml(client.id)}">حذف العميل</button>
          <small class="client-delete-note">${escapeHtml(deleteInfo.reason)}</small>
        ` : `<small class="client-delete-note muted">${escapeHtml(deleteInfo.reason)}</small>`}
      </div>
    </section>
    <section class="client-kpi-grid client-kpi-grid-v2">
      ${kpiCard("الرصيد القائم", money(metrics.totalDebt, state), metrics.totalDebt > 0.0001 ? "danger" : "success", account.label)}
      ${kpiCard("دين مباشر", money(directDebt, state), directDebt > 0.0001 ? "warning" : "success")}
      ${kpiCard("أقساط قائمة", money(installmentsDebt, state), installmentsDebt > 0.0001 ? "violet" : "success", `${metrics.activeInstallments} قسط متبقي`)}
      ${kpiCard("إجمالي المدفوع", money(metrics.totalPaid, state), "success")}
      ${kpiCard("الفواتير", String(metrics.invoiceCount), "info")}
      ${kpiCard("نسبة السداد", `${metrics.paidRatio}%`, "success")}
    </section>
    <nav class="client-tabs client-tabs-v2" aria-label="Client sections">
      ${tabs.map(([key, label]) => `
        <button type="button" class="${activeKey === key ? "active" : ""}" data-client-tab="${key}">
          ${label}
        </button>
      `).join("")}
    </nav>
  `;
}

function chartSlice(percent, tone, label, value) {
  return `
    <div class="client-chart-row">
      <span>${escapeHtml(label)}</span>
      <div class="client-chart-track"><i class="chart-${tone}" style="width:${Math.max(3, Math.min(100, percent))}%"></i></div>
      <b>${escapeHtml(value)}</b>
    </div>
  `;
}

function renderOverview(client, state) {
  const metrics = clientMetrics(client, state);
  const recentInvoices = directClientInvoices(client.id, state).slice(0, 5);
  const nextInstallments = installmentClientInvoices(client.id, state)
    .flatMap((invoice) => invoiceSchedule(invoice).map((item) => ({ invoice, item })))
    .filter(({ item }) => !installmentPaid(item))
    .sort((left, right) => new Date(left.item.dueDate || 0) - new Date(right.item.dueDate || 0))
    .slice(0, 5);
  return `
    <section class="client-overview-grid">
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>ملخص الحساب</h3>
          <button class="button primary compact-action" type="button" data-open-general-payment="${escapeHtml(client.id)}">دفعة دين مباشر</button>
        </div>
        <div class="client-progress-large">
          <div class="client-progress-top">
            <span>نسبة السداد</span>
            <strong>${metrics.paidRatio}%</strong>
          </div>
          <div class="client-progress"><i style="width:${metrics.paidRatio}%"></i></div>
        </div>
        <div class="client-alert-stack">
          ${smartAlerts(client, state).slice(0, 4).map((alert) => `
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
          <button class="button ghost compact-action" type="button" data-client-tab-jump="invoices">عرض الكل</button>
        </div>
        <div class="client-mini-list">
          ${recentInvoices.map((invoice) => {
            const status = invoiceStatus(invoice);
            return `
              <button type="button" data-open-invoice="${escapeHtml(invoice.id)}">
                <span><strong>${escapeHtml(invoice.id)}</strong><small>${formatDate(invoice.createdAt, state)} - ${escapeHtml(invoiceKindLabel(invoice))}</small></span>
                <b>${money(ToxStore.invoiceDebt(invoice), state)}</b>
                ${badge(status.label, status.tone)}
              </button>
            `;
          }).join("") || `<div class="client-empty-slim">لا توجد فواتير</div>`}
        </div>
      </div>
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>الأقساط القادمة</h3>
          <button class="button ghost compact-action" type="button" data-client-tab-jump="installments">عرض الأقساط</button>
        </div>
        <div class="client-mini-list">
          ${nextInstallments.map(({ invoice, item }) => {
            const status = installmentStatus(item);
            return `
              <button type="button" data-open-invoice="${escapeHtml(invoice.id)}">
                <span><strong>${escapeHtml(invoiceProductTitle(invoice, state))} - قسط ${number(item.number)}</strong><small>${escapeHtml(invoice.id)} | استحقاق ${formatDate(item.dueDate, state)}</small></span>
                <b>${money(installmentRemaining(item), state)}</b>
                ${badge(status.label, status.tone)}
              </button>
            `;
          }).join("") || `<div class="client-empty-slim">لا توجد أقساط قادمة</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderOverviewV2(client, state) {
  const metrics = clientMetrics(client, state);
  const alerts = smartAlerts(client, state);
  const recentInvoices = directClientInvoices(client.id, state).slice(0, 4);
  const installmentInvoices = installmentClientInvoices(client.id, state);
  const directDebt = directClientDebt(client.id, state);
  const installmentDebt = installmentInvoices.reduce((sum, invoice) => sum + number(ToxStore.invoiceDebt(invoice)), 0);
  const nextInstallments = installmentInvoices
    .flatMap((invoice) => invoiceSchedule(invoice).map((item) => ({ invoice, item })))
    .filter(({ item }) => !installmentPaid(item))
    .sort((left, right) => new Date(left.item.dueDate || 0) - new Date(right.item.dueDate || 0))
    .slice(0, 5);
  const nextInstallment = nextInstallments[0];
  const lastInvoice = metrics.invoices[0];
  const lastPayment = metrics.payments[0];
  return `
    <section class="client-overview-grid client-overview-grid-v2">
      <div class="client-work-card client-account-command">
        <div class="client-section-title">
          <h3>وضع الحساب الآن</h3>
          <button class="button primary compact-action" type="button" data-open-general-payment="${escapeHtml(client.id)}">تسجيل دفعة</button>
        </div>
        <div class="client-focus-grid">
          <button type="button" class="client-focus-tile balance" data-client-tab-jump="statement">
            <span>الرصيد القائم</span>
            <strong class="${metrics.totalDebt > 0.0001 ? "text-red" : "text-green"}">${money(metrics.totalDebt, state)}</strong>
            <small>${metrics.totalDebt > 0.0001 ? "متبقي على العميل" : "لا يوجد رصيد مطلوب"}</small>
          </button>
          ${lastInvoice ? `
            <button type="button" class="client-focus-tile" data-open-invoice="${escapeHtml(lastInvoice.id)}">
              <span>آخر فاتورة</span>
              <strong>${escapeHtml(lastInvoice.id)}</strong>
              <small>${formatDate(lastInvoice.createdAt, state)} | ${escapeHtml(invoiceKindLabel(lastInvoice))}</small>
            </button>
          ` : `
            <div class="client-focus-tile muted"><span>آخر فاتورة</span><strong>-</strong><small>لا توجد فواتير بعد</small></div>
          `}
          ${lastPayment ? `
            <button type="button" class="client-focus-tile" data-client-tab-jump="statement">
              <span>آخر دفعة</span>
              <strong class="text-green">${money(lastPayment.amountUsd, state)}</strong>
              <small>${formatDate(lastPayment.receivedAt || lastPayment.createdAt, state)}</small>
            </button>
          ` : `
            <div class="client-focus-tile muted"><span>آخر دفعة</span><strong>-</strong><small>لا توجد دفعات مسجلة</small></div>
          `}
          ${nextInstallment ? `
            <button type="button" class="client-focus-tile" data-open-invoice="${escapeHtml(nextInstallment.invoice.id)}">
              <span>القسط القادم</span>
              <strong>${money(installmentRemaining(nextInstallment.item), state)}</strong>
              <small>${formatDate(nextInstallment.item.dueDate, state)} | ${escapeHtml(nextInstallment.invoice.id)}</small>
            </button>
          ` : `
            <div class="client-focus-tile muted"><span>القسط القادم</span><strong>-</strong><small>لا توجد أقساط مستحقة</small></div>
          `}
        </div>
        <div class="client-progress-large">
          <div class="client-progress-top">
            <span>نسبة السداد من إجمالي التعامل</span>
            <strong>${metrics.paidRatio}%</strong>
          </div>
          <div class="client-progress-bar"><i style="width:${metrics.paidRatio}%"></i></div>
        </div>
        <div class="client-alert-stack">
          ${alerts.slice(0, 4).map((alert) => `
            <div class="client-alert client-alert-${alert.tone}">
              <strong>${escapeHtml(alert.title)}</strong>
              <span>${escapeHtml(alert.text)}</span>
            </div>
          `).join("") || `<div class="client-empty-slim">لا توجد تنبيهات حالية</div>`}
        </div>
      </div>
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>الفواتير والدين المباشر</h3>
          <span>${money(directDebt, state)} متبقي</span>
        </div>
        <div class="client-mini-list">
          ${recentInvoices.map((invoice) => {
            const status = invoiceStatus(invoice);
            const type = invoiceTypeMeta(invoice);
            return `
              <button type="button" data-open-invoice="${escapeHtml(invoice.id)}">
                <span><strong>${escapeHtml(invoice.id)}</strong><small>${formatDate(invoice.createdAt, state)} | ${escapeHtml(type.label)}</small></span>
                <b>${money(ToxStore.invoiceDebt(invoice), state)}</b>
                ${badge(status.label, status.tone)}
              </button>
            `;
          }).join("") || `<div class="client-empty-slim">لا توجد فواتير مباشرة لهذا العميل</div>`}
        </div>
      </div>
      <div class="client-work-card">
        <div class="client-section-title">
          <h3>الأقساط القادمة</h3>
          <span>${money(installmentDebt, state)} متبقي</span>
        </div>
        <div class="client-mini-list">
          ${nextInstallments.map(({ invoice, item }) => {
            const status = installmentStatus(item);
            return `
              <button type="button" data-open-invoice="${escapeHtml(invoice.id)}">
                <span><strong>${escapeHtml(invoiceProductTitle(invoice, state))} - قسط ${number(item.number)}</strong><small>${escapeHtml(invoice.id)} | استحقاق ${formatDate(item.dueDate, state)}</small></span>
                <b>${money(installmentRemaining(item), state)}</b>
                ${badge(status.label, status.tone)}
              </button>
            `;
          }).join("") || `<div class="client-empty-slim">لا توجد أقساط قادمة</div>`}
        </div>
      </div>
    </section>
  `;
}

function invoiceRow(invoice, state) {
  const status = invoiceStatus(invoice);
  return `
    <tr>
      <td><strong>${escapeHtml(invoice.id)}</strong></td>
      <td>${formatDate(invoice.createdAt, state)}</td>
      <td>${escapeHtml(invoiceKindLabel(invoice))}</td>
      <td>${money(ToxStore.invoiceNet(invoice), state)}</td>
      <td class="text-green">${money(invoice.paidUsd, state)}</td>
      <td class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</td>
      <td>${invoiceItems(invoice).length}</td>
      <td>${badge(status.label, status.tone)}</td>
      <td>${formatDate(nextDueDate(invoice), state)}</td>
      <td><button class="button ghost compact-action" type="button" data-open-invoice="${escapeHtml(invoice.id)}">عرض</button></td>
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

function renderInvoices(client, state) {
  const invoices = directClientInvoices(client.id, state);
  const start = (invoicePage - 1) * PAGE_SIZE;
  const pageItems = invoices.slice(start, start + PAGE_SIZE);
  return `
    <section class="client-work-card">
      <div class="client-section-title">
        <h3>فواتير الدين المباشر</h3>
        <span>${invoices.length} فاتورة منفصلة عن الأقساط</span>
      </div>
      <div class="client-table-wrap">
        <table class="client-fast-table">
          <thead>
            <tr>
              <th>رقم الفاتورة</th><th>التاريخ</th><th>نوع البيع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>المنتجات</th><th>الحالة</th><th>الاستحقاق</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map((invoice) => invoiceRow(invoice, state)).join("") || `<tr><td colspan="10">لا توجد فواتير لهذا العميل</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pagination(invoices.length, invoicePage, PAGE_SIZE, "invoices")}
    </section>
  `;
}

function invoiceRowV2(invoice, state) {
  const status = invoiceStatus(invoice);
  const type = invoiceTypeMeta(invoice);
  return `
    <tr>
      <td><strong>${escapeHtml(invoice.id)}</strong><small>${formatDate(invoice.createdAt, state)}</small></td>
      <td>${badge(type.label, type.tone)}</td>
      <td>${badge(status.label, status.tone)}</td>
      <td>${money(ToxStore.invoiceNet(invoice), state)}</td>
      <td class="text-green">${money(invoice.paidUsd, state)}</td>
      <td class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</td>
      <td>${invoiceItems(invoice).length}</td>
      <td>${formatDate(nextDueDate(invoice), state)}</td>
      <td><button class="button ghost compact-action" type="button" data-open-invoice="${escapeHtml(invoice.id)}">عرض</button></td>
    </tr>
  `;
}

function renderInvoicesV2(client, state) {
  const invoices = directClientInvoices(client.id, state);
  const directPosCount = invoices.filter((invoice) => normalizedInvoiceKind(invoice) === "direct_pos" || normalizedInvoiceKind(invoice) === "direct").length;
  const formalCount = invoices.length - directPosCount;
  const start = (invoicePage - 1) * PAGE_SIZE;
  const pageItems = invoices.slice(start, start + PAGE_SIZE);
  return `
    <section class="client-work-card client-invoice-ledger-card">
      <div class="client-section-title">
        <div>
          <h3>الفواتير</h3>
          <span>${invoices.length} فاتورة | ${directPosCount} بيع مباشر | ${formalCount} بيع بفاتورة</span>
        </div>
        <button class="button primary compact-action" type="button" data-open-general-payment="${escapeHtml(client.id)}">تسجيل دفعة</button>
      </div>
      <div class="client-table-wrap">
        <table class="client-fast-table client-invoice-table">
          <thead>
            <tr>
              <th>الفاتورة</th><th>التصنيف</th><th>الحالة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>المنتجات</th><th>الاستحقاق</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map((invoice) => invoiceRowV2(invoice, state)).join("") || `<tr><td colspan="9">لا توجد فواتير مباشرة لهذا العميل</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pagination(invoices.length, invoicePage, PAGE_SIZE, "invoices")}
    </section>
  `;
}

function renderInstallments(client, state) {
  const plans = installmentClientInvoices(client.id, state);
  return `
    <section class="client-work-card">
      <div class="client-section-title">
        <h3>خطط الأقساط حسب المنتج</h3>
        <span>${plans.length} خطة أقساط</span>
      </div>
      <div class="client-installment-plans">
        ${plans.map((invoice) => {
          const plan = installmentPlanMetrics(invoice);
          const status = invoiceStatus(invoice);
          return `
            <article class="client-installment-plan">
              <div class="installment-plan-head">
                <div>
                  <strong>${escapeHtml(invoiceProductTitle(invoice, state))}</strong>
                  <small>${escapeHtml(invoice.id)} | ${formatDate(invoice.createdAt, state)}</small>
                </div>
                ${badge(status.label, status.tone)}
              </div>
              <div class="installment-plan-stats">
                <div><span>عدد الدفعات</span><strong>${plan.paidCount}/${plan.totalCount}</strong></div>
                <div><span>دفعة أولى</span><strong>${money(invoice.installmentPlan?.downPaymentUsd, state)}</strong></div>
                <div><span>المتبقي</span><strong class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
                <div><span>القسط القادم</span><strong>${plan.next ? money(installmentRemaining(plan.next), state) : "مكتمل"}</strong></div>
              </div>
              <div class="client-progress installment-progress"><i style="width:${plan.progress}%"></i></div>
              <div class="installment-payment-grid">
                ${plan.schedule.map((item) => {
                  const itemStatus = installmentStatus(item);
                  return `
                    <div class="installment-payment-card ${installmentPaid(item) ? "is-paid" : installmentOverdue(item) ? "is-overdue" : ""}">
                      <b>دفعة ${number(item.number)}</b>
                      <span>${formatDate(item.dueDate, state)}</span>
                      <strong>${money(item.amountUsd, state)}</strong>
                      <small>${number(item.paidUsd) ? `مدفوع ${money(item.paidUsd, state)}` : itemStatus.label}</small>
                      ${installmentPaid(item)
                        ? `<em>تم الدفع ${formatDate(item.paidAt, state)}</em>`
                        : `<button class="button primary compact-action" type="button" data-pay-installment="${escapeHtml(invoice.id)}" data-installment-number="${number(item.number)}">تسديد</button>`
                      }
                    </div>
                  `;
                }).join("")}
              </div>
              <div class="installment-plan-actions">
                <button class="button ghost compact-action" type="button" data-open-invoice="${escapeHtml(invoice.id)}">عرض فاتورة الأقساط</button>
                ${plan.next ? `<button class="button primary compact-action" type="button" data-pay-installment="${escapeHtml(invoice.id)}" data-installment-number="${number(plan.next.number)}">تسديد القسط القادم</button>` : ""}
              </div>
            </article>
          `;
        }).join("") || `<div class="client-empty-slim">لا توجد خطط أقساط لهذا العميل</div>`}
      </div>
    </section>
  `;
}

function renderInstallmentsV2(client, state) {
  const plans = installmentClientInvoices(client.id, state);
  return `
    <section class="client-work-card client-installments-workspace">
      <div class="client-section-title">
        <div>
          <h3>خطط الأقساط</h3>
          <span>${plans.length} خطة مفصولة عن الفواتير المباشرة</span>
        </div>
      </div>
      <div class="client-installment-plans">
        ${plans.map((invoice) => {
          const plan = installmentPlanMetrics(invoice);
          const status = invoiceStatus(invoice);
          const overdue = plan.schedule.filter(installmentOverdue).length;
          const sortedSchedule = [...plan.schedule].sort((left, right) => new Date(left.dueDate || 0) - new Date(right.dueDate || 0));
          return `
            <article class="client-installment-plan client-installment-plan-v2">
              <div class="installment-plan-head">
                <div>
                  <strong>${escapeHtml(invoiceProductTitle(invoice, state))}</strong>
                  <small>${escapeHtml(invoice.id)} | ${formatDate(invoice.createdAt, state)} | ${escapeHtml(invoiceKindLabel(invoice))}</small>
                </div>
                ${badge(status.label, status.tone)}
              </div>
              <div class="installment-plan-stats">
                <div><span>الأقساط المدفوعة</span><strong>${plan.paidCount}/${plan.totalCount}</strong></div>
                <div><span>القسط القادم</span><strong>${plan.next ? money(installmentRemaining(plan.next), state) : "مكتمل"}</strong></div>
                <div><span>المتأخر</span><strong class="${overdue ? "text-red" : "text-green"}">${overdue}</strong></div>
                <div><span>المتبقي</span><strong class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
              </div>
              <div class="client-progress-bar installment-progress"><i style="width:${plan.progress}%"></i></div>
              <div class="installment-payment-grid">
                ${sortedSchedule.map((item) => {
                  const itemStatus = installmentStatus(item);
                  return `
                    <div class="installment-payment-card ${installmentPaid(item) ? "is-paid" : installmentOverdue(item) ? "is-overdue" : ""}">
                      <b>قسط ${number(item.number)}</b>
                      <span>${formatDate(item.dueDate, state)}</span>
                      <strong>${money(item.amountUsd, state)}</strong>
                      <small>${number(item.paidUsd) ? `مدفوع ${money(item.paidUsd, state)}` : itemStatus.label}</small>
                      ${installmentPaid(item)
                        ? `<em>تم الدفع ${formatDate(item.paidAt, state)}</em>`
                        : `<button class="button primary compact-action" type="button" data-pay-installment="${escapeHtml(invoice.id)}" data-installment-number="${number(item.number)}">تسديد</button>`
                      }
                    </div>
                  `;
                }).join("")}
              </div>
              <div class="installment-plan-actions">
                <button class="button ghost compact-action" type="button" data-open-invoice="${escapeHtml(invoice.id)}">عرض فاتورة الأقساط</button>
                ${plan.next ? `<button class="button primary compact-action" type="button" data-pay-installment="${escapeHtml(invoice.id)}" data-installment-number="${number(plan.next.number)}">تسديد القسط القادم</button>` : ""}
              </div>
            </article>
          `;
        }).join("") || `<div class="client-empty-slim">لا توجد خطط أقساط لهذا العميل</div>`}
      </div>
    </section>
  `;
}

function renderPayments(client, state) {
  const payments = clientPayments(client.id, state);
  const start = (paymentPage - 1) * PAYMENT_PAGE_SIZE;
  const pageItems = payments.slice(start, start + PAYMENT_PAGE_SIZE);
  return `
    <section class="client-work-card">
      <div class="client-section-title">
        <h3>المدفوعات</h3>
        <button class="button primary compact-action" type="button" data-open-general-payment="${escapeHtml(client.id)}">دفعة دين مباشر</button>
      </div>
      <div class="client-table-wrap">
        <table class="client-fast-table">
          <thead><tr><th>التاريخ</th><th>المبلغ</th><th>نوع الدفع</th><th>الموظف</th><th>ملاحظات</th><th>تطبيق الدفع</th></tr></thead>
          <tbody>
            ${pageItems.map((payment) => `
              <tr>
                <td>${formatDate(payment.receivedAt || payment.createdAt, state)}</td>
                <td class="text-green"><strong>${money(payment.amountUsd, state)}</strong></td>
                <td>${payment.paymentKind === "installment" ? "قسط" : payment.paymentKind === "direct" ? "دين مباشر" : "دفعة عامة"}</td>
                <td>${escapeHtml(payment.employeeName || payment.userName || "-")}</td>
                <td>${escapeHtml(payment.note || "-")}</td>
                <td>${(payment.appliedTo || []).map((item) => item.installmentNumber ? `${item.invoiceId} / قسط ${item.installmentNumber}` : item.invoiceId).join("، ") || "-"}</td>
              </tr>
            `).join("") || `<tr><td colspan="6">لا توجد دفعات مسجلة</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pagination(payments.length, paymentPage, PAYMENT_PAGE_SIZE, "payments")}
    </section>
  `;
}

function statementRows(client, state) {
  const opening = Math.abs(number(client.openingBalanceUsd)) > 0.0001 ? [{
    id: `opening-${client.id}`,
    date: client.createdAt || "1970-01-01",
    title: "رصيد افتتاحي",
    type: client.openingBalanceType === "credit" ? "دائن" : "مدين",
    debit: client.openingBalanceType === "credit" ? 0 : number(client.openingBalanceUsd),
    credit: client.openingBalanceType === "credit" ? number(client.openingBalanceUsd) : 0,
    note: client.financialNote || "",
  }] : [];
  const invoices = clientInvoices(client.id, state).map((invoice) => ({
    id: `invoice-${invoice.id}`,
    date: invoice.createdAt,
    title: `فاتورة ${invoice.id}`,
    type: invoiceKindLabel(invoice),
    debit: ToxStore.invoiceNet(invoice),
    credit: 0,
    note: invoiceStatus(invoice).label,
  }));
  const payments = clientPayments(client.id, state).map((payment) => ({
    id: `payment-${payment.id}`,
    date: payment.receivedAt || payment.createdAt,
    title: `دفعة ${payment.id}`,
    type: payment.paymentKind === "installment" ? "دفع قسط" : "دفعة",
    debit: 0,
    credit: number(payment.amountUsd),
    note: payment.note || "",
  }));
  return [...opening, ...invoices, ...payments]
    .sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0));
}

function accountLedgerRows(client, state) {
  const opening = Math.abs(number(client.openingBalanceUsd)) > 0.0001 ? [{
    id: `opening-${client.id}`,
    category: "opening",
    date: client.createdAt || "1970-01-01",
    title: "رصيد افتتاحي",
    type: client.openingBalanceType === "credit" ? "رصيد لصالح العميل" : "دين افتتاحي",
    debit: client.openingBalanceType === "credit" ? 0 : number(client.openingBalanceUsd),
    credit: client.openingBalanceType === "credit" ? number(client.openingBalanceUsd) : 0,
    note: client.financialNote || "",
  }] : [];
  const invoices = clientInvoices(client.id, state).map((invoice) => {
    const installment = isInstallmentInvoice(invoice);
    return {
      id: `invoice-${invoice.id}`,
      invoiceId: invoice.id,
      category: installment ? "installments" : "invoices",
      date: invoice.createdAt,
      title: `فاتورة ${invoice.id}`,
      type: invoiceKindLabel(invoice),
      debit: ToxStore.invoiceNet(invoice),
      credit: 0,
      note: invoiceProductTitle(invoice, state),
    };
  });
  const payments = clientPayments(client.id, state).map((payment) => {
    const isInstallmentPayment = payment.paymentKind === "installment" || (payment.appliedTo || []).some((item) => item.installmentNumber);
    return {
      id: `payment-${payment.id}`,
      category: isInstallmentPayment ? "installments" : "payments",
      date: payment.receivedAt || payment.createdAt,
      title: `دفعة ${payment.id}`,
      type: isInstallmentPayment ? "تسديد قسط" : "دفعة",
      debit: 0,
      credit: number(payment.amountUsd),
      note: payment.note || (payment.appliedTo || []).map((item) => item.installmentNumber ? `${item.invoiceId} / قسط ${item.installmentNumber}` : item.invoiceId).join("، "),
    };
  });
  const chronological = [...opening, ...invoices, ...payments]
    .sort((left, right) => new Date(left.date || 0) - new Date(right.date || 0));
  let running = 0;
  const balanced = chronological.map((row) => {
    running += number(row.debit) - number(row.credit);
    return { ...row, balance: running };
  });
  const alerts = smartAlerts(client, state).map((alert, index) => ({
    id: `alert-${client.id}-${index}`,
    category: "alerts",
    tone: alert.tone,
    date: new Date().toISOString(),
    title: alert.title,
    type: "تنبيه",
    debit: 0,
    credit: 0,
    balance: running,
    note: alert.text,
  }));
  return [...balanced, ...alerts]
    .sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0));
}

function accountFilterLabel(filter) {
  return {
    all: "الكل",
    invoices: "فواتير",
    payments: "دفعات",
    installments: "أقساط",
    alerts: "تنبيهات",
  }[filter] || "الكل";
}

function renderStatement(client, state) {
  const rows = statementRows(client, state);
  const chronological = [...rows].sort((left, right) => new Date(left.date || 0) - new Date(right.date || 0));
  let running = 0;
  const balancedRows = chronological.map((row) => {
    running += number(row.debit) - number(row.credit);
    return { ...row, balance: running };
  }).reverse();
  const totalDebit = rows.reduce((sum, row) => sum + number(row.debit), 0);
  const totalCredit = rows.reduce((sum, row) => sum + number(row.credit), 0);
  const start = (statementPage - 1) * STATEMENT_PAGE_SIZE;
  const pageItems = balancedRows.slice(start, start + STATEMENT_PAGE_SIZE);
  return `
    <section class="client-work-card">
      <div class="client-section-title">
        <h3>كشف الحساب</h3>
        <button class="button ghost compact-action" type="button" data-print-client-statement="${escapeHtml(client.id)}">طباعة كشف</button>
      </div>
      <div class="statement-summary-grid">
        <div><span>إجمالي المدين</span><strong class="text-red">${money(totalDebit, state)}</strong></div>
        <div><span>إجمالي الدائن</span><strong class="text-green">${money(totalCredit, state)}</strong></div>
        <div><span>الرصيد الحالي</span><strong>${money(Math.max(0, totalDebit - totalCredit), state)}</strong></div>
        <div><span>عدد الحركات</span><strong>${rows.length}</strong></div>
      </div>
      <div class="client-table-wrap professional-statement">
        <table class="client-fast-table">
          <thead><tr><th>التاريخ</th><th>الحركة</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
          <tbody>
            ${pageItems.map((row) => `
              <tr>
                <td>${formatDate(row.date, state)}</td>
                <td><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.note || "-")}</small></td>
                <td>${escapeHtml(row.type)}</td>
                <td class="text-red">${row.debit ? money(row.debit, state) : "-"}</td>
                <td class="text-green">${row.credit ? money(row.credit, state) : "-"}</td>
                <td><strong>${money(Math.max(0, row.balance), state)}</strong></td>
              </tr>
            `).join("") || `<tr><td colspan="6">لا توجد حركات في كشف الحساب</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pagination(balancedRows.length, statementPage, STATEMENT_PAGE_SIZE, "statement")}
    </section>
  `;
}

function renderStatementV2(client, state) {
  const allRows = accountLedgerRows(client, state);
  const financialRows = allRows.filter((row) => row.category !== "alerts");
  const rows = accountLogFilter === "all" ? allRows : allRows.filter((row) => row.category === accountLogFilter);
  const totalDebit = financialRows.reduce((sum, row) => sum + number(row.debit), 0);
  const totalCredit = financialRows.reduce((sum, row) => sum + number(row.credit), 0);
  const currentBalance = Math.max(0, totalDebit - totalCredit);
  const start = (statementPage - 1) * STATEMENT_PAGE_SIZE;
  const pageItems = rows.slice(start, start + STATEMENT_PAGE_SIZE);
  const filters = ["all", "invoices", "payments", "installments", "alerts"];
  return `
    <section class="client-work-card client-account-log-card">
      <div class="client-section-title">
        <div>
          <h3>سجل الحساب</h3>
          <span>فواتير، دفعات، أقساط، وتنبيهات في مكان واحد</span>
        </div>
        <button class="button ghost compact-action" type="button" data-print-client-statement="${escapeHtml(client.id)}">طباعة كشف</button>
      </div>
      <div class="statement-summary-grid client-statement-summary-v2">
        <div><span>إجمالي المدين</span><strong class="text-red">${money(totalDebit, state)}</strong></div>
        <div><span>إجمالي الدائن</span><strong class="text-green">${money(totalCredit, state)}</strong></div>
        <div><span>الرصيد الحالي</span><strong>${money(currentBalance, state)}</strong></div>
        <div><span>الحركات</span><strong>${financialRows.length}</strong></div>
      </div>
      <div class="client-log-filters" role="tablist" aria-label="Account log filters">
        ${filters.map((filter) => `
          <button type="button" class="${accountLogFilter === filter ? "active" : ""}" data-account-log-filter="${filter}">
            ${accountFilterLabel(filter)}
          </button>
        `).join("")}
      </div>
      <div class="client-account-log-list">
        ${pageItems.map((row) => {
          const amount = row.credit ? money(row.credit, state) : row.debit ? money(row.debit, state) : "";
          return `
            <article class="client-account-log-row client-log-${row.category} ${row.tone ? `client-alert-${row.tone}` : ""}">
              <time>${formatDate(row.date, state)}</time>
              <div>
                <strong>${escapeHtml(row.title)}</strong>
                <small>${escapeHtml(row.type)}${row.note ? ` | ${escapeHtml(row.note)}` : ""}</small>
              </div>
              <b class="${row.credit ? "text-green" : row.debit ? "text-red" : ""}">${amount || escapeHtml(row.type)}</b>
              <span>${row.category === "alerts" ? "تنبيه" : money(Math.max(0, row.balance), state)}</span>
              ${row.invoiceId ? `<button class="button ghost compact-action" type="button" data-open-invoice="${escapeHtml(row.invoiceId)}">عرض</button>` : ""}
            </article>
          `;
        }).join("") || `<div class="client-empty-slim">لا توجد حركات ضمن فلتر ${accountFilterLabel(accountLogFilter)}</div>`}
      </div>
      ${pagination(rows.length, statementPage, STATEMENT_PAGE_SIZE, "statement")}
    </section>
  `;
}

function renderActivity(client, state) {
  const alerts = smartAlerts(client, state);
  const rows = statementRows(client, state).slice(0, 18);
  return `
    <section class="client-grid-two">
      <div class="client-work-card">
        <div class="client-section-title"><h3>التنبيهات الذكية</h3><span>${alerts.length}</span></div>
        <div class="client-alert-stack">
          ${alerts.map((alert) => `
            <div class="client-alert client-alert-${alert.tone}">
              <strong>${escapeHtml(alert.title)}</strong>
              <span>${escapeHtml(alert.text)}</span>
            </div>
          `).join("") || `<div class="client-empty-slim">لا توجد تنبيهات</div>`}
        </div>
      </div>
      <div class="client-work-card">
        <div class="client-section-title"><h3>آخر النشاطات</h3><span>سريع</span></div>
        <div class="client-timeline compact">
          ${rows.map((row) => `
            <article class="${row.credit ? "credit" : "debit"}">
              <time>${formatDate(row.date, state)}</time>
              <div><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.type)}</span></div>
              <b class="${row.credit ? "text-green" : "text-red"}">${money(row.credit || row.debit, state)}</b>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function smartAlerts(client, state) {
  const metrics = clientMetrics(client, state);
  const alerts = [];
  if (metrics.overdueCount) {
    alerts.push({ tone: "danger", title: "قسط متأخر", text: `${metrics.overdueCount} قسط يحتاج متابعة فورية` });
  }
  if (metrics.dueSoonCount) {
    alerts.push({ tone: "warning", title: "دفعة مستحقة قريبا", text: `${metrics.dueSoonCount} قسط خلال الأيام القادمة` });
  }
  if (number(client.debtLimitUsd) > 0 && metrics.totalDebt > number(client.debtLimitUsd)) {
    alerts.push({ tone: "danger", title: "تجاوز الحد الائتماني", text: `الرصيد الحالي ${money(metrics.totalDebt, state)}` });
  }
  const incomplete = metrics.invoices.filter((invoice) => !invoiceItems(invoice).length).length;
  if (incomplete) {
    alerts.push({ tone: "warning", title: "فاتورة غير مكتملة", text: `${incomplete} فاتورة بلا منتجات` });
  }
  if (!alerts.length && metrics.totalDebt > 0) {
    alerts.push({ tone: "info", title: "رصيد قائم", text: `المتبقي الحالي ${money(metrics.totalDebt, state)}` });
  }
  return alerts;
}

function monthlyBalances(client, state) {
  const rows = statementRows(client, state);
  const buckets = [];
  const now = new Date();
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({ key, label: date.toLocaleDateString(localeFor(state), { month: "short" }), balance: 0 });
  }
  rows.forEach((row) => {
    const date = new Date(row.date || 0);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.find((entry) => entry.key === key);
    if (bucket) bucket.balance += number(row.debit) - number(row.credit);
  });
  return buckets;
}

function tabContent(client, state) {
  const tab = clientTabKey();
  if (tab === "invoices") return renderInvoicesV2(client, state);
  if (tab === "installments") return renderInstallmentsV2(client, state);
  if (tab === "statement") return renderStatementV2(client, state);
  return renderOverviewV2(client, state);
}

function renderInvoiceDrawer(invoice, state) {
  if (!invoice) return "";
  const payments = state.clientPayments
    .filter((payment) => (payment.appliedTo || []).some((item) => item.invoiceId === invoice.id))
    .sort((left, right) => new Date(right.receivedAt || right.createdAt || 0) - new Date(left.receivedAt || left.createdAt || 0));
  const status = invoiceStatus(invoice);
  return `
    <div class="client-drawer-shell" data-client-drawer>
      <div class="client-drawer-backdrop" data-close-drawer></div>
      <section class="client-invoice-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <span>${escapeHtml(invoiceKindLabel(invoice))}</span>
            <h2>${escapeHtml(invoice.id)}</h2>
          </div>
          <button class="button ghost compact-action" type="button" data-close-drawer>إغلاق</button>
        </header>
        <div class="drawer-actions">
          <button class="button ghost compact-action" type="button" data-print-client-invoice="${escapeHtml(invoice.id)}">طباعة الفاتورة</button>
          <button class="button ghost compact-action" type="button" data-edit-client-invoice="${escapeHtml(invoice.id)}">تعديل</button>
          <button class="button primary compact-action" type="button" data-open-payment-for-invoice="${escapeHtml(invoice.id)}">إضافة دفعة</button>
          <button class="button ghost compact-action" type="button" data-print-client-receipt="${escapeHtml(invoice.id)}">طباعة وصل</button>
          <button class="button ghost compact-action" type="button" data-open-client-statement="${escapeHtml(invoice.clientId || "")}">كشف الحساب</button>
        </div>
        <section class="drawer-summary">
          <div><span>الإجمالي</span><strong>${money(ToxStore.invoiceNet(invoice), state)}</strong></div>
          <div><span>المدفوع</span><strong class="text-green">${money(invoice.paidUsd, state)}</strong></div>
          <div><span>المتبقي</span><strong class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
          <div><span>الحالة</span>${badge(status.label, status.tone)}</div>
        </section>
        <section class="drawer-block">
          <h3>تفاصيل المنتجات</h3>
          <div class="client-table-wrap">
            <table class="client-fast-table compact">
              <thead><tr><th>المنتج</th><th>الكمية</th><th>الوحدة</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead>
              <tbody>
                ${invoiceItems(invoice).map((item) => {
                  const meta = productMetaForItem(item, state);
                  return `
                    <tr>
                      <td class="invoice-product-name"><strong>${escapeHtml(productNameForItem(item, state))}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</td>
                      <td>${escapeHtml(item.qty ?? item.quantity ?? 0)}</td>
                      <td>${escapeHtml(cleanText(item.unitName || "-"))}</td>
                      <td>${money(item.priceUsd, state)}</td>
                      <td>${money(item.discountUsd, state)}</td>
                      <td><strong>${money(item.totalUsd, state)}</strong></td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="6">لا توجد منتجات داخل هذه الفاتورة</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="drawer-block">
          <h3>خطة الأقساط</h3>
          <div class="client-table-wrap">
            <table class="client-fast-table compact">
              <thead><tr><th>القسط</th><th>الاستحقاق</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
              <tbody>
                ${invoiceSchedule(invoice).map((item) => {
                  const statusItem = installmentStatus(item);
                  return `
                    <tr>
                      <td>${number(item.number)}</td>
                      <td>${formatDate(item.dueDate, state)}</td>
                      <td>${money(item.amountUsd, state)}</td>
                      <td class="text-green">${money(item.paidUsd, state)}</td>
                      <td class="text-red">${money(installmentRemaining(item), state)}</td>
                      <td>${badge(statusItem.label, statusItem.tone)}</td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="6">هذه الفاتورة ليست بنظام أقساط</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="drawer-block">
          <h3>سجل التسديدات</h3>
          <div class="client-table-wrap">
            <table class="client-fast-table compact">
              <thead><tr><th>التاريخ</th><th>المبلغ</th><th>طريقة الدفع</th><th>الموظف</th><th>ملاحظات</th></tr></thead>
              <tbody>
                ${payments.map((payment) => `
                  <tr>
                    <td>${formatDate(payment.receivedAt || payment.createdAt, state)}</td>
                    <td class="text-green">${money(payment.amountUsd, state)}</td>
                    <td>${payment.paymentKind === "installment" ? "قسط" : "دفعة"}</td>
                    <td>${escapeHtml(payment.employeeName || payment.userName || "-")}</td>
                    <td>${escapeHtml(payment.note || "-")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="5">لا توجد تسديدات مرتبطة مباشرة بهذه الفاتورة</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="drawer-block">
          <h3>معلومات الكفيل</h3>
          <div class="guarantor-panel">
            <span>${escapeHtml(invoice.guarantorName || invoice.installmentPlan?.guarantorName || "غير مسجل")}</span>
            <span>${escapeHtml(invoice.guarantorPhone || invoice.installmentPlan?.guarantorPhone || "-")}</span>
            <button class="button ghost compact-action" type="button" data-open-guarantor-images>عرض المستمسكات</button>
          </div>
        </section>
      </section>
    </div>
  `;
}

function renderInvoiceDrawerV2(invoice, state) {
  if (!invoice) return "";
  const payments = state.clientPayments
    .filter((payment) => (payment.appliedTo || []).some((item) => item.invoiceId === invoice.id))
    .sort((left, right) => new Date(right.receivedAt || right.createdAt || 0) - new Date(left.receivedAt || left.createdAt || 0));
  const status = invoiceStatus(invoice);
  const type = invoiceTypeMeta(invoice);
  const installment = isInstallmentInvoice(invoice);
  const schedule = [...invoiceSchedule(invoice)].sort((left, right) => new Date(left.dueDate || 0) - new Date(right.dueDate || 0));
  const clientName = clientNameForInvoice(invoice, state);
  const items = invoiceItems(invoice);
  return `
    <div class="client-drawer-shell account-invoice-shell" data-client-drawer>
      <div class="client-drawer-backdrop ledger-detail-backdrop" data-close-drawer></div>
      <section class="client-invoice-modal client-invoice-modal-v2 ledger-detail-modal account-invoice-modal" role="dialog" aria-modal="true" aria-label="تفاصيل فاتورة العميل">
        <header class="ledger-detail-header account-invoice-header">
          <div>
            <span class="ledger-detail-kind">${escapeHtml(type.label)}</span>
            <h2>${escapeHtml(invoice.id)}</h2>
            <p>${escapeHtml(clientName)} - ${formatDate(invoice.createdAt, state)}</p>
          </div>
          <button class="button ghost compact-action" type="button" data-close-drawer>إغلاق</button>
        </header>
        <div class="drawer-actions ledger-detail-actions">
          <button class="button ghost compact-action" type="button" data-print-client-invoice="${escapeHtml(invoice.id)}">طباعة الفاتورة</button>
          <button class="button ghost compact-action" type="button" data-edit-client-invoice="${escapeHtml(invoice.id)}">تعديل</button>
          <button class="button primary compact-action" type="button" data-open-payment-for-invoice="${escapeHtml(invoice.id)}">إضافة دفعة</button>
          <button class="button ghost compact-action" type="button" data-print-client-receipt="${escapeHtml(invoice.id)}">طباعة وصل</button>
          <button class="button ghost compact-action" type="button" data-open-client-statement="${escapeHtml(invoice.clientId || "")}">سجل الحساب</button>
        </div>
        <section class="drawer-summary drawer-summary-v2 ledger-detail-summary">
          <div><span>التصنيف</span>${badge(type.label, type.tone)}</div>
          <div><span>الإجمالي</span><strong>${money(ToxStore.invoiceNet(invoice), state)}</strong></div>
          <div><span>المدفوع</span><strong class="text-green">${money(invoice.paidUsd, state)}</strong></div>
          <div><span>المتبقي</span><strong class="text-red">${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
          <div><span>الحالة</span><strong><span class="ledger-status ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span></strong></div>
          <div><span>عدد المنتجات</span><strong>${items.length}</strong></div>
        </section>
        <section class="drawer-block ledger-detail-section">
          <div class="ledger-detail-section-title">
            <h3>تفاصيل المنتجات</h3>
            <span>${items.length} صنف</span>
          </div>
          <div class="client-table-wrap ledger-detail-table-wrap">
            <table class="client-fast-table compact ledger-detail-table">
              <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الوحدة</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead>
              <tbody>
                ${items.map((item, index) => {
                  const meta = productMetaForItem(item, state);
                  return `
                    <tr>
                      <td>${index + 1}</td>
                      <td class="invoice-product-name"><strong>${escapeHtml(productNameForItem(item, state))}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</td>
                      <td>${escapeHtml(item.qty ?? item.quantity ?? 0)}</td>
                      <td>${escapeHtml(cleanText(item.unitName || "-"))}</td>
                      <td>${money(item.priceUsd, state)}</td>
                      <td>${money(item.discountUsd, state)}</td>
                      <td><strong>${money(item.totalUsd, state)}</strong></td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="7">لا توجد منتجات داخل هذه الفاتورة</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        ${installment ? `
          <section class="drawer-block drawer-installment-block ledger-detail-section">
            <div class="ledger-detail-section-title">
              <h3>خطة الأقساط</h3>
              <span>${schedule.length} قسط</span>
            </div>
            <div class="client-table-wrap ledger-detail-table-wrap">
              <table class="client-fast-table compact ledger-detail-table">
                <thead><tr><th>القسط</th><th>الاستحقاق</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
                <tbody>
                  ${schedule.map((item) => {
                    const statusItem = installmentStatus(item);
                    return `
                      <tr>
                        <td>${number(item.number)}</td>
                        <td>${formatDate(item.dueDate, state)}</td>
                        <td>${money(item.amountUsd, state)}</td>
                        <td class="text-green">${money(item.paidUsd, state)}</td>
                        <td class="text-red">${money(installmentRemaining(item), state)}</td>
                        <td><span class="ledger-status ${escapeHtml(statusItem.tone)}">${escapeHtml(statusItem.label)}</span></td>
                      </tr>
                    `;
                  }).join("") || `<tr><td colspan="6">لا توجد أقساط مسجلة لهذه الفاتورة</td></tr>`}
                </tbody>
              </table>
            </div>
          </section>
        ` : ""}
        <section class="drawer-block ledger-detail-section">
          <div class="ledger-detail-section-title">
            <h3>سجل التسديدات</h3>
            <span>${payments.length} حركة</span>
          </div>
          <div class="client-table-wrap ledger-detail-table-wrap">
            <table class="client-fast-table compact ledger-detail-table">
              <thead><tr><th>التاريخ</th><th>المبلغ</th><th>طريقة الدفع</th><th>الموظف</th><th>ملاحظات</th></tr></thead>
              <tbody>
                ${payments.map((payment) => `
                  <tr>
                    <td>${formatDate(payment.receivedAt || payment.createdAt, state)}</td>
                    <td class="text-green">${money(payment.amountUsd, state)}</td>
                    <td>${payment.paymentKind === "installment" ? "قسط" : payment.paymentKind === "direct" ? "دين مباشر" : "دفعة فاتورة"}</td>
                    <td>${escapeHtml(payment.employeeName || payment.userName || "-")}</td>
                    <td>${escapeHtml(payment.note || "-")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="5">لا توجد تسديدات مرتبطة مباشرة بهذه الفاتورة</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        ${installment ? `
          <section class="drawer-block ledger-detail-section">
            <div class="ledger-detail-section-title">
              <h3>معلومات الكفيل</h3>
              <span>ضمان الأقساط</span>
            </div>
            <div class="guarantor-panel ledger-guarantor-card">
              <span>الكفيل</span>
              <strong>${escapeHtml(invoice.guarantorName || invoice.installmentPlan?.guarantorName || "غير مسجل")}</strong>
              <small>${escapeHtml(invoice.guarantorPhone || invoice.installmentPlan?.guarantorPhone || "-")}</small>
              <button class="button ghost compact-action" type="button" data-open-guarantor-images>عرض المستمسكات</button>
            </div>
          </section>
        ` : ""}
      </section>
    </div>
  `;
}

function openInvoiceDrawer(invoiceId) {
  selectedInvoiceId = invoiceId;
  const state = ToxStore.getState();
  document.querySelector("[data-client-drawer]")?.remove();
  const root = document.createElement("div");
  root.innerHTML = renderInvoiceDrawerV2(state.invoices.find((invoice) => invoice.id === invoiceId), state);
  const drawer = root.firstElementChild;
  if (!drawer) return;
  document.body.appendChild(drawer);
  bindDrawerEvents();
}

function closeInvoiceDrawer() {
  selectedInvoiceId = "";
  document.querySelector("[data-client-drawer]")?.remove();
}

function clientDeleteFailureMessage(reason) {
  const messages = {
    CLIENT_HAS_DEBT: "لا يمكن حذف العميل لأن عليه رصيد قائم.",
    CLIENT_HAS_INSTALLMENTS: "لا يمكن حذف العميل لأن لديه أقساط غير مسددة.",
    CLIENT_HAS_SUSPENDED: "لا يمكن حذف العميل لأن لديه فواتير معلقة.",
    NO_CLIENT: "لم يتم العثور على العميل."
  };
  return messages[reason] || "تعذر حذف العميل حالياً.";
}

function openClientDeleteModal(clientId) {
  const state = ToxStore.getState();
  const client = state.clients.find((entry) => entry.id === clientId);
  if (!client) {
    showNotice("لم يتم العثور على العميل", "error");
    return;
  }
  const deleteInfo = clientDeleteInfo(client, state);
  if (!deleteInfo.canDelete) {
    showNotice(deleteInfo.reason, "warning");
    return;
  }
  document.querySelector("[data-client-delete-root]")?.remove();
  const root = document.createElement("div");
  root.className = "client-modal-shell";
  root.dataset.clientDeleteRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-client-delete></div>
    <form class="client-pay-modal client-delete-modal" data-client-delete-modal>
      <header>
        <div><span>حذف حساب عميل</span><h2>${escapeHtml(client.name)}</h2></div>
        <button class="button ghost compact-action" type="button" data-close-client-delete>إغلاق</button>
      </header>
      <section class="client-modal-summary">
        <div><span>الرصيد</span><strong>${money(clientMetrics(client, state).totalDebt, state)}</strong></div>
        <div><span>الأقساط المفتوحة</span><strong>0</strong></div>
        <div><span>الحالة</span><strong>جاهز للحذف</strong></div>
      </section>
      <p class="client-delete-warning">${escapeHtml(deleteInfo.reason)} لن تُحذف الفواتير أو الدفعات، فقط سيتم حذف بطاقة العميل من القائمة.</p>
      <div class="client-delete-actions">
        <button class="button danger" type="submit">تأكيد حذف العميل</button>
        <button class="button ghost" type="button" data-close-client-delete>إلغاء</button>
      </div>
    </form>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-client-delete]").forEach((item) => item.addEventListener("click", () => root.remove()));
  root.querySelector("[data-client-delete-modal]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = ToxStore.deleteClient(clientId);
    if (!result?.ok) {
      showNotice(clientDeleteFailureMessage(result?.reason), "error");
      return;
    }
    activeClientId = "";
    root.remove();
    showNotice("تم حذف العميل مع الحفاظ على سجل الفواتير والدفعات.", "success");
    renderClients(ToxStore.getState());
  });
}

function openPaymentModal({ clientId, invoiceId = "", installmentNumber = "", amountUsd = 0, title = "تسجيل دفعة" }) {
  const state = ToxStore.getState();
  const client = state.clients.find((entry) => entry.id === clientId);
  const invoice = invoiceId ? state.invoices.find((entry) => entry.id === invoiceId) : null;
  const targetDebt = invoice ? ToxStore.invoiceDebt(invoice) : directClientDebt(clientId, state);
  const suggestedAmount = Math.max(0, amountUsd || targetDebt);
  document.querySelector("[data-client-modal-root]")?.remove();
  const root = document.createElement("div");
  root.className = "client-modal-shell";
  root.dataset.clientModalRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-client-modal></div>
    <form class="client-pay-modal client-payment-modal-pro" data-client-pay-modal>
      <header>
        <div><span>${invoice ? "مرتبطة بفاتورة" : "دفعة دين مباشر"}</span><h2>${escapeHtml(title)}</h2></div>
        <button class="button ghost compact-action" type="button" data-close-client-modal>إغلاق</button>
      </header>
      <section class="client-modal-summary">
        <div><span>العميل</span><strong>${escapeHtml(client?.name || clientNameForInvoice(invoice || {}, state))}</strong></div>
        <div><span>المتبقي</span><strong>${money(targetDebt, state)}</strong></div>
        <div><span>التطبيق</span><strong>${invoice ? invoice.id : "الفواتير المباشرة فقط"}</strong></div>
      </section>
      <label class="pay-amount-field"><span>مبلغ الدفع</span><input type="number" min="0.01" step="0.01" name="amount" value="${ToxStore.convertUsd(suggestedAmount, state.currency).toFixed(state.currency === "IQD" ? 0 : 2)}" required /></label>
      <div class="client-modal-grid">
        <label><span>العملة</span><select name="currency"><option value="IQD" ${state.currency === "IQD" ? "selected" : ""}>IQD</option><option value="USD" ${state.currency === "USD" ? "selected" : ""}>USD</option></select></label>
        <label><span>تاريخ الدفع</span><input type="date" name="receivedAt" value="${new Date().toISOString().slice(0, 10)}" /></label>
      </div>
      <label><span>ملاحظات</span><input name="note" value="${installmentNumber ? `دفع قسط ${installmentNumber}` : invoice ? `دفعة على الفاتورة ${invoice.id}` : "دفعة عميل"}" /></label>
      <button class="button primary" type="submit">تأكيد الدفع</button>
    </form>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-client-modal]").forEach((item) => item.addEventListener("click", () => root.remove()));
  root.querySelector("[data-client-pay-modal]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    let result;
    if (invoiceId && installmentNumber) {
      result = ToxStore.payClientInstallment({
        invoiceId,
        installmentNumber,
        amount: data.get("amount"),
        currency: data.get("currency"),
        note: data.get("note"),
        receivedAt: data.get("receivedAt"),
      });
    } else {
      const payment = ToxStore.addClientPayment({
        clientId,
        amount: data.get("amount"),
        currency: data.get("currency"),
        note: data.get("note"),
        receivedAt: data.get("receivedAt") || new Date().toISOString().slice(0, 10),
        allocationMode: invoiceId ? "invoice" : "direct",
        invoiceId,
      });
      result = payment ? { ok: true } : { ok: false };
    }
    if (!result.ok) {
      showNotice("تعذر تسجيل الدفعة", "error");
      return;
    }
    showNotice("تم تسجيل الدفعة وتحديث رصيد العميل مباشرة", "success");
    root.remove();
    if (selectedInvoiceId) {
      const openId = selectedInvoiceId;
      closeInvoiceDrawer();
      openInvoiceDrawer(openId);
    }
    renderClients(ToxStore.getState());
  });
}

function openClientCreateModal() {
  document.querySelector("[data-client-create-modal-root]")?.remove();
  const root = document.createElement("div");
  root.className = "client-modal-shell";
  root.dataset.clientCreateModalRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-client-create></div>
    <form class="client-pay-modal client-create-modal client-create-modal-pro" data-client-create-modal>
      <header>
        <div><span>ملف مالي جديد</span><h2>إنشاء حساب عميل</h2></div>
        <button class="button ghost compact-action" type="button" data-close-client-create>إغلاق</button>
      </header>
      <section class="client-create-intro">
        <strong>بيانات العميل</strong>
        <span>يفتح الحساب مع بيانات الاتصال والرصيد الافتتاحي فقط، وبعد الحفظ تختار اسم العميل من القائمة لعرض التفاصيل.</span>
      </section>
      <label class="wide"><span>اسم العميل</span><input name="name" required autofocus placeholder="مثال: أحمد علي" /></label>
      <label><span>رقم الهاتف</span><input name="phone" placeholder="07xx xxx xxxx" /></label>
      <label><span>العنوان</span><input name="address" placeholder="المنطقة / أقرب نقطة" /></label>
      <label><span>الرصيد الافتتاحي</span><input type="number" min="0" step="0.01" name="openingBalance" value="0" /></label>
      <label><span>نوع الرصيد</span><select name="openingBalanceType"><option value="debit">دين على الزبون</option><option value="credit">رصيد لصالح الزبون</option></select></label>
      <label class="wide"><span>ملاحظة مالية</span><input name="financialNote" placeholder="اتفاق الدفع أو ملاحظة محاسبية" /></label>
      <label class="wide"><span>ملاحظة عامة</span><input name="note" placeholder="أي تفاصيل مهمة عن العميل" /></label>
      <button class="button primary" type="submit">حفظ الحساب</button>
    </form>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-client-create]").forEach((item) => item.addEventListener("click", () => root.remove()));
  root.querySelector("[data-client-create-modal]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = ToxStore.addClient({
      name: data.get("name"),
      phone: data.get("phone"),
      address: data.get("address"),
      openingBalance: data.get("openingBalance"),
      openingBalanceType: data.get("openingBalanceType"),
      financialNote: data.get("financialNote"),
      note: data.get("note"),
    });
    if (!id) {
      showNotice("يرجى إدخال اسم العميل", "error");
      return;
    }
    activeClientId = "";
    activeClientTab = "overview";
    root.remove();
    showNotice("تم إنشاء الحساب. اضغط على اسم العميل من القائمة لعرض التفاصيل", "success");
    renderClients(ToxStore.getState());
  });
}

function openInvoiceEditModal(invoiceId) {
  const state = ToxStore.getState();
  const invoice = state.invoices.find((entry) => entry.id === invoiceId);
  if (!invoice) return;
  document.querySelector("[data-client-edit-invoice-root]")?.remove();
  const root = document.createElement("div");
  root.className = "client-modal-shell";
  root.dataset.clientEditInvoiceRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-invoice-edit></div>
    <form class="client-pay-modal client-create-modal client-edit-invoice-modal" data-client-edit-invoice>
      <header>
        <div><span>تحديث بيانات الفاتورة</span><h2>${escapeHtml(invoice.id)}</h2></div>
        <button class="button ghost compact-action" type="button" data-close-invoice-edit>إغلاق</button>
      </header>
      <section class="client-modal-summary">
        <div><span>العميل</span><strong>${escapeHtml(clientNameForInvoice(invoice, state))}</strong></div>
        <div><span>الصافي</span><strong>${money(ToxStore.invoiceNet(invoice), state)}</strong></div>
        <div><span>المتبقي</span><strong>${money(ToxStore.invoiceDebt(invoice), state)}</strong></div>
      </section>
      <label><span>اسم العميل في الفاتورة</span><input name="customerName" value="${escapeHtml(invoice.customerName || "")}" /></label>
      <label><span>تاريخ الاستحقاق</span><input type="date" name="dueDate" value="${escapeHtml(invoice.dueDate || "")}" /></label>
      <label><span>اسم الكفيل</span><input name="guarantorName" value="${escapeHtml(invoice.guarantorName || invoice.installmentPlan?.guarantorName || "")}" /></label>
      <label><span>هاتف الكفيل</span><input name="guarantorPhone" value="${escapeHtml(invoice.guarantorPhone || invoice.installmentPlan?.guarantorPhone || "")}" /></label>
      <label class="wide"><span>ملاحظة الفاتورة</span><input name="note" value="${escapeHtml(invoice.note || "")}" /></label>
      <button class="button primary" type="submit">حفظ التعديل</button>
    </form>
  `;
  document.body.appendChild(root);
  root.querySelectorAll("[data-close-invoice-edit]").forEach((item) => item.addEventListener("click", () => root.remove()));
  root.querySelector("[data-client-edit-invoice]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = ToxStore.updateInvoice(invoiceId, {
      customerName: data.get("customerName"),
      dueDate: data.get("dueDate"),
      guarantorName: data.get("guarantorName"),
      guarantorPhone: data.get("guarantorPhone"),
      note: data.get("note"),
    });
    if (!result.ok) {
      showNotice("تعذر تعديل الفاتورة", "error");
      return;
    }
    root.remove();
    showNotice("تم تحديث بيانات الفاتورة", "success");
    if (selectedInvoiceId) {
      const openId = selectedInvoiceId;
      closeInvoiceDrawer();
      openInvoiceDrawer(openId);
    }
    renderClients(ToxStore.getState());
  });
}

function bindDrawerEvents() {
  document.querySelectorAll("[data-close-drawer]").forEach((button) => {
    button.addEventListener("click", closeInvoiceDrawer);
  });
  document.querySelectorAll("[data-print-client-invoice]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = ToxStore.getState();
      const invoice = state.invoices.find((entry) => entry.id === button.dataset.printClientInvoice);
      if (invoice) {
        if (window.ToxPrint?.render) ToxPrint.render("saleInvoice", invoice, state);
        else openPrintWindow(invoicePrintHtml(state, invoice));
      }
    });
  });
  document.querySelectorAll("[data-print-client-receipt]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = ToxStore.getState();
      const invoice = state.invoices.find((entry) => entry.id === button.dataset.printClientReceipt);
      if (invoice) {
        if (window.ToxPrint?.render) ToxPrint.render("clientReceipt", invoice, state);
        else openPrintWindow(receiptPrintHtml(state, invoice));
      }
    });
  });
  document.querySelectorAll("[data-edit-client-invoice]").forEach((button) => {
    button.addEventListener("click", () => openInvoiceEditModal(button.dataset.editClientInvoice));
  });
  document.querySelectorAll("[data-open-client-statement]").forEach((button) => {
    button.addEventListener("click", () => {
      const clientId = button.dataset.openClientStatement;
      const state = ToxStore.getState();
      const client = state.clients.find((entry) => entry.id === clientId);
      if (!client) {
        showNotice("لا يوجد عميل مرتبط بهذه الفاتورة", "info");
        return;
      }
      activeClientId = clientId;
      activeClientTab = "statement";
      closeInvoiceDrawer();
      renderClients(state);
    });
  });
  document.querySelectorAll("[data-open-payment-for-invoice]").forEach((button) => {
    button.addEventListener("click", () => {
      const invoice = ToxStore.getState().invoices.find((entry) => entry.id === button.dataset.openPaymentForInvoice);
      if (!invoice) return;
      const next = invoiceSchedule(invoice).find((item) => !installmentPaid(item));
      openPaymentModal({
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        installmentNumber: next?.number || "",
        amountUsd: next ? installmentRemaining(next) : ToxStore.invoiceDebt(invoice),
        title: next ? `تسديد قسط ${next.number} - ${invoice.id}` : `دفعة للفاتورة ${invoice.id}`,
      });
    });
  });
  document.querySelector("[data-open-guarantor-images]")?.addEventListener("click", () => {
    showNotice("لا توجد صور مستمسكات محفوظة لهذه الفاتورة", "info");
  });
}

function bindProfileEvents(client, state) {
  document.querySelectorAll("[data-client-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeClientTab = button.dataset.clientTab;
      invoicePage = 1;
      paymentPage = 1;
      statementPage = 1;
      renderClients(ToxStore.getState());
    });
  });
  document.querySelectorAll("[data-client-tab-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      activeClientTab = button.dataset.clientTabJump;
      renderClients(ToxStore.getState());
    });
  });
  document.querySelectorAll("[data-page-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.pageTarget;
      const value = Math.max(1, number(button.dataset.pageValue));
      if (target === "invoices") invoicePage = value;
      if (target === "payments") paymentPage = value;
      if (target === "statement") statementPage = value;
      renderClients(ToxStore.getState());
    });
  });
  document.querySelectorAll("[data-account-log-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      accountLogFilter = button.dataset.accountLogFilter || "all";
      statementPage = 1;
      renderClients(ToxStore.getState());
    });
  });
  document.querySelectorAll("[data-open-invoice]").forEach((button) => {
    button.addEventListener("click", () => openInvoiceDrawer(button.dataset.openInvoice));
  });
  document.querySelectorAll("[data-pay-installment]").forEach((button) => {
    button.addEventListener("click", () => {
      const invoice = state.invoices.find((entry) => entry.id === button.dataset.payInstallment);
      const item = invoiceSchedule(invoice).find((entry) => number(entry.number) === number(button.dataset.installmentNumber));
      if (!invoice || !item || installmentPaid(item)) return;
      openPaymentModal({
        clientId: client.id,
        invoiceId: invoice.id,
        installmentNumber: item.number,
        amountUsd: installmentRemaining(item),
        title: `تسديد قسط ${item.number} - ${invoice.id}`,
      });
    });
  });
  document.querySelectorAll("[data-open-general-payment]").forEach((button) => {
    button.addEventListener("click", () => {
      openPaymentModal({
        clientId: button.dataset.openGeneralPayment,
        amountUsd: directClientDebt(button.dataset.openGeneralPayment, ToxStore.getState()),
        title: "دفعة دين مباشر",
      });
    });
  });
  document.querySelectorAll("[data-print-client-statement]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = ToxStore.getState();
      const target = state.clients.find((entry) => entry.id === button.dataset.printClientStatement);
      if (target) {
        if (window.ToxPrint?.render) ToxPrint.render("clientStatement", target, state);
        else openPrintWindow(statementPrintHtml(state, target));
      }
    });
  });
  document.querySelectorAll("[data-delete-client]").forEach((button) => {
    button.addEventListener("click", () => openClientDeleteModal(button.dataset.deleteClient));
  });
}

function renderClients(state) {
  const hashedClient = clientFromHash();
  if (hashedClient && state.clients.some((client) => client.id === hashedClient)) {
    activeClientId = hashedClient;
    history.replaceState(null, "", location.pathname);
  }
  if (!state.clients.some((client) => client.id === activeClientId)) activeClientId = "";
  document.querySelector("[data-client-count]").textContent = state.clients.length;
  const query = (clientSearch?.value || "").trim().toLowerCase();
  const filteredClients = state.clients.filter((client) => {
    const metrics = clientMetrics(client, state);
    return !query || `${client.name} ${client.phone} ${client.address || ""} ${metrics.totalDebt}`.toLowerCase().includes(query);
  });
  renderClientList(filteredClients, state);

  const client = state.clients.find((entry) => entry.id === activeClientId);
  if (!client) {
    profile.innerHTML = `<div class="client-empty-state client-select-empty">اختر اسم عميل من القائمة لعرض الحساب والكشف والأقساط. بعد إنشاء الحساب تبقى المعلومات مخفية حتى تضغط على اسم العميل.</div>`;
    return;
  }
  profile.innerHTML = profileHeaderV2(client, state) + tabContent(client, state);
  bindProfileEvents(client, state);
}

clientForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = ToxStore.addClient({
    name: document.querySelector("[data-client-name]").value,
    phone: document.querySelector("[data-client-phone]").value,
    address: document.querySelector("[data-client-address]")?.value || "",
    openingBalance: document.querySelector("[data-client-opening-balance]")?.value || 0,
    openingBalanceType: document.querySelector("[data-client-opening-type]")?.value || "debit",
    financialNote: document.querySelector("[data-client-financial-note]")?.value || "",
  });
  if (id) {
    activeClientId = "";
    activeClientTab = "overview";
    showNotice("تم إضافة العميل. اضغط على اسمه من القائمة لعرض الحساب", "success");
  }
  clientForm.reset();
});

clientSearch?.addEventListener("input", () => renderClients(ToxStore.getState()));
document.querySelector("[data-open-client-create]")?.addEventListener("click", openClientCreateModal);
window.openToxClientPaymentModal = openPaymentModal;

ToxStore.subscribe((state) => {
  renderClients(state);
  if (selectedInvoiceId) {
    const openId = selectedInvoiceId;
    closeInvoiceDrawer();
    openInvoiceDrawer(openId);
  }
});
renderClients(ToxStore.getState());
