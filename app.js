/* ============================================================
   2 กอ ผลไม้ปอกพร้อมทาน — app.js
   เชื่อมต่อกับ Google Apps Script Web App (GAS_URL ใน config.js)
   ============================================================ */

const state = {
  employee: null,     // {id, name, role}
  pin: "",
  products: [],
  employees: [],
  packaging: [],       // บรรจุภัณฑ์ที่ยัง active ใช้ในหน้าขาย
  codes: [],            // Code บรรจุภัณฑ์ที่ตั้งไว้ล่วงหน้า (ดูหน้าบันทึกการขาย)
  adjustTarget: null,   // สินค้าที่กำลังจะปรับคงเหลือ {id, name, stock, unit}
};

// รายชื่อ view ที่อยู่ในกลุ่มเมนู "สต๊อก" (ใช้ตอนกางเมนูย่อยอัตโนมัติ)
// หมายเหตุ: เอา "stockin" ออกแล้ว เพราะรวมเข้ากับ "เพิ่มสินค้า" (modal) ไปแล้ว
const STOCK_GROUP_VIEWS = ["products", "stockcut"];

// ---------------- API helper ----------------
// หมายเหตุ: POST ไม่ตั้ง header Content-Type เอง เพื่อเลี่ยงปัญหา
// CORS preflight กับ Apps Script (ฝั่ง GAS จะ JSON.parse(e.postData.contents) เอง)
async function apiGet(action, params) {
  const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
  const res = await fetch(`${GAS_URL}?${qs}`, { method: "GET" });
  return res.json();
}
async function apiPost(action, payload) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    body: JSON.stringify({ action, ...(payload || {}) }),
  });
  return res.json();
}

