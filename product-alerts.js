const alertSearch = document.querySelector("[data-alert-search]");
const alertWarehouse = document.querySelector("[data-alert-warehouse]");
const alertType = document.querySelector("[data-alert-type]");
const alertList = document.querySelector("[data-alert-list]");
const alertTotal = document.querySelector("[data-alert-total]");

function alertEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function hasProductBarcode(product) {
  if (String(product.barcode || "").trim()) return true;
  return (product.units || []).some((unit) => String(unit.barcode || "").trim());
}

function hasProductImage(product) {
  return Boolean(String(product.image || product.imageUrl || "").trim());
}

function alertText(state) {
  const ar = state.lang === "ar";
  return {
    out: ar ? "نفاد المخزون" : "Out of stock",
    low: ar ? "مخزون منخفض" : "Low stock",
    expiryExpired: ar ? "صلاحية منتهية" : "Expired",
    expirySoon: ar ? "صلاحية قريبة" : "Expiring soon",
    noBarcode: ar ? "منتج بلا باركود" : "Product without barcode",
    noImage: ar ? "منتج بلا صورة" : "Product without image",
    addBarcode: ar ? "أضف باركود للمنتج أو إحدى وحدات البيع حتى يختفي هذا التنبيه." : "Add a barcode to the product or one sellable unit.",
    addImage: ar ? "أضف صورة واضحة لتمييز المنتج في الكتالوج والاختيار." : "Add an image to identify the product.",
    limit: ar ? "الحد" : "Limit",
    day: ar ? "يوم" : "day",
    view: ar ? "عرض المنتج" : "View product",
    fixBarcode: ar ? "إضافة باركود" : "Add barcode",
    buy: ar ? "شراء المنتج" : "Buy product",
    empty: ar ? "لا توجد تنبيهات مطابقة." : "No matching alerts.",
    allWarehouses: ar ? "كل المستودعات" : "All warehouses",
    separator: " | "
  };
}

function productAlerts(state) {
  const labels = alertText(state);
  const alerts = [];
  state.products.forEach((product) => {
    const stock = Number(product.stockQuantity || 0);
    const threshold = ToxStore.thresholdQuantity(product);
    const warehouse = ToxStore.getWarehouseName(product.warehouseId);
    const base = { product, warehouse, warehouseId: product.warehouseId };

    if (stock <= 0) {
      alerts.push({ ...base, type: "out", tone: "danger", title: labels.out, detail: ToxStore.stockSummary(product), action: labels.buy });
    } else if (stock <= threshold) {
      const thresholdText = ToxStore.stockSummary({ ...product, stockQuantity: product.alertQuantity });
      alerts.push({ ...base, type: "low", tone: "warning", title: labels.low, detail: `${ToxStore.stockSummary(product)} / ${labels.limit} ${thresholdText}`, action: labels.buy });
    }

    const expiryDays = daysUntil(product.expiresAt);
    if (expiryDays !== null && expiryDays < 0) {
      alerts.push({ ...base, type: "expiry", tone: "danger", title: labels.expiryExpired, detail: new Date(product.expiresAt).toLocaleDateString(), action: labels.view });
    } else if (expiryDays !== null && expiryDays <= 30) {
      alerts.push({ ...base, type: "expiry", tone: "warning", title: labels.expirySoon, detail: `${expiryDays} ${labels.day}`, action: labels.view });
    }

    if (!hasProductBarcode(product)) {
      alerts.push({ ...base, type: "barcode", tone: "info", title: labels.noBarcode, detail: labels.addBarcode, action: labels.fixBarcode });
    }
    if (!hasProductImage(product)) {
      alerts.push({ ...base, type: "image", tone: "info", title: labels.noImage, detail: labels.addImage, action: labels.view });
    }
  });
  return alerts;
}

