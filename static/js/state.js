const ToxStore = (() => {
  const exchangeRate = 1460;
  const storageKey = "tox-business-state-v4";
  const settingsKey = "tox-business-settings-v2";
  const generationKey = "tox-business-data-generation";
  const themeIds = window.ToxThemes?.all || ["tox-blue", "noir"];
  const legacyThemeMap = {
    coffee: "summer-orange",
    "neon-blue": "matte-black",
    "teal-slate": "tox-blue",
    "tox-pro": "tox-blue"
  };
  const invoiceDocumentTypes = [
    "directSale",
    "saleInvoice",
    "directPurchase",
    "purchaseInvoice",
    "clientReceipt",
    "clientStatement",
    "supplierStatement",
    "ledgerInvoice"
  ];
  const invoicePrintDefaults = Object.freeze({
    defaultTemplate: "official-a4",
    paperSize: "a4",
    accentColor: "#0f766e",
    fontScale: 100,
    density: "normal",
    logoMode: "mark",
    designer: {
      brand: {
        logoSource: "tox",
        logoImageDataUrl: "",
        logoShape: "rounded",
        logoPosition: "start",
        logoSize: 54,
        logoOpacity: 100,
        showBusinessName: true,
        tagline: ""
      },
      layout: {
        headerStyle: "classic",
        tableStyle: "striped",
        totalStyle: "card",
        borderStyle: "soft",
        marginScale: 100
      },
      typography: {
        fontFamily: "system",
        fontScale: 100
      },
      footer: {
        note: "",
        terms: "",
        showSignature: true,
        showThankYou: false
      }
    },
    showFields: {
      phone: true,
      address: true,
      employee: true,
      barcode: false,
      notes: true,
      signature: true,
      qr: false,
      paidRemaining: true,
      tax: false
    },
    perDocumentType: {
      directSale: { template: "iraqi-thermal-80", paperSize: "thermal-80", density: "compact" },
      saleInvoice: { template: "official-a4", paperSize: "a4", density: "normal" },
      directPurchase: { template: "iraqi-thermal-80", paperSize: "thermal-80", density: "compact" },
      purchaseInvoice: { template: "official-a4", paperSize: "a4", density: "normal" },
      clientReceipt: { template: "receipt-short", paperSize: "thermal-80", density: "compact" },
      clientStatement: { template: "ledger-a4", paperSize: "a4", density: "dense" },
      supplierStatement: { template: "ledger-a4", paperSize: "a4", density: "dense" },
      ledgerInvoice: { template: "official-a4", paperSize: "a4", density: "normal" }
    }
  });
  const installmentProfitDefaults = Object.freeze({
    defaultMode: "percent",
    defaultPercent: 0,
    defaultFixedAmountUsd: 0,
    minProfitAmountUsd: 0,
    maxProfitAmountUsd: 0,
    allowEmployeeProfitEdit: true
  });

  function cloneInvoicePrintDefaults() {
    return JSON.parse(JSON.stringify(invoicePrintDefaults));
  }

  function normalizeInvoicePrintSettings(settings = {}) {
    const base = cloneInvoicePrintDefaults();
    const source = settings && typeof settings === "object" ? settings : {};
    const cleanChoice = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    const cleanTemplate = (value, fallback = "official-a4") => (
      ["thermal-80", "iraqi-thermal-80", "official-a4", "professional-color", "warehouse-dense", "receipt-short", "ledger-a4"].includes(value) ? value : fallback
    );
    const cleanPaperSize = (value, fallback = "a4") => (["a4", "thermal-80"].includes(value) ? value : fallback);
    const cleanDensity = (value, fallback = "normal") => (["compact", "normal", "dense"].includes(value) ? value : fallback);
    const cleanColor = (value) => {
      const color = String(value || "").trim();
      return /^#[0-9a-f]{6}$/i.test(color) ? color : base.accentColor;
    };
    const cleanText = (value, max = 180) => String(value || "").trim().slice(0, max);
    const cleanLogoDataUrl = (value) => {
      const dataUrl = String(value || "").trim();
      if (!dataUrl) return "";
      const isImage = /^data:image\/(?:png|jpe?g|webp|svg\+xml);/i.test(dataUrl);
      return isImage && dataUrl.length <= 450000 ? dataUrl : "";
    };
    const legacyLogoSource = source.logoMode === "none" ? "none" : source.logoMode === "text" ? "initials" : "tox";
    const sourceDesigner = source.designer && typeof source.designer === "object" ? source.designer : {};
    const sourceBrand = sourceDesigner.brand && typeof sourceDesigner.brand === "object" ? sourceDesigner.brand : {};
    const sourceLayout = sourceDesigner.layout && typeof sourceDesigner.layout === "object" ? sourceDesigner.layout : {};
    const sourceTypography = sourceDesigner.typography && typeof sourceDesigner.typography === "object" ? sourceDesigner.typography : {};
    const sourceFooter = sourceDesigner.footer && typeof sourceDesigner.footer === "object" ? sourceDesigner.footer : {};
    base.defaultTemplate = cleanTemplate(source.defaultTemplate, base.defaultTemplate);
    base.paperSize = cleanPaperSize(source.paperSize, base.paperSize);
    base.accentColor = cleanColor(source.accentColor);
    base.fontScale = Math.min(120, Math.max(85, Math.round(clampNumber(source.fontScale, base.fontScale))));
    base.density = cleanDensity(source.density, base.density);
    base.logoMode = ["mark", "text", "none"].includes(source.logoMode) ? source.logoMode : base.logoMode;
    base.designer.brand.logoSource = cleanChoice(sourceBrand.logoSource || legacyLogoSource, ["tox", "initials", "uploaded", "none"], base.designer.brand.logoSource);
    base.designer.brand.logoImageDataUrl = cleanLogoDataUrl(sourceBrand.logoImageDataUrl);
    if (base.designer.brand.logoSource === "uploaded" && !base.designer.brand.logoImageDataUrl) {
      base.designer.brand.logoSource = "initials";
    }
    base.logoMode = base.designer.brand.logoSource === "none"
      ? "none"
      : base.designer.brand.logoSource === "initials"
        ? "text"
        : "mark";
    base.designer.brand.logoShape = cleanChoice(sourceBrand.logoShape, ["rounded", "square", "circle", "seal", "letterhead"], base.designer.brand.logoShape);
    base.designer.brand.logoPosition = cleanChoice(sourceBrand.logoPosition, ["start", "center", "end", "watermark"], base.designer.brand.logoPosition);
    base.designer.brand.logoSize = Math.min(96, Math.max(28, Math.round(clampNumber(sourceBrand.logoSize, base.designer.brand.logoSize))));
    base.designer.brand.logoOpacity = Math.min(100, Math.max(12, Math.round(clampNumber(sourceBrand.logoOpacity, base.designer.brand.logoOpacity))));
    base.designer.brand.showBusinessName = sourceBrand.showBusinessName !== false;
    base.designer.brand.tagline = cleanText(sourceBrand.tagline, 120);
    base.designer.layout.headerStyle = cleanChoice(sourceLayout.headerStyle, ["classic", "minimal", "gradient", "boxed", "letterhead"], base.designer.layout.headerStyle);
    base.designer.layout.tableStyle = cleanChoice(sourceLayout.tableStyle, ["striped", "boxed", "minimal", "dense"], base.designer.layout.tableStyle);
    base.designer.layout.totalStyle = cleanChoice(sourceLayout.totalStyle, ["card", "bar", "classic"], base.designer.layout.totalStyle);
    base.designer.layout.borderStyle = cleanChoice(sourceLayout.borderStyle, ["soft", "sharp", "none"], base.designer.layout.borderStyle);
    base.designer.layout.marginScale = Math.min(125, Math.max(80, Math.round(clampNumber(sourceLayout.marginScale, base.designer.layout.marginScale))));
    base.designer.typography.fontFamily = cleanChoice(sourceTypography.fontFamily, ["system", "kufi", "cairo", "tajawal"], base.designer.typography.fontFamily);
    base.designer.typography.fontScale = Math.min(120, Math.max(85, Math.round(clampNumber(sourceTypography.fontScale ?? source.fontScale, base.designer.typography.fontScale))));
    base.fontScale = base.designer.typography.fontScale;
    base.designer.footer.note = cleanText(sourceFooter.note, 500);
    base.designer.footer.terms = cleanText(sourceFooter.terms, 500);
    base.designer.footer.showSignature = sourceFooter.showSignature !== false;
    base.designer.footer.showThankYou = sourceFooter.showThankYou === true;
    if (source.showFields && typeof source.showFields === "object") {
      Object.keys(base.showFields).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(source.showFields, key)) {
          base.showFields[key] = source.showFields[key] !== false;
        }
      });
    }
    base.designer.footer.showSignature = base.designer.footer.showSignature && base.showFields.signature !== false;
    const perDocumentType = source.perDocumentType && typeof source.perDocumentType === "object" ? source.perDocumentType : {};
    invoiceDocumentTypes.forEach((type) => {
      const fallback = base.perDocumentType[type] || {};
      const custom = perDocumentType[type] && typeof perDocumentType[type] === "object" ? perDocumentType[type] : {};
      base.perDocumentType[type] = {
        template: cleanTemplate(custom.template, fallback.template || base.defaultTemplate),
        paperSize: cleanPaperSize(custom.paperSize, fallback.paperSize || base.paperSize),
        density: cleanDensity(custom.density, fallback.density || base.density)
      };
    });
    return base;
  }

  function normalizeInstallmentProfitSettings(settings = {}) {
    const source = settings && typeof settings === "object" ? settings : {};
    const fixedAmountUsd = source.defaultFixedAmountUsd ?? source.defaultFixedUsd ?? source.defaultFixedAmount ?? 0;
    const minProfitAmountUsd = source.minProfitAmountUsd ?? source.minAmountUsd ?? source.minProfitAmount ?? 0;
    const maxProfitAmountUsd = source.maxProfitAmountUsd ?? source.maxAmountUsd ?? source.maxProfitAmount ?? 0;
    return {
      defaultMode: source.defaultMode === "fixed" ? "fixed" : "percent",
      defaultPercent: Math.max(0, clampNumber(source.defaultPercent)),
      defaultFixedAmountUsd: Math.max(0, clampNumber(fixedAmountUsd)),
      minProfitAmountUsd: Math.max(0, clampNumber(minProfitAmountUsd)),
      maxProfitAmountUsd: Math.max(0, clampNumber(maxProfitAmountUsd)),
      allowEmployeeProfitEdit: source.allowEmployeeProfitEdit !== false
    };
  }

  function normalizeProductPricingSettings(settings = {}) {
    const source = settings && typeof settings === "object" ? settings : {};
    return {
      allowSaleBelowCost: source.allowSaleBelowCost === true,
      lowMarginWarningPercent: Math.max(0, clampNumber(source.lowMarginWarningPercent ?? 8, 8))
    };
  }

  function generateBarcode() {
    const partA = String(Date.now()).slice(-8);
    const partB = String(Math.floor(1000 + Math.random() * 9000));
    return `${partA}${partB}`;
  }

  const seed = {
    warehouses: [],
    suppliers: [],
    products: [],
    clients: [],
    employees: [],
    purchases: [],
    invoices: [],
    clientPayments: [],
    supplierPayments: [],
    cashVouchers: [],
    accountMovements: [],
    suspendedInvoices: [],
    suspendedPurchases: [],
    unitPresets: [
      { id: "up-weighted-kg", kind: "weighted", name: "كيلو", multiplier: 1000 },
      { id: "up-weighted-100g", kind: "weighted", name: "100 غرام", multiplier: 100 },
      { id: "up-weighted-bag50", kind: "weighted", name: "كيس 50 كيلو", multiplier: 50000 },
      { id: "up-packaged-carton24", kind: "packaged", name: "كارتون", multiplier: 24 },
      { id: "up-packaged-dozen", kind: "packaged", name: "درزن", multiplier: 12 },
      { id: "up-single-set", kind: "single", name: "سيت", multiplier: 1 },
      { id: "up-liquid-250ml", kind: "liquid", name: "250 مل", multiplier: 250 },
      { id: "up-liquid-500ml", kind: "liquid", name: "500 مل", multiplier: 500 },
      { id: "up-liquid-liter", kind: "liquid", name: "لتر", multiplier: 1000 },
      { id: "up-liquid-gallon20", kind: "liquid", name: "جالون 20 لتر", multiplier: 20000 },
      { id: "up-length-50cm", kind: "length", name: "نصف متر", multiplier: 50 },
      { id: "up-length-meter", kind: "length", name: "متر", multiplier: 100 },
      { id: "up-length-roll100", kind: "length", name: "رول 100 متر", multiplier: 10000 }
    ],
    brands: [],
    originCountries: []
  };

  const defaultOriginCountries = ["العراق", "تركيا", "الصين", "إيران", "الإمارات", "السعودية", "الهند", "ألمانيا", "إيطاليا", "أمريكا"];

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(settingsKey));
      if (saved) return saved;
    } catch (error) {
      console.warn("Could not load settings", error);
    }
    return {};
  }

  function isSalesPosRoute() {
    try {
      return /sales\.html$/i.test(window.location.pathname || "") && window.location.hash !== "#create";
    } catch (error) {
      return false;
    }
  }

  let lightweightStateScope = isSalesPosRoute() ? "pos" : "";

  function stateEndpointPath(options = {}) {
    const scope = typeof options === "string" ? options : options.scope;
    if (scope === "full") return "/state/";
    if (scope === "pos" || (!scope && isSalesPosRoute())) return "/state/?scope=pos";
    return "/state/";
  }

  function rememberStateScope(path) {
    lightweightStateScope = String(path || "").includes("scope=pos") ? "pos" : "";
  }

  function readStoredBusinessState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && typeof saved === "object") return saved;
    } catch (error) {
      console.warn("Could not load Tox state", error);
    }
    return null;
  }

  function loadBusinessState() {
    if (isSalesPosRoute()) return seed;
    return readStoredBusinessState() || seed;
  }

  const cp1252Bytes = {
    0x20AC: 0x80,
    0x201A: 0x82,
    0x0192: 0x83,
    0x201E: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02C6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8A,
    0x2039: 0x8B,
    0x0152: 0x8C,
    0x017D: 0x8E,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201C: 0x93,
    0x201D: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02DC: 0x98,
    0x2122: 0x99,
    0x0161: 0x9A,
    0x203A: 0x9B,
    0x0153: 0x9C,
    0x017E: 0x9E,
    0x0178: 0x9F
  };

  function repairText(value) {
    const text = String(value ?? "");
    if (!/[\u00c3\u00c2\u00d8\u00d9\u00db\u00c6]/.test(text)) return text;
    try {
      const bytes = Uint8Array.from([...text].map((char) => {
        const code = char.charCodeAt(0);
        return code <= 0xff ? code : cp1252Bytes[code] ?? code;
      }));
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return /[\u0600-\u06ff]/.test(decoded) ? decoded : text;
    } catch (error) {
      return text;
    }
  }

  function repairObject(value) {
    if (typeof value === "string") return repairText(value);
    if (Array.isArray(value)) return value.map(repairObject);
    if (value && typeof value === "object") {
      Object.keys(value).forEach((key) => {
        value[key] = repairObject(value[key]);
      });
    }
    return value;
  }

  function clampNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const storageStockMode = "storage-main-unit-v1";

  function preciseNumber(value, fallback = 0, decimals = 4) {
    return Number(clampNumber(value, fallback).toFixed(decimals));
  }

  function wholeMoney(value, fallback = 0) {
    return Math.round(clampNumber(value, fallback));
  }

  function safeTheme(value, fallback = "tox-blue") {
    const normalized = window.ToxThemes?.normalize
      ? window.ToxThemes.normalize(value, fallback)
      : (legacyThemeMap[value] || value);
    return themeIds.includes(normalized) ? normalized : fallback;
  }

  function safeLang(value, fallback = "ar") {
    if (value === "en" || value === "ar") return value;
    return fallback;
  }

  function safeDir(value, lang = "ar") {
    if (value === "ltr" || value === "rtl") return value;
    return lang === "ar" ? "rtl" : "ltr";
  }

  const inventoryColors = ["#d6b35a", "#38bdf8", "#34d399", "#f97316", "#a78bfa", "#f43f5e", "#22c55e", "#eab308"];

  function safeInventoryColor(value, index = 0) {
    const text = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text;
    return inventoryColors[Math.abs(index) % inventoryColors.length];
  }

  function productOriginCountry(product = {}) {
    return String(product.originCountry || product.origin || product.origin_country || "").trim();
  }

  function normalizeOriginCountryPreset(origin, index = 0) {
    const name = String(origin?.name || origin || "").trim();
    if (!name) return null;
    return {
      id: origin?.id || `origin-${index + 1}`,
      name,
      color: safeInventoryColor(origin?.color, index + 6)
    };
  }

  function stockUnitMultiplier(product) {
    return Math.max(0.0001, preciseNumber(product?.stockUnitMultiplier || 1));
  }

  function stockUnitName(product) {
    return product?.stockUnitName || productBaseUnit(product);
  }

  function stockBaseQuantity(product) {
    return preciseNumber(clampNumber(product?.stockQuantity) * stockUnitMultiplier(product));
  }

  function baseToStorageQuantity(product, baseQuantity) {
    return preciseNumber(clampNumber(baseQuantity) / stockUnitMultiplier(product));
  }

  function sanitizeUnitId(value) {
    const text = String(value || "")
      .trim()
      .toLowerCase();
    const ascii = text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    let hash = 0;
    [...text].forEach((char) => {
      hash = ((hash << 5) - hash + char.charCodeAt(0)) >>> 0;
    });
    return `${ascii || "unit"}-${hash.toString(36)}`;
  }

  function uniqueUnitId(value, usedIds = new Set()) {
    const base = sanitizeUnitId(value || `unit-${Date.now()}`);
    let id = base;
    let index = 2;
    while (usedIds.has(id)) {
      id = `${base}-${index}`;
      index += 1;
    }
    usedIds.add(id);
    return id;
  }

  function moneyToUsdAtRate(amount, currency, rate = exchangeRate) {
    const safeRate = Math.max(1, clampNumber(rate, exchangeRate));
    const value = wholeMoney(parseMoneyInput(amount));
    return currency === "IQD" ? value / safeRate : value;
  }

  function convertUsdAtRate(amountUsd, currency, rate = exchangeRate) {
    const safeRate = Math.max(1, clampNumber(rate, exchangeRate));
    return wholeMoney(currency === "IQD" ? amountUsd * safeRate : amountUsd);
  }

  function normalizeCashVoucher(voucher, index, rate = exchangeRate) {
    const rawType = String(voucher?.type || "").trim().toLowerCase();
    const type = rawType === "payment" || rawType === "expense" || rawType.includes("صرف") ? "payment" : "receipt";
    const currency = voucher?.currency === "USD" ? "USD" : "IQD";
    const rawAmount = Math.abs(clampNumber(voucher?.amount ?? voucher?.value ?? voucher?.total));
    const rawUsd = Math.abs(clampNumber(voucher?.amountUsd ?? voucher?.valueUsd ?? voucher?.totalUsd, NaN));
    const amountUsd = preciseNumber(Number.isFinite(rawUsd) && rawUsd > 0 ? rawUsd : moneyToUsdAtRate(rawAmount, currency, rate));
    const amount = preciseNumber(rawAmount || convertUsdAtRate(amountUsd, currency, rate));
    const createdAt = voucher?.createdAt || voucher?.date || new Date(0).toISOString();
    if (amountUsd <= 0) return null;
    return {
      id: voucher?.id || `CV-${String(index + 1).padStart(4, "0")}-${String(createdAt).slice(0, 10).replace(/\D/g, "") || "legacy"}`,
      type,
      amount,
      amountUsd,
      currency,
      party: String(voucher?.party || "").trim(),
      note: String(voucher?.note || "").trim(),
      createdAt
    };
  }

  function addOrMergeUnit(units, usedIds, payload, currency) {
    const name = String(payload.name || "").trim();
    const multiplier = Math.max(0.0001, preciseNumber(payload.multiplier || 1));
    if (!name || multiplier <= 0) return null;
    const barcode = String(payload.barcode || "").trim();
    const priceUsd = payload.priceUsd !== undefined ? preciseNumber(payload.priceUsd) : moneyToUsd(payload.price, currency);
    const existing = units.find((unit) => (
      unit.name === name
      || clampNumber(unit.multiplier) === multiplier
      || (payload.id && unit.id === payload.id)
    ));
    if (existing) {
      existing.name = existing.name || name;
      existing.multiplier = multiplier;
      if (!clampNumber(existing.priceUsd) && clampNumber(priceUsd)) existing.priceUsd = preciseNumber(priceUsd);
      if (!existing.barcode && barcode) existing.barcode = barcode;
      existing.priceCurrency = existing.priceCurrency || currency;
      return existing;
    }
    const id = uniqueUnitId(payload.id || name, usedIds);
    const unit = {
      id,
      name,
      multiplier,
      priceUsd: preciseNumber(priceUsd),
      priceCurrency: currency,
      barcode
    };
    units.push(unit);
    return unit;
  }

  function normalizeLegacyProduct(product) {
    const inferredKind = product.kind || (
      /لتر|مل/.test(product.baseUnit || "") ? "liquid"
        : /متر|سم/.test(product.baseUnit || "") ? "length"
          : /غرام|كغم|كيلو/.test(product.baseUnit || "") ? "weighted"
            : (product.baseUnit === "قطعة" && (product.units || []).length > 1 ? "packaged" : "single")
    );
    const originCountry = String(product.originCountry || product.origin || product.origin_country || "").trim();
    const productImages = Array.isArray(product.images)
      ? product.images.map((image, index) => ({
        id: String(image.id || image.externalId || `image-${index + 1}`),
        imageUrl: image.imageUrl || image.url || image.image || image.largeUrl || "",
        url: image.url || image.imageUrl || image.image || image.largeUrl || "",
        largeUrl: image.largeUrl || image.imageUrl || image.url || image.image || "",
        catalogUrl: image.catalogUrl || image.imageUrl || image.url || image.image || "",
        thumbUrl: image.thumbUrl || image.catalogUrl || image.imageUrl || image.url || image.image || "",
        originalUrl: image.originalUrl || image.largeUrl || image.imageUrl || image.url || image.image || "",
        sortOrder: clampNumber(image.sortOrder ?? index),
        isPrimary: image.isPrimary === true
      })).filter((image) => image.imageUrl || image.largeUrl || image.catalogUrl || image.thumbUrl)
      : [];
    const rawCleanedUnits = (product.units || []).map((unit, index) => ({
      id: unit.id || `unit-${index + 1}`,
      name: unit.name || (index === 0 ? product.baseUnit : `وحدة ${index + 1}`),
      multiplier: Math.max(0.0001, preciseNumber(unit.multiplier || 1)),
      priceUsd: preciseNumber(unit.priceUsd),
      priceCurrency: unit.priceCurrency || product.currency || "IQD",
      barcode: String(unit.barcode || "").trim()
    }));
    const cleanedUnits = [];
    const cleanedUnitIds = new Set();
    rawCleanedUnits.forEach((unit) => addOrMergeUnit(cleanedUnits, cleanedUnitIds, unit, unit.priceCurrency || product.currency || "IQD"));
    const largestUnit = [...cleanedUnits]
      .filter((unit) => unit.multiplier > 1)
      .sort((left, right) => right.multiplier - left.multiplier)[0];
    const storageMultiplier = Math.max(0.0001, preciseNumber(product.stockUnitMultiplier || largestUnit?.multiplier || 1));
    const usesStorageStock = product.stockQuantityMode === storageStockMode || product.stockQuantityIsStorageUnit === true;
    if (product.baseUnit && product.stockQuantity !== undefined) {
      return {
        ...product,
        kind: inferredKind,
        brand: String(product.brand || "").trim(),
        originCountry,
        origin: originCountry,
        barcode: String(product.barcode || "").trim(),
        image: productImages[0]?.imageUrl || product.image || product.imageUrl || "",
        imageUrl: productImages[0]?.imageUrl || product.image || product.imageUrl || "",
        images: productImages,
        stockQuantity: usesStorageStock ? preciseNumber(product.stockQuantity) : preciseNumber(clampNumber(product.stockQuantity) / storageMultiplier),
        alertQuantity: usesStorageStock ? preciseNumber(product.alertQuantity ?? product.minThreshold ?? 0) : preciseNumber(clampNumber(product.alertQuantity ?? product.minThreshold ?? 0) / storageMultiplier),
        stockUnitName: product.stockUnitName || largestUnit?.name || product.baseUnit,
        stockUnitMultiplier: storageMultiplier,
        stockQuantityMode: storageStockMode,
        preventNegativeSale: product.preventNegativeSale !== false,
        currency: product.currency || product.units?.[0]?.priceCurrency || "IQD",
        units: cleanedUnits
      };
    }

    const piecesPerCarton = Math.max(1, clampNumber(product.piecesPerCarton || 1, 1));
    const stockPieces = clampNumber(product.stockPieces ?? clampNumber(product.cartons, 0) * piecesPerCarton);
    const currency = product.currency || product.units?.find((unit) => unit.priceCurrency)?.priceCurrency || "IQD";
    const units = [];

    units.push({
      id: "piece",
      name: "قطعة",
      multiplier: 1,
      priceUsd: clampNumber(product.units?.find((unit) => unit.id === "piece")?.priceUsd ?? 0),
      priceCurrency: currency
    });
    if (piecesPerCarton >= 12) {
      units.push({
        id: "dozen",
        name: "دزينة",
        multiplier: 12,
        priceUsd: clampNumber(product.units?.find((unit) => unit.id === "dozen")?.priceUsd ?? 0),
        priceCurrency: currency
      });
    }
    units.push({
      id: "carton",
      name: "كارتون",
      multiplier: piecesPerCarton,
      priceUsd: clampNumber(product.units?.find((unit) => unit.id === "carton")?.priceUsd ?? 0),
      priceCurrency: currency
    });
    (product.units || [])
      .filter((unit) => !["piece", "dozen", "carton"].includes(unit.id))
      .forEach((unit, index) => {
        units.push({
          id: unit.id || `unit-${index + 1}`,
          name: unit.name || "وحدة إضافية",
          multiplier: Math.max(0.0001, clampNumber(unit.multiplier, 1)),
          priceUsd: clampNumber(unit.priceUsd),
          priceCurrency: unit.priceCurrency || currency
        });
      });

    return {
      id: product.id,
      name: product.name,
      brand: String(product.brand || "").trim(),
      originCountry,
      origin: originCountry,
      kind: inferredKind,
      barcode: String(product.barcode || generateBarcode()),
      image: productImages[0]?.imageUrl || product.image || product.imageUrl || "",
      imageUrl: productImages[0]?.imageUrl || product.image || product.imageUrl || "",
      images: productImages,
      warehouseId: product.warehouseId,
      currency,
      baseUnit: "قطعة",
      stockQuantity: preciseNumber(stockPieces / piecesPerCarton),
      alertQuantity: preciseNumber(clampNumber(product.minThreshold ?? product.thresholdCartons * piecesPerCarton ?? 0) / piecesPerCarton),
      stockUnitName: "كارتون",
      stockUnitMultiplier: piecesPerCarton,
      stockQuantityMode: storageStockMode,
      preventNegativeSale: true,
      expiryStart: product.expiryStart || null,
      expiresAt: product.expiresAt || product.expiryEnd || null,
      units
    };
  }

  function normalizePurchaseItem(item, purchase, products) {
    const product = products.find((entry) => entry.id === item.productId);
    const fallbackUnit = product?.units?.[0];
    const unit = product?.units?.find((entry) => entry.id === item.unitId) || fallbackUnit;

    if (item.qtyInBase !== undefined) {
      return {
        ...item,
        brand: item.brand || product?.brand || "",
        quantity: clampNumber(item.quantity),
        qtyInBase: clampNumber(item.qtyInBase),
        unitCostUsd: clampNumber(item.unitCostUsd ?? item.cartonCostUsd),
        totalUsd: clampNumber(item.totalUsd),
        supplierUnitCostUsd: clampNumber(item.supplierUnitCostUsd ?? item.unitCostUsd ?? item.cartonCostUsd),
        baseUnitCostUsd: clampNumber(item.baseUnitCostUsd),
        storageUnitCostUsd: clampNumber(item.storageUnitCostUsd),
        landedCostShareUsd: clampNumber(item.landedCostShareUsd),
        discountShareUsd: clampNumber(item.discountShareUsd),
        batchCode: item.batchCode || "",
        unitId: item.unitId || unit?.id || "unit",
        unitName: item.unitName || unit?.name || "وحدة"
      };
    }

    const cartons = clampNumber(item.cartons);
    const piecesPerCarton = Math.max(1, clampNumber(item.piecesPerCarton, 1));
    const qtyInBase = cartons * piecesPerCarton;
    const totalUsd = clampNumber(item.totalUsd ?? item.costUsd);
    const unitCostUsd = clampNumber(item.cartonCostUsd ?? totalUsd / Math.max(cartons, 1));

    return {
      productId: item.productId,
      warehouseId: item.warehouseId || product?.warehouseId || "",
      brand: item.brand || product?.brand || "",
      quantity: cartons,
      unitId: "carton",
      unitName: unit?.name || "كارتون",
      qtyInBase,
      unitCostUsd,
      totalUsd,
      supplierUnitCostUsd: unitCostUsd,
      baseUnitCostUsd: qtyInBase > 0 ? totalUsd / qtyInBase : 0,
      storageUnitCostUsd: unitCostUsd,
      landedCostShareUsd: 0,
      discountShareUsd: 0,
      batchCode: item.batchCode || "",
      receivedAt: item.receivedAt || purchase.createdAt,
      expiryDays: clampNumber(item.expiryDays),
      expiresAt: item.expiresAt || null
    };
  }

  function dedupeProductsByIdentity(products) {
    const seen = new Set();
    return (products || []).filter((product) => {
      const id = String(product?.id || "").trim();
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function normalizeBusinessState(businessState = {}, options = {}) {
    const deletedUnitPresetIds = Array.from(new Set(
      (Array.isArray(businessState.deletedUnitPresetIds)
        ? businessState.deletedUnitPresetIds
        : options.deletedUnitPresetIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ));
    const deletedUnitPresetSet = new Set(deletedUnitPresetIds);
    const normalizedProducts = dedupeProductsByIdentity(
      (businessState.products || []).map(normalizeLegacyProduct).map((product) => ({
        ...product,
        image: product.image || product.imageUrl || "",
        originCountry: productOriginCountry(product),
        origin: productOriginCountry(product),
        units: (product.units || []).filter((unit, index, units) => {
          return unit?.name && unit.multiplier > 0 && units.findIndex((entry) => entry.id === unit.id) === index;
        })
      }))
    );
    const originPresetSeen = new Set();
    const normalizedOriginCountries = (businessState.originCountries || [])
      .map(normalizeOriginCountryPreset)
      .filter((origin) => {
        const key = origin?.name?.toLowerCase();
        if (!key || originPresetSeen.has(key)) return false;
        originPresetSeen.add(key);
        return true;
      });

    const normalizedPurchases = (businessState.purchases || []).map((purchase) => {
      if (purchase.items) {
        return {
          ...purchase,
          supplierId: purchase.supplierId || null,
          supplierName: purchase.supplierName || "مورد",
          costUsd: clampNumber(purchase.costUsd),
          paidUsd: clampNumber(purchase.paidUsd),
          items: purchase.items.map((item) => normalizePurchaseItem(item, purchase, normalizedProducts))
        };
      }

      const converted = {
        ...purchase,
        items: [
          {
            productId: purchase.productId,
            warehouseId: purchase.warehouseId,
            cartons: purchase.cartons,
            piecesPerCarton: purchase.piecesPerCarton,
            cartonCostUsd: clampNumber(purchase.costUsd) / Math.max(clampNumber(purchase.cartons, 1), 1),
            totalUsd: clampNumber(purchase.costUsd),
            expiryDays: clampNumber(purchase.expiryDays),
            expiresAt: purchase.expiresAt || null
          }
        ]
      };
      return {
        ...converted,
        supplierId: null,
        items: converted.items.map((item) => normalizePurchaseItem(item, converted, normalizedProducts))
      };
    });

    return {
      warehouses: (businessState.warehouses || []).map((warehouse, index) => ({
        id: warehouse.id || `wh-${index + 1}`,
        name: warehouse.name || `مخزن ${index + 1}`,
        code: warehouse.code || `WH-${String(index + 1).padStart(2, "0")}`,
        zone: warehouse.zone || "",
        manager: warehouse.manager || "",
        color: safeInventoryColor(warehouse.color, index),
        note: warehouse.note || ""
      })),
      suppliers: (businessState.suppliers || []).map((supplier, index) => ({
        id: supplier.id || `s-${index + 1}`,
        name: supplier.name || `مورد ${index + 1}`,
        phone: supplier.phone || "",
        companyName: supplier.companyName || supplier.company_name || "",
        email: supplier.email || "",
        image: supplier.image || supplier.imageUrl || "",
        city: supplier.city || "",
        address: supplier.address || supplier.city || "",
        openingBalanceUsd: clampNumber(supplier.openingBalanceUsd),
        openingBalanceType: supplier.openingBalanceType || "debit",
        financialNote: supplier.financialNote || "",
        balanceUsd: clampNumber(supplier.balanceUsd),
        note: supplier.note || "",
        createdAt: supplier.createdAt || ""
      })),
      products: normalizedProducts,
      clients: (businessState.clients || []).map((client, index) => ({
        id: client.id || `c-${index + 1}`,
        name: client.name || `زبون ${index + 1}`,
        phone: client.phone || "",
        address: client.address || "",
        image: client.image || client.imageUrl || "",
        openingBalanceUsd: clampNumber(client.openingBalanceUsd),
        openingBalanceType: client.openingBalanceType || "debit",
        financialNote: client.financialNote || "",
        debtLimitUsd: clampNumber(client.debtLimitUsd),
        balanceUsd: clampNumber(client.balanceUsd),
        loyaltyPoints: clampNumber(client.loyaltyPoints),
        note: client.note || "",
        createdAt: client.createdAt || ""
      })),
      employees: businessState.employees || [],
      purchases: normalizedPurchases,
      invoices: (businessState.invoices || []).map((invoice) => {
        const rawKind = String(invoice.kind || invoice.type || "").trim().toLowerCase().replace(/-/g, "_");
        const kind = invoice.installmentPlan?.type === "installment"
          ? "installment"
          : (["direct_pos", "pos", "directpos", "quick_sale", "quick"].includes(rawKind) ? "direct_pos" : rawKind || "invoice");
        const totalUsd = clampNumber(invoice.totalUsd, Math.max(0, clampNumber(invoice.subtotalUsd) - clampNumber(invoice.discountUsd)));
        if (kind === "direct_pos") {
          const isVoided = invoice.isVoided || invoice.paymentStatus === "void";
          return {
            ...invoice,
            kind,
            type: kind,
            totalUsd,
            paidUsd: totalUsd,
            remainingUsd: 0,
            paymentStatus: isVoided ? "void" : "paid"
          };
        }
        return { ...invoice, kind, type: kind };
      }),
      clientPayments: businessState.clientPayments || [],
      supplierPayments: businessState.supplierPayments || [],
      cashVouchers: (businessState.cashVouchers || [])
        .map((voucher, index) => normalizeCashVoucher(voucher, index, businessState.activeExchangeRate || businessState.exchangeRate || exchangeRate))
        .filter(Boolean),
      accountMovements: businessState.accountMovements || [],
      suspendedInvoices: businessState.suspendedInvoices || [],
      suspendedPurchases: businessState.suspendedPurchases || [],
      unitPresets: (() => {
        const visibleSeedUnitPresets = seed.unitPresets.filter((unit) => !deletedUnitPresetSet.has(unit.id));
        const savedUnitPresets = (businessState.unitPresets || []).filter((unit) => !deletedUnitPresetSet.has(unit.id));
        const source = savedUnitPresets.length
          ? [...visibleSeedUnitPresets, ...savedUnitPresets]
          : visibleSeedUnitPresets;
        const seen = new Set();
        return source.filter((unit) => {
          const key = `${unit.kind || "packaged"}:${String(unit.name || "").trim().toLowerCase()}:${Number(unit.multiplier || 1)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })().map((unit, index) => ({
        id: unit.id || `up-${index + 1}`,
        kind: unit.kind || "packaged",
        name: String(unit.name || "").trim(),
        multiplier: Math.max(0.0001, preciseNumber(unit.multiplier || 1)),
        color: safeInventoryColor(unit.color, index + 2)
      })).filter((unit) => unit.name),
      deletedUnitPresetIds,
      brands: (businessState.brands || seed.brands).map((brand, index) => ({
        id: brand.id || `brand-${index + 1}`,
        name: String(brand.name || brand || "").trim(),
        color: safeInventoryColor(brand.color, index + 4)
      })).filter((brand) => brand.name),
      originCountries: normalizedOriginCountries
    };
  }

  const business = repairObject(normalizeBusinessState(loadBusinessState()));
  const settings = repairObject(loadSettings());
  const removedThemes = new Set(["crimson", "forest", "ivory", "clear", "techno"]);
  if (legacyThemeMap[settings.theme]) {
    settings.theme = legacyThemeMap[settings.theme];
  } else if (removedThemes.has(settings.theme) || !themeIds.includes(settings.theme)) {
    settings.theme = "tox-blue";
  }
  try {
    const themeUpgradeKey = "tox-blue-theme-upgrade-v1";
    if (!localStorage.getItem(themeUpgradeKey) && (!settings.theme || settings.theme === "tox-pro")) {
      settings.theme = "tox-blue";
      localStorage.setItem(themeUpgradeKey, "true");
    }
  } catch (error) {
    settings.theme = settings.theme || "tox-blue";
  }
  try {
    const soundUpgradeKey = "tox-professional-sound-v1";
    if (!localStorage.getItem(soundUpgradeKey)) {
      const legacyPack = ["minimal", "futuristic", "classic"].includes(settings.soundPack);
      if (settings.soundVolume == null || (legacyPack && Number(settings.soundVolume) <= 0.45)) {
        settings.soundVolume = 0.85;
      }
      settings.soundPack = "professional";
      localStorage.setItem(soundUpgradeKey, "true");
    }
  } catch (error) {
    settings.soundPack = "professional";
    settings.soundVolume = settings.soundVolume ?? 0.85;
  }

  const initialLang = safeLang(settings.lang);
  const state = {
    theme: safeTheme(settings.theme),
    lang: initialLang,
    dir: safeDir(settings.dir, initialLang),
    currency: settings.currency || "IQD",
    exchangeRate: settings.exchangeRate || exchangeRate,
    warehouses: business.warehouses,
    suppliers: business.suppliers,
    products: business.products,
    clients: business.clients,
    employees: business.employees,
    invoices: business.invoices,
    clientPayments: business.clientPayments,
    supplierPayments: business.supplierPayments,
    cashVouchers: business.cashVouchers,
    accountMovements: business.accountMovements,
    purchases: business.purchases,
    suspendedInvoices: business.suspendedInvoices,
    suspendedPurchases: business.suspendedPurchases,
    unitPresets: business.unitPresets,
    deletedUnitPresetIds: business.deletedUnitPresetIds,
    brands: business.brands,
    originCountries: business.originCountries,
    businessName: settings.businessName || "",
    businessSubtitle: settings.businessSubtitle || "",
    businessPhone: settings.businessPhone || "",
    businessAddress: settings.businessAddress || "",
    businessOwnerName: settings.businessOwnerName || "",
    businessCompanyName: settings.businessCompanyName || "",
    invoicePrintSettings: normalizeInvoicePrintSettings(settings.invoicePrintSettings),
    installmentProfitSettings: normalizeInstallmentProfitSettings(settings.installmentProfitSettings),
    productPricingSettings: normalizeProductPricingSettings(settings.productPricingSettings),
    dataGeneration: settings.dataGeneration || "",
    soundEnabled: settings.soundEnabled !== false,
    soundVolume: Math.min(1, Math.max(0, Number(settings.soundVolume ?? 0.85))),
    soundPack: "professional",
    syncStatus: {
      state: "idle",
      message: "",
      updatedAt: "",
      errors: []
    },
    alerts: []
  };

  const listeners = new Set();
  const apiBase = window.ToxApi?.baseUrl?.() || `${window.location.origin.includes(":5500") ? "http://127.0.0.1:8765" : ""}/api`;
  const AUTH_KEY = "tox-authenticated";
  let syncTimer = null;
  let isHydrating = true;
  let backendReadyForWrites = false;
  let lastSyncedPayload = "";
  let lastSyncNoticeAt = 0;
  let lastSyncNoticeKey = "";
  let isNotifyingListeners = false;
  let pendingListenerNotify = false;

  function backendFetch(path, options = {}) {
    if (window.ToxApi?.fetch) return window.ToxApi.fetch(path, options);
    return fetch(`${apiBase}${path}`, { credentials: "include", ...options });
  }

  function hasFrontendAuth() {
    try {
      if (typeof window.ToxAuth?.isSessionVerified === "function") {
        return window.ToxAuth.isSessionVerified();
      }
      if (typeof window.ToxAuth?.isLoggedIn === "function") {
        return window.ToxAuth.isLoggedIn();
      }
      return sessionStorage.getItem(AUTH_KEY) === "true" || Boolean(window.ToxApi?.token?.());
    } catch (error) {
      return false;
    }
  }

  function isAuthStatus(status) {
    return Number(status) === 401;
  }

  function isPermissionStatus(status) {
    return Number(status) === 403;
  }

  function handleBackendAuthFailure() {
    if (typeof window.ToxAuth?.expireSession !== "function") return;
    window.ToxAuth.expireSession({
      redirect: !document.querySelector("[data-welcome-splash]"),
      reason: "AUTH_REQUIRED"
    });
  }

  function backendHydrationBlockReason() {
    const external = window.ToxApi?.isExternalFrontend?.() || window.location.protocol === "file:" || /:(5500)$/.test(window.location.origin);
    if (external) return "EXTERNAL_FRONTEND";
    if (!hasFrontendAuth()) return "AUTH_REQUIRED";
    return "";
  }

  function backendHydrationBlockedMessage(reason) {
    // Message display disabled - silent mode
    return "";
  }

  function localDateStamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  function nextDocumentId(prefix, collections = []) {
    const stamp = localDateStamp();
    const marker = `${prefix}-${stamp}-`;
    const used = new Set();
    collections.forEach((collection) => {
      (collection || []).forEach((entry) => {
        if (entry?.id) used.add(String(entry.id));
      });
    });
    let max = 0;
    used.forEach((id) => {
      if (!id.startsWith(marker)) return;
      const number = Number(id.slice(marker.length));
      if (Number.isFinite(number)) max = Math.max(max, number);
    });
    let next = max + 1;
    let candidate = `${marker}${String(next).padStart(4, "0")}`;
    while (used.has(candidate)) {
      next += 1;
      candidate = `${marker}${String(next).padStart(4, "0")}`;
    }
    return candidate;
  }

  function hasMoneyValue(value) {
    return value !== undefined && value !== null && value !== "";
  }

  function syncMoneyCurrency(value, fallback = state.currency) {
    return String(value || fallback || "USD").trim().toUpperCase() === "IQD" ? "IQD" : "USD";
  }

  function syncMoneyRate(value, fallback = state.exchangeRate) {
    const rate = clampNumber(value, fallback || exchangeRate);
    return rate > 0 ? rate : 1460;
  }

  function displayAmountToUsd(amount, currency, rate) {
    const roundedAmount = wholeMoney(amount);
    return preciseNumber(currency === "IQD" ? roundedAmount / syncMoneyRate(rate) : roundedAmount);
  }

  function usdToDisplayAmount(amountUsd, currency, rate) {
    return wholeMoney(currency === "IQD" ? clampNumber(amountUsd) * syncMoneyRate(rate) : amountUsd);
  }

  function invoiceLineSyncContext(line = {}, invoice = {}) {
    const currency = syncMoneyCurrency(line.priceCurrency || line.currency || invoice.currency || state.currency);
    return {
      currency,
      rate: syncMoneyRate(line.exchangeRate || line.rate || invoice.exchangeRate || state.exchangeRate)
    };
  }

  function invoiceLineTotalUsdForSync(line = {}, invoice = {}) {
    const { currency, rate } = invoiceLineSyncContext(line, invoice);
    if (hasMoneyValue(line.totalUsd)) return preciseNumber(line.totalUsd);
    const originalTotalKey = ["lineTotal", "total", "amount"].find((key) => hasMoneyValue(line[key]));
    if (originalTotalKey) return displayAmountToUsd(line[originalTotalKey], currency, rate);

    const quantity = clampNumber(hasMoneyValue(line.qty) ? line.qty : line.quantity);
    const originalPriceKey = ["price", "unitPrice"].find((key) => hasMoneyValue(line[key]));
    const priceUsd = originalPriceKey
      ? displayAmountToUsd(line[originalPriceKey], currency, rate)
      : clampNumber(line.priceUsd);
    const grossUsd = preciseNumber(quantity * priceUsd);
    let discountUsd = 0;
    if (hasMoneyValue(line.lineDiscountUsd)) {
      discountUsd = clampNumber(line.lineDiscountUsd);
    } else if (hasMoneyValue(line.discountUsd)) {
      discountUsd = clampNumber(line.discountUsd);
    } else if (hasMoneyValue(line.lineDiscountPercent)) {
      const percent = Math.max(0, Math.min(100, clampNumber(line.lineDiscountPercent)));
      discountUsd = preciseNumber(grossUsd * percent / 100);
    }
    return preciseNumber(Math.max(0, grossUsd - discountUsd));
  }

  function normalizeInvoiceItemForSync(item = {}, invoice = {}) {
    const { currency, rate } = invoiceLineSyncContext(item, invoice);
    const hasOriginalTotal = ["lineTotal", "total", "amount"].some((key) => hasMoneyValue(item[key]));
    const totalUsd = invoiceLineTotalUsdForSync(item, invoice);
    const next = {
      ...item,
      currency: item.currency || currency,
      priceCurrency: item.priceCurrency || item.currency || currency,
      exchangeRate: item.exchangeRate || item.rate || invoice.exchangeRate || state.exchangeRate,
      unitId: item.unitId || item.unit || "",
      unit: item.unit || item.unitId || "",
      unitName: item.unitName || "",
      totalUsd,
      unitCostUsd: hasMoneyValue(item.unitCostUsd) ? clampNumber(item.unitCostUsd) : 0,
      totalCostUsd: hasMoneyValue(item.totalCostUsd) ? clampNumber(item.totalCostUsd) : 0,
      grossProfitUsd: hasMoneyValue(item.grossProfitUsd) ? clampNumber(item.grossProfitUsd) : 0,
      costStatus: item.costStatus || (hasMoneyValue(item.totalCostUsd) && clampNumber(item.totalCostUsd) > 0 ? "ok" : ""),
      costBreakdown: Array.isArray(item.costBreakdown) ? item.costBreakdown : []
    };
    if (hasOriginalTotal) {
      const lineTotal = usdToDisplayAmount(totalUsd, currency, rate);
      next.lineTotal = lineTotal;
      if (hasMoneyValue(item.total)) next.total = lineTotal;
      if (hasMoneyValue(item.amount)) next.amount = lineTotal;
      next.totalUsd = displayAmountToUsd(lineTotal, currency, rate);
    }
    return next;
  }

  function normalizeInvoiceForSync(invoice = {}) {
    const items = (invoice.items || []).map((item) => normalizeInvoiceItemForSync(item, invoice));
    const subtotalUsd = preciseNumber(items.reduce((sum, item) => sum + invoiceLineTotalUsdForSync(item, invoice), 0));
    const discountUsd = Math.max(0, Math.min(subtotalUsd, clampNumber(invoice.discountUsd)));
    const totalUsd = preciseNumber(Math.max(0, subtotalUsd - discountUsd));
    const rawKind = String(invoice.kind || invoice.type || "").trim().toLowerCase().replace(/-/g, "_");
    const kind = invoice.installmentPlan?.type === "installment"
      ? "installment"
      : (["direct_pos", "pos", "directpos", "quick_sale", "quick"].includes(rawKind) ? "direct_pos" : rawKind || "invoice");
    const isVoided = invoice.isVoided || invoice.paymentStatus === "void";
    const paidUsd = kind === "direct_pos" && !isVoided
      ? totalUsd
      : Math.min(totalUsd, Math.max(0, clampNumber(invoice.paidUsd)));
    const remainingUsd = isVoided ? 0 : preciseNumber(Math.max(0, totalUsd - paidUsd));
    return {
      ...invoice,
      kind,
      type: kind,
      items,
      subtotalUsd,
      discountUsd,
      totalUsd,
      paidUsd,
      remainingUsd,
      paymentStatus: isVoided ? "void" : paymentStatus(totalUsd, paidUsd, remainingUsd)
    };
  }

  function snapshotPayload() {
    const stored = lightweightStateScope === "pos" ? readStoredBusinessState() : null;
    const syncArray = (key) => (
      lightweightStateScope === "pos" && Array.isArray(stored?.[key])
        ? stored[key]
        : state[key]
    );
    return {
      scope: lightweightStateScope === "pos" ? "pos" : "full",
      snapshotComplete: lightweightStateScope !== "pos",
      warehouses: syncArray("warehouses"),
      suppliers: syncArray("suppliers"),
      products: syncArray("products"),
      clients: syncArray("clients"),
      employees: syncArray("employees"),
      invoices: syncArray("invoices").map(normalizeInvoiceForSync),
      clientPayments: syncArray("clientPayments"),
      supplierPayments: syncArray("supplierPayments"),
      cashVouchers: syncArray("cashVouchers"),
      accountMovements: syncArray("accountMovements"),
      purchases: syncArray("purchases"),
      suspendedInvoices: syncArray("suspendedInvoices"),
      suspendedPurchases: syncArray("suspendedPurchases"),
      unitPresets: syncArray("unitPresets"),
      deletedUnitPresetIds: syncArray("deletedUnitPresetIds"),
      brands: syncArray("brands"),
      originCountries: syncArray("originCountries"),
      theme: state.theme,
      lang: state.lang,
      dir: state.dir,
      currency: state.currency,
      exchangeRate: state.exchangeRate,
      businessName: state.businessName,
      businessSubtitle: state.businessSubtitle,
      businessPhone: state.businessPhone,
      businessAddress: state.businessAddress,
      businessOwnerName: state.businessOwnerName,
      businessCompanyName: state.businessCompanyName,
      invoicePrintSettings: state.invoicePrintSettings,
      installmentProfitSettings: state.installmentProfitSettings,
      productPricingSettings: state.productPricingSettings,
      dataGeneration: state.dataGeneration,
      soundEnabled: state.soundEnabled,
      soundVolume: state.soundVolume,
      soundPack: state.soundPack
    };
  }

  function firstSyncError(payload) {
    return payload?.syncReport?.errors?.[0] || payload || {};
  }

  function syncErrorCode(payload) {
    const first = firstSyncError(payload);
    return first?.code || first?.reason || "SYNC_FAILED";
  }

  function syncReportErrors(payload) {
    return Array.isArray(payload?.syncReport?.errors) ? payload.syncReport.errors : [];
  }

  function syncErrorsContainSection(payload, section) {
    return syncReportErrors(payload).some((error) => String(error?.section || "") === section);
  }

  function isMoneyMismatchCode(code) {
    return ["SUBTOTAL_MISMATCH", "TOTAL_MISMATCH", "LINE_TOTAL_MISMATCH"].includes(code);
  }

  function shouldShowSyncNotice(payload) {
    const code = syncErrorCode(payload);
    if (code === "LEDGER_REFERENCE_CONFLICT" || isMoneyMismatchCode(code)) return false;
    return true;
  }

  function syncErrorMessage(payload) {
    const first = firstSyncError(payload);
    const code = syncErrorCode(payload);
    const section = first?.section || "";
    if (code === "BACKEND_REQUIRED" || code === "BACKEND_OFFLINE") {
      return "لم يتم الحفظ. شغل السيرفر وافتح النظام من 127.0.0.1:8765 حتى يتم الحفظ في قاعدة البيانات.";
    }
    if (code === "DUPLICATE_BARCODE" || code === "DUPLICATE_UNIT_BARCODE") {
      return "هذا الباركود مستخدم لمنتج آخر، الرجاء إدخال رقم مختلف";
    }
    if (code === "MISSING_WAREHOUSE") {
      return "لم يكتمل حفظ المنتجات في قاعدة البيانات: يوجد منتج مربوط بمخزن غير محفوظ.";
    }
    if (code === "STALE_LOCAL_STATE") {
      return "لم يتم الحفظ لأن بيانات المتصفح أقدم من قاعدة البيانات. أعد تحميل الصفحة.";
    }
    const detail = [code, first?.message].filter(Boolean).join(": ");
    if (section && detail) {
      return `لم يكتمل حفظ قسم ${section} في قاعدة البيانات (${detail}). لم يتم اعتماد الحفظ.`;
    }
    if (detail) {
      return `لم يكتمل الحفظ في قاعدة البيانات (${detail}). لم يتم اعتماد الحفظ.`;
    }
    return section
      ? `لم يكتمل حفظ قسم ${section} في قاعدة البيانات. لم يتم اعتماد الحفظ.`
      : "لم يكتمل الحفظ في قاعدة البيانات. لم يتم اعتماد الحفظ.";
  }

  function backupRejectedLocalState(reason, remoteGeneration = "") {
    try {
      const backup = {
        reason,
        remoteGeneration,
        localGeneration: localStorage.getItem(generationKey) || "",
        createdAt: new Date().toISOString(),
        businessState: JSON.parse(localStorage.getItem(storageKey) || "{}"),
        settings: JSON.parse(localStorage.getItem(settingsKey) || "{}")
      };
      localStorage.setItem("tox-business-state-rejected-backup", JSON.stringify(backup));
    } catch (error) {
      console.warn("Could not write rejected local state backup", error);
    }
  }

  function clearLocalBusinessCache(options = {}) {
    const keepRejectedBackup = options.keepRejectedBackup === true;
    const exactLocalKeys = [
      storageKey,
      settingsKey,
      generationKey,
      ...(keepRejectedBackup ? [] : ["tox-business-state-rejected-backup"])
    ];
    const localPrefixes = [
      "tox-business-state-v",
      "tox-business-settings-v",
      "tox-form-draft-v1:"
    ];
    try {
      exactLocalKeys.forEach((key) => localStorage.removeItem(key));
      Object.keys(localStorage).forEach((key) => {
        if (localPrefixes.some((prefix) => key.startsWith(prefix))) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn("Could not clear local business cache", error);
    }
    try {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith("tox-form-draft-v1:")) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn("Could not clear session business cache", error);
    }
  }

  function showSyncNotice(message, tone = "error") {
    const now = Date.now();
    const key = `${tone}:${message}`;
    if (key === lastSyncNoticeKey && now - lastSyncNoticeAt < 12000) return;
    lastSyncNoticeAt = now;
    lastSyncNoticeKey = key;
    if (typeof window.showNotice === "function") {
      window.showNotice(message, tone);
    }
  }

  function backendWriteBlockPayload() {
    return {
      syncReport: {
        errors: [{
          section: "backend",
          code: "BACKEND_REQUIRED",
          message: "Backend database connection is required before writing business data."
        }]
      }
    };
  }

  function blockBackendWrite(fallback = { ok: false, reason: "BACKEND_REQUIRED" }) {
    const message = isHydrating
      ? "انتظر تحميل بيانات قاعدة البيانات قبل الحفظ."
      : "لم يتم الحفظ. شغل السيرفر وافتح النظام من 127.0.0.1:8765 حتى يتم الحفظ في قاعدة البيانات.";
    setSyncStatus({ state: "blocked", message, errors: backendWriteBlockPayload().syncReport.errors });
    showSyncNotice(message, "error");
    return typeof fallback === "function" ? fallback() : fallback;
  }

  function requireBackendWrite(action, fallback) {
    return (...args) => {
      if (isHydrating || !backendReadyForWrites) return blockBackendWrite(fallback);
      return action(...args);
    };
  }

  function notifyListeners() {
    if (isNotifyingListeners) {
      pendingListenerNotify = true;
      return;
    }
    isNotifyingListeners = true;
    try {
      do {
        pendingListenerNotify = false;
        const snapshot = getState();
        listeners.forEach((listener) => listener(snapshot));
      } while (pendingListenerNotify);
    } finally {
      isNotifyingListeners = false;
    }
  }

  function setSyncStatus(next) {
    state.syncStatus = {
      state: next.state || "idle",
      message: next.message || "",
      updatedAt: new Date().toISOString(),
      errors: Array.isArray(next.errors) ? next.errors : []
    };
    notifyListeners();
  }

  function snapshotStringValue(source, key, fallback = "") {
    return source && Object.prototype.hasOwnProperty.call(source, key)
      ? String(source[key] ?? "")
      : String(fallback || "");
  }

  function businessProfileFromSnapshot(source, fallback = {}) {
    return {
      businessName: snapshotStringValue(source, "businessName", fallback.businessName),
      businessSubtitle: snapshotStringValue(source, "businessSubtitle", fallback.businessSubtitle),
      businessPhone: snapshotStringValue(source, "businessPhone", fallback.businessPhone),
      businessAddress: snapshotStringValue(source, "businessAddress", fallback.businessAddress),
      businessOwnerName: snapshotStringValue(source, "businessOwnerName", fallback.businessOwnerName),
      businessCompanyName: snapshotStringValue(source, "businessCompanyName", fallback.businessCompanyName)
    };
  }

  function localDuplicateUnitBarcodeReport(payload) {
    const duplicate = duplicateBarcodeErrors(payload.products || [])[0];
    if (!duplicate) return null;
    return {
      syncReport: {
        errors: [{
          section: "products",
          code: "DUPLICATE_BARCODE",
          details: duplicate
        }]
      }
    };
  }

  function persist() {
    const payload = snapshotPayload();
    const previous = lightweightStateScope === "pos" ? readStoredBusinessState() : null;
    const keepStoredArray = (key, value) => (
      lightweightStateScope === "pos" && previous && Array.isArray(previous[key]) ? previous[key] : value
    );
    localStorage.setItem(storageKey, JSON.stringify({
      warehouses: payload.warehouses,
      suppliers: keepStoredArray("suppliers", payload.suppliers),
      products: keepStoredArray("products", payload.products),
      clients: payload.clients,
      employees: keepStoredArray("employees", payload.employees),
      invoices: keepStoredArray("invoices", payload.invoices),
      clientPayments: keepStoredArray("clientPayments", payload.clientPayments),
      supplierPayments: keepStoredArray("supplierPayments", payload.supplierPayments),
      cashVouchers: keepStoredArray("cashVouchers", payload.cashVouchers),
      accountMovements: keepStoredArray("accountMovements", payload.accountMovements),
      purchases: keepStoredArray("purchases", payload.purchases),
      suspendedInvoices: payload.suspendedInvoices,
      suspendedPurchases: payload.suspendedPurchases,
      unitPresets: payload.unitPresets,
      deletedUnitPresetIds: payload.deletedUnitPresetIds,
      brands: payload.brands,
      originCountries: payload.originCountries
    }));
    localStorage.setItem(
      settingsKey,
      JSON.stringify({
        theme: payload.theme,
        lang: payload.lang,
        dir: payload.dir,
        currency: payload.currency,
        exchangeRate: payload.exchangeRate,
        businessName: payload.businessName,
        businessSubtitle: payload.businessSubtitle,
        businessPhone: payload.businessPhone,
        businessAddress: payload.businessAddress,
        businessOwnerName: payload.businessOwnerName,
        businessCompanyName: payload.businessCompanyName,
        invoicePrintSettings: payload.invoicePrintSettings,
        installmentProfitSettings: payload.installmentProfitSettings,
        productPricingSettings: payload.productPricingSettings,
        dataGeneration: payload.dataGeneration,
        soundEnabled: payload.soundEnabled,
        soundVolume: payload.soundVolume,
        soundPack: payload.soundPack
      })
    );
  }

  function applySnapshotPayload(payload = {}) {
    const normalized = repairObject(normalizeBusinessState(payload, {
      deletedUnitPresetIds: payload.deletedUnitPresetIds || state.deletedUnitPresetIds
    }));
    const nextLang = safeLang(payload.lang, state.lang);
    Object.assign(state, {
      theme: safeTheme(payload.theme, state.theme),
      lang: nextLang,
      dir: safeDir(payload.dir, nextLang),
      currency: payload.currency || state.currency,
      exchangeRate: clampNumber(payload.exchangeRate || payload.activeExchangeRate, state.exchangeRate),
      warehouses: normalized.warehouses,
      suppliers: normalized.suppliers,
      products: normalized.products,
      clients: normalized.clients,
      employees: normalized.employees,
      invoices: normalized.invoices,
      clientPayments: normalized.clientPayments,
      supplierPayments: normalized.supplierPayments,
      cashVouchers: normalized.cashVouchers,
      accountMovements: normalized.accountMovements,
      purchases: normalized.purchases,
      suspendedInvoices: normalized.suspendedInvoices,
      suspendedPurchases: normalized.suspendedPurchases,
      unitPresets: normalized.unitPresets,
      deletedUnitPresetIds: normalized.deletedUnitPresetIds,
      brands: normalized.brands,
      originCountries: normalized.originCountries,
      ...businessProfileFromSnapshot(payload, state),
      invoicePrintSettings: normalizeInvoicePrintSettings(payload.invoicePrintSettings || state.invoicePrintSettings),
      installmentProfitSettings: normalizeInstallmentProfitSettings(payload.installmentProfitSettings || state.installmentProfitSettings),
      productPricingSettings: normalizeProductPricingSettings(payload.productPricingSettings || state.productPricingSettings),
      dataGeneration: payload.dataGeneration || state.dataGeneration,
      soundEnabled: payload.soundEnabled !== false,
      soundVolume: Math.min(1, Math.max(0, Number(payload.soundVolume ?? state.soundVolume ?? 0.85))),
      soundPack: "professional"
    });
  }

  function restoreLastConfirmedState() {
    if (!lastSyncedPayload) return false;
    try {
      const previousHydrating = isHydrating;
      isHydrating = true;
      applySnapshotPayload(JSON.parse(lastSyncedPayload));
      emit();
      isHydrating = previousHydrating;
      return true;
    } catch (error) {
      isHydrating = false;
      console.warn("Could not restore last confirmed backend state", error);
      return false;
    }
  }

  async function syncNow() {
    if (isHydrating || typeof fetch !== "function") return { ok: false, skipped: true };
    clearTimeout(syncTimer);
    const payload = snapshotPayload();
    const serialized = JSON.stringify(payload);
    if (serialized === lastSyncedPayload) return { ok: true, skipped: true };
    const localProblem = localDuplicateUnitBarcodeReport(payload);
    if (localProblem) {
      const message = syncErrorMessage(localProblem);
      restoreLastConfirmedState();
      setSyncStatus({ state: "blocked", message, errors: localProblem.syncReport.errors });
      showSyncNotice(message, "error");
      const error = new Error(message);
      error.payload = localProblem;
      throw error;
    }
    try {
      setSyncStatus({ state: "syncing", message: "جاري حفظ البيانات في قاعدة البيانات..." });
      const response = await backendFetch("/sync/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized
      });
      let synced = null;
      try {
        synced = await response.json();
      } catch (error) {
        synced = null;
      }
      if (!response.ok) {
        const error = new Error(`Sync failed: ${response.status}`);
        error.payload = synced;
        error.status = response.status;
        throw error;
      }
      if (synced?.syncHasErrors) {
        const message = syncErrorMessage(synced);
        if (syncErrorsContainSection(synced, "settings")) {
          const error = new Error(message);
          error.payload = synced;
          throw error;
        }
        const previousHydrating = isHydrating;
        isHydrating = true;
        applySnapshotPayload(synced);
        emit();
        isHydrating = previousHydrating;
        backendReadyForWrites = true;
        lastSyncedPayload = JSON.stringify(snapshotPayload());
        setSyncStatus({ state: "saved", message: "تم حفظ الإعدادات والبيانات السليمة. بقيت أقسام أخرى بحاجة مراجعة.", errors: syncReportErrors(synced) });
        if (shouldShowSyncNotice(synced)) showSyncNotice(message, "error");
      } else {
        backendReadyForWrites = true;
        setSyncStatus({ state: "saved", message: "محفوظ في قاعدة البيانات" });
        if (lastSyncNoticeKey) showSyncNotice("تم حفظ البيانات في قاعدة البيانات.", "success");
        lastSyncedPayload = JSON.stringify(snapshotPayload());
      }
      if (synced?.activeExchangeRate) state.exchangeRate = clampNumber(synced.activeExchangeRate, state.exchangeRate);
      return { ok: true, payload: synced };
    } catch (error) {
      backendReadyForWrites = false;
      if (isAuthStatus(error.status)) {
        handleBackendAuthFailure();
        const message = backendHydrationBlockedMessage("AUTH_REQUIRED");
        setSyncStatus({ state: "blocked", message, errors: [] });
        showSyncNotice(message, "error");
        throw error;
      }
      if (isPermissionStatus(error.status)) {
        const message = backendHydrationBlockedMessage("PERMISSION_DENIED");
        setSyncStatus({ state: "blocked", message, errors: [] });
        showSyncNotice(message, "error");
        throw error;
      }
      console.warn("Backend sync is offline; write was not confirmed by database.", error);
      const message = error.payload ? syncErrorMessage(error.payload) : syncErrorMessage(backendWriteBlockPayload());
      if (error.status === 409 && error.payload?.reason === "STALE_LOCAL_STATE") {
        backupRejectedLocalState("STALE_LOCAL_STATE", error.payload?.dataGeneration || "");
        await refreshFromBackend().catch(() => restoreLastConfirmedState());
      } else {
        restoreLastConfirmedState();
      }
      setSyncStatus({ state: "blocked", message, errors: error.payload?.syncReport?.errors || [] });
      if (shouldShowSyncNotice(error.payload)) showSyncNotice(message, "error");
      throw error;
    }
  }

  function scheduleBackendSync() {
    if (isHydrating || typeof fetch !== "function") return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncNow().catch(() => { });
    }, 650);
  }

  async function hydrateFromBackend() {
    if (typeof fetch !== "function") {
      isHydrating = false;
      return;
    }
    const blockedReason = backendHydrationBlockReason();
    if (blockedReason) {
      backendReadyForWrites = false;
      isHydrating = false;
      setSyncStatus({
        state: "blocked",
        message: backendHydrationBlockedMessage(blockedReason)
      });
      emit();
      return;
    }
    try {
      const statePath = stateEndpointPath();
      rememberStateScope(statePath);
      const response = await backendFetch(statePath);
      if (!response.ok) {
        const error = new Error(`State load failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const remote = repairObject(await response.json());
      if (statePath.includes("scope=pos") && !isSalesPosRoute()) {
        rememberStateScope("/state/");
        await refreshFromBackend({ scope: "full" });
        return;
      }
      const remoteGeneration = String(remote.dataGeneration || "");
      const localGeneration = localStorage.getItem(generationKey) || "";
      const remoteHasBusinessData = ["warehouses", "products", "clients", "suppliers", "employees", "invoices", "purchases", "cashVouchers"]
        .some((key) => Array.isArray(remote[key]) && remote[key].length);
      const localHasBusinessData = ["warehouses", "products", "clients", "suppliers", "employees", "invoices", "purchases", "cashVouchers"]
        .some((key) => Array.isArray(state[key]) && state[key].length);
      const generationChanged = Boolean(remoteGeneration && remoteGeneration !== localGeneration);
      if (remoteGeneration && remoteGeneration !== localGeneration) {
        backupRejectedLocalState("REMOTE_GENERATION_CHANGED", remoteGeneration);
        clearLocalBusinessCache({ keepRejectedBackup: true });
        localStorage.setItem(generationKey, remoteGeneration);
        state.dataGeneration = remoteGeneration;
        setSyncStatus({
          state: "saved",
          message: "تم تجاهل بيانات متصفح قديمة واعتماد بيانات قاعدة البيانات."
        });
        Object.assign(state, {
          warehouses: [],
          suppliers: [],
          products: [],
          clients: [],
          employees: [],
          invoices: [],
          clientPayments: [],
          supplierPayments: [],
          cashVouchers: [],
          accountMovements: [],
          purchases: [],
          suspendedInvoices: [],
          suspendedPurchases: [],
          deletedUnitPresetIds: [],
          brands: [],
          originCountries: []
        });
      }
      if (!remoteGeneration && !remoteHasBusinessData && localHasBusinessData) {
        isHydrating = false;
        scheduleBackendSync();
        return;
      }
      isHydrating = true;
      const normalized = repairObject(normalizeBusinessState(remote, {
        deletedUnitPresetIds: generationChanged ? [] : state.deletedUnitPresetIds
      }));
      const remoteLang = safeLang(remote.lang, state.lang);
      Object.assign(state, {
        theme: safeTheme(generationChanged ? remote.theme : (settings.theme || remote.theme), state.theme),
        lang: remoteLang,
        dir: safeDir(remote.dir, remoteLang),
        currency: remote.currency || state.currency,
        exchangeRate: clampNumber(remote.activeExchangeRate || remote.exchangeRate, state.exchangeRate),
        warehouses: normalized.warehouses,
        suppliers: normalized.suppliers,
        products: normalized.products,
        clients: normalized.clients,
        employees: normalized.employees,
        invoices: normalized.invoices,
        clientPayments: normalized.clientPayments,
        supplierPayments: normalized.supplierPayments,
        cashVouchers: normalized.cashVouchers,
        accountMovements: normalized.accountMovements,
        purchases: normalized.purchases,
        suspendedInvoices: normalized.suspendedInvoices,
        suspendedPurchases: normalized.suspendedPurchases,
        unitPresets: normalized.unitPresets,
        deletedUnitPresetIds: normalized.deletedUnitPresetIds,
        brands: normalized.brands,
        originCountries: normalized.originCountries,
        ...businessProfileFromSnapshot(remote, state),
        invoicePrintSettings: normalizeInvoicePrintSettings(remote.invoicePrintSettings || (generationChanged ? {} : state.invoicePrintSettings)),
        installmentProfitSettings: normalizeInstallmentProfitSettings(remote.installmentProfitSettings || (generationChanged ? {} : state.installmentProfitSettings)),
        productPricingSettings: normalizeProductPricingSettings(remote.productPricingSettings || (generationChanged ? {} : state.productPricingSettings)),
        dataGeneration: remoteGeneration || state.dataGeneration
      });
      if (generationChanged) {
        localStorage.setItem(generationKey, state.dataGeneration);
        persist();
      }
      lastSyncedPayload = JSON.stringify(snapshotPayload());
      backendReadyForWrites = true;
      emit();
    } catch (error) {
      backendReadyForWrites = false;
      const authError = isAuthStatus(error.status) || /State load failed: 401/.test(String(error?.message || ""));
      const permissionError = isPermissionStatus(error.status) || /State load failed: 403/.test(String(error?.message || ""));
      if (authError) {
        handleBackendAuthFailure();
      } else if (permissionError) {
        console.warn("Backend state permission denied; keeping the current session active.", error);
      } else {
        console.warn("Backend state is offline; business writes are blocked.", error);
      }
      setSyncStatus({
        state: "blocked",
        message: authError
          ? backendHydrationBlockedMessage("AUTH_REQUIRED")
          : permissionError
            ? backendHydrationBlockedMessage("PERMISSION_DENIED")
            : "تعذر الاتصال بقاعدة بيانات الباك اند. النظام للقراءة فقط ولن يحفظ أي عملية تجارية."
      });
    } finally {
      isHydrating = false;
    }
  }

  async function refreshFromBackend(options = {}) {
    if (typeof fetch !== "function") return getState();
    const statePath = stateEndpointPath(options);
    rememberStateScope(statePath);
    const response = await backendFetch(statePath);
    if (!response.ok) throw new Error(`State refresh failed: ${response.status}`);
    const remote = repairObject(await response.json());
    const normalized = repairObject(normalizeBusinessState(remote, {
      deletedUnitPresetIds: state.deletedUnitPresetIds
    }));
    const remoteLang = safeLang(remote.lang, state.lang);
    isHydrating = true;
    try {
      Object.assign(state, {
        theme: safeTheme(remote.theme, state.theme),
        lang: remoteLang,
        dir: safeDir(remote.dir, remoteLang),
        currency: remote.currency || state.currency,
        exchangeRate: clampNumber(remote.activeExchangeRate || remote.exchangeRate, state.exchangeRate),
        warehouses: normalized.warehouses,
        suppliers: normalized.suppliers,
        products: normalized.products,
        clients: normalized.clients,
        employees: normalized.employees,
        invoices: normalized.invoices,
        clientPayments: normalized.clientPayments,
        supplierPayments: normalized.supplierPayments,
        cashVouchers: normalized.cashVouchers,
        accountMovements: normalized.accountMovements,
        purchases: normalized.purchases,
        suspendedInvoices: normalized.suspendedInvoices,
        suspendedPurchases: normalized.suspendedPurchases,
        unitPresets: normalized.unitPresets,
        deletedUnitPresetIds: normalized.deletedUnitPresetIds,
        brands: normalized.brands,
        originCountries: normalized.originCountries,
        ...businessProfileFromSnapshot(remote, state),
        invoicePrintSettings: normalizeInvoicePrintSettings(remote.invoicePrintSettings || state.invoicePrintSettings),
        installmentProfitSettings: normalizeInstallmentProfitSettings(remote.installmentProfitSettings || state.installmentProfitSettings),
        productPricingSettings: normalizeProductPricingSettings(remote.productPricingSettings || state.productPricingSettings),
        dataGeneration: remote.dataGeneration || state.dataGeneration
      });
      persist();
      backendReadyForWrites = true;
      lastSyncedPayload = JSON.stringify(snapshotPayload());
    } finally {
      isHydrating = false;
    }
    setSyncStatus({ state: "saved", message: "محفوظ في قاعدة البيانات" });
    return getState();
  }

  function applySystemReset(payload = {}) {
    const remote = repairObject(payload.state || payload);
    const normalized = repairObject(normalizeBusinessState(remote));
    const remoteLang = safeLang(remote.lang, state.lang);
    isHydrating = true;
    clearLocalBusinessCache();
    Object.assign(state, {
      theme: safeTheme(remote.theme, state.theme),
      lang: remoteLang,
      dir: safeDir(remote.dir, remoteLang),
      currency: remote.currency || state.currency,
      exchangeRate: clampNumber(remote.activeExchangeRate || remote.exchangeRate, state.exchangeRate),
      warehouses: normalized.warehouses,
      suppliers: normalized.suppliers,
      products: normalized.products,
      clients: normalized.clients,
      employees: normalized.employees,
      invoices: normalized.invoices,
      clientPayments: normalized.clientPayments,
      supplierPayments: normalized.supplierPayments,
      cashVouchers: normalized.cashVouchers,
      accountMovements: normalized.accountMovements,
      purchases: normalized.purchases,
      suspendedInvoices: normalized.suspendedInvoices,
      suspendedPurchases: normalized.suspendedPurchases,
      unitPresets: normalized.unitPresets,
      deletedUnitPresetIds: normalized.deletedUnitPresetIds,
      brands: normalized.brands,
      originCountries: normalized.originCountries,
      ...businessProfileFromSnapshot(remote, state),
      invoicePrintSettings: normalizeInvoicePrintSettings(remote.invoicePrintSettings || state.invoicePrintSettings),
      installmentProfitSettings: normalizeInstallmentProfitSettings(remote.installmentProfitSettings || state.installmentProfitSettings),
      productPricingSettings: normalizeProductPricingSettings(remote.productPricingSettings || state.productPricingSettings),
      dataGeneration: remote.dataGeneration || payload.dataGeneration || `reset-${Date.now()}`
    });
    localStorage.setItem(generationKey, state.dataGeneration);
    persist();
    lastSyncedPayload = JSON.stringify(snapshotPayload());
    isHydrating = false;
    notifyListeners();
  }

  function baseUnit(product) {
    return product?.units?.find((unit) => clampNumber(unit.multiplier, 1) === 1) || product?.units?.[0] || null;
  }

  function isInternalMeasureProduct(product) {
    return ["weighted", "liquid", "length"].includes(product?.kind);
  }

  function displayUnits(product) {
    const units = [...(product?.units || [])];
    if (!isInternalMeasureProduct(product)) return units;
    return units.filter((unit) => clampNumber(unit.multiplier, 1) > 1);
  }

  function sellableUnits(product) {
    const units = displayUnits(product);
    if (!isInternalMeasureProduct(product)) return units;
    const pricedUnits = units.filter((unit) => clampNumber(unit.priceUsd) > 0);
    return pricedUnits.length ? pricedUnits : units;
  }

  function getProductUnit(product, unitId) {
    return product?.units?.find((unit) => unit.id === unitId) || baseUnit(product);
  }

  function getUnitMultiplier(product, unitId) {
    return clampNumber(getProductUnit(product, unitId)?.multiplier, 1);
  }

  function quantityInBase(product, quantity, unitId) {
    return preciseNumber(clampNumber(quantity) * getUnitMultiplier(product, unitId));
  }

  function productBaseUnit(product) {
    return baseUnit(product)?.name || product?.baseUnit || "وحدة";
  }

  function thresholdQuantity(product) {
    return clampNumber(product.alertQuantity);
  }

  function thresholdPieces(product) {
    return preciseNumber(thresholdQuantity(product) * stockUnitMultiplier(product));
  }

  function stockCartons(product) {
    return clampNumber(product.stockQuantity);
  }

  function thresholdCartons(product) {
    return thresholdQuantity(product);
  }

  function stockBreakdown(product) {
    const piecesUnit = product.units.find((unit) => unit.id === "piece");
    const dozenUnit = product.units.find((unit) => unit.id === "dozen");
    const cartonUnit = product.units.find((unit) => unit.id === "carton");

    if (piecesUnit && cartonUnit) {
      const totalPieces = stockBaseQuantity(product);
      const piecesPerCarton = clampNumber(cartonUnit.multiplier, 1);
      const cartons = Math.floor(totalPieces / piecesPerCarton);
      const remainderAfterCartons = totalPieces - cartons * piecesPerCarton;
      const dozens = dozenUnit ? Math.floor(remainderAfterCartons / clampNumber(dozenUnit.multiplier, 12)) : 0;
      const pieces = remainderAfterCartons - dozens * (dozenUnit ? clampNumber(dozenUnit.multiplier, 12) : 0);
      return {
        cartons,
        dozens,
        pieces,
        totalPieces,
        decimalCartons: totalPieces / piecesPerCarton
      };
    }

    return {
      cartons: 0,
      dozens: 0,
      pieces: stockBaseQuantity(product),
      totalPieces: stockBaseQuantity(product),
      decimalCartons: 0
    };
  }

  function stockSummary(product) {
    const baseQuantity = stockBaseQuantity(product);
    const units = displayUnits(product)
      .filter((unit) => clampNumber(unit.multiplier, 1) > 1)
      .sort((left, right) => clampNumber(right.multiplier, 1) - clampNumber(left.multiplier, 1));
    if (!units.length) return `${Number(baseQuantity.toFixed(2)).toLocaleString()} ${productBaseUnit(product)}`;

    let remainder = baseQuantity;
    const parts = [];

    units.forEach((unit) => {
      const multiplier = clampNumber(unit.multiplier, 1);
      const count = Math.floor(remainder / multiplier);
      if (count > 0) {
        parts.push(`${count} ${unit.name}`);
        remainder -= count * multiplier;
      }
    });

    if (remainder > 0 || !parts.length) {
      parts.push(`${Number(remainder.toFixed(2)).toLocaleString()} ${productBaseUnit(product)}`);
    }

    return parts.join(" + ");
  }

  function productKindLabel(product, lang = state.lang) {
    const labels = {
      weighted: lang === "ar" ? "موزون" : "Weighted",
      liquid: lang === "ar" ? "سائل" : "Liquid",
      length: lang === "ar" ? "طولي" : "Length",
      packaged: lang === "ar" ? "معبأ" : "Packaged",
      single: lang === "ar" ? "مفرد" : "Single"
    };
    return labels[product?.kind] || (lang === "ar" ? "عام" : "General");
  }

  function lowestAvailableUnit(product) {
    return sellableUnits(product).sort((left, right) => clampNumber(left.multiplier, 1) - clampNumber(right.multiplier, 1))[0] || null;
  }

  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  function normalizeDigits(value) {
    const eastern = "٠١٢٣٤٥٦٧٨٩";
    const persian = "۰۱۲۳۴۵۶۷۸۹";
    return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => {
      const easternIndex = eastern.indexOf(digit);
      return String(easternIndex >= 0 ? easternIndex : persian.indexOf(digit));
    });
  }

  function parseMoneyInput(amount) {
    if (typeof amount === "number") return amount;
    const raw = normalizeDigits(amount).trim().toLowerCase();
    if (!raw) return 0;
    const compact = raw
      .replace(/,/g, "")
      .replace(/دينار عراقي|دينار|د\.ع|iqd|دولار|usd|\$/g, "")
      .trim();
    const numeric = Number(compact.replace(/[^\d.-]/g, ""));
    const base = Number.isFinite(numeric) ? numeric : 0;

    if (/مليار|billion|bn/.test(compact)) return base * 1000000000;
    if (/مليون|million|m\b/.test(compact)) return base * 1000000;
    if (/الف|ألف|الاف|آلاف|k\b|هزار/.test(compact)) return base * 1000;
    return base;
  }

  function moneyToUsd(amount, currency) {
    const value = wholeMoney(parseMoneyInput(amount));
    return currency === "IQD" ? value / state.exchangeRate : value;
  }

  function convertUsd(amountUsd, currency = state.currency) {
    return wholeMoney(currency === "IQD" ? amountUsd * state.exchangeRate : amountUsd);
  }

  function formatMoney(amountUsd, currency = state.currency) {
    if (currency === "IQD") {
      const amount = convertUsd(amountUsd, "IQD");
      return `${new Intl.NumberFormat(state.lang === "ar" ? "ar-IQ" : "en-US").format(amount)} د.ع`;
    }
    const amount = convertUsd(amountUsd, currency);
    return new Intl.NumberFormat(state.lang === "ar" ? "ar-IQ" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  }

  function productCurrency(product) {
    return product?.currency || state.currency;
  }

  function formatProductMoney(product, amountUsd) {
    return formatMoney(amountUsd, productCurrency(product));
  }

  function invoiceNet(invoice) {
    if (invoice?.isVoided || invoice?.paymentStatus === "void") return 0;
    return Math.max(0, clampNumber(invoice.subtotalUsd) - clampNumber(invoice.discountUsd));
  }

  function invoiceDebt(invoice) {
    if (invoice?.isVoided || invoice?.paymentStatus === "void") return 0;
    return Math.max(0, clampNumber(invoice.remainingUsd, invoiceNet(invoice) - clampNumber(invoice.paidUsd)));
  }

  function purchaseDebt(purchase) {
    if (purchase?.isVoided || purchase?.paymentStatus === "void") return 0;
    return Math.max(0, clampNumber(purchase.remainingUsd, clampNumber(purchase.costUsd) - clampNumber(purchase.paidUsd)));
  }

  function paymentStatus(totalUsd, paidUsd, remainingUsd) {
    const total = clampNumber(totalUsd);
    const paid = clampNumber(paidUsd);
    const remaining = Math.max(0, remainingUsd === undefined ? total - paid : clampNumber(remainingUsd));
    if (total <= 0 || remaining <= 0.0001) return "paid";
    if (paid > 0) return "partial";
    return "unpaid";
  }

  function openingSigned(entry) {
    const amount = Math.abs(clampNumber(entry?.openingBalanceUsd));
    if (!amount) return 0;
    return ["credit", "advance"].includes(entry?.openingBalanceType) ? -amount : amount;
  }

  function purchaseItems(purchase) {
    return purchase.items || [];
  }

  function getWarehouseName(id) {
    return state.warehouses.find((warehouse) => warehouse.id === id)?.name || "غير مخصص";
  }

  function normalizeBarcode(value) {
    return normalizeDigits(value)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, "")
      .trim()
      .toLocaleLowerCase();
  }

  function barcodeOwnerText(owner = {}) {
    const productName = String(owner.productName || owner.name || "").trim();
    const unitName = String(owner.unitName || "").trim();
    if (owner.source === "product") return productName ? `منتج ${productName}` : "باركود منتج";
    if (unitName && productName) return `وحدة ${unitName} في منتج ${productName}`;
    if (unitName) return `وحدة ${unitName}`;
    return productName ? `منتج ${productName}` : "";
  }

  function barcodeOwnerIdentity(owner = {}) {
    return [
      owner.source || "",
      owner.productId || "",
      owner.source === "unit" ? (owner.unitId || "") : ""
    ].join(":");
  }

  function barcodeOwners(product) {
    if (!product || product.deletedAt) return [];
    const owners = [];
    const productBarcode = String(product.barcode || "").trim();
    if (normalizeBarcode(productBarcode)) {
      owners.push({
        barcode: productBarcode,
        normalized: normalizeBarcode(productBarcode),
        source: "product",
        productId: product.id || "",
        productName: product.name || "",
        ownerKey: `product:${product.id || ""}`
      });
    }
    (product.units || []).forEach((unit) => {
      const unitBarcode = String(unit?.barcode || "").trim();
      if (!normalizeBarcode(unitBarcode)) return;
      owners.push({
        barcode: unitBarcode,
        normalized: normalizeBarcode(unitBarcode),
        source: "unit",
        productId: product.id || "",
        productName: product.name || "",
        unitId: unit.id || "",
        unitName: unit.name || "",
        ownerKey: `unit:${product.id || ""}:${unit.id || ""}`
      });
    });
    return owners;
  }

  function duplicateBarcodeErrors(products = []) {
    const seen = new Map();
    const errors = [];
    (products || []).forEach((product) => {
      barcodeOwners(product).forEach((owner) => {
        const first = seen.get(owner.normalized);
        if (first && barcodeOwnerIdentity(first) === barcodeOwnerIdentity(owner)) return;
        if (first) {
          errors.push({
            barcode: owner.barcode || first.barcode,
            normalized: owner.normalized,
            first,
            second: owner
          });
          return;
        }
        seen.set(owner.normalized, owner);
      });
    });
    return errors;
  }

  function candidateBarcodeErrors(candidate, products = state.products) {
    const existingOwners = new Map();
    (products || [])
      .filter((product) => product?.id !== candidate?.id && !product?.deletedAt)
      .forEach((product) => barcodeOwners(product).forEach((owner) => {
        if (!existingOwners.has(owner.normalized)) existingOwners.set(owner.normalized, owner);
      }));
    const candidateSeen = new Map();
    const errors = [];
    barcodeOwners(candidate).forEach((owner) => {
      const sameCandidateOwner = candidateSeen.get(owner.normalized);
      if (sameCandidateOwner && barcodeOwnerIdentity(sameCandidateOwner) === barcodeOwnerIdentity(owner)) return;
      if (sameCandidateOwner) {
        errors.push({
          barcode: owner.barcode || sameCandidateOwner.barcode,
          normalized: owner.normalized,
          first: sameCandidateOwner,
          second: owner
        });
      }
      const existingOwner = existingOwners.get(owner.normalized);
      if (existingOwner) {
        errors.push({
          barcode: owner.barcode || existingOwner.barcode,
          normalized: owner.normalized,
          first: existingOwner,
          second: owner
        });
      }
      if (!candidateSeen.has(owner.normalized)) candidateSeen.set(owner.normalized, owner);
    });
    return errors;
  }

  function findProductByBarcode(barcode) {
    const normalized = normalizeBarcode(barcode);
    if (!normalized) return null;
    const product = state.products.find((entry) => {
      if (normalizeBarcode(entry.barcode) === normalized) return true;
      return sellableUnits(entry).some((unit) => normalizeBarcode(unit.barcode) === normalized);
    });
    if (!product) return null;
    const unit = sellableUnits(product).find((entry) => normalizeBarcode(entry.barcode) === normalized) || null;
    return { product, unit };
  }

  function exactBarcodeProductMatches(query, products = state.products) {
    const normalized = normalizeBarcode(query);
    if (!normalized) return [];
    return (products || []).filter((product) => (
      barcodeOwners(product).some((owner) => owner.normalized === normalized)
    ));
  }

  function productMatchesSmartSearch(product, query, textFields = [], products = state.products) {
    const cleanQuery = String(query || "").trim().toLocaleLowerCase();
    if (!cleanQuery) return true;
    const exactMatches = exactBarcodeProductMatches(query, products);
    if (exactMatches.length) {
      return exactMatches.some((entry) => entry.id === product?.id);
    }
    const fields = typeof textFields === "function" ? textFields(product) : textFields;
    return (fields || []).flat().filter(Boolean).join(" ").toLocaleLowerCase().includes(cleanQuery);
  }

  function uniqueBarcode(candidate) {
    let barcode = String(candidate || generateBarcode()).trim();
    while (state.products.some((product) => {
      if (normalizeBarcode(product.barcode) === normalizeBarcode(barcode)) return true;
      return (product.units || []).some((unit) => normalizeBarcode(unit.barcode) === normalizeBarcode(barcode));
    })) {
      barcode = generateBarcode();
    }
    return barcode;
  }

  function uniqueBarcodeFor(productId, candidate, unitId = "") {
    let barcode = String(candidate || generateBarcode()).trim();
    while (state.products.some((product) => {
      if (product.id !== productId && normalizeBarcode(product.barcode) === normalizeBarcode(barcode)) return true;
      if (product.id === productId && !unitId && (product.units || []).some((unit) => normalizeBarcode(unit.barcode) === normalizeBarcode(barcode))) return true;
      return (product.units || []).some((unit) => {
        const sameUnit = product.id === productId && unit.id === unitId;
        return !sameUnit && normalizeBarcode(unit.barcode) === normalizeBarcode(barcode);
      });
    })) {
      barcode = generateBarcode();
    }
    return barcode;
  }

  function getSupplierName(id) {
    return state.suppliers.find((supplier) => supplier.id === id)?.name || "مورد";
  }

  function accountTimeline(partyType, partyId) {
    const stored = (state.accountMovements || [])
      .filter((movement) => movement.partyType === partyType && movement.partyId === partyId);
    const synthetic = [];
    if (partyType === "client") {
      const client = state.clients.find((entry) => entry.id === partyId);
      const opening = openingSigned(client);
      const appliedByInvoice = {};
      state.clientPayments
        .filter((payment) => payment.clientId === partyId)
        .forEach((payment) => (payment.appliedTo || []).forEach((item) => {
          if (!item.invoiceId) return;
          appliedByInvoice[item.invoiceId] = clampNumber(appliedByInvoice[item.invoiceId]) + clampNumber(item.amountUsd);
        }));
      if (opening) {
        synthetic.push({
          id: `client-opening-${partyId}`,
          partyType,
          partyId,
          movementType: "opening",
          title: "رصيد افتتاحي",
          debitUsd: opening > 0 ? opening : 0,
          creditUsd: opening < 0 ? Math.abs(opening) : 0,
          note: client?.financialNote || "",
          createdAt: client?.createdAt || new Date(0).toISOString()
        });
      }
      state.invoices.filter((invoice) => invoice.clientId === partyId).forEach((invoice) => {
        synthetic.push({
          id: `client-invoice-${invoice.id}`,
          partyType,
          partyId,
          movementType: "invoice",
          title: "إضافة فاتورة",
          debitUsd: invoiceNet(invoice),
          creditUsd: 0,
          referenceId: invoice.id,
          createdAt: invoice.createdAt
        });
        const immediatePaidUsd = Math.max(0, clampNumber(invoice.paidUsd) - clampNumber(appliedByInvoice[invoice.id]));
        if (immediatePaidUsd > 0.0001) {
          synthetic.push({
            id: `client-invoice-paid-${invoice.id}`,
            partyType,
            partyId,
            movementType: "payment",
            title: "دفعة على الفاتورة",
            debitUsd: 0,
            creditUsd: immediatePaidUsd,
            referenceId: invoice.id,
            createdAt: invoice.createdAt
          });
        }
      });
      state.clientPayments.filter((payment) => payment.clientId === partyId).forEach((payment) => synthetic.push({
        id: `client-payment-${payment.id}`,
        partyType,
        partyId,
        movementType: "payment",
        title: "دفع مبلغ",
        debitUsd: 0,
        creditUsd: clampNumber(payment.amountUsd),
        referenceId: payment.id,
        note: payment.note || "",
        createdAt: payment.receivedAt || payment.createdAt
      }));
    } else {
      const supplier = state.suppliers.find((entry) => entry.id === partyId);
      const opening = openingSigned(supplier);
      const appliedByPurchase = {};
      state.supplierPayments
        .filter((payment) => payment.supplierId === partyId)
        .forEach((payment) => (payment.appliedTo || []).forEach((item) => {
          if (!item.purchaseId) return;
          appliedByPurchase[item.purchaseId] = clampNumber(appliedByPurchase[item.purchaseId]) + clampNumber(item.amountUsd);
        }));
      if (opening) {
        synthetic.push({
          id: `supplier-opening-${partyId}`,
          partyType,
          partyId,
          movementType: "opening",
          title: "رصيد افتتاحي",
          debitUsd: opening > 0 ? opening : 0,
          creditUsd: opening < 0 ? Math.abs(opening) : 0,
          note: supplier?.financialNote || "",
          createdAt: supplier?.createdAt || new Date(0).toISOString()
        });
      }
      state.purchases.filter((purchase) => purchase.supplierId === partyId).forEach((purchase) => {
        synthetic.push({
          id: `supplier-purchase-${purchase.id}`,
          partyType,
          partyId,
          movementType: "invoice",
          title: "إضافة فاتورة شراء",
          debitUsd: clampNumber(purchase.costUsd),
          creditUsd: 0,
          referenceId: purchase.id,
          createdAt: purchase.createdAt
        });
        const immediatePaidUsd = Math.max(0, clampNumber(purchase.paidUsd) - clampNumber(appliedByPurchase[purchase.id]));
        if (immediatePaidUsd > 0.0001) {
          synthetic.push({
            id: `supplier-purchase-paid-${purchase.id}`,
            partyType,
            partyId,
            movementType: "payment",
            title: "دفعة على فاتورة شراء",
            debitUsd: 0,
            creditUsd: immediatePaidUsd,
            referenceId: purchase.id,
            createdAt: purchase.createdAt
          });
        }
      });
      state.supplierPayments.filter((payment) => payment.supplierId === partyId).forEach((payment) => synthetic.push({
        id: `supplier-payment-${payment.id}`,
        partyType,
        partyId,
        movementType: "payment",
        title: "تسديد مورد",
        debitUsd: 0,
        creditUsd: clampNumber(payment.amountUsd),
        referenceId: payment.id,
        note: payment.note || "",
        createdAt: payment.paidAt || payment.createdAt
      }));
    }
    const merged = [...stored, ...synthetic].filter((movement, index, list) => (
      list.findIndex((entry) => entry.id === movement.id) === index
    ));
    return merged.sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  }

  function clientStats(clientId) {
    const client = state.clients.find((entry) => entry.id === clientId);
    const invoices = state.invoices.filter((invoice) => invoice.clientId === clientId && !invoice.isVoided && invoice.paymentStatus !== "void");
    const payments = state.clientPayments.filter((payment) => payment.clientId === clientId);
    const movements = accountTimeline("client", clientId);
    const openingUsd = openingSigned(client);
    const grossUsd = invoices.reduce((sum, invoice) => sum + clampNumber(invoice.subtotalUsd), 0);
    const discountUsd = invoices.reduce((sum, invoice) => sum + clampNumber(invoice.discountUsd), 0);
    const appliedByInvoice = {};
    payments.forEach((payment) => (payment.appliedTo || []).forEach((item) => {
      if (!item.invoiceId) return;
      appliedByInvoice[item.invoiceId] = clampNumber(appliedByInvoice[item.invoiceId]) + clampNumber(item.amountUsd);
    }));
    const directPaidUsd = invoices.reduce((sum, invoice) => (
      sum + Math.max(0, clampNumber(invoice.paidUsd) - clampNumber(appliedByInvoice[invoice.id]))
    ), 0);
    const historyPaidUsd = payments.reduce((sum, payment) => sum + clampNumber(payment.amountUsd), 0);
    const netUsd = invoices.reduce((sum, invoice) => sum + invoiceNet(invoice), 0);
    const invoicesDebtUsd = invoices.reduce((sum, invoice) => sum + invoiceDebt(invoice), 0);
    const ledgerBalanceUsd = movements.reduce((sum, movement) => (
      sum + clampNumber(movement.debitUsd) - clampNumber(movement.creditUsd)
    ), 0);
    const currentBalanceUsd = Math.max(0, preciseNumber(ledgerBalanceUsd));
    const installmentCount = invoices.reduce((sum, invoice) => (
      sum + (invoice.installmentPlan?.type === "installment" ? (invoice.installmentPlan.schedule || []).length : 0)
    ), 0);
    const activeInstallmentCount = invoices.reduce((sum, invoice) => (
      sum + (invoice.installmentPlan?.schedule || []).filter((item) => clampNumber(item.paidUsd) < clampNumber(item.amountUsd) - 0.0001).length
    ), 0);
    return {
      invoices,
      payments,
      movements,
      invoiceCount: invoices.length,
      installmentCount,
      activeInstallmentCount,
      openingUsd,
      grossUsd,
      discountUsd,
      paidUsd: directPaidUsd + historyPaidUsd,
      netUsd,
      debtUsd: currentBalanceUsd,
      totalDebt: currentBalanceUsd,
      totalPaid: directPaidUsd + historyPaidUsd,
      invoicesDebtUsd,
      paidPercent: netUsd ? Math.round((directPaidUsd / netUsd) * 100) : 0,
      debtPercent: netUsd ? Math.round((invoicesDebtUsd / netUsd) * 100) : 0,
      discountPercent: grossUsd ? Math.round((discountUsd / grossUsd) * 100) : 0
    };
  }

  function supplierStats(supplierId) {
    const supplier = state.suppliers.find((entry) => entry.id === supplierId);
    const purchases = state.purchases.filter((purchase) => purchase.supplierId === supplierId && !purchase.isVoided && purchase.paymentStatus !== "void");
    const payments = state.supplierPayments.filter((payment) => payment.supplierId === supplierId);
    const movements = accountTimeline("supplier", supplierId);
    const openingUsd = openingSigned(supplier);
    const totalUsd = purchases.reduce((sum, purchase) => sum + clampNumber(purchase.costUsd), 0);
    const appliedByPurchase = {};
    payments.forEach((payment) => (payment.appliedTo || []).forEach((item) => {
      if (!item.purchaseId) return;
      appliedByPurchase[item.purchaseId] = clampNumber(appliedByPurchase[item.purchaseId]) + clampNumber(item.amountUsd);
    }));
    const directPaidUsd = purchases.reduce((sum, purchase) => (
      sum + Math.max(0, clampNumber(purchase.paidUsd) - clampNumber(appliedByPurchase[purchase.id]))
    ), 0);
    const historyPaidUsd = payments.reduce((sum, payment) => sum + clampNumber(payment.amountUsd), 0);
    const purchasesDebtUsd = purchases.reduce((sum, purchase) => sum + purchaseDebt(purchase), 0);
    const ledgerBalanceUsd = movements.reduce((sum, movement) => (
      sum + clampNumber(movement.debitUsd) - clampNumber(movement.creditUsd)
    ), 0);
    const itemsCount = purchases.reduce((sum, purchase) => sum + purchaseItems(purchase).length, 0);
    const currentBalanceUsd = Math.max(0, preciseNumber(ledgerBalanceUsd));
    return {
      purchases,
      payments,
      movements,
      openingUsd,
      totalUsd,
      paidUsd: directPaidUsd + historyPaidUsd,
      debtUsd: currentBalanceUsd,
      totalDebt: currentBalanceUsd,
      totalPaid: directPaidUsd + historyPaidUsd,
      purchasesDebtUsd,
      itemsCount,
      orderCount: purchases.length
    };
  }

  function cashVoucherTotals(vouchers = state.cashVouchers) {
    return (vouchers || []).reduce((totals, voucher) => {
      const amountUsd = clampNumber(voucher.amountUsd);
      if (voucher.type === "payment") {
        totals.paymentsUsd += amountUsd;
      } else {
        totals.receiptsUsd += amountUsd;
      }
      return totals;
    }, { receiptsUsd: 0, paymentsUsd: 0 });
  }

  function cashboxSnapshot() {
    const appliedByInvoice = {};
    state.clientPayments.forEach((payment) => (payment.appliedTo || []).forEach((item) => {
      if (!item.invoiceId) return;
      appliedByInvoice[item.invoiceId] = clampNumber(appliedByInvoice[item.invoiceId]) + clampNumber(item.amountUsd);
    }));
    const appliedByPurchase = {};
    state.supplierPayments.forEach((payment) => (payment.appliedTo || []).forEach((item) => {
      if (!item.purchaseId) return;
      appliedByPurchase[item.purchaseId] = clampNumber(appliedByPurchase[item.purchaseId]) + clampNumber(item.amountUsd);
    }));

    const invoicePaidUsd = state.invoices.reduce((sum, invoice) => (
      sum + Math.max(0, clampNumber(invoice.paidUsd) - clampNumber(appliedByInvoice[invoice.id]))
    ), 0);
    const clientPaymentUsd = state.clientPayments.reduce((sum, payment) => sum + clampNumber(payment.amountUsd), 0);
    const purchasesPaidUsd = state.purchases.reduce((sum, purchase) => (
      sum + Math.max(0, clampNumber(purchase.paidUsd) - clampNumber(appliedByPurchase[purchase.id]))
    ), 0);
    const supplierPaymentUsd = state.supplierPayments.reduce((sum, payment) => sum + clampNumber(payment.amountUsd), 0);
    const voucherTotals = cashVoucherTotals();
    const totalReceiptsUsd = voucherTotals.receiptsUsd + invoicePaidUsd + clientPaymentUsd;
    const totalPaymentsUsd = voucherTotals.paymentsUsd + purchasesPaidUsd + supplierPaymentUsd;

    return {
      balanceUsd: preciseNumber(totalReceiptsUsd - totalPaymentsUsd),
      receiptsUsd: preciseNumber(voucherTotals.receiptsUsd),
      paymentsUsd: preciseNumber(voucherTotals.paymentsUsd),
      invoicePaidUsd: preciseNumber(invoicePaidUsd),
      clientPaymentUsd: preciseNumber(clientPaymentUsd),
      purchasesPaidUsd: preciseNumber(purchasesPaidUsd),
      supplierPaymentUsd: preciseNumber(supplierPaymentUsd),
      totalReceiptsUsd: preciseNumber(totalReceiptsUsd),
      totalPaymentsUsd: preciseNumber(totalPaymentsUsd),
      vouchers: [...state.cashVouchers].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    };
  }

  function reportSnapshot() {
    const salesByProduct = {};
    state.invoices.forEach((invoice) => {
      (invoice.items || []).forEach((item) => {
        salesByProduct[item.productId] = (salesByProduct[item.productId] || 0) + clampNumber(item.totalUsd);
      });
    });

    const topProducts = Object.entries(salesByProduct)
      .map(([productId, totalUsd]) => ({
        productId,
        name: state.products.find((product) => product.id === productId)?.name || "\u0645\u0646\u062a\u062c \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641",
        totalUsd
      }))
      .sort((left, right) => right.totalUsd - left.totalUsd)
      .slice(0, 5);

    const lowStock = state.products
      .filter((product) => clampNumber(product.stockQuantity) <= thresholdQuantity(product))
      .map((product) => ({
        id: product.id,
        name: product.name,
        warehouse: getWarehouseName(product.warehouseId),
        stockText: stockSummary(product)
      }));

    const clientDebt = state.clients
      .map((client) => ({
        id: client.id,
        name: client.name,
        debtUsd: clientStats(client.id).debtUsd
      }))
      .filter((client) => client.debtUsd > 0)
      .sort((left, right) => right.debtUsd - left.debtUsd)
      .slice(0, 5);

    const supplierDebt = state.suppliers
      .map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        debtUsd: supplierStats(supplier.id).debtUsd
      }))
      .filter((supplier) => supplier.debtUsd > 0)
      .sort((left, right) => right.debtUsd - left.debtUsd)
      .slice(0, 5);

    const activeInvoices = state.invoices.filter((invoice) => !invoice.isVoided && invoice.paymentStatus !== "void");
    const salesNetUsd = activeInvoices.reduce((sum, invoice) => sum + invoiceNet(invoice), 0);
    const salesCogsUsd = activeInvoices.reduce((sum, invoice) => (
      sum + (invoice.items || []).reduce((lineSum, item) => lineSum + clampNumber(item.totalCostUsd), 0)
    ), 0);
    const purchasesTotalUsd = state.purchases
      .filter((purchase) => !purchase.isVoided && purchase.paymentStatus !== "void")
      .reduce((sum, purchase) => sum + clampNumber(purchase.costUsd), 0);
    const salesDebtUsd = state.invoices.reduce((sum, invoice) => sum + invoiceDebt(invoice), 0);
    const purchasesDebtUsd = state.purchases.reduce((sum, purchase) => sum + purchaseDebt(purchase), 0);
    const voucherTotals = cashVoucherTotals();
    const estimatedNetUsd = salesNetUsd - salesCogsUsd + voucherTotals.receiptsUsd - voucherTotals.paymentsUsd;
    const stockValueUsd = state.products.reduce((sum, product) => {
      const base = baseUnit(product);
      return sum + stockBaseQuantity(product) * clampNumber(base?.priceUsd);
    }, 0);

    return {
      summary: {
        salesNetUsd,
        salesCogsUsd,
        cogsUsd: salesCogsUsd,
        purchasesTotalUsd,
        salesDebtUsd,
        purchasesDebtUsd,
        cashVoucherReceiptsUsd: voucherTotals.receiptsUsd,
        cashVoucherPaymentsUsd: voucherTotals.paymentsUsd,
        estimatedNetUsd,
        stockValueUsd,
        productsCount: state.products.length,
        warehousesCount: state.warehouses.length,
        clientsCount: state.clients.length,
        suppliersCount: state.suppliers.length
      },
      topProducts,
      lowStock,
      clientDebt,
      supplierDebt
    };
  }

  function emit() {
    const unknownProductLabel = "\u0645\u0646\u062a\u062c \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641";
    const displayNameFromItem = (item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      const text = repairText(product?.name || item.productName || item.name || "").trim();
      const productId = String(item.productId || "").trim();
      return text && text !== productId && !/^p-\d+/i.test(text) ? text : unknownProductLabel;
    };
    const stockAlerts = state.products
      .filter((product) => clampNumber(product.stockQuantity) <= thresholdQuantity(product))
      .map((product) => ({
        type: clampNumber(product.stockQuantity) <= 0 ? "OUT_OF_STOCK" : "CRITICAL_WARNING",
        productId: product.id,
        product: product.name,
        currentStock: clampNumber(product.stockQuantity),
        threshold: thresholdQuantity(product),
        createdAt: new Date().toISOString()
      }));

    const now = Date.now();
    const expiryAlerts = state.purchases.flatMap((purchase) => purchaseItems(purchase)
      .filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() <= now)
      .map((item) => ({
        type: "EXPIRED_PRODUCT",
        productId: item.productId,
        product: displayNameFromItem(item),
        purchaseId: purchase.id,
        expiresAt: item.expiresAt,
        createdAt: new Date().toISOString()
      })));

    const productExpiryAlerts = state.products
      .filter((product) => product.expiresAt && new Date(product.expiresAt).getTime() <= now)
      .map((product) => ({
        type: "EXPIRED_PRODUCT",
        productId: product.id,
        product: product.name,
        expiresAt: product.expiresAt,
        createdAt: new Date().toISOString()
      }));

    state.alerts = [...stockAlerts, ...productExpiryAlerts, ...expiryAlerts];
    persist();
    scheduleBackendSync();
    listeners.forEach((listener) => listener(getState()));
  }

  function setTheme(theme) {
    state.theme = safeTheme(theme, state.theme);
    emit();
  }

  function setLanguage(lang) {
    state.lang = lang === "en" ? "en" : "ar";
    state.dir = state.lang === "ar" ? "rtl" : "ltr";
    emit();
  }

  function toggleDir() {
    setLanguage(state.lang === "ar" ? "en" : "ar");
  }

  function setCurrency(currency) {
    state.currency = currency === "USD" ? "USD" : "IQD";
    emit();
  }

  function toggleCurrency() {
    setCurrency(state.currency === "IQD" ? "USD" : "IQD");
  }

  function setExchangeRate(value) {
    const rate = Math.max(1, clampNumber(value, state.exchangeRate));
    state.exchangeRate = rate;
    emit();
  }

  function setBusinessProfile(profile = {}) {
    if (Object.prototype.hasOwnProperty.call(profile, "businessName")) {
      state.businessName = String(profile.businessName || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(profile, "businessSubtitle")) {
      state.businessSubtitle = String(profile.businessSubtitle || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(profile, "businessPhone")) {
      state.businessPhone = String(profile.businessPhone || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(profile, "businessAddress")) {
      state.businessAddress = String(profile.businessAddress || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(profile, "businessOwnerName")) {
      state.businessOwnerName = String(profile.businessOwnerName || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(profile, "businessCompanyName")) {
      state.businessCompanyName = String(profile.businessCompanyName || "").trim();
    }
    emit();
  }

  function businessProfileName(source = state) {
    return String(source.businessName || "").trim() || "TOX";
  }

  function businessProfileParts(source = state) {
    const isArabic = (source.lang || state.lang) !== "en";
    const owner = String(source.businessOwnerName || "").trim();
    const company = String(source.businessCompanyName || "").trim();
    const phone = String(source.businessPhone || "").trim();
    const address = String(source.businessAddress || "").trim();
    const legacySubtitle = String(source.businessSubtitle || "").trim();
    return [
      owner ? `${isArabic ? "صاحب الحساب" : "Owner"}: ${owner}` : "",
      company ? `${isArabic ? "الشركة" : "Company"}: ${company}` : "",
      phone ? `${isArabic ? "الهاتف" : "Phone"}: ${phone}` : "",
      address ? `${isArabic ? "الموقع" : "Location"}: ${address}` : "",
      !owner && !company ? legacySubtitle : "",
    ].filter(Boolean);
  }

  function businessProfileLine(source = state, fallback = "") {
    return businessProfileParts(source).join(" | ") || fallback || businessProfileName(source);
  }

  function setSoundSettings(settings = {}) {
    if (Object.prototype.hasOwnProperty.call(settings, "soundEnabled")) {
      state.soundEnabled = settings.soundEnabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(settings, "soundVolume")) {
      state.soundVolume = Math.min(1, Math.max(0, Number(settings.soundVolume)));
    }
    if (Object.prototype.hasOwnProperty.call(settings, "soundPack")) {
      state.soundPack = "professional";
    }
    emit();
  }

  function setInvoicePrintSettings(nextSettings = {}) {
    const incoming = nextSettings && typeof nextSettings === "object" ? nextSettings : {};
    state.invoicePrintSettings = normalizeInvoicePrintSettings({
      ...state.invoicePrintSettings,
      ...incoming,
      designer: {
        ...(state.invoicePrintSettings?.designer || {}),
        ...(incoming.designer || {}),
        brand: {
          ...(state.invoicePrintSettings?.designer?.brand || {}),
          ...(incoming.designer?.brand || {})
        },
        layout: {
          ...(state.invoicePrintSettings?.designer?.layout || {}),
          ...(incoming.designer?.layout || {})
        },
        typography: {
          ...(state.invoicePrintSettings?.designer?.typography || {}),
          ...(incoming.designer?.typography || {})
        },
        footer: {
          ...(state.invoicePrintSettings?.designer?.footer || {}),
          ...(incoming.designer?.footer || {})
        }
      },
      showFields: {
        ...(state.invoicePrintSettings?.showFields || {}),
        ...(incoming.showFields || {})
      },
      perDocumentType: {
        ...(state.invoicePrintSettings?.perDocumentType || {}),
        ...(incoming.perDocumentType || {})
      }
    });
    emit();
  }

  function setInstallmentProfitSettings(nextSettings = {}) {
    state.installmentProfitSettings = normalizeInstallmentProfitSettings({
      ...state.installmentProfitSettings,
      ...(nextSettings || {})
    });
    emit();
  }

  function setProductPricingSettings(nextSettings = {}) {
    state.productPricingSettings = normalizeProductPricingSettings({
      ...state.productPricingSettings,
      ...(nextSettings || {})
    });
    emit();
  }

  function addCashVoucher({ type, amount, currency, party, note, createdAt } = {}) {
    const voucherCurrency = currency === "USD" ? "USD" : "IQD";
    const amountUsd = preciseNumber(Math.abs(moneyToUsd(amount, voucherCurrency)));
    if (amountUsd <= 0) return null;
    const voucher = {
      id: `CV-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      type: type === "payment" ? "payment" : "receipt",
      amount: preciseNumber(Math.abs(parseMoneyInput(amount))),
      amountUsd,
      currency: voucherCurrency,
      party: String(party || "").trim(),
      note: String(note || "").trim(),
      createdAt: createdAt || new Date().toISOString()
    };
    state.cashVouchers.unshift(voucher);
    emit();
    return voucher;
  }

  function addWarehouse({ name, code, zone, manager, color, note }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const warehouse = {
      id: `wh-${Date.now()}`,
      name: cleanName,
      code: String(code || `WH-${state.warehouses.length + 1}`).trim(),
      zone: String(zone || "").trim(),
      manager: String(manager || "").trim(),
      color: safeInventoryColor(color, state.warehouses.length),
      note: String(note || "").trim()
    };
    state.warehouses.unshift(warehouse);
    emit();
    return warehouse.id;
  }

  function addSupplier({ name, companyName, phone, email, city, address, note, openingBalance, openingBalanceType, financialNote }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const openingBalanceUsd = Math.abs(moneyToUsd(openingBalance || 0, state.currency));
    const createdAt = new Date().toISOString();
    const supplier = {
      id: `s-${Date.now()}`,
      name: cleanName,
      companyName: String(companyName || "").trim(),
      phone: String(phone || "").trim(),
      email: String(email || "").trim(),
      city: String(city || "").trim(),
      address: String(address || city || "").trim(),
      openingBalanceUsd,
      openingBalanceType: openingBalanceType || "debit",
      financialNote: String(financialNote || "").trim(),
      balanceUsd: openingBalanceType === "credit" ? -openingBalanceUsd : openingBalanceUsd,
      note: String(note || "").trim(),
      createdAt
    };
    state.suppliers.unshift(supplier);
    emit();
    return supplier.id;
  }

  function addClient({ name, phone, address, openingBalance, openingBalanceType, financialNote, debtLimit, note }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const openingBalanceUsd = Math.abs(moneyToUsd(openingBalance || 0, state.currency));
    const client = {
      id: `c-${Date.now()}`,
      name: cleanName,
      phone: String(phone || "").trim(),
      address: String(address || "").trim(),
      openingBalanceUsd,
      openingBalanceType: openingBalanceType || "debit",
      financialNote: String(financialNote || "").trim(),
      debtLimitUsd: Math.max(0, moneyToUsd(debtLimit || 0, state.currency)),
      balanceUsd: openingBalanceType === "credit" ? -openingBalanceUsd : openingBalanceUsd,
      note: String(note || "").trim(),
      createdAt: new Date().toISOString()
    };
    state.clients.unshift(client);
    emit();
    return client.id;
  }

  function updateClient(clientId, patch) {
    const client = state.clients.find((entry) => entry.id === clientId);
    if (!client) return { ok: false, reason: "NO_CLIENT" };
    if (patch.name !== undefined) client.name = String(patch.name || "").trim() || client.name;
    if (patch.phone !== undefined) client.phone = String(patch.phone || "").trim();
    if (patch.address !== undefined) client.address = String(patch.address || "").trim();
    if (patch.note !== undefined) client.note = String(patch.note || "").trim();
    emit();
    return { ok: true, client };
  }

  function updateSupplier(supplierId, patch) {
    const supplier = state.suppliers.find((entry) => entry.id === supplierId);
    if (!supplier) return { ok: false, reason: "NO_SUPPLIER" };
    if (patch.name !== undefined) supplier.name = String(patch.name || "").trim() || supplier.name;
    if (patch.companyName !== undefined) supplier.companyName = String(patch.companyName || "").trim();
    if (patch.phone !== undefined) supplier.phone = String(patch.phone || "").trim();
    if (patch.email !== undefined) supplier.email = String(patch.email || "").trim();
    if (patch.city !== undefined) supplier.city = String(patch.city || "").trim();
    if (patch.address !== undefined) supplier.address = String(patch.address || "").trim();
    if (patch.note !== undefined) supplier.note = String(patch.note || "").trim();
    if (patch.financialNote !== undefined) supplier.financialNote = String(patch.financialNote || "").trim();
    emit();
    return { ok: true, supplier };
  }

  function addEmployee({ name, phone, role, salary, workHours }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const employee = {
      id: `e-${Date.now()}`,
      name: cleanName,
      phone: String(phone || "").trim(),
      role: String(role || "").trim(),
      salary: clampNumber(salary),
      workHours: String(workHours || "").trim()
    };
    state.employees.unshift(employee);
    emit();
    return employee.id;
  }

  function deleteEmployee(employeeId) {
    state.employees = state.employees.filter((employee) => employee.id !== employeeId);
    emit();
    return { ok: true };
  }

  function deleteClient(clientId) {
    const hasSuspended = state.suspendedInvoices.some((invoice) => invoice.clientId === clientId);
    const clientInvoices = state.invoices.filter((invoice) => invoice.clientId === clientId && !invoice.isVoided && invoice.paymentStatus !== "void");
    const hasOpenInstallments = clientInvoices.some((invoice) => (
      invoice.installmentPlan?.type === "installment"
      && (invoice.installmentPlan.schedule || []).some((item) => clampNumber(item.paidUsd) < clampNumber(item.amountUsd) - 0.0001)
    ));
    const stats = clientStats(clientId);
    if (stats.debtUsd > 0.0001) return { ok: false, reason: "CLIENT_HAS_DEBT" };
    if (hasOpenInstallments) return { ok: false, reason: "CLIENT_HAS_INSTALLMENTS" };
    if (hasSuspended) return { ok: false, reason: "CLIENT_HAS_SUSPENDED" };
    const client = state.clients.find((entry) => entry.id === clientId);
    if (!client) return { ok: false, reason: "NO_CLIENT" };
    state.invoices.forEach((invoice) => {
      if (invoice.clientId !== clientId) return;
      invoice.clientId = null;
      invoice.customerName = invoice.customerName || client?.name || "زبون محذوف";
    });
    state.clientPayments.forEach((payment) => {
      if (payment.clientId !== clientId) return;
      payment.clientId = null;
      payment.clientName = payment.clientName || client?.name || "زبون محذوف";
    });
    state.clients = state.clients.filter((client) => client.id !== clientId);
    emit();
    return { ok: true };
  }

  function deleteSupplier(supplierId) {
    const stats = supplierStats(supplierId);
    const hasHistory = state.purchases.some((purchase) => purchase.supplierId === supplierId)
      || state.supplierPayments.some((payment) => payment.supplierId === supplierId);
    if (stats.debtUsd > 0.0001) return { ok: false, reason: "SUPPLIER_HAS_DEBT" };
    if (hasHistory) return { ok: false, reason: "SUPPLIER_HAS_HISTORY" };
    const supplier = state.suppliers.find((entry) => entry.id === supplierId);
    state.purchases.forEach((purchase) => {
      if (purchase.supplierId !== supplierId) return;
      purchase.supplierId = null;
      purchase.supplierName = purchase.supplierName || supplier?.name || "مورد محذوف";
    });
    state.supplierPayments.forEach((payment) => {
      if (payment.supplierId !== supplierId) return;
      payment.supplierId = null;
      payment.supplierName = payment.supplierName || supplier?.name || "مورد محذوف";
    });
    state.suspendedPurchases.forEach((purchase) => {
      if (purchase.supplierId !== supplierId) return;
      purchase.supplierId = null;
      purchase.supplierName = purchase.supplierName || supplier?.name || "مورد محذوف";
    });
    state.suppliers = state.suppliers.filter((supplier) => supplier.id !== supplierId);
    emit();
    return { ok: true };
  }

  function addProduct(payload) {
    const currency = payload.currency || "IQD";
    const name = String(payload.name || "").trim();
    const baseUnitName = String(payload.baseUnit || "قطعة").trim();
    const storageMultiplier = Math.max(0.0001, preciseNumber(payload.stockUnitMultiplier || 1));
    const storageName = String(payload.stockUnitName || baseUnitName).trim();
    const openingMultiplier = Math.max(0.0001, preciseNumber(payload.openingStockUnitMultiplier || storageMultiplier));
    const openingBaseQuantity = payload.stockQuantityInBase !== undefined
      ? preciseNumber(payload.stockQuantityInBase)
      : preciseNumber(clampNumber(payload.stockQuantity) * openingMultiplier);
    const stockQuantity = preciseNumber(openingBaseQuantity / storageMultiplier);
    const alertQuantity = preciseNumber(payload.alertQuantity);
    const internalMeasure = ["weighted", "liquid", "length"].includes(payload.kind);
    const purchaseCostUsd = payload.purchaseCostUsd !== undefined
      ? preciseNumber(payload.purchaseCostUsd)
      : moneyToUsd(payload.purchaseCost ?? payload.purchaseCostAmount, payload.purchaseCostCurrency || currency);
    if (purchaseCostUsd <= 0) {
      return { ok: false, reason: "PURCHASE_COST_REQUIRED" };
    }
    const units = [];
    const usedUnitIds = new Set();

    addOrMergeUnit(units, usedUnitIds, {
      id: payload.baseUnitId,
      name: baseUnitName,
      multiplier: 1,
      priceUsd: internalMeasure ? 0 : moneyToUsd(payload.baseUnitPrice, currency),
      barcode: internalMeasure ? "" : String(payload.baseUnitBarcode || "").trim()
    }, currency);

    if (storageMultiplier > 1) {
      addOrMergeUnit(units, usedUnitIds, {
        id: payload.stockUnitId,
        name: storageName,
        multiplier: storageMultiplier,
        price: payload.stockUnitPrice || "",
        barcode: payload.stockUnitBarcode || ""
      }, currency);
    }

    (payload.extraUnits || []).forEach((unit) => {
      if (!String(unit.name || "").trim()) return;
      const multiplier = preciseNumber(unit.multiplier);
      if (multiplier <= 0 || multiplier === 1) return;
      addOrMergeUnit(units, usedUnitIds, {
        id: unit.id,
        name: unit.name,
        multiplier,
        price: unit.price,
        barcode: unit.barcode
      }, currency);
    });

    const originCountry = String(payload.originCountry || payload.origin || "").trim();
    const product = {
      id: `p-${Date.now()}`,
      name,
      brand: String(payload.brand || "").trim(),
      originCountry,
      origin: originCountry,
      kind: payload.kind || "single",
      barcode: internalMeasure ? "" : String(payload.barcode || "").trim(),
      image: String(payload.image || payload.imageUrl || "").trim(),
      imageUrl: String(payload.image || payload.imageUrl || "").trim(),
      images: Array.isArray(payload.images) ? payload.images : [],
      warehouseId: payload.warehouseId,
      currency,
      baseUnit: baseUnitName,
      stockQuantity,
      alertQuantity,
      stockUnitName: storageName,
      stockUnitMultiplier: storageMultiplier,
      stockQuantityMode: storageStockMode,
      purchaseCostUsd,
      preventNegativeSale: payload.preventNegativeSale !== false,
      expiryStart: payload.expiryStart || null,
      expiresAt: payload.expiresAt || null,
      units
    };
    const barcodeErrors = candidateBarcodeErrors(product);
    if (barcodeErrors.length) {
      return { ok: false, reason: "DUPLICATE_BARCODE", errors: barcodeErrors };
    }
    state.products.unshift(product);
    emit();
    return { ok: true, product };
  }

  function validateProductBarcodePatch(productId, productPatch = {}, unitPatches = []) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return { ok: false, reason: "NO_PRODUCT", errors: [] };
    const patchByUnit = new Map((unitPatches || []).map((patch) => [patch.unitId || patch.id, patch]));
    const candidate = {
      ...product,
      name: productPatch.name !== undefined ? String(productPatch.name || "").trim() : product.name,
      barcode: productPatch.barcode !== undefined ? String(productPatch.barcode || "").trim() : product.barcode,
      units: (product.units || []).map((unit) => {
        const patch = patchByUnit.get(unit.id) || {};
        return {
          ...unit,
          name: patch.name !== undefined ? String(patch.name || unit.name || "").trim() : unit.name,
          barcode: patch.barcode !== undefined ? String(patch.barcode || "").trim() : unit.barcode
        };
      })
    };
    const errors = candidateBarcodeErrors(candidate);
    return errors.length
      ? { ok: false, reason: "DUPLICATE_BARCODE", errors }
      : { ok: true, product: candidate };
  }

  function iraqiPriceStep(amount) {
    const value = Math.abs(clampNumber(amount));
    if (value >= 25000) return 1000;
    if (value >= 5000) return 500;
    return 250;
  }

  function validateProductReadiness(product, options = {}) {
    const pricingSettings = normalizeProductPricingSettings(state.productPricingSettings);
    const minMargin = clampNumber(options.minMargin, pricingSettings.lowMarginWarningPercent);
    const allowSaleBelowCost = options.allowSaleBelowCost ?? pricingSettings.allowSaleBelowCost;
    const issues = [];
    const storageMultiplier = stockUnitMultiplier(product);
    const purchaseCost = clampNumber(product?.purchaseCostUsd);
    const currency = productCurrency(product);
    const units = product?.units || [];
    const pricedUnits = sellableUnits(product).filter((unit) => clampNumber(unit.priceUsd) > 0);
    const addIssue = (code, severity, message, details = {}) => {
      issues.push({ code, severity, message, details });
    };

    if (!product) {
      addIssue("NO_PRODUCT", "critical", "لا يوجد منتج للفحص.");
      return { ok: false, issues };
    }
    if (storageMultiplier <= 0) addIssue("INVALID_STORAGE_UNIT", "critical", "معامل وحدة التخزين غير صحيح.");
    if (!units.length) addIssue("MISSING_UNITS", "critical", "لا توجد وحدات بيع مرتبطة بالمنتج.");
    if (!units.some((unit) => Math.abs(clampNumber(unit.multiplier, 1) - 1) < 0.0001)) {
      addIssue("MISSING_BASE_UNIT", "critical", "يجب وجود وحدة أساس ×1 حتى ترتبط كل الوحدات بها.");
    }
    units.forEach((unit) => {
      if (clampNumber(unit.multiplier) <= 0) {
        addIssue("INVALID_UNIT_MULTIPLIER", "critical", `معامل الوحدة ${unit.name || unit.id} غير صحيح.`, { unitId: unit.id });
      }
    });

    const kind = product.kind || "single";
    const baseName = String(productBaseUnit(product) || product.baseUnit || "").trim();
    if (kind === "liquid" && !/مل|ml/i.test(baseName)) {
      addIssue("LIQUID_BASE_UNIT", "warning", "يفضل أن تكون وحدة أساس السوائل مل حتى يحسب 250 مل بشكل صحيح.");
    }
    if (kind === "length" && !/سم|cm/i.test(baseName)) {
      addIssue("LENGTH_BASE_UNIT", "warning", "يفضل أن تكون وحدة أساس الأطوال سم حتى يحسب نصف متر بشكل صحيح.");
    }
    if (kind === "weighted" && !/غرام|غ|g/i.test(baseName)) {
      addIssue("WEIGHT_BASE_UNIT", "warning", "يفضل أن تكون وحدة أساس الوزن غرام.");
    }

    if (purchaseCost <= 0) addIssue("MISSING_PURCHASE_COST", "critical", "سعر الشراء مطلوب لحساب الربح الآمن.");
    if (!pricedUnits.length) addIssue("MISSING_SELLING_PRICE", "critical", "لا توجد وحدة بيع بسعر صالح.");

    pricedUnits.forEach((unit) => {
      const unitCostUsd = storageMultiplier > 0 ? purchaseCost * (clampNumber(unit.multiplier, 1) / storageMultiplier) : 0;
      const priceUsd = clampNumber(unit.priceUsd);
      const profitUsd = priceUsd - unitCostUsd;
      const margin = priceUsd > 0 ? (profitUsd / priceUsd) * 100 : 0;
      const markup = unitCostUsd > 0 ? (profitUsd / unitCostUsd) * 100 : 0;
      if (priceUsd < unitCostUsd) {
        addIssue("UNIT_SALE_LOSS", allowSaleBelowCost ? "warning" : "critical", `سعر ${unit.name} أقل من الكلفة.`, {
          unitId: unit.id,
          unitName: unit.name,
          priceUsd,
          unitCostUsd,
          profitUsd,
          markup,
          margin
        });
      } else if (margin < minMargin) {
        addIssue("LOW_UNIT_MARGIN", "warning", `هامش ${unit.name} منخفض (${margin.toFixed(1)}%).`, {
          unitId: unit.id,
          unitName: unit.name,
          priceUsd,
          unitCostUsd,
          profitUsd,
          markup,
          margin
        });
      }
      if (currency === "IQD") {
        const priceIqd = convertUsd(priceUsd, "IQD");
        const step = iraqiPriceStep(priceIqd);
        const rounded = Math.round(priceIqd / step) * step;
        if (priceIqd > 0 && Math.abs(priceIqd - rounded) > 0.01) {
          addIssue("IRAQI_ROUNDING", "warning", `سعر ${unit.name} غير مقرب عراقياً إلى ${step}.`, {
            unitId: unit.id,
            unitName: unit.name,
            priceIqd,
            suggestedIqd: Math.max(step, rounded),
            step
          });
        }
      }
    });

    const hasStorageUnit = storageMultiplier <= 1 || units.some((unit) => Math.abs(clampNumber(unit.multiplier, 1) - storageMultiplier) < 0.0001);
    if (!hasStorageUnit) addIssue("MISSING_STORAGE_SELL_UNIT", "warning", "وحدة التخزين غير موجودة كوحدة بيع؛ تأكد من ربط الكارتون/الجالون/الرول.");

    const blocking = issues.filter((issue) => issue.severity === "critical");
    return { ok: !blocking.length, issues, blocking };
  }

  function applyProductPatch(product, patch = {}) {
    if (patch.name !== undefined) product.name = String(patch.name).trim();
    if (patch.brand !== undefined) product.brand = String(patch.brand || "").trim();
    if (patch.originCountry !== undefined || patch.origin !== undefined) {
      const originCountry = String(patch.originCountry ?? patch.origin ?? "").trim();
      product.originCountry = originCountry;
      product.origin = originCountry;
    }
    if (patch.image !== undefined || patch.imageUrl !== undefined) {
      product.image = String(patch.image ?? patch.imageUrl ?? "").trim();
      product.imageUrl = product.image;
    }
    if (Array.isArray(patch.images)) {
      product.images = patch.images;
      const primary = patch.images.find((image) => image.isPrimary) || patch.images[0];
      if (primary) {
        product.image = primary.imageUrl || primary.url || primary.largeUrl || "";
        product.imageUrl = product.image;
      }
    }
    if (patch.warehouseId !== undefined) product.warehouseId = patch.warehouseId;
    if (patch.barcode !== undefined) product.barcode = String(patch.barcode || "").trim();
    if (patch.currency !== undefined) {
      product.currency = patch.currency;
      product.units.forEach((unit) => {
        unit.priceCurrency = patch.currency;
      });
    }
    if (patch.stockQuantity !== undefined) product.stockQuantity = Math.max(0, clampNumber(patch.stockQuantity));
    if (patch.alertQuantity !== undefined) product.alertQuantity = Math.max(0, clampNumber(patch.alertQuantity));
    if (patch.purchaseCostUsd !== undefined) product.purchaseCostUsd = Math.max(0, clampNumber(patch.purchaseCostUsd));
    if (patch.purchaseCost !== undefined) product.purchaseCostUsd = Math.max(0, moneyToUsd(patch.purchaseCost, patch.purchaseCostCurrency || patch.currency || product.currency || state.currency));
    if (patch.stockUnitName !== undefined) product.stockUnitName = String(patch.stockUnitName || product.baseUnit || "وحدة").trim();
    if (patch.stockUnitMultiplier !== undefined) product.stockUnitMultiplier = Math.max(0.0001, clampNumber(patch.stockUnitMultiplier, product.stockUnitMultiplier || 1));
    if (patch.expiresAt !== undefined) product.expiresAt = patch.expiresAt || null;
    if (patch.expiryStart !== undefined) product.expiryStart = patch.expiryStart || null;
  }

  function applyProductUnitPatch(product, unit, patch = {}) {
    if (patch.name !== undefined) {
      const cleanName = String(patch.name || "").trim();
      if (cleanName) {
        unit.name = cleanName;
        if (unit.multiplier === 1) product.baseUnit = cleanName;
      }
    }
    if (patch.multiplier !== undefined && unit.multiplier !== 1) {
      unit.multiplier = Math.max(0.0001, clampNumber(patch.multiplier, unit.multiplier));
    }
    if (patch.price !== undefined) {
      const currency = patch.currency || product.currency || state.currency;
      unit.priceUsd = moneyToUsd(patch.price, currency);
      unit.priceCurrency = currency;
      product.currency = currency;
    }
    if (patch.priceUsd !== undefined) {
      const currency = patch.currency || patch.priceCurrency || product.currency || state.currency;
      unit.priceUsd = Math.max(0, clampNumber(patch.priceUsd));
      unit.priceCurrency = currency;
      product.currency = currency;
    }
    if (patch.barcode !== undefined) {
      unit.barcode = String(patch.barcode || "").trim();
    }
  }

  function updateProduct(productId, patch) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return { ok: false, reason: "NO_PRODUCT" };
    applyProductPatch(product, patch);
    emit();
    return { ok: true, product };
  }

  function updateProductUnit(productId, unitId, patch) {
    const product = state.products.find((item) => item.id === productId);
    const unit = product?.units.find((entry) => entry.id === unitId);
    if (!unit) return { ok: false, reason: "NO_UNIT" };
    applyProductUnitPatch(product, unit, patch);
    emit();
    return { ok: true, unit };
  }

  function updateProductWithUnits(productId, productPatch = {}, unitPatches = []) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return { ok: false, reason: "NO_PRODUCT" };
    const barcodeValidation = validateProductBarcodePatch(productId, productPatch, unitPatches);
    if (!barcodeValidation.ok) return barcodeValidation;
    applyProductPatch(product, productPatch);
    for (const patch of unitPatches || []) {
      const unitId = patch.unitId || patch.id;
      const unit = product.units.find((entry) => entry.id === unitId);
      if (!unit) return { ok: false, reason: "NO_UNIT" };
      applyProductUnitPatch(product, unit, patch);
    }
    emit();
    try {
      window.dispatchEvent(new CustomEvent("tox:product-updated", { detail: { productId } }));
    } catch (error) { }
    return { ok: true, product };
  }

  function updateProductUnitPrice(productId, unitId, amount, currency = state.currency) {
    const product = state.products.find((item) => item.id === productId);
    const unit = product?.units.find((entry) => entry.id === unitId);
    if (!unit) return;
    unit.priceUsd = moneyToUsd(amount, currency);
    unit.priceCurrency = currency;
    product.currency = currency;
    emit();
  }

  function addProductUnit(productId, payload) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return { ok: false, reason: "NO_PRODUCT" };
    const currency = payload.currency || product.currency || state.currency;
    const name = String(payload.name || "").trim();
    const multiplier = clampNumber(payload.multiplier);
    if (!name || multiplier <= 0) return { ok: false, reason: "INVALID_UNIT" };
    if (multiplier === 1) return { ok: false, reason: "BASE_UNIT_DUPLICATE" };
    const existing = product.units.find((unit) => unit.name === name || clampNumber(unit.multiplier) === multiplier || (payload.id && unit.id === payload.id));
    if (existing) {
      if (!clampNumber(existing.priceUsd) && payload.price !== undefined) existing.priceUsd = moneyToUsd(payload.price, currency);
      if (!existing.barcode && payload.barcode) existing.barcode = String(payload.barcode || "").trim();
      existing.priceCurrency = currency;
      emit();
      return { ok: true, unit: existing, merged: true };
    }
    const unitId = uniqueUnitId(payload.id || name, new Set(product.units.map((unit) => unit.id)));
    const unit = {
      id: unitId,
      name,
      multiplier,
      priceUsd: moneyToUsd(payload.price, currency),
      priceCurrency: currency,
      barcode: String(payload.barcode || "").trim()
    };
    const barcodeErrors = candidateBarcodeErrors({
      ...product,
      units: [...product.units, unit]
    });
    if (barcodeErrors.length) return { ok: false, reason: "DUPLICATE_BARCODE", errors: barcodeErrors };
    product.units.push(unit);
    emit();
    return { ok: true, unit };
  }

  function regenerateProductBarcode(productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return null;
    product.barcode = uniqueBarcode(generateBarcode());
    emit();
    return product.barcode;
  }

  function createPurchase(payload) {
    const currency = payload.currency || state.currency;
    const receivedAt = new Date();
    const items = (payload.items || []).map((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      if (!product) return null;
      const unit = sellableUnits(product).find((entry) => entry.id === item.unitId) || lowestAvailableUnit(product);
      const quantity = clampNumber(item.quantity);
      if (!unit || quantity <= 0) return null;
      const qtyInBase = quantityInBase(product, quantity, unit.id);
      const fallbackUnitAmount = wholeMoney(item.unitCost ?? convertUsd(item.unitCostUsd, currency));
      const fallbackTotalAmount = wholeMoney(quantity * fallbackUnitAmount);
      const fallbackTotalUsd = moneyToUsd(fallbackTotalAmount, currency);
      const totalUsd = item.totalUsd !== undefined ? clampNumber(item.totalUsd) : fallbackTotalUsd;
      const unitCostUsd = clampNumber(item.unitCostUsd ?? (quantity > 0 ? totalUsd / quantity : 0));
      const unitCostAmount = wholeMoney(item.unitCost ?? convertUsd(unitCostUsd, currency));
      const totalAmount = wholeMoney(item.lineTotal ?? convertUsd(totalUsd, currency));
      const expiryDays = clampNumber(item.expiryDays);
      const expiresAt = item.expiresAt || (expiryDays > 0
        ? new Date(receivedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
        : null);

      return {
        productId: product.id,
        warehouseId: item.warehouseId || product.warehouseId,
        quantity,
        unitId: unit.id,
        unitName: unit.name,
        qtyInBase,
        currency,
        unitCost: unitCostAmount,
        unitCostUsd,
        lineTotal: totalAmount,
        totalUsd,
        supplierUnitCostUsd: clampNumber(item.supplierUnitCostUsd ?? unitCostUsd),
        baseUnitCostUsd: clampNumber(item.baseUnitCostUsd ?? (qtyInBase > 0 ? totalUsd / qtyInBase : 0)),
        storageUnitCostUsd: clampNumber(item.storageUnitCostUsd ?? unitCostUsd),
        landedCostShareUsd: clampNumber(item.landedCostShareUsd),
        discountShareUsd: clampNumber(item.discountShareUsd),
        batchCode: item.batchCode || "",
        receivedAt: item.receivedAt || receivedAt.toISOString(),
        expiryDays,
        expiresAt
      };
    }).filter(Boolean);

    if (!items.length) return null;

    items.forEach((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      if (!product) return;
      product.warehouseId = item.warehouseId;
      product.stockQuantity = preciseNumber(clampNumber(product.stockQuantity) + baseToStorageQuantity(product, item.qtyInBase));
      if (item.expiresAt) product.expiresAt = item.expiresAt;
    });

    const purchase = {
      id: nextDocumentId("PUR", [state.purchases, state.suspendedPurchases]),
      title: String(payload.title || payload.invoiceTitle || "").trim(),
      supplierId: payload.supplierId || null,
      supplierName: payload.supplierId ? getSupplierName(payload.supplierId) : (String(payload.supplierName || "").trim() || "مورد"),
      createdAt: receivedAt.toISOString(),
      exchangeRate: state.exchangeRate,
      costUsd: moneyToUsd(convertUsd(items.reduce((sum, item) => sum + item.totalUsd, 0), currency), currency),
      paidUsd: moneyToUsd(payload.paid, currency),
      note: String(payload.note || "").trim(),
      items
    };
    purchase.remainingUsd = Math.max(0, purchase.costUsd - purchase.paidUsd);
    purchase.paymentStatus = paymentStatus(purchase.costUsd, purchase.paidUsd, purchase.remainingUsd);
    state.purchases.unshift(purchase);
    emit();
    return purchase;
  }

  function addPurchase(payload) {
    return createPurchase(payload);
  }

  function deleteProduct(productId) {
    const usedInInvoices = state.invoices.some((invoice) => (invoice.items || []).some((item) => item.productId === productId));
    const usedInPurchases = state.purchases.some((purchase) => purchaseItems(purchase).some((item) => item.productId === productId));
    const usedInSuspended = state.suspendedInvoices.some((invoice) => (invoice.items || []).some((item) => item.productId === productId))
      || state.suspendedPurchases.some((purchase) => purchaseItems(purchase).some((item) => item.productId === productId));
    if (usedInInvoices || usedInPurchases || usedInSuspended) {
      return { ok: false, reason: "PRODUCT_HAS_HISTORY" };
    }
    state.products = state.products.filter((product) => product.id !== productId);
    state.purchases.forEach((purchase) => {
      purchase.items = purchaseItems(purchase).filter((item) => item.productId !== productId);
    });
    state.invoices.forEach((invoice) => {
      invoice.items = (invoice.items || []).filter((item) => item.productId !== productId);
    });
    state.suspendedInvoices.forEach((invoice) => {
      invoice.items = (invoice.items || []).filter((item) => item.productId !== productId);
    });
    state.suspendedPurchases.forEach((purchase) => {
      purchase.items = purchaseItems(purchase).filter((item) => item.productId !== productId);
    });
    emit();
    return { ok: true };
  }

  function deleteWarehouse(warehouseId) {
    const hasProducts = state.products.some((product) => product.warehouseId === warehouseId);
    const hasHistory = state.invoices.some((invoice) => (invoice.items || []).some((item) => item.warehouseId === warehouseId))
      || state.purchases.some((purchase) => purchaseItems(purchase).some((item) => item.warehouseId === warehouseId))
      || state.suspendedInvoices.some((invoice) => (invoice.items || []).some((item) => item.warehouseId === warehouseId))
      || state.suspendedPurchases.some((purchase) => purchaseItems(purchase).some((item) => item.warehouseId === warehouseId));
    if (hasProducts || hasHistory) return { ok: false, reason: "WAREHOUSE_HAS_HISTORY" };
    const fallbackWarehouseId = state.warehouses.find((warehouse) => warehouse.id !== warehouseId)?.id || "";
    state.products = state.products.filter((product) => product.warehouseId !== warehouseId);
    state.purchases.forEach((purchase) => {
      purchase.items = purchaseItems(purchase).filter((item) => item.warehouseId !== warehouseId);
    });
    state.invoices.forEach((invoice) => {
      invoice.items = (invoice.items || []).filter((item) => item.warehouseId !== warehouseId);
    });
    state.suspendedInvoices.forEach((invoice) => {
      invoice.items = (invoice.items || []).filter((item) => item.warehouseId !== warehouseId);
    });
    state.suspendedPurchases.forEach((purchase) => {
      purchase.items = purchaseItems(purchase).filter((item) => item.warehouseId !== warehouseId);
    });
    state.warehouses = state.warehouses.filter((warehouse) => warehouse.id !== warehouseId);
    emit();
    return { ok: true, fallbackWarehouseId };
  }

  function addUnitPreset(payload) {
    const name = String(payload.name || "").trim();
    const kind = payload.kind || "packaged";
    const multiplier = Math.max(0.0001, preciseNumber(payload.multiplier || 1));
    if (!name) return { ok: false, reason: "INVALID_UNIT" };
    const duplicate = state.unitPresets.some((unit) => unit.kind === kind && unit.name === name && Number(unit.multiplier) === multiplier);
    if (duplicate) return { ok: false, reason: "DUPLICATE_UNIT" };
    state.unitPresets.unshift({
      id: `up-${Date.now()}`,
      kind,
      name,
      multiplier,
      color: safeInventoryColor(payload.color, state.unitPresets.length + 2)
    });
    emit();
    return { ok: true };
  }

  function deleteUnitPreset(unitPresetId) {
    const id = String(unitPresetId || "").trim();
    if (!id) return { ok: false, reason: "INVALID_UNIT" };
    state.deletedUnitPresetIds = Array.from(new Set([...(state.deletedUnitPresetIds || []), id]));
    state.unitPresets = state.unitPresets.filter((unit) => unit.id !== id);
    emit();
    return { ok: true };
  }

  function addBrand(payload) {
    const name = String(payload.name || payload || "").trim();
    if (!name) return { ok: false, reason: "INVALID_BRAND" };
    if (state.brands.some((brand) => brand.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: "DUPLICATE_BRAND" };
    }
    state.brands.unshift({ id: `brand-${Date.now()}`, name, color: safeInventoryColor(payload.color, state.brands.length + 4) });
    emit();
    return { ok: true };
  }

  function deleteBrand(brandId) {
    state.brands = state.brands.filter((brand) => brand.id !== brandId);
    emit();
    return { ok: true };
  }

  function addOriginCountry(payload) {
    const name = String(payload?.name || payload || "").trim();
    if (!name) return { ok: false, reason: "INVALID_ORIGIN_COUNTRY" };
    if (state.originCountries.some((origin) => origin.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: "DUPLICATE_ORIGIN_COUNTRY" };
    }
    state.originCountries.unshift({
      id: `origin-${Date.now()}`,
      name,
      color: safeInventoryColor(payload?.color, state.originCountries.length + 6)
    });
    emit();
    return { ok: true };
  }

  function deleteOriginCountry(originCountryId) {
    state.originCountries = state.originCountries.filter((origin) => origin.id !== originCountryId);
    emit();
    return { ok: true };
  }

  function originCountryColor(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return "";
    const origin = state.originCountries.find((entry) => entry.name.toLowerCase() === key);
    return origin ? safeInventoryColor(origin.color, 6) : "";
  }

  function smartOriginCountries() {
    const seen = new Set();
    return [
      ...state.originCountries.map((origin) => origin.name),
      ...state.products.map(productOriginCountry),
      ...defaultOriginCountries
    ].map((name) => String(name || "").trim())
      .filter((name) => {
        const key = name.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function suspendPurchase(payload) {
    const subtotalUsd = payload.items.reduce((sum, item) => sum + clampNumber(item.totalUsd), 0);
    const draft = {
      id: `PHOLD-${Date.now()}`,
      title: String(payload.title || payload.invoiceTitle || "").trim(),
      supplierId: payload.supplierId || null,
      supplierName: payload.supplierName || "",
      createdAt: new Date().toISOString(),
      exchangeRate: state.exchangeRate,
      costUsd: subtotalUsd,
      paidUsd: clampNumber(payload.paidUsd),
      note: payload.note || "",
      currency: payload.currency || state.currency,
      items: payload.items
    };
    state.suspendedPurchases.unshift(draft);
    emit();
    return draft.id;
  }

  function resumeSuspendedPurchase(id) {
    const index = state.suspendedPurchases.findIndex((purchase) => purchase.id === id);
    if (index < 0) return null;
    const [purchase] = state.suspendedPurchases.splice(index, 1);
    emit();
    return purchase;
  }

  function suspendInvoice(payload) {
    const subtotalUsd = payload.items.reduce((sum, item) => sum + clampNumber(item.totalUsd), 0);
    const draft = {
      id: `HOLD-${Date.now()}`,
      kind: payload.kind || payload.type || "invoice",
      type: payload.kind || payload.type || "invoice",
      title: String(payload.title || payload.invoiceTitle || "").trim(),
      clientId: payload.clientId || null,
      customerName: payload.customerName || "",
      createdAt: new Date().toISOString(),
      exchangeRate: state.exchangeRate,
      subtotalUsd,
      discountUsd: clampNumber(payload.discountUsd),
      paidUsd: clampNumber(payload.paidUsd),
      items: payload.items
    };
    state.suspendedInvoices.unshift(draft);
    emit();
    return draft.id;
  }

  function resumeSuspendedInvoice(id) {
    const index = state.suspendedInvoices.findIndex((invoice) => invoice.id === id);
    if (index < 0) return null;
    const [invoice] = state.suspendedInvoices.splice(index, 1);
    emit();
    return invoice;
  }

  function saleHasEnoughStock(items) {
    const requested = {};
    (items || []).forEach((item) => {
      requested[item.productId] = clampNumber(requested[item.productId]) + clampNumber(item.qtyInBase);
    });
    return Object.entries(requested).every(([productId, qtyInBase]) => {
      const product = state.products.find((entry) => entry.id === productId);
      return product && qtyInBase <= stockBaseQuantity(product);
    });
  }

  function createInvoice({ id, externalId, clientId, customerName, title, note, items, paidUsd, discountUsd, installmentPlan, kind, type, createdAt, initialPaymentId, initialPaymentNote }) {
    if (!saleHasEnoughStock(items)) return null;
    const subtotalUsd = items.reduce((sum, item) => sum + clampNumber(item.totalUsd), 0);
    const rawKind = String(kind || type || "").trim().toLowerCase().replace(/-/g, "_");
    const invoiceKind = installmentPlan?.type === "installment"
      ? "installment"
      : (["direct_pos", "pos", "directpos", "quick_sale", "quick"].includes(rawKind) ? "direct_pos" : rawKind || "invoice");
    const invoice = {
      id: String(id || externalId || "").trim() || nextDocumentId("INV", [state.invoices, state.suspendedInvoices]),
      kind: invoiceKind,
      type: invoiceKind,
      title: String(title || "").trim(),
      clientId,
      customerName,
      createdAt: createdAt || new Date().toISOString(),
      exchangeRate: state.exchangeRate,
      subtotalUsd,
      discountUsd: Math.max(0, Math.min(subtotalUsd, clampNumber(discountUsd))),
      paidUsd: clampNumber(paidUsd),
      note: String(note || "").trim(),
      installmentPlan: installmentPlan || null,
      items
    };
    invoice.totalUsd = invoiceNet(invoice);
    if (invoiceKind === "direct_pos") invoice.paidUsd = invoice.totalUsd;
    invoice.remainingUsd = Math.max(0, invoice.totalUsd - invoice.paidUsd);
    invoice.paymentStatus = paymentStatus(invoice.totalUsd, invoice.paidUsd, invoice.remainingUsd);
    const initialPaidUsd = Math.min(invoice.totalUsd, clampNumber(invoice.paidUsd));
    const paymentId = String(initialPaymentId || "").trim() || (clientId && initialPaidUsd > 0 ? `PAY-${Date.now()}` : "");
    if (paymentId) invoice.initialPaymentId = paymentId;
    state.invoices.unshift(invoice);
    const client = state.clients.find((entry) => entry.id === clientId);
    if (client && initialPaidUsd > 0.0001 && !state.clientPayments.some((payment) => payment.id === paymentId)) {
      state.clientPayments.unshift({
        id: paymentId,
        clientId,
        clientName: client.name,
        amountUsd: initialPaidUsd,
        unappliedUsd: 0,
        appliedTo: [{ invoiceId: invoice.id, amountUsd: initialPaidUsd }],
        note: String(initialPaymentNote || "Initial invoice payment").trim(),
        receivedAt: invoice.createdAt.slice(0, 10),
        createdAt: invoice.createdAt,
        paymentKind: invoiceKind === "installment" ? "installment" : "invoice"
      });
    }
    applyInvoiceStock(items);
    emit();
    return invoice;
  }

  function updateInvoice(invoiceId, patch = {}) {
    const invoice = state.invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) return { ok: false, reason: "NO_INVOICE" };
    if (patch.customerName !== undefined) invoice.customerName = String(patch.customerName || "").trim();
    if (patch.note !== undefined) invoice.note = String(patch.note || "").trim();
    if (patch.dueDate !== undefined) invoice.dueDate = String(patch.dueDate || "").trim();
    if (patch.guarantorName !== undefined) invoice.guarantorName = String(patch.guarantorName || "").trim();
    if (patch.guarantorPhone !== undefined) invoice.guarantorPhone = String(patch.guarantorPhone || "").trim();
    if (invoice.installmentPlan) {
      if (patch.guarantorName !== undefined) invoice.installmentPlan.guarantorName = invoice.guarantorName;
      if (patch.guarantorPhone !== undefined) invoice.installmentPlan.guarantorPhone = invoice.guarantorPhone;
    }
    emit();
    return { ok: true, invoice };
  }

  function addClientPayment({
    clientId,
    amount,
    currency,
    note,
    receivedAt,
    allocationMode = "fifo",
    invoiceId = "",
    installmentNumber = "",
    applyToInstallments = true,
    paymentKind = ""
  }) {
    if (allocationMode === "installment" && invoiceId && installmentNumber) {
      const result = payClientInstallment({ invoiceId, installmentNumber, amount, currency, note, receivedAt });
      return result?.ok ? result.payment : null;
    }
    const client = state.clients.find((entry) => entry.id === clientId);
    const paymentUsd = moneyToUsd(amount, currency || state.currency);
    if (!client || paymentUsd <= 0) return null;
    let remaining = paymentUsd;
    const appliedTo = [];

    const invoiceCandidates = state.invoices
      .filter((invoice) => invoice.clientId === clientId && invoiceDebt(invoice) > 0)
      .filter((invoice) => allocationMode !== "direct" || invoice.installmentPlan?.type !== "installment")
      .filter((invoice) => allocationMode !== "invoice" || invoice.id === invoiceId)
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
      .slice(0, allocationMode === "invoice" ? 1 : undefined);

    invoiceCandidates
      .forEach((invoice) => {
        if (remaining <= 0) return;
        const applied = Math.min(invoiceDebt(invoice), remaining);
        invoice.paidUsd = clampNumber(invoice.paidUsd) + applied;
        invoice.remainingUsd = Math.max(0, invoiceNet(invoice) - invoice.paidUsd);
        invoice.paymentStatus = paymentStatus(invoiceNet(invoice), invoice.paidUsd, invoice.remainingUsd);
        let installmentApplied = applied;
        const plan = invoice.installmentPlan;
        if (applyToInstallments && plan?.type === "installment" && Array.isArray(plan.schedule)) {
          plan.schedule
            .filter((item) => clampNumber(item.paidUsd) < clampNumber(item.amountUsd) - 0.0001)
            .sort((left, right) => new Date(left.dueDate || 0) - new Date(right.dueDate || 0))
            .forEach((item) => {
              if (installmentApplied <= 0) return;
              const installmentRemaining = Math.max(0, clampNumber(item.amountUsd) - clampNumber(item.paidUsd));
              const installmentPayment = Math.min(installmentRemaining, installmentApplied);
              item.paidUsd = preciseNumber(clampNumber(item.paidUsd) + installmentPayment);
              if (item.paidUsd >= clampNumber(item.amountUsd) - 0.0001) {
                item.paidUsd = clampNumber(item.amountUsd);
                item.status = "paid";
                item.paidAt = receivedAt || new Date().toISOString().slice(0, 10);
              } else if (item.paidUsd > 0) {
                item.status = "partial";
              }
              installmentApplied -= installmentPayment;
              appliedTo.push({ invoiceId: invoice.id, installmentNumber: item.number, amountUsd: installmentPayment });
            });
          plan.paidUsd = plan.schedule.reduce((sum, item) => sum + clampNumber(item.paidUsd), 0);
          plan.remainingUsd = Math.max(0, clampNumber(plan.totalUsd || invoice.totalUsd) - clampNumber(plan.downPaymentUsd) - plan.paidUsd);
        }
        remaining -= applied;
        if (!applyToInstallments || !plan?.schedule?.length) {
          appliedTo.push({ invoiceId: invoice.id, amountUsd: applied });
        }
      });

    const payment = {
      id: `PAY-${Date.now()}`,
      clientId,
      clientName: client.name,
      amountUsd: paymentUsd,
      unappliedUsd: remaining,
      appliedTo,
      note: String(note || "").trim(),
      receivedAt: receivedAt || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      paymentKind: paymentKind || (allocationMode === "invoice" ? "invoice" : allocationMode === "direct" ? "direct" : "general")
    };
    state.clientPayments.unshift(payment);
    emit();
    return payment;
  }

  function payClientInstallment({ invoiceId, installmentNumber, amount, currency, note, receivedAt }) {
    const invoice = state.invoices.find((entry) => entry.id === invoiceId);
    const plan = invoice?.installmentPlan;
    if (!invoice || !invoice.clientId || !plan || plan.type !== "installment") {
      return { ok: false, reason: "NO_INSTALLMENT_INVOICE" };
    }
    const installment = (plan.schedule || []).find((item) => Number(item.number) === Number(installmentNumber));
    if (!installment) return { ok: false, reason: "NO_INSTALLMENT" };
    const targetAmount = clampNumber(installment.amountUsd);
    const alreadyPaid = installment.status === "paid" || clampNumber(installment.paidUsd) >= targetAmount - 0.0001;
    if (alreadyPaid) return { ok: false, reason: "INSTALLMENT_ALREADY_PAID" };

    const amountUsd = Math.min(Math.max(0, targetAmount - clampNumber(installment.paidUsd)), moneyToUsd(amount || targetAmount, currency || state.currency));
    if (amountUsd <= 0) return { ok: false, reason: "INVALID_AMOUNT" };

    installment.paidUsd = preciseNumber(clampNumber(installment.paidUsd) + amountUsd);
    if (installment.paidUsd >= targetAmount - 0.0001) {
      installment.paidUsd = targetAmount;
      installment.status = "paid";
      installment.paidAt = receivedAt || new Date().toISOString().slice(0, 10);
    } else {
      installment.status = "partial";
    }

    invoice.paidUsd = preciseNumber(clampNumber(invoice.paidUsd) + amountUsd);
    invoice.totalUsd = invoiceNet(invoice);
    invoice.remainingUsd = Math.max(0, invoice.totalUsd - invoice.paidUsd);
    invoice.paymentStatus = paymentStatus(invoice.totalUsd, invoice.paidUsd, invoice.remainingUsd);
    plan.paidUsd = (plan.schedule || []).reduce((sum, item) => sum + clampNumber(item.paidUsd), 0);
    plan.remainingUsd = Math.max(0, clampNumber(plan.totalUsd || invoice.totalUsd) - clampNumber(plan.downPaymentUsd) - plan.paidUsd);

    const client = state.clients.find((entry) => entry.id === invoice.clientId);
    const payment = {
      id: `IPAY-${Date.now()}`,
      clientId: invoice.clientId,
      clientName: client?.name || invoice.customerName || "",
      amountUsd,
      unappliedUsd: 0,
      appliedTo: [{ invoiceId: invoice.id, installmentNumber: installment.number, amountUsd }],
      note: String(note || `دفع قسط ${installment.number} للفاتورة ${invoice.id}`).trim(),
      receivedAt: receivedAt || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      paymentKind: "installment"
    };
    state.clientPayments.unshift(payment);
    emit();
    return { ok: true, payment, invoice, installment };
  }

  function addSupplierPayment({ supplierId, amount, currency, note, paidAt, allocationMode = "fifo", purchaseId = "" }) {
    const supplier = state.suppliers.find((entry) => entry.id === supplierId);
    const paymentUsd = moneyToUsd(amount, currency || state.currency);
    if (!supplier || paymentUsd <= 0) return null;
    let remaining = paymentUsd;
    const appliedTo = [];

    state.purchases
      .filter((purchase) => purchase.supplierId === supplierId && purchaseDebt(purchase) > 0)
      .filter((purchase) => allocationMode !== "invoice" || purchase.id === purchaseId)
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
      .slice(0, allocationMode === "invoice" ? 1 : undefined)
      .forEach((purchase) => {
        if (remaining <= 0) return;
        const applied = Math.min(purchaseDebt(purchase), remaining);
        purchase.paidUsd = clampNumber(purchase.paidUsd) + applied;
        purchase.remainingUsd = Math.max(0, clampNumber(purchase.costUsd) - purchase.paidUsd);
        purchase.paymentStatus = paymentStatus(purchase.costUsd, purchase.paidUsd, purchase.remainingUsd);
        remaining -= applied;
        appliedTo.push({ purchaseId: purchase.id, amountUsd: applied });
      });

    const payment = {
      id: `SPAY-${Date.now()}`,
      supplierId,
      supplierName: supplier.name,
      amountUsd: paymentUsd,
      unappliedUsd: remaining,
      appliedTo,
      note: String(note || "").trim(),
      paidAt: paidAt || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString()
    };
    state.supplierPayments.unshift(payment);
    emit();
    return payment;
  }

  function applyInvoiceStock(items) {
    items.forEach((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      if (product) {
        product.stockQuantity = Math.max(0, preciseNumber(clampNumber(product.stockQuantity) - baseToStorageQuantity(product, item.qtyInBase)));
      }
    });
  }

  function finalizeSuspendedInvoice(id) {
    const index = state.suspendedInvoices.findIndex((invoice) => invoice.id === id);
    if (index < 0) return null;
    const [draft] = state.suspendedInvoices.splice(index, 1);
    if (!saleHasEnoughStock(draft.items || [])) {
      state.suspendedInvoices.splice(index, 0, draft);
      return null;
    }
    const invoice = {
      ...draft,
      id: nextDocumentId("INV", [state.invoices, state.suspendedInvoices]),
      kind: draft.kind || draft.type || "invoice",
      type: draft.kind || draft.type || "invoice",
      createdAt: new Date().toISOString()
    };
    invoice.totalUsd = invoiceNet(invoice);
    invoice.remainingUsd = Math.max(0, invoice.totalUsd - clampNumber(invoice.paidUsd));
    invoice.paymentStatus = paymentStatus(invoice.totalUsd, invoice.paidUsd, invoice.remainingUsd);
    state.invoices.unshift(invoice);
    applyInvoiceStock(invoice.items || []);
    emit();
    return invoice;
  }

  function voidInvoice(invoiceId, reason = "") {
    const invoice = state.invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) return { ok: false, reason: "NO_INVOICE" };
    if (invoice.isVoided || invoice.paymentStatus === "void") return { ok: true, invoice };
    if (invoiceDebt(invoice) > 0.0001) return { ok: false, reason: "INVOICE_HAS_DEBT" };
    if (invoice.installmentPlan?.type === "installment") return { ok: false, reason: "INVOICE_HAS_INSTALLMENTS" };

    (invoice.items || []).forEach((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      if (!product) return;
      product.stockQuantity = preciseNumber(clampNumber(product.stockQuantity) + baseToStorageQuantity(product, item.qtyInBase));
    });
    invoice.isVoided = true;
    invoice.voidedAt = new Date().toISOString();
    invoice.voidReason = String(reason || "").trim();
    invoice.paymentStatus = "void";
    invoice.remainingUsd = 0;
    emit();
    return { ok: true, invoice };
  }

  function voidPurchase(purchaseId, reason = "") {
    const purchase = state.purchases.find((entry) => entry.id === purchaseId);
    if (!purchase) return { ok: false, reason: "NO_PURCHASE" };
    if (purchase.isVoided || purchase.paymentStatus === "void") return { ok: true, purchase };
    if (purchaseDebt(purchase) > 0.0001) return { ok: false, reason: "PURCHASE_HAS_DEBT" };

    const items = purchaseItems(purchase);
    const deltas = items.map((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      return { product, delta: product ? baseToStorageQuantity(product, item.qtyInBase) : 0 };
    });
    if (deltas.some(({ product, delta }) => product && clampNumber(product.stockQuantity) < delta - 0.0001)) {
      return { ok: false, reason: "VOID_STOCK_UNAVAILABLE" };
    }
    deltas.forEach(({ product, delta }) => {
      if (product) product.stockQuantity = Math.max(0, preciseNumber(clampNumber(product.stockQuantity) - delta));
    });
    purchase.isVoided = true;
    purchase.voidedAt = new Date().toISOString();
    purchase.voidReason = String(reason || "").trim();
    purchase.paymentStatus = "void";
    purchase.remainingUsd = 0;
    emit();
    return { ok: true, purchase };
  }

  emit();
  hydrateFromBackend();
  window.addEventListener("tox:authenticated", () => {
    isHydrating = true;
    hydrateFromBackend();
  });

  const writeBlocked = { ok: false, reason: "BACKEND_REQUIRED" };
  const writeBlockedNull = () => null;

  return {
    subscribe,
    getState,
    refreshFromBackend,
    repairText,
    setTheme,
    setLanguage,
    toggleDir,
    setCurrency,
    toggleCurrency,
    setExchangeRate,
    applySystemReset,
    clearLocalBusinessCache,
    getWarehouseName,
    getSupplierName,
    getProductUnit,
    sellableUnits,
    getUnitMultiplier,
    quantityInBase,
    productBaseUnit,
    productKindLabel,
    findProductByBarcode,
    exactBarcodeProductMatches,
    productMatchesSmartSearch,
    priceForUnit(product, unitId) {
      return clampNumber(getProductUnit(product, unitId)?.priceUsd);
    },
    formatMoney,
    productCurrency,
    formatProductMoney,
    invoiceNet,
    invoiceDebt,
    purchaseDebt,
    paymentStatus,
    accountTimeline,
    purchaseItems,
    clientStats,
    supplierStats,
    reportSnapshot,
    cashboxSnapshot,
    stockCartons,
    thresholdCartons,
    thresholdPieces,
    thresholdQuantity,
    stockBaseQuantity,
    baseToStorageQuantity,
    stockBreakdown,
    stockSummary,
    convertUsd,
    parseMoneyInput,
    moneyToUsd,
    normalizeBarcode,
    barcodeOwners,
    validateProductReadiness,
    validateProductBarcodePatch,
    duplicateBarcodeErrors,
    addWarehouse: requireBackendWrite(addWarehouse, writeBlockedNull),
    addSupplier: requireBackendWrite(addSupplier, writeBlockedNull),
    addClient: requireBackendWrite(addClient, writeBlockedNull),
    updateClient: requireBackendWrite(updateClient, writeBlocked),
    updateSupplier: requireBackendWrite(updateSupplier, writeBlocked),
    addEmployee: requireBackendWrite(addEmployee, writeBlockedNull),
    addCashVoucher: requireBackendWrite(addCashVoucher, writeBlockedNull),
    deleteClient: requireBackendWrite(deleteClient, writeBlocked),
    deleteSupplier: requireBackendWrite(deleteSupplier, writeBlocked),
    deleteEmployee: requireBackendWrite(deleteEmployee, writeBlocked),
    addProduct: requireBackendWrite(addProduct, writeBlocked),
    updateProduct: requireBackendWrite(updateProduct, writeBlocked),
    updateProductWithUnits: requireBackendWrite(updateProductWithUnits, writeBlocked),
    updateProductUnit: requireBackendWrite(updateProductUnit, writeBlocked),
    updateProductUnitPrice: requireBackendWrite(updateProductUnitPrice, undefined),
    addProductUnit: requireBackendWrite(addProductUnit, writeBlocked),
    regenerateProductBarcode: requireBackendWrite(regenerateProductBarcode, writeBlockedNull),
    addPurchase: requireBackendWrite(addPurchase, writeBlockedNull),
    createPurchase: requireBackendWrite(createPurchase, writeBlockedNull),
    deleteProduct: requireBackendWrite(deleteProduct, writeBlocked),
    deleteWarehouse: requireBackendWrite(deleteWarehouse, writeBlocked),
    addUnitPreset: requireBackendWrite(addUnitPreset, writeBlocked),
    deleteUnitPreset: requireBackendWrite(deleteUnitPreset, writeBlocked),
    addBrand: requireBackendWrite(addBrand, writeBlocked),
    deleteBrand: requireBackendWrite(deleteBrand, writeBlocked),
    addOriginCountry: requireBackendWrite(addOriginCountry, writeBlocked),
    deleteOriginCountry: requireBackendWrite(deleteOriginCountry, writeBlocked),
    originCountryColor,
    smartOriginCountries,
    suspendInvoice: requireBackendWrite(suspendInvoice, writeBlockedNull),
    resumeSuspendedInvoice: requireBackendWrite(resumeSuspendedInvoice, writeBlockedNull),
    finalizeSuspendedInvoice: requireBackendWrite(finalizeSuspendedInvoice, writeBlockedNull),
    updateInvoice: requireBackendWrite(updateInvoice, writeBlocked),
    addClientPayment: requireBackendWrite(addClientPayment, writeBlockedNull),
    payClientInstallment: requireBackendWrite(payClientInstallment, writeBlocked),
    addSupplierPayment: requireBackendWrite(addSupplierPayment, writeBlockedNull),
    suspendPurchase: requireBackendWrite(suspendPurchase, writeBlockedNull),
    resumeSuspendedPurchase: requireBackendWrite(resumeSuspendedPurchase, writeBlockedNull),
    voidInvoice: requireBackendWrite(voidInvoice, writeBlocked),
    voidPurchase: requireBackendWrite(voidPurchase, writeBlocked),
    setBusinessProfile,
    businessProfileName,
    businessProfileParts,
    businessProfileLine,
    setInvoicePrintSettings,
    setInstallmentProfitSettings,
    setProductPricingSettings,
    setSoundSettings,
    syncNow,
    hydrateFromBackend,
    createInvoice: requireBackendWrite(createInvoice, writeBlockedNull)
  };
})();