// ---------------- กันกดปุ่มบันทึกซ้ำ ----------------
// ปิดปุ่ม submit ของฟอร์ม + เปลี่ยนข้อความเป็น "กำลังบันทึก..." ระหว่างรอ
// ผลตอบกลับจาก Google Apps Script (ปกติช้ากว่าเว็บทั่วไป 1-5 วินาที) เพื่อไม่ให้
// พนักงานเข้าใจผิดว่ากดไม่ติดแล้วกดซ้ำจนข้อมูลถูกบันทึกซ้ำสองรอบ
// ไม่ว่าจะสำเร็จหรือพัง (error) ปุ่มจะกลับมากดได้ปกติเสมอผ่าน finally
async function submitWithLock(form, action, payload) {
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  try {
    return await apiPost(action, payload);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// ---------------- toast ----------------
let toastTimer;
function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("err", !!isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function money(n) {
  const v = Number(n) || 0;
  return "฿" + v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

// ============================================================
// LOGIN
// ============================================================
async function loadEmployeesForLogin() {
  try {
    const list = await apiGet("getEmployees");
    if (list.error) throw new Error(list.error);
    const sel = document.getElementById("emp-select");
    sel.innerHTML = '<option value="">— เลือกพนักงาน —</option>';
    list.filter(e => e.status === "active").forEach(e => {
      const opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.name;
      sel.appendChild(opt);
    });
  } catch (err) {
    document.getElementById("login-error").textContent = "เชื่อมต่อระบบไม่ได้ ตรวจสอบ GAS_URL ใน config.js";
  }
}

function renderPinDots() {
  const dots = document.querySelectorAll(".pin-dot");
  dots.forEach((d, i) => d.classList.toggle("filled", i < state.pin.length));
}

document.getElementById("keypad").addEventListener("click", async (e) => {
  const btn = e.target.closest(".key");
  if (!btn) return;
  const k = btn.dataset.k;
  document.getElementById("login-error").textContent = "";

  if (k === "clear") { state.pin = ""; }
  else if (k === "back") { state.pin = state.pin.slice(0, -1); }
  else if (state.pin.length < 4) { state.pin += k; }

  renderPinDots();

  if (state.pin.length === 4) {
    const empId = document.getElementById("emp-select").value;
    if (!empId) {
      document.getElementById("login-error").textContent = "กรุณาเลือกชื่อพนักงานก่อน";
      state.pin = ""; renderPinDots();
      return;
    }
    const res = await apiPost("login", { employeeId: empId, pin: state.pin });
    if (res.ok) {
      state.employee = res.employee;
      localStorage.setItem("2kor_employee", JSON.stringify(res.employee));
      enterApp();
    } else {
      document.getElementById("login-error").textContent = res.error || "เข้าสู่ระบบไม่สำเร็จ";
      state.pin = ""; renderPinDots();
    }
  }
});

function logout() {
  localStorage.removeItem("2kor_employee");
  state.employee = null;
  state.pin = "";
  renderPinDots();
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  loadEmployeesForLogin();
}
document.getElementById("btn-logout").addEventListener("click", logout);

// ============================================================
// APP SHELL / ROUTING
// ============================================================
function enterApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("topbar-emp").textContent =
    state.employee.name + (state.employee.role === "admin" ? " · ผู้ดูแลระบบ" : " · พนักงาน");

  document.getElementById("fab-add-product").classList.toggle("hidden", state.employee.role !== "admin");
  document.getElementById("side-employees").classList.toggle("hidden", state.employee.role !== "admin");

  goToView("dashboard");
  refreshProducts();
  refreshLowStock();
}

function goToView(name) {
  document.querySelectorAll("[data-view]").forEach(s => {
    if (s.tagName === "SECTION") s.classList.toggle("hidden", s.dataset.view !== name);
  });

  // sidebar active state (top-level items + submenu items)
  document.querySelectorAll(".side-item[data-view], .side-subitem[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === name)
  );

  // auto-expand / highlight the "สต๊อก" group when a stock-related view is active
  const stockGroup = document.getElementById("group-stock");
  const isStockView = STOCK_GROUP_VIEWS.includes(name);
  stockGroup.classList.toggle("has-active", isStockView);
  if (isStockView) stockGroup.classList.add("expanded");

  closeMobileSidebar();

  if (name === "dashboard") loadDashboard();
  if (name === "products") renderProductsList();
  if (name === "stockcut") { /* selects already filled via fillProductSelects */ }
  if (name === "stockout") { loadPackagingOptions(); loadSaleItemNames(); loadCodes(); }
  if (name === "summary") loadSummary();
  if (name === "employees") loadEmployeesList();
}

document.addEventListener("click", (e) => {
  const item = e.target.closest(".side-item[data-view], .side-subitem[data-view]");
  if (item) { goToView(item.dataset.view); return; }

  const groupToggle = e.target.closest(".side-group-toggle");
  if (groupToggle) {
    groupToggle.closest(".side-group").classList.toggle("expanded");
    return;
  }

  const addProductAction = e.target.closest('[data-action="add-product"]');
  if (addProductAction) { openModal("modal-product"); closeMobileSidebar(); return; }

  const chip = e.target.closest("[data-goto]");
  if (chip) { goToView(chip.dataset.goto); return; }
});

document.getElementById("btn-low-stock").addEventListener("click", () => goToView("dashboard"));

// ============================================================
// SIDEBAR: collapse (desktop) / drawer (mobile)
// ============================================================
const sidebarEl = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");

function isMobileWidth() { return window.matchMedia("(max-width: 860px)").matches; }

function openMobileSidebar() {
  sidebarEl.classList.add("mobile-open");
  sidebarBackdrop.classList.add("show");
}
function closeMobileSidebar() {
  sidebarEl.classList.remove("mobile-open");
  sidebarBackdrop.classList.remove("show");
}

document.getElementById("btn-menu-toggle").addEventListener("click", () => {
  if (isMobileWidth()) {
    if (sidebarEl.classList.contains("mobile-open")) closeMobileSidebar();
    else openMobileSidebar();
  } else {
    toggleSidebarCollapse();
  }
});
sidebarBackdrop.addEventListener("click", closeMobileSidebar);

function toggleSidebarCollapse() {
  const collapsed = sidebarEl.classList.toggle("collapsed");
  localStorage.setItem("2kor_sidebar_collapsed", collapsed ? "1" : "0");
}
document.getElementById("btn-collapse-sidebar").addEventListener("click", toggleSidebarCollapse);

// คืนสถานะย่อ/ขยายเมนูจากครั้งก่อน (เฉพาะจอกว้าง)
if (!isMobileWidth() && localStorage.getItem("2kor_sidebar_collapsed") === "1") {
  sidebarEl.classList.add("collapsed");
}

// ============================================================
// PRODUCTS
// ============================================================
async function refreshProducts() {
  try {
    state.products = await apiGet("getProducts");
    fillProductSelects();
    if (!document.querySelector('[data-view="products"]').classList.contains("hidden")) renderProductsList();
  } catch (err) { toast("โหลดข้อมูลสินค้าไม่สำเร็จ", true); }
}

// ดรอปดาวเลือกสินค้าในหน้า "ของเสีย / ตัดสต๊อก" — ต้องมีของเหลือจริง (>0)
// เท่านั้นถึงจะมีอะไรให้ตัด/ทิ้ง ไม่ว่าจะเป็นของใหม่หรือของเก่าที่หมดแล้วก็
// ไม่ต้องโชว์เหมือนกัน (การรับสินค้าเข้าใหม่ ตอนนี้ทำผ่าน modal "เพิ่มสินค้า"
// อย่างเดียวแล้ว ไม่มีดรอปดาวเลือกสินค้าเดิมมารับเข้าซ้ำอีกต่อไป)
function fillProductSelects() {
  const activeAll = state.products.filter(p => p["สถานะ"] !== "inactive");
  const stockedList = activeAll.filter(p => Number(p["สต๊อกปัจจุบัน"]) > 0);
  const rawOnly = stockedList.filter(p => p["หมวดหมู่"] === "วัตถุดิบ");

  [["waste-product", stockedList], ["cut-product", rawOnly]].forEach(([id, list]) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = "";
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "— ไม่มีสินค้าให้เลือก —";
      sel.appendChild(opt);
    }
    list.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p["รหัสสินค้า"];
      opt.textContent = `${p["ชื่อสินค้า"]} ${money(p["ราคาทุนล่าสุด"])}/${p["หน่วยนับ"]} (คงเหลือ ${p["สต๊อกปัจจุบัน"]} ${p["หน่วยนับ"]})`;
      opt.dataset.cost = p["ราคาทุนล่าสุด"];
      opt.dataset.stock = p["สต๊อกปัจจุบัน"];
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
  updateWasteHint();
  updateCutHint();
}

// หน้า "สต๊อกคงเหลือ" — ถ้าสินค้าตัวเดียวกันมีของเหลืออยู่หลายราคาทุนพร้อมกัน
// (ซื้อเข้าคนละรอบคนละราคา) จะแยกแสดงเป็นคนละแถวตามราคา เช่น
// "แตงโม ฿18/ลูก" กับ "แตงโม ฿22/ลูก" คนละแถว แทนที่จะรวมเป็นแถวเดียว
async function renderProductsList() {
  const wrap = document.getElementById("products-list");
  wrap.innerHTML = '<div class="empty-state">กำลังโหลด…</div>';
  let list;
  try {
    list = await apiGet("getProductsWithLots");
    if (list.error) throw new Error(list.error);
  } catch (err) {
    wrap.innerHTML = '<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>';
    return;
  }
  if (!list.length) { wrap.innerHTML = '<div class="empty-state">ยังไม่มีสินค้า กด + เพื่อเพิ่มสินค้าแรก</div>'; return; }

  // ซ่อนสินค้าที่สต๊อกคงเหลือ = 0 ออกจากหน้านี้เท่านั้น (ไม่ได้ลบข้อมูลในชีตจริง)
  // เหตุผล: แต่ละรอบซื้อผลไม้ราคาทุนไม่เท่ากัน พอของหมดร้านจะเพิ่มเป็นสินค้าใหม่
  // แทนของเดิมอยู่แล้ว ตัวเก่าที่หมดสต๊อกเลยไม่จำเป็นต้องค้างโชว์ในลิสต์นี้อีก
  // ประวัติการขาย/ตัดสต๊อก/กำไรที่ผ่านมายังคำนวณถูกต้องปกติ เพราะข้อมูลเก่า
  // ยังอยู่ครบในชีต "ตัดสต๊อก"/"ขายออก"/"ของเสีย" ไม่เกี่ยวกับชีต "สินค้า" นี้
  const visibleList = list.filter(p => Number(p["สต๊อกปัจจุบัน"]) > 0);

  if (!visibleList.length) {
    wrap.innerHTML = '<div class="empty-state">ตอนนี้สต๊อกทุกตัวเป็น 0 หมด — กด + เพื่อรับสินค้าล็อตใหม่เข้าได้เลย</div>';
    return;
  }

  wrap.innerHTML = "";
  visibleList.forEach(p => {
    const stock = Number(p["สต๊อกปัจจุบัน"]);
    const min = Number(p["สต๊อกขั้นต่ำ"]) || 1;
    const pct = Math.max(0, Math.min(100, Math.round((stock / (min * 2)) * 100)));
    const low = stock <= min;
    const unit = p["หน่วยนับ"];
    const lots = Array.isArray(p.lots) ? p.lots : [];

    if (lots.length <= 1) {
      // ราคาทุนเดียว (หรือยังไม่มีล็อต) — แถวเดียวเหมือนเดิม
      const cost = lots.length ? lots[0].cost : Number(p["ราคาทุนล่าสุด"]);
      const row = document.createElement("div");
      row.className = "list-row";
      row.innerHTML = `
        <div class="stock-ring ${low ? "low" : ""}" style="--pct:${pct}"><span>${stock}</span></div>
        <div class="main">
          <div class="title">${p["ชื่อสินค้า"]}</div>
          <div class="sub">${p["หมวดหมู่"]}</div>
        </div>
        <div class="stock-trail">
          <div class="stock-cost">${money(cost)}</div>
          <div class="stock-unit">/ ${unit}</div>
        </div>
      `;
      wrap.appendChild(row);
      return;
    }

    // มีหลายราคาทุนพร้อมกัน — แถวหัวโชว์ชื่อ/สต๊อกรวม แล้วแยกแถวย่อยตามราคา
    const head = document.createElement("div");
    head.className = "list-row";
    head.innerHTML = `
      <div class="stock-ring ${low ? "low" : ""}" style="--pct:${pct}"><span>${stock}</span></div>
      <div class="main">
        <div class="title">${p["ชื่อสินค้า"]}</div>
        <div class="sub">${p["หมวดหมู่"]} · มีของเหลือหลายราคาทุน</div>
      </div>
    `;
    wrap.appendChild(head);

    lots.forEach(l => {
      const sub = document.createElement("div");
      sub.className = "list-row";
      sub.style.paddingLeft = "58px";
      sub.innerHTML = `
        <div class="main">
          <div class="title" style="font-size:13px;font-weight:600;color:var(--ink-soft)">ล็อตราคา ${money(l.cost)}/${unit}</div>
        </div>
        <div class="stock-trail">
          <div class="stock-cost">${l.remaining}</div>
          <div class="stock-unit">${unit}</div>
        </div>
      `;
      wrap.appendChild(sub);
    });
  });
}

// ---- ปรับคงเหลือแบบแมนนวล ----
// หมายเหตุ: เอาปุ่ม "ปรับคงเหลือ" ออกจากหน้ารายการสต๊อกแล้วตามที่ขอ
// ฟอร์ม/โมดัลด้านล่างนี้ยังเก็บไว้เผื่ออนาคตอยากผูกปุ่มเรียกใช้จากที่อื่น
// (ถ้าไม่ต้องการฟีเจอร์นี้เลย บอกได้ จะเอา modal-adjust ออกให้ด้วย)
document.getElementById("form-adjust").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.adjustTarget) return;
  const res = await submitWithLock(e.target, "adjustStock", {
    productId: state.adjustTarget.id,
    newStock: document.getElementById("adjust-new").value,
    note: document.getElementById("adjust-note").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    const diffTxt = res.diff > 0 ? `เพิ่มขึ้น ${res.diff}` : res.diff < 0 ? `ลดลง ${Math.abs(res.diff)}` : "ไม่เปลี่ยนแปลง";
    toast("ปรับคงเหลือเรียบร้อย (" + diffTxt + ")");
    closeModal("modal-adjust");
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "ปรับคงเหลือไม่สำเร็จ", true);
});

async function refreshLowStock() {
  try {
    const low = await apiGet("getLowStock");
    const badge = document.getElementById("low-stock-badge");
    badge.textContent = low.length;
    badge.classList.toggle("hidden", low.length === 0);

    const card = document.getElementById("dash-lowstock-card");
    if (!low.length) { card.innerHTML = '<div class="empty-state">สต๊อกทุกอย่างปกติดี 👍</div>'; return; }
    card.innerHTML = "";
    low.forEach(p => {
      const row = document.createElement("div");
      row.className = "list-row";
      row.innerHTML = `
        <div class="slice-mark danger" style="width:34px;height:34px"></div>
        <div class="main">
          <div class="title">${p["ชื่อสินค้า"]}</div>
          <div class="sub">คงเหลือ ${p["สต๊อกปัจจุบัน"]} ${p["หน่วยนับ"]} (ขั้นต่ำ ${p["สต๊อกขั้นต่ำ"]})</div>
        </div>`;
      card.appendChild(row);
    });
  } catch (err) { /* เงียบไว้ ไม่รบกวนหน้าจอหลัก */ }
}

// ---- modal: add product ----
function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }
document.querySelectorAll("[data-close-modal]").forEach(b =>
  b.addEventListener("click", () => closeModal(b.dataset.closeModal))
);
document.getElementById("fab-add-product").addEventListener("click", () => openModal("modal-product"));

