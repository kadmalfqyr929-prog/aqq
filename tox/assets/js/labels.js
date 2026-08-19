const labelForm = document.querySelector("[data-label-form]");
const labelWarehouseSelect = document.querySelector("[data-label-warehouse]");
const labelSearchInput = document.querySelector("[data-label-search]");
const labelProductSelect = document.querySelector("[data-label-product]");
const labelUnitSelect = document.querySelector("[data-label-unit]");
const labelCopiesInput = document.querySelector("[data-label-copies]");
const labelPreview = document.querySelector("[data-label-preview]");

function labelQueryProductId() {
  return new URLSearchParams(window.location.search).get("productId");
}

function labelQueryUnitId() {
  return new URLSearchParams(window.location.search).get("unitId");
}

function labelEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function currentLabelProduct(state = ToxStore.getState()) {
  return state.products.find((product) => product.id === labelProductSelect.value);
}

function labelSearchFields(product, state) {
  return [
    product.name,
    product.brand,
    ToxStore.getWarehouseName(product.warehouseId),
    ...(product.units || []).map((unit) => unit.name)
  ];
}

function filteredLabelProducts(state) {
  const warehouseId = labelWarehouseSelect?.value || "__all__";
  const query = (labelSearchInput?.value || "").trim().toLowerCase();
  const searchableProducts = state.products || [];
  return state.products.filter((product) => {
    if (warehouseId !== "__all__" && product.warehouseId !== warehouseId) return false;
    return ToxStore.productMatchesSmartSearch(product, query, (entry) => labelSearchFields(entry, state), searchableProducts);
  });
}

function currentLabelUnit(product) {
  if (!product) return null;
  return ToxStore.getProductUnit(product, labelUnitSelect.value) || product.units?.[0] || null;
}

function currentLabelUnits(product) {
  if (!product) return [];
  if (labelUnitSelect.value === "__all__") return product.units || [];
  return [currentLabelUnit(product)].filter(Boolean);
}

function labelCard(product, unit, state) {
  if (!product) {
    return `<div class="warehouse-empty">${labelEscape(t("noProducts", state.lang))}</div>`;
  }

  const labelUnit = unit || product.units?.[0] || null;
  const unitName = labelUnit?.name || ToxStore.productBaseUnit(product);
  const unitBarcode = String(labelUnit?.barcode || product.barcode || "").trim();
  const price = ToxStore.formatProductMoney(product, labelUnit?.priceUsd || 0);
  return `
    <article class="print-label-card">
      <div class="print-label-top">
        <span class="kind-preview-badge">${labelEscape(ToxStore.productKindLabel(product, state.lang))}</span>
        <strong>${labelEscape(product.name)}</strong>
        <small>${labelEscape(unitName)}</small>
      </div>
      <div class="print-label-price">
        <span>${labelEscape(t("labelUnitPrice", state.lang))}</span>
        <strong>${labelEscape(price)}</strong>
      </div>
      <div class="print-label-barcode">${barcodeSvg(unitBarcode)}</div>
      <div class="print-label-meta">
        <span>${labelEscape(t("productCode", state.lang))}: ${labelEscape(unitBarcode || "-")}</span>
        <span>${labelEscape(t("unit", state.lang))}: ${labelEscape(unitName)}</span>
        <span>${labelEscape(t("labelWarehouse", state.lang))}: ${labelEscape(ToxStore.getWarehouseName(product.warehouseId))}</span>
      </div>
    </article>
  `;
}

function hydrateLabelProducts(state) {
  const selected = labelProductSelect.value || labelQueryProductId();
  const products = filteredLabelProducts(state);
  labelProductSelect.innerHTML = products
    .map((product) => `<option value="${labelEscape(product.id)}">${labelEscape(`${product.name} - ${ToxStore.getWarehouseName(product.warehouseId)}`)}</option>`)
    .join("");

  if (selected && products.some((product) => product.id === selected)) {
    labelProductSelect.value = selected;
  } else if (products[0]) {
    labelProductSelect.value = products[0].id;
  }
}

function hydrateLabelWarehouses(state) {
  if (!labelWarehouseSelect) return;
  const selected = labelWarehouseSelect.value || "__all__";
  const allLabel = state.lang === "ar" ? "كل المستودعات" : "All warehouses";
  labelWarehouseSelect.innerHTML = `<option value="__all__">${labelEscape(allLabel)}</option>${state.warehouses
    .map((warehouse) => `<option value="${labelEscape(warehouse.id)}">${labelEscape(warehouse.name)}</option>`)
    .join("")}`;
  labelWarehouseSelect.value = selected === "__all__" || state.warehouses.some((warehouse) => warehouse.id === selected)
    ? selected
    : "__all__";
}

