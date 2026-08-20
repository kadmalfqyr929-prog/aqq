const employeesApiBase = window.ToxApi?.baseUrl?.() || `${window.location.origin.includes(":5500") ? "http://127.0.0.1:8765" : ""}/api`;

const employeeSearch = document.querySelector("[data-employee-search]");
const employeesList = document.querySelector("[data-employees-list]");
const modalShell = document.querySelector("[data-employee-modal-shell]");
const profilePanel = document.querySelector("[data-employee-profile]");
const permissionsPanel = document.querySelector("[data-employee-permissions-panel]");
const activityPanel = document.querySelector("[data-employee-activity-panel]");

const employeeState = {
  users: [],
  filter: "all",
  selectedUserId: "",
  loading: false,
  modal: {
    open: false,
    mode: "create",
    step: "details",
    userId: null,
    draft: {},
    permissions: {},
    message: "",
    tone: "info",
    saving: false,
  },
};

const roleOptions = [
  ["cashier", "كاشير"],
  ["accountant", "محاسب"],
  ["warehouse", "مسؤول مخازن"],
  ["admin", "مدير النظام"],
];

const permissionGroups = [
  ["النظام", [
    ["dashboard.open", "فتح المركز الرئيسي"],
  ]],
  ["المبيعات", [
    ["sales.open", "فتح صفحة المبيعات"],
    ["sales.create_invoice", "إنشاء فاتورة"],
    ["sales.installments", "بيع بالأقساط"],
    ["sales.edit_installment_profit", "تعديل ربح الأقساط"],
    ["sales.edit_invoice", "تعديل فاتورة"],
    ["sales.delete_invoice", "حذف أو إلغاء فاتورة"],
    ["sales.print_invoice", "طباعة فاتورة"],
  ]],
  ["المشتريات", [
    ["purchase.open", "فتح صفحة المشتريات"],
    ["purchase.create_invoice", "إنشاء فاتورة شراء"],
    ["purchase.delete_invoice", "إلغاء فاتورة شراء"],
    ["purchase.return", "مرتجعات شراء"],
  ]],
  ["المخازن", [
    ["warehouse.open", "فتح صفحة المخازن"],
    ["warehouse.add_product", "إضافة منتج"],
    ["warehouse.edit_product", "تعديل منتج"],
    ["warehouse.delete_product", "حذف منتج"],
    ["warehouse.view_quantities", "مشاهدة الكميات"],
    ["warehouse.print_labels", "طباعة ملصقات المنتجات"],
  ]],
  ["الحسابات", [
    ["accounts.view_profits", "عرض الأرباح"],
    ["accounts.view_expenses", "عرض المصروفات"],
    ["accounts.manage_debts", "إدارة الديون"],
    ["accounts.open", "فتح صفحة المالية"],
  ]],
  ["الإدارة", [
    ["admin.manage_employees", "إدارة الموظفين"],
    ["admin.settings", "التحكم بالإعدادات"],
    ["admin.backup", "النسخ الاحتياطي"],
    ["admin.manage_permissions", "إدارة الصلاحيات"],
  ]],
];

const allPermissionCodes = permissionGroups.flatMap(([, items]) => items.map(([code]) => code));

const roleDefaultPermissions = {
  admin: allPermissionCodes,
  cashier: ["dashboard.open", "sales.open", "sales.create_invoice", "sales.installments", "sales.edit_installment_profit", "sales.edit_invoice", "sales.print_invoice"],
  warehouse: ["dashboard.open", "warehouse.open", "warehouse.add_product", "warehouse.edit_product", "warehouse.delete_product", "warehouse.view_quantities", "warehouse.print_labels"],
  accountant: ["dashboard.open", "accounts.open", "accounts.view_profits", "accounts.view_expenses", "accounts.manage_debts", "sales.open", "sales.print_invoice"],
};