// อัปเดตช่อง "ราคาทุน/หน่วย" ให้เห็นสดๆ ตอนพิมพ์ ราคา/จำนวน (ราคา ÷ จำนวน)
// เป็นแค่ตัวเลขให้ดูก่อนบันทึกเท่านั้น ตัวเลขจริงที่ใช้บันทึกคำนวณฝั่ง
// เซิร์ฟเวอร์อีกที (กันกรณีปัดเศษไม่ตรงกันระหว่างหน้าเว็บกับฐานข้อมูล)
function updateAddProductCostPreview() {
  const price = Number(document.getElementById("np-price").value) || 0;
  const qty = Number(document.getElementById("np-qty").value) || 0;
  const el = document.getElementById("np-costperunit");
  el.value = qty > 0 ? money(price / qty) : "—";
}
document.getElementById("np-price").addEventListener("input", updateAddProductCostPreview);
document.getElementById("np-qty").addEventListener("input", updateAddProductCostPreview);

document.getElementById("form-add-product").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await submitWithLock(e.target, "addProduct", {
    name: document.getElementById("np-name").value,
    category: document.getElementById("np-category").value,
    unit: document.getElementById("np-unit").value,
    minStock: document.getElementById("np-minstock").value,
    price: document.getElementById("np-price").value,
    qty: document.getElementById("np-qty").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast("เพิ่มสินค้า + รับเข้าเรียบร้อย");
    e.target.reset();
    document.getElementById("np-costperunit").value = "";
    closeModal("modal-product");
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "เพิ่มสินค้าไม่สำเร็จ", true);
});