function hydrateLabelUnits(state) {
  const product = currentLabelProduct(state);
  const selected = labelUnitSelect.value || labelQueryUnitId() || "__all__";
  const allUnitsLabel = state.lang === "ar" ? "كل الوحدات" : "All units";
  const unitOptions = (product?.units || [])
    .map((unit, index) => {
      const unitLabel = `${unit.name}${index === 0 ? ` - ${t("baseUnit", state.lang)}` : ""}`;
      return `<option value="${labelEscape(unit.id)}">${labelEscape(unitLabel)}</option>`;
    })
    .join("");
  labelUnitSelect.innerHTML = `<option value="__all__">${labelEscape(allUnitsLabel)}</option>${unitOptions}`;

  if (selected === "__all__" || (selected && (product?.units || []).some((unit) => unit.id === selected))) {
    labelUnitSelect.value = selected;
  }
}

function renderLabelPreview(state) {
  const product = currentLabelProduct(state);
  const units = currentLabelUnits(product);
  labelPreview.innerHTML = units.length
    ? units.map((unit) => labelCard(product, unit, state)).join("")
    : labelCard(product, null, state);
}

function printLabels(product, units, copies, state) {
  if (!product) return;
  const labelUnits = units?.length ? units : [product.units?.[0]].filter(Boolean);
  const cards = labelUnits
    .map((unit) => Array.from({ length: copies }, () => labelCard(product, unit, state)).join(""))
    .join("");
  const printWindow = window.open("", "_blank", "width=980,height=760");
  if (!printWindow) return;

  printWindow.document.write(`<!doctype html>
<html lang="${state.lang}" dir="${state.dir}">
<head>
  <meta charset="utf-8">
  <title>${product.name}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:20px;background:#f3f4f6;font-family:"Segoe UI","Noto Kufi Arabic",Tahoma,sans-serif;color:#111827}
    .sheet{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
    .print-label-card{display:grid;gap:14px;padding:18px;border:1px solid #d1d5db;border-radius:20px;background:#fff;break-inside:avoid;box-shadow:0 10px 30px rgba(15,23,42,.08)}
    .print-label-top{display:grid;gap:6px}
    .print-label-top strong{font-size:28px;line-height:1.1}
    .print-label-top small,.print-label-price span,.print-label-meta span{color:#6b7280}
    .kind-preview-badge{display:inline-flex;width:fit-content;padding:6px 12px;border-radius:999px;background:#fee2e2;color:#9f1239;font-weight:800}
    .print-label-price{display:flex;justify-content:space-between;gap:10px;align-items:end;padding:10px 0;border-top:1px dashed #e5e7eb;border-bottom:1px dashed #e5e7eb}
    .print-label-price strong{font-size:26px;color:#9f1239}
    .print-label-barcode svg{width:100%;max-width:none;height:82px;border:1px solid #e5e7eb;border-radius:14px;background:#fff}
    .print-label-meta{display:grid;gap:6px;font-size:13px}
    @media print {body{padding:0;background:#fff}.sheet{gap:10px}.print-label-card{box-shadow:none}}
  </style>
</head>
<body>
  <main class="sheet">${cards}</main>
  <script>window.print()</script>
</body>
</html>`);
  printWindow.document.close();
  playUiSound("print");
}

labelProductSelect.addEventListener("change", () => {
  const state = ToxStore.getState();
  hydrateLabelUnits(state);
  renderLabelPreview(state);
  playUiSound("tap");
});

labelWarehouseSelect?.addEventListener("change", () => {
  const state = ToxStore.getState();
  hydrateLabelProducts(state);
  hydrateLabelUnits(state);
  renderLabelPreview(state);
  playUiSound("tap");
});

labelSearchInput?.addEventListener("input", () => {
  const state = ToxStore.getState();
  hydrateLabelProducts(state);
  hydrateLabelUnits(state);
  renderLabelPreview(state);
});

labelUnitSelect.addEventListener("change", () => {
  renderLabelPreview(ToxStore.getState());
  playUiSound("tap");
});

labelCopiesInput.addEventListener("change", () => playUiSound("tap"));

labelForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const state = ToxStore.getState();
  const product = currentLabelProduct(state);
  const units = currentLabelUnits(product);
  const copies = Math.min(48, Math.max(1, Number(labelCopiesInput.value || 1)));
  labelCopiesInput.value = copies;
  printLabels(product, units, copies, state);
});

ToxStore.subscribe((state) => {
  hydrateLabelWarehouses(state);
  hydrateLabelProducts(state);
  hydrateLabelUnits(state);
  renderLabelPreview(state);
});
