const settingsApiBase = window.ToxApi?.baseUrl?.() || `${window.location.origin.includes(":5500") ? "http://127.0.0.1:8765" : ""}/api`;

let currentSessionUser = null;
let currentSessionAuthenticated = false;
let sessionLoadFailed = false;
let guideStepIndex = 0;
let lastAuditLogs = null;
let lastLoginEvents = null;
let lastUsers = null;
let invoicePrintDraft = null;
let activeInvoicePrintDocument = "saleInvoice";

const invoiceLogoMaxBytes = 300 * 1024;
const invoiceDesignerDefaults = Object.freeze({
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
});
const invoiceDesignerPresets = {
  official: {
    defaultTemplate: "official-a4",
    paperSize: "a4",
    density: "normal",
    designer: {
      brand: { logoSource: "tox", logoShape: "rounded", logoPosition: "start", logoSize: 54, logoOpacity: 100 },
      layout: { headerStyle: "classic", tableStyle: "striped", totalStyle: "card", borderStyle: "soft", marginScale: 100 }
    }
  },
  color: {
    defaultTemplate: "professional-color",
    paperSize: "a4",
    density: "normal",
    designer: {
      brand: { logoSource: "tox", logoShape: "seal", logoPosition: "start", logoSize: 62, logoOpacity: 100 },
      layout: { headerStyle: "gradient", tableStyle: "striped", totalStyle: "bar", borderStyle: "soft", marginScale: 100 }
    }
  },
  minimal: {
    defaultTemplate: "official-a4",
    paperSize: "a4",
    density: "normal",
    designer: {
      brand: { logoSource: "initials", logoShape: "circle", logoPosition: "center", logoSize: 48, logoOpacity: 100 },
      layout: { headerStyle: "minimal", tableStyle: "minimal", totalStyle: "classic", borderStyle: "none", marginScale: 110 }
    }
  },
  erp: {
    defaultTemplate: "warehouse-dense",
    paperSize: "a4",
    density: "dense",
    designer: {
      brand: { logoSource: "tox", logoShape: "square", logoPosition: "start", logoSize: 48, logoOpacity: 100 },
      layout: { headerStyle: "boxed", tableStyle: "boxed", totalStyle: "card", borderStyle: "sharp", marginScale: 90 }
    }
  },
  iraqi: {
    defaultTemplate: "iraqi-thermal-80",
    paperSize: "thermal-80",
    density: "compact",
    fontScale: 96,
    designer: {
      brand: { logoSource: "initials", logoShape: "rounded", logoPosition: "center", logoSize: 30, logoOpacity: 100 },
      layout: { headerStyle: "minimal", tableStyle: "dense", totalStyle: "classic", borderStyle: "none", marginScale: 80 },
      typography: { fontFamily: "system", fontScale: 96 }
    }
  },
  thermal: {
    defaultTemplate: "iraqi-thermal-80",
    paperSize: "thermal-80",
    density: "compact",
    fontScale: 96,
    designer: {
      brand: { logoSource: "initials", logoShape: "rounded", logoPosition: "center", logoSize: 30, logoOpacity: 100 },
      layout: { headerStyle: "minimal", tableStyle: "dense", totalStyle: "classic", borderStyle: "none", marginScale: 80 },
      typography: { fontFamily: "system", fontScale: 96 }
    }
  },
  ledger: {
    defaultTemplate: "ledger-a4",
    paperSize: "a4",
    density: "dense",
    designer: {
      brand: { logoSource: "tox", logoShape: "letterhead", logoPosition: "start", logoSize: 56, logoOpacity: 100 },
      layout: { headerStyle: "letterhead", tableStyle: "boxed", totalStyle: "bar", borderStyle: "sharp", marginScale: 92 }
    }
  }
};

const settingsText = {
  ar: {
    stepProgress: "الخطوة {current} من {total}",
    next: "التالي",
    finish: "إنهاء",
    unknown: "غير معروف",
    notSignedIn: "غير مسجل دخول",
    signInHint: "اضغط صفحة الدخول وسجل دخولك بحساب المدير.",
    sessionErrorTitle: "تعذر التحقق من الجلسة",
    sessionErrorText: "تأكد أن الباك اند يعمل على 127.0.0.1:8765.",
    superuser: "مدير كامل",
    normalUser: "مستخدم",
    active: "فعال",
    inactive: "معطل",
    ipUnknown: "IP غير معروف",
    noAuditLogs: "لا توجد عمليات مسجلة بعد",
    auditLoadError: "تعذر تحميل سجل العمليات من الباك اند",
    noLoginEvents: "لا توجد سجلات دخول",
    loginEventsLoadError: "تعذر تحميل سجل الدخول",
    noUsers: "لا يوجد مستخدمون",
    usersLoadError: "لا يمكن تحميل المستخدمين. سجل دخولك كمدير من صفحة الدخول.",
    backupExported: "تم تصدير النسخة",
    fullBackupExported: "تم تصدير نسخة كاملة قبل التصفير",
    fullBackupExporting: "جاري تصدير نسخة كاملة قبل التصفير...",
    fullBackupResetReady: "تم تنزيل نسخة كاملة. احتفظ بها قبل تأكيد التصفير.",
    fullBackupResetWarning: "تنبيه: تعذر تنزيل نسخة كاملة الآن. يمكنك إكمال التصفير، لكن الأفضل تصدير نسخة كاملة من صفحة حماية البيانات.",
    backupRestored: "تم استرجاع النسخة. سيتم تحديث الصفحة.",
    backupRestoreError: "تعذر استرجاع النسخة",
    resetDone: "تم تصفير بيانات النظام بنجاح",
    resetError: "تعذر تصفير النظام. يجب تسجيل الدخول كمدير.",
    resetTitle: "تصفير النظام",
    resetText: "سيتم حذف كل بيانات التشغيل والديون والفواتير والمخزون والموظفين، مع إبقاء حساب المدير والإعدادات الأساسية فقط.",
    userUpdated: "تم تحديث المستخدم",
    userUpdateError: "تعذر تحديث المستخدم",
    userCreated: "تم إضافة المستخدم",
    userCreateError: "تعذر إضافة المستخدم. يجب أن تكون مديرًا وكلمة المرور 6 أحرف أو أكثر.",
    enableUser: "تفعيل",
    disableUser: "تعطيل",
    login: "دخول",
    logout: "خروج",
    themeSummaryToxBlue: "White",
    themeDetailToxBlue: "واجهة بيضاء حادة وواضحة بحدود أنظف وتباين أعلى.",
    themeSummaryNoir: "Black Gold",
    themeDetailNoir: "أسود فاخر بلمسات ذهبية منظمة للعمل الطويل.",
    themeSummaryMatteBlack: "Matte Black",
    themeDetailMatteBlack: "أسود مطفي قوي بسطوح فحمية ولمسة برتقالية هادئة.",
    themeSummarySummerOrange: "Summer Orange",
    themeDetailSummerOrange: "ثيم صيفي برتقالي دافئ بسطوح فاتحة ومظهر احترافي.",
    themeSummaryEmeraldLedger: "Emerald Ledger",
    themeDetailEmeraldLedger: "زمردي هادئ وواضح للمحاسبة والمخازن.",
    themeSummaryGraphiteLime: "Graphite Lime",
    themeDetailGraphiteLime: "داكن Graphite بلمسة Lime للعمل الليلي.",
    themeSummaryRubySlate: "Ruby Slate",
    themeDetailRubySlate: "Slate فاتح بلمسة Ruby للمبيعات والتنبيهات.",
    themeSummaryAmethystControl: "Amethyst Control",
    themeDetailAmethystControl: "محايد احترافي بلمسة Amethyst هادئة.",
    themeSummaryVioletNight: "Violet Night",
    themeDetailVioletNight: "بنفسجي ليلي فاخر للعمل الطويل.",
    themeModePrimaryLight: "أساسي فاتح",
    themeModePrimaryDark: "أساسي داكن",
    themeModeSecondaryLight: "ثانوي فاتح",
    themeModeSecondaryDark: "ثانوي داكن"
  },
  en: {
    stepProgress: "Step {current} of {total}",
    next: "Next",
    finish: "Finish",
    unknown: "Unknown",
    notSignedIn: "Not signed in",
    signInHint: "Open the login page and sign in with the admin account.",
    sessionErrorTitle: "Could not verify the session",
    sessionErrorText: "Make sure the backend is running on 127.0.0.1:8765.",
    superuser: "Full admin",
    normalUser: "User",
    active: "Active",
    inactive: "Disabled",
    ipUnknown: "Unknown IP",
    noAuditLogs: "No system activity has been recorded yet",
    auditLoadError: "Could not load the activity log from the backend",
    noLoginEvents: "No login events yet",
    loginEventsLoadError: "Could not load the login log",
    noUsers: "No users found",
    usersLoadError: "Users could not be loaded. Sign in as an admin from the login page.",
    backupExported: "Backup exported",
    fullBackupExported: "Full backup exported before reset",
    fullBackupExporting: "Exporting a full backup before reset...",
    fullBackupResetReady: "A full backup was downloaded. Keep it before confirming reset.",
    fullBackupResetWarning: "Warning: a full backup could not be downloaded now. You can continue reset, but exporting one from Data protection is recommended.",
    backupRestored: "Backup restored. The page will refresh.",
    backupRestoreError: "Could not restore the backup",
    resetDone: "System data was reset successfully",
    resetError: "Could not reset the system. You must be signed in as an admin.",
    resetTitle: "Reset system",
    resetText: "This will delete operating data, debts, invoices, stock, and employees while keeping the admin account and core settings.",
    userUpdated: "User updated",
    userUpdateError: "Could not update the user",
    userCreated: "User added",
    userCreateError: "Could not add the user. You must be an admin and the password must be at least 6 characters.",
    enableUser: "Enable",
    disableUser: "Disable",
    login: "Login",
    logout: "Logout",
    themeSummaryToxBlue: "White",
    themeDetailToxBlue: "A crisp white interface with cleaner borders and stronger contrast.",
    themeSummaryNoir: "Black Gold",
    themeDetailNoir: "A premium black theme with organized gold accents for long work sessions.",
    themeSummaryMatteBlack: "Matte Black",
    themeDetailMatteBlack: "A strong matte-black workspace with charcoal surfaces and restrained orange accents.",
    themeSummarySummerOrange: "Summer Orange",
    themeDetailSummerOrange: "A warm orange theme with light surfaces and a professional summer tone.",
    themeSummaryEmeraldLedger: "Emerald Ledger",
    themeDetailEmeraldLedger: "A calm emerald workspace for accounting and inventory.",
    themeSummaryGraphiteLime: "Graphite Lime",
    themeDetailGraphiteLime: "A graphite night workspace with crisp lime accents.",
    themeSummaryRubySlate: "Ruby Slate",
    themeDetailRubySlate: "A light slate workspace with ruby sales accents.",
    themeSummaryAmethystControl: "Amethyst Control",
    themeDetailAmethystControl: "A neutral control-room palette with restrained amethyst.",
    themeSummaryVioletNight: "Violet Night",
    themeDetailVioletNight: "A premium violet night workspace for long sessions.",
    themeModePrimaryLight: "Primary light",
    themeModePrimaryDark: "Primary dark",
    themeModeSecondaryLight: "Secondary light",
    themeModeSecondaryDark: "Secondary dark"
  }
};