// ============================================================
// STOCK CUT — ตัดสต๊อกผลไม้/วัตถุดิบด้วยมือ (นำไปปอก/แปรรูป/ใช้งาน)
// ============================================================
function updateCutHint() {
  const sel = document.getElementById("cut-product");
  const opt = sel.selectedOptions[0];
  const hint = document.getElementById("cut-stock-hint");
  hint.textContent = (opt && opt.dataset.stock !== undefined) ? `คงเหลือในสต๊อก: ${opt.dataset.stock}` : "";
}
document.getElementById("cut-product").addEventListener("change", updateCutHint);

document.getElementById("form-stockcut").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("cut-product").value;
  if (!productId) return toast("ยังไม่มีวัตถุดิบให้เลือก กรุณาเพิ่มสินค้าประเภทวัตถุดิบก่อน", true);
  const res = await submitWithLock(e.target, "cutStock", {
    productId,
    qty: document.getElementById("cut-qty").value,
    note: document.getElementById("cut-note").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast("บันทึกตัดสต๊อกเรียบร้อย มูลค่าทุนที่ตัด " + money(res.costValue));
    e.target.reset();
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "บันทึกไม่สำเร็จ", true);
});

// ============================================================
// STOCK OUT — พิมพ์ชื่อรายการ + ราคาเอง แล้วเลือกบรรจุภัณฑ์ที่ใช้
// ============================================================
// โหลดชื่อรายการขายที่เคยพิมพ์บันทึกไว้แล้ว มาเติมเป็นตัวเลือกใน <datalist>
// ที่ผูกกับช่อง "ชื่อรายการขาย" (out-name) — เป็นดรอปดาวที่ยังพิมพ์ชื่อใหม่
// เองได้ตามปกติ ถ้าพิมพ์ชื่อไม่ตรงกับในลิสต์เลยสักตัว input จะรับค่าที่พิมพ์
// ไปใช้ตามปกติ ไม่ได้บังคับว่าต้องเลือกจากลิสต์เท่านั้น
async function loadSaleItemNames() {
  try {
    const names = await apiGet("getSaleItemNames");
    if (names.error) throw new Error(names.error);
    const list = document.getElementById("out-name-list");
    list.innerHTML = "";
    names.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      list.appendChild(opt);
    });
  } catch (err) { /* เงียบไว้ — ต่อให้โหลดไม่สำเร็จ ก็ยังพิมพ์ชื่อเองได้ตามปกติ */ }
}

