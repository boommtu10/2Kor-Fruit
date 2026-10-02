/* ============================================================
   2 กอ ผลไม้ปอกพร้อมทาน — app.js
   เชื่อมต่อกับ Google Apps Script Web App (GAS_URL ใน config.js)
   ============================================================ */

const state = {
  employee: null,     // {id, name, role}
  pin: "",
  products: [],
  employees: [],
  codes: [],            // Code บรรจุภัณฑ์ที่ตั้งไว้ล่วงหน้า (ดู "จัดการ Code" + โหมดขาย)
  adjustTarget: null,   // สินค้าที่กำลังจะปรับคงเหลือ {id, name, stock, unit}
  lowStockList: [],     // รายการสินค้าใกล้หมดล่าสุด (ดึงครั้งเดียว ใช้ทั้งการ์ดหน้าหลัก
                         // และหน้า "ดูทั้งหมด" กันยิง API ซ้ำโดยไม่จำเป็น)
  menus: [],             // เมนูขายทั้งหมด รวมที่ซ่อนไว้ — ใช้ในหลังบ้าน (จัดการเมนูขาย)
  menuCategories: [],    // รายชื่อหมวดเมนู (โหลดครั้งเดียวตอนเปิดแอป)
  salesMenus: [],        // เมนูขายเฉพาะที่ "แสดง" — ใช้ในหน้าโหมดขาย
  salesChannel: "",      // ช่องทางที่เลือกไว้ในหน้าโหมดขาย (เลือกครั้งเดียวต่อรอบ)
  pendingSaleItems: null, // รายการทั้งหมดที่กำลังรอยืนยันใน modal-sale-summary [{tile, menu, qty, price}, ...]
  menuImageDataUrl: "",  // รูปที่เลือก/ย่อแล้ว รอบันทึกในฟอร์มเพิ่ม/แก้ไขเมนู
};

// ช่องทางการจำหน่าย ต้องตรงกับ data-channel ของปุ่ม .sm-channel-chip ใน
// index.html และ SALES_CHANNELS ฝั่ง Code.gs — ใช้แมปไปหา key ราคาที่ตั้งไว้
// ต่อเมนู 1 รายการ (ดู getMenuPriceForChannel ด้านล่าง)
const CHANNEL_PRICE_KEY = { "หน้าบ้าน": "priceFront", "จ๊ะนวล": "priceJanuan", "Line Man": "priceLineman" };
// คืนราคาตายตัวของเมนู m สำหรับช่องทาง channel ถ้าไม่ได้ตั้งไว้ (หรือช่องทาง
// ไม่รู้จัก) คืนค่าว่าง '' ให้พนักงานกรอกเองตอนขายเหมือนเดิม
function getMenuPriceForChannel(m, channel) {
  const key = CHANNEL_PRICE_KEY[channel];
  if (!key || !m) return "";
  const v = m[key];
  return (v === "" || v === undefined || v === null) ? "" : v;
}

// รายชื่อ view ที่อยู่ในกลุ่มเมนู "สต๊อก" (ใช้ตอนกางเมนูย่อยอัตโนมัติ)
// หมายเหตุ: เอา "stockin" ออกแล้ว เพราะรวมเข้ากับ "เพิ่มสินค้า" (modal) ไปแล้ว
const STOCK_GROUP_VIEWS = ["products", "stockcut"];
// กลุ่มเมนู "บันทึกขาย" — แยก "จัดการ Code" ออกมาเป็นหน้าย่อยต่างหาก ไม่ให้
// อยู่บนหน้าบันทึกขายเหมือนเดิม เพราะรายการ Code ที่ยาวขึ้นเรื่อยๆ จะดันฟอร์ม
// บันทึกขายให้ตกลงไปด้านล่าง กรอกข้อมูลไม่สะดวก
const SALES_GROUP_VIEWS = ["codes", "menus"];
// รวมทุกกลุ่มเมนูไว้ที่เดียว เผื่อมีกลุ่มเพิ่มในอนาคตแค่มาต่อ array ตรงนี้พอ
const SIDEBAR_GROUPS = [
  { id: "group-stock", views: STOCK_GROUP_VIEWS },
  { id: "group-sales", views: SALES_GROUP_VIEWS },
];

// ---------------- API helper ----------------
// หมายเหตุ: POST ไม่ตั้ง header Content-Type เอง เพื่อเลี่ยงปัญหา
// CORS preflight กับ Apps Script (ฝั่ง GAS จะ JSON.parse(e.postData.contents) เอง)
// token คือ "บัตรผ่าน" ที่เซิร์ฟเวอร์ให้ตอนล็อกอินสำเร็จ (เก็บอยู่ใน
// state.employee.token ซึ่งถูกเซฟลง localStorage อยู่แล้วโดยโค้ดเดิม)
function authToken() {
  return state.employee && state.employee.token ? state.employee.token : "";
}

// ถ้าเซิร์ฟเวอร์ตอบว่าบัตรผ่านหมดอายุ/ไม่มี ให้เด้งกลับหน้าล็อกอินทันที
// เช็ค state.employee ก่อน เพื่อไม่ให้คำขอหลายอันที่พังพร้อมกัน
// สั่ง logout ซ้ำหลายรอบ
function checkAuth(data) {
  if (data && data.code === "AUTH" && state.employee) {
    toast("หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่", true);
    logout();
  }
  return data;
}

async function apiGet(action, params) {
  const qs = new URLSearchParams({ action, token: authToken(), ...(params || {}) }).toString();
  const res = await fetch(`${GAS_URL}?${qs}`, { method: "GET" });
  return checkAuth(await res.json());
}
async function apiPost(action, payload) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    body: JSON.stringify({ action, token: authToken(), ...(payload || {}) }),
  });
  return checkAuth(await res.json());
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