const settingsGuideSteps = {
  ar: [
    {
      title: "المركز والثيمات",
      body: "ابدأ من المركز الرئيسي الجديد ثم ثبت شكل النظام حتى يكون واضحاً للمدير والموظفين قبل التغليف.",
      points: [
        "اختر White أو Black كثيم أساسي، أو ثيم ثانوي حسب بيئة العمل.",
        "تأكد أن الثيمات الداكنة تعرض الأزرار والفواتير بوضوح.",
        "امنح الموظفين صلاحية فتح المركز الرئيسي إذا تريد ظهور Dashboard لهم."
      ]
    },
    {
      title: "المخازن والمنتجات",
      body: "قبل البيع أو الشراء، جهز المخازن والمنتجات ووحدات البيع حتى تكون الكميات دقيقة.",
      points: [
        "أضف المخزن الرئيسي أو الفروع.",
        "أدخل المنتجات والباركود والوحدات.",
        "امنح صلاحية طباعة الملصقات فقط لمن يحتاج الباركود والليبلات."
      ]
    },
    {
      title: "المبيعات والأقساط",
      body: "صفحات البيع أصبحت مقسمة بين بيع مباشر، بيع بفاتورة، وفواتير أقساط مع ربح مرن.",
      points: [
        "استخدم صلاحية إنشاء الفاتورة للموظف الذي يبيع بفاتورة.",
        "استخدم صلاحية بيع الأقساط لمن يسمح له بإنشاء معاملات تقسيط.",
        "تعديل ربح الأقساط له صلاحية مستقلة ويتأثر أيضاً بإعداد السماح العام."
      ]
    },
    {
      title: "الفواتير والحسابات",
      body: "كل فاتورة أو دفعة تؤثر على حساب العميل أو المورد، لذلك اجعل صلاحيات الحسابات محددة بدقة.",
      points: [
        "إدارة الديون تفتح حسابات العملاء والموردين والتسديدات.",
        "عرض الأرباح مخصص للإدارة أو المحاسب الموثوق.",
        "إلغاء أو حذف الفواتير يبقى صلاحية منفصلة عن فتح صفحة البيع."
      ]
    },
    {
      title: "الموظفون والصلاحيات",
      body: "قبل التسليم النهائي، راجع كل موظف من صفحة الموظفين وثبت دوره وصلاحياته حسب عمله الحقيقي.",
      points: [
        "الكاشير: مبيعات وفواتير وأقساط حسب الحاجة.",
        "مسؤول المخزن: منتجات ومخازن وملصقات فقط.",
        "المحاسب: الحسابات والأرباح والديون بدون صلاحيات إدارية كاملة."
      ]
    },
    {
      title: "السجلات والنسخ الاحتياطي",
      body: "في نهاية اليوم راجع التقارير وسجلات التدقيق وخذ نسخة احتياطية حتى تبقى البيانات آمنة.",
      points: [
        "راجع سجل الدخول والخروج وسجل العمليات من الإعدادات.",
        "تغييرات أرباح الأقساط والإعدادات تظهر في سجل التدقيق.",
        "صدر نسخة احتياطية قبل التغليف أو نقل الجهاز."
      ]
    }
  ],
  en: [
    {
      title: "Dashboard and Themes",
      body: "Start from the redesigned home dashboard, then lock the visual setup before packaging.",
      points: [
        "Use White or Black as primary themes, or choose a secondary theme for the workspace.",
        "Verify that dark themes keep buttons, invoice details, and cards readable.",
        "Grant dashboard access to employees who should see the home dashboard."
      ]
    },
    {
      title: "Warehouses and Products",
      body: "Before selling or purchasing, prepare warehouses, products, barcodes, and sales units so stock stays accurate.",
      points: [
        "Create the main warehouse or branches.",
        "Add products, barcodes, and unit definitions.",
        "Grant label printing only to users who handle barcodes and product labels."
      ]
    },
    {
      title: "Sales and Installments",
      body: "Sales are split between direct POS, invoice sales, and installment sales with flexible profit rules.",
      points: [
        "Use invoice creation permission for staff who sell by invoice.",
        "Use installment permission for staff who can create installment deals.",
        "Installment profit editing has its own permission and still respects the global allow/deny setting."
      ]
    },
    {
      title: "Invoices and Accounts",
      body: "Every invoice or payment affects customer or supplier balances, so account permissions should stay precise.",
      points: [
        "Debt management opens customer and supplier accounts and payments.",
        "Profit visibility should be limited to management or trusted accountants.",
        "Invoice deletion or voiding remains separate from opening the sales page."
      ]
    },
    {
      title: "Employees and Permissions",
      body: "Before the final build, review each employee from the Employees page and confirm their real working role.",
      points: [
        "Cashier: sales, invoices, and installments as needed.",
        "Warehouse: products, warehouses, quantities, and labels only.",
        "Accountant: accounts, profits, and debts without full admin access."
      ]
    },
    {
      title: "Logs and Backup",
      body: "At the end of the day, review reports and audit logs, then export a backup to keep data safe.",
      points: [
        "Review login/logout and activity logs from Settings.",
        "Installment profit and profit-setting changes appear in the audit log.",
        "Export a backup before packaging or moving the machine."
      ]
    }
  ]
};

settingsGuideSteps.ar.splice(5, 0, {
  title: "عزل المدير وموظفيه",
  body: "أنشئ حساب المدير من السوبر أدمن، ثم أضف الكاشير والمحاسب ومسؤول المخزن من صفحة الموظفين. كل حساب يظهر تحت مديره حتى لا تختلط فرق العمل.",
  points: [
    "السوبر أدمن يرى كل المديرين وعدد الموظفين التابعين لكل مدير.",
    "المدير يرى موظفيه فقط ويمنحهم الصلاحيات حسب الدور.",
    "راجع التقرير الذكي والحسابات لمتابعة المرتجعات والمصروفات والرواتب.",
  ],
});
settingsGuideSteps.en.splice(5, 0, {
  title: "Managers and staff ownership",
  body: "Create each manager from Super Admin, then add cashiers, accountants, and warehouse staff from Employees. Every account stays under its manager.",
  points: [
    "Super Admin sees all managers and each manager's staff count.",
    "A manager sees only their own staff and assigns role-based permissions.",
    "Use Smart Reports and Finance to review returns, expenses, and payroll.",
  ],
});

const roleLabels = {
  ar: {
    admin: "مدير",
    cashier: "كاشير",
    warehouse: "مسؤول مخزن",
    accountant: "محاسب",
    sales: "مبيعات",
    manager: "مدير"
  },
  en: {
    admin: "Admin",
    cashier: "Cashier",
    warehouse: "Warehouse manager",
    accountant: "Accountant",
    sales: "Sales",
    manager: "Manager"
  }
};

const actionLabels = {
  ar: {
    login: "تسجيل دخول",
    logout: "تسجيل خروج",
    create: "إنشاء",
    update: "تعديل",
    delete: "حذف",
    backup: "نسخ احتياطي",
    restore: "استرجاع",
    reset: "تصفير",
    sync: "مزامنة",
    sale: "بيع",
    purchase: "شراء",
    payment: "تسديد",
    print: "طباعة",
    installment_profit_change: "تعديل ربح الأقساط",
    installment_profit_settings_change: "تعديل إعدادات ربح الأقساط"
  },
  en: {
    login: "Login",
    logout: "Logout",
    create: "Create",
    update: "Update",
    delete: "Delete",
    backup: "Backup",
    restore: "Restore",
    reset: "Reset",
    sync: "Sync",
    sale: "Sale",
    purchase: "Purchase",
    payment: "Payment",
    print: "Print",
    installment_profit_change: "Installment profit change",
    installment_profit_settings_change: "Installment profit settings change"
  }
};

const entityLabels = {
  ar: {
    user: "مستخدم",
    employee: "موظف",
    product: "منتج",
    warehouse: "مخزن",
    unit: "وحدة",
    invoice: "فاتورة",
    sale: "بيع",
    purchase: "شراء",
    supplier: "مورد",
    client: "عميل",
    settings: "إعدادات",
    backup: "نسخة احتياطية",
    system: "النظام"
  },
  en: {
    user: "User",
    employee: "Employee",
    product: "Product",
    warehouse: "Warehouse",
    unit: "Unit",
    invoice: "Invoice",
    sale: "Sale",
    purchase: "Purchase",
    supplier: "Supplier",
    client: "Customer",
    settings: "Settings",
    backup: "Backup",
    system: "System"
  }
};

const themeTextKey = {
  "tox-blue": "ToxBlue",
  noir: "Noir",
  "matte-black": "MatteBlack",
  "summer-orange": "SummerOrange",
  "emerald-ledger": "EmeraldLedger",
  "graphite-lime": "GraphiteLime",
  "ruby-slate": "RubySlate",
  "amethyst-control": "AmethystControl",
  "violet-night": "VioletNight"
};

function getLang() {
  return ToxStore.getState().lang === "en" ? "en" : "ar";
}