// วาด checkbox + ช่องจำนวนของบรรจุภัณฑ์ ใช้ร่วมกัน 2 ที่: รายการที่ใช้จริง
// ตอนขาย (out-packaging-list) และตอนตั้งค่า Code (code-packaging-list)
// เก็บชื่อสินค้าไว้ใน data-pack-name ด้วย เพื่อให้ตอนบันทึก Code เอาชื่อไป
// ฝังใน Code ได้เลย ไม่ต้องย้อนไปหาใน state.products อีกที (เผื่อสินค้านั้น
// ถูกปิดใช้งาน/เปลี่ยนชื่อไปแล้วในอนาคต Code เก่าจะยังอ่านชื่อเดิมได้)
// รายการที่มี p._stale = true คือของที่ Code เดิมเคยผูกไว้แต่ตอนนี้สต๊อก
// เหลือ 0 แล้ว (ของเก่าหมด ของใหม่ราคาอาจไม่เท่าเดิม) ยังต้องโชว์ให้เห็นตอน
// แก้ไข Code เพื่อให้ติ๊กออก/เปลี่ยนไปเลือกของใหม่แทนได้ ไม่ใช่หายไปเงียบๆ
function renderPackagingChecklist(containerId, list, emptyMsg) {
  const wrap = document.getElementById(containerId);
  if (!list.length) { wrap.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; return; }
  wrap.innerHTML = "";
  list.forEach(p => {
    const row = document.createElement("div");
    row.className = "list-row";
    const statusLabel = p._stale
      ? '<span class="hint">(หมดสต๊อกแล้ว — เลือกของใหม่แทนถ้ามี)</span>'
      : `<span class="hint">(คงเหลือ ${p["สต๊อกปัจจุบัน"]} ${p["หน่วยนับ"]})</span>`;
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
        <input type="checkbox" class="pack-check" data-pack-id="${p["รหัสสินค้า"]}" data-pack-name="${p["ชื่อสินค้า"]}">
        <span>${p["ชื่อสินค้า"]} ${statusLabel}</span>
      </label>
      <input type="number" class="pack-qty" data-pack-id="${p["รหัสสินค้า"]}" value="1" min="1" step="1" style="width:64px" disabled>
    `;
    wrap.appendChild(row);
  });
}

// ติ๊กแล้วเปิดช่องจำนวนให้แก้ไขได้ (ไม่ติ๊ก = ไม่ใช้ ไม่หักสต๊อก) — ผูก event
// ไว้กับทั้ง 2 ลิสต์ (ขายจริง + ตั้งค่า Code) ใช้ closest(".list-row") กันชนกัน
// ถ้าบรรจุภัณฑ์ตัวเดียวกันไปโผล่ทั้ง 2 ลิสต์พร้อมกัน
["out-packaging-list", "code-packaging-list"].forEach(containerId => {
  document.getElementById(containerId).addEventListener("change", (e) => {
    if (!e.target.classList.contains("pack-check")) return;
    const id = e.target.dataset.packId;
    const qtyInput = e.target.closest(".list-row").querySelector(`.pack-qty[data-pack-id="${id}"]`);
    if (qtyInput) qtyInput.disabled = !e.target.checked;
  });
});

function collectSelectedPackaging(containerId) {
  const selected = [];
  document.querySelectorAll(`#${containerId} .pack-check:checked`).forEach(chk => {
    const id = chk.dataset.packId;
    const qty = document.querySelector(`#${containerId} .pack-qty[data-pack-id="${id}"]`).value;
    selected.push({ productId: id, qty: Number(qty) || 1, name: chk.dataset.packName || "" });
  });
  return selected;
}

// โหลดรายการบรรจุภัณฑ์ที่ยัง active มาแสดงเป็น checkbox + ช่องจำนวน ให้
// พนักงานเลือกเองว่าการขายครั้งนี้ใช้อะไรบ้าง — ใช้เป็น "ทางเลือกสำรอง" เมื่อ
// ยังไม่ได้เลือก Code เท่านั้น (ถ้าเลือก Code ไว้แล้ว ระบบหักให้อัตโนมัติ
// ไม่ต้องมาติ๊กเองซ้ำ ดู updateOutCodeUI ด้านล่าง)
async function loadPackagingOptions() {
  try {
    const all = await apiGet("getPackaging");
    // ไม่โชว์บรรจุภัณฑ์ที่สต๊อกเหลือ 0 ให้เลือกตอนขาย เพราะเลือกไปก็หักสต๊อก
    // ไม่ได้อยู่ดี (ของไม่พอ) — พอบรรจุภัณฑ์หมดแล้วรับเข้าล็อตใหม่ราคาอาจไม่
    // เท่าเดิม ระบบจะให้เพิ่มเป็นรายการใหม่แทน จึงไม่ต้องมีตัวเก่าค้างในลิสต์นี้
    state.packaging = Array.isArray(all) ? all.filter(p => Number(p["สต๊อกปัจจุบัน"]) > 0) : [];
    renderPackagingChecklist("out-packaging-list", state.packaging, 'ยังไม่มีบรรจุภัณฑ์ที่มีของเหลือ (รับเข้าใหม่ได้ที่เมนู "เพิ่มสินค้า")');
  } catch (err) {
    document.getElementById("out-packaging-list").innerHTML = '<div class="empty-state">โหลดบรรจุภัณฑ์ไม่สำเร็จ</div>';
  }
}

// รายการบรรจุภัณฑ์สำหรับ "ตั้งค่า Code" — โชว์เฉพาะที่ยังมีของเหลือในสต๊อก
// (>0) เท่านั้น ตัวที่หมดแล้วไม่ต้องขึ้นให้เลือกใหม่ (ผูกไปก็ไม่มีของจริงจะหัก)
// ยกเว้นตอน "แก้ไข Code" ที่ตัวเดิมเคยผูกไว้แล้วดันหมดสต๊อกไปพอดี — จะยังโชว์
// แถวเดิมนั้นไว้ให้เห็น (มีป้ายบอกว่าหมดแล้ว) เพื่อให้ติ๊กออกหรือเปลี่ยนไป
// เลือกของใหม่แทนได้ ไม่ใช่หายไปเงียบๆ จนไม่รู้ว่า Code นี้ยังอ้างของเก่าอยู่
// boundItems = รายการบรรจุภัณฑ์ที่ Code นี้เคยผูกไว้ (ใช้ตอนแก้ไขเท่านั้น)
async function loadCodePackagingOptions(boundItems) {
  boundItems = Array.isArray(boundItems) ? boundItems : [];
  try {
    const all = await apiGet("getPackaging");
    const inStock = Array.isArray(all) ? all.filter(p => Number(p["สต๊อกปัจจุบัน"]) > 0) : [];
    const inStockIds = new Set(inStock.map(p => p["รหัสสินค้า"]));
    const stale = boundItems
      .filter(b => !inStockIds.has(b.productId))
      .map(b => ({ "รหัสสินค้า": b.productId, "ชื่อสินค้า": b.name || b.productId, _stale: true }));

    renderPackagingChecklist("code-packaging-list", [...inStock, ...stale], 'ยังไม่มีบรรจุภัณฑ์ที่มีของเหลือในสต๊อก ไปรับเข้าที่เมนู "เพิ่มสินค้า" ก่อน');

    // ติ๊กของเดิมที่เคยผูกไว้กลับคืน พร้อมใส่จำนวนเดิม (ใช้ตอนแก้ไข)
    boundItems.forEach(b => {
      const chk = document.querySelector(`#code-packaging-list .pack-check[data-pack-id="${b.productId}"]`);
      if (!chk) return;
      chk.checked = true;
      const qtyInput = chk.closest(".list-row").querySelector(".pack-qty");
      qtyInput.disabled = false;
      qtyInput.value = b.qty;
    });
  } catch (err) {
    document.getElementById("code-packaging-list").innerHTML = '<div class="empty-state">โหลดบรรจุภัณฑ์ไม่สำเร็จ</div>';
  }
}