const text = {
  loading: "جاري تحميل بيانات الموظفين...",
  empty: "لا توجد حسابات موظفين مطابقة.",
  noSelection: "اختر موظفًا من القائمة لعرض الملف الكامل والصلاحيات وسجل الرواتب.",
  noPayroll: "لم يتم تسجيل أي دفعة راتب لهذا الموظف بعد.",
  noActivity: "لا توجد أحداث دخول أو خروج مسجلة لهذا الحساب حتى الآن.",
  createSuccess: "تم إنشاء حساب الموظف بنجاح.",
  updateSuccess: "تم تحديث بيانات الموظف بنجاح.",
  statusSuccess: "تم تحديث حالة الحساب.",
  deleteSuccess: "تم حذف حساب الموظف.",
  payrollSuccess: "تم تسجيل صرف الراتب في السجل المالي للموظف.",
  invalidCreate: "أكمل الاسم واسم المستخدم وكلمة المرور والراتب وساعات العمل قبل المتابعة.",
  invalidUpdate: "تحقق من الاسم واسم المستخدم والراتب وساعات العمل ثم حاول مرة أخرى.",
  weakPassword: "كلمة المرور يجب أن تكون 6 أحرف أو أكثر.",
  duplicateUsername: "اسم المستخدم مستخدم مسبقًا. اختر اسمًا مختلفًا.",
  loadFailed: "تعذر تحميل وحدة الموظفين. سجل الدخول بحساب مدير ثم أعد المحاولة.",
  protectedAdmin: "مدير النظام الأساسي محمي ولا يمكن حذفه أو تعطيله.",
  paySalaryMissing: "لا يمكن صرف راتب بقيمة صفر.",
  deleteTitle: "حذف حساب الموظف",
  deleteText: "سيتم حذف حساب الدخول وأرشفة ملف الموظف المرتبط به نهائيًا.",
  save: "حفظ التغييرات",
  create: "إنشاء الحساب",
};