function hydrateAlertWarehouses(state) {
  if (!alertWarehouse) return;
  const selected = alertWarehouse.value || "all";
  const labels = alertText(state);
  alertWarehouse.innerHTML = `<option value="all">${alertEscape(labels.allWarehouses)}</option>${state.warehouses
    .map((warehouse) => `<option value="${alertEscape(warehouse.id)}">${alertEscape(warehouse.name)}</option>`)
    .join("")}`;
  alertWarehouse.value = selected === "all" || state.warehouses.some((warehouse) => warehouse.id === selected) ? selected : "all";
}

function updateAlertCounts(alerts) {
  const counts = alerts.reduce((acc, alert) => {
    acc[alert.type] = (acc[alert.type] || 0) + 1;
    return acc;
  }, {});
  ["out", "low", "expiry", "barcode", "image"].forEach((type) => {
    const node = document.querySelector(`[data-alert-count="${type}"]`);
    if (node) node.textContent = counts[type] || 0;
  });
}

function filteredAlerts(state) {
  const query = (alertSearch?.value || "").trim().toLowerCase();
  const warehouseId = alertWarehouse?.value || "all";
  const type = alertType?.value || "all";
  const all = productAlerts(state);
  const warehouseScoped = all.filter((alert) => warehouseId === "all" || alert.warehouseId === warehouseId);
  const exactBarcodeProducts = query ? ToxStore.exactBarcodeProductMatches?.(query, state.products || []) || [] : [];
  const exactProductIds = new Set(exactBarcodeProducts.map((product) => product.id));
  updateAlertCounts(warehouseScoped);
  return warehouseScoped.filter((alert) => {
    if (type !== "all" && alert.type !== type) return false;
    if (!query) return true;
    if (exactProductIds.size) return exactProductIds.has(alert.product.id);
    return [alert.title, alert.detail, alert.product.name, alert.product.brand, alert.warehouse, ...(alert.product.units || []).map((unit) => unit.name)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function renderAlerts(state = ToxStore.getState()) {
  hydrateAlertWarehouses(state);
  const labels = alertText(state);
  const alerts = filteredAlerts(state);

  if (alertTotal) alertTotal.textContent = alerts.length;
  if (!alertList) return;

  alertList.innerHTML = alerts.length ? alerts.map((alert) => {
    const productTitle = [alert.product.brand, alert.product.name].filter(Boolean).join(" - ") || "-";
    const image = alert.product.image || alert.product.imageUrl || "";
    const actionHref = alert.type === "barcode"
      ? `warehouse.html#warehouses`
      : alert.type === "low" || alert.type === "out"
        ? `purchases.html`
        : `products.html#list`;
    return `
      <article class="product-alert-card" data-tone="${alertEscape(alert.tone)}" data-alert-type="${alertEscape(alert.type)}">
        <div class="product-card-media ${image ? "" : "is-empty"}">
          ${image ? `<img src="${alertEscape(image)}" alt="" />` : `<span>${alertEscape((alert.product.name || "TOX").slice(0, 2))}</span>`}
        </div>
        <div class="product-alert-copy">
          <strong>${alertEscape(alert.title)}</strong>
          <span>${alertEscape(productTitle)}</span>
          <small>${alertEscape(alert.warehouse)}${labels.separator}${alertEscape(alert.detail)}</small>
        </div>
        <div class="toolbar product-alert-actions">
          <a class="button ghost" href="${actionHref}">${alertEscape(alert.action || labels.view)}</a>
          <a class="button ghost" href="products.html#list">${alertEscape(labels.view)}</a>
        </div>
      </article>
    `;
  }).join("") : `<div class="warehouse-empty">${alertEscape(labels.empty)}</div>`;
}

alertSearch?.addEventListener("input", () => renderAlerts(ToxStore.getState()));
alertWarehouse?.addEventListener("change", () => renderAlerts(ToxStore.getState()));
alertType?.addEventListener("change", () => renderAlerts(ToxStore.getState()));
ToxStore.subscribe(renderAlerts);
renderAlerts();