// ============================================================
// CODE (ชุดบรรจุภัณฑ์ที่ตั้งไว้ล่วงหน้า)
// ============================================================
async function loadCodes() {
  try {
    const codes = await apiGet("getCodes");
    state.codes = Array.isArray(codes) ? codes : [];
    const sel = document.getElementById("out-code");
    const cur = sel.value;
    sel.innerHTML = '<option value="">— ไม่ใช้ Code (เลือกบรรจุภัณฑ์เอง) —</option>';
    state.codes.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
    updateOutCodeUI();
    renderCodesList();
  } catch (err) { /* เงียบไว้ — ยังเลือกบรรจุภัณฑ์เองได้ตามปกติ */ }
}

// รายการ Code ทั้งหมดที่เคยตั้งไว้ พร้อมสรุปว่าผูกกับบรรจุภัณฑ์อะไรบ้าง
// และปุ่ม "แก้ไข" ต่อรายการ — ใช้ตอนบรรจุภัณฑ์เก่าหมดสต๊อกแล้วต้องเปลี่ยนไป
// ผูกกับสินค้าล็อตใหม่ (ที่อาจราคาไม่เท่าเดิม) แทนของเดิม
function renderCodesList() {
  const wrap = document.getElementById("codes-list");
  if (!state.codes.length) {
    wrap.innerHTML = '<div class="empty-state">ยังไม่มี Code — กด "+ เพิ่ม Code" เพื่อสร้างอันแรก</div>';
    return;
  }
  wrap.innerHTML = "";
  state.codes.forEach(c => {
    const parts = (c.packaging || []).map(p => `${p.name || p.productId} x${p.qty}`);
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="main">
        <div class="title">${c.name}</div>
        <div class="sub">${parts.length ? parts.join(", ") : "ยังไม่ได้ผูกบรรจุภัณฑ์"}</div>
      </div>
      <button type="button" class="btn outline btn-edit-code" data-code-id="${c.id}" style="width:auto;padding:8px 14px">แก้ไข</button>
    `;
    wrap.appendChild(row);
  });
}
document.getElementById("codes-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-edit-code");
  if (!btn) return;
  const code = state.codes.find(c => c.id === btn.dataset.codeId);
  if (code) openCodeModal(code);
});

// เลือก Code แล้ว: ซ่อนช่องติ๊กบรรจุภัณฑ์เอง (เพราะหักให้อัตโนมัติแล้ว)
// ไม่เลือก Code (ค่าว่าง): โชว์ช่องติ๊กบรรจุภัณฑ์เองแบบเดิมกลับมาเป็นทางเลือกสำรอง
function updateOutCodeUI() {
  const sel = document.getElementById("out-code");
  const section = document.getElementById("out-packaging-section");
  const hint = document.getElementById("out-code-hint");
  const code = state.codes.find(c => c.id === sel.value);
  if (code) {
    section.classList.add("hidden");
    const parts = (code.packaging || []).map(p => `${p.name || p.productId} x${p.qty}`);
    hint.textContent = parts.length ? `จะหักอัตโนมัติ: ${parts.join(", ")}` : "Code นี้ยังไม่ได้ผูกบรรจุภัณฑ์ไว้";
  } else {
    section.classList.remove("hidden");
    hint.textContent = "";
  }
}
document.getElementById("out-code").addEventListener("change", updateOutCodeUI);

// เปิด modal ตั้งค่า Code — code = null คือโหมด "เพิ่มใหม่", ส่ง code object
// เข้ามาคือโหมด "แก้ไข" (พรีฟิลชื่อ + ติ๊กบรรจุภัณฑ์เดิมกลับให้)
function openCodeModal(code) {
  const form = document.getElementById("form-add-code");
  form.reset();
  document.getElementById("code-id").value = code ? code.id : "";
  document.getElementById("code-name").value = code ? code.name : "";
  document.getElementById("modal-code-title").textContent = code ? "แก้ไข Code บรรจุภัณฑ์" : "เพิ่ม Code บรรจุภัณฑ์";
  document.getElementById("code-submit-btn").textContent = code ? "บันทึกการแก้ไข" : "บันทึก Code";
  loadCodePackagingOptions(code ? code.packaging : []);
  openModal("modal-code");
}

document.getElementById("btn-add-code").addEventListener("click", () => openCodeModal(null));

document.getElementById("form-add-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const codeId = document.getElementById("code-id").value;
  const name = document.getElementById("code-name").value.trim();
  if (!name) return toast("กรุณาตั้งชื่อ Code", true);
  const packaging = collectSelectedPackaging("code-packaging-list");
  if (!packaging.length) return toast("กรุณาเลือกบรรจุภัณฑ์อย่างน้อย 1 อย่าง", true);

  const res = codeId
    ? await submitWithLock(e.target, "updateCode", { codeId, name, packaging })
    : await submitWithLock(e.target, "addCode", { name, packaging, employee: state.employee.name });

  if (res.ok) {
    toast(codeId ? "แก้ไข Code เรียบร้อย" : "บันทึก Code เรียบร้อย");
    e.target.reset();
    closeModal("modal-code");
    loadCodes();
  } else toast(res.error || "บันทึก Code ไม่สำเร็จ", true);
});

// ============================================================
// ยอดรวม (คำนวณอัตโนมัติตามช่องทางการจำหน่าย)
// Line Man หักค่าคอมมิชชั่น 32.10% ออกจากราคาขาย/หน่วยก่อนคูณจำนวน
// ช่องทางอื่นคิดแบบปกติ จำนวน × ราคาขาย/หน่วย — ปัดทศนิยม 2 ตำแหน่งเสมอ
// (ตัวเลขที่โชว์ตรงนี้เป็นตัวอย่างให้ดูก่อนบันทึก ยอดจริงคำนวณซ้ำฝั่ง
// เซิร์ฟเวอร์อีกที กันตัวเลขเพี้ยนถ้ามีคนแก้ค่าในหน้าเว็บก่อนกดส่ง)
function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function computeSaleTotal(qty, price, channel) {
  const q = Number(qty) || 0;
  const p = Number(price) || 0;
  if (String(channel || "").trim() === "Line Man") return roundMoney(p * (1 - 0.3210) * q);
  return roundMoney(q * p);
}
function updateOutTotalPreview() {
  const qty = document.getElementById("out-qty").value;
  const price = document.getElementById("out-price").value;
  const channel = document.getElementById("out-channel").value;
  document.getElementById("out-total").value = money(computeSaleTotal(qty, price, channel));
}
["out-qty", "out-price", "out-channel"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateOutTotalPreview);
});

document.getElementById("form-stockout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const itemName = document.getElementById("out-name").value.trim();
  if (!itemName) return toast("กรุณาพิมพ์ชื่อรายการขาย", true);

  const selectedCode = state.codes.find(c => c.id === document.getElementById("out-code").value);
  // มี Code -> ใช้บรรจุภัณฑ์ที่ผูกไว้กับ Code นั้นอัตโนมัติ ไม่ต้องติ๊กเอง
  // ไม่มี Code -> กลับไปใช้ช่องติ๊กเองแบบเดิม (ทางเลือกสำรอง)
  const packaging = selectedCode
    ? selectedCode.packaging.map(p => ({ productId: p.productId, qty: p.qty }))
    : collectSelectedPackaging("out-packaging-list");

  const res = await submitWithLock(e.target, "stockOut", {
    itemName,
    code: selectedCode ? selectedCode.name : "",
    channel: document.getElementById("out-channel").value.trim(),
    qty: document.getElementById("out-qty").value,
    sellPrice: document.getElementById("out-price").value,
    packaging,
    note: document.getElementById("out-note").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast((res.lowStock && res.lowStock.length) ? `บันทึกการขายแล้ว — บรรจุภัณฑ์ใกล้หมด: ${res.lowStock.join(", ")}` : "บันทึกการขายเรียบร้อย");
    e.target.reset();
    document.getElementById("out-qty").value = 1;
    document.getElementById("out-total").value = "";
    updateOutCodeUI();
    loadPackagingOptions();
    loadSaleItemNames();
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "บันทึกไม่สำเร็จ", true);
});

// ============================================================
// WASTE
// ============================================================
function updateWasteHint() {
  const sel = document.getElementById("waste-product");
  const opt = sel.selectedOptions[0];
  const hint = document.getElementById("waste-stock-hint");
  hint.textContent = (opt && opt.dataset.stock !== undefined) ? `คงเหลือในสต๊อก: ${opt.dataset.stock}` : "";
}
document.getElementById("waste-product").addEventListener("change", updateWasteHint);

document.getElementById("form-waste").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("waste-product").value;
  if (!productId) return toast("ยังไม่มีสินค้าให้เลือก", true);
  const res = await submitWithLock(e.target, "addWaste", {
    productId,
    qty: document.getElementById("waste-qty").value,
    reason: document.getElementById("waste-reason").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast("บันทึกของเสียเรียบร้อย มูลค่าทุนที่เสีย " + money(res.costValue));
    e.target.reset();
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "บันทึกไม่สำเร็จ", true);
});

// ============================================================
// OTHER COSTS
// ============================================================
document.getElementById("form-cost").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await submitWithLock(e.target, "addOtherCost", {
    category: document.getElementById("cost-category").value,
    description: document.getElementById("cost-desc").value,
    amount: document.getElementById("cost-amount").value,
    employee: state.employee.name,
  });
  if (res.ok) { toast("บันทึกค่าใช้จ่ายเรียบร้อย"); e.target.reset(); }
  else toast(res.error || "บันทึกไม่สำเร็จ", true);
});

// ============================================================
// DASHBOARD (สรุปวันนี้) — สูตรกำไรเดิม ไม่เปลี่ยน
// ============================================================
async function loadDashboard() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const sum = await apiGet("getSummary", { period: "day", date: today });
    document.getElementById("dash-revenue").textContent = money(sum.totalRevenue);
    document.getElementById("dash-profit").textContent = money(sum.profit);
    document.getElementById("dash-waste").textContent = money(sum.totalWaste);
    document.getElementById("dash-count").textContent = sum.countStockOut ?? 0;
  } catch (err) { toast("โหลดสรุปวันนี้ไม่สำเร็จ", true); }
}

// ============================================================
// SUMMARY VIEW (รายวัน / รายเดือน)
// รายเดือน: เพิ่มการหักต้นทุนผลไม้ที่ตัดสต๊อกจริง (จากเมนู "ตัดสต๊อก")
// ============================================================
let currentPeriod = "day";
document.querySelectorAll(".toggle-group [data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".toggle-group [data-period]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    loadSummary();
  });
});
document.getElementById("summary-date").addEventListener("change", loadSummary);

async function loadSummary() {
  const dateInput = document.getElementById("summary-date");
  if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  try {
    const sum = await apiGet("getSummary", { period: currentPeriod, date: dateInput.value });
    document.getElementById("sum-profit").textContent = money(sum.profit);
    document.getElementById("sum-revenue").textContent = money(sum.totalRevenue);
    document.getElementById("sum-raw").textContent = money(sum.totalRawMaterialIn);
    document.getElementById("sum-packcost").textContent = money(sum.totalPackagingCost);
    document.getElementById("sum-waste").textContent = money(sum.totalWaste);
    document.getElementById("sum-costs").textContent = money(sum.totalOtherCosts);
    document.getElementById("sum-in").textContent = money(sum.totalStockIn);

    document.getElementById("sum-rawcut").textContent = money(sum.totalRawMaterialCut);
    document.getElementById("sum-formula-hint").textContent =
      "กำไร = ยอดขาย − ต้นทุนผลไม้ที่ตัดใช้จริง − ต้นทุนบรรจุภัณฑ์ที่ใช้จริง − ของเสีย − ค่าใช้จ่ายอื่น (ยอดซื้อของช่วงนี้เป็นข้อมูลอ้างอิงกระแสเงินสด ไม่ได้ถูกหักซ้ำในการคำนวณกำไร)";

    renderSummaryStockOutList(sum.stockOutList);
  } catch (err) { toast("โหลดสรุปยอดไม่สำเร็จ", true); }
}

// แสดงรายการขายทีละแถวของช่วงที่เลือก (รายวัน/รายเดือน) ให้ไล่เช็คได้ว่า
// รายการขายที่เกิดขึ้นจริงบันทึกลงระบบครบหรือยัง — ใหม่สุดอยู่บนสุด
function renderSummaryStockOutList(list) {
  const wrap = document.getElementById("sum-stockout-list");
  if (!list || !list.length) {
    wrap.innerHTML = '<div class="empty-state">ยังไม่มีรายการขายที่บันทึกไว้ในช่วงนี้</div>';
    return;
  }
  wrap.innerHTML = "";
  list.forEach(r => {
    const d = new Date(r.date);
    const timeLabel = isNaN(d) ? "" : d.toLocaleString("th-TH", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="main">
        <div class="title">${r.itemName || "(ไม่ระบุชื่อ)"}</div>
        <div class="sub">${timeLabel} · จำนวน ${r.qty} × ${money(r.sellPrice)}${r.channel ? " · " + r.channel : ""}${r.employee ? " · " + r.employee : ""}</div>
      </div>
      <div class="trail pos">${money(r.total)}</div>
    `;
    wrap.appendChild(row);
  });
}