// ---------------- Export CSV ----------------
// ใช้ร่วมกันทั้งหน้า "สถิติ" และหน้า "สรุปยอด" — แปลง array ของแถว (แต่ละแถว
// เป็น array ของค่า) ให้เป็นไฟล์ .csv แล้วสั่งดาวน์โหลดผ่านเบราว์เซอร์ทันที
// ไม่ต้องยิง request ไปหา Apps Script เพิ่ม เพราะข้อมูลที่จะ Export มีอยู่ใน
// หน้าเว็บอยู่แล้ว (โหลดมาแสดงผลไปแล้วตอนนี้)
function csvEscape(val) {
  const s = val === null || val === undefined ? "" : String(val);
  // ค่าที่มี comma / ขึ้นบรรทัดใหม่ / เครื่องหมายคำพูด ต้องครอบด้วย " "
  // และ escape เครื่องหมายคำพูดข้างในเป็น "" ตามมาตรฐาน CSV ไม่งั้นเปิดใน
  // Excel แล้วคอลัมน์จะเลื่อนเพี้ยน
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCSV(rows) {
  return rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
}
// ตัดอักขระที่ใช้เป็นชื่อไฟล์ไม่ได้ออก (ชื่อไฟล์ภาษาไทยใช้ได้ปกติ แค่กัน
// เครื่องหมายที่มักหลุดมาจากช่วงวันที่ เช่น "ถึง"/ช่องว่าง ให้อ่านง่ายขึ้น)
function sanitizeFilename(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}
function downloadCSV(filename, rows) {
  // เติม BOM (\uFEFF) นำหน้าเสมอ ไม่งั้น Excel เปิดไฟล์ CSV ภาษาไทยแล้ว
  // ตัวอักษรจะเพี้ยนเป็นตัวอักษรมั่ว (ปัญหา encoding UTF-8 ที่พบบ่อยมาก)
  const csv = "\uFEFF" + toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFilename(filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
      routeAfterLogin();
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
  state.pendingSaleItems = null;
  renderPinDots();
  hideAllScreens();
  document.getElementById("login-screen").classList.remove("hidden");
  loadEmployeesForLogin();
}
document.getElementById("btn-logout").addEventListener("click", logout);
document.getElementById("btn-mode-select-logout").addEventListener("click", logout);
document.getElementById("btn-sm-logout").addEventListener("click", logout);

// ============================================================
// APP SHELL / ROUTING
// ============================================================
function enterApp() {
  hideAllScreens();
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("topbar-emp").textContent =
    state.employee.name + (state.employee.role === "admin" ? " · ผู้ดูแลระบบ" : " · พนักงาน");

  document.getElementById("fab-add-product").classList.toggle("hidden", state.employee.role !== "admin");
  document.getElementById("side-employees").classList.toggle("hidden", state.employee.role !== "admin");
  document.getElementById("side-menu-manage").classList.toggle("hidden", state.employee.role !== "admin");
  // ปุ่มสลับโหมดโชว์เฉพาะ admin เพราะมีแต่ admin ที่เลือกได้ 2 โหมด (พนักงาน
  // ทั่วไปเข้าโหมดขายตรงเสมอ ดู routeAfterLogin ด้านล่าง)
  document.getElementById("btn-switch-mode").classList.toggle("hidden", state.employee.role !== "admin");

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

  // auto-expand / highlight กลุ่มเมนูที่มี view ปัจจุบันอยู่ข้างใน (วนทุกกลุ่ม
  // ที่มีอยู่ ไม่ต้องเขียนซ้ำทีละกลุ่มเหมือนเดิม)
  SIDEBAR_GROUPS.forEach(g => {
    const el = document.getElementById(g.id);
    if (!el) return;
    const isActive = g.views.includes(name);
    el.classList.toggle("has-active", isActive);
    if (isActive) el.classList.add("expanded");
  });

  closeMobileSidebar();

  if (name === "dashboard") loadDashboard();
  if (name === "products") renderProductsList();
  if (name === "stockcut") { /* selects already filled via fillProductSelects */ }
  if (name === "codes") loadCodes();
  if (name === "menus") loadMenusAdmin();
  if (name === "summary") loadSummary();
  if (name === "stats") loadStats();
  if (name === "employees") loadEmployeesList();
  if (name === "lowstock-all") renderLowStockAll();
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
    state.lowStockList = low; // เก็บรายการเต็มไว้ ให้หน้า "ดูทั้งหมด" เอาไปใช้ต่อได้เลย ไม่ต้องยิง API ซ้ำ

    const card = document.getElementById("dash-lowstock-card");
    if (!low.length) { card.innerHTML = '<div class="empty-state">สต๊อกทุกอย่างปกติดี 👍</div>'; return; }

    card.innerHTML = "";
    // หน้าหลักโชว์แค่ 10 รายการแรกพอ กันไม่ให้การ์ดยาวจนต้องเลื่อนเยอะ
    // ถ้ามีมากกว่านั้นค่อยให้กดไปดูรายการที่เหลือในหน้าแยกต่างหาก
    low.slice(0, 10).forEach(p => card.appendChild(buildLowStockRow(p)));

    if (low.length > 10) {
      const more = document.createElement("div");
      more.className = "list-row";
      more.style.cursor = "pointer";
      more.dataset.goto = "lowstock-all";
      more.innerHTML = `<div class="main title">ดูทั้งหมด (${low.length} รายการ) ›</div>`;
      card.appendChild(more);
    }
  } catch (err) { /* เงียบไว้ ไม่รบกวนหน้าจอหลัก */ }
}

// สร้าง 1 แถวของรายการสินค้าใกล้หมด — แยกออกมาจาก refreshLowStock() เพราะ
// ใช้ซ้ำทั้งในการ์ดหน้าหลัก (10 แถวแรก) และหน้า "ดูทั้งหมด" (ทุกแถว)
function buildLowStockRow(p) {
  const row = document.createElement("div");
  row.className = "list-row";
  row.innerHTML = `
    <div class="slice-mark danger" style="width:34px;height:34px"></div>
    <div class="main">
      <div class="title">${p["ชื่อสินค้า"]}</div>
      <div class="sub">คงเหลือ ${p["สต๊อกปัจจุบัน"]} ${p["หน่วยนับ"]} (ขั้นต่ำ ${p["สต๊อกขั้นต่ำ"]})</div>
    </div>`;
  return row;
}

// หน้า "สินค้าใกล้หมดทั้งหมด" — ใช้ข้อมูลที่ refreshLowStock() ดึงมาแล้ว
// ไม่ยิง apiGet ซ้ำ เพราะเป็นข้อมูลชุดเดียวกัน แค่โชว์ครบทุกแถวแทนที่จะตัดที่ 10
function renderLowStockAll() {
  const wrap = document.getElementById("lowstock-all-list");
  const low = state.lowStockList;
  if (!low.length) { wrap.innerHTML = '<div class="empty-state">สต๊อกทุกอย่างปกติดี 👍</div>'; return; }
  wrap.innerHTML = "";
  low.forEach(p => wrap.appendChild(buildLowStockRow(p)));
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
// STOCK OUT (ตัดสต๊อกบรรจุภัณฑ์ตอนขาย) — ใช้ร่วมกับหน้า "จัดการ Code"
// และหน้าโหมดขาย (ดูส่วนท้ายไฟล์) ตัวฟอร์มกรอกเองแบบเดิมถูกเอาออกไปแล้ว
// เพราะตอนนี้การขายจริงทำผ่านโหมดขายเท่านั้น (ดู หน้าจัดการเมนูขาย +
// โหมดขาย ด้านล่าง) ฟังก์ชันที่เหลือในส่วนนี้ยังใช้ร่วมกับ "จัดการ Code"
// ============================================================

// วาด checkbox + ช่องจำนวนของบรรจุภัณฑ์ — ใช้ตอนตั้งค่า Code (code-packaging-list)
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
        <span>${p["ชื่อสินค้า"]}${p["หมวดหมู่"] === "อื่นๆ" ? ' <span class="hint">[อื่นๆ]</span>' : ""} ${statusLabel}</span>
      </label>
      <input type="number" class="pack-qty" data-pack-id="${p["รหัสสินค้า"]}" value="1" min="1" step="1" style="width:64px" disabled>
    `;
    wrap.appendChild(row);
  });
}

// ติ๊กแล้วเปิดช่องจำนวนให้แก้ไขได้ (ไม่ติ๊ก = ไม่ใช้ ไม่หักสต๊อก) — ใช้กับ
// รายการบรรจุภัณฑ์ตอนตั้งค่า Code เท่านั้น (ตอนขายจริงในโหมดขาย ไม่ต้องติ๊ก
// บรรจุภัณฑ์เอง เพราะหักตาม Code ที่ผูกไว้กับเมนูโดยอัตโนมัติอยู่แล้ว)
document.getElementById("code-packaging-list").addEventListener("change", (e) => {
  if (!e.target.classList.contains("pack-check")) return;
  const id = e.target.dataset.packId;
  const qtyInput = e.target.closest(".list-row").querySelector(`.pack-qty[data-pack-id="${id}"]`);
  if (qtyInput) qtyInput.disabled = !e.target.checked;
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

// หมวดสินค้าที่ผูกกับ Code เพื่อตัดสต๊อกอัตโนมัติตอนขายได้
const CODE_BINDABLE_CATEGORIES = ["บรรจุภัณฑ์", "อื่นๆ"];

// รายการบรรจุภัณฑ์สำหรับ "ตั้งค่า Code" — โชว์เฉพาะที่ยังมีของเหลือในสต๊อก
// (>0) เท่านั้น ตัวที่หมดแล้วไม่ต้องขึ้นให้เลือกใหม่ (ผูกไปก็ไม่มีของจริงจะหัก)
// ยกเว้นตอน "แก้ไข Code" ที่ตัวเดิมเคยผูกไว้แล้วดันหมดสต๊อกไปพอดี — จะยังโชว์
// แถวเดิมนั้นไว้ให้เห็น (มีป้ายบอกว่าหมดแล้ว) เพื่อให้ติ๊กออกหรือเปลี่ยนไป
// เลือกของใหม่แทนได้ ไม่ใช่หายไปเงียบๆ จนไม่รู้ว่า Code นี้ยังอ้างของเก่าอยู่
// boundItems = รายการบรรจุภัณฑ์ที่ Code นี้เคยผูกไว้ (ใช้ตอนแก้ไขเท่านั้น)
async function loadCodePackagingOptions(boundItems) {
  boundItems = Array.isArray(boundItems) ? boundItems : [];
  try {
    // ดึงสินค้าทั้งหมด แล้วกรองเองฝั่งหน้าเว็บ ให้เลือกผูกกับ Code ได้ทั้งหมวด
    // "บรรจุภัณฑ์" และหมวด "อื่นๆ" (เช่น ขนม เครื่องดื่ม ของแถม) ที่ยังมีของเหลือ
    // ไม่ใช้ getPackaging ของ Code.gs เพราะฝั่งนั้นน่าจะกรองเฉพาะ "บรรจุภัณฑ์"
    let all;
    try {
      all = await apiGet("getProducts");
      if (!Array.isArray(all)) throw new Error("bad response");
    } catch (e) {
      all = Array.isArray(state.products) ? state.products : [];
    }
    const inStock = all.filter(p =>
      CODE_BINDABLE_CATEGORIES.includes(p["หมวดหมู่"]) &&
      p["สถานะ"] !== "inactive" &&
      Number(p["สต๊อกปัจจุบัน"]) > 0
    );
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
    renderCodesList();
  } catch (err) { /* เงียบไว้ — โหมดขายจะยังพยายามใช้ state.codes เท่าที่มีอยู่เดิม */ }
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
// เมนูขาย (ปุ่มเมนูรูปภาพ) — จัดการในหลังบ้าน + ใช้แสดงในหน้าโหมดขาย
// ============================================================
// เผื่อ margin จากลิมิตฝั่ง Apps Script (ช่องชีตจุได้ 50,000 ตัวอักษร เผื่อไว้
// ที่ 48,000 ในโค้ดฝั่งเซิร์ฟเวอร์ ฝั่งนี้เผื่อเพิ่มอีกชั้นกันตัวเลขชนกันพอดี)
const MENU_IMAGE_MAX_CHARS = 46000;

// รายชื่อหมวดเมนูเป็นค่าคงที่ฝั่งเซิร์ฟเวอร์ (ดู MENU_CATEGORIES ใน Code.gs)
// โหลดครั้งเดียวตอนเปิดแอป ใช้ทั้งดรอปดาวตอนเพิ่ม/แก้ไขเมนู และจัดกลุ่มหัวข้อ
// ในหน้าโหมดขาย ไม่ฮาร์ดโค้ดซ้ำในไฟล์นี้ กันปัญหาตัวเลขหลุดกันแบบค่าคอม 32.10%
async function loadMenuCategories() {
  try {
    const cats = await apiGet("getMenuCategories");
    state.menuCategories = Array.isArray(cats) ? cats : [];
  } catch (err) { state.menuCategories = []; }
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}
function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("เปิดไฟล์รูปไม่สำเร็จ (ไฟล์อาจไม่ใช่รูปภาพ)"));
    img.src = src;
  });
}
// ย่อขนาด + ลดคุณภาพรูปด้วย canvas ของเบราว์เซอร์เอง (ไม่ต้องใช้ไลบรารีเพิ่ม)
// ลองสูงสุด 8 รอบ: ลดคุณภาพก่อน ถ้าคุณภาพต่ำสุดแล้วยังใหญ่เกิน ค่อยลดความกว้างรูป
async function resizeAndCompressImage(file) {
  const dataUrl = await fileToDataURL(file);
  const img = await loadImageEl(dataUrl);
  let width = 320;
  let quality = 0.82;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, width / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", quality);
    if (out.length <= MENU_IMAGE_MAX_CHARS) return out;
    if (quality > 0.5) quality -= 0.12; else width = Math.round(width * 0.85);
  }
  throw new Error("รูปนี้ย่อขนาดไม่พอ กรุณาลองรูปอื่น");
}

function setMenuImagePreview(dataUrl) {
  const img = document.getElementById("menu-image-preview");
  const ph = document.getElementById("menu-image-placeholder");
  const removeBtn = document.getElementById("btn-remove-menu-image");
  state.menuImageDataUrl = dataUrl || "";
  if (dataUrl) {
    img.src = dataUrl; img.classList.remove("hidden");
    ph.classList.add("hidden");
    removeBtn.classList.remove("hidden");
  } else {
    img.classList.add("hidden"); img.removeAttribute("src");
    ph.classList.remove("hidden");
    removeBtn.classList.add("hidden");
  }
}

document.getElementById("menu-image-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const hint = document.getElementById("menu-image-hint");
  hint.textContent = "กำลังย่อรูป…";
  try {
    const compressed = await resizeAndCompressImage(file);
    setMenuImagePreview(compressed);
    hint.textContent = `ย่อรูปแล้ว (ประมาณ ${Math.round(compressed.length / 1024)} KB)`;
  } catch (err) {
    toast(err.message || "ย่อรูปไม่สำเร็จ ลองรูปอื่น", true);
    hint.textContent = "เลือกรูปจากเครื่อง ระบบจะย่อขนาดให้อัตโนมัติ";
  } finally {
    e.target.value = ""; // เคลียร์ input ไว้ เผื่อจะเลือกไฟล์เดิมซ้ำเพื่อลองใหม่
  }
});
document.getElementById("btn-remove-menu-image").addEventListener("click", () => setMenuImagePreview(""));

function fillMenuCodeSelect(selectedCodeId) {
  const sel = document.getElementById("menu-code");
  const hint = document.getElementById("menu-code-hint");
  sel.innerHTML = "";
  if (!state.codes.length) {
    sel.innerHTML = '<option value="">— ยังไม่มี Code —</option>';
    hint.classList.remove("hidden");
    return;
  }
  hint.classList.add("hidden");
  state.codes.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id; opt.textContent = c.name;
    sel.appendChild(opt);
  });
  if (selectedCodeId) sel.value = selectedCodeId;
}

// รวมหมวดจาก 2 แหล่ง: ค่าคงที่ฝั่งเซิร์ฟเวอร์ (state.menuCategories) +
// หมวดที่เมนูที่มีอยู่แล้วใช้อยู่จริง (คอลัมน์ "หมวด" ในชีต เมนูขาย)
// ทำให้หมวดที่พิมพ์เพิ่มเองครั้งก่อน กลับมาโผล่ในดรอปดาวเองโดยไม่ต้องมีที่เก็บรายชื่อหมวดแยก
function getAllMenuCategories() {
  const all = [...state.menuCategories];
  [...state.menus, ...state.salesMenus].forEach(m => {
    if (m.category && !all.includes(m.category)) all.push(m.category);
  });
  return all;
}
function fillMenuCategorySelect(selectedCategory) {
  const sel = document.getElementById("menu-category");
  sel.innerHTML = "";
  getAllMenuCategories().forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat; opt.textContent = cat;
    sel.appendChild(opt);
  });
  // ตัวเลือกสุดท้าย: เลือกแล้วจะมีช่องพิมพ์ชื่อหมวดใหม่โผล่มา
  const addOpt = document.createElement("option");
  addOpt.value = "__new__"; addOpt.textContent = "+ เพิ่มหมวดใหม่…";
  sel.appendChild(addOpt);
  if (selectedCategory) sel.value = selectedCategory;
  const newInput = document.getElementById("menu-category-new");
  newInput.classList.add("hidden");
  newInput.value = "";
}
document.getElementById("menu-category").addEventListener("change", (e) => {
  const input = document.getElementById("menu-category-new");
  const isNew = e.target.value === "__new__";
  input.classList.toggle("hidden", !isNew);
  if (isNew) input.focus();
});

// เปิด modal เพิ่ม/แก้ไขเมนู — menu = null คือโหมด "เพิ่มใหม่" (ลำดับ/สถานะ
// กำหนดอัตโนมัติฝั่งเซิร์ฟเวอร์ จึงซ่อน 2 ช่องนี้ไว้ตอนเพิ่มใหม่)
function openMenuModal(menu) {
  const form = document.getElementById("form-add-menu");
  form.reset();
  document.getElementById("menu-id").value = menu ? menu.id : "";
  document.getElementById("modal-menu-title").textContent = menu ? "แก้ไขเมนูขาย" : "เพิ่มเมนูขาย";
  document.getElementById("menu-submit-btn").textContent = menu ? "บันทึกการแก้ไข" : "บันทึกเมนู";
  document.getElementById("menu-name").value = menu ? menu.name : "";
  document.getElementById("menu-packaging").value = menu ? (menu.packaging || "") : "";
  document.getElementById("menu-price-front").value = (menu && menu.priceFront !== "" && menu.priceFront !== undefined) ? menu.priceFront : "";
  document.getElementById("menu-price-januan").value = (menu && menu.priceJanuan !== "" && menu.priceJanuan !== undefined) ? menu.priceJanuan : "";
  document.getElementById("menu-price-lineman").value = (menu && menu.priceLineman !== "" && menu.priceLineman !== undefined) ? menu.priceLineman : "";
  document.getElementById("menu-order").value = menu ? menu.order : "";
  document.getElementById("menu-order-field").classList.toggle("hidden", !menu);
  document.getElementById("menu-status-field").classList.toggle("hidden", !menu);
  if (menu) document.getElementById("menu-status").value = menu.status;
  fillMenuCategorySelect(menu ? menu.category : "");
  fillMenuCodeSelect(menu ? menu.codeId : "");
  setMenuImagePreview(menu ? menu.image : "");
  openModal("modal-menu");
}
document.getElementById("btn-add-menu").addEventListener("click", () => {
  if (!state.codes.length) { toast('ยังไม่มี Code — ไปสร้างที่ "จัดการ Code" ก่อน', true); return; }
  openMenuModal(null);
});

document.getElementById("form-add-menu").addEventListener("submit", async (e) => {
  e.preventDefault();
  const menuId = document.getElementById("menu-id").value;
  const name = document.getElementById("menu-name").value.trim();
  const packaging = document.getElementById("menu-packaging").value.trim();
  // ถ้าเลือก "+ เพิ่มหมวดใหม่…" ให้ใช้ชื่อที่พิมพ์ในช่องแทน
  let category = document.getElementById("menu-category").value;
  if (category === "__new__") category = document.getElementById("menu-category-new").value.trim();
  if (!category) return toast("กรุณาเลือกหรือพิมพ์หมวด", true);
  const codeId = document.getElementById("menu-code").value;
  if (!codeId) return toast("กรุณาเลือก Code", true);
  // แต่ละช่องทางเว้นว่างได้ (ราคาไม่คงที่) พนักงานจะกรอกเองตอนขายช่องทางนั้น
  const priceFrontVal = document.getElementById("menu-price-front").value;
  const priceJanuanVal = document.getElementById("menu-price-januan").value;
  const priceLinemanVal = document.getElementById("menu-price-lineman").value;
  const orderVal = document.getElementById("menu-order").value;

  const payload = {
    name, packaging, category,
    priceFront: priceFrontVal, priceJanuan: priceJanuanVal, priceLineman: priceLinemanVal,
    codeId, image: state.menuImageDataUrl || ""
  };
  if (menuId) {
    payload.menuId = menuId;
    payload.status = document.getElementById("menu-status").value;
  } else {
    payload.employee = state.employee.name;
  }
  if (orderVal !== "") payload.order = orderVal;

  const res = await submitWithLock(e.target, menuId ? "updateMenu" : "addMenu", payload);
  if (res.ok) {
    toast(menuId ? "แก้ไขเมนูเรียบร้อย" : "เพิ่มเมนูเรียบร้อย");
    closeModal("modal-menu");
    // จำหมวดใหม่ไว้ทันที ให้โผล่ในดรอปดาวรอบถัดไปแม้ยังไม่รีโหลดหน้า
    if (!state.menuCategories.includes(category)) state.menuCategories.push(category);
    loadMenusAdmin();
  } else toast(res.error || "บันทึกเมนูไม่สำเร็จ", true);
});

async function loadMenusAdmin() {
  const wrap = document.getElementById("menus-list");
  try {
    const list = await apiGet("getMenus", { includeHidden: "1" });
    state.menus = Array.isArray(list) ? list : [];
    renderMenusAdminList();
  } catch (err) { wrap.innerHTML = '<div class="empty-state">โหลดเมนูไม่สำเร็จ</div>'; }
}

// สรุปราคาทั้ง 3 ช่องทางเป็นข้อความเดียว เช่น "หน้าบ้าน 35 · จ๊ะนวล 30 ·
// Line Man กรอกเอง" ช่องทางไหนไม่ได้ตั้งราคาตายตัวไว้จะโชว์ "กรอกเอง"
function formatMenuPrices(m) {
  return Object.keys(CHANNEL_PRICE_KEY).map(ch => {
    const v = getMenuPriceForChannel(m, ch);
    return `${ch} ${v === "" ? "กรอกเอง" : money(v)}`;
  }).join(" · ");
}

function renderMenusAdminList() {
  const wrap = document.getElementById("menus-list");
  if (!state.menus.length) {
    wrap.innerHTML = '<div class="empty-state">ยังไม่มีเมนู — กด "+ เพิ่มเมนู" เพื่อสร้างอันแรก</div>';
    return;
  }
  wrap.innerHTML = "";
  state.menus.forEach(m => {
    const code = state.codes.find(c => c.id === m.codeId);
    const priceText = formatMenuPrices(m);
    const row = document.createElement("div");
    row.className = "mm-row";
    row.innerHTML = `
      ${m.image ? `<img src="${m.image}" alt="">` : `<div class="ph">🍉</div>`}
      <div class="info">
        <div class="title">${m.displayName}</div>
        <div class="sub">${m.category || "-"} · ${code ? code.name : "(ไม่พบ Code นี้แล้ว)"} · ${priceText}</div>
        <div class="sub ${m.status === "hidden" ? "hidden-badge" : ""}">${m.status === "hidden" ? "ซ่อนอยู่" : "แสดงอยู่ในหน้าขาย"} · ลำดับ ${m.order}</div>
      </div>
      <div class="acts">
        <button type="button" class="btn-edit-menu" data-menu-id="${m.id}">แก้ไข</button>
        <button type="button" class="btn-toggle-menu" data-menu-id="${m.id}" data-next="${m.status === "hidden" ? "active" : "hidden"}">${m.status === "hidden" ? "เปิดแสดง" : "ซ่อน"}</button>
      </div>`;
    wrap.appendChild(row);
  });
}
document.getElementById("menus-list").addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".btn-edit-menu");
  if (editBtn) {
    const m = state.menus.find(x => x.id === editBtn.dataset.menuId);
    if (m) openMenuModal(m);
    return;
  }
  const toggleBtn = e.target.closest(".btn-toggle-menu");
  if (toggleBtn) {
    const res = await apiPost("updateMenu", { menuId: toggleBtn.dataset.menuId, status: toggleBtn.dataset.next });
    if (res.ok) loadMenusAdmin(); else toast(res.error || "แก้ไขไม่สำเร็จ", true);
  }
});

// ============================================================
// เลือกโหมด (หลังบ้าน / ขายสินค้า) + โหมดขาย (เต็มจอ ปุ่มรูปภาพขยายได้)
// ============================================================
// พนักงานทั่วไป (role !== admin) เข้าโหมดขายตรงเสมอ ไม่ต้องเลือก — มีแต่ admin
// ที่เห็นหน้าเลือกโหมด และระบบจำโหมดล่าสุดที่เลือกไว้ (ต่ออุปกรณ์ ไม่ใช่ต่อคน)
// ไว้ใน localStorage คีย์ "2kor_last_mode" ล็อกอินครั้งถัดไปจะเข้าโหมดเดิมทันที
function hideAllScreens() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("mode-select-screen").classList.add("hidden");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("sales-screen").classList.add("hidden");
}

function routeAfterLogin() {
  if (state.employee.role !== "admin") { enterSalesMode(); return; }
  const last = localStorage.getItem("2kor_last_mode");
  if (last === "sales") enterSalesMode();
  else if (last === "backoffice") enterApp();
  else showModeSelect();
}

function showModeSelect() {
  hideAllScreens();
  document.getElementById("mode-select-screen").classList.remove("hidden");
  document.getElementById("mode-select-emp").textContent = state.employee.name;
}
document.getElementById("btn-mode-sales").addEventListener("click", () => {
  localStorage.setItem("2kor_last_mode", "sales");
  enterSalesMode();
});
document.getElementById("btn-mode-backoffice").addEventListener("click", () => {
  localStorage.setItem("2kor_last_mode", "backoffice");
  enterApp();
});

function switchMode() { showModeSelect(); }
document.getElementById("btn-switch-mode").addEventListener("click", switchMode);
document.getElementById("btn-sm-switch-mode").addEventListener("click", switchMode);

async function enterSalesMode() {
  hideAllScreens();
  document.getElementById("sales-screen").classList.remove("hidden");
  document.getElementById("sm-emp").textContent = state.employee.name;
  // ปุ่มสลับกลับหลังบ้านโชว์เฉพาะ admin (พนักงานทั่วไปไม่มีสิทธิ์เข้าหลังบ้าน)
  document.getElementById("btn-sm-switch-mode").classList.toggle("hidden", state.employee.role !== "admin");

  state.salesChannel = localStorage.getItem("2kor_sales_channel") || "";
  updateSalesChannelUI();

  document.getElementById("sm-menu-grid").innerHTML = '<div class="empty-state">กำลังโหลดเมนู…</div>';
  await Promise.all([loadCodes(), loadMenusForSales()]);
}

function updateSalesChannelUI() {
  document.querySelectorAll(".sm-channel-chip").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.channel === state.salesChannel)
  );
}
document.getElementById("sm-channel-options").addEventListener("click", (e) => {
  const btn = e.target.closest(".sm-channel-chip");
  if (!btn) return;
  state.salesChannel = btn.dataset.channel;
  localStorage.setItem("2kor_sales_channel", state.salesChannel);
  updateSalesChannelUI();
  // ราคาตายตัวของแต่ละเมนูขึ้นกับช่องทาง ต้องวาดการ์ดใหม่ทั้งหมดเพื่อให้ราคา
  // ที่เติมอัตโนมัติในช่องยังไม่กดยืนยันตรงกับช่องทางที่เพิ่งเลือก (การ์ดที่
  // เปิดค้างอยู่จะถูกยุบกลับเป็นปิดไปด้วย เพราะสลับช่องทางกลางคันไม่ควรเกิดขึ้น
  // บ่อย — ปกติเลือกช่องทางครั้งเดียวตอนเริ่มขายรอบนั้น)
  if (state.salesMenus.length) renderSalesMenuGrid();
});

async function loadMenusForSales() {
  const wrap = document.getElementById("sm-menu-grid");
  try {
    const list = await apiGet("getMenus"); // ไม่ส่ง includeHidden -> เฉพาะเมนูที่ "แสดง" เท่านั้น
    state.salesMenus = Array.isArray(list) ? list : [];
    renderSalesMenuGrid();
  } catch (err) { wrap.innerHTML = '<div class="empty-state">โหลดเมนูไม่สำเร็จ</div>'; }
}

// ปุ่มเมนู 1 ปุ่ม = การ์ดที่ "ขยายได้" แตะรูปแล้วเผยช่องจำนวน+ราคาด้านใน
// (ราคาเติมอัตโนมัติถ้าตั้งราคาตายตัวไว้แล้วจากหลังบ้าน) เปิดได้พร้อมกันได้
// หลายใบ ปุ่ม "ยืนยันการขาย" ของแต่ละใบทำงานอิสระจากกัน ไม่มีตะกร้ารวม —
// จะบันทึกทันทีทีละรายการ หรือเปิดค้างไว้หลายใบแล้วมากดยืนยันรวดเดียวตอน
// ปิดร้านก็ได้ตามที่ทางร้านสะดวก
function buildSalesMenuTile(m) {
  const tile = document.createElement("div");
  tile.className = "sm-tile";
  tile.dataset.menuId = m.id;
  // ราคาเติมอัตโนมัติตามช่องทางที่เลือกไว้ (state.salesChannel) ถ้าเมนูนี้
  // ตั้งราคาตายตัวไว้สำหรับช่องทางนั้น ถ้าไม่ได้ตั้งไว้จะเว้นว่างให้กรอกเอง
  const price = getMenuPriceForChannel(m, state.salesChannel);
  const hasPrice = price !== "";
  tile.innerHTML = `
    <button type="button" class="sm-menu-btn">
      ${m.image ? `<img src="${m.image}" alt="">` : `<div class="ph">🍉</div>`}
      <div class="nm">${m.displayName}</div>
    </button>
    <div class="sm-tile-expand hidden">
      <button type="button" class="sm-tile-close" title="ยกเลิก">✕</button>
      <div class="sm-tile-fields">
        <input type="number" class="sm-tile-qty" min="0.01" step="any" placeholder="จำนวน">
        <input type="number" class="sm-tile-price" min="0" step="any" placeholder="ราคา/หน่วย" value="${hasPrice ? price : ""}">
      </div>
      <div class="sm-tile-err hidden"></div>
      <button type="button" class="sm-tile-confirm hidden">ยืนยันการขาย</button>
    </div>`;
  return tile;
}
function renderSalesMenuGrid() {
  const wrap = document.getElementById("sm-menu-grid");
  if (!state.salesMenus.length) {
    wrap.innerHTML = '<div class="empty-state">ยังไม่มีเมนู — ให้ผู้ดูแลระบบไปเพิ่มที่หลังบ้าน &gt; จัดการเมนูขาย</div>';
    return;
  }
  // จัดกลุ่มตามหมวด เรียงตามลำดับหมวดที่ตั้งไว้ (state.menuCategories) เมนูที่
  // ไม่มีหมวด (ข้อมูลเก่าก่อนมีฟีเจอร์นี้) จะถูกจัดไว้ในกลุ่ม "อื่นๆ" ท้ายสุด
  // หมวดที่พิมพ์เพิ่มเอง (ไม่อยู่ใน state.menuCategories) จะไปต่อท้ายตามลำดับที่พบ
  const order = state.menuCategories.length
    ? state.menuCategories
    : [...new Set(state.salesMenus.map(m => m.category).filter(Boolean))];
  const groups = {};
  state.salesMenus.forEach(m => { const c = m.category || "อื่นๆ"; (groups[c] = groups[c] || []).push(m); });
  const catList = [...order.filter(c => groups[c]), ...Object.keys(groups).filter(c => !order.includes(c))];

  wrap.innerHTML = "";
  catList.forEach(cat => {
    const heading = document.createElement("div");
    heading.className = "sm-cat-heading";
    heading.textContent = cat;
    wrap.appendChild(heading);
    groups[cat].forEach(m => wrap.appendChild(buildSalesMenuTile(m)));
  });
}

function openSaleTile(tile) {
  const expand = tile.querySelector(".sm-tile-expand");
  if (!expand.classList.contains("hidden")) return; // เปิดอยู่แล้ว ไม่ต้องทำซ้ำ
  expand.classList.remove("hidden");
  tile.classList.add("open");
  updateTileConfirmVisibility(tile);
  setTimeout(() => tile.querySelector(".sm-tile-qty").focus(), 60);
}
function collapseSaleTile(tile) {
  tile.querySelector(".sm-tile-expand").classList.add("hidden");
  tile.classList.remove("open");
  const menu = state.salesMenus.find(m => m.id === tile.dataset.menuId);
  const price = getMenuPriceForChannel(menu, state.salesChannel);
  tile.querySelector(".sm-tile-qty").value = "";
  tile.querySelector(".sm-tile-price").value = price !== "" ? price : "";
  hideTileError(tile);
  tile.querySelector(".sm-tile-confirm").classList.add("hidden");
}
// ปุ่ม "ยืนยันการขาย" จะโผล่มาก็ต่อเมื่อกรอกจำนวนแล้วเท่านั้น (ราคาส่วนใหญ่
// เติมอัตโนมัติไว้ก่อนแล้ว แต่ถ้าเมนูไหนไม่ได้ตั้งราคาตายตัว จะเช็กราคาอีกที
// ตอนกดยืนยัน ไม่ปล่อยให้กดไปโดยไม่มีราคา)
function updateTileConfirmVisibility(tile) {
  const qty = tile.querySelector(".sm-tile-qty").value;
  tile.querySelector(".sm-tile-confirm").classList.toggle("hidden", !(qty !== "" && Number(qty) > 0));
}
function showTileError(tile, msg) {
  const err = tile.querySelector(".sm-tile-err");
  err.textContent = msg; err.classList.remove("hidden");
}
function hideTileError(tile) {
  tile.querySelector(".sm-tile-err").classList.add("hidden");
}

document.getElementById("sm-menu-grid").addEventListener("click", (e) => {
  const closeBtn = e.target.closest(".sm-tile-close");
  if (closeBtn) { collapseSaleTile(closeBtn.closest(".sm-tile")); return; }

  const confirmBtn = e.target.closest(".sm-tile-confirm");
  if (confirmBtn) { openSaleSummary(); return; }

  const menuBtn = e.target.closest(".sm-menu-btn");
  if (menuBtn) {
    if (!state.salesChannel) { toast("กรุณาเลือกช่องทางการจำหน่ายก่อน", true); return; }
    openSaleTile(menuBtn.closest(".sm-tile"));
  }
});
document.getElementById("sm-menu-grid").addEventListener("input", (e) => {
  const tile = e.target.closest(".sm-tile");
  if (!tile) return;
  if (e.target.classList.contains("sm-tile-qty")) updateTileConfirmVisibility(tile);
  if (e.target.classList.contains("sm-tile-qty") || e.target.classList.contains("sm-tile-price")) hideTileError(tile);
});

// รวบรวมทุกการ์ดที่กำลังเปิดอยู่ (ไม่ว่าจะเปิดไว้กี่ใบพร้อมกัน) และกรอกจำนวน
// ไว้แล้ว มาเป็นรายการเดียวกัน ไม่ใช่แค่ใบที่กด "ยืนยันการขาย" — เพราะพนักงาน
// มักเปิดหลายใบพร้อมกันตอนลูกค้าซื้อหลายอย่างในบิลเดียว แล้วค่อยมากดยืนยัน
// รวดเดียวตอนคิดเงิน ใบที่เปิดไว้แต่ยังไม่ได้กรอกจำนวนเลย (แค่เปิดดูเฉยๆ)
// จะไม่ถูกนับเข้ามา ส่วนใบที่กรอกจำนวนแล้วแต่ลืมใส่ราคา จะโชว์ error ในใบนั้น
// และ "บล็อก" ไม่ให้เปิดหน้าสรุปจนกว่าจะแก้ไขให้ครบทุกใบก่อน
function collectPendingSaleItems() {
  const items = [];
  let blocked = false;
  document.querySelectorAll("#sm-menu-grid .sm-tile").forEach((tile) => {
    const expand = tile.querySelector(".sm-tile-expand");
    if (expand.classList.contains("hidden")) return; // ยังไม่เปิด ไม่นับ
    const qty = tile.querySelector(".sm-tile-qty").value;
    if (!(qty !== "" && Number(qty) > 0)) return; // เปิดดูเฉยๆ ยังไม่กรอกจำนวน ไม่นับ
    hideTileError(tile);
    const price = tile.querySelector(".sm-tile-price").value;
    const menu = state.salesMenus.find((m) => m.id === tile.dataset.menuId);
    if (!menu) return;
    if (price === "") {
      showTileError(tile, "กรุณาใส่ราคา (ใส่ 0 ได้ถ้าแจกฟรี)");
      blocked = true;
      return;
    }
    items.push({ tile, menu, qty, price });
  });
  return { items, blocked };
}

// วาดรายการทั้งหมดในหน้าสรุป (ทีละใบ + ยอดรวมทั้งหมดด้านล่าง)
function renderSaleSummaryList(items) {
  const wrap = document.getElementById("summary-items-list");
  wrap.innerHTML = items
    .map((p) => {
      const total = computeSaleTotal(p.qty, p.price, state.salesChannel);
      return `
      <div class="list-row">
        <div class="main"><div class="title">${p.menu.displayName}</div><div class="sub">${state.salesChannel} · ${p.qty} x ${money(p.price)}</div></div>
        <div class="trail">${money(total)}</div>
      </div>`;
    })
    .join("");
  const grand = items.reduce((sum, p) => sum + computeSaleTotal(p.qty, p.price, state.salesChannel), 0);
  document.getElementById("summary-grand-total").textContent = money(grand);
}

// กด "ยืนยันการขาย" บนการ์ดใบไหนก็ได้ -> รวบรวมทุกใบที่เปิดและกรอกจำนวนไว้
// แล้วทั้งหมด มาสรุปรวมเป็น popup เดียว ให้ยืนยันอีกครั้งก่อนบันทึกจริง (กัน
// กดพลาด/เลขผิดตอนรีบๆ) การบันทึกจริงเกิดขึ้นตอนกด "บันทึกการขาย" ใน popup
// เท่านั้น
function openSaleSummary() {
  const { items, blocked } = collectPendingSaleItems();
  if (blocked) return; // มีบางใบไม่ได้ใส่ราคา ให้แก้ก่อน (โชว์ error ในใบนั้นแล้ว)
  if (!items.length) return; // ไม่ควรเกิด เพราะปุ่มโผล่เฉพาะตอนกรอกจำนวนในใบนั้นแล้ว

  state.pendingSaleItems = items;
  renderSaleSummaryList(items);
  openModal("modal-sale-summary");
}
document.getElementById("btn-summary-back").addEventListener("click", () => closeModal("modal-sale-summary"));

// บันทึกทีละรายการเรียงตามลำดับ (รอผลของอันก่อนหน้าก่อนเริ่มอันถัดไป) แทนที่
// จะยิงพร้อมกันทั้งหมด เพื่อไม่ให้ชนคิวกันเองฝั่งเซิร์ฟเวอร์โดยไม่จำเป็น ถ้า
// บางรายการบันทึกไม่สำเร็จ (เช่น เน็ตหลุดกลางทาง) รายการที่สำเร็จไปแล้วจะถูก
// ปิดการ์ดให้เรียบร้อย ส่วนรายการที่พลาดจะโชว์ error ค้างไว้ในการ์ดนั้นให้กด
// ยืนยันใหม่อีกครั้งได้ ไม่ต้องกรอกใหม่ทั้งหมด
document.getElementById("btn-confirm-sale-summary").addEventListener("click", async () => {
  const items = state.pendingSaleItems;
  if (!items || !items.length) return;
  const btn = document.getElementById("btn-confirm-sale-summary");
  const backBtn = document.getElementById("btn-summary-back");
  btn.disabled = true;
  backBtn.disabled = true;

  const lowStockAll = new Set();
  const failed = [];
  for (const p of items) {
    const code = state.codes.find((c) => c.id === p.menu.codeId);
    const packaging = code ? code.packaging.map((x) => ({ productId: x.productId, qty: x.qty })) : [];
    const res = await apiPost("stockOut", {
      itemName: p.menu.displayName,
      code: code ? code.name : "",
      channel: state.salesChannel,
      qty: p.qty,
      sellPrice: p.price,
      packaging,
      employee: state.employee.name,
    });
    if (res.ok) {
      collapseSaleTile(p.tile);
      (res.lowStock || []).forEach((x) => lowStockAll.add(x));
    } else {
      failed.push({ menu: p.menu, error: res.error || "บันทึกไม่สำเร็จ" });
      showTileError(p.tile, res.error || "บันทึกไม่สำเร็จ");
    }
  }

  btn.disabled = false;
  backBtn.disabled = false;
  closeModal("modal-sale-summary");
  state.pendingSaleItems = null;

  if (failed.length) {
    toast(`บันทึกไม่สำเร็จ ${failed.length} รายการ (${failed.map((f) => f.menu.displayName).join(", ")}) — รายการที่เหลือบันทึกให้แล้ว แก้ไขแล้วกดยืนยันใหม่ได้`, true);
  } else {
    toast(lowStockAll.size ? `บันทึกแล้ว — บรรจุภัณฑ์ใกล้หมด: ${[...lowStockAll].join(", ")}` : "บันทึกการขายเรียบร้อย");
  }
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
let lastSummary = null; // ผลลัพธ์ getSummary ล่าสุดที่โหลดมา ใช้ตอนกด Export (ไม่ต้องยิง API ซ้ำ)

// สลับว่าจะโชว์ช่องไหน: "รายวัน" ใช้ input type=date เลือกได้ทีละวัน,
// "รายเดือน" ใช้ input type=month เลือกได้ทีละเดือน (browser จะมีปุ่มเลื่อน
// เดือนก่อน-หลังให้เองในตัว ไม่ต้องเลือกวันที่แล้วมานั่งเดาว่าอยู่เดือนไหน
// แบบเดิม), "ช่วงวันที่" ใช้ช่องจากวัน-ถึงวัน
function updateSummaryDateInputs() {
  const isDay = currentPeriod === "day";
  const isMonth = currentPeriod === "month";
  const isRange = currentPeriod === "range";
  document.getElementById("summary-date-wrap").classList.toggle("hidden", !isDay);
  document.getElementById("summary-month-wrap").classList.toggle("hidden", !isMonth);
  document.getElementById("summary-range-wrap").classList.toggle("hidden", !isRange);
}

document.querySelectorAll(".toggle-group [data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".toggle-group [data-period]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    updateSummaryDateInputs();
    loadSummary();
  });
});
document.getElementById("summary-date").addEventListener("change", loadSummary);
document.getElementById("summary-month").addEventListener("change", loadSummary);
document.getElementById("summary-start-date").addEventListener("change", loadSummary);
document.getElementById("summary-end-date").addEventListener("change", loadSummary);

async function loadSummary() {
  const dateInput = document.getElementById("summary-date");
  const monthInput = document.getElementById("summary-month");
  const startInput = document.getElementById("summary-start-date");
  const endInput = document.getElementById("summary-end-date");
  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthStr = todayStr.slice(0, 7); // yyyy-MM
  if (!dateInput.value) dateInput.value = todayStr;
  if (!monthInput.value) monthInput.value = thisMonthStr;

  // โหมด "ช่วงวันที่" ต้องส่ง startDate/endDate ไป backend แทน date เดี่ยว ๆ
  // ถ้าผู้ใช้เผลอเลือกวันเริ่มมาหลังวันสิ้นสุด สลับให้อัตโนมัติ กันข้อมูลว่างเปล่า
  const params = { period: currentPeriod };
  if (currentPeriod === "range") {
    if (!startInput.value) startInput.value = todayStr;
    if (!endInput.value) endInput.value = todayStr;
    if (startInput.value > endInput.value) {
      const tmp = startInput.value;
      startInput.value = endInput.value;
      endInput.value = tmp;
    }
    params.startDate = startInput.value;
    params.endDate = endInput.value;
  } else if (currentPeriod === "month") {
    // input type=month ให้ค่ากลับมาแค่ "yyyy-MM" (ไม่มีวันที่) ต้องเติม
    // "-01" ต่อท้ายเอง backend จะเอาไปหาว่าอยู่เดือน/ปีไหนแล้วคำนวณทั้ง
    // เดือนให้เองอยู่แล้ว (ดู getSummary ใน Code.gs) ไม่สนใจว่าเป็นวันที่เท่าไหร่
    params.date = monthInput.value + "-01";
  } else {
    params.date = dateInput.value;
  }

  try {
    const sum = await apiGet("getSummary", params);
    lastSummary = sum;
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

// Export หน้า "สรุปยอด" เป็น CSV — ใช้ข้อมูลชุดล่าสุดที่หน้าเว็บโหลดมาแสดง
// อยู่แล้ว (lastSummary) จึง Export ได้ทันทีไม่ว่าตอนนั้นกำลังเลือกดูแบบ
// "รายวัน" / "รายเดือน" / "ช่วงวันที่" อยู่ก็ตาม เพราะ backend ส่ง label
// ของช่วงที่เลือก (sum.period) กลับมาด้วยอยู่แล้วทุกโหมด
document.getElementById("summary-export-btn").addEventListener("click", () => {
  if (!lastSummary) return toast("ยังไม่มีข้อมูลให้ Export", true);
  const sum = lastSummary;
  const rows = [
    ["สรุปยอด — " + sum.period],
    [],
    ["รายการ", "จำนวนเงิน (บาท)"],
    ["ยอดขาย", sum.totalRevenue],
    ["ต้นทุนผลไม้ที่ตัดใช้จริง", sum.totalRawMaterialCut],
    ["ต้นทุนบรรจุภัณฑ์ที่ใช้จริง", sum.totalPackagingCost],
    ["มูลค่าของเสีย", sum.totalWaste],
    ["ค่าใช้จ่ายอื่น", sum.totalOtherCosts],
    ["กำไรโดยประมาณ", sum.profit],
    [],
    ["ข้อมูลอ้างอิงกระแสเงินสด (ไม่รวมในสูตรกำไรด้านบน)"],
    ["ยอดซื้อวัตถุดิบ (ช่วงนี้)", sum.totalRawMaterialIn],
    ["ยอดซื้อทั้งหมด (รวมบรรจุภัณฑ์)", sum.totalStockIn],
    [],
    ["รายการขายที่บันทึกไว้ (ช่วงนี้)"],
    ["รหัสรายการ", "วันที่", "Code", "ชื่อรายการขาย", "ช่องทางการจำหน่าย", "จำนวน", "ราคาขายต่อหน่วย", "รวมเงิน", "พนักงาน", "หมายเหตุ"],
  ];
  (sum.stockOutList || []).forEach(r => {
    const d = new Date(r.date);
    const dateLabel = isNaN(d) ? (r.date || "") : d.toLocaleString("th-TH", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    rows.push([r.id, dateLabel, r.code || "", r.itemName || "", r.channel || "", r.qty, r.sellPrice, r.total, r.employee || "", r.note || ""]);
  });
  downloadCSV(`สรุปยอด-${sum.period}.csv`, rows);
});

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
// STATS VIEW (สถิติ) — รายการขายดีที่สุดของเดือนที่กำลังดูอยู่
// ค่าเริ่มต้นเมื่อเปิดหน้านี้ครั้งแรก (statsViewMonth = null) ยังคงเป็น
// "เดือนปัจจุบัน" เหมือนเดิมทุกประการ ไม่กระทบพฤติกรรมเดิม — ปุ่ม
// "‹ เดือนก่อน" / "เดือนถัดไป ›" ใช้เพื่อย้อนดูเดือนก่อนๆ ได้เพิ่มเติม
// เท่านั้น (กดปุ่ม "เดือนถัดไป" เกินเดือนปัจจุบันไม่ได้ กันเผลอไปดูเดือน
// ที่ยังไม่มีข้อมูล)
let statsViewMonth = null;     // Date ของวันที่ 1 ในเดือนที่กำลังดู, null = ให้ backend เลือกเดือนปัจจุบันเอง
let statsLastItems = [];       // รายการล่าสุดที่โหลดมาแสดง ใช้ตอนกด Export
let statsLastMonthLabel = "";  // ป้ายชื่อเดือน (yyyy-MM) ล่าสุด ใช้ตั้งชื่อไฟล์ Export

function monthParam(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

async function loadStats() {
  const label = document.getElementById("stats-month-label");
  const wrap = document.getElementById("stats-list");
  try {
    const params = statsViewMonth ? { month: monthParam(statsViewMonth) } : {};
    const res = await apiGet("getSalesStats", params);
    const parts = String(res.month || "").split("-").map(Number);
    if (parts.length === 2 && parts[0] && parts[1]) {
      const d = new Date(parts[0], parts[1] - 1, 1);
      statsViewMonth = d; // sync กับเดือนที่ backend ตอบกลับจริง (โหลดครั้งแรกยังไม่รู้ว่าเดือนปัจจุบันคือเดือนไหนจนกว่าจะได้คำตอบ)
      statsLastMonthLabel = res.month;
      const now = new Date();
      const isCurrent = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      label.textContent = "เดือน " + d.toLocaleDateString("th-TH", { month: "long", year: "numeric" }) +
        (isCurrent ? " — ขึ้นเดือนใหม่ตัวเลขจะเริ่มนับใหม่ให้เองอัตโนมัติ" : "");
    }
    statsLastItems = res.items || [];
    renderStatsList(statsLastItems);
    updateStatsNavButtons();
  } catch (err) {
    wrap.innerHTML = '<div class="empty-state">โหลดสถิติไม่สำเร็จ</div>';
  }
}

// ปิดปุ่ม "เดือนถัดไป" เมื่อดูถึงเดือนปัจจุบันแล้ว (ไปเดือนอนาคตไม่ได้ เพราะ
// ยังไม่มีข้อมูลขาย) ปุ่ม "เดือนก่อน" เปิดให้กดย้อนได้เรื่อยๆ ไม่จำกัด
function updateStatsNavButtons() {
  const nextBtn = document.getElementById("stats-next-month");
  const now = new Date();
  const isCurrent = statsViewMonth &&
    statsViewMonth.getFullYear() === now.getFullYear() &&
    statsViewMonth.getMonth() === now.getMonth();
  nextBtn.disabled = !!isCurrent;
  nextBtn.style.opacity = isCurrent ? "0.4" : "1";
}

document.getElementById("stats-prev-month").addEventListener("click", () => {
  const base = statsViewMonth || new Date();
  statsViewMonth = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  loadStats();
});
document.getElementById("stats-next-month").addEventListener("click", () => {
  const base = statsViewMonth || new Date();
  const now = new Date();
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const isFuture = next.getFullYear() > now.getFullYear() ||
    (next.getFullYear() === now.getFullYear() && next.getMonth() > now.getMonth());
  if (isFuture) return; // กันไปดูเดือนอนาคต
  statsViewMonth = next;
  loadStats();
});

// Export หน้า "สถิติ" เป็น CSV — ใช้รายการของเดือนที่กำลังดูอยู่ตอนนี้
// (statsLastItems) ไม่ว่าจะเป็นเดือนปัจจุบันหรือเดือนก่อนหน้าที่เลือกไว้
document.getElementById("stats-export-btn").addEventListener("click", () => {
  if (!statsLastItems.length) return toast("ยังไม่มีข้อมูลให้ Export", true);
  const rows = [["อันดับ", "ชื่อรายการขาย", "ขายได้ (หน่วย)", "ยอดขาย (บาท)"]];
  statsLastItems.forEach((item, idx) => {
    rows.push([idx + 1, item.itemName, item.qty, item.total]);
  });
  downloadCSV(`สถิติ-${statsLastMonthLabel || "เดือนนี้"}.csv`, rows);
});

function renderStatsList(items) {
  const wrap = document.getElementById("stats-list");
  if (!items.length) {
    wrap.innerHTML = '<div class="empty-state">ยังไม่มีรายการขายในเดือนนี้</div>';
    return;
  }
  wrap.innerHTML = "";
  items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="main">
        <div class="title">#${idx + 1} ${item.itemName}</div>
        <div class="sub">ขายได้ ${item.qty} หน่วย</div>
      </div>
      <div class="trail pos">${money(item.total)}</div>
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
  loadMenuCategories();

  if (isRunningAsInstalledApp()) btnInstall.classList.add("hidden");

  const saved = localStorage.getItem("2kor_employee");
  if (saved) {
    try { state.employee = JSON.parse(saved); routeAfterLogin(); } catch (e) { /* ignore */ }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();

// ============================================================
// ออเดอร์ออนไลน์ (ฝั่งพนักงาน) — สร้าง UI ด้วย JS ทั้งหมด ไม่แก้ index.html
// ============================================================
const ORD = { list: [], seen: new Set(), soundOn: false, ctx: null, wake: null, baseTitle: document.title, firstLoad: true };

(function buildOrdersUI() {
  const css = document.createElement("style");
  css.textContent = `.ord-bell{position:relative}.ord-badge{position:absolute;top:-4px;right:-4px;background:#d63a2f;color:#fff;border-radius:999px;font-size:11px;min-width:18px;height:18px;line-height:18px;text-align:center;padding:0 4px;display:none}
  #ord-sound{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:70;background:#d63a2f;color:#fff;border:none;border-radius:12px;padding:14px;font:600 15px inherit;font-family:inherit;display:none}
  .ord-card{border:1px solid #e7e2d6;border-radius:14px;padding:12px;margin-bottom:10px;background:#fff}.ord-card.new{border-color:#d63a2f;background:#fff6f4}
  .ord-top{display:flex;justify-content:space-between;font-weight:600}.ord-sub{font-size:13px;color:#6b665a;margin-top:4px}.ord-acts{display:flex;gap:8px;margin-top:10px}.ord-acts button{flex:1}
  #ord-page,#fruit-page,#shop-page{position:fixed;inset:0;z-index:60;background:#faf6ef;display:none;flex-direction:column}#ord-page.show,#fruit-page.show,#shop-page.show{display:flex}
  .ord-head{display:flex;align-items:center;gap:12px;background:#2F5233;color:#fff;padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px;flex-shrink:0}.ord-title{font-weight:700;font-size:18px;flex:1}
  #ord-list,#fruit-list,#shop-list{flex:1;overflow:auto;padding:14px 16px 96px;width:100%;max-width:1100px;margin:0 auto}.ord-h{margin:16px 0 8px;font-size:15px;color:#8a5a2b}.ord-h.late{color:#d63a2f}
  .shp-card{background:#fff;border:1px solid #e7e2d6;border-radius:14px;padding:14px;margin-bottom:12px}
  .shp-st{font-weight:700;font-size:17px;margin-bottom:10px}.shp-st.on{color:#2F5233}.shp-st.off{color:#d63a2f}
  .shp-seg{display:flex;gap:8px;margin-bottom:10px}.shp-seg button{flex:1;padding:12px;border-radius:10px;border:1.5px solid #d8d2c2;background:#fff;font:600 15px inherit;font-family:inherit}
  .shp-seg button.on{background:#2F5233;border-color:#2F5233;color:#fff}.shp-seg button.off{background:#d63a2f;border-color:#d63a2f;color:#fff}
  .shp-note{display:flex;gap:8px}.shp-note input{flex:1;min-width:0;padding:10px;border:1.4px solid #d8d2c2;border-radius:9px;font:inherit}
  .shp-cat{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.shp-cat b{font-size:15px;color:#8a5a2b}
  .shp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-top:1px solid #eee}.shp-row span{flex:1;min-width:0}
  .shp-sw{border:none;border-radius:999px;padding:8px 14px;font:600 13px inherit;font-family:inherit;background:#dcefd8;color:#2F5233;white-space:nowrap}
  .shp-sw.off{background:#fbe4e1;color:#c1443c}.shp-sw:disabled{opacity:.5}.shp-row.dim span{color:#999}
  .ord-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}.ord-grid .ord-card{margin:0}
  .ord-acts button.ord-print{flex:0 0 auto;padding-left:14px;padding-right:14px;white-space:nowrap}
  #app .topbar .ord-tb-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0}
  #app .topbar .ord-tb-title{min-width:0;flex:1 1 0;line-height:1.3}
  #app .topbar .ord-tb-title,#app .topbar .ord-tb-title>*{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:700px){
    #app .topbar{flex-wrap:wrap;height:auto!important;min-height:0;row-gap:8px;align-items:center;padding-top:calc(10px + env(safe-area-inset-top,0px));padding-bottom:10px}
    #app .topbar .ord-tb-actions{order:9;flex:1 0 100%;margin-left:0;justify-content:space-between;gap:6px}
  }`;
  document.head.appendChild(css);

  const mk = (id) => { const b = document.createElement("button"); b.className = "icon-btn ord-bell"; b.id = id; b.title = "ออเดอร์ออนไลน์"; b.innerHTML = '🧾<span class="ord-badge"></span>'; b.onclick = openOrders; return b; };
  document.querySelector("#sales-screen .sm-actions").prepend(mk("btn-ord-sales"));
  document.querySelector("#app .topbar").insertBefore(mk("btn-ord-admin"), document.getElementById("btn-low-stock"));

  const mf = (id) => { const b = document.createElement("button"); b.className = "icon-btn"; b.id = id; b.title = "ผลไม้วันนี้"; b.textContent = "🍉"; b.onclick = openFruits; return b; };
  document.querySelector("#sales-screen .sm-actions").prepend(mf("btn-fr-sales"));
  document.querySelector("#app .topbar").insertBefore(mf("btn-fr-admin"), document.getElementById("btn-ord-admin"));
  // จัดโครงแถบบน: ชื่อร้านย่อได้ (ไม่โดนบีบเป็นแนวตั้ง) + ปุ่มทั้งหมดไปอยู่แถวเดียวกัน (มือถือขึ้นแถวล่าง)
  (function fixTopbar() {
    const tb = document.querySelector("#app .topbar"), emp = document.getElementById("topbar-emp");
    if (!tb) return;
    if (emp) (emp.parentElement !== tb ? emp.parentElement : emp).classList.add("ord-tb-title");
    const btns = Array.from(tb.children).filter(c => c.tagName === "BUTTON" && c.id !== "btn-menu-toggle");
    if (!btns.length) return;
    const wrap = document.createElement("div"); wrap.className = "ord-tb-actions";
    tb.insertBefore(wrap, btns[0]); btns.forEach(b => wrap.appendChild(b));
  })();
  const ms = (id) => { const b = document.createElement("button"); b.className = "icon-btn"; b.id = id; b.title = "เปิด/ปิดร้านและเมนู"; b.textContent = "🏪"; b.onclick = openShop; return b; };
  document.querySelector("#sales-screen .sm-actions").prepend(ms("btn-shop-sales"));
  document.querySelector("#app .topbar .ord-tb-actions").insertBefore(ms("btn-shop-admin"), document.getElementById("btn-fr-admin"));
  const page = document.createElement("div");
  page.id = "ord-page";
  page.innerHTML = '<div class="ord-head"><button class="icon-btn" id="ord-back" title="กลับ">‹</button><div class="ord-title">ออเดอร์ออนไลน์</div></div><div id="ord-list"></div>';
  document.body.appendChild(page);
  document.getElementById("ord-back").onclick = () => page.classList.remove("show");

  const sb = document.createElement("button");
  sb.id = "ord-sound"; sb.textContent = "แตะที่นี่เพื่อเปิดเสียงแจ้งเตือนออเดอร์";
  sb.onclick = enableOrderAlerts; document.body.appendChild(sb);
})();

function openOrders() { renderOrders(); document.getElementById("ord-page").classList.add("show"); }

// เบราว์เซอร์บังคับให้ผู้ใช้ "แตะ" ก่อนถึงจะเล่นเสียง/ขอแจ้งเตือน/กันจอดับได้ จึงต้องมีปุ่มนี้
async function enableOrderAlerts() {
  try {
    ORD.ctx = ORD.ctx || new (window.AudioContext || window.webkitAudioContext)();
    await ORD.ctx.resume();
    ORD.soundOn = true;
    beep();
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    await keepScreenOn();
    document.getElementById("ord-sound").style.display = "none";
  } catch (e) { toast("เปิดเสียงไม่สำเร็จ ลองแตะอีกครั้ง", true); }
}
async function keepScreenOn() {
  try { if ("wakeLock" in navigator && !ORD.wake) { ORD.wake = await navigator.wakeLock.request("screen"); ORD.wake.addEventListener("release", () => { ORD.wake = null; }); } } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ORD.soundOn) keepScreenOn(); });

function beep() {
  if (!ORD.soundOn || !ORD.ctx) return;
  [0, 0.25, 0.5].forEach((t, i) => {
    const o = ORD.ctx.createOscillator(), g = ORD.ctx.createGain();
    o.frequency.value = i === 2 ? 1320 : 880; o.connect(g); g.connect(ORD.ctx.destination);
    g.gain.setValueAtTime(0.4, ORD.ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ORD.ctx.currentTime + t + 0.2);
    o.start(ORD.ctx.currentTime + t); o.stop(ORD.ctx.currentTime + t + 0.22);
  });
}

async function pollOrders() {
  if (!state.employee) return;
  let list;
  try { list = await apiGet("getOrders"); } catch (e) { return; }
  if (!Array.isArray(list)) return;
  ORD.list = list;
  const fresh = list.filter(o => o.status === "รอรับ");
  const brandNew = fresh.filter(o => !ORD.seen.has(o.id));
  list.forEach(o => ORD.seen.add(o.id));

  document.querySelectorAll(".ord-badge").forEach(b => { b.textContent = fresh.length; b.style.display = fresh.length ? "block" : "none"; });
  document.title = fresh.length ? `(${fresh.length}) ออเดอร์ใหม่ — ` + ORD.baseTitle : ORD.baseTitle;
  document.getElementById("ord-sound").style.display = (!ORD.soundOn && fresh.length) || (!ORD.soundOn) ? "block" : "none";

  if (fresh.some(o => String(o.when).slice(0, 10) >= todayStr())) beep(); // ดังซ้ำทุกรอบจนกว่าจะมีคนกดรับ (ออเดอร์ค้างจากวันก่อนไม่ดัง แต่ยังขึ้นสีแดงในหน้าออเดอร์)
  if (brandNew.length && "Notification" in window && Notification.permission === "granted" && document.hidden) {
    const o = brandNew[0], msg = `${o.name} · ${o.items.length} รายการ · ฿${o.total}`;
    navigator.serviceWorker.ready.then(r => r.showNotification("ออเดอร์ใหม่", { body: msg, tag: "new-order", renotify: true, requireInteraction: true })).catch(() => {});
  }
  if (document.getElementById("ord-page").classList.contains("show")) renderOrders();
}
setInterval(pollOrders, 15000);
setTimeout(pollOrders, 2500);

function todayStr() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// ออเดอร์จะหายจากหน้านี้ก็ต่อเมื่อกด "เสร็จสิ้น" หรือ "ยกเลิก" เท่านั้น ถ้าลืมกด
// จะค้างอยู่ และถูกแยกไปอยู่หัวข้อสีแดง "ค้างจากวันก่อน" ให้เห็นชัด
function renderOrders() {
  const wrap = document.getElementById("ord-list");
  wrap.innerHTML = "";
  if (!ORD.list.length) { wrap.innerHTML = '<div class="empty-state">ไม่มีออเดอร์ค้าง</div>'; return; }
  const today = todayStr();
  [["ค้างจากวันก่อน — ยังไม่ได้กด เสร็จสิ้น", o => o.when.slice(0, 10) < today, "late"],
   ["วันนี้", o => o.when.slice(0, 10) === today, ""],
   ["วันถัดไป", o => o.when.slice(0, 10) > today, ""]].forEach(([title, test, cls]) => {
    const items = ORD.list.filter(test).sort((x, y) => x.when.localeCompare(y.when));
    if (!items.length) return;
    const h = document.createElement("div"); h.className = "ord-h " + cls; h.textContent = `${title} (${items.length})`; wrap.appendChild(h);
    const g = document.createElement("div"); g.className = "ord-grid"; items.forEach(o => g.appendChild(orderCard(o))); wrap.appendChild(g);
  });
}

function orderCard(o) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const c = el("div", "ord-card" + (o.status === "รอรับ" ? " new" : ""));
  const top = el("div", "ord-top"); top.append(el("span", "", `${o.id} · ${o.name}`), el("span", "", money(o.total)));
  const phone = el("div", "ord-sub"); const a = el("a", "", o.phone); a.href = "tel:" + o.phone; phone.append("โทร ", a, ` · ${o.method} · นัด ${o.when}`);
  c.append(top, phone);
  if (o.address) c.append(el("div", "ord-sub", "ที่อยู่: " + o.address));
  o.items.forEach(it => c.append(el("div", "ord-sub", `${it.name} x ${it.qty}` + (it.fruits && it.fruits.length ? " : " + it.fruits.join(", ") : ""))));
  if (o.note) c.append(el("div", "ord-sub", "หมายเหตุ: " + o.note));
  c.append(el("div", "ord-sub", `สถานะ: ${o.status}${o.staff ? " (โดย " + o.staff + ")" : ""}`));
  const next = { "รอรับ": [["รับออเดอร์", "รับแล้ว", "btn mango"], ["ยกเลิก", "ยกเลิก", "btn outline"]], "รับแล้ว": [["พร้อมรับ/กำลังส่ง", "พร้อมรับ/กำลังส่ง", "btn"], ["เสร็จสิ้น", "เสร็จสิ้น", "btn outline"]], "พร้อมรับ/กำลังส่ง": [["เสร็จสิ้น", "เสร็จสิ้น", "btn"]] }[o.status] || [];
  const acts = el("div", "ord-acts");
  next.forEach(([label, status, cls]) => {
    const b = el("button", cls, label); b.type = "button";
    b.onclick = async () => {
      if (status === "ยกเลิก" && !confirm("ยกเลิกออเดอร์นี้?")) return;
      b.disabled = true;
      const res = await apiPost("updateOrder", { orderId: o.id, status });
      if (res.ok) toast(res.failed && res.failed.length ? "รับแล้ว แต่บันทึกขายไม่ครบ: " + res.failed.join(", ") + " — กรุณาบันทึกเองในโหมดขาย" : "อัปเดตแล้ว", !!(res.failed && res.failed.length));
      else toast(res.error || "อัปเดตไม่สำเร็จ", true);
      await pollOrders(); renderOrders();
    };
    acts.appendChild(b);
  });
  const pb = el("button", "btn outline ord-print", "🖨 พิมพ์"); pb.type = "button"; pb.onclick = () => printOrder(o);
  acts.appendChild(pb);
  c.append(acts);
  return c;
}

// ---- เปิด/ปิดร้านวันนี้ + เปิด/ปิดเมนู (ทั้งหมวด หรือเฉพาะเมนูที่หมด) ----
// ปิดร้าน: มีผลเฉพาะวันนี้ ข้ามวันเปิดเอง | ปิดเมนู/หมวด: ค้างจนกว่าจะกดเปิด
async function openShop() {
  let page = document.getElementById("shop-page");
  if (!page) {
    page = document.createElement("div"); page.id = "shop-page";
    page.innerHTML = '<div class="ord-head"><button class="icon-btn" id="shop-back">‹</button><div class="ord-title">เปิด/ปิดร้านและเมนู</div></div><div id="shop-list"></div>';
    document.body.appendChild(page);
    document.getElementById("shop-back").onclick = () => page.classList.remove("show");
  }
  page.classList.add("show");
  const wrap = document.getElementById("shop-list");
  wrap.innerHTML = '<div class="empty-state">กำลังโหลด…</div>';
  const d = await apiGet("getAvailability");
  if (!d || !Array.isArray(d.categories)) { wrap.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; return; }
  renderShop(d);
}

function renderShop(d) {
  const wrap = document.getElementById("shop-list"); wrap.innerHTML = "";
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const save = async (payload, okMsg) => {
    const res = await apiPost("setAvailability", payload);
    if (res && res.ok) toast(okMsg || "บันทึกแล้ว"); else toast((res && res.error) || "บันทึกไม่สำเร็จ", true);
    const nd = await apiGet("getAvailability"); if (nd && nd.categories) renderShop(nd);
  };

  // การ์ดสถานะร้านวันนี้
  const c1 = el("div", "shp-card");
  c1.append(el("div", "shp-st " + (d.shopClosed ? "off" : "on"), d.shopClosed ? "🔴 วันนี้ร้านปิด" : "🟢 วันนี้ร้านเปิด"));
  const seg = el("div", "shp-seg");
  const bOpen = el("button", d.shopClosed ? "" : "on", "เปิดร้าน"), bClose = el("button", d.shopClosed ? "off" : "", "ปิดร้านวันนี้");
  bOpen.type = bClose.type = "button";
  const noteIn = el("input"); noteIn.maxLength = 150; noteIn.placeholder = "ข้อความแจ้งลูกค้า (ไม่บังคับ) เช่น หยุดวันนี้ เปิดพรุ่งนี้"; noteIn.value = d.note || "";
  bOpen.onclick = () => { if (d.shopClosed) save({ type: "shop", closed: false, note: noteIn.value }, "เปิดร้านแล้ว"); };
  bClose.onclick = () => { if (!d.shopClosed && confirm("ปิดร้านวันนี้? ลูกค้าจะเห็นประกาศและสั่งสำหรับวันนี้ไม่ได้")) save({ type: "shop", closed: true, note: noteIn.value }, "ปิดร้านวันนี้แล้ว"); };
  seg.append(bOpen, bClose);
  const nb = el("div", "shp-note"), nbtn = el("button", "btn sm", "บันทึก"); nbtn.type = "button";
  nbtn.onclick = () => save({ type: "note", note: noteIn.value }, "บันทึกข้อความแล้ว");
  nb.append(noteIn, nbtn);
  c1.append(seg, nb, el("div", "ord-sub", "ลูกค้าจะเห็น popup แจ้งสถานะร้านทุกครั้งที่เปิดหน้าสั่งอาหาร • ปิดร้านมีผลเฉพาะวันนี้ ข้ามวันจะเปิดให้เอง"));
  wrap.appendChild(c1);

  // เมนูตามหมวด
  if (!d.categories.length) wrap.appendChild(el("div", "empty-state", "ยังไม่มีเมนูที่เปิดขายออนไลน์"));
  d.categories.forEach(cat => {
    const card = el("div", "shp-card");
    const head = el("div", "shp-cat"); head.append(el("b", "", cat.name));
    const cb = el("button", "shp-sw" + (cat.closed ? " off" : ""), cat.closed ? "ปิดทั้งหมวด · แตะเพื่อเปิด" : "ปิดทั้งหมวด"); cb.type = "button";
    cb.onclick = () => { cb.disabled = true; save({ type: "category", name: cat.name, closed: !cat.closed }, cat.closed ? "เปิดหมวดแล้ว" : "ปิดหมวดแล้ว"); };
    head.append(cb); card.append(head);
    cat.menus.forEach(m => {
      const row = el("div", "shp-row" + (cat.closed || m.closed ? " dim" : ""));
      const sw = el("button", "shp-sw" + (cat.closed || m.closed ? " off" : ""), cat.closed ? "ปิดตามหมวด" : m.closed ? "หมด" : "มีของ"); sw.type = "button";
      sw.disabled = cat.closed;
      sw.onclick = () => { sw.disabled = true; save({ type: "menu", id: m.id, closed: !m.closed }, m.closed ? "เปิดขายแล้ว" : "ตั้งเป็นหมดแล้ว"); };
      row.append(el("span", "", m.name), sw); card.append(row);
    });
    wrap.appendChild(card);
  });
}

// ---- พิมพ์ใบออเดอร์ (เครื่องพิมพ์สลิปกระดาษหน้ากว้าง 57 mm) ----
// ปรับได้ที่นี่: PAPER = ความกว้างกระดาษ, CONTENT = ความกว้างเนื้อหาที่พิมพ์จริง
// (เครื่อง 57/58mm ส่วนใหญ่พิมพ์ได้จริงราว 48-52mm ถ้าตัวหนังสือขอบขาด ให้ลดค่า CONTENT)
const ORD_PRINT = { PAPER: "57mm", CONTENT: "50mm", SHOP: "2 กอ ผลไม้ปอกพร้อมทาน", LOGO: "./icons/logo-256.png" };

function printOrder(o) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const logo = new URL(ORD_PRINT.LOGO, location.href).href;
  const qtyAll = o.items.reduce((s, it) => s + it.qty, 0);
  const rows = o.items.map(it =>
    `<div class="it"><div class="r"><span>${esc(it.name)}</span></div>` +
    `<div class="r"><span>&nbsp;&nbsp;${money(it.price)} x ${it.qty}</span><span>${money(it.price * it.qty)}</span></div>` +
    (it.fruits && it.fruits.length ? `<div class="fr">ผลไม้: ${esc(it.fruits.join(", "))}</div>` : "") + `</div>`).join("");
  const line = (k, v) => v ? `<div class="kv"><b>${k}</b> ${esc(v)}</div>` : "";
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(o.id)}</title><style>
@page{size:${ORD_PRINT.PAPER} auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{width:${ORD_PRINT.CONTENT};margin:0 auto;padding:2mm 0 6mm;color:#000;font-family:"Noto Sans Thai","Sarabun","IBM Plex Sans Thai",sans-serif;font-size:12px;line-height:1.35}
.c{text-align:center}.logo{display:block;margin:0 auto 3px;width:22mm;height:auto;filter:grayscale(1) contrast(1.6)}
.shop{font-size:15px;font-weight:700;text-align:center}.sub{text-align:center;font-size:11px}
.hr{border:0;border-top:1px dashed #000;margin:5px 0}.hr2{border:0;border-top:2px solid #000;margin:5px 0}
.id{font-size:16px;font-weight:700;text-align:center}
.kv{word-break:break-word}.kv b{font-weight:700}
.it{margin-bottom:4px}.r{display:flex;justify-content:space-between;gap:6px}.r span:last-child{white-space:nowrap}
.fr{padding-left:8px;font-size:11px;word-break:break-word}
.tot{font-size:16px;font-weight:700}
.note{border:1px solid #000;padding:2px 4px;margin-top:3px;word-break:break-word}
</style></head><body>
<img class="logo" id="logo" src="${esc(logo)}" alt="">
<div class="shop">${esc(ORD_PRINT.SHOP)}</div>
<div class="sub">ใบออเดอร์ออนไลน์</div>
<hr class="hr2">
<div class="id">${esc(o.id)}</div>
<div class="c">${esc(o.method)}</div>
<hr class="hr">
${line("ลูกค้า:", o.name)}${line("โทร:", o.phone)}${line("นัดรับ/ส่ง:", o.when)}${line("สั่งเมื่อ:", o.createdAt)}${line("ที่อยู่:", o.address)}
${o.note ? `<div class="note"><b>หมายเหตุ:</b> ${esc(o.note)}</div>` : ""}
<hr class="hr">
<div><b>รายการ</b></div>
${rows}
<hr class="hr">
<div class="r"><span>รวมทั้งหมด ${qtyAll} ชิ้น</span></div>
<div class="r tot"><span>ยอดรวม</span><span>${money(o.total)}</span></div>
${o.method === "นัดส่ง" ? '<div class="sub">* ยังไม่รวมค่าส่ง</div>' : ""}
<hr class="hr">
<div class="sub">${o.staff ? "ผู้รับออเดอร์: " + esc(o.staff) + "<br>" : ""}พิมพ์ ${esc(new Date().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }))}</div>
<div class="c" style="margin-top:4px">ขอบคุณที่อุดหนุนค่ะ</div>
</body></html>`;

  const fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(fr);
  const doc = fr.contentDocument; doc.open(); doc.write(html); doc.close();
  const cleanup = () => setTimeout(() => fr.remove(), 1000);
  const go = () => {
    if (go.done) return; go.done = true;
    try { fr.contentWindow.focus(); fr.contentWindow.onafterprint = cleanup; fr.contentWindow.print(); }
    catch (e) { toast("สั่งพิมพ์ไม่สำเร็จ", true); cleanup(); return; }
    setTimeout(() => fr.remove(), 120000);
  };
  const img = doc.getElementById("logo");
  if (img && !img.complete) { img.onload = img.onerror = go; setTimeout(go, 2000); } else setTimeout(go, 150);
}

// ---- ผลไม้วันนี้: เปิด/ปิดว่าวันนี้มีผลไม้ชนิดไหน (ลูกค้าเลือกได้เฉพาะที่เปิดอยู่) ----
async function openFruits() {
  let page = document.getElementById("fruit-page");
  if (!page) {
    page = document.createElement("div"); page.id = "fruit-page";
    page.innerHTML = '<div class="ord-head"><button class="icon-btn" id="fruit-back">‹</button><div class="ord-title">ผลไม้วันนี้</div></div><div id="fruit-list"></div>';
    document.body.appendChild(page);
    document.getElementById("fruit-back").onclick = () => page.classList.remove("show");
  }
  page.classList.add("show");
  const wrap = document.getElementById("fruit-list");
  wrap.innerHTML = '<div class="empty-state">กำลังโหลด…</div>';
  const list = await apiGet("getFruits");
  if (!Array.isArray(list)) { wrap.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; return; }
  const hint = document.createElement("div"); hint.className = "hint"; hint.textContent = "แตะเพื่อเปิด/ปิด — ผลไม้ที่ปิดอยู่ ลูกค้าจะไม่เห็นในหน้าสั่งของ";
  const add = document.createElement("div"); add.style.cssText = "display:flex;gap:8px;margin:12px 0";
  add.innerHTML = '<input id="fruit-new" maxlength="30" placeholder="เพิ่มผลไม้ชนิดใหม่" style="flex:1;padding:10px;border:1.4px solid #d8d2c2;border-radius:9px;font:inherit"><button class="btn mango" id="fruit-add" style="width:auto;padding:10px 16px">เพิ่ม</button>';
  const grid = document.createElement("div"); grid.className = "ord-grid";
  wrap.innerHTML = ""; wrap.append(hint, add, grid);
  list.forEach(f => {
    const b = document.createElement("button"); b.type = "button";
    const paint = () => { b.className = "btn" + (f.on ? "" : " outline"); b.textContent = `${f.name} — ${f.on ? "มีวันนี้" : "หมด/ไม่มี"}`; };
    paint();
    b.onclick = async () => { f.on = !f.on; paint(); const r = await apiPost("setFruit", { id: f.id, on: f.on }); if (!r.ok) { f.on = !f.on; paint(); toast(r.error || "บันทึกไม่สำเร็จ", true); } };
    grid.appendChild(b);
  });
  document.getElementById("fruit-add").onclick = async () => {
    const r = await apiPost("addFruit", { name: document.getElementById("fruit-new").value });
    if (r.ok) openFruits(); else toast(r.error || "เพิ่มไม่สำเร็จ", true);
  };
}