function text(key, replacements = {}) {
  const lang = getLang();
  const dictionary = settingsText[lang] || settingsText.ar;
  let value = dictionary[key] || settingsText.en[key] || key;
  Object.entries(replacements).forEach(([name, replacement]) => {
    value = value.replaceAll(`{${name}}`, replacement);
  });
  return value;
}

function uiText(key) {
  const lang = getLang();
  if (typeof ToxI18n !== "undefined") {
    return ToxI18n[lang]?.[key] || ToxI18n.en?.[key] || key;
  }
  return key;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function repairedText(value) {
  return typeof ToxStore !== "undefined" && ToxStore.repairText ? ToxStore.repairText(value) : String(value ?? "");
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(getLang() === "ar" ? "ar-IQ" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function apiFetch(path, options = {}) {
  if (window.ToxApi?.fetch) {
    return window.ToxApi.fetch(path, options);
  }
  return fetch(`${settingsApiBase}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
}

function notify(message, tone = "info") {
  if (typeof showNotice === "function") {
    showNotice(message, tone);
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function localDateTimeStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function recordFullBackupExport() {
  try {
    localStorage.setItem("tox-last-full-backup-exported-at", new Date().toISOString());
  } catch (error) {
    console.warn("Could not record full backup export time", error);
  }
}

function closeSettingsPopovers(except = "") {
  document.querySelectorAll("[data-settings-popover]").forEach((popover) => {
    const keepOpen = except && popover.dataset.settingsPopover === except;
    popover.classList.toggle("hidden", !keepOpen);
  });
  document.querySelectorAll("[data-settings-popover-trigger]").forEach((button) => {
    button.setAttribute("aria-expanded", String(except && button.dataset.settingsPopoverTrigger === except));
  });
}

function positionSettingsPopover(popover, trigger) {
  if (!popover || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const isThemePopover = popover.dataset.settingsPopover === "theme";
  const width = Math.min(isThemePopover ? 640 : 380, window.innerWidth - 24);
  const margin = 12;
  const gap = 10;
  const availableBelow = window.innerHeight - rect.bottom - margin - gap;
  const availableAbove = rect.top - margin - gap;
  const maxHeight = Math.max(260, Math.min(isThemePopover ? 560 : 480, Math.max(availableBelow, availableAbove)));
  const placeAbove = availableBelow < 340 && availableAbove > availableBelow;
  popover.style.width = `${width}px`;
  popover.style.maxHeight = `${maxHeight}px`;
  popover.style.top = placeAbove
    ? `${Math.max(margin, rect.top - gap - maxHeight)}px`
    : `${Math.min(rect.bottom + gap, window.innerHeight - margin - maxHeight)}px`;
  popover.style.left = "";
  popover.style.right = "";
  if (document.documentElement.dir === "rtl") {
    popover.style.right = `${Math.max(margin, Math.min(window.innerWidth - rect.right, window.innerWidth - width - margin))}px`;
  } else {
    popover.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
  }
}

function toggleSettingsPopover(name, trigger) {
  const popover = document.querySelector(`[data-settings-popover="${name}"]`);
  if (!popover) return;
  const willOpen = popover.classList.contains("hidden");
  closeSettingsPopovers(willOpen ? name : "");
  if (willOpen) positionSettingsPopover(popover, trigger);
}

function openBusinessDrawer() {
  closeSettingsPopovers();
  document.querySelector("[data-business-drawer]")?.classList.remove("hidden");
}

function closeBusinessDrawer() {
  document.querySelector("[data-business-drawer]")?.classList.add("hidden");
}

function businessProfileFromControls() {
  return {
    businessName: document.querySelector("[data-settings-business-name]")?.value || "",
    businessSubtitle: document.querySelector("[data-settings-business-subtitle]")?.value || "",
    businessPhone: document.querySelector("[data-settings-business-phone]")?.value || "",
    businessAddress: document.querySelector("[data-settings-business-address]")?.value || "",
    businessOwnerName: document.querySelector("[data-settings-business-owner]")?.value || "",
    businessCompanyName: document.querySelector("[data-settings-business-company]")?.value || ""
  };
}

async function saveBusinessProfile(event) {
  const button = event?.currentTarget;
  if (button) button.disabled = true;
  try {
    ToxStore.setBusinessProfile(businessProfileFromControls());
    if (typeof ToxStore.syncNow !== "function") {
      throw new Error("Business profile sync is unavailable");
    }
    const result = await ToxStore.syncNow();
    if (!result?.ok) {
      throw new Error(result.reason || "Business profile sync failed");
    }
    closeBusinessDrawer();
  } catch (error) {
    console.error("Business profile save failed", error);
    notify(getLang() === "en" ? "Could not save store information." : "تعذر حفظ معلومات المتجر.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function cloneInvoicePrintSettings(settings = {}) {
  const clone = JSON.parse(JSON.stringify(settings || {}));
  return ensureInvoiceDesigner(clone);
}

function cloneInvoiceDesignerDefaults() {
  return JSON.parse(JSON.stringify(invoiceDesignerDefaults));
}

function ensureInvoiceDesigner(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const designer = source.designer && typeof source.designer === "object" ? source.designer : {};
  const legacyLogoSource = source.logoMode === "none" ? "none" : source.logoMode === "text" ? "initials" : "tox";
  const defaults = cloneInvoiceDesignerDefaults();
  source.designer = {
    ...defaults,
    ...designer,
    brand: {
      ...defaults.brand,
      ...(designer.brand || {}),
      logoSource: designer.brand?.logoSource || legacyLogoSource
    },
    layout: {
      ...defaults.layout,
      ...(designer.layout || {})
    },
    typography: {
      ...defaults.typography,
      ...(designer.typography || {}),
      fontScale: Number(designer.typography?.fontScale || source.fontScale || defaults.typography.fontScale)
    },
    footer: {
      ...defaults.footer,
      ...(designer.footer || {})
    }
  };
  source.fontScale = Number(source.fontScale || source.designer.typography.fontScale || 100);
  source.logoMode = source.designer.brand.logoSource === "none"
    ? "none"
    : source.designer.brand.logoSource === "initials"
      ? "text"
      : "mark";
  return source;
}

function mergeInvoiceDesignerPatch(target, patch = {}) {
  const base = ensureInvoiceDesigner(target || {});
  const next = patch && typeof patch === "object" ? patch : {};
  return ensureInvoiceDesigner({
    ...base,
    ...next,
    designer: {
      ...(base.designer || {}),
      ...(next.designer || {}),
      brand: {
        ...(base.designer?.brand || {}),
        ...(next.designer?.brand || {})
      },
      layout: {
        ...(base.designer?.layout || {}),
        ...(next.designer?.layout || {})
      },
      typography: {
        ...(base.designer?.typography || {}),
        ...(next.designer?.typography || {})
      },
      footer: {
        ...(base.designer?.footer || {}),
        ...(next.designer?.footer || {})
      }
    }
  });
}

function invoicePrintLabels() {
  return {
    "thermal-80": "اقتصادي 80mm",
    "iraqi-thermal-80": "سوق عراقي 80mm",
    "official-a4": "رسمي A4",
    "professional-color": "احترافي ملون",
    "warehouse-dense": "جملة ومخازن",
    "receipt-short": "وصل مختصر",
    "ledger-a4": "كشف A4"
  };
}

function sampleInvoicePrintRecord(documentType, state) {
  const now = new Date().toISOString();
  const item = {
    productId: "sample-iphone",
    name: "iPhone 16 Pro Max",
    brand: "Apple",
    sku: "IP16PM",
    barcode: "1234567890123",
    qty: 1,
    unitName: "قطعة",
    priceUsd: 1750000 / Number(state.exchangeRate || 1460),
    discountUsd: 0,
    totalUsd: 1750000 / Number(state.exchangeRate || 1460)
  };
  if (documentType === "clientStatement") {
    return {
      id: "client-preview",
      name: "علي تميمي",
      phone: "0770 000 0000",
      statementRows: [
        { date: now, title: "فاتورة بيع INV-20260529-0001", debit: 1750000 / Number(state.exchangeRate || 1460), credit: 0, balance: 250000 / Number(state.exchangeRate || 1460) },
        { date: now, title: "دفعة عميل", debit: 0, credit: 1500000 / Number(state.exchangeRate || 1460), balance: 250000 / Number(state.exchangeRate || 1460) }
      ]
    };
  }
  if (documentType === "supplierStatement") {
    return {
      id: "supplier-preview",
      name: "شركة التجهيز العراقية",
      phone: "0780 000 0000",
      statementRows: [
        { date: now, title: "فاتورة شراء PUR-20260529-0001", debit: 1750000 / Number(state.exchangeRate || 1460), credit: 0, balance: 250000 / Number(state.exchangeRate || 1460) },
        { date: now, title: "سداد مورد", debit: 0, credit: 1500000 / Number(state.exchangeRate || 1460), balance: 250000 / Number(state.exchangeRate || 1460) }
      ]
    };
  }
  return {
    id: documentType.toLowerCase().includes("purchase") ? "PUR-20260529-0001" : "INV-20260529-0001",
    title: documentType.toLowerCase().includes("purchase") ? "فاتورة شراء" : "فاتورة بيع",
    clientName: "علي تميمي",
    customerName: "علي تميمي",
    supplierName: "شركة التجهيز العراقية",
    createdAt: now,
    subtotalUsd: item.totalUsd,
    discountUsd: 0,
    totalUsd: item.totalUsd,
    costUsd: item.totalUsd,
    paidUsd: 1500000 / Number(state.exchangeRate || 1460),
    debtUsd: 250000 / Number(state.exchangeRate || 1460),
    remainingUsd: 250000 / Number(state.exchangeRate || 1460),
    note: "ملاحظة ضمان/استرجاع حسب سياسة المحل.",
    items: [item]
  };
}

function stateWithInvoicePrintDraft() {
  const state = ToxStore.getState();
  return {
    ...state,
    invoicePrintSettings: invoicePrintDraft || state.invoicePrintSettings,
    clientPayments: [
      ...(state.clientPayments || []),
      {
        id: "PAY-PREVIEW",
        clientId: "client-preview",
        amountUsd: 1500000 / Number(state.exchangeRate || 1460),
        receivedAt: new Date().toISOString(),
        appliedTo: [{ invoiceId: "INV-20260529-0001" }],
        note: "دفعة عند إنشاء الفاتورة"
      }
    ],
    clients: [
      ...(state.clients || []),
      { id: "client-preview", name: "علي تميمي" }
    ],
    suppliers: [
      ...(state.suppliers || []),
      { id: "supplier-preview", name: "شركة التجهيز العراقية" }
    ]
  };
}

function renderInvoicePrintPreview() {
  const frame = document.querySelector("[data-invoice-print-preview]");
  if (!frame || !window.ToxPrint?.html) return;
  const state = stateWithInvoicePrintDraft();
  const record = sampleInvoicePrintRecord(activeInvoicePrintDocument, state);
  frame.srcdoc = ToxPrint.html(activeInvoicePrintDocument, record, state);
}

function syncInvoicePrintControls() {
  const state = ToxStore.getState();
  invoicePrintDraft = cloneInvoicePrintSettings(invoicePrintDraft || state.invoicePrintSettings || {});
  const documentSettings = invoicePrintDraft.perDocumentType?.[activeInvoicePrintDocument] || {};
  const designer = invoicePrintDraft.designer || cloneInvoiceDesignerDefaults();
  const brand = designer.brand || invoiceDesignerDefaults.brand;
  const layout = designer.layout || invoiceDesignerDefaults.layout;
  const typography = designer.typography || invoiceDesignerDefaults.typography;
  const footer = designer.footer || invoiceDesignerDefaults.footer;
  const template = document.querySelector("[data-invoice-print-template]");
  const paper = document.querySelector("[data-invoice-print-paper]");
  const density = document.querySelector("[data-invoice-print-density]");
  const accent = document.querySelector("[data-invoice-print-accent]");
  const font = document.querySelector("[data-invoice-print-font]");
  const logo = document.querySelector("[data-invoice-print-logo]");
  const documentSelect = document.querySelector("[data-invoice-print-document]");
  if (documentSelect) documentSelect.value = activeInvoicePrintDocument;
  if (template) template.value = documentSettings.template || invoicePrintDraft.defaultTemplate || "official-a4";
  if (paper) paper.value = documentSettings.paperSize || invoicePrintDraft.paperSize || "a4";
  if (density) density.value = documentSettings.density || invoicePrintDraft.density || "normal";
  if (accent) accent.value = invoicePrintDraft.accentColor || "#0f766e";
  if (font) font.value = typography.fontScale || invoicePrintDraft.fontScale || 100;
  if (logo) logo.value = invoicePrintDraft.logoMode || "mark";
  const logoSource = document.querySelector("[data-invoice-logo-source]");
  const logoShape = document.querySelector("[data-invoice-logo-shape]");
  const logoPosition = document.querySelector("[data-invoice-logo-position]");
  const logoSize = document.querySelector("[data-invoice-logo-size]");
  const logoOpacity = document.querySelector("[data-invoice-logo-opacity]");
  const logoBusinessName = document.querySelector("[data-invoice-logo-business-name]");
  const logoTagline = document.querySelector("[data-invoice-logo-tagline]");
  const headerStyle = document.querySelector("[data-invoice-header-style]");
  const tableStyle = document.querySelector("[data-invoice-table-style]");
  const totalStyle = document.querySelector("[data-invoice-total-style]");
  const borderStyle = document.querySelector("[data-invoice-border-style]");
  const marginScale = document.querySelector("[data-invoice-margin-scale]");
  const footerNote = document.querySelector("[data-invoice-footer-note]");
  const paymentTerms = document.querySelector("[data-invoice-payment-terms]");
  const footerSignature = document.querySelector("[data-invoice-footer-signature]");
  const footerThanks = document.querySelector("[data-invoice-footer-thanks]");
  const uploadStatus = document.querySelector("[data-invoice-logo-upload-status]");
  if (logoSource) logoSource.value = brand.logoSource || "tox";
  if (logoShape) logoShape.value = brand.logoShape || "rounded";
  if (logoPosition) logoPosition.value = brand.logoPosition || "start";
  if (logoSize) logoSize.value = brand.logoSize || 54;
  if (logoOpacity) logoOpacity.value = brand.logoOpacity || 100;
  if (logoBusinessName) logoBusinessName.checked = brand.showBusinessName !== false;
  if (logoTagline) logoTagline.value = brand.tagline || "";
  if (headerStyle) headerStyle.value = layout.headerStyle || "classic";
  if (tableStyle) tableStyle.value = layout.tableStyle || "striped";
  if (totalStyle) totalStyle.value = layout.totalStyle || "card";
  if (borderStyle) borderStyle.value = layout.borderStyle || "soft";
  if (marginScale) marginScale.value = layout.marginScale || 100;
  if (footerNote) footerNote.value = footer.note || "";
  if (paymentTerms) paymentTerms.value = footer.terms || "";
  if (footerSignature) footerSignature.checked = footer.showSignature !== false;
  if (footerThanks) footerThanks.checked = footer.showThankYou === true;
  if (uploadStatus) {
    uploadStatus.textContent = brand.logoImageDataUrl ? "شعار محفوظ داخل الإعدادات" : "PNG/JPG/SVG حتى 300KB";
  }
  document.querySelectorAll("[data-invoice-print-field]").forEach((input) => {
    input.checked = (invoicePrintDraft.showFields || {})[input.dataset.invoicePrintField] !== false;
  });
  const signatureField = document.querySelector('[data-invoice-print-field="signature"]');
  if (signatureField && footerSignature) {
    signatureField.checked = footerSignature.checked;
  }
  renderInvoicePrintPreview();
}

function updateInvoicePrintDraftFromControls(event) {
  const signatureFieldControl = document.querySelector('[data-invoice-print-field="signature"]');
  const footerSignatureControl = document.querySelector("[data-invoice-footer-signature]");
  if (event?.target?.dataset?.invoicePrintField === "signature" && footerSignatureControl && signatureFieldControl) {
    footerSignatureControl.checked = signatureFieldControl.checked;
  }
  if (event?.target?.hasAttribute?.("data-invoice-footer-signature") && footerSignatureControl && signatureFieldControl) {
    signatureFieldControl.checked = footerSignatureControl.checked;
  }
  const templateControl = document.querySelector("[data-invoice-print-template]");
  const paperControl = document.querySelector("[data-invoice-print-paper]");
  const densityControl = document.querySelector("[data-invoice-print-density]");
  const fontControl = document.querySelector("[data-invoice-print-font]");
  const template = templateControl?.value || "official-a4";
  let paperSize = paperControl?.value || "a4";
  let density = densityControl?.value || "normal";
  const isIraqiThermalTemplate = template === "iraqi-thermal-80";
  if (isIraqiThermalTemplate) {
    paperSize = "thermal-80";
    density = "compact";
    if (paperControl) paperControl.value = paperSize;
    if (densityControl) densityControl.value = density;
    if (event?.target === templateControl && fontControl) fontControl.value = 96;
  }
  invoicePrintDraft = cloneInvoicePrintSettings(invoicePrintDraft || ToxStore.getState().invoicePrintSettings || {});
  const designer = invoicePrintDraft.designer || cloneInvoiceDesignerDefaults();
  const brand = designer.brand || {};
  const layout = designer.layout || {};
  const typography = designer.typography || {};
  const footer = designer.footer || {};
  invoicePrintDraft.defaultTemplate = template;
  invoicePrintDraft.paperSize = paperSize;
  invoicePrintDraft.accentColor = document.querySelector("[data-invoice-print-accent]")?.value || "#0f766e";
  const fontScale = Number(fontControl?.value || (isIraqiThermalTemplate ? 96 : 100));
  invoicePrintDraft.fontScale = fontScale;
  invoicePrintDraft.density = density;
  const logoSource = document.querySelector("[data-invoice-logo-source]")?.value || brand.logoSource || "tox";
  invoicePrintDraft.logoMode = logoSource === "none" ? "none" : logoSource === "initials" ? "text" : "mark";
  invoicePrintDraft.designer = {
    ...designer,
    brand: {
      ...brand,
      logoSource,
      logoShape: document.querySelector("[data-invoice-logo-shape]")?.value || brand.logoShape || "rounded",
      logoPosition: document.querySelector("[data-invoice-logo-position]")?.value || brand.logoPosition || "start",
      logoSize: Number(document.querySelector("[data-invoice-logo-size]")?.value || brand.logoSize || 54),
      logoOpacity: Number(document.querySelector("[data-invoice-logo-opacity]")?.value || brand.logoOpacity || 100),
      showBusinessName: document.querySelector("[data-invoice-logo-business-name]")?.checked !== false,
      tagline: document.querySelector("[data-invoice-logo-tagline]")?.value || ""
    },
    layout: {
      ...layout,
      headerStyle: document.querySelector("[data-invoice-header-style]")?.value || layout.headerStyle || "classic",
      tableStyle: document.querySelector("[data-invoice-table-style]")?.value || layout.tableStyle || "striped",
      totalStyle: document.querySelector("[data-invoice-total-style]")?.value || layout.totalStyle || "card",
      borderStyle: document.querySelector("[data-invoice-border-style]")?.value || layout.borderStyle || "soft",
      marginScale: Number(document.querySelector("[data-invoice-margin-scale]")?.value || layout.marginScale || 100)
    },
    typography: {
      ...typography,
      fontScale
    },
    footer: {
      ...footer,
      note: document.querySelector("[data-invoice-footer-note]")?.value || "",
      terms: document.querySelector("[data-invoice-payment-terms]")?.value || "",
      showSignature: footerSignatureControl?.checked !== false,
      showThankYou: document.querySelector("[data-invoice-footer-thanks]")?.checked === true
    }
  };
  invoicePrintDraft.showFields = invoicePrintDraft.showFields || {};
  document.querySelectorAll("[data-invoice-print-field]").forEach((input) => {
    invoicePrintDraft.showFields[input.dataset.invoicePrintField] = input.checked;
  });
  invoicePrintDraft.showFields.signature = invoicePrintDraft.designer.footer.showSignature !== false;
  invoicePrintDraft.perDocumentType = invoicePrintDraft.perDocumentType || {};
  invoicePrintDraft.perDocumentType[activeInvoicePrintDocument] = { template, paperSize, density };
  renderInvoicePrintPreview();
}

function applyInvoiceDesignerPreset(name) {
  const preset = invoiceDesignerPresets[name];
  if (!preset) return;
  updateInvoicePrintDraftFromControls();
  invoicePrintDraft = mergeInvoiceDesignerPatch(invoicePrintDraft, preset);
  const template = preset.defaultTemplate || invoicePrintDraft.defaultTemplate;
  const paperSize = preset.paperSize || invoicePrintDraft.paperSize;
  const density = preset.density || invoicePrintDraft.density;
  invoicePrintDraft.defaultTemplate = template;
  invoicePrintDraft.paperSize = paperSize;
  invoicePrintDraft.density = density;
  invoicePrintDraft.perDocumentType = invoicePrintDraft.perDocumentType || {};
  invoicePrintDraft.perDocumentType[activeInvoicePrintDocument] = { template, paperSize, density };
  syncInvoicePrintControls();
}

function resetInvoiceDesigner() {
  updateInvoicePrintDraftFromControls();
  const savedImage = invoicePrintDraft?.designer?.brand?.logoImageDataUrl || "";
  invoicePrintDraft = mergeInvoiceDesignerPatch(invoicePrintDraft, {
    designer: {
      ...cloneInvoiceDesignerDefaults(),
      brand: {
        ...invoiceDesignerDefaults.brand,
        logoImageDataUrl: savedImage
      }
    },
    logoMode: "mark",
    fontScale: 100
  });
  syncInvoicePrintControls();
}

function handleInvoiceLogoUpload(file) {
  if (!file) return;
  const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
  const status = document.querySelector("[data-invoice-logo-upload-status]");
  if (!allowedTypes.includes(file.type)) {
    if (status) status.textContent = "صيغة غير مدعومة";
    notify("صيغة الشعار غير مدعومة. استخدم PNG أو JPG أو SVG.", "error");
    return;
  }
  if (file.size > invoiceLogoMaxBytes) {
    if (status) status.textContent = "الملف أكبر من 300KB";
    notify("حجم الشعار كبير. الحد الأعلى 300KB حتى تبقى الفاتورة سريعة.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    updateInvoicePrintDraftFromControls();
    invoicePrintDraft = cloneInvoicePrintSettings(invoicePrintDraft || {});
    invoicePrintDraft.designer.brand.logoImageDataUrl = String(reader.result || "");
    invoicePrintDraft.designer.brand.logoSource = "uploaded";
    invoicePrintDraft.logoMode = "mark";
    if (status) status.textContent = "تم حفظ الشعار في المعاينة";
    syncInvoicePrintControls();
  };
  reader.onerror = () => {
    if (status) status.textContent = "تعذر قراءة الصورة";
    notify("تعذر قراءة ملف الشعار.", "error");
  };
  reader.readAsDataURL(file);
}

function updateInvoicePrintSummary(state) {
  const summaries = document.querySelectorAll("[data-invoice-print-summary]");
  if (!summaries.length) return;
  const settings = state.invoicePrintSettings || {};
  const template = settings.perDocumentType?.saleInvoice?.template || settings.defaultTemplate || "official-a4";
  summaries.forEach((summary) => {
    summary.textContent = invoicePrintLabels()[template] || template;
  });
}

function openInvoicePrintDrawer() {
  closeSettingsPopovers();
  invoicePrintDraft = cloneInvoicePrintSettings(ToxStore.getState().invoicePrintSettings || {});
  document.querySelector("[data-invoice-print-drawer]")?.classList.remove("hidden");
  syncInvoicePrintControls();
}

function closeInvoicePrintDrawer() {
  document.querySelector("[data-invoice-print-drawer]")?.classList.add("hidden");
}

function openInstallmentProfitDrawer() {
  closeSettingsPopovers();
  document.querySelector("[data-installment-profit-drawer]")?.classList.remove("hidden");
  syncInstallmentProfitControls(ToxStore.getState());
}

function closeInstallmentProfitDrawer() {
  document.querySelector("[data-installment-profit-drawer]")?.classList.add("hidden");
}

function installmentProfitSettings(state) {
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

function moneyInputValue(amountUsd, state) {
  const amount = ToxStore.convertUsd(Number(amountUsd || 0), state.currency);
  return String(amount);
}

function updateInstallmentProfitSummary(state) {
  const summary = document.querySelector("[data-installment-profit-summary]");
  if (!summary) return;
  const settings = installmentProfitSettings(state);
  summary.textContent = settings.defaultMode === "fixed"
    ? ToxStore.formatMoney(settings.defaultFixedAmountUsd, state.currency)
    : `${settings.defaultPercent}%`;
}

function productPricingSettings(state) {
  const source = state.productPricingSettings || {};
  return {
    allowSaleBelowCost: source.allowSaleBelowCost === true,
    lowMarginWarningPercent: Math.max(0, Number(source.lowMarginWarningPercent ?? 8))
  };
}

function syncProductPricingControls(state) {
  const settings = productPricingSettings(state);
  const summary = document.querySelector("[data-product-pricing-summary]");
  const toggle = document.querySelector("[data-settings-sale-loss-toggle]");
  if (summary) {
    summary.textContent = settings.allowSaleBelowCost ? "السماح بالبيع بخسارة" : "منع البيع بخسارة";
  }
  if (toggle) toggle.checked = settings.allowSaleBelowCost;
}

function syncInstallmentProfitControls(state) {
  const settings = installmentProfitSettings(state);
  const mode = document.querySelector("[data-installment-profit-default-mode]");
  const percent = document.querySelector("[data-settings-installment-profit-percent]");
  const fixed = document.querySelector("[data-settings-installment-profit-fixed]");
  const min = document.querySelector("[data-settings-installment-profit-min]");
  const max = document.querySelector("[data-settings-installment-profit-max]");
  const allowEdit = document.querySelector("[data-settings-installment-profit-allow-edit]");
  if (mode) mode.value = settings.defaultMode;
  if (percent) percent.value = String(settings.defaultPercent || 0);
  if (fixed) fixed.value = moneyInputValue(settings.defaultFixedAmountUsd, state);
  if (min) min.value = moneyInputValue(settings.minProfitAmountUsd, state);
  if (max) max.value = moneyInputValue(settings.maxProfitAmountUsd, state);
  if (allowEdit) allowEdit.checked = settings.allowEmployeeProfitEdit;
}

function saveInstallmentProfitSettings() {
  const state = ToxStore.getState();
  const mode = document.querySelector("[data-installment-profit-default-mode]")?.value === "fixed" ? "fixed" : "percent";
  const minProfitAmountUsd = Math.max(0, ToxStore.moneyToUsd(document.querySelector("[data-settings-installment-profit-min]")?.value || 0, state.currency));
  const maxProfitAmountUsd = Math.max(0, ToxStore.moneyToUsd(document.querySelector("[data-settings-installment-profit-max]")?.value || 0, state.currency));
  if (maxProfitAmountUsd > 0 && maxProfitAmountUsd + 0.0001 < minProfitAmountUsd) {
    notify(getLang() === "en" ? "Maximum profit must be greater than minimum profit" : "الحد الأعلى للربح يجب أن يكون أكبر من الحد الأدنى", "error");
    return;
  }
  ToxStore.setInstallmentProfitSettings?.({
    defaultMode: mode,
    defaultPercent: Math.max(0, Number(document.querySelector("[data-settings-installment-profit-percent]")?.value || 0)),
    defaultFixedAmountUsd: Math.max(0, ToxStore.moneyToUsd(document.querySelector("[data-settings-installment-profit-fixed]")?.value || 0, state.currency)),
    minProfitAmountUsd,
    maxProfitAmountUsd,
    allowEmployeeProfitEdit: document.querySelector("[data-settings-installment-profit-allow-edit]")?.checked !== false
  });
  notify(uiText("settingsSaved"), "success");
}

function roleLabel(role) {
  return roleLabels[getLang()]?.[role] || role || "-";
}

function logActionLabel(action) {
  return actionLabels[getLang()]?.[action] || action || "-";
}

function logEntityLabel(entityType) {
  return entityLabels[getLang()]?.[entityType] || entityType || "-";
}

function activeLabel(isActive) {
  return isActive ? text("active") : text("inactive");
}

function polishSettingsLabels(state) {
  document.querySelectorAll('[data-settings-language] option[value="ar"]').forEach((option) => {
    option.textContent = state.lang === "ar" ? "العربية" : "Arabic";
  });
  document.querySelectorAll('[data-settings-language] option[value="en"]').forEach((option) => {
    option.textContent = state.lang === "ar" ? "الإنجليزية" : "English";
  });
  document.querySelectorAll("[data-theme-label]").forEach((option) => {
    option.textContent = uiText(option.dataset.themeLabel);
  });
}

function updateThemeCopy(state) {
  const activeTheme = window.ToxThemes?.normalize ? window.ToxThemes.normalize(state.theme) : state.theme;
  const themeMeta = window.ToxThemes?.meta
    ? window.ToxThemes.meta(activeTheme)
    : { mode: ["noir", "matte-black", "graphite-lime", "violet-night"].includes(activeTheme) ? "dark" : "light", group: activeTheme === "tox-blue" || activeTheme === "noir" ? "primary" : "secondary-light", accent: "var(--primary)" };
  const modeKey = `${themeMeta.group === "primary" ? "Primary" : "Secondary"}${themeMeta.mode === "dark" ? "Dark" : "Light"}`;
  const themeKey = themeTextKey[activeTheme] || themeTextKey["tox-blue"];
  document.querySelectorAll("[data-theme-summary]").forEach((element) => {
    element.textContent = text(`themeSummary${themeKey}`);
  });
  document.querySelectorAll("[data-theme-mode-summary]").forEach((element) => {
    element.textContent = text(`themeMode${modeKey}`);
  });
  document.querySelectorAll("[data-theme-summary-chips]").forEach((element) => {
    element.dataset.themePreview = activeTheme;
    element.style.setProperty("--theme-preview-accent", themeMeta.accent || "var(--primary)");
  });
  document.querySelectorAll("[data-theme-detail]").forEach((element) => {
    element.textContent = text(`themeDetail${themeKey}`);
  });
}

function currentGuideSteps() {
  return settingsGuideSteps[getLang()] || settingsGuideSteps.ar;
}

function renderUsageGuide() {
  const guideSteps = currentGuideSteps();
  const step = guideSteps[guideStepIndex] || guideSteps[0];
  const title = document.querySelector("[data-guide-title]");
  const body = document.querySelector("[data-guide-body]");
  const kicker = document.querySelector("[data-guide-kicker]");
  const points = document.querySelector("[data-guide-points]");
  const steps = document.querySelector("[data-guide-steps]");
  const prev = document.querySelector("[data-guide-prev]");
  const next = document.querySelector("[data-guide-next]");
  if (!title || !body || !kicker || !points || !steps) return;

  kicker.textContent = text("stepProgress", { current: guideStepIndex + 1, total: guideSteps.length });
  title.textContent = step.title;
  body.textContent = step.body;
  points.innerHTML = step.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("");
  steps.innerHTML = guideSteps.map((entry, index) => `
    <button class="settings-guide-step ${index === guideStepIndex ? "active" : ""}" type="button" data-guide-step="${index}">
      <span>${index + 1}</span>
      <strong>${escapeHtml(entry.title)}</strong>
    </button>
  `).join("");
  steps.querySelectorAll("[data-guide-step]").forEach((button) => {
    button.addEventListener("click", () => {
      guideStepIndex = Number(button.dataset.guideStep || 0);
      renderUsageGuide();
    });
  });
  if (prev) prev.disabled = guideStepIndex === 0;
  if (next) next.textContent = guideStepIndex === guideSteps.length - 1 ? text("finish") : text("next");
}

function drawSessionCard() {
  const name = document.querySelector("[data-current-user-name]");
  const meta = document.querySelector("[data-current-user-meta]");
  if (!name || !meta) return;
  if (sessionLoadFailed) {
    name.textContent = text("sessionErrorTitle");
    meta.textContent = text("sessionErrorText");
    return;
  }
  if (!currentSessionAuthenticated || !currentSessionUser) {
    name.textContent = text("notSignedIn");
    meta.textContent = text("signInHint");
    return;
  }
  name.textContent = currentSessionUser.name || currentSessionUser.username || text("unknown");
  meta.textContent = [
    currentSessionUser.username || text("unknown"),
    roleLabel(currentSessionUser.role),
    currentSessionUser.isSuperuser ? text("superuser") : text("normalUser")
  ].join(" | ");
}

async function renderSessionCard() {
  try {
    const response = await apiFetch("/session/");
    const payload = await response.json();
    currentSessionUser = payload.user || null;
    currentSessionAuthenticated = Boolean(payload.authenticated && payload.user);
    sessionLoadFailed = false;
  } catch (error) {
    currentSessionUser = null;
    currentSessionAuthenticated = false;
    sessionLoadFailed = true;
  }
  drawSessionCard();
}

async function exportBackendBackup() {
  const response = await apiFetch("/backup/");
  if (!response.ok) throw new Error(`Backup export failed: ${response.status}`);
  const raw = await response.arrayBuffer();
  const blob = new Blob([raw], { type: "application/json" });
  downloadBlob(blob, `tox-backup-${new Date().toISOString().slice(0, 10)}.json`);
  notify(text("backupExported"), "success");
}

async function exportFullBackupBeforeReset() {
  const response = await apiFetch("/backup/");
  if (!response.ok) throw new Error(`Backup export failed: ${response.status}`);
  const raw = await response.arrayBuffer();
  const blob = new Blob([raw], { type: "application/json" });
  downloadBlob(blob, `tox-backup-${localDateTimeStamp()}.json`);
  recordFullBackupExport();
  notify(text("fullBackupExported"), "success");
}

const backupRestoreReasonText = {
  ar: {
    CHECKSUM_FAILED: "النسخة تغيرت أو تلفت. استخدم ملف النسخة الأصلي بدون تعديل.",
    UNSUPPORTED_BACKUP: "إصدار النسخة غير مدعوم من هذا الإصدار.",
    INVALID_BACKUP: "ملف النسخة غير صحيح.",
    INVALID_ZIP: "ملف ZIP غير صحيح.",
    ZIP_BACKUP_DISABLED: "استرجاع ZIP متوقف. استخدم ملف JSON فقط.",
    LEGACY_BACKUP_DISABLED: "هذه نسخة قديمة/محلية غير مدعومة. صدّر نسخة JSON موحدة جديدة من صفحة النسخ.",
    BACKUP_FILES_MISSING: "النسخة ناقصة ملفات مطلوبة.",
    BACKUP_SCHEMA_MISMATCH: "جداول أو حقول النسخة لا تطابق إصدار النظام الحالي.",
    BACKUP_ADMIN_MISSING: "النسخة لا تحتوي مستخدم مدير فعال.",
    INVALID_DATABASE_PAYLOAD: "بيانات قاعدة البيانات داخل النسخة غير صالحة.",
    SQLITE_INTEGRITY_FAILED: "قاعدة البيانات داخل النسخة غير سليمة.",
    DATABASE_RESTORE_FAILED: "تعذر كتابة قاعدة البيانات. أغلق نوافذ TOX الأخرى وحاول مرة ثانية.",
    EMPTY_BACKUP: "ملف النسخة فارغ.",
    PAYLOAD_TOO_LARGE: "حجم ملف النسخة أكبر من الحد المسموح. ارفع حد الرفع أو صدّر نسخة أصغر ثم حاول مرة ثانية.",
    STATE_CHECKSUM_RECOVERED: "تم إنقاذ النسخة من قاعدة البيانات؛ بيانات العرض داخل الملف تغيرت أثناء التنزيل.",
    CONFIG_CHECKSUM_RECOVERED: "تم إنقاذ النسخة من قاعدة البيانات؛ إعدادات العرض داخل الملف تغيرت أثناء التنزيل."
  },
  en: {
    CHECKSUM_FAILED: "The backup was changed or damaged. Use the original backup file.",
    UNSUPPORTED_BACKUP: "This backup version is not supported by this app version.",
    INVALID_BACKUP: "The backup file is invalid.",
    INVALID_ZIP: "The ZIP backup file is invalid.",
    ZIP_BACKUP_DISABLED: "ZIP restore is disabled. Use a JSON backup file only.",
    LEGACY_BACKUP_DISABLED: "This legacy/local backup is not supported. Export a new unified JSON backup.",
    BACKUP_FILES_MISSING: "The backup is missing required files.",
    BACKUP_SCHEMA_MISMATCH: "The backup schema does not match this app version.",
    BACKUP_ADMIN_MISSING: "The backup does not contain an active admin user.",
    INVALID_DATABASE_PAYLOAD: "The backup database payload is invalid.",
    SQLITE_INTEGRITY_FAILED: "The database inside the backup failed integrity checks.",
    DATABASE_RESTORE_FAILED: "Could not write the database. Close other TOX windows and try again.",
    EMPTY_BACKUP: "The backup file is empty.",
    PAYLOAD_TOO_LARGE: "The backup file is larger than the allowed upload limit.",
    STATE_CHECKSUM_RECOVERED: "The backup was recovered from the database; display state changed during download.",
    CONFIG_CHECKSUM_RECOVERED: "The backup was recovered from the database; display config changed during download."
  }
};

function formatBackupBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function backupRestoreErrorText(payload = {}, fallback = "") {
  const lang = getLang();
  const reason = payload.reason || payload.code || "";
  const mapped = backupRestoreReasonText[lang]?.[reason] || backupRestoreReasonText.en[reason] || "";
  const details = payload.details && typeof payload.details === "object"
    ? Object.entries(payload.details).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" | ")
    : "";
  const sizeDetails = payload.limitBytes
    ? `${lang === "ar" ? "الحد" : "limit"}: ${formatBackupBytes(payload.limitBytes)} | ${lang === "ar" ? "الملف" : "file"}: ${formatBackupBytes(payload.providedBytes || 0)}`
    : "";
  const steps = Array.isArray(payload.recoverySteps) ? payload.recoverySteps.join(" | ") : "";
  return [mapped || payload.messageAr || payload.message || reason || fallback, sizeDetails, details, steps].filter(Boolean).join(" - ");
}

async function backupResponseError(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  return new Error(backupRestoreErrorText(payload, fallback || `Restore failed: ${response.status}`));
}

function restoreReportErrorText(restored) {
  const firstError = restored?.restoreReport?.errors?.[0];
  if (!firstError) return "";
  return firstError.message || firstError.code || firstError.reason || "";
}

function backupWarningText(warnings = []) {
  const lang = getLang();
  return (warnings || []).map((item) => {
    const code = item.code || "";
    return backupRestoreReasonText[lang]?.[code] || backupRestoreReasonText.en[code] || item.message || code;
  }).filter(Boolean).join(" | ");
}

function backupPreviewText(verified = {}, file = null) {
  const ar = getLang() !== "en";
  const backup = verified.backup || {};
  const counts = backup.recordCounts || {};
  const countLine = [
    ["auth_user", ar ? "المستخدمون" : "users"],
    ["erp_warehouse", ar ? "المخازن" : "warehouses"],
    ["erp_product", ar ? "المنتجات" : "products"],
    ["erp_invoice", ar ? "الفواتير" : "invoices"],
    ["erp_client", ar ? "العملاء" : "clients"],
    ["erp_supplier", ar ? "الموردون" : "suppliers"]
  ].filter(([key]) => counts[key] !== undefined)
    .map(([key, label]) => `${label}: ${counts[key]}`)
    .join(" | ");
  return [
    ar ? "تم فحص النسخة بنجاح." : "Backup verification passed.",
    `${ar ? "الملف" : "File"}: ${file?.name || "-"}`,
    `${ar ? "النوع" : "Format"}: ${backup.format || "-"}`,
    `${ar ? "الإصدار" : "Version"}: ${backup.version ?? "-"}`,
    countLine,
    ar ? "هل تريد تطبيق الاسترجاع النهائي الآن؟" : "Apply the final restore now?"
  ].filter(Boolean).join("\n");
}

function reloadWithCacheBuster() {
  const target = `${window.location.pathname}?restored=${Date.now()}${window.location.hash || ""}`;
  window.location.replace(target);
}

async function restoreBackendBackup(file) {
  if (!file) return;
  try {
    let response;
    if (/\.zip$/i.test(file.name || "")) throw new Error(backupRestoreErrorText({ reason: "ZIP_BACKUP_DISABLED" }));
    const rawText = await file.text();
    const parsed = JSON.parse(rawText);
    if (!parsed?.manifest || parsed.manifest.format !== "tox-json-full-backup" || !parsed.databaseBase64) {
      throw new Error(backupRestoreErrorText({ reason: "LEGACY_BACKUP_DISABLED" }));
    }
    const verifyResponse = await apiFetch("/backup/verify/", {
        method: "POST",
        body: rawText,
        headers: { "Content-Type": "application/json" }
      });
    const verified = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok) throw await backupResponseError({ ...verifyResponse, json: async () => verified }, `Verify failed: ${verifyResponse.status}`);
    if (!window.confirm(backupPreviewText(verified, file))) return;
    response = await apiFetch("/backup/restore/", {
        method: "POST",
        body: rawText,
        headers: { "Content-Type": "application/json" }
      });
    const restored = await response.json().catch(() => ({}));
    if (!response.ok) throw await backupResponseError({ ...response, json: async () => restored }, `Restore failed: ${response.status}`);
    if (restored.restoreHasErrors) throw new Error(restoreReportErrorText(restored) || backupRestoreErrorText(restored, "Restore finished with errors"));
    ToxStore.applySystemReset?.(restored);
    await ToxStore.refreshFromBackend?.();
    if (restored.warnings?.length) notify(backupWarningText(restored.warnings), "warning");
    notify(text("backupRestored"), "success");
    window.setTimeout(reloadWithCacheBuster, 700);
  } catch (error) {
    console.warn("Backup restore failed", error);
    notify(`${text("backupRestoreError")}: ${error.message || ""}`, "error");
  }
}

async function executeSystemReset(adminPassword = "") {
  try {
    const response = await apiFetch("/system/reset/", {
      method: "POST",
      body: JSON.stringify({
        confirmation: "RESET",
        adminPassword,
        preserveSettings: true
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.reason || `Reset failed: ${response.status}`);
    }
    if (typeof ToxStore !== "undefined" && ToxStore.applySystemReset) {
      ToxStore.applySystemReset(payload);
    }
    notify(text("resetDone"), "success");
    renderUsers();
    renderAuditLogs();
    window.setTimeout(reloadWithCacheBuster, 700);
    return true;
  } catch (error) {
    console.warn("System reset failed", error);
    const ar = getLang() !== "en";
    const reason = String(error.message || "");
    const message = reason === "INVALID_ADMIN_PASSWORD"
      ? (ar ? "كلمة سر المدير غير صحيحة." : "The admin password is incorrect.")
      : reason === "ADMIN_PASSWORD_REQUIRED"
        ? (ar ? "اكتب كلمة سر المدير قبل التصفير." : "Enter the admin password before resetting.")
        : text("resetError");
    notify(message, "error");
    return false;
  }
}

function openSystemResetPasswordModal(backupNotice) {
  document.querySelector("[data-reset-password-modal-root]")?.remove();
  const ar = getLang() !== "en";
  const root = document.createElement("div");
  root.className = "client-modal-shell";
  root.dataset.resetPasswordModalRoot = "true";
  root.innerHTML = `
    <div class="client-modal-backdrop" data-close-reset-password></div>
    <form class="client-pay-modal client-create-modal" data-reset-password-form>
      <header>
        <span>${ar ? "تحذير نهائي" : "Final warning"}</span>
        <h2>${escapeHtml(text("resetTitle"))}</h2>
        <button class="button ghost compact-action" type="button" data-close-reset-password>${ar ? "إغلاق" : "Close"}</button>
      </header>
      <section class="client-modal-summary">
        <div><span>${escapeHtml(text("resetText"))}</span><strong>${ar ? "لا يمكن التراجع بعد التصفير" : "This cannot be undone after reset"}</strong></div>
        <div><span>${escapeHtml(backupNotice)}</span><strong>${ar ? "احتفظ بالنسخة قبل المتابعة" : "Keep the backup before continuing"}</strong></div>
      </section>
      <div class="client-modal-grid">
        <label class="wide"><span>${ar ? "كلمة سر المدير" : "Admin password"}</span><input type="password" name="adminPassword" autocomplete="current-password" required /></label>
        <label class="wide"><span>${ar ? "اكتب RESET للتأكيد" : "Type RESET to confirm"}</span><input type="text" name="confirmation" required /></label>
      </div>
      <div class="drawer-actions">
        <button class="button ghost" type="button" data-close-reset-password>${ar ? "إلغاء" : "Cancel"}</button>
        <button class="button danger" type="submit">${ar ? "تصفير النظام" : "Reset system"}</button>
      </div>
    </form>
  `;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.querySelectorAll("[data-close-reset-password]").forEach((item) => item.addEventListener("click", close));
  root.querySelector("[data-reset-password-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const confirmation = String(new FormData(form).get("confirmation") || "").trim();
    if (confirmation !== "RESET") {
      notify(ar ? "اكتب RESET للتأكيد قبل التصفير." : "Type RESET before resetting.", "error");
      return;
    }
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    const ok = await executeSystemReset(String(new FormData(form).get("adminPassword") || ""));
    button.disabled = false;
    if (ok) close();
  });
  root.querySelector("input[name='adminPassword']")?.focus();
}

async function confirmSystemReset() {
  let backupNotice = text("fullBackupResetReady");
  try {
    notify(text("fullBackupExporting"), "info");
    await exportFullBackupBeforeReset();
  } catch (error) {
    console.warn("Full backup before reset failed", error);
    backupNotice = text("fullBackupResetWarning");
    notify(backupNotice, "warning");
  }
  openSystemResetPasswordModal(backupNotice);
}

function drawAuditLogs(logs = []) {
  const list = document.querySelector("[data-audit-log-list]");
  if (!list) return;
  list.innerHTML = logs.length
    ? logs.slice(0, 20).map((log) => {
      const action = logActionLabel(log.action);
      const entity = logEntityLabel(log.entityType);
      const mainText = getLang() === "en"
        ? [action, entity !== "-" ? entity : ""].filter(Boolean).join(" ")
        : repairedText(log.message || action);
      const entitySuffix = log.entityId ? ` | ${escapeHtml(log.entityId)}` : "";
      return `
        <div class="ledger-item settings-log-row">
          <span class="settings-log-badge">${escapeHtml(action)}</span>
          <span class="settings-log-main">
            <strong>${escapeHtml(mainText || action)}</strong>
            <small>${escapeHtml(entity)}${entitySuffix}</small>
          </span>
          <span class="settings-log-meta">
            <strong>${dateTime(log.createdAt)}</strong>
          </span>
        </div>
      `;
    }).join("")
    : `<div class="warehouse-empty">${escapeHtml(text("noAuditLogs"))}</div>`;
}

async function renderAuditLogs() {
  const list = document.querySelector("[data-audit-log-list]");
  if (!list) return;
  try {
    const response = await apiFetch("/audit/");
    if (!response.ok) throw new Error(`Audit load failed: ${response.status}`);
    lastAuditLogs = (await response.json()).logs || [];
    drawAuditLogs(lastAuditLogs);
  } catch (error) {
    lastAuditLogs = null;
    list.innerHTML = `<div class="warehouse-empty">${escapeHtml(text("auditLoadError"))}</div>`;
  }
}

function drawUsers(users = []) {
  const list = document.querySelector("[data-users-list]");
  if (!list) return;
  list.innerHTML = users.length
    ? users.map((user) => `
      <div class="ledger-item settings-user-row">
        <span>
          <strong>${escapeHtml(user.name || user.username || text("unknown"))}</strong>
          <br><small>${escapeHtml(user.username || text("unknown"))} | ${escapeHtml(roleLabel(user.role))} | ${escapeHtml(activeLabel(user.isActive))}</small>
        </span>
        <span class="toolbar">
          <select data-change-user-role="${escapeHtml(user.id)}">
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>${escapeHtml(roleLabel("admin"))}</option>
            <option value="cashier" ${user.role === "cashier" ? "selected" : ""}>${escapeHtml(roleLabel("cashier"))}</option>
            <option value="warehouse" ${user.role === "warehouse" ? "selected" : ""}>${escapeHtml(roleLabel("warehouse"))}</option>
            <option value="accountant" ${user.role === "accountant" ? "selected" : ""}>${escapeHtml(roleLabel("accountant"))}</option>
          </select>
          <button class="button ghost" type="button" data-toggle-user="${escapeHtml(user.id)}" data-active="${user.isActive ? "1" : "0"}">${escapeHtml(user.isActive ? text("disableUser") : text("enableUser"))}</button>
        </span>
      </div>
    `).join("")
    : `<div class="warehouse-empty">${escapeHtml(text("noUsers"))}</div>`;
  list.querySelectorAll("[data-change-user-role]").forEach((select) => {
    select.addEventListener("change", () => updateUser(select.dataset.changeUserRole, { role: select.value }));
  });
  list.querySelectorAll("[data-toggle-user]").forEach((button) => {
    button.addEventListener("click", () => updateUser(button.dataset.toggleUser, { isActive: button.dataset.active !== "1" }));
  });
}

async function renderUsers() {
  const list = document.querySelector("[data-users-list]");
  if (!list) return;
  try {
    const response = await apiFetch("/users/");
    if (!response.ok) throw new Error(`Users load failed: ${response.status}`);
    lastUsers = (await response.json()).users || [];
    drawUsers(lastUsers);
  } catch (error) {
    lastUsers = null;
    list.innerHTML = `<div class="warehouse-empty">${escapeHtml(text("usersLoadError"))}</div>`;
  }
}

async function updateUser(userId, patch) {
  try {
    const response = await apiFetch(`/users/${userId}/`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    if (!response.ok) throw new Error(`User update failed: ${response.status}`);
    notify(text("userUpdated"), "success");
    renderUsers();
    renderAuditLogs();
  } catch (error) {
    notify(text("userUpdateError"), "error");
  }
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    name: form.querySelector("[data-user-name]")?.value || "",
    username: form.querySelector("[data-user-username]")?.value || "",
    password: form.querySelector("[data-user-password]")?.value || "",
    role: form.querySelector("[data-user-role]")?.value || "cashier"
  };
  try {
    const response = await apiFetch("/users/", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`User create failed: ${response.status}`);
    form.reset();
    window.ToxSelects?.update?.();
    notify(text("userCreated"), "success");
    renderUsers();
    renderAuditLogs();
  } catch (error) {
    notify(text("userCreateError"), "error");
  }
}

function drawLoginEvents(events = []) {
  const list = document.querySelector("[data-login-events-list]");
  if (!list) return;
  list.innerHTML = events.length
    ? events.slice(0, 30).map((event) => `
      <div class="ledger-item settings-log-row">
        <span class="settings-log-badge">${escapeHtml(event.event === "logout" ? text("logout") : text("login"))}</span>
        <span class="settings-log-main">
          <strong>${escapeHtml(event.username || "-")}</strong>
          <small>${escapeHtml(event.ipAddress || text("ipUnknown"))}</small>
        </span>
        <span class="settings-log-meta">
          <strong>${dateTime(event.createdAt)}</strong>
        </span>
      </div>
    `).join("")
    : `<div class="warehouse-empty">${escapeHtml(text("noLoginEvents"))}</div>`;
}

async function renderLoginEvents() {
  const list = document.querySelector("[data-login-events-list]");
  if (!list) return;
  try {
    const response = await apiFetch("/login-events/");
    if (!response.ok) throw new Error(`Login events failed: ${response.status}`);
    lastLoginEvents = (await response.json()).events || [];
    drawLoginEvents(lastLoginEvents);
  } catch (error) {
    lastLoginEvents = null;
    list.innerHTML = `<div class="warehouse-empty">${escapeHtml(text("loginEventsLoadError"))}</div>`;
  }
}

function syncSettingsCopy(state) {
  polishSettingsLabels(state);
  updateThemeCopy(state);
  updateInvoicePrintSummary(state);
  updateInstallmentProfitSummary(state);
  syncProductPricingControls(state);
  drawSessionCard();
  if (!document.querySelector("[data-usage-guide-modal]")?.classList.contains("hidden")) {
    renderUsageGuide();
  }
  if (lastAuditLogs) drawAuditLogs(lastAuditLogs);
  if (lastLoginEvents) drawLoginEvents(lastLoginEvents);
  if (lastUsers) drawUsers(lastUsers);
  if (!document.querySelector("[data-invoice-print-drawer]")?.classList.contains("hidden")) {
    renderInvoicePrintPreview();
  }
  if (!document.querySelector("[data-installment-profit-drawer]")?.classList.contains("hidden")) {
    syncInstallmentProfitControls(state);
  }
}

document.querySelectorAll("[data-export-backup]").forEach((button) => {
  button.addEventListener("click", () => {
    exportBackendBackup().catch((error) => {
      console.warn("Backup export failed", error);
      notify(error.message || text("backupRestoreError"), "error");
    });
  });
});
document.querySelectorAll("[data-restore-backup]").forEach((input) => {
  input.addEventListener("change", (event) => {
    restoreBackendBackup(event.target.files?.[0]).finally(() => {
      event.target.value = "";
    });
  });
});
document.querySelector("[data-system-reset]")?.addEventListener("click", confirmSystemReset);
document.querySelector("[data-refresh-audit]")?.addEventListener("click", renderAuditLogs);
document.querySelector("[data-refresh-users]")?.addEventListener("click", renderUsers);
document.querySelector("[data-refresh-login-events]")?.addEventListener("click", renderLoginEvents);
document.querySelector("[data-user-form]")?.addEventListener("submit", createUser);

document.querySelectorAll("[data-settings-popover-trigger]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettingsPopover(button.dataset.settingsPopoverTrigger, button);
  });
});

document.querySelectorAll("[data-settings-popover]").forEach((popover) => {
  popover.addEventListener("click", (event) => event.stopPropagation());
  popover.addEventListener("scroll", (event) => event.stopPropagation());
  popover.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
});

document.addEventListener("click", () => closeSettingsPopovers());
window.addEventListener("resize", () => closeSettingsPopovers());
window.addEventListener("scroll", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest("[data-settings-popover]")) return;
  closeSettingsPopovers();
}, true);

document.querySelectorAll("[data-open-business-drawer]").forEach((button) => {
  button.addEventListener("click", openBusinessDrawer);
});
document.querySelectorAll("[data-close-business-drawer]").forEach((button) => {
  button.addEventListener("click", closeBusinessDrawer);
});
document.querySelector("[data-save-business-profile]")?.addEventListener("click", saveBusinessProfile);
document.querySelectorAll("[data-open-invoice-print-drawer]").forEach((button) => {
  button.addEventListener("click", openInvoicePrintDrawer);
});
document.querySelectorAll("[data-close-invoice-print-drawer]").forEach((button) => {
  button.addEventListener("click", closeInvoicePrintDrawer);
});
document.querySelectorAll("[data-open-installment-profit-drawer]").forEach((button) => {
  button.addEventListener("click", openInstallmentProfitDrawer);
});
document.querySelectorAll("[data-close-installment-profit-drawer]").forEach((button) => {
  button.addEventListener("click", closeInstallmentProfitDrawer);
});
document.querySelector("[data-save-installment-profit-settings]")?.addEventListener("click", saveInstallmentProfitSettings);
document.querySelector("[data-settings-sale-loss-toggle]")?.addEventListener("change", (event) => {
  ToxStore.setProductPricingSettings?.({
    allowSaleBelowCost: event.currentTarget.checked,
    lowMarginWarningPercent: productPricingSettings(ToxStore.getState()).lowMarginWarningPercent
  });
  notify(uiText("settingsSaved"), "success");
});
document.querySelector("[data-invoice-print-document]")?.addEventListener("change", (event) => {
  updateInvoicePrintDraftFromControls();
  activeInvoicePrintDocument = event.target.value || "saleInvoice";
  syncInvoicePrintControls();
});
document.querySelectorAll([
  "[data-invoice-print-template]",
  "[data-invoice-print-paper]",
  "[data-invoice-print-density]",
  "[data-invoice-print-accent]",
  "[data-invoice-print-font]",
  "[data-invoice-print-logo]",
  "[data-invoice-print-field]",
  "[data-invoice-logo-source]",
  "[data-invoice-logo-shape]",
  "[data-invoice-logo-position]",
  "[data-invoice-logo-size]",
  "[data-invoice-logo-opacity]",
  "[data-invoice-logo-business-name]",
  "[data-invoice-logo-tagline]",
  "[data-invoice-header-style]",
  "[data-invoice-table-style]",
  "[data-invoice-total-style]",
  "[data-invoice-border-style]",
  "[data-invoice-margin-scale]",
  "[data-invoice-footer-note]",
  "[data-invoice-payment-terms]",
  "[data-invoice-footer-signature]",
  "[data-invoice-footer-thanks]"
].join(",")).forEach((input) => {
  input.addEventListener("input", updateInvoicePrintDraftFromControls);
  input.addEventListener("change", updateInvoicePrintDraftFromControls);
});
document.querySelector("[data-invoice-logo-upload]")?.addEventListener("change", (event) => {
  handleInvoiceLogoUpload(event.target.files?.[0]);
  event.target.value = "";
});
document.querySelectorAll("[data-invoice-designer-preset]").forEach((button) => {
  button.addEventListener("click", () => applyInvoiceDesignerPreset(button.dataset.invoiceDesignerPreset));
});
document.querySelector("[data-invoice-designer-reset]")?.addEventListener("click", resetInvoiceDesigner);
document.querySelector("[data-save-invoice-print-settings]")?.addEventListener("click", () => {
  updateInvoicePrintDraftFromControls();
  ToxStore.setInvoicePrintSettings(invoicePrintDraft);
  notify(uiText("settingsSaved"), "success");
});
document.querySelector("[data-print-invoice-preview]")?.addEventListener("click", () => {
  updateInvoicePrintDraftFromControls();
  const state = stateWithInvoicePrintDraft();
  window.ToxPrint?.render?.(activeInvoicePrintDocument, sampleInvoicePrintRecord(activeInvoicePrintDocument, state), state);
});

document.querySelectorAll("[data-open-login-events]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-login-events-modal]")?.classList.remove("hidden");
    renderLoginEvents();
  });
});

document.querySelectorAll("[data-close-login-events]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-login-events-modal]")?.classList.add("hidden");
  });
});

document.querySelectorAll("[data-open-audit-log]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-audit-log-modal]")?.classList.remove("hidden");
    renderAuditLogs();
  });
});

document.querySelectorAll("[data-close-audit-log]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-audit-log-modal]")?.classList.add("hidden");
  });
});

document.querySelectorAll("[data-open-usage-guide]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-usage-guide-modal]")?.classList.remove("hidden");
    renderUsageGuide();
  });
});

document.querySelectorAll("[data-close-usage-guide]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-usage-guide-modal]")?.classList.add("hidden");
  });
});

document.querySelector("[data-guide-prev]")?.addEventListener("click", () => {
  guideStepIndex = Math.max(0, guideStepIndex - 1);
  renderUsageGuide();
});

document.querySelector("[data-guide-next]")?.addEventListener("click", () => {
  if (guideStepIndex >= currentGuideSteps().length - 1) {
    document.querySelector("[data-usage-guide-modal]")?.classList.add("hidden");
    guideStepIndex = 0;
    renderUsageGuide();
    return;
  }
  guideStepIndex += 1;
  renderUsageGuide();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettingsPopovers();
    closeBusinessDrawer();
    closeInvoicePrintDrawer();
    closeInstallmentProfitDrawer();
    document.querySelector("[data-usage-guide-modal]")?.classList.add("hidden");
    document.querySelector("[data-login-events-modal]")?.classList.add("hidden");
    document.querySelector("[data-audit-log-modal]")?.classList.add("hidden");
  }
});

document.querySelector("[data-logout]")?.addEventListener("click", async () => {
  if (window.ToxAuth?.logout) {
    await window.ToxAuth.logout();
    return;
  }
  try {
    await apiFetch("/auth/logout/", { method: "POST" });
  } catch (error) {
    console.warn("Backend logout unavailable; clearing local session.", error);
  }
  sessionStorage.removeItem("tox-authenticated");
  sessionStorage.removeItem("tox-session-user");
  window.location.href = "../index.html";
});

ToxStore.subscribe(syncSettingsCopy);
renderSessionCard();