function apiFetch(path, options = {}) {
  if (window.ToxApi?.fetch) {
    return window.ToxApi.fetch(path, options);
  }
  return fetch(`${employeesApiBase}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
}

async function readError(response) {
  const payload = await response.json().catch(() => ({}));
  return payload.reason || `HTTP_${response.status}`;
}

function reasonMessage(reason) {
  return {
    USER_EXISTS: text.duplicateUsername,
    INVALID_USER: text.invalidCreate,
    INVALID_USERNAME: text.invalidUpdate,
    WEAK_PASSWORD: text.weakPassword,
    ADMIN_REQUIRED: "هذه الوحدة تتطلب صلاحيات مدير.",
    AUTH_REQUIRED: "انتهت الجلسة الحالية. أعد تسجيل الدخول بحساب مدير.",
    PERMISSION_DENIED: "لا تملك الصلاحية المطلوبة لتنفيذ هذا الإجراء.",
    PROTECTED_USER: text.protectedAdmin,
    INVALID_AMOUNT: text.paySalaryMissing,
    NO_USER: "تعذر العثور على الحساب المطلوب.",
  }[reason] || "حدث خطأ غير متوقع أثناء تنفيذ العملية.";
}

function notify(message, tone = "info") {
  if (!message) return;
  if (window.showNotice) showNotice(message, tone);
}

function roleLabel(role) {
  return Object.fromEntries(roleOptions)[role] || role || "-";
}

function activityLabel(type) {
  return {
    login: "تسجيل دخول",
    logout: "تسجيل خروج",
    failed: "محاولة فاشلة",
  }[type] || type;
}

function formatIqd(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 ? 3 : 0,
    maximumFractionDigits: 3,
  })} IQD`;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar-IQ", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar-IQ", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isProtectedUser(user) {
  return Boolean(user?.isProtectedAdmin || user?.isDefaultAdmin);
}

function isDefaultAdmin(user) {
  return Boolean(user?.isDefaultAdmin || user?.isProtectedAdmin);
}

function defaultAdminUser() {
  return employeeState.users.find(isDefaultAdmin) || null;
}

function staffUsers() {
  return employeeState.users.filter((user) => !isDefaultAdmin(user));
}

function defaultPermissionsForRole(role) {
  const allowed = new Set(roleDefaultPermissions[role] || []);
  return Object.fromEntries(allPermissionCodes.map((code) => [code, allowed.has(code)]));
}

function permissionsMapFromUser(user) {
  const allowed = new Set(user?.permissions || []);
  return Object.fromEntries(allPermissionCodes.map((code) => [code, allowed.has(code)]));
}

function currentUsers() {
  const query = String(employeeSearch?.value || "").trim().toLowerCase();
  return staffUsers().filter((user) => {
    if (employeeState.filter === "active" && !user.isActive) return false;
    if (employeeState.filter === "inactive" && user.isActive) return false;
    if (!query) return true;
    const haystack = [
      user.name,
      user.username,
      user.employee?.phone,
      roleLabel(user.role),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function selectedUser() {
  return employeeState.users.find((user) => String(user.id) === String(employeeState.selectedUserId)) || null;
}

function ensureSelection() {
  const visible = currentUsers();
  const exists = visible.some((user) => String(user.id) === String(employeeState.selectedUserId));
  if (exists) return;
  employeeState.selectedUserId = visible[0]?.id || staffUsers()[0]?.id || "";
}

async function loadUsers(preferredUserId = employeeState.selectedUserId) {
  employeeState.loading = true;
  renderDirectory();
  try {
    const response = await apiFetch("/users/");
    if (!response.ok) throw new Error(await readError(response));
    const payload = await response.json();
    employeeState.users = (payload.users || []).map((user) => ({
      ...user,
      employee: user.employee || {},
      recentLoginEvents: user.recentLoginEvents || [],
    }));
    employeeState.selectedUserId = preferredUserId;
    ensureSelection();
    render();
  } catch (error) {
    employeeState.users = [];
    employeeState.selectedUserId = "";
    render();
    notify(reasonMessage(error.message) || text.loadFailed, "error");
    if (employeesList) {
      employeesList.innerHTML = `<div class="warehouse-empty">${escapeHtml(reasonMessage(error.message) || text.loadFailed)}</div>`;
    }
  } finally {
    employeeState.loading = false;
    renderDirectory();
  }
}

function renderStats() {
  const users = staffUsers();
  const payrollCount = users.reduce((sum, user) => sum + (user.employee?.payrollHistory?.length || 0), 0);
  const salaryTotal = users.reduce((sum, user) => sum + Number(user.employee?.salary || 0), 0);
  document.querySelector("[data-employee-total]").textContent = users.length;
  document.querySelector("[data-employee-active]").textContent = users.filter((user) => user.isActive).length;
  document.querySelector("[data-employee-payroll-count]").textContent = payrollCount;
  document.querySelector("[data-employee-salary-total]").textContent = formatIqd(salaryTotal);
  const visible = currentUsers();
  document.querySelector("[data-employee-visible-count]").textContent = `${visible.length} ظاهر`;
}

function renderDirectory() {
  if (!employeesList) return;
  renderStats();
  if (employeeState.loading) {
    employeesList.innerHTML = `<div class="warehouse-empty">${text.loading}</div>`;
    return;
  }
  const users = currentUsers();
  if (!users.length) {
    employeesList.innerHTML = `<div class="warehouse-empty">${text.empty}</div>`;
    return;
  }
  employeesList.innerHTML = users.map((user) => {
    const active = String(user.id) === String(employeeState.selectedUserId);
    const protectedUser = isProtectedUser(user);
    const payrollEntries = user.employee?.payrollHistory?.length || 0;
    return `
      <article class="employee-directory-card ${active ? "is-active" : ""}" data-select-user="${user.id}">
        <div class="employee-directory-head">
          <div class="employee-avatar employee-avatar-large">${escapeHtml((user.name || user.username || "?").slice(0, 1).toUpperCase())}</div>
          <div class="employee-directory-copy">
            <strong>${escapeHtml(user.name || user.username)}</strong>
            <small>${escapeHtml(user.username)} | ${escapeHtml(roleLabel(user.role))}</small>
          </div>
          <span class="employee-status-chip ${user.isActive ? "is-active" : "is-inactive"}">${user.isActive ? "نشط" : "معطل"}</span>
        </div>
        <div class="employee-directory-meta">
          <span>${escapeHtml(user.employee?.phone || "بدون هاتف")}</span>
          <span>${formatIqd(user.employee?.salary || 0)}</span>
          <span>${payrollEntries} دفعة</span>
        </div>
        <div class="employee-directory-actions">
          <button class="button ghost" type="button" data-edit-user="${user.id}">تعديل</button>
          <button class="button ghost" type="button" data-toggle-user="${user.id}" ${protectedUser ? "disabled" : ""}>${user.isActive ? "تعطيل" : "تفعيل"}</button>
          <button class="button ghost danger" type="button" data-delete-user="${user.id}" ${protectedUser ? "disabled" : ""}>حذف</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderPayrollHistory(entries) {
  if (!entries.length) {
    return `<div class="employee-empty-block">${text.noPayroll}</div>`;
  }
  return `
    <div class="employee-payroll-list">
      ${entries.map((entry) => `
        <article class="employee-payroll-row">
          <div>
            <strong>${formatIqd(entry.amountIqd)}</strong>
            <small>${escapeHtml(entry.note || "صرف راتب")}</small>
          </div>
          <div class="employee-payroll-meta">
            <span>${formatDateTime(entry.createdAt)}</span>
            <small>${escapeHtml(entry.createdBy || "النظام")}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderProfile() {
  const user = selectedUser();
  if (!profilePanel) return;
  if (!user) {
    profilePanel.innerHTML = `<div class="employee-empty-state">${text.noSelection}</div>`;
    return;
  }
  const employee = user.employee || {};
  const protectedUser = isProtectedUser(user);
  const lastLogin = user.recentLoginEvents?.find((event) => event.event === "login");
  profilePanel.innerHTML = `
    <div class="employee-profile-header">
      <div class="employee-profile-identity">
        <div class="employee-avatar employee-avatar-xl">${escapeHtml((user.name || user.username || "?").slice(0, 1).toUpperCase())}</div>
        <div>
          <span class="eyebrow">ملف الموظف</span>
          <h2>${escapeHtml(user.name || user.username)}</h2>
          <p>${escapeHtml(roleLabel(user.role))} | ${escapeHtml(user.username)}</p>
        </div>
      </div>
      <div class="employee-profile-actions">
        <span class="employee-status-chip ${user.isActive ? "is-active" : "is-inactive"}">${user.isActive ? "الحساب مفعل" : "الحساب معطل"}</span>
        <button class="button ghost" type="button" data-edit-user="${user.id}">تعديل الحساب</button>
        <button class="button primary" type="button" data-pay-salary="${user.id}" ${Number(employee.salary || 0) <= 0 ? "disabled" : ""}>صرف راتب</button>
      </div>
    </div>
    <div class="employee-profile-kpis">
      <article class="employee-kpi">
        <span>الراتب الحالي</span>
        <strong>${formatIqd(employee.salary || 0)}</strong>
      </article>
      <article class="employee-kpi">
        <span>ساعات العمل</span>
        <strong>${escapeHtml(String(employee.workHours || 0))} ساعة</strong>
      </article>
      <article class="employee-kpi">
        <span>آخر دخول</span>
        <strong>${escapeHtml(lastLogin ? formatDateTime(lastLogin.createdAt) : "—")}</strong>
      </article>
    </div>
    <div class="employee-profile-details">
      <div class="employee-detail-grid">
        <div><span>الهاتف</span><strong>${escapeHtml(employee.phone || "غير مسجل")}</strong></div>
        <div><span>نوع الحساب</span><strong>${escapeHtml(roleLabel(user.role))}</strong></div>
        <div><span>تاريخ الإنشاء</span><strong>${escapeHtml(formatDate(user.dateJoined))}</strong></div>
        <div><span>عدد دفعات الرواتب</span><strong>${escapeHtml(String(employee.payrollHistory?.length || 0))}</strong></div>
      </div>
      <section class="employee-finance-card">
        <div class="erp-panel-head">
          <div>
            <span class="eyebrow">الإدارة المالية للموظف</span>
            <h3>سجل الرواتب</h3>
          </div>
          <div class="toolbar">
            <span class="status-dot">${formatIqd(employee.salary || 0)}</span>
            <button class="button primary" type="button" data-pay-salary="${user.id}" ${Number(employee.salary || 0) <= 0 ? "disabled" : ""}>صرف راتب</button>
          </div>
        </div>
        ${renderPayrollHistory(employee.payrollHistory || [])}
      </section>
      ${protectedUser ? `<div class="permission-admin-note"><strong>حساب محمي</strong><span>${text.protectedAdmin}</span></div>` : ""}
    </div>
  `;
}

function renderPermissionCompact(user) {
  const allowed = new Set(user.permissions || []);
  const activeCount = allPermissionCodes.filter((c) => allowed.has(c)).length;
  return `
    <div class="employee-perm-compact-grid">
      ${permissionGroups.map(([title, items]) => {
        const onCount = items.filter(([code]) => allowed.has(code)).length;
        return `
          <div class="employee-perm-group">
            <div class="employee-perm-group-head">
              <strong>${title}</strong>
              <span class="employee-perm-counter ${onCount === items.length ? 'is-full' : onCount > 0 ? 'is-partial' : 'is-none'}">${onCount}/${items.length}</span>
            </div>
            <div class="employee-perm-group-items">
              ${items.map(([code, label]) => `
                <div class="employee-perm-item ${allowed.has(code) ? 'is-granted' : 'is-denied'}">
                  <span class="employee-perm-dot"></span>
                  <span>${label}</span>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderPermissionsPanel() {
  const user = selectedUser();
  if (!permissionsPanel) return;
  if (!user) {
    permissionsPanel.innerHTML = `<div class="employee-empty-state">${text.noSelection}</div>`;
    return;
  }

  // Hide permissions completely for admin/super_admin — they have everything
  if (user.role === 'admin' || isDefaultAdmin(user) || isProtectedUser(user)) {
    permissionsPanel.innerHTML = '';
    permissionsPanel.style.display = 'none';
    return;
  }

  permissionsPanel.style.display = '';
  const allowed = new Set(user.permissions || []);
  const activeCount = allPermissionCodes.filter((c) => allowed.has(c)).length;

  permissionsPanel.innerHTML = `
    <div class="erp-panel-head">
      <div>
        <span class="eyebrow">إدارة الوصول</span>
        <h2>وصول ${escapeHtml(user.name || user.username)}</h2>
      </div>
      <div class="toolbar">
        <span class="status-dot">${activeCount} صلاحية مفعلة</span>
        <button class="button primary" type="button" data-edit-user="${user.id}">إدارة الصلاحيات</button>
      </div>
    </div>
    <div class="employee-access-summary">
      <span>لا تُعرض تفاصيل الصلاحيات داخل الملف للحفاظ على شاشة الموظف مرتبة.</span>
      <small>استخدم زر «إدارة الصلاحيات» للتعديل الآمن.</small>
    </div>
  `;
}

function renderActivityPanel() {
  const user = selectedUser();
  if (!activityPanel) return;
  if (!user) {
    activityPanel.innerHTML = `<div class="employee-empty-state">${text.noSelection}</div>`;
    return;
  }
  const events = user.recentLoginEvents || [];
  activityPanel.innerHTML = `
    <div class="erp-panel-head">
      <div>
        <span class="eyebrow">النشاط التشغيلي</span>
        <h2>سجل الدخول للحساب</h2>
      </div>
      <span class="status-dot">${events.length} حدث</span>
    </div>
    ${events.length ? `
      <div class="employee-activity-list">
        ${events.map((event) => `
          <article class="employee-activity-row">
            <div>
              <strong>${activityLabel(event.event)}</strong>
              <small>${escapeHtml(event.ipAddress || "بدون IP")} | ${escapeHtml((event.userAgent || "—").slice(0, 40))}</small>
            </div>
            <span>${formatDateTime(event.createdAt)}</span>
          </article>
        `).join("")}
      </div>
    ` : `<div class="employee-empty-block">${text.noActivity}</div>`}
  `;
}

function modalTitle() {
  return employeeState.modal.mode === "create" ? "إضافة موظف جديد" : "تعديل حساب الموظف";
}

function modalActionLabel() {
  return employeeState.modal.mode === "create" ? text.create : text.save;
}

function isEditingProtectedUser() {
  return employeeState.modal.mode === "edit" && isProtectedUser(modalUser());
}

function openEmployeeModal(mode = "create", user = null) {
  const employee = user?.employee || {};
  employeeState.modal.open = true;
  employeeState.modal.mode = mode;
  employeeState.modal.step = "details";
  employeeState.modal.userId = user?.id || null;
  employeeState.modal.saving = false;
  employeeState.modal.message = "";
  employeeState.modal.tone = "info";
  employeeState.modal.draft = {
    name: user?.name || "",
    username: user?.username || "",
    password: "",
    role: user?.role || "cashier",
    phone: employee.phone || "",
    salary: String(employee.salary ?? 0),
    workHours: String(employee.workHours ?? 0),
  };
  employeeState.modal.permissions = user ? permissionsMapFromUser(user) : defaultPermissionsForRole("cashier");
  renderModal(user);
}

function closeEmployeeModal() {
  employeeState.modal.open = false;
  employeeState.modal.userId = null;
  employeeState.modal.message = "";
  employeeState.modal.saving = false;
  if (modalShell) {
    modalShell.classList.add("hidden");
    modalShell.innerHTML = "";
  }
}

function modalUser() {
  return employeeState.users.find((user) => String(user.id) === String(employeeState.modal.userId)) || null;
}

function renderPermissionEditor(permissions) {
  return permissionGroups.map(([title, items]) => `
    <section class="permission-cluster">
      <div class="permission-cluster-head">
        <h3>${title}</h3>
        <span>${items.filter(([code]) => permissions[code]).length}/${items.length}</span>
      </div>
      <div class="permission-cluster-body">
        ${items.map(([code, label]) => `
          <label class="permission-switch-row ${permissions[code] ? "is-on" : ""}">
            <span>${label}</span>
            <span class="permission-switch">
              <input type="checkbox" data-permission-code="${code}" ${permissions[code] ? "checked" : ""} />
              <i></i>
            </span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function renderModal(user = modalUser()) {
  if (!modalShell) return;
  if (!employeeState.modal.open) {
    closeEmployeeModal();
    return;
  }
  const draft = employeeState.modal.draft || {};
  const isCreate = employeeState.modal.mode === "create";
  const protectedUser = !isCreate && isProtectedUser(user);
  const role = draft.role || user?.role || "cashier";
  const activeStep = protectedUser ? "details" : employeeState.modal.step;
  modalShell.classList.remove("hidden");
  modalShell.innerHTML = `
    <div class="employee-modal-backdrop" data-close-employee-modal></div>
    <div class="employee-modal-card">
      <div class="employee-modal-head">
        <div>
          <span class="eyebrow">${isCreate ? "حساب جديد" : "تحديث الحساب"}</span>
          <h2>${protectedUser ? "تعديل بيانات دخول المدير الرئيسي" : modalTitle()}</h2>
        </div>
        <button class="button ghost" type="button" data-close-employee-modal>إغلاق</button>
      </div>
      ${protectedUser ? "" : `<div class="employee-modal-steps">
        <button class="employee-modal-step ${employeeState.modal.step === "details" ? "is-active" : ""}" type="button" data-modal-step="details">البيانات الأساسية</button>
        <button class="employee-modal-step ${employeeState.modal.step === "permissions" ? "is-active" : ""}" type="button" data-modal-step="permissions">الصلاحيات</button>
      </div>`}
      <form class="employee-editor-form" data-employee-editor-form>
        <section class="employee-editor-stage ${activeStep === "details" ? "is-active" : ""}" data-modal-panel="details">
          <div class="employee-editor-grid">
            ${protectedUser ? "" : `<label class="field">
              <span>الاسم الكامل</span>
              <input name="name" value="${escapeHtml(draft.name || "")}" autocomplete="name" required />
            </label>`}
            <label class="field">
              <span>اسم المستخدم</span>
              <input name="username" value="${escapeHtml(draft.username || "")}" autocomplete="off" required />
            </label>
            <label class="field">
              <span>كلمة السر ${isCreate ? "" : "(اختياري)"}</span>
              <input name="password" type="password" minlength="6" autocomplete="new-password" value="${escapeHtml(draft.password || "")}" ${isCreate ? "required" : ""} />
            </label>
            ${protectedUser ? "" : `<label class="field">
              <span>الدور الوظيفي</span>
              <select name="role">
                ${roleOptions.map(([value, label]) => `<option value="${value}" ${String(role) === value ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>الهاتف</span>
              <input name="phone" value="${escapeHtml(draft.phone || "")}" inputmode="tel" placeholder="07xx xxx xxxx" />
            </label>
            <label class="field">
              <span>الراتب الشهري (IQD)</span>
              <input name="salary" type="number" min="0" step="1" value="${escapeHtml(String(draft.salary || 0))}" required />
            </label>
            <label class="field">
              <span>ساعات العمل</span>
              <input name="workHours" type="number" min="0" step="0.5" value="${escapeHtml(String(draft.workHours || 0))}" required />
            </label>`}
          </div>
          <div class="employee-editor-footer">
            <div class="employee-modal-message ${employeeState.modal.tone}" data-employee-modal-message>${escapeHtml(employeeState.modal.message || "")}</div>
            <div class="toolbar">
              ${protectedUser ? "" : `<button class="button ghost" type="button" data-apply-role-defaults>تحميل صلاحيات الدور</button>`}
              ${protectedUser
                ? `<button class="button primary" type="submit" ${employeeState.modal.saving ? "disabled" : ""}>${employeeState.modal.saving ? "جارٍ الحفظ..." : modalActionLabel()}</button>`
                : `<button class="button primary" type="button" data-open-permissions-step>متابعة إلى الصلاحيات</button>`}
            </div>
          </div>
        </section>
        ${protectedUser ? "" : `<section class="employee-editor-stage ${activeStep === "permissions" ? "is-active" : ""}" data-modal-panel="permissions">
          <div class="employee-permission-editor">
            <div class="employee-permission-editor-head">
              <div>
                <span class="eyebrow">اختر صلاحيات الموظف</span>
                <h3>${escapeHtml(draft.name || user?.name || "موظف جديد")}</h3>
              </div>
              <span class="status-dot">${Object.values(employeeState.modal.permissions).filter(Boolean).length} صلاحية مفعلة</span>
            </div>
            ${renderPermissionEditor(employeeState.modal.permissions)}
          </div>
          <div class="employee-editor-footer">
            <div class="employee-modal-message ${employeeState.modal.tone}" data-employee-modal-message>${escapeHtml(employeeState.modal.message || "")}</div>
            <div class="toolbar">
              <button class="button ghost" type="button" data-modal-step="details">رجوع</button>
              <button class="button ghost" type="button" data-apply-role-defaults>صلاحيات ${roleLabel(role)}</button>
              <button class="button primary" type="submit" ${employeeState.modal.saving ? "disabled" : ""}>${employeeState.modal.saving ? "جارٍ الحفظ..." : modalActionLabel()}</button>
            </div>
          </div>
        </section>`}
      </form>
    </div>
  `;
}

function updateModalMessage(message, tone = "info") {
  employeeState.modal.message = message;
  employeeState.modal.tone = tone;
  const target = modalShell?.querySelector("[data-employee-modal-message]");
  if (target) {
    target.textContent = message;
    target.className = `employee-modal-message ${tone}`;
  }
}

function readEditorForm() {
  const form = modalShell?.querySelector("[data-employee-editor-form]");
  if (!form) return null;
  const existing = modalUser();
  const nameField = form.querySelector("[name='name']");
  const usernameField = form.querySelector("[name='username']");
  const phoneField = form.querySelector("[name='phone']");
  const roleField = form.querySelector("[name='role']");
  const salaryField = form.querySelector("[name='salary']");
  const workHoursField = form.querySelector("[name='workHours']");
  employeeState.modal.draft = {
    name: nameField ? nameField.value.trim() : existing?.name || "",
    username: usernameField ? usernameField.value.trim() : existing?.username || "",
    password: form.querySelector("[name='password']")?.value || "",
    role: roleField?.value || existing?.role || "cashier",
    phone: phoneField ? phoneField.value.trim() : existing?.employee?.phone || "",
    salary: salaryField ? salaryField.value : String(existing?.employee?.salary ?? 0),
    workHours: workHoursField ? workHoursField.value : String(existing?.employee?.workHours ?? 0),
  };
  return employeeState.modal.draft;
}

function validateEditorPayload(payload) {
  if (isEditingProtectedUser()) {
    if (!payload.username) return text.invalidUpdate;
    if (payload.password && payload.password.length < 6) return text.weakPassword;
    return "";
  }
  if (!payload.name || !payload.username || payload.salary === "" || payload.workHours === "") {
    return employeeState.modal.mode === "create" ? text.invalidCreate : text.invalidUpdate;
  }
  if (employeeState.modal.mode === "create" && payload.password.length < 6) {
    return text.weakPassword;
  }
  if (employeeState.modal.mode === "edit" && payload.password && payload.password.length < 6) {
    return text.weakPassword;
  }
  return "";
}

function applyRoleDefaults() {
  const payload = readEditorForm() || employeeState.modal.draft;
  const role = payload?.role || "cashier";
  employeeState.modal.permissions = defaultPermissionsForRole(role);
  renderModal();
}

function collectPermissionsFromModal() {
  const next = { ...employeeState.modal.permissions };
  modalShell?.querySelectorAll("[data-permission-code]").forEach((input) => {
    next[input.dataset.permissionCode] = input.checked;
  });
  employeeState.modal.permissions = next;
  return next;
}

async function submitEmployeeForm() {
  const payload = readEditorForm();
  if (!payload) return;
  const error = validateEditorPayload(payload);
  if (error) {
    updateModalMessage(error, "error");
    return;
  }
  employeeState.modal.saving = true;
  updateModalMessage("", "info");
  renderModal();
  const existing = modalUser();
  const protectedUser = employeeState.modal.mode === "edit" && isProtectedUser(existing);
  let body;
  if (protectedUser) {
    body = { username: payload.username };
    if (payload.password) body.password = payload.password;
  } else {
    body = {
      ...payload,
      permissions: collectPermissionsFromModal(),
    };
    if (!payload.password) delete body.password;
    if (body.role === "admin") {
      body.permissions = defaultPermissionsForRole("admin");
    }
  }
  try {
    const response = await apiFetch(
      employeeState.modal.mode === "create" ? "/users/" : `/users/${existing.id}/`,
      {
        method: employeeState.modal.mode === "create" ? "POST" : "PATCH",
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw new Error(await readError(response));
    const result = await response.json();
    closeEmployeeModal();
    notify(employeeState.modal.mode === "create" ? text.createSuccess : text.updateSuccess, "success");
    await loadUsers(result.user?.id || existing?.id);
  } catch (requestError) {
    employeeState.modal.saving = false;
    renderModal();
    updateModalMessage(reasonMessage(requestError.message), "error");
  }
}

async function toggleUserStatus(userId) {
  const user = employeeState.users.find((entry) => String(entry.id) === String(userId));
  if (!user) return;
  try {
    const response = await apiFetch(`/users/${userId}/`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !user.isActive }),
    });
    if (!response.ok) throw new Error(await readError(response));
    notify(text.statusSuccess, "success");
    await loadUsers(userId);
  } catch (error) {
    notify(reasonMessage(error.message), "error");
  }
}

async function deleteUserAccount(userId) {
  const user = employeeState.users.find((entry) => String(entry.id) === String(userId));
  if (!user) return;
  openDeleteModal({
    title: text.deleteTitle,
    text: text.deleteText,
    onConfirm: async () => {
      try {
        const response = await apiFetch(`/users/${userId}/`, { method: "DELETE" });
        if (!response.ok) throw new Error(await readError(response));
        notify(text.deleteSuccess, "success");
        await loadUsers();
      } catch (error) {
        notify(reasonMessage(error.message), "error");
      }
    },
  });
}

async function recordSalaryPayment(userId) {
  const user = employeeState.users.find((entry) => String(entry.id) === String(userId));
  const amount = Number(user?.employee?.salary || 0);
  if (!user || amount <= 0) {
    notify(text.paySalaryMissing, "error");
    return;
  }
  try {
    const response = await apiFetch(`/users/${userId}/payroll/`, {
      method: "POST",
      body: JSON.stringify({
        amountIqd: amount,
        note: `صرف راتب ${new Date().toLocaleDateString("ar-IQ", { month: "long", year: "numeric" })}`,
      }),
    });
    if (!response.ok) throw new Error(await readError(response));
    const result = await response.json();
    notify(text.payrollSuccess, "success");
    await loadUsers(result.user?.id || userId);
  } catch (error) {
    notify(reasonMessage(error.message), "error");
  }
}

function render() {
  ensureSelection();
  renderDirectory();
  renderProfile();
  renderPermissionsPanel();
  renderActivityPanel();
}

employeeSearch?.addEventListener("input", () => {
  ensureSelection();
  render();
});

document.querySelectorAll("[data-employee-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    employeeState.filter = button.dataset.employeeFilter || "all";
    document.querySelectorAll("[data-employee-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
    ensureSelection();
    render();
  });
});

document.querySelector("[data-open-employee-modal]")?.addEventListener("click", () => openEmployeeModal("create"));
document.querySelector("[data-refresh-employees]")?.addEventListener("click", () => loadUsers());

employeesList?.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-user]");
  if (edit) {
    event.stopPropagation();
    const user = employeeState.users.find((entry) => String(entry.id) === String(edit.dataset.editUser));
    openEmployeeModal("edit", user);
    return;
  }
  const toggle = event.target.closest("[data-toggle-user]");
  if (toggle) {
    event.stopPropagation();
    toggleUserStatus(toggle.dataset.toggleUser);
    return;
  }
  const remove = event.target.closest("[data-delete-user]");
  if (remove) {
    event.stopPropagation();
    deleteUserAccount(remove.dataset.deleteUser);
    return;
  }
  const select = event.target.closest("[data-select-user]");
  if (select) {
    employeeState.selectedUserId = select.dataset.selectUser;
    render();
  }
});

document.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-user]");
  if (edit && !employeesList?.contains(edit)) {
    const user = employeeState.users.find((entry) => String(entry.id) === String(edit.dataset.editUser));
    openEmployeeModal("edit", user);
    return;
  }
  const pay = event.target.closest("[data-pay-salary]");
  if (pay) {
    recordSalaryPayment(pay.dataset.paySalary);
  }
});

modalShell?.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-employee-modal]")) {
    closeEmployeeModal();
    return;
  }
  const stepButton = event.target.closest("[data-modal-step]");
  if (stepButton) {
    readEditorForm();
    collectPermissionsFromModal();
    employeeState.modal.step = stepButton.dataset.modalStep;
    renderModal();
    return;
  }
  if (event.target.closest("[data-open-permissions-step]")) {
    const payload = readEditorForm();
    const error = validateEditorPayload(payload || {});
    if (error) {
      updateModalMessage(error, "error");
      return;
    }
    employeeState.modal.step = "permissions";
    renderModal();
    return;
  }
  if (event.target.closest("[data-apply-role-defaults]")) {
    applyRoleDefaults();
    return;
  }
  if (event.target.classList.contains("employee-modal-backdrop")) {
    closeEmployeeModal();
    return;
  }
  const permissionInput = event.target.closest("[data-permission-code]");
  if (permissionInput) {
    employeeState.modal.permissions[permissionInput.dataset.permissionCode] = permissionInput.checked;
    permissionInput.closest(".permission-switch-row")?.classList.toggle("is-on", permissionInput.checked);
    const countNode = modalShell.querySelector(".employee-permission-editor-head .status-dot");
    if (countNode) {
      countNode.textContent = `${Object.values(collectPermissionsFromModal()).filter(Boolean).length} صلاحية مفعلة`;
    }
  }
});

modalShell?.addEventListener("change", (event) => {
  if (event.target.matches("[name='role']")) {
    const draft = readEditorForm();
    if (employeeState.modal.mode === "create") {
      employeeState.modal.permissions = defaultPermissionsForRole(draft?.role || "cashier");
    }
  }
});

modalShell?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitEmployeeForm();
});

loadUsers();
