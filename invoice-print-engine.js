const ToxPrint = (() => {
  const templates = {
    "thermal-80": { label: "اقتصادي حراري", paperSize: "thermal-80", mono: true },
    "iraqi-thermal-80": { label: "سوق عراقي 80mm", paperSize: "thermal-80", mono: true },
    "official-a4": { label: "رسمي عراقي A4", paperSize: "a4", mono: false },
    "professional-color": { label: "احترافي ملون", paperSize: "a4", mono: false },
    "warehouse-dense": { label: "جملة ومخازن", paperSize: "a4", mono: false },
    "receipt-short": { label: "وصل مختصر", paperSize: "thermal-80", mono: true },
    "ledger-a4": { label: "كشف جدولي A4", paperSize: "a4", mono: false }
  };

  const labels = {
    ar: {
      directSale: "بيع مباشر",
      saleInvoice: "فاتورة بيع",
      directPurchase: "شراء مباشر",
      purchaseInvoice: "فاتورة شراء",
      clientReceipt: "وصل قبض",
      clientStatement: "كشف حساب عميل",
      supplierStatement: "كشف حساب مورد",
      ledgerInvoice: "فاتورة",
      invoiceNo: "رقم المستند",
      date: "التاريخ",
      party: "الطرف",
      status: "الحالة",
      item: "الصنف",
      qty: "الكمية",
      unit: "الوحدة",
      price: "السعر",
      discount: "الخصم",
      total: "الإجمالي",
      subtotal: "المجموع",
      paid: "المدفوع",
      remaining: "المتبقي",
      note: "ملاحظات",
      debit: "مدين",
      credit: "دائن",
      balance: "الرصيد",
      signatureCustomer: "توقيع العميل",
      signatureSupplier: "توقيع المورد",
      signatureStaff: "توقيع الموظف",
      warrantyNote: "يرجى الاحتفاظ بالفاتورة للمراجعة أو الضمان.",
      paidStatus: "مسددة",
      balanceStatus: "باقي مبلغ",
      noItems: "لا توجد مواد"
    },
    en: {
      directSale: "Direct Sale",
      saleInvoice: "Sales Invoice",
      directPurchase: "Direct Purchase",
      purchaseInvoice: "Purchase Invoice",
      clientReceipt: "Receipt",
      clientStatement: "Customer Statement",
      supplierStatement: "Supplier Statement",
      ledgerInvoice: "Invoice",
      invoiceNo: "Document No",
      date: "Date",
      party: "Party",
      status: "Status",
      item: "Item",
      qty: "Qty",
      unit: "Unit",
      price: "Price",
      discount: "Discount",
      total: "Total",
      subtotal: "Subtotal",
      paid: "Paid",
      remaining: "Remaining",
      note: "Notes",
      debit: "Debit",
      credit: "Credit",
      balance: "Balance",
      signatureCustomer: "Customer signature",
      signatureSupplier: "Supplier signature",
      signatureStaff: "Staff signature",
      warrantyNote: "Please keep this invoice for review or warranty.",
      paidStatus: "Paid",
      balanceStatus: "Balance Due",
      noItems: "No items"
    }
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function repair(value) {
    return typeof ToxStore !== "undefined" && ToxStore.repairText ? ToxStore.repairText(value) : String(value ?? "");
  }

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function langFor(state) {
    return state?.lang === "en" ? "en" : "ar";
  }

  function text(state, key) {
    const lang = langFor(state);
    return labels[lang]?.[key] || labels.ar[key] || key;
  }

  function money(value, state, currency = state?.currency || "IQD") {
    if (typeof ToxStore !== "undefined" && ToxStore.formatMoney) {
      return ToxStore.formatMoney(number(value), currency);
    }
    return `${number(value).toLocaleString(langFor(state) === "ar" ? "ar-IQ" : "en-US")} ${currency}`;
  }

  function dateTime(value, state) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return escapeHtml(value || "-");
    return date.toLocaleString(langFor(state) === "ar" ? "ar-IQ" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  }

  function defaultSettings() {
    return {
      defaultTemplate: "official-a4",
      paperSize: "a4",
      accentColor: "#0f766e",
      fontScale: 100,
      density: "normal",
      logoMode: "mark",
      designer: defaultDesigner(),
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
      perDocumentType: {}
    };
  }

  function defaultDesigner() {
    return {
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
    };
  }

  function mergeDesigner(source = {}, legacyLogoMode = "mark") {
    const defaults = defaultDesigner();
    const designer = source && typeof source === "object" ? source : {};
    const brand = designer.brand && typeof designer.brand === "object" ? designer.brand : {};
    const layout = designer.layout && typeof designer.layout === "object" ? designer.layout : {};
    const typography = designer.typography && typeof designer.typography === "object" ? designer.typography : {};
    const footer = designer.footer && typeof designer.footer === "object" ? designer.footer : {};
    const legacyLogoSource = legacyLogoMode === "none" ? "none" : legacyLogoMode === "text" ? "initials" : "tox";
    return {
      ...defaults,
      ...designer,
      brand: {
        ...defaults.brand,
        ...brand,
        logoSource: brand.logoSource || legacyLogoSource
      },
      layout: {
        ...defaults.layout,
        ...layout
      },
      typography: {
        ...defaults.typography,
        ...typography
      },
      footer: {
        ...defaults.footer,
        ...footer
      }
    };
  }

  function settingsFor(documentType, state) {
    const source = state?.invoicePrintSettings || {};
    const base = { ...defaultSettings(), ...source };
    base.showFields = { ...defaultSettings().showFields, ...(source.showFields || {}) };
    base.designer = mergeDesigner(source.designer, base.logoMode);
    base.fontScale = number(base.designer.typography.fontScale || base.fontScale || 100);
    const documentSettings = source.perDocumentType?.[documentType] || {};
    const template = documentSettings.template || base.defaultTemplate || "official-a4";
    return {
      ...base,
      template,
      paperSize: documentSettings.paperSize || templates[template]?.paperSize || base.paperSize || "a4",
      density: documentSettings.density || base.density || "normal"
    };
  }

  function partyName(documentType, record, state) {
    if (documentType.toLowerCase().includes("purchase") || documentType === "supplierStatement") {
      return repair(record?.supplierName || state?.suppliers?.find((supplier) => supplier.id === record?.supplierId)?.name || "مورد");
    }
    if (documentType === "clientStatement") return repair(record?.name || "عميل");
    return repair(record?.clientName || record?.customerName || state?.clients?.find((client) => client.id === record?.clientId)?.name || "زبون مباشر");
  }

  function documentTitle(documentType, record, state) {
    return repair(record?.title || text(state, documentType));
  }

  function itemName(item, state) {
    const product = state?.products?.find((entry) => entry.id === item.productId);
    return repair(item.productName || item.name || product?.name || "-");
  }

  function itemMeta(item, state, settings) {
    const product = state?.products?.find((entry) => entry.id === item.productId);
    const parts = [
      item.brand || item.productBrand || product?.brand,
      item.sku || product?.sku,
      settings.showFields.barcode ? (item.barcode || product?.barcode) : "",
      item.warehouseName || (typeof ToxStore !== "undefined" && ToxStore.getWarehouseName ? ToxStore.getWarehouseName(item.warehouseId) : "")
    ].filter(Boolean).map(repair);
    return [...new Set(parts)].join(" | ");
  }

  function normalizeItems(documentType, record, state, settings) {
    return (record?.items || []).map((item, index) => ({
      index: index + 1,
      name: itemName(item, state),
      meta: itemMeta(item, state, settings),
      qty: item.qty ?? item.quantity ?? "-",
      unit: repair(item.unitName || item.unit || item.unitId || "-"),
      priceUsd: number(item.priceUsd ?? item.unitCostUsd),
      discountUsd: number(item.discountUsd ?? item.lineDiscountUsd),
      totalUsd: number(item.totalUsd ?? item.lineTotalUsd)
    }));
  }

  function totalsFor(documentType, record) {
    const subtotal = number(record?.subtotal ?? record?.subtotalUsd ?? record?.costUsd ?? record?.totalUsd);
    const discount = number(record?.invoiceDiscount ?? record?.discountUsd);
    const total = number(record?.total ?? record?.netUsd ?? record?.costUsd ?? record?.totalUsd ?? Math.max(0, subtotal - discount));
    const paid = number(record?.paid ?? record?.paidUsd);
    const remaining = number(record?.debt ?? record?.debtUsd ?? record?.remainingUsd ?? Math.max(0, total - paid));
    return { subtotal, discount, total, paid, remaining };
  }

  function statementRows(documentType, record) {
    if (Array.isArray(record?.statementRows)) {
      return record.statementRows.map((row) => ({
        date: row.date || row.createdAt,
        title: repair(row.title || row.note || "-"),
        type: repair(row.type || "-"),
        debit: number(row.debit),
        credit: number(row.credit),
        balance: number(row.balance)
      }));
    }
    const stats = documentType === "supplierStatement"
      ? ToxStore?.supplierStats?.(record.id)
      : ToxStore?.clientStats?.(record.id);
    return (stats?.movements || []).map((row) => ({
      date: row.createdAt || row.date,
      title: repair(row.title || row.note || row.type || "-"),
      type: repair(row.type || "-"),
      debit: Math.max(0, number(row.amountUsd)),
      credit: Math.max(0, -number(row.amountUsd)),
      balance: number(row.balanceAfterUsd)
    }));
  }

  function businessMeta(state, settings) {
    const parts = [];
    if (state?.businessCompanyName) parts.push(state.businessCompanyName);
    if (settings.showFields.phone && state?.businessPhone) parts.push(state.businessPhone);
    if (settings.showFields.address && state?.businessAddress) parts.push(state.businessAddress);
    if (!parts.length && state?.businessSubtitle) parts.push(state.businessSubtitle);
    return parts.map(repair).join(" | ");
  }

  function isThermalPaper(settings) {
    return settings?.paperSize === "thermal-80" || templates[settings?.template]?.paperSize === "thermal-80";
  }

  function isIraqiThermal(settings) {
    return settings?.template === "iraqi-thermal-80";
  }

  function css(settings, state) {
    const designer = mergeDesigner(settings.designer, settings.logoMode);
    const isThermal = isThermalPaper(settings);
    const iraqiThermal = isIraqiThermal(settings);
    const accent = isThermal ? "#111827" : settings.accentColor || "#0f766e";
    const dense = settings.density === "dense" || designer.layout.tableStyle === "dense";
    const compact = settings.density === "compact" || isThermal;
    const marginScale = Math.min(125, Math.max(80, number(designer.layout.marginScale || 100)));
    const pageMargin = isThermal ? (iraqiThermal ? 2 : 3) : Math.max(9, Math.round(12 * marginScale / 100));
    const thermalSheetWidth = `calc(80mm - ${pageMargin * 2}mm)`;
    const contentPadY = Math.max(16, Math.round(24 * marginScale / 100));
    const contentPadX = Math.max(18, Math.round(28 * marginScale / 100));
    const fontScale = Math.min(120, Math.max(85, number(designer.typography.fontScale || settings.fontScale || 100)));
    const fontBase = Math.max(10, fontScale / 100 * (iraqiThermal ? 11 : compact ? 12 : 14));
    const logoSize = iraqiThermal
      ? Math.min(34, Math.max(24, number(designer.brand.logoSize || 30)))
      : isThermal
        ? Math.min(42, Math.max(28, number(designer.brand.logoSize || 34)))
        : Math.min(96, Math.max(28, number(designer.brand.logoSize || 54)));
    const logoOpacity = Math.min(1, Math.max(0.12, number(designer.brand.logoOpacity || 100) / 100));
    const radius = designer.layout.borderStyle === "sharp" ? "2px" : designer.layout.borderStyle === "none" ? "0" : "10px";
    const borderColor = designer.layout.borderStyle === "none" ? "transparent" : "#dbe3ee";
    const fontStacks = {
      system: '"Segoe UI","Noto Kufi Arabic",Tahoma,Arial,sans-serif',
      kufi: '"Noto Kufi Arabic","Segoe UI",Tahoma,Arial,sans-serif',
      cairo: 'Cairo,"Segoe UI",Tahoma,Arial,sans-serif',
      tajawal: 'Tajawal,"Segoe UI",Tahoma,Arial,sans-serif'
    };
    const fontFamily = fontStacks[designer.typography.fontFamily] || fontStacks.system;
    return `
      @page{size:${isThermal ? "80mm auto" : "A4"};margin:${pageMargin}mm}
      *{box-sizing:border-box}
      body{margin:0;background:${isThermal ? "#eef2f7" : "#edf2f7"};color:#111827;font-family:${fontFamily};font-size:${fontBase}px}
      h1,h2,p{margin:0}
      .sheet{position:relative;width:${isThermal ? thermalSheetWidth : "min(100%, 1040px)"};margin:${isThermal ? "10px auto" : "auto"};background:#fff;border:${isThermal ? "1px solid #d1d5db" : `1px solid ${borderColor}`};border-radius:${isThermal ? "2px" : radius};overflow:hidden;box-shadow:${isThermal ? "0 12px 32px rgba(15,23,42,.12)" : "0 22px 70px rgba(15,23,42,.12)"}}
      .hero{display:grid;grid-template-columns:${isThermal ? "1fr" : "minmax(0,1fr) auto"};gap:${compact ? "8px" : "18px"};padding:${isThermal ? (iraqiThermal ? "6px 0 7px" : "8px 0") : `${contentPadY}px ${contentPadX}px`};background:${isThermal ? "#fff" : `linear-gradient(135deg,#111827,${accent})`};color:${isThermal ? "#111827" : "#fff"};border-bottom:${isThermal ? "1px dashed #111827" : "0"}}
      .header-minimal .hero{background:#fff;color:#111827;border-bottom:1px solid #e5e7eb}
      .header-boxed .hero{margin:${isThermal ? "0" : "14px"};border:1px solid ${borderColor};border-radius:${radius};background:#f8fafc;color:#111827}
      .header-letterhead .hero{background:#fff;color:#111827;border-top:${isThermal ? "0" : `8px solid ${accent}`};border-bottom:1px solid #dbe3ee}
      .header-gradient .hero{background:${isThermal ? "#fff" : `linear-gradient(135deg,${accent},#111827)`};color:${isThermal ? "#111827" : "#fff"}}
      .brand{display:flex;gap:12px;align-items:center;min-width:0}
      .brand-copy{min-width:0}.brand h1{font-size:${iraqiThermal ? "15px" : isThermal ? "18px" : "30px"};line-height:1.1;overflow-wrap:anywhere}.brand p,.badge span,.badge p{opacity:.78;margin-top:4px;overflow-wrap:anywhere}
      .mark{display:${designer.brand.logoSource === "none" ? "none" : "grid"};place-items:center;width:${isThermal ? `${logoSize}px` : `${logoSize}px`};height:${isThermal ? `${logoSize}px` : `${logoSize}px`};flex:0 0 auto;border-radius:${radius};border:1px solid ${isThermal ? "#111827" : "rgba(255,255,255,.34)"};background:${isThermal ? "#fff" : "rgba(255,255,255,.14)"};font-weight:950;letter-spacing:0;overflow:hidden;opacity:${logoOpacity}}
      .mark img,.watermark-mark img{display:block;width:100%;height:100%;object-fit:cover}
      .logo-square .mark{border-radius:2px}.logo-circle .mark{border-radius:999px}.logo-seal .mark{border-radius:999px;border-style:dashed;box-shadow:inset 0 0 0 3px rgba(255,255,255,.2)}
      .logo-letterhead .mark{width:${isThermal ? "42px" : `${Math.round(logoSize * 2.2)}px`};height:${isThermal ? "26px" : `${Math.round(logoSize * 0.62)}px`};border-radius:4px}
      .logo-center .hero{grid-template-columns:1fr;text-align:center}.logo-center .brand{justify-content:center;flex-direction:column}.logo-center .badge{text-align:center;justify-self:center}
      .logo-end .brand{flex-direction:row-reverse}.logo-end .badge{text-align:start}
      .badge{min-width:${isThermal ? "0" : "220px"};text-align:end;padding:${isThermal ? "0" : "12px 14px"};border:${isThermal ? "0" : "1px solid rgba(255,255,255,.25)"};border-radius:${radius};background:${isThermal ? "transparent" : "rgba(255,255,255,.12)"}}
      .header-minimal .badge,.header-boxed .badge,.header-letterhead .badge{border-color:#dbe3ee;background:#fff;color:#111827}
      .badge strong{display:block;font-size:${iraqiThermal ? "12px" : isThermal ? "15px" : "22px"};overflow-wrap:anywhere}
      .watermark-mark{position:absolute;inset:34% auto auto 50%;transform:translate(-50%,-50%) rotate(-10deg);width:min(360px,52%);height:180px;display:grid;place-items:center;border:2px solid ${accent};border-radius:18px;color:${accent};font-size:72px;font-weight:950;opacity:${isThermal ? "0" : Math.min(0.12, logoOpacity * 0.16)};pointer-events:none;z-index:0}
      .summary,.content,.receipt-meta{position:relative;z-index:1}
      .summary{display:grid;grid-template-columns:repeat(${isThermal ? 2 : 4},minmax(0,1fr));gap:1px;background:#e5e7eb;border-bottom:1px solid #e5e7eb}.summary div{padding:${compact ? "8px" : "13px 16px"};background:#f8fafc}.summary span,.totals span,small{color:#64748b}.summary strong,.totals strong{display:block;margin-top:3px;overflow-wrap:anywhere}
      .content{padding:${isThermal ? "7px 0" : `${contentPadY}px ${contentPadX}px`}}
      .receipt-meta{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#111827;border-bottom:1px dashed #111827}.receipt-meta div{min-width:0;padding:5px 6px;background:#fff}.receipt-meta span{display:block;color:#64748b;font-size:.8em}.receipt-meta strong{display:block;margin-top:2px;color:#111827;font-size:.96em;overflow-wrap:anywhere}
      .receipt-items{display:grid;gap:7px;margin-top:2px}.receipt-item{padding:6px 0;border-bottom:1px dashed #9ca3af}.receipt-item-head{display:flex;gap:6px;align-items:start}.receipt-item-index{min-width:18px;color:#64748b;font-weight:900}.receipt-item-name{flex:1;min-width:0;font-weight:950;line-height:1.55;overflow-wrap:anywhere}.receipt-item-calc{display:flex;justify-content:space-between;gap:8px;margin-top:5px;color:#374151}.receipt-item-total{margin-top:4px;display:flex;justify-content:space-between;gap:8px;font-weight:950;color:#111827}.receipt-item-meta{display:block;margin-top:4px;color:#64748b;line-height:1.45;overflow-wrap:anywhere}.receipt-footer{margin-top:8px}
      table{width:100%;border-collapse:collapse;border:${isThermal || designer.layout.tableStyle === "minimal" ? "0" : `1px solid ${borderColor}`};background:#fff}
      th,td{padding:${dense ? "7px" : compact ? "6px" : "11px"};border-bottom:1px solid #e5e7eb;text-align:start;vertical-align:top;overflow-wrap:anywhere}
      th{background:${isThermal ? "#fff" : "#f8fafc"};font-size:.82em;color:#475569}
      .table-striped tbody tr:nth-child(even) td{background:#f8fafc}
      .table-boxed th,.table-boxed td{border:1px solid #dbe3ee}
      .table-minimal th{background:#fff}.table-minimal table{border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb}
      .table-dense th,.table-dense td{padding:6px;border:1px solid #dbe3ee}
      .name small{display:block;margin-top:3px}
      .footer{display:grid;grid-template-columns:${isThermal ? "1fr" : "minmax(0,1fr) minmax(290px,.42fr)"};gap:18px;margin-top:18px}.note{min-height:${isThermal ? "auto" : "104px"};border:1px dashed #cbd5e1;border-radius:${radius};padding:12px;color:#64748b;line-height:1.75}.note p{margin:0 0 7px}.note p:last-child{margin-bottom:0}
      .totals{border:1px solid ${borderColor};border-radius:${radius};overflow:hidden;background:#fff}.total-row{display:flex;justify-content:space-between;gap:12px;padding:${compact ? "8px" : "11px 13px"};border-bottom:1px solid #e5e7eb}.total-row:last-child{border-bottom:0}.grand{background:${isThermal ? "#fff" : "color-mix(in srgb, " + accent + " 10%, #fff)"}}.grand strong{font-size:1.25em}.paid strong{color:#047857}.debt strong{color:#dc2626}
      .total-bar .grand{background:${isThermal ? "#fff" : accent};color:${isThermal ? "#111827" : "#fff"}}.total-bar .grand span{color:inherit}.total-classic .totals{border-radius:0;border-left:0;border-right:0}
      .signatures{display:${settings.showFields.signature && designer.footer.showSignature !== false && !isThermal ? "grid" : "none"};grid-template-columns:1fr 1fr;gap:28px;margin-top:28px;color:#64748b}.signatures div{padding-top:18px;border-top:1px solid #cbd5e1}.thermal-line{display:${isThermal ? "block" : "none"};border-top:1px dashed #111827;margin:8px 0}
      .iraqi-thermal .brand{justify-content:center;text-align:center;gap:7px}.iraqi-thermal .mark{font-size:.86em}.iraqi-thermal .badge{text-align:center;padding-top:5px}.iraqi-thermal .badge span,.iraqi-thermal .badge p{font-size:.86em}.iraqi-thermal .note{border-radius:2px;padding:7px;line-height:1.55}
      @media (max-width:720px){.hero,.footer{grid-template-columns:1fr}.badge{text-align:start}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media print{body{background:#fff}.sheet{box-shadow:none;border:0;border-radius:0;margin:0}.hero{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    `;
  }

  function safeLogoDataUrl(value) {
    const dataUrl = String(value || "").trim();
    return /^data:image\/(?:png|jpe?g|webp|svg\+xml);/i.test(dataUrl) && dataUrl.length <= 450000 ? dataUrl : "";
  }

  function businessInitials(state) {
    const name = repair(ToxStore?.businessProfileName?.(state) || state?.businessName || "TOX");
    const words = name.split(/\s+/).filter(Boolean);
    if (!words.length) return "TOX";
    const initials = words.slice(0, 2).map((word) => word[0]).join("");
    return initials || name.slice(0, 2) || "TOX";
  }

  function logoContentHtml(settings, state) {
    const brand = mergeDesigner(settings.designer, settings.logoMode).brand;
    if (brand.logoSource === "none") return "";
    const dataUrl = brand.logoSource === "uploaded" ? safeLogoDataUrl(brand.logoImageDataUrl) : "";
    if (dataUrl) return `<img src="${escapeHtml(dataUrl)}" alt="">`;
    if (brand.logoSource === "initials") return escapeHtml(businessInitials(state));
    return "TOX";
  }

  function brandMarkHtml(settings, state) {
    const content = logoContentHtml(settings, state);
    return content ? `<div class="mark" aria-hidden="true">${content}</div>` : "";
  }

  function watermarkHtml(settings, state) {
    const designer = mergeDesigner(settings.designer, settings.logoMode);
    if (designer.brand.logoPosition !== "watermark" || designer.brand.logoSource === "none" || settings.paperSize === "thermal-80") return "";
    const content = logoContentHtml(settings, state);
    return content ? `<div class="watermark-mark" aria-hidden="true">${content}</div>` : "";
  }

  function designerClasses(settings) {
    const designer = mergeDesigner(settings.designer, settings.logoMode);
    const classes = [
      `header-${designer.layout.headerStyle}`,
      `table-${designer.layout.tableStyle}`,
      `total-${designer.layout.totalStyle}`,
      `border-${designer.layout.borderStyle}`,
      `logo-${designer.brand.logoShape}`,
      `logo-${designer.brand.logoPosition}`
    ];
    if (settings.paperSize === "thermal-80") classes.push("thermal-print");
    if (isIraqiThermal(settings)) classes.push("iraqi-thermal");
    return classes.map((entry) => entry.replace(/[^a-z0-9-]/gi, "")).join(" ");
  }

  function footerNotesHtml(settings, state, record) {
    const designer = mergeDesigner(settings.designer, settings.logoMode);
    const parts = [];
    if (settings.showFields.notes) {
      parts.push(repair(record?.note || text(state, "warrantyNote")));
    }
    if (designer.footer.note) parts.push(repair(designer.footer.note));
    if (designer.footer.terms) parts.push(repair(designer.footer.terms));
    if (designer.footer.showThankYou) parts.push(langFor(state) === "ar" ? "شكراً لتعاملكم معنا." : "Thank you for your business.");
    return parts.length
      ? `<div class="note">${parts.map((part) => `<p>${escapeHtml(part)}</p>`).join("")}</div>`
      : "<div></div>";
  }

  function iraqiThermalRowsHtml(items, state) {
    if (!items.length) {
      return `<div class="receipt-item"><strong>${escapeHtml(text(state, "noItems"))}</strong></div>`;
    }
    return items.map((item) => `
      <article class="receipt-item">
        <div class="receipt-item-head">
          <span class="receipt-item-index">${item.index}</span>
          <strong class="receipt-item-name">${escapeHtml(item.name)}</strong>
        </div>
        <div class="receipt-item-calc">
          <span>${escapeHtml(item.qty)} ${escapeHtml(item.unit)}</span>
          <span>${money(item.priceUsd, state)}</span>
        </div>
        <div class="receipt-item-total">
          <span>${text(state, "total")}</span>
          <strong>${money(item.totalUsd, state)}</strong>
        </div>
        ${item.meta ? `<small class="receipt-item-meta">${escapeHtml(item.meta)}</small>` : ""}
      </article>
    `).join("");
  }

  function rowsHtml(items, state, settings) {
    const isLegacyThermal = settings.template === "thermal-80" || settings.template === "receipt-short";
    if (!items.length) return `<tr><td colspan="${isLegacyThermal ? 6 : 7}">${escapeHtml(text(state, "noItems"))}</td></tr>`;
    return items.map((item) => `
      <tr>
        <td>${item.index}</td>
        <td class="name"><strong>${escapeHtml(item.name)}</strong>${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ""}</td>
        <td>${escapeHtml(item.qty)}</td>
        <td>${escapeHtml(item.unit)}</td>
        <td>${money(item.priceUsd, state)}</td>
        ${isLegacyThermal ? "" : `<td>${money(item.discountUsd, state)}</td>`}
        <td><strong>${money(item.totalUsd, state)}</strong></td>
      </tr>
    `).join("");
  }

  function statementHtml(documentType, record, state, settings) {
    const rows = statementRows(documentType, record);
    const debit = rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    const balance = Math.max(0, debit - credit);
    return page(documentType, record, state, settings, `
      <section class="summary">
        <div><span>${text(state, "debit")}</span><strong>${money(debit, state)}</strong></div>
        <div><span>${text(state, "credit")}</span><strong>${money(credit, state)}</strong></div>
        <div><span>${text(state, "balance")}</span><strong>${money(balance, state)}</strong></div>
        <div><span>${text(state, "total")}</span><strong>${rows.length}</strong></div>
      </section>
      <section class="content">
        <table><thead><tr><th>${text(state, "date")}</th><th>${text(state, "item")}</th><th>${text(state, "debit")}</th><th>${text(state, "credit")}</th><th>${text(state, "balance")}</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${dateTime(row.date, state)}</td><td>${escapeHtml(row.title)}</td><td>${row.debit ? money(row.debit, state) : "-"}</td><td>${row.credit ? money(row.credit, state) : "-"}</td><td>${money(row.balance || 0, state)}</td></tr>`).join("") || `<tr><td colspan="5">${text(state, "noItems")}</td></tr>`}</tbody></table>
        <section class="footer">${footerNotesHtml(settings, state, record)}<div></div></section>
      </section>
    `);
  }

  function page(documentType, record, state, settings, bodyHtml) {
    const designer = mergeDesigner(settings.designer, settings.logoMode);
    const businessName = repair(ToxStore?.businessProfileName?.(state) || state?.businessName || "TOX");
    const meta = businessMeta(state, settings);
    const tagline = repair(designer.brand.tagline || "");
    const documentId = repair(record?.id || record?.externalId || `PRINT-${Date.now()}`);
    const status = totalsFor(documentType, record).remaining > 0.0001 ? text(state, "balanceStatus") : text(state, "paidStatus");
    const brandCopy = [
      designer.brand.showBusinessName !== false ? `<h1>${escapeHtml(businessName)}</h1>` : "",
      meta ? `<p>${escapeHtml(meta)}</p>` : "",
      tagline ? `<p>${escapeHtml(tagline)}</p>` : (!meta ? `<p>${escapeHtml(documentTitle(documentType, record, state))}</p>` : "")
    ].join("");
    const showHeaderMark = designer.brand.logoPosition !== "watermark";
    return `<!doctype html><html lang="${langFor(state)}" dir="${state?.dir || (langFor(state) === "ar" ? "rtl" : "ltr")}"><head><meta charset="utf-8"><title>${escapeHtml(documentId)}</title><style>${css(settings, state)}</style></head><body><main class="sheet ${designerClasses(settings)}">
      ${watermarkHtml(settings, state)}
      <section class="hero">
        <div class="brand">${showHeaderMark ? brandMarkHtml(settings, state) : ""}<div class="brand-copy">${brandCopy}</div></div>
        <div class="badge"><span>${escapeHtml(documentTitle(documentType, record, state))}</span><strong>${escapeHtml(documentId)}</strong><p>${dateTime(record?.createdAt || record?.receivedAt || new Date(), state)}</p><p>${escapeHtml(status)}</p></div>
      </section>
      ${bodyHtml}
    </main></body></html>`;
  }

  function invoiceHtml(documentType, record, state, settings) {
    const items = normalizeItems(documentType, record, state, settings);
    const totals = totalsFor(documentType, record);
    if (isIraqiThermal(settings)) {
      return page(documentType, record, state, settings, `
        <section class="receipt-meta">
          <div><span>${text(state, "party")}</span><strong>${escapeHtml(partyName(documentType, record, state))}</strong></div>
          <div><span>${text(state, "total")}</span><strong>${money(totals.total, state)}</strong></div>
          <div><span>${text(state, "paid")}</span><strong>${money(totals.paid, state)}</strong></div>
          <div><span>${text(state, "remaining")}</span><strong>${money(totals.remaining, state)}</strong></div>
        </section>
        <section class="content receipt-content">
          <section class="receipt-items">${iraqiThermalRowsHtml(items, state)}</section>
          <section class="footer receipt-footer">
            ${footerNotesHtml(settings, state, record)}
            <div class="totals">
              <div class="total-row"><span>${text(state, "subtotal")}</span><strong>${money(totals.subtotal, state)}</strong></div>
              <div class="total-row"><span>${text(state, "discount")}</span><strong>${money(totals.discount, state)}</strong></div>
              <div class="total-row grand"><span>${text(state, "total")}</span><strong>${money(totals.total, state)}</strong></div>
              ${settings.showFields.paidRemaining ? `<div class="total-row paid"><span>${text(state, "paid")}</span><strong>${money(totals.paid, state)}</strong></div><div class="total-row debt"><span>${text(state, "remaining")}</span><strong>${money(totals.remaining, state)}</strong></div>` : ""}
            </div>
          </section>
          <div class="thermal-line"></div>
        </section>
      `);
    }
    const isThermal = settings.template === "thermal-80" || settings.template === "receipt-short";
    return page(documentType, record, state, settings, `
      <section class="summary">
        <div><span>${text(state, "party")}</span><strong>${escapeHtml(partyName(documentType, record, state))}</strong></div>
        <div><span>${text(state, "total")}</span><strong>${money(totals.total, state)}</strong></div>
        <div><span>${text(state, "paid")}</span><strong>${money(totals.paid, state)}</strong></div>
        <div><span>${text(state, "remaining")}</span><strong>${money(totals.remaining, state)}</strong></div>
      </section>
      <section class="content">
        <table><thead><tr><th>#</th><th>${text(state, "item")}</th><th>${text(state, "qty")}</th><th>${text(state, "unit")}</th><th>${text(state, "price")}</th>${isThermal ? "" : `<th>${text(state, "discount")}</th>`}<th>${text(state, "total")}</th></tr></thead><tbody>${rowsHtml(items, state, settings)}</tbody></table>
        <section class="footer">
          ${footerNotesHtml(settings, state, record)}
          <div class="totals">
            <div class="total-row"><span>${text(state, "subtotal")}</span><strong>${money(totals.subtotal, state)}</strong></div>
            <div class="total-row"><span>${text(state, "discount")}</span><strong>${money(totals.discount, state)}</strong></div>
            <div class="total-row grand"><span>${text(state, "total")}</span><strong>${money(totals.total, state)}</strong></div>
            ${settings.showFields.paidRemaining ? `<div class="total-row paid"><span>${text(state, "paid")}</span><strong>${money(totals.paid, state)}</strong></div><div class="total-row debt"><span>${text(state, "remaining")}</span><strong>${money(totals.remaining, state)}</strong></div>` : ""}
          </div>
        </section>
        <section class="signatures"><div>${documentType.toLowerCase().includes("purchase") ? text(state, "signatureSupplier") : text(state, "signatureCustomer")}</div><div>${text(state, "signatureStaff")}</div></section>
        <div class="thermal-line"></div>
      </section>
    `);
  }

  function receiptHtml(record, state, settings) {
    const payments = (state.clientPayments || []).filter((payment) => (payment.appliedTo || []).some((item) => item.invoiceId === record.id));
    const lastPayment = payments[0];
    const amount = number(lastPayment?.amountUsd || record?.paidUsd);
    return page("clientReceipt", { ...record, id: lastPayment?.id || record?.id, title: text(state, "clientReceipt"), receivedAt: lastPayment?.receivedAt }, state, settings, `
      <section class="summary">
        <div><span>${text(state, "party")}</span><strong>${escapeHtml(partyName("saleInvoice", record, state))}</strong></div>
        <div><span>${text(state, "invoiceNo")}</span><strong>${escapeHtml(record.id || "-")}</strong></div>
        <div><span>${text(state, "paid")}</span><strong>${money(amount, state)}</strong></div>
        <div><span>${text(state, "remaining")}</span><strong>${money(totalsFor("saleInvoice", record).remaining, state)}</strong></div>
      </section>
      <section class="content">${footerNotesHtml(settings, state, { ...record, note: lastPayment?.note || record?.note || text(state, "clientReceipt") })}<section class="signatures"><div>${text(state, "signatureCustomer")}</div><div>${text(state, "signatureStaff")}</div></section></section>
    `);
  }

  function html(documentType, record, state = ToxStore?.getState?.()) {
    const settings = settingsFor(documentType, state);
    if (documentType === "clientStatement" || documentType === "supplierStatement") {
      return statementHtml(documentType, record, state, settings);
    }
    if (documentType === "clientReceipt") return receiptHtml(record, state, settings);
    return invoiceHtml(documentType, record, state, settings);
  }

  function render(documentType, record, state = ToxStore?.getState?.()) {
    const printWindow = window.open("", "_blank", "width=1120,height=820");
    if (!printWindow) {
      window.showNotice?.("تعذر فتح نافذة الطباعة", "error");
      return false;
    }
    printWindow.document.write(html(documentType, record, state));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    window.playUiSound?.("print");
    return true;
  }

  return { html, render, templates, settingsFor };
})();

window.ToxPrint = ToxPrint;
