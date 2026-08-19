/**
 * TOX Super Admin — Subscription & User Management
 * Redesigned: 2026-08-08
 * - Pagination for 2000+ users
 * - Role forced to admin (مدير أساسي)
 * - Smart subscription renew
 * - Date-based start/end
 * - Search with debounce
 */
document.addEventListener("DOMContentLoaded", () => {
  /* ═══════════════════════════════════════════
     DOM References
     ═══════════════════════════════════════════ */
  const statsContainer = document.getElementById("stats-container");
  const usersTbody = document.getElementById("users-tbody");
  const usersTableHead = usersTbody?.closest("table")?.querySelector("thead tr");
  const emptyState = document.getElementById("empty-state");
  const paginationContainer = document.getElementById("pagination-container");
  const searchInput = document.getElementById("search-input");

  // Create dialog
  const createOverlay = document.getElementById("create-overlay");
  const createForm = document.getElementById("create-form");
  const addUserBtn = document.getElementById("add-user-btn");
  const createCancelBtn = document.getElementById("create-cancel-btn");
  const cfStartDate = document.getElementById("cf-start-date");
  const cfEndDate = document.getElementById("cf-end-date");
  const durationPresets = document.getElementById("duration-presets");

  // Renew dialog
  const renewOverlay = document.getElementById("renew-overlay");
  const renewForm = document.getElementById("renew-form");
  const renewCancelBtn = document.getElementById("renew-cancel-btn");
  const renewUserIdInput = document.getElementById("renew-user-id");
  const renewUsernameDisplay = document.getElementById("renew-username-display");
  const renewPresets = document.getElementById("renew-presets");
  const renewCustomField = document.getElementById("renew-custom-field");
  const renewInfo = document.getElementById("renew-info");

  const logoutBtn = document.getElementById("logout-btn");

  if (usersTableHead && !usersTableHead.querySelector(".sa-owner-col")) {
    const ownerHead = document.createElement("th");
    ownerHead.className = "sa-owner-col";
    ownerHead.textContent = "مدير الحساب";
    usersTableHead.insertBefore(ownerHead, usersTableHead.querySelector(".col-actions"));
  }

  /* ═══════════════════════════════════════════
     State
     ═══════════════════════════════════════════ */
  let currentPage = 1;
  const PAGE_SIZE = 50;
  let searchQuery = "";
  let searchTimer = null;
  let currentRenewUser = null;

  /* ═══════════════════════════════════════════
     Helpers
     ═══════════════════════════════════════════ */
  function esc(str) {
    if (typeof ui !== "undefined" && ui.escapeHTML) return ui.escapeHTML(str);
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function formatDate(isoStr) {
    if (!isoStr) return "—";
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch { return isoStr; }
  }

  function toISODate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr).toISOString();
  }

  function todayISO() {
    return new Date().toISOString().split("T")[0];
  }

  function addDaysToDate(dateStr, days) {
    const d = new Date(dateStr || new Date());
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  }

  function showToast(msg, tone) {
    if (typeof ui !== "undefined" && ui.toast) {
      ui.toast(msg, tone);
    } else {
      alert(msg);
    }
  }

  /* ═══════════════════════════════════════════
     Logout
     ═══════════════════════════════════════════ */
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try { await ToxApi.fetch("/auth/logout/", { method: "POST" }); } catch {}
    sessionStorage.clear();
    window.location.href = "../index.html";
  });

  /* ═══════════════════════════════════════════
     Stats
     ═══════════════════════════════════════════ */
  async function loadStats() {
    try {
      const res = await ToxApi.fetch("/super-admin/stats/");
      if (res.status === 401 || res.status === 403) {
        window.location.replace("../index.html");
        return;
      }
      if (!res.ok) return;
      const d = await res.json();

      const cards = [
        { value: d.users ?? 0, label: "إجمالي الحسابات", cls: "" },
        { value: d.active_users ?? 0, label: "الحسابات النشطة", cls: "stat-success" },
        { value: d.disabled_users ?? 0, label: "الحسابات المعطلة", cls: d.disabled_users ? "stat-warning" : "" },
        { value: d.expired_users ?? 0, label: "اشتراكات منتهية", cls: d.expired_users ? "stat-danger" : "" },
        { value: d.expiring_soon ?? 0, label: "تنتهي قريباً (7 أيام)", cls: d.expiring_soon ? "stat-warning" : "" },
        { value: d.products ?? 0, label: "المنتجات المسجلة", cls: "" },
        { value: (d.db_size_mb ?? 0) + " MB", label: "حجم قاعدة البيانات", cls: "" },
      ];

      statsContainer.innerHTML = cards.map(c =>
        `<div class="stat-card ${c.cls}">
          <div class="value">${c.value}</div>
          <div class="label">${c.label}</div>
        </div>`
      ).join("");
    } catch (e) {
      console.error("Stats load error:", e);
    }
  }

  /* ═══════════════════════════════════════════
     Status Badge Builder
     ═══════════════════════════════════════════ */
  function statusBadge(user) {
    if (!user.is_active) {
      return `<span class="sa-badge sa-badge-disabled">⏸ معطل</span>`;
    }
    if (!user.expires_at) {
      return `<span class="sa-badge sa-badge-open">∞ مفتوح</span>`;
    }
    const expiry = new Date(user.expires_at);
    const now = new Date();
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
      return `<span class="sa-badge sa-badge-expired">✕ منتهي</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="sa-badge sa-badge-expiring">⚠ ينتهي خلال ${daysLeft} يوم</span>`;
    }
    return `<span class="sa-badge sa-badge-active">✓ نشط</span>`;
  }

  /* ═══════════════════════════════════════════
     Users Table
     ═══════════════════════════════════════════ */
  async function loadUsers() {
    try {
      const params = new URLSearchParams({
        page: currentPage,
        page_size: PAGE_SIZE
      });
      if (searchQuery) params.set("search", searchQuery);

      const res = await ToxApi.fetch(`/super-admin/users/?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const users = data.users || [];
      const total = data.total || 0;
      const totalPages = data.total_pages || 1;

      usersTbody.innerHTML = "";

      if (users.length === 0) {
        emptyState.style.display = "block";
        paginationContainer.style.display = "none";
        return;
      }

      emptyState.style.display = "none";

      users.forEach(u => {
        const isSuperAdmin = u.username === "super_admin";
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc(u.full_name || "—")}</td>
          <td><strong>${esc(u.username)}</strong></td>
          <td><span class="sa-badge sa-badge-role">${esc(u.role === "super_admin" ? "سوبر أدمن" : u.role === "admin" ? "مدير أساسي" : u.role)}</span></td>
          <td><span dir="ltr">${formatDate(u.date_joined)}</span></td>
          <td><span dir="ltr">${formatDate(u.starts_at)}</span></td>
          <td><span dir="ltr">${formatDate(u.expires_at)}</span></td>
          <td>${statusBadge(u)}</td>
          <td><span class="sa-owner-badge">${esc(u.managed_by_name || u.managed_by_username || "السوبر أدمن")}${u.role === "admin" ? ` · ${Number(u.managed_staff_count || 0).toLocaleString("ar-IQ")} موظف` : ""}</span></td>
          <td class="col-actions">
            ${isSuperAdmin ? '' : `
              <div class="sa-action-group">
                <button class="sa-btn" style="color: var(--primary); border-color: rgba(var(--primary-rgb, 0, 120, 215), 0.3);" data-action="password" data-id="${u.id}" data-username="${esc(u.username)}">مرور</button>
                <button class="sa-btn sa-btn-renew" data-action="renew" data-id="${u.id}" data-username="${esc(u.username)}" data-expires="${u.expires_at || ''}">تجديد</button>
                <button class="sa-btn ${u.is_active ? 'sa-btn-disable' : 'sa-btn-enable'}" data-action="toggle" data-id="${u.id}">
                  ${u.is_active ? 'تعطيل' : 'تفعيل'}
                </button>
                <button class="sa-btn sa-btn-delete" data-action="delete" data-id="${u.id}" data-username="${esc(u.username)}">حذف</button>
              </div>
            `}
          </td>
        `;
        usersTbody.appendChild(tr);
      });

      // Render pagination
      renderPagination(totalPages, total);
    } catch (e) {
      console.error("Users load error:", e);
    }
  }

  /* ═══════════════════════════════════════════
     Pagination
     ═══════════════════════════════════════════ */
  function renderPagination(totalPages, total) {
    if (totalPages <= 1) {
      paginationContainer.style.display = "none";
      return;
    }
    paginationContainer.style.display = "flex";

    let html = `<span class="sa-pagination-info">${total} مشترك</span>`;

    // Previous
    html += `<button class="sa-page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`;

    // Page numbers (show max 7 pages)
    const maxVisible = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<button class="sa-page-btn" data-page="1">1</button>`;
      if (startPage > 2) html += `<span style="padding:0 4px;color:var(--muted)">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="sa-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span style="padding:0 4px;color:var(--muted)">...</span>`;
      html += `<button class="sa-page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next
    html += `<button class="sa-page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>`;

    paginationContainer.innerHTML = html;
  }

  paginationContainer.addEventListener("click", (e) => {
    const btn = e.target.closest(".sa-page-btn");
    if (!btn || btn.disabled) return;
    const page = parseInt(btn.dataset.page, 10);
    if (page && page !== currentPage) {
      currentPage = page;
      loadUsers();
    }
  });

  /* ═══════════════════════════════════════════
     Search
     ═══════════════════════════════════════════ */
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      currentPage = 1;
      loadUsers();
    }, 300);
  });

  /* ═══════════════════════════════════════════
     Table Action Delegation
     ═══════════════════════════════════════════ */
  usersTbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === "renew") {
      openRenewDialog(id, btn.dataset.username, btn.dataset.expires);
    } else if (action === "password") {
      openPasswordDialog(id, btn.dataset.username);
    } else if (action === "toggle") {
      toggleUser(id);
    } else if (action === "delete") {
      deleteUser(id, btn.dataset.username);
    }
  });

  /* ═══════════════════════════════════════════
     Create Dialog — Duration Presets
     ═══════════════════════════════════════════ */
  function setCreateDates(days) {
    const today = todayISO();
    cfStartDate.value = today;
    if (days === 0) {
      cfEndDate.value = "";
      cfEndDate.disabled = true;
    } else {
      cfEndDate.disabled = false;
      cfEndDate.value = addDaysToDate(today, days);
    }
  }

  // Initialize dates
  setCreateDates(365);

  durationPresets.addEventListener("click", (e) => {
    const btn = e.target.closest(".sa-preset-btn");
    if (!btn) return;

    // Toggle active
    durationPresets.querySelectorAll(".sa-preset-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const days = btn.dataset.days;
    if (days === "custom") {
      cfEndDate.disabled = false;
      cfEndDate.focus();
    } else {
      setCreateDates(parseInt(days, 10));
    }
  });

  /* ═══════════════════════════════════════════
     Create Dialog — Open / Close
     ═══════════════════════════════════════════ */
  addUserBtn.addEventListener("click", () => {
    createForm.reset();
    // Reset presets
    durationPresets.querySelectorAll(".sa-preset-btn").forEach(b => b.classList.remove("active"));
    durationPresets.querySelector('[data-days="365"]').classList.add("active");
    setCreateDates(365);
    createOverlay.classList.add("open");
  });

  createCancelBtn.addEventListener("click", () => {
    createOverlay.classList.remove("open");
  });

  createOverlay.addEventListener("click", (e) => {
    if (e.target === createOverlay) createOverlay.classList.remove("open");
  });

  /* ═══════════════════════════════════════════
     Create Form Submit
     ═══════════════════════════════════════════ */
  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = createForm.querySelector('[name="username"]').value.trim();
    const full_name = createForm.querySelector('[name="full_name"]').value.trim();
    const password = createForm.querySelector('[name="password"]').value;

    if (!username || !password) {
      showToast("يرجى ملء الحقول الأساسية (اسم المستخدم وكلمة المرور)", "error");
      return;
    }

    const payload = {
      username,
      full_name,
      password,
      role: "admin",
      start_date: cfStartDate.value ? new Date(cfStartDate.value).toISOString() : null,
      end_date: cfEndDate.value ? new Date(cfEndDate.value + "T23:59:59").toISOString() : null
    };

    try {
      const submitBtn = createForm.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "جاري الإنشاء...";

      const res = await ToxApi.fetch("/super-admin/users/", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      submitBtn.disabled = false;
      submitBtn.textContent = "إنشاء الحساب";

      if (res.ok) {
        showToast("تم إنشاء الحساب بنجاح ✓", "success");
        createOverlay.classList.remove("open");
        loadUsers();
        loadStats();
      } else {
        const err = await res.json();
        if (err.reason === "USERNAME_TAKEN") {
          showToast("اسم المستخدم مستخدم مسبقاً", "error");
        } else {
          showToast(err.reason || err.message || "حدث خطأ أثناء الإنشاء", "error");
        }
      }
    } catch (ex) {
      showToast("فشل الاتصال بالخادم", "error");
    }
  });

  /* ═══════════════════════════════════════════
     Renew Dialog
     ═══════════════════════════════════════════ */
  let renewExtendDays = 365;

  function openRenewDialog(id, username, expiresAt) {
    renewUserIdInput.value = id;
    renewUsernameDisplay.textContent = username;
    currentRenewUser = { id, username, expires_at: expiresAt };
    renewExtendDays = 365;

    // Reset presets
    renewPresets.querySelectorAll(".sa-preset-btn").forEach(b => b.classList.remove("active"));
    renewPresets.querySelector('[data-days="365"]').classList.add("active");
    renewCustomField.style.display = "none";

    // Show info
    updateRenewInfo();
    renewOverlay.classList.add("open");
  }

  function updateRenewInfo() {
    if (!currentRenewUser) return;
    const exp = currentRenewUser.expires_at;
    if (!exp) {
      renewInfo.innerHTML = `<strong>ℹ</strong> هذا الحساب بدون تاريخ انتهاء (مفتوح).`;
      return;
    }
    const expDate = new Date(exp);
    const now = new Date();
    const isExpired = expDate < now;

    if (isExpired) {
      renewInfo.innerHTML = `<strong style="color:#dc2626">⚠</strong> الاشتراك <strong>منتهي</strong> منذ ${formatDate(exp)}. سيبدأ التجديد من <strong>اليوم</strong>.`;
    } else {
      renewInfo.innerHTML = `<strong style="color:#059669">✓</strong> الاشتراك <strong>ساري</strong> حتى ${formatDate(exp)}. سيتم التمديد من تاريخ الانتهاء الحالي.`;
    }
  }

  renewPresets.addEventListener("click", (e) => {
    const btn = e.target.closest(".sa-preset-btn");
    if (!btn) return;

    renewPresets.querySelectorAll(".sa-preset-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const days = btn.dataset.days;
    if (days === "custom") {
      renewCustomField.style.display = "block";
      renewExtendDays = null;
      document.getElementById("rf-end-date").focus();
    } else {
      renewCustomField.style.display = "none";
      renewExtendDays = parseInt(days, 10);
    }
  });

  renewCancelBtn.addEventListener("click", () => {
    renewOverlay.classList.remove("open");
  });

  renewOverlay.addEventListener("click", (e) => {
    if (e.target === renewOverlay) renewOverlay.classList.remove("open");
  });

  renewForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = renewUserIdInput.value;

    const payload = { action: "renew_subscription" };

    if (renewExtendDays !== null) {
      payload.extend_days = renewExtendDays;
    } else {
      const newEnd = document.getElementById("rf-end-date").value;
      if (!newEnd) {
        showToast("يرجى تحديد تاريخ الانتهاء", "error");
        return;
      }
      payload.new_end_date = new Date(newEnd + "T23:59:59").toISOString();
    }

    try {
      const submitBtn = renewForm.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "جاري التجديد...";

      const res = await ToxApi.fetch(`/super-admin/users/${userId}/`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      submitBtn.disabled = false;
      submitBtn.textContent = "تجديد";

      if (res.ok) {
        showToast("تم تجديد الاشتراك بنجاح ✓", "success");
        renewOverlay.classList.remove("open");
        loadUsers();
        loadStats();
      } else {
        const err = await res.json();
        showToast(err.reason || "حدث خطأ أثناء التجديد", "error");
      }
    } catch (ex) {
      showToast("فشل الاتصال بالخادم", "error");
    }
  });

  /* ═══════════════════════════════════════════
     Toggle Active
     ═══════════════════════════════════════════ */
  async function toggleUser(id) {
    if (!confirm("هل تريد تغيير حالة هذا الحساب؟")) return;

    try {
      const res = await ToxApi.fetch(`/super-admin/users/${id}/`, {
        method: "POST",
        body: JSON.stringify({ action: "toggle_active" })
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.is_active ? "تم تفعيل الحساب بنجاح ✓" : "تم تعطيل الحساب ⏸";
        showToast(msg, "success");
        loadUsers();
        loadStats();
      } else {
        const err = await res.json();
        showToast(err.reason || "حدث خطأ", "error");
      }
    } catch (ex) {
      showToast("فشل الاتصال بالخادم", "error");
    }
  }

  /* ═══════════════════════════════════════════
     Delete User
     ═══════════════════════════════════════════ */
  async function deleteUser(id, username) {
    if (!confirm(`هل أنت متأكد من حذف المستخدم "${username}"؟\n\nهذا الإجراء لا يمكن التراجع عنه!`)) return;

    try {
      const res = await ToxApi.fetch(`/super-admin/users/${id}/`, { method: "DELETE" });
      if (res.ok) {
        showToast("تم حذف المستخدم بنجاح", "success");
        loadUsers();
        loadStats();
      } else {
        const err = await res.json();
        showToast(err.reason || "حدث خطأ", "error");
      }
    } catch (ex) {
      showToast("فشل الاتصال بالخادم", "error");
    }
  }

  /* ═══════════════════════════════════════════
     Change Password Dialog
     ═══════════════════════════════════════════ */
  const passwordOverlay = document.getElementById("password-overlay");
  const passwordForm = document.getElementById("password-form");
  const passwordCancelBtn = document.getElementById("password-cancel-btn");
  const passwordUserId = document.getElementById("password-user-id");
  const passwordUsernameDisplay = document.getElementById("password-username-display");

  function openPasswordDialog(id, username) {
    passwordUserId.value = id;
    passwordUsernameDisplay.textContent = username;
    passwordForm.reset();
    passwordOverlay.classList.add("open");
  }

  passwordCancelBtn.addEventListener("click", () => {
    passwordOverlay.classList.remove("open");
  });

  passwordOverlay.addEventListener("click", (e) => {
    if (e.target === passwordOverlay) passwordOverlay.classList.remove("open");
  });

  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = passwordUserId.value;
    const new_password = passwordForm.querySelector('[name="new_password"]').value;

    if (!new_password) {
      showToast("يرجى إدخال كلمة المرور الجديدة", "error");
      return;
    }

    try {
      const submitBtn = passwordForm.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "جاري التغيير...";

      const res = await ToxApi.fetch(`/super-admin/users/${id}/`, {
        method: "POST",
        body: JSON.stringify({ action: "change_password", new_password })
      });

      submitBtn.disabled = false;
      submitBtn.textContent = "تغيير";

      if (res.ok) {
        showToast("تم تغيير كلمة المرور بنجاح ✓", "success");
        passwordOverlay.classList.remove("open");
      } else {
        const err = await res.json();
        showToast(err.reason || "حدث خطأ أثناء التغيير", "error");
      }
    } catch (ex) {
      showToast("فشل الاتصال بالخادم", "error");
    }
  });

  /* ═══════════════════════════════════════════
     Keyboard shortcuts
     ═══════════════════════════════════════════ */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      createOverlay.classList.remove("open");
      renewOverlay.classList.remove("open");
      passwordOverlay.classList.remove("open");
    }
  });

  /* ═══════════════════════════════════════════
     Initial Load
     ═══════════════════════════════════════════ */
  function setupCurrentUser() {
    const userStr = sessionStorage.getItem("tox_user");
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        document.getElementById("current-username").textContent = user.full_name || user.username || "Super Admin";
        document.getElementById("current-user-avatar").textContent = (user.full_name || user.username || "SA").substring(0, 2).toUpperCase();
      } catch (e) {}
    }
  }

  setupCurrentUser();
  loadStats();
  loadUsers();
});