// ============================================================
// EMPLOYEES (admin only)
// ============================================================
async function loadEmployeesList() {
  const wrap = document.getElementById("employees-list");
  try {
    state.employees = await apiGet("getEmployees");
    wrap.innerHTML = "";
    state.employees.forEach(emp => {
      const row = document.createElement("div");
      row.className = "list-row";
      row.innerHTML = `
        <div class="main">
          <div class="title">${emp.name}</div>
          <div class="sub">${emp.id} · ${emp.role === "admin" ? "ผู้ดูแลระบบ" : "พนักงาน"} · ${emp.status}</div>
        </div>`;
      wrap.appendChild(row);
    });
  } catch (err) { wrap.innerHTML = '<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>'; }
}
document.getElementById("btn-add-employee").addEventListener("click", () => openModal("modal-employee"));
document.getElementById("form-add-employee").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await submitWithLock(e.target, "addEmployee", {
    name: document.getElementById("ne-name").value,
    pin: document.getElementById("ne-pin").value,
    role: document.getElementById("ne-role").value,
  });
  if (res.ok) {
    toast("เพิ่มพนักงานเรียบร้อย");
    e.target.reset();
    closeModal("modal-employee");
    loadEmployeesList();
  } else toast(res.error || "เพิ่มพนักงานไม่สำเร็จ", true);
});

// ============================================================
// ติดตั้งเป็นแอป (PWA install prompt)
// ============================================================
let deferredInstallPrompt = null;
const btnInstall = document.getElementById("btn-install");

function isRunningAsInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isRunningAsInstalledApp()) btnInstall.classList.remove("hidden");
});

btnInstall.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    toast("เบราว์เซอร์นี้ยังไม่รองรับการติดตั้งอัตโนมัติ ลองเปิดเมนูเบราว์เซอร์แล้วเลือก 'เพิ่มลงหน้าจอโฮม'");
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === "accepted") toast("กำลังติดตั้งแอป…");
  deferredInstallPrompt = null;
  btnInstall.classList.add("hidden");
});

window.addEventListener("appinstalled", () => {
  btnInstall.classList.add("hidden");
  toast("ติดตั้งแอปเรียบร้อยแล้ว");
});

// ============================================================
// INIT
// ============================================================
(function init() {
  renderPinDots();
  loadEmployeesForLogin();

  if (isRunningAsInstalledApp()) btnInstall.classList.add("hidden");

  const saved = localStorage.getItem("2kor_employee");
  if (saved) {
    try { state.employee = JSON.parse(saved); enterApp(); } catch (e) { /* ignore */ }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
