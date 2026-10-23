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
  cart: [],              // ตะกร้า/บิลที่กำลังเปิดอยู่ในโหมดขาย [{uid, menu, qty, price, unit, error}, ...]
  cartCustomer: "",      // ชื่อลูกค้าของบิลนี้ (ใช้กับทุกรายการในตะกร้า)
  cartSaving: false,     // true ระหว่างส่งบันทึก กันกดลบ/กดซ้ำ
  menuImageDataUrl: "",  // รูปที่เลือก/ย่อแล้ว รอบันทึกในฟอร์มเพิ่ม/แก้ไขเมนู
};

// ช่องทางการจำหน่าย ต้องตรงกับ data-channel ของปุ่ม .sm-channel-chip ใน
// index.html และ SALES_CHANNELS ฝั่ง Code.gs — ใช้แมปไปหา key ราคาที่ตั้งไว้
// ต่อเมนู 1 รายการ (ดู getMenuPriceForChannel ด้านล่าง)
const CHANNEL_PRICE_KEY = { "หน้าบ้าน": "priceFront", "จ๊ะนวล": "priceJanuan", "Line Man": "priceLineman" };
// หมวดผลไม้สดชั่งกิโล: ไม่ผูก Code ไม่หักบรรจุภัณฑ์ตอนขาย (ถุงตัดสต๊อกเป็นรอบๆ เอง) และต้องเลือกหน่วย ลูก/กิโล
// ต้องตรงกับ WEIGHED_CATEGORIES ใน Code.gs (ราคาหน้าบ้านของเมนูเหล่านี้ = ราคาต่อลูก ราคาต่อกิโลเก็บแยกใน priceKg)
const WEIGHED_CATEGORIES = ["ผลไม้สดชั่งกิโล"];
// หมวดเดียวกันนี้ต้องเลือก "หน่วยที่ขาย" ด้วย (กิโล หรือ ลูก) ต้องตรงกับ WEIGHED_UNITS ใน Code.gs (ราคาหน้าบ้านของเมนูเหล่านี้ = ราคาต่อลูก ส่วนราคาต่อกิโลเก็บแยกใน priceKg)
const WEIGHED_UNITS = ["ลูก", "กิโล"];
const isWeighedMenu = (m) => !!m && WEIGHED_CATEGORIES.includes(m.category);
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
  state.cart = [];
  state.cartCustomer = "";
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
  if (name === "today") loadTodayBackoffice();
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
// ============================================================
// สแกนบาร์โค้ด — กล้องโทรศัพท์ (ตอนนี้) + เครื่องยิงบาร์โค้ด USB/Bluetooth (อนาคต)
// - กล้อง: ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี (Chrome/Android) ไม่งั้นใช้ ZXing
//   (zxing.min.js ในโฟลเดอร์เดียวกับแอป โหลดเมื่อกดสแกนครั้งแรกเท่านั้น)
// - เครื่องยิง: ส่วนใหญ่ทำตัวเป็นคีย์บอร์ด พิมพ์เลขเร็วๆ แล้วกด Enter ->
//   ดักด้วย installKeyboardScanner ด้านล่าง ไม่ต้องตั้งค่าอะไรเพิ่ม
// - เทียบบาร์โค้ดด้วย normBarcode (ตัดช่องว่าง + ตัด 0 นำหน้า) ให้ตรงกับฝั่ง Code.gs
// ============================================================
function normBarcode(v) { return String(v === null || v === undefined ? "" : v).replace(/\s+/g, "").replace(/^0+(?=\d)/, ""); }

let zxingPromise = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (zxingPromise) return zxingPromise;
  zxingPromise = new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "./zxing.min.js";
    sc.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error("zxing")));
    sc.onerror = () => { zxingPromise = null; reject(new Error("zxing")); };
    document.head.appendChild(sc);
  });
  return zxingPromise;
}

const SCAN = { open: false, stop: null };

function scanBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      SCAN.ctx = SCAN.ctx || new AC();
      const o = SCAN.ctx.createOscillator(), g = SCAN.ctx.createGain();
      o.type = "sine"; o.frequency.value = 1100; g.gain.value = 0.15;
      o.connect(g); g.connect(SCAN.ctx.destination);
      o.start(); o.stop(SCAN.ctx.currentTime + 0.09);
    }
  } catch (e) { /* เสียงไม่ได้ก็ไม่เป็นไร */ }
  try { if (navigator.vibrate) navigator.vibrate(50); } catch (e) {}
}

(function installScannerUI() {
  const st = document.createElement("style");
  st.textContent = `
    #scan-overlay{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box}
    #scan-overlay.hidden{display:none}
    .scan-box{width:100%;max-width:480px;background:#fff;border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
    .scan-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#2F5233;color:#fff;font-weight:700;font-size:15px}
    .scan-head button{background:rgba(255,255,255,.18);border:none;color:#fff;width:30px;height:30px;border-radius:50%;font-size:15px;cursor:pointer}
    .scan-video-wrap{position:relative;background:#000;aspect-ratio:4/3}
    .scan-video-wrap video{width:100%;height:100%;object-fit:cover;display:block}
    .scan-frame{position:absolute;left:10%;right:10%;top:30%;bottom:30%;border:3px solid rgba(255,255,255,.9);border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,.28);pointer-events:none}
    .scan-status{padding:10px 14px;font-size:14px;min-height:20px;color:#332f26;line-height:1.4}
    .scan-manual{display:flex;gap:8px;padding:0 14px 14px}
    .scan-manual input{flex:1;min-width:0;padding:10px 12px;border:1.4px solid #d8d2c2;border-radius:10px;font-size:16px;font-family:inherit}
    .scan-manual button{padding:0 16px;border:none;border-radius:10px;background:#2F5233;color:#fff;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer}
  `;
  document.head.appendChild(st);
  const el = document.createElement("div");
  el.id = "scan-overlay"; el.className = "hidden";
  el.innerHTML = `
    <div class="scan-box">
      <div class="scan-head"><span id="scan-title">สแกนบาร์โค้ด</span><button type="button" id="scan-close" title="ปิด">✕</button></div>
      <div class="scan-video-wrap"><video id="scan-video" playsinline muted autoplay></video><div class="scan-frame"></div></div>
      <div class="scan-status" id="scan-status"></div>
      <div class="scan-manual">
        <input type="text" id="scan-manual" inputmode="numeric" autocomplete="off" placeholder="หรือพิมพ์เลขบาร์โค้ดเอง">
        <button type="button" id="scan-manual-ok">ตกลง</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.getElementById("scan-close").addEventListener("click", () => closeScanner());
})();

function setScanStatus(msg) { const e = document.getElementById("scan-status"); if (e) e.textContent = msg || ""; }

function closeScanner() {
  if (!SCAN.open) return;
  const ov = document.getElementById("scan-overlay");
  if (ov) ov.classList.add("hidden");
  if (SCAN.stop) { try { SCAN.stop(); } catch (e) {} SCAN.stop = null; }
  const v = document.getElementById("scan-video");
  if (v) { try { v.pause(); } catch (e) {} v.srcObject = null; }
  SCAN.open = false;
}
document.addEventListener("visibilitychange", () => { if (document.hidden && SCAN.open) closeScanner(); });

// opts: { title, continuous (สแกนต่อเนื่องไม่ปิดเอง — ใช้หน้าขาย), onScan(code) -> ข้อความสถานะ (ไม่บังคับ) }
async function openScanner(opts) {
  if (SCAN.open) return;
  SCAN.open = true;
  const video = document.getElementById("scan-video");
  document.getElementById("scan-title").textContent = opts.title || "สแกนบาร์โค้ด";
  document.getElementById("scan-overlay").classList.remove("hidden");
  setScanStatus("กำลังเปิดกล้อง…");
  const manual = document.getElementById("scan-manual");
  manual.value = "";

  let lastCode = "", lastAt = 0, finished = false;
  const deliver = async (raw) => {
    const code = String(raw || "").trim();
    if (!code || finished || !SCAN.open) return;
    const now = Date.now();
    if (code === lastCode && now - lastAt < 2000) return; // กล้องเห็นอันเดิมซ้ำๆ ไม่นับซ้ำ
    lastCode = code; lastAt = now;
    scanBeep();
    if (!opts.continuous) { finished = true; closeScanner(); }
    try {
      const msg = await opts.onScan(code);
      if (opts.continuous && SCAN.open) setScanStatus(msg || ("สแกนได้: " + code));
    } catch (err) { toast((err && err.message) || "จัดการบาร์โค้ดไม่สำเร็จ", true); }
  };

  // พิมพ์เลขเองได้เสมอ (กล้องใช้ไม่ได้/บาร์โค้ดเลอะอ่านไม่ออก)
  const manualOk = document.getElementById("scan-manual-ok");
  const submitManual = () => { const v = manual.value.trim(); manual.value = ""; if (v) { lastCode = ""; deliver(v); } };
  manualOk.onclick = submitManual;
  manual.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submitManual(); } };

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setScanStatus("เปิดกล้องไม่ได้ (ต้องเปิดแอปผ่าน https) — พิมพ์เลขบาร์โค้ดด้านล่างแทนได้");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    setScanStatus("เปิดกล้องไม่ได้ — กรุณากดอนุญาตการใช้กล้องในเบราว์เซอร์ หรือพิมพ์เลขบาร์โค้ดด้านล่างแทน");
    return;
  }
  if (!SCAN.open) { stream.getTracks().forEach(t => t.stop()); return; } // ผู้ใช้ปิดไปก่อนกล้องพร้อม
  video.srcObject = stream;
  try { await video.play(); } catch (e) {}
  setScanStatus("เล็งบาร์โค้ดให้อยู่ในกรอบ");

  const stopTracks = () => stream.getTracks().forEach(t => t.stop());
  let detectorOk = false;

  // ทางที่ 1: BarcodeDetector ในตัวเบราว์เซอร์ (เร็ว ไม่ต้องโหลดไลบรารี)
  if ("BarcodeDetector" in window) {
    try {
      let formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
      if (BarcodeDetector.getSupportedFormats) {
        const sup = await BarcodeDetector.getSupportedFormats();
        formats = formats.filter(f => sup.includes(f));
      }
      if (formats.length) {
        const det = new BarcodeDetector({ formats });
        let alive = true, timer = null;
        const tick = async () => {
          if (!alive) return;
          try {
            if (video.readyState >= 2) {
              const found = await det.detect(video);
              if (found && found.length) await deliver(found[0].rawValue);
            }
          } catch (e) { /* เฟรมนี้อ่านไม่ได้ ข้ามไป */ }
          if (alive) timer = setTimeout(tick, 160);
        };
        SCAN.stop = () => { alive = false; clearTimeout(timer); stopTracks(); };
        tick();
        detectorOk = true;
      }
    } catch (e) { detectorOk = false; }
  }

  // ทางที่ 2: ZXing (iPhone/Safari และเครื่องที่ไม่มี BarcodeDetector)
  if (!detectorOk) {
    try {
      const Z = await loadZXing();
      if (!SCAN.open) { stopTracks(); return; }
      const hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
        Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
        Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF,
      ]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      const reader = new Z.BrowserMultiFormatReader(hints, 250);
      SCAN.stop = () => { try { reader.reset(); } catch (e) {} stopTracks(); };
      reader.decodeFromStream(stream, video, (result) => { if (result) deliver(result.getText()); });
    } catch (err) {
      stopTracks();
      setScanStatus("โหลดตัวอ่านบาร์โค้ดไม่สำเร็จ (ต้องมีไฟล์ zxing.min.js และเน็ตตอนเปิดแอปครั้งแรก) — พิมพ์เลขบาร์โค้ดด้านล่างแทนได้");
    }
  }
}

// ---- เครื่องยิงบาร์โค้ด (ทำตัวเป็นคีย์บอร์ด): พิมพ์เลขรัวเร็ว แล้วกด Enter ----
// ทำงานเมื่อไม่ได้โฟกัสอยู่ในช่องพิมพ์ใดๆ (ถ้าโฟกัสช่องบาร์โค้ด/ค้นหา เลขจะลงช่องนั้นตามปกติ)
(function installKeyboardScanner() {
  let buf = "", last = 0;
  document.addEventListener("keydown", (e) => {
    if (SCAN.open || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) { buf = ""; return; }
    const now = Date.now();
    if (now - last > 80) buf = ""; // เครื่องยิงพิมพ์เร็วมาก (ราว 5-30ms/ตัว) คนพิมพ์ช้ากว่านั้น
    last = now;
    if (e.key === "Enter") {
      const code = buf; buf = "";
      if (code.length >= 4) { e.preventDefault(); handleKeyboardScan(code); }
      return;
    }
    if (e.key && e.key.length === 1) buf += e.key;
  }, true);
})();

async function handleKeyboardScan(code) {
  if (document.querySelector(".modal-backdrop:not(.hidden)")) return; // มี popup เปิดอยู่ ไม่แย่งทำงาน
  const sales = document.getElementById("sales-screen");
  if (sales && !sales.classList.contains("hidden")) {
    const msg = await handleSalesBarcode(code);
    if (msg) toast(msg);
    return;
  }
  const app = document.getElementById("app");
  const pv = document.querySelector('section[data-view="products"]');
  if (app && !app.classList.contains("hidden") && pv && !pv.classList.contains("hidden")) handleReceiveScan(code);
}

// ---- รับเข้า: สแกนแล้วเจอสินค้าเดิม -> เปิดหน้ารับเข้า / ไม่เจอ -> เปิดฟอร์มเพิ่มสินค้าใหม่พร้อมบาร์โค้ด ----
function findProductByBarcode(code) {
  const key = normBarcode(code);
  if (!key) return null;
  const rows = (state.products || []).filter(p => normBarcode(p["บาร์โค้ด"]) === key);
  if (!rows.length) return null;
  return rows.find(p => Number(p["สต๊อกปัจจุบัน"]) > 0) || rows[rows.length - 1];
}

async function handleReceiveScan(code) {
  if (!(state.products || []).length) {
    try { state.products = await apiGet("getProducts"); } catch (err) { /* ใช้ข้อมูลที่มีอยู่ */ }
  }
  const p = findProductByBarcode(code);
  if (p) {
    openReceiveModal(p);
    toast(`พบ "${p["ชื่อสินค้า"]}" — กรอกราคา/จำนวนที่รับเข้า`);
  } else {
    document.getElementById("form-add-product").reset();
    document.getElementById("np-costperunit").value = "";
    document.getElementById("np-category").value = "อื่นๆ";
    document.getElementById("np-barcode").value = String(code).trim();
    updateDupHint();
    openModal("modal-product");
    setTimeout(() => document.getElementById("np-name").focus(), 80);
    toast("ยังไม่มีสินค้านี้ในระบบ — กรอกชื่อและรายละเอียดเพื่อเพิ่มสินค้าใหม่");
  }
}

// ช่องบาร์โค้ดในฟอร์มเพิ่มสินค้า: ได้เลขมาแล้ว (สแกน/ยิง/พิมพ์) ถ้าตรงกับสินค้าเดิม ให้ดึงชื่อ/หมวด/หน่วยมาเติมให้
let npLastBarcode = "";
function applyNewProductBarcode(code) {
  const inp = document.getElementById("np-barcode");
  inp.value = String(code || "").trim();
  npLastBarcode = inp.value;
  if (!inp.value) return;
  const p = findProductByBarcode(inp.value);
  if (p) {
    document.getElementById("np-name").value = p["ชื่อสินค้า"];
    document.getElementById("np-category").value = p["หมวดหมู่"];
    updateDupHint();
    toast(`บาร์โค้ดนี้คือ "${p["ชื่อสินค้า"]}" — กรอกราคา/จำนวนเพื่อรับเข้าเป็นล็อตใหม่`);
    setTimeout(() => document.getElementById("np-price").focus(), 60);
  } else {
    setTimeout(() => document.getElementById("np-name").focus(), 60);
  }
}
document.getElementById("np-barcode-scan").addEventListener("click", () =>
  openScanner({ title: "สแกนบาร์โค้ดสินค้า", onScan: (code) => applyNewProductBarcode(code) })
);
document.getElementById("np-barcode").addEventListener("keydown", (e) => {
  // เครื่องยิงกด Enter ท้ายเลข — กันไม่ให้ฟอร์มถูกส่งทั้งที่ยังกรอกไม่ครบ
  if (e.key === "Enter") { e.preventDefault(); applyNewProductBarcode(e.target.value); }
});
document.getElementById("np-barcode").addEventListener("change", (e) => {
  const v = e.target.value.trim();
  if (v && v !== npLastBarcode) applyNewProductBarcode(v); // Enter จากเครื่องยิงทำไปแล้ว ไม่ทำซ้ำตอน blur
});
document.getElementById("btn-scan-receive").addEventListener("click", () =>
  openScanner({ title: "สแกนสินค้าที่จะรับเข้า", onScan: (code) => handleReceiveScan(code) })
);

// ---- หน้าขาย: สแกนแล้วเพิ่มเมนูที่ผูกกับสินค้านั้นลงบิล (ซ้ำ = เพิ่มจำนวนทีละ 1) ----
// เมนูผูกบาร์โค้ดผ่าน Code: สินค้าหมวด "อื่นๆ" ที่มีบาร์โค้ด + อยู่ใน Code ของเมนูนั้น (Code.gs: getMenus -> barcodes)
let lastMenuReloadAt = 0;
function menusForBarcode(code) {
  const key = normBarcode(code);
  return (state.salesMenus || []).filter(m =>
    Array.isArray(m.barcodes) && m.barcodes.some(b => normBarcode(b) === key));
}

async function handleSalesBarcode(code) {
  if (!state.salesChannel) { toast("กรุณาเลือกช่องทางการจำหน่ายก่อนสแกน", true); return "ยังไม่ได้เลือกช่องทางการจำหน่าย"; }
  if (state.cartSaving) return "กำลังบันทึกบิล รอสักครู่";
  let menus = menusForBarcode(code);
  if (!menus.length && Date.now() - lastMenuReloadAt > 10000) {
    // อาจเพิ่งผูกบาร์โค้ด/เมนูใหม่หลังเปิดหน้าขาย — โหลดเมนูใหม่ 1 ครั้งแล้วลองอีกที (ไม่ถี่เกิน 10 วิ)
    lastMenuReloadAt = Date.now();
    await loadMenusForSales();
    menus = menusForBarcode(code);
  }
  if (!menus.length) {
    toast(`ไม่พบเมนูขายที่ผูกกับบาร์โค้ด ${code}`, true);
    return `❌ ไม่พบเมนูของบาร์โค้ด ${code} — ให้ผู้ดูแลใส่บาร์โค้ดที่ปุ่ม "แก้ไข" ของเมนูในหน้าจัดการเมนูขาย`;
  }
  if (menus.length === 1) return scanAddMenu(menus[0]);
  chooseMenuForScan(menus);
  return "บาร์โค้ดนี้มีหลายเมนู — เลือกเมนูที่ต้องการ";
}

function scanAddMenu(menu) {
  const price = getMenuPriceForChannel(menu, state.salesChannel);
  if (price === "" || isWeighedMenu(menu)) {
    // ราคาไม่ตายตัวในช่องทางนี้ หรือเป็นผลไม้ชั่งกิโล (ต้องเลือกหน่วยลูก/กิโล) -> เปิดการ์ดเมนูให้กรอกเอง (ปิดกล้องก่อนจะได้พิมพ์ได้)
    closeScanner();
    const tile = document.querySelector(`.sm-tile[data-menu-id="${menu.id}"]`);
    if (tile) {
      openSaleTile(tile);
      tile.querySelector(".sm-tile-qty").value = "1";
      updateTileConfirmVisibility(tile);
      tile.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => tile.querySelector(".sm-tile-price").focus(), 150);
    }
    return `${menu.displayName}: ${isWeighedMenu(menu) ? "เลือกหน่วยและใส่จำนวน/ราคา" : "ช่องทางนี้ยังไม่มีราคาตายตัว กรุณาใส่ราคา"}`;
  }
  const same = state.cart.find(p => p.menu.id === menu.id && String(p.price) === String(price) && !p.unit && !p.note && !p.error);
  let qty;
  if (same) { same.qty = String((Number(same.qty) || 0) + 1); qty = same.qty; }
  else { state.cart.push({ uid: ++cartUid, menu, qty: "1", price: String(price), unit: "", note: "", error: "" }); qty = "1"; }
  updateCartUI();
  return `✅ ${menu.displayName} ×${qty} (${money(price)}) · ในบิล ${state.cart.length} รายการ`;
}

function chooseMenuForScan(menus) {
  let back = document.getElementById("modal-scan-choose");
  if (!back) {
    back = document.createElement("div");
    back.className = "modal-backdrop hidden"; back.id = "modal-scan-choose"; back.style.zIndex = "500";
    back.innerHTML = '<div class="modal-sheet"><button type="button" class="modal-close" id="scan-choose-close">✕</button>' +
      '<h3>บาร์โค้ดนี้ตรงกับหลายเมนู</h3><div id="scan-choose-list" style="display:flex;flex-direction:column;gap:8px"></div></div>';
    document.body.appendChild(back);
    document.getElementById("scan-choose-close").addEventListener("click", () => back.classList.add("hidden"));
  }
  const list = document.getElementById("scan-choose-list");
  list.innerHTML = "";
  menus.forEach(m => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn outline"; b.textContent = m.displayName;
    b.addEventListener("click", () => {
      back.classList.add("hidden");
      const msg = scanAddMenu(m);
      if (SCAN.open) setScanStatus(msg); else toast(msg);
    });
    list.appendChild(b);
  });
  back.classList.remove("hidden");
}

document.getElementById("btn-sm-scan").addEventListener("click", () => {
  if (!state.salesChannel) { toast("กรุณาเลือกช่องทางการจำหน่ายก่อน", true); return; }
  openScanner({ title: "สแกนสินค้าลงบิล", continuous: true, onScan: (code) => handleSalesBarcode(code) });
});

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

  [["waste-product", stockedList]].forEach(([id, list]) => {
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
  renderCutList(rawOnly);
}

// หน้า "สต๊อกคงเหลือ" — ถ้าสินค้าตัวเดียวกันมีของเหลืออยู่หลายราคาทุนพร้อมกัน
// (ซื้อเข้าคนละรอบคนละราคา) จะแยกแสดงเป็นคนละแถวตามราคา เช่น
// "แตงโม ฿18/ลูก" กับ "แตงโม ฿22/ลูก" คนละแถว แทนที่จะรวมเป็นแถวเดียว
let productsListCache = null; // ผลลัพธ์ล่าสุดของ getProductsWithLots — ใช้ตอนพิมพ์ค้นหา/เปลี่ยนหมวด จะได้ไม่ต้องโหลดใหม่ทุกตัวอักษร
async function renderProductsList(useCache) {
  const wrap = document.getElementById("products-list");
  let list;
  if (useCache === true && productsListCache) {
    list = productsListCache;
  } else {
    wrap.innerHTML = '<div class="empty-state">กำลังโหลด…</div>';
    try {
      list = await apiGet("getProductsWithLots");
      if (list.error) throw new Error(list.error);
    } catch (err) {
      wrap.innerHTML = '<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>';
      return;
    }
    productsListCache = list;
  }
  if (!list.length) { wrap.innerHTML = '<div class="empty-state">ยังไม่มีสินค้า กด + เพื่อเพิ่มสินค้าแรก</div>'; return; }

  // ซ่อนสินค้าที่สต๊อกคงเหลือ = 0 ออกจากหน้านี้เท่านั้น (ไม่ได้ลบข้อมูลในชีตจริง)
  // เหตุผล: แต่ละรอบซื้อผลไม้ราคาทุนไม่เท่ากัน พอของหมดร้านจะเพิ่มเป็นสินค้าใหม่
  // แทนของเดิมอยู่แล้ว ตัวเก่าที่หมดสต๊อกเลยไม่จำเป็นต้องค้างโชว์ในลิสต์นี้อีก
  // ประวัติการขาย/ตัดสต๊อก/กำไรที่ผ่านมายังคำนวณถูกต้องปกติ เพราะข้อมูลเก่า
  // ยังอยู่ครบในชีต "ตัดสต๊อก"/"ขายออก"/"ของเสีย" ไม่เกี่ยวกับชีต "สินค้า" นี้
  // (ติ๊ก "แสดงสินค้าที่หมดสต๊อกด้วย" เหนือรายการ เพื่อเข้าไปแก้ไข/ลบสินค้าที่หมดแล้วได้)
  // ค้นหา/กรองหมวด: ถ้ามีคำค้น จะรวมสินค้าที่หมดสต๊อกด้วย (ไว้ค้นเจอแล้วกด "รับเข้า" ได้เลย)
  const q = normProductName((document.getElementById("prod-search") || {}).value);
  const catFilter = (document.getElementById("prod-filter-cat") || {}).value || "";
  let visibleList = (showEmptyStock || q) ? list : list.filter(p => Number(p["สต๊อกปัจจุบัน"]) > 0);
  if (q) visibleList = visibleList.filter(p => normProductName(p["ชื่อสินค้า"]).includes(q) || (q.length >= 4 && normProductName(p["บาร์โค้ด"]).includes(q)));
  if (catFilter) visibleList = visibleList.filter(p => p["หมวดหมู่"] === catFilter);
  if ((q || catFilter) && !visibleList.length) {
    wrap.innerHTML = '<div class="empty-state">ไม่พบสินค้าที่ค้นหา</div>';
    return;
  }

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
          <div class="sub">${p["หมวดหมู่"]}${p["บาร์โค้ด"] ? " · ▮ " + slipEsc(p["บาร์โค้ด"]) : ""}</div>
        </div>
        <div class="stock-trail">
          <div class="stock-cost">${money(cost)}</div>
          <div class="stock-unit">/ ${unit}</div>
        </div>
      `;
      row.querySelector(".main").appendChild(productActions(p));
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
        <div class="sub">${p["หมวดหมู่"]}${p["บาร์โค้ด"] ? " · ▮ " + slipEsc(p["บาร์โค้ด"]) : ""} · มีของเหลือหลายราคาทุน</div>
      </div>
    `;
    head.querySelector(".main").appendChild(productActions(p));
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

// ---- ปุ่ม "รับเข้า" ในหน้าดูคงเหลือ: กรอกแค่ราคา + จำนวน -> ล็อตใหม่ของสินค้าเดิม ----
let receiveTarget = null;
function updateReceiveCpu() {
  const price = Number(document.getElementById("receive-price").value) || 0;
  const qty = Number(document.getElementById("receive-qty").value) || 0;
  document.getElementById("receive-cpu").value = qty > 0 ? money(price / qty) : "—";
}
document.getElementById("receive-price").addEventListener("input", updateReceiveCpu);
document.getElementById("receive-qty").addEventListener("input", updateReceiveCpu);
function openReceiveModal(p) {
  receiveTarget = { id: p["รหัสสินค้า"], name: p["ชื่อสินค้า"], unit: p["หน่วยนับ"] };
  document.getElementById("receive-product-name").textContent = `${p["ชื่อสินค้า"]} (${p["หมวดหมู่"]})` + (p["บาร์โค้ด"] ? ` · บาร์โค้ด ${p["บาร์โค้ด"]}` : "");
  document.getElementById("receive-old").value = `${Number(p["สต๊อกปัจจุบัน"]) || 0} ${p["หน่วยนับ"] || ""}`;
  document.getElementById("receive-price").value = "";
  document.getElementById("receive-qty").value = "";
  document.getElementById("receive-cpu").value = "—";
  openModal("modal-receive");
  setTimeout(() => document.getElementById("receive-price").focus(), 80);
}
document.getElementById("form-receive").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!receiveTarget) return;
  const res = await submitWithLock(e.target, "receiveLot", {
    productId: receiveTarget.id,
    price: document.getElementById("receive-price").value,
    qty: document.getElementById("receive-qty").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast(`รับเข้าล็อตใหม่ของ "${res.name}" แล้ว (คงเหลือ ${res.newStock} ${res.unit})`);
    closeModal("modal-receive");
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "รับเข้าไม่สำเร็จ", true);
});

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
function openModal(id) { document.getElementById(id).classList.remove("hidden"); if (id === "modal-sale-summary" && typeof updateCartUI === "function") updateCartUI(); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); if (id === "modal-sale-summary" && typeof updateCartUI === "function") updateCartUI(); }
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

// พิมพ์ชื่อที่มีอยู่แล้ว (หมวดเดียวกัน — ทุกหมวด) -> แจ้งว่าจะรับเข้าเป็นล็อตใหม่ของสินค้าเดิม (ไม่สร้างสินค้าซ้ำ)
// ล็อค หน่วยนับ/สต๊อกขั้นต่ำ ให้ตามของเดิม ตรงกับที่เซิร์ฟเวอร์ทำจริง (addProduct ใน Code.gs)
function normProductName(n) { return String(n || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function findExistingProduct(name, category) {
  const key = normProductName(name);
  if (!key) return null;
  const rows = (state.products || []).filter(p => p["หมวดหมู่"] === category && normProductName(p["ชื่อสินค้า"]) === key);
  if (!rows.length) return null;
  return rows.find(p => Number(p["สต๊อกปัจจุบัน"]) > 0) || rows[rows.length - 1];
}
function updateDupHint() {
  const hint = document.getElementById("np-dup-hint");
  const unitEl = document.getElementById("np-unit");
  const minEl = document.getElementById("np-minstock");
  const ex = findExistingProduct(document.getElementById("np-name").value, document.getElementById("np-category").value);
  hint.classList.toggle("hidden", !ex);
  unitEl.readOnly = minEl.readOnly = !!ex;
  // ช่องราคาขาย โชว์เฉพาะสินค้าใหม่หมวดอื่นๆ (ถ้าเป็นสินค้าเดิมที่รับเข้าล็อตใหม่ มี Code/เมนูอยู่แล้ว ไม่ต้องกรอก)
  const cat = document.getElementById("np-category").value;
  document.getElementById("np-sell-wrap").classList.toggle("hidden", !(cat === "อื่นๆ" && !ex));
  if (ex) {
    unitEl.value = ex["หน่วยนับ"];
    minEl.value = ex["สต๊อกขั้นต่ำ"];
    hint.textContent = `✅ มี "${ex["ชื่อสินค้า"]}" อยู่แล้ว (คงเหลือ ${Number(ex["สต๊อกปัจจุบัน"]) || 0} ${ex["หน่วยนับ"]}) — จะรับเข้าเป็นล็อตใหม่ของสินค้าเดิม ราคาทุนต่างจากเดิมได้ ระบบตัดล็อตเก่าก่อนแล้วต่อล็อตใหม่ให้เอง และ Code/เมนูเดิมใช้ต่อได้เลย`;
  }
}
document.getElementById("np-name").addEventListener("input", updateDupHint);
document.getElementById("np-category").addEventListener("change", updateDupHint);

document.getElementById("form-add-product").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await submitWithLock(e.target, "addProduct", {
    name: document.getElementById("np-name").value,
    category: document.getElementById("np-category").value,
    unit: document.getElementById("np-unit").value,
    minStock: document.getElementById("np-minstock").value,
    barcode: document.getElementById("np-barcode").value.trim(),
    price: document.getElementById("np-price").value,
    qty: document.getElementById("np-qty").value,
    sellPrice: document.getElementById("np-sellprice").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    if (res.reused) {
      toast(`รับเข้าล็อตใหม่ของ "${res.name}" แล้ว (คงเหลือ ${res.newStock} ${res.unit}) — Code/เมนูเดิมใช้ต่อได้เลย` +
        (res.unitMismatch ? ` · ใช้หน่วย "${res.unit}" ตามของเดิม` : ""));
    } else if (res.auto && res.auto.menuCreated) {
      toast(`เพิ่มสินค้า + รับเข้าแล้ว และสร้าง Code + ปุ่มเมนูขาย (หมวดขนม) ให้อัตโนมัติ`);
    } else toast("เพิ่มสินค้า + รับเข้าเรียบร้อย");
    // ถ้าสร้าง Code/เมนูไม่ครบ ให้แจ้งเหตุผลแยกอีกอัน (ไม่ทับข้อความด้านบน)
    if (res.auto && res.auto.warning) setTimeout(() => toast(res.auto.warning, true), 2800);
    e.target.reset();
    npLastBarcode = "";
    document.getElementById("np-costperunit").value = "";
    updateDupHint();
    closeModal("modal-product");
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "เพิ่มสินค้าไม่สำเร็จ", true);
});

// ============================================================
// STOCK CUT — ตัดสต๊อกผลไม้/วัตถุดิบด้วยมือ (นำไปปอก/แปรรูป/ใช้งาน)
// ============================================================
// แสดงวัตถุดิบที่มีของเหลือเป็นเช็คลิสต์ เรียงตามอักษรไทย (ไม่อิงวันที่รับเข้า)
// ชื่อซ้ำ (ซื้อคนละรอบคนละราคา) ให้เรียงตามราคาทุนต่อ
// รักษาตัวเลขที่พิมพ์ค้างไว้ไม่ให้หายตอนข้อมูลรีเฟรช
function renderCutList(rawOnly) {
  const wrap = document.getElementById("cut-list");
  if (!wrap) return;
  const typed = {};
  wrap.querySelectorAll("input.cut-input").forEach(inp => { if (inp.value !== "") typed[inp.dataset.id] = inp.value; });

  const list = (rawOnly || []).slice().sort((x, y) =>
    String(x["ชื่อสินค้า"]).localeCompare(String(y["ชื่อสินค้า"]), "th") ||
    (Number(x["ราคาทุนล่าสุด"]) || 0) - (Number(y["ราคาทุนล่าสุด"]) || 0));

  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state">ยังไม่มีวัตถุดิบที่มีของเหลือให้ตัด</div>';
    updateCutSummary();
    return;
  }
  wrap.innerHTML = "";
  list.forEach(p => {
    const id = p["รหัสสินค้า"], unit = p["หน่วยนับ"] || "";
    const row = document.createElement("div");
    row.className = "cut-row";
    const nameBox = document.createElement("div");
    nameBox.className = "cut-name";
    nameBox.textContent = p["ชื่อสินค้า"];
    const small = document.createElement("small");
    small.textContent = `ตัดล็อตราคา ${money(p["ราคาทุนล็อตแรก"] != null ? p["ราคาทุนล็อตแรก"] : p["ราคาทุนล่าสุด"])}/${unit}`;
    nameBox.appendChild(small);
    const remain = document.createElement("div");
    remain.className = "cut-remain";
    remain.textContent = `${p["สต๊อกปัจจุบัน"]} ${unit}`;
    const inp = document.createElement("input");
    inp.type = "number"; inp.className = "cut-input"; inp.min = "0"; inp.step = "any";
    inp.inputMode = "decimal"; inp.placeholder = "0";
    inp.dataset.id = id; inp.dataset.stock = p["สต๊อกปัจจุบัน"]; inp.dataset.name = p["ชื่อสินค้า"];
    if (typed[id] !== undefined) inp.value = typed[id];
    inp.addEventListener("input", updateCutSummary);
    row.append(nameBox, remain, inp);
    wrap.appendChild(row);
  });
  updateCutSummary();
}

// ไฮไลต์แถวที่กรอก (ส้ม) / กรอกเกินคงเหลือ (แดง) และสรุปจำนวนรายการ
function updateCutSummary() {
  const inputs = document.querySelectorAll("#cut-list input.cut-input");
  let n = 0, over = 0;
  inputs.forEach(inp => {
    const v = Number(inp.value), has = inp.value !== "" && v > 0;
    const isOver = has && v > Number(inp.dataset.stock);
    inp.closest(".cut-row").classList.toggle("filled", has && !isOver);
    inp.closest(".cut-row").classList.toggle("over", isOver);
    if (has) n++;
    if (isOver) over++;
  });
  const el = document.getElementById("cut-summary");
  if (!el) return;
  el.textContent = over ? `⚠️ มี ${over} รายการที่กรอกเกินจำนวนคงเหลือ`
    : n ? `จะตัดสต๊อก ${n} รายการ` : "";
}

document.getElementById("form-stockcut").addEventListener("submit", async (e) => {
  e.preventDefault();
  const items = [];
  let bad = null;
  document.querySelectorAll("#cut-list input.cut-input").forEach(inp => {
    if (inp.value === "") return;
    const qty = Number(inp.value);
    if (!(qty > 0)) return;
    if (qty > Number(inp.dataset.stock)) bad = bad || inp.dataset.name;
    items.push({ productId: inp.dataset.id, qty });
  });
  if (bad) return toast(`"${bad}" กรอกเกินจำนวนคงเหลือ กรุณาตรวจสอบ`, true);
  if (!items.length) return toast("ยังไม่ได้กรอกจำนวนที่จะตัดสักรายการ", true);

  const res = await submitWithLock(e.target, "cutStockBatch", {
    items,
    note: document.getElementById("cut-note").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast(`บันทึกตัดสต๊อก ${res.done} รายการเรียบร้อย มูลค่าทุนที่ตัด ${money(res.costValue)}`);
    document.querySelectorAll("#cut-list input.cut-input").forEach(inp => { inp.value = ""; });
    document.getElementById("cut-note").value = "";
    updateCutSummary();
    refreshProducts(); refreshLowStock();
  } else {
    // บางรายการอาจบันทึกไปแล้ว — รีเฟรชให้ตัวเลขคงเหลือตรงกับความจริง
    toast(res.error || "บันทึกไม่สำเร็จ", true);
    refreshProducts(); refreshLowStock();
  }
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
      <input type="number" class="pack-qty" data-pack-id="${p["รหัสสินค้า"]}" value="1" min="0.5" step="0.5" style="width:72px" disabled>
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
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button type="button" class="btn outline btn-edit-code" data-code-id="${c.id}" style="width:auto;padding:8px 14px">แก้ไข</button>
        <button type="button" class="btn outline btn-del-code" data-code-id="${c.id}" style="width:auto;padding:8px 14px;color:#b23a3a;border-color:#e3b4b4">ลบ</button>
      </div>
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
// ช่อง "ราคาต่อกิโล" โชว์เฉพาะตอนเลือกหมวดที่ขายเป็นน้ำหนัก (ผลไม้สดชั่งกิโล)
function updateMenuKgFieldVisibility() {
  const cat = document.getElementById("menu-category").value;
  const weighed = WEIGHED_CATEGORIES.includes(cat);
  document.getElementById("menu-kg-field").classList.toggle("hidden", !weighed);
  // หมวดนี้ไม่ผูก Code: ซ่อนช่อง Code และเอา required ออก (ไม่งั้นฟอร์มส่งไม่ได้เพราะช่องที่ซ่อนอยู่ว่าง)
  document.getElementById("menu-code-field").classList.toggle("hidden", weighed);
  document.getElementById("menu-code").required = !weighed;
}
document.getElementById("menu-category").addEventListener("change", (e) => {
  updateMenuKgFieldVisibility();
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
  document.getElementById("menu-barcode").value = menu ? (menu.barcode || "") : "";
  document.getElementById("menu-price-kg").value = (menu && menu.priceKg !== "" && menu.priceKg !== undefined && menu.priceKg !== null) ? menu.priceKg : "";
  document.getElementById("menu-order").value = menu ? menu.order : "";
  document.getElementById("menu-order-field").classList.toggle("hidden", !menu);
  document.getElementById("menu-status-field").classList.toggle("hidden", !menu);
  if (menu) document.getElementById("menu-status").value = menu.status;
  fillMenuCategorySelect(menu ? menu.category : "");
  updateMenuKgFieldVisibility();
  fillMenuCodeSelect(menu ? menu.codeId : "");
  setMenuImagePreview(menu ? menu.image : "");
  openModal("modal-menu");
}
document.getElementById("menu-barcode-scan").addEventListener("click", () =>
  openScanner({ title: "สแกนบาร์โค้ดของเมนูนี้", onScan: (code) => { document.getElementById("menu-barcode").value = String(code).trim(); } })
);
document.getElementById("menu-barcode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.preventDefault(); // เครื่องยิงกด Enter ท้ายเลข ไม่ให้ฟอร์มถูกส่งก่อนกรอกครบ
});
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
  const isWeighedCat = WEIGHED_CATEGORIES.includes(category);
  const codeId = isWeighedCat ? "" : document.getElementById("menu-code").value;
  if (!isWeighedCat && !codeId) return toast("กรุณาเลือก Code", true);
  // แต่ละช่องทางเว้นว่างได้ (ราคาไม่คงที่) พนักงานจะกรอกเองตอนขายช่องทางนั้น
  const priceFrontVal = document.getElementById("menu-price-front").value;
  const priceJanuanVal = document.getElementById("menu-price-januan").value;
  const priceLinemanVal = document.getElementById("menu-price-lineman").value;
  const orderVal = document.getElementById("menu-order").value;

  const payload = {
    name, packaging, category,
    priceFront: priceFrontVal, priceJanuan: priceJanuanVal, priceLineman: priceLinemanVal,
    // หมวดอื่นไม่ใช้ราคาต่อกิโล ส่งค่าว่างเพื่อเคลียร์ค่าเก่า (กรณีย้ายเมนูออกจากหมวดชั่งกิโล)
    priceKg: WEIGHED_CATEGORIES.includes(category) ? document.getElementById("menu-price-kg").value : "",
    codeId, image: state.menuImageDataUrl || "",
    barcode: document.getElementById("menu-barcode").value.trim() // ว่าง = ลบบาร์โค้ดของเมนูนี้
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
  }).join(" · ") + (m.priceKg !== "" && m.priceKg !== undefined && m.priceKg !== null && Number(m.priceKg) > 0 ? ` · ต่อกิโล ${money(m.priceKg)}` : "");
}

function renderMenusAdminList() {
  const wrap = document.getElementById("menus-list");
  if (!state.menus.length) {
    wrap.innerHTML = '<div class="empty-state">ยังไม่มีเมนู — กด "+ เพิ่มเมนู" เพื่อสร้างอันแรก</div>';
    return;
  }
  wrap.innerHTML = "";
  const catIdx = c => { const i = state.menuCategories.indexOf(c); return i === -1 ? 999 : i; };
  const sorted = state.menus.slice().sort((a, b) => catIdx(a.category) - catIdx(b.category) || a.order - b.order);
  let lastCat = null;
  sorted.forEach(m => {
    if (m.category !== lastCat) {
      lastCat = m.category;
      const h = document.createElement("div");
      h.className = "sm-cat-heading"; h.textContent = m.category || "อื่นๆ";
      wrap.appendChild(h);
    }
    const code = state.codes.find(c => c.id === m.codeId);
    const priceText = formatMenuPrices(m);
    const row = document.createElement("div");
    row.className = "mm-row";
    row.innerHTML = `
      ${m.image ? `<img src="${m.image}" alt="">` : `<div class="ph">🍉</div>`}
      <div class="info">
        <div class="title">${m.displayName}</div>
        <div class="sub">${m.barcode ? "▮ " + slipEsc(m.barcode) + " · " : ""}${m.category || "-"} · ${isWeighedMenu(m) ? "ไม่หักบรรจุภัณฑ์" : (code ? code.name : "(ไม่พบ Code นี้แล้ว)")} · ${priceText}</div>
        <div class="sub ${m.status === "hidden" ? "hidden-badge" : ""}">${m.status === "hidden" ? "ซ่อนอยู่" : "แสดงอยู่ในหน้าขาย"} · ลำดับ ${m.order}</div>
      </div>
      <div class="acts">
        <button type="button" class="btn-edit-menu" data-menu-id="${m.id}">แก้ไข</button>
        <button type="button" class="btn-toggle-menu" data-menu-id="${m.id}" data-next="${m.status === "hidden" ? "active" : "hidden"}">${m.status === "hidden" ? "เปิดแสดง" : "ซ่อน"}</button>
        <button type="button" class="btn-del-menu" data-menu-id="${m.id}" style="color:#b23a3a;border-color:#e3b4b4">ลบ</button>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-move-menu" data-menu-id="${m.id}" data-dir="up" title="เลื่อนขึ้น" style="flex:1">▲</button>
          <button type="button" class="btn-move-menu" data-menu-id="${m.id}" data-dir="down" title="เลื่อนลง" style="flex:1">▼</button>
        </div>
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
  if (state.cart.length && btn.dataset.channel !== state.salesChannel) {
    toast("มีรายการในบิลอยู่ ราคาแต่ละช่องทางไม่เท่ากัน กรุณาชำระเงินหรือลบรายการให้หมดก่อนเปลี่ยนช่องทาง", true);
    return;
  }
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
    <div class="sm-tile-badge" style="display:none"></div>
    <button type="button" class="sm-menu-btn">
      ${m.image ? `<img src="${m.image}" alt="">` : `<div class="ph">🍉</div>`}
      <div class="nm">${m.displayName}</div>
    </button>
    <div class="sm-tile-expand hidden">
      <button type="button" class="sm-tile-close" title="ยกเลิก">✕</button>
      <div class="sm-tile-fields">
        <input type="number" class="sm-tile-qty" min="0.01" step="any" placeholder="จำนวน">
        ${isWeighedMenu(m) ? `<select class="sm-tile-unit">${WEIGHED_UNITS.map(u => `<option value="${u}">${u}</option>`).join("")}</select>` : ""}
        <input type="number" class="sm-tile-price" min="0" step="any" placeholder="ราคา/หน่วย" value="${hasPrice ? price : ""}">
        <input type="text" class="sm-tile-note" maxlength="60" placeholder="หมายเหตุ / ชื่อลูกค้า (ไม่ใส่ก็ได้)">
      </div>
      <div class="sm-tile-err hidden"></div>
      <button type="button" class="sm-tile-confirm hidden">เพิ่มรายการ</button>
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
  refreshTileBadges();
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
  const noteInp = tile.querySelector(".sm-tile-note");
  if (noteInp) noteInp.value = "";
  const unitSel = tile.querySelector(".sm-tile-unit");
  if (unitSel) unitSel.value = WEIGHED_UNITS[0];
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
  if (confirmBtn) { addToCart(confirmBtn.closest(".sm-tile")); return; }

  const menuBtn = e.target.closest(".sm-menu-btn");
  if (menuBtn) {
    if (!state.salesChannel) { toast("กรุณาเลือกช่องทางการจำหน่ายก่อน", true); return; }
    openSaleTile(menuBtn.closest(".sm-tile"));
  }
});
// เปลี่ยนหน่วยในการ์ดผลไม้ชั่งกิโล: ถ้าเมนูตั้ง "ราคาต่อกิโล" ไว้และขายช่องทางหน้าบ้าน ให้เติมราคาตามหน่วยให้อัตโนมัติ
// (กิโล = ราคาต่อกิโล, ลูก = ราคาหน้าบ้านปกติ) พนักงานแก้ราคาเองได้เสมอ ช่องทางอื่นไม่แตะราคา
document.getElementById("sm-menu-grid").addEventListener("change", (e) => {
  if (!e.target.classList.contains("sm-tile-unit")) return;
  const tile = e.target.closest(".sm-tile");
  const menu = state.salesMenus.find(m => m.id === tile.dataset.menuId);
  if (!menu || state.salesChannel !== "หน้าบ้าน") return;
  const hasKg = menu.priceKg !== "" && menu.priceKg !== undefined && menu.priceKg !== null;
  if (!hasKg) return;
  const p = e.target.value === "กิโล" ? menu.priceKg : getMenuPriceForChannel(menu, state.salesChannel);
  tile.querySelector(".sm-tile-price").value = p !== "" ? p : "";
  hideTileError(tile);
});
document.getElementById("sm-menu-grid").addEventListener("input", (e) => {
  const tile = e.target.closest(".sm-tile");
  if (!tile) return;
  if (e.target.classList.contains("sm-tile-qty")) updateTileConfirmVisibility(tile);
  if (e.target.classList.contains("sm-tile-qty") || e.target.classList.contains("sm-tile-price")) hideTileError(tile);
});

// ============================================================
// ตะกร้า/บิล (cart) ในโหมดขาย
// ขั้นตอนใหม่: แตะเมนู -> ใส่จำนวน/หน่วย/ราคา -> "เพิ่มรายการ" (ยังไม่บันทึกลงชีต)
// กลับมาหน้าเมนูปกติ เลือกเพิ่มได้อีกกี่รายการก็ได้ (เมนูเดิมซ้ำได้ เช่น กิโล + ลูก)
// พอครบแล้วกดแถบ "ยืนยันการชำระเงิน" ด้านล่างจอ -> เห็นรายการทั้งหมด ลบรายการที่
// ใส่ผิดได้ แล้วกด "ยืนยันการชำระเงิน" อีกครั้งเพื่อบันทึกทั้งบิลในคำขอเดียว
// ============================================================
(function installCartStyles() {
  const st = document.createElement("style");
  st.textContent = `
    .sm-tile{position:relative}
    .sm-tile-badge{position:absolute;top:8px;right:8px;z-index:2;min-width:26px;height:26px;padding:0 7px;border-radius:13px;background:#2F5233;color:#fff;font-size:13px;font-weight:700;line-height:26px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.25)}
    .cart-bar{position:fixed;left:14px;right:14px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:30}
    .cart-bar .btn{width:100%;box-shadow:0 6px 18px rgba(0,0,0,.28)}
    #sales-screen.has-cart .sm-grid{padding-bottom:110px}
    .cart-del{flex:0 0 auto;margin-left:10px;width:34px;height:34px;border-radius:50%;border:1px solid #d8d2c2;background:#fff;color:#b23a3a;font-size:15px;cursor:pointer;font-family:inherit}
    .cart-del:disabled{opacity:.4}
  `;
  document.head.appendChild(st);

  // ปุ่มบันทึกใน popup เปลี่ยนชื่อเป็น "ยืนยันการชำระเงิน"
  const ok = document.getElementById("btn-confirm-sale-summary");
  if (ok) ok.textContent = "ยืนยันการชำระเงิน";

  // ช่องชื่อลูกค้า "ทั้งบิล" ไว้บนรายการในหน้าสรุป (ไม่บังคับ)
  const list = document.getElementById("summary-items-list");
  if (list && !document.getElementById("cart-customer")) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin:0 0 10px";
    wrap.innerHTML = '<input type="text" id="cart-customer" maxlength="60" placeholder="ชื่อลูกค้า (ไม่ใส่ก็ได้ — ใช้กับทุกรายการในบิลนี้)" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.4px solid #d8d2c2;border-radius:10px;font-family:inherit;font-size:14px">';
    list.parentNode.insertBefore(wrap, list);
    wrap.querySelector("input").addEventListener("input", (e) => { state.cartCustomer = e.target.value; });
  }

  // แถบตะกร้าลอยท้ายจอ สร้างด้วย JS ไม่ต้องแก้ index.html
  const screen = document.getElementById("sales-screen");
  if (screen && !document.getElementById("cart-bar")) {
    const bar = document.createElement("div");
    bar.id = "cart-bar"; bar.className = "cart-bar"; bar.style.display = "none";
    bar.innerHTML = '<button type="button" class="btn mango" id="btn-open-cart"></button>';
    screen.appendChild(bar);
    bar.querySelector("button").addEventListener("click", openCartSummary);
  }
})();

let cartUid = 0;
function cartGrandTotal() {
  return state.cart.reduce((sum, p) => sum + computeSaleTotal(p.qty, p.price, state.salesChannel), 0);
}

// อัปเดตแถบท้ายจอ (ซ่อนเมื่อตะกร้าว่าง หรือตอน popup สรุปเปิดอยู่) + ป้ายนับบนการ์ด
function updateCartUI() {
  const bar = document.getElementById("cart-bar");
  const screen = document.getElementById("sales-screen");
  if (!bar || !screen) return;
  const modalOpen = !document.getElementById("modal-sale-summary").classList.contains("hidden");
  const n = state.cart.length;
  bar.style.display = (n && !modalOpen) ? "" : "none";
  screen.classList.toggle("has-cart", n > 0);
  const btn = document.getElementById("btn-open-cart");
  if (btn) btn.textContent = `ยืนยันการชำระเงิน · ${n} รายการ · ${money(cartGrandTotal())}`;
  refreshTileBadges();
}

// ป้ายเลขบนการ์ดเมนู = เมนูนี้ถูกเพิ่มลงบิลแล้วกี่รายการ (ระบบจำให้ว่าเคยคีย์แล้ว)
function refreshTileBadges() {
  const counts = {};
  state.cart.forEach((p) => { counts[p.menu.id] = (counts[p.menu.id] || 0) + 1; });
  document.querySelectorAll("#sm-menu-grid .sm-tile").forEach((tile) => {
    const badge = tile.querySelector(".sm-tile-badge");
    if (!badge) return;
    const c = counts[tile.dataset.menuId] || 0;
    badge.style.display = c ? "" : "none";
    badge.textContent = c ? `✓ ${c}` : "";
    tile.style.borderColor = c ? "#2F5233" : "";
  });
}

// กด "เพิ่มรายการ" บนการ์ด -> ตรวจจำนวน/ราคา -> ใส่ตะกร้า -> ยุบการ์ดกลับ ยังไม่บันทึกลงชีต
function addToCart(tile) {
  if (!tile) return;
  const menu = state.salesMenus.find((m) => m.id === tile.dataset.menuId);
  if (!menu) return;
  const qty = tile.querySelector(".sm-tile-qty").value;
  const price = tile.querySelector(".sm-tile-price").value;
  hideTileError(tile);
  if (!(qty !== "" && Number(qty) > 0)) { showTileError(tile, "กรุณาใส่จำนวน"); return; }
  if (price === "") { showTileError(tile, "กรุณาใส่ราคา (ใส่ 0 ได้ถ้าแจกฟรี)"); return; }
  const unitSel = tile.querySelector(".sm-tile-unit");
  const noteInp = tile.querySelector(".sm-tile-note");
  const note = noteInp ? noteInp.value.trim() : "";
  state.cart.push({ uid: ++cartUid, menu, qty, price, unit: unitSel ? unitSel.value : "", note, error: "" });
  collapseSaleTile(tile);
  updateCartUI();
  toast(`เพิ่ม ${menu.displayName} แล้ว`);
}

// วาดรายการในตะกร้า (ในหน้าสรุป) พร้อมปุ่มลบทีละรายการ + ยอดรวม
function renderCartSummary() {
  const wrap = document.getElementById("summary-items-list");
  wrap.innerHTML = state.cart
    .map((p) => {
      const total = computeSaleTotal(p.qty, p.price, state.salesChannel);
      return `
      <div class="list-row">
        <div class="main">
          <div class="title">${p.menu.displayName}</div>
          <div class="sub">${state.salesChannel} · ${p.qty}${p.unit ? " " + p.unit : ""} x ${money(p.price)}</div>
          ${p.note ? `<div class="sub">หมายเหตุ: ${slipEsc(p.note)}</div>` : ""}
          ${p.error ? `<div class="sm-tile-err">${p.error}</div>` : ""}
        </div>
        <div class="trail">${money(total)}</div>
        <button type="button" class="cart-del" data-uid="${p.uid}" title="ลบรายการนี้">✕</button>
      </div>`;
    })
    .join("");
  document.getElementById("summary-grand-total").textContent = money(cartGrandTotal());
}

// หมายเหตุที่บันทึกจริงของแต่ละรายการ = ชื่อลูกค้าทั้งบิล + หมายเหตุเฉพาะรายการ (ถ้ามี)
function cartItemNote(p) {
  const cust = (state.cartCustomer || "").trim();
  const own = (p.note || "").trim();
  if (cust && own && own !== cust) return cust + " · " + own;
  return cust || own;
}
function resetCartCustomer() {
  state.cartCustomer = "";
  const inp = document.getElementById("cart-customer");
  if (inp) inp.value = "";
}

function openCartSummary() {
  if (!state.cart.length) return;
  const inp = document.getElementById("cart-customer");
  if (inp) inp.value = state.cartCustomer || "";
  renderCartSummary();
  openModal("modal-sale-summary");
}

// ลบรายการที่เพิ่มผิด — ตะกร้าว่างเมื่อไหร่ popup ปิดเอง
document.getElementById("summary-items-list").addEventListener("click", (e) => {
  const del = e.target.closest(".cart-del");
  if (!del || state.cartSaving) return;
  state.cart = state.cart.filter((p) => String(p.uid) !== del.dataset.uid);
  if (!state.cart.length) { resetCartCustomer(); closeModal("modal-sale-summary"); return; }
  renderCartSummary();
  updateCartUI();
});
document.getElementById("btn-summary-back").addEventListener("click", () => closeModal("modal-sale-summary"));

// ยืนยันการชำระเงิน = บันทึกทุกรายการในตะกร้าในคำขอเดียว (stockOutBatch)
// เหตุผล: Google Apps Script ใช้เวลาประมาณ 3-5 วินาทีต่อคำขอ ถ้าส่งทีละรายการ
// 4 รายการก็ต้องรอ 15-20 วินาที ส่งครั้งเดียวให้เซิร์ฟเวอร์ประมวลผลต่อเนื่องในรอบเดียว
// ไม่ส่งพร้อมกันหลายคำขอ เพราะเซิร์ฟเวอร์ต้องต่อคิวล็อกอยู่ดี ไม่ได้เร็วขึ้น
// รายการที่ไม่ผ่าน (เช่น บรรจุภัณฑ์ไม่พอ) จะค้างอยู่ในตะกร้าพร้อมข้อความ error
// ให้ลบ/แก้แล้วกดยืนยันใหม่ได้ ส่วนรายการที่ผ่านบันทึกแล้วและถูกเอาออกจากตะกร้า
document.getElementById("btn-confirm-sale-summary").addEventListener("click", async () => {
  if (!state.cart.length || state.cartSaving) return;
  const items = state.cart.slice(); // snapshot ลำดับตรงกับ index ที่เซิร์ฟเวอร์ตอบกลับ
  const btn = document.getElementById("btn-confirm-sale-summary");
  const backBtn = document.getElementById("btn-summary-back");
  state.cartSaving = true;
  btn.disabled = true;
  backBtn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "กำลังบันทึก...";
  items.forEach((p) => { p.error = ""; });

  const payloadItems = items.map((p) => {
    // เมนูผลไม้สดชั่งกิโลไม่หักบรรจุภัณฑ์ (ไม่ใช้ Code แม้ในชีตจะยังเหลือค่าเก่าอยู่)
    const code = isWeighedMenu(p.menu) ? null : state.codes.find((c) => c.id === p.menu.codeId);
    const packaging = code ? code.packaging.map((x) => ({ productId: x.productId, qty: x.qty })) : [];
    return {
      // สินค้าชั่งกิโล: ต่อหน่วยท้ายชื่อ เช่น "แอปเปิ้ล ฟูจิ (ลูก)" จะได้แยกในสรุป/สถิติ ไม่เอากิโลไปรวมกับลูก
      itemName: p.menu.displayName + (p.unit ? ` (${p.unit})` : ""),
      code: code ? code.name : "",
      qty: p.qty,
      sellPrice: p.price,
      note: cartItemNote(p),
      packaging,
    };
  });

  const lowStockAll = new Set();
  const saved = new Set();
  try {
    const res = await apiPost("stockOutBatch", {
      channel: state.salesChannel,
      items: payloadItems,
      employee: state.employee.name,
    });

    if (!res || !Array.isArray(res.results)) {
      // ทั้งคำขอไม่สำเร็จ (เช่น ระบบคิวไม่ว่าง) ไม่มีรายการไหนถูกบันทึก
      const msg = (res && res.error) || "บันทึกไม่สำเร็จ";
      items.forEach((p) => { p.error = msg; });
    } else {
      res.results.forEach((r) => {
        const p = items[r.index];
        if (!p) return;
        if (r.ok) {
          saved.add(p);
          (r.lowStock || []).forEach((x) => lowStockAll.add(x));
        } else {
          p.error = r.error || "บันทึกไม่สำเร็จ";
        }
      });
    }
  } catch (err) {
    // เน็ตหลุดกลางทาง: ไม่รู้ว่าเซิร์ฟเวอร์บันทึกไปหรือยัง ให้ตรวจที่หน้าสรุปยอดก่อนกดซ้ำ
    items.forEach((p) => { p.error = "เชื่อมต่อไม่สำเร็จ — ตรวจที่หน้าสรุปยอดก่อนกดซ้ำ กันบันทึกซ้ำ"; });
  }

  state.cart = state.cart.filter((p) => !saved.has(p));
  state.cartSaving = false;
  btn.disabled = false;
  backBtn.disabled = false;
  btn.textContent = originalText;

  if (state.cart.length) {
    // ยังมีรายการที่ไม่ผ่าน: เปิด popup ค้างไว้ให้เห็น error ที่แต่ละรายการ
    renderCartSummary();
    updateCartUI();
    toast(`บันทึกไม่สำเร็จ ${state.cart.length} รายการ — ดูข้อความสีแดงใต้ชื่อรายการ ลบหรือแก้แล้วกดยืนยันใหม่ได้`, true);
  } else {
    resetCartCustomer();
    closeModal("modal-sale-summary"); // closeModal เรียก updateCartUI ให้เอง
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
    document.getElementById("sum-othergoods").textContent = money(sum.totalOtherGoodsCost);
    document.getElementById("sum-waste").textContent = money(sum.totalWaste);
    document.getElementById("sum-costs").textContent = money(sum.totalOtherCosts);
    document.getElementById("sum-in").textContent = money(sum.totalStockIn);

    document.getElementById("sum-rawcut").textContent = money(sum.totalRawMaterialCut);
    document.getElementById("sum-formula-hint").textContent =
      "กำไร = ยอดขาย − ต้นทุนผลไม้ที่ตัดใช้จริง − ต้นทุนบรรจุภัณฑ์ที่ใช้จริง − ต้นทุนสินค้าหมวดอื่นๆ − ของเสีย − ค่าใช้จ่ายอื่น (ยอดซื้อของช่วงนี้เป็นข้อมูลอ้างอิงกระแสเงินสด ไม่ได้ถูกหักซ้ำในการคำนวณกำไร)";

    renderSummaryStockOutList(sum.stockOutList);
    renderSummaryExtraLists(sum);
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
    ["ต้นทุนสินค้าหมวดอื่นๆ (ขนม นม น้ำ)", sum.totalOtherGoodsCost],
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
    const row = recordRow({
      title: r.itemName || "(ไม่ระบุชื่อ)",
      sub: `${fmtDT(r.date)} · จำนวน ${r.qty} × ${money(r.sellPrice)}${r.channel ? " · " + r.channel : ""}${r.employee ? " · " + r.employee : ""}${r.note ? " · " + r.note : ""}`,
      amount: money(r.total), amountCls: "pos",
      actions: [
        actBtn("แก้ไข", () => editSaleRecord(r)),
        actBtn("ลบ", () => deleteWithConfirm("deleteStockOut", { id: r.id, ts: r.ts },
          `ลบรายการขาย "${r.itemName}" จำนวน ${r.qty} (${money(r.total)})?\nบรรจุภัณฑ์ที่หักไปจะถูกคืนเข้าสต๊อกให้`, "ลบรายการขายแล้ว", afterRecordChange), true),
      ],
    });
    wrap.appendChild(row);
  });
}


// ============================================================
// รายการวันนี้
// - หลังบ้าน (admin): ทุกอย่างของวันนี้ — เพิ่มสินค้า/รับเข้า, ตัดสต๊อก, ปรับคงเหลือ,
//   รายการขาย, ของเสีย, ค่าใช้จ่ายอื่น + ตัวเลขต้นทุน/กำไร
// - หน้าขาย: เฉพาะรายการขายที่คีย์แล้ว + ยอดขายรวม (ไม่มีต้นทุน/กำไร)
//   ฝั่งเซิร์ฟเวอร์ส่งข้อมูลต้นทุนมาให้เฉพาะ admin ที่เรียก scope=full เท่านั้น
// ============================================================
function fmtTime(v) {
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}
function todayDateLabel() {
  return new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function todaySaleRow(r) {
  return recordRow({
    title: r.itemName || "(ไม่ระบุชื่อ)",
    sub: `${fmtTime(r.date)} · จำนวน ${r.qty} × ${money(r.sellPrice)}${r.channel ? " · " + r.channel : ""}${r.employee ? " · " + r.employee : ""}${r.note ? " · " + r.note : ""}`,
    amount: money(r.total), amountCls: "pos",
  });
}
function todayCard(parent, label, list, emptyMsg, build) {
  const lab = document.createElement("div");
  lab.className = "section-label";
  lab.style.marginTop = "18px";
  lab.textContent = `${label} (${list ? list.length : 0})`;
  parent.appendChild(lab);
  const card = document.createElement("div");
  card.className = "card";
  parent.appendChild(card);
  if (!list || !list.length) { card.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; return; }
  list.forEach(x => card.appendChild(build(x)));
}
function todayStat(label, value, cls) {
  return `<div class="stat-card ${cls || ""}"><div class="label">${label}</div><div class="value">${money(value)}</div></div>`;
}

async function loadTodayBackoffice() {
  const body = document.getElementById("today-body");
  document.getElementById("today-date-label").textContent = todayDateLabel();
  body.innerHTML = '<div class="empty-state">กำลังโหลด…</div>';
  try {
    const d = await apiGet("getTodayLog", { scope: "full" });
    if (d.error) { body.innerHTML = `<div class="empty-state">${slipEsc(d.error)}</div>`; return; }
    body.innerHTML = "";
    const stats = document.createElement("div");
    stats.className = "stat-grid";
    stats.innerHTML =
      todayStat("ยอดขายวันนี้", d.totalRevenue) +
      todayStat("กำไรโดยประมาณ", d.profit, "mango") +
      todayStat("ซื้อเข้า/รับเข้า", d.totalReceived) +
      todayStat("ต้นทุนผลไม้ที่ตัด", d.totalRawMaterialCut, "plum") +
      todayStat("ต้นทุนบรรจุภัณฑ์", d.totalPackagingCost, "plum") +
      todayStat("ต้นทุนสินค้าหมวดอื่นๆ (ขนม นม น้ำ)", d.totalOtherGoodsCost, "plum") +
      todayStat("ของเสีย", d.totalWaste, "danger") +
      todayStat("ค่าใช้จ่ายอื่น", d.totalOtherCosts, "danger");
    body.appendChild(stats);

    todayCard(body, "เพิ่มสินค้า / รับเข้า", d.received, "วันนี้ยังไม่มีการเพิ่มสินค้าหรือรับเข้า", r => recordRow({
      title: r.productName || "(ไม่ระบุชื่อ)",
      sub: `${fmtTime(r.date)} · รับเข้า ${r.qty} × ${money(r.unitCost)}${r.note ? " · " + r.note : ""}${r.employee ? " · " + r.employee : ""}`,
      amount: money(r.total), amountCls: "",
    }));
    todayCard(body, "ตัดสต๊อก", d.cuts, "วันนี้ยังไม่มีการตัดสต๊อก", r => recordRow({
      title: r.productName || "(ไม่ระบุชื่อ)",
      sub: `${fmtTime(r.date)} · ตัด ${r.qty}${r.note ? " · " + r.note : ""}${r.employee ? " · " + r.employee : ""}`,
      amount: money(r.cost), amountCls: "neg",
    }));
    todayCard(body, "ปรับคงเหลือ", d.adjusts, "วันนี้ยังไม่มีการปรับคงเหลือ", r => recordRow({
      title: r.productName || "(ไม่ระบุชื่อ)",
      sub: `${fmtTime(r.date)} · ${r.oldStock} → ${r.newStock}${r.note ? " · " + r.note : ""}${r.employee ? " · " + r.employee : ""}`,
      amount: (r.diff > 0 ? "+" : "") + r.diff, amountCls: r.diff < 0 ? "neg" : "pos",
    }));
    todayCard(body, "รายการขาย", d.sales, "วันนี้ยังไม่มีรายการขาย", todaySaleRow);
    todayCard(body, "ของเสีย", d.waste, "วันนี้ไม่มีของเสีย", r => recordRow({
      title: r.productName || "(ไม่ระบุชื่อ)",
      sub: `${fmtTime(r.date)} · จำนวน ${r.qty}${r.reason ? " · " + r.reason : ""}${r.employee ? " · " + r.employee : ""}`,
      amount: money(r.cost), amountCls: "neg",
    }));
    todayCard(body, "ค่าใช้จ่ายอื่น", d.costs, "วันนี้ไม่มีค่าใช้จ่ายอื่น", r => recordRow({
      title: r.category || "(ไม่ระบุประเภท)",
      sub: `${fmtTime(r.date)}${r.description ? " · " + r.description : ""}${r.employee ? " · " + r.employee : ""}`,
      amount: money(r.amount), amountCls: "neg",
    }));
  } catch (err) {
    body.innerHTML = '<div class="empty-state">โหลดรายการวันนี้ไม่สำเร็จ</div>';
    toast("โหลดรายการวันนี้ไม่สำเร็จ", true);
  }
}
document.getElementById("today-refresh-btn").addEventListener("click", loadTodayBackoffice);

async function loadTodaySales() {
  const body = document.getElementById("today-sales-body");
  document.getElementById("today-sales-date").textContent = todayDateLabel();
  body.innerHTML = '<div class="empty-state">กำลังโหลด…</div>';
  try {
    const d = await apiGet("getTodayLog", { scope: "sales" });
    if (d.error) { body.innerHTML = `<div class="empty-state">${slipEsc(d.error)}</div>`; return; }
    body.innerHTML = "";
    const stats = document.createElement("div");
    stats.className = "stat-grid";
    stats.innerHTML = todayStat("ยอดขายวันนี้", d.totalRevenue) +
      `<div class="stat-card plum"><div class="label">จำนวนรายการ</div><div class="value">${d.countSales || 0}</div></div>`;
    body.appendChild(stats);
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "12px";
    if (!d.sales || !d.sales.length) card.innerHTML = '<div class="empty-state">วันนี้ยังไม่มีรายการขาย</div>';
    else d.sales.forEach(r => card.appendChild(todaySaleRow(r)));
    body.appendChild(card);
  } catch (err) {
    body.innerHTML = '<div class="empty-state">โหลดรายการวันนี้ไม่สำเร็จ</div>';
    toast("โหลดรายการวันนี้ไม่สำเร็จ", true);
  }
}
document.getElementById("btn-sm-today").addEventListener("click", () => { openModal("modal-today-sales"); loadTodaySales(); });
document.getElementById("btn-today-sales-refresh").addEventListener("click", loadTodaySales);

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
          <div class="sub">${emp.id} · ${emp.role === "admin" ? "ผู้ดูแลระบบ" : "พนักงาน"} · ${emp.status === "active" ? "ใช้งาน" : "ระงับ"}</div>
        </div>`;
      const acts = [actBtn("แก้ไข", () => editEmployee(emp))];
      if (!state.employee || emp.id !== state.employee.id) {
        acts.push(actBtn("ลบ", () => deleteWithConfirm("deleteEmployee", { empId: emp.id },
          `ลบพนักงาน "${emp.name}" ออกจากระบบ?\n(ถ้าแค่ไม่ให้เข้าใช้ชั่วคราว ให้เลือก แก้ไข > สถานะ = ระงับ แทน)`, "ลบพนักงานแล้ว", loadEmployeesList), true));
      }
      row.querySelector(".main").appendChild(actionRow(acts));
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
  .ord-top{display:flex;justify-content:space-between;font-weight:600}.ord-sub{font-size:13px;color:#6b665a;margin-top:4px}.ord-acts{display:flex;gap:8px;margin-top:12px;align-items:stretch}
  #ord-page,#fruit-page,#shop-page{position:fixed;inset:0;z-index:60;background:#faf6ef;display:none;flex-direction:column}#ord-page.show,#fruit-page.show,#shop-page.show{display:flex}
  .ord-head{display:flex;align-items:center;gap:12px;background:#2F5233;color:#fff;padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px;flex-shrink:0}.ord-title{font-weight:700;font-size:18px;flex:1}
  #ord-list,#fruit-list,#shop-list{flex:1;overflow:auto;padding:14px 16px 96px;width:100%;max-width:1100px;margin:0 auto}.ord-h{margin:16px 0 8px;font-size:15px;color:#8a5a2b}.ord-h.late{color:#d63a2f}
  .shp-card{background:#fff;border:1px solid #e7e2d6;border-radius:14px;padding:14px;margin-bottom:12px}
  .shp-st{font-weight:700;font-size:17px;margin-bottom:10px}.shp-st.on{color:#2F5233}.shp-st.off{color:#d63a2f}
  .shp-seg{display:flex;gap:8px;margin-bottom:10px}.shp-seg button{flex:1;padding:12px;border-radius:10px;border:1.5px solid #d8d2c2;background:#fff;font:600 15px inherit;font-family:inherit}
  .shp-seg button.on{background:#2F5233;border-color:#2F5233;color:#fff}.shp-seg button.off{background:#d63a2f;border-color:#d63a2f;color:#fff}
  .shp-note{display:flex;gap:8px}.shp-note input{flex:1;min-width:0;padding:10px;border:1.4px solid #d8d2c2;border-radius:9px;font:inherit}
  .shp-dates{display:flex;gap:10px;margin-bottom:10px}.shp-dt{flex:1;min-width:0}.shp-dt label{display:block;font-size:12.5px;color:#6b665a;margin-bottom:4px}.shp-dt input{width:100%;padding:10px;border:1.4px solid #d8d2c2;border-radius:9px;font:inherit;background:#fff}
  .shp-cat{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.shp-cat b{font-size:15px;color:#8a5a2b}
  .shp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-top:1px solid #eee}.shp-row span{flex:1;min-width:0}
  .shp-sw{border:none;border-radius:999px;padding:8px 14px;font:600 13px inherit;font-family:inherit;background:#dcefd8;color:#2F5233;white-space:nowrap}
  .shp-sw.off{background:#fbe4e1;color:#c1443c}.shp-sw:disabled{opacity:.5}.shp-row.dim span{color:#999}
  .ord-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}.ord-grid .ord-card{margin:0}
.ord-acts button{width:auto;min-width:0;flex:1 1 0;padding:12px 6px;font-size:14px;line-height:1.2;white-space:nowrap;border-radius:12px}
  .ord-acts button:not(.outline){flex:1.7 1 0}
  .ord-acts button.ord-cancel{color:#c1443c;border-color:rgba(193,68,60,.35);background:#fff}
  .ord-acts button.ord-print{flex:0 0 auto;padding:12px 14px;background:#fff;color:#2F5233;border:1.5px solid rgba(47,82,51,.35)}
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
    await loadAlertSound();
    beep();
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    await keepScreenOn();
    document.getElementById("ord-sound").style.display = "none";
    localStorage.setItem("2kor_alert_day", todayStr()); // จำว่าวันนี้เปิดแล้ว ข้ามวันค่อยกดใหม่
  } catch (e) { toast("เปิดเสียงไม่สำเร็จ ลองแตะอีกครั้ง", true); }
}

// เปิดระบบแจ้งเตือนเองถ้าวันนี้เคยกดไปแล้ว (ไม่ต้องกดปุ่มซ้ำ)
// เบราว์เซอร์ห้ามเล่นเสียงจนกว่าจะมีการ "แตะ" หน้านี้อย่างน้อย 1 ครั้ง จึงทำ 2 ขั้น:
// 1) ถ้าเคยแตะแล้วในหน้านี้ (เช่น แตะปุ่ม PIN ตอนล็อกอิน) เปิดทันที
// 2) ถ้ายังไม่เคยแตะ รอแตะครั้งแรกตรงไหนของหน้าจอก็ได้ แล้วเปิดให้เงียบๆ
function autoEnableOrderAlerts() {
  if (ORD.soundOn || localStorage.getItem("2kor_alert_day") !== todayStr()) return;
  ORD.rememberedToday = true;
  const hasTapped = navigator.userActivation && navigator.userActivation.hasBeenActive;
  if (hasTapped) { enableOrderAlerts(); return; }
  const once = () => {
    document.removeEventListener("pointerdown", once, true);
    document.removeEventListener("keydown", once, true);
    enableOrderAlerts();
  };
  document.addEventListener("pointerdown", once, true);
  document.addEventListener("keydown", once, true);
}
async function keepScreenOn() {
  try { if ("wakeLock" in navigator && !ORD.wake) { ORD.wake = await navigator.wakeLock.request("screen"); ORD.wake.addEventListener("release", () => { ORD.wake = null; }); } } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ORD.soundOn) keepScreenOn(); });

// เสียงแจ้งเตือนออเดอร์: เล่นไฟล์ order-alert.mp3 ผ่าน Web Audio (ปรับความดังได้ ไม่ติดปัญหา autoplay/range)
// ถ้าโหลดไฟล์ไม่ได้จะถอยกลับไปใช้เสียงบี๊บสังเคราะห์เดิม
const ALERT_GAIN = 1.8; // เพิ่ม/ลดความดัง (1 = เท่าไฟล์ต้นฉบับ) ถ้าเสียงแตกให้ลดลง
async function loadAlertSound() {
  if (ORD.buf || ORD.bufLoading || !ORD.ctx) return;
  ORD.bufLoading = true;
  try {
    const r = await fetch("./order-alert.mp3");
    ORD.buf = await ORD.ctx.decodeAudioData(await r.arrayBuffer());
  } catch (e) { ORD.buf = null; }
  ORD.bufLoading = false;
}
function beepFallback() {
  [0, 0.25, 0.5].forEach((t, i) => {
    const o = ORD.ctx.createOscillator(), g = ORD.ctx.createGain();
    o.frequency.value = i === 2 ? 1320 : 880; o.connect(g); g.connect(ORD.ctx.destination);
    g.gain.setValueAtTime(0.4, ORD.ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ORD.ctx.currentTime + t + 0.2);
    o.start(ORD.ctx.currentTime + t); o.stop(ORD.ctx.currentTime + t + 0.22);
  });
}
function beep() {
  if (!ORD.soundOn || !ORD.ctx) return;
  if (!ORD.buf) { loadAlertSound(); beepFallback(); return; }
  if (ORD.playing) return; // ยังเล่นรอบก่อนไม่จบ ไม่ซ้อนกัน
  const src = ORD.ctx.createBufferSource(), g = ORD.ctx.createGain(), lim = ORD.ctx.createDynamicsCompressor();
  src.buffer = ORD.buf; g.gain.value = ALERT_GAIN;
  lim.threshold.value = -6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15; // กันเสียงแตกเวลาเร่งความดัง
  src.connect(g); g.connect(lim); lim.connect(ORD.ctx.destination);
  ORD.playing = true; src.onended = () => { ORD.playing = false; };
  src.start();
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
  // ถ้าวันนี้กดไว้แล้ว (รอแตะหน้าจอครั้งแรก) ซ่อนปุ่มไว้ก่อน โผล่เฉพาะตอนมีออเดอร์ใหม่ที่ยังไม่มีเสียง
  document.getElementById("ord-sound").style.display = (!ORD.soundOn && (!ORD.rememberedToday || fresh.length)) ? "block" : "none";

  if (fresh.some(o => String(o.when).slice(0, 10) >= todayStr())) beep(); // ดังซ้ำทุกรอบจนกว่าจะมีคนกดรับ (ออเดอร์ค้างจากวันก่อนไม่ดัง แต่ยังขึ้นสีแดงในหน้าออเดอร์)
  if (brandNew.length && "Notification" in window && Notification.permission === "granted" && document.hidden) {
    const o = brandNew[0], msg = `${o.name} · ${o.items.length} รายการ · ฿${o.total}`;
    navigator.serviceWorker.ready.then(r => r.showNotification("ออเดอร์ใหม่", { body: msg, tag: "new-order", renotify: true, requireInteraction: true })).catch(() => {});
  }
  if (document.getElementById("ord-page").classList.contains("show")) renderOrders();
}
setInterval(pollOrders, 15000);
setTimeout(pollOrders, 2500);
setTimeout(autoEnableOrderAlerts, 1500);

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
  o.items.forEach(it => c.append(el("div", "ord-sub", `${it.name} x ${it.qty}${it.unit ? " " + it.unit : ""}` + (it.fruits && it.fruits.length ? " : " + it.fruits.join(", ") : ""))));
  if (o.note) c.append(el("div", "ord-sub", "หมายเหตุ: " + o.note));
  c.append(el("div", "ord-sub", `สถานะ: ${o.status}${o.staff ? " (โดย " + o.staff + ")" : ""}`));
  const next = { "รอรับ": [["รับออเดอร์", "รับแล้ว", "btn mango"], ["ยกเลิก", "ยกเลิก", "btn outline ord-cancel"]], "รับแล้ว": [["พร้อมรับ/กำลังส่ง", "พร้อมรับ/กำลังส่ง", "btn"], ["เสร็จสิ้น", "เสร็จสิ้น", "btn outline"]], "พร้อมรับ/กำลังส่ง": [["เสร็จสิ้น", "เสร็จสิ้น", "btn"]] }[o.status] || [];
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
  bOpen.onclick = () => { if (d.shopClosed) save({ type: "shop", closed: false, note: noteIn.value }, "เปิดร้านวันนี้แล้ว"); };
  bClose.onclick = () => { if (!d.shopClosed && confirm("ปิดร้านวันนี้? ลูกค้าจะสั่งนัดวันนี้ไม่ได้")) save({ type: "shop", closed: true, note: noteIn.value }, "ปิดร้านวันนี้แล้ว"); };
  seg.append(bOpen, bClose);
  const nb = el("div", "shp-note"), nbtn = el("button", "btn sm", "บันทึก"); nbtn.type = "button";
  nbtn.onclick = () => save({ type: "note", note: noteIn.value }, "บันทึกข้อความแล้ว");
  nb.append(noteIn, nbtn);
  c1.append(seg, nb, el("div", "ord-sub", "ลูกค้าจะเห็น popup แจ้งสถานะร้านทุกครั้งที่เปิดหน้าสั่งอาหาร"));

  // วันหยุดล่วงหน้า / เป็นช่วงวัน
  const th = v => new Date(v + "T12:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  const rtxt = r => r[0] === r[1] ? th(r[0]) : th(r[0]) + " – " + th(r[1]);
  const c2 = el("div", "shp-card");
  c2.append(el("div", "shp-st", "📅 ตั้งวันหยุดล่วงหน้า"));
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const mk = (lbl, val) => { const w = el("div", "shp-dt"), i = el("input"); i.type = "date"; i.min = today; i.value = val; w.append(el("label", "", lbl), i); return [w, i]; };
  const [wf, from] = mk("ตั้งแต่วันที่", today), [wt, to] = mk("ถึงวันที่", today);
  from.onchange = () => { if (to.value < from.value) to.value = from.value; };
  const dr = el("div", "shp-dates"); dr.append(wf, wt);
  const addB = el("button", "btn mango", "เพิ่มวันหยุด"); addB.type = "button";
  addB.onclick = () => {
    if (!from.value) return toast("เลือกวันที่ก่อน", true);
    const t = to.value || from.value;
    save({ type: "closeRange", from: from.value, to: t }, "ตั้งวันหยุดแล้ว");
  };
  c2.append(dr, addB);
  const list = d.closures || [];
  if (list.length) {
    c2.append(el("div", "ord-sub", "วันหยุดที่ตั้งไว้"));
    list.forEach(r => {
      const row = el("div", "shp-row"), x = el("button", "shp-sw off", "ยกเลิก"); x.type = "button";
      x.onclick = () => { if (confirm("ยกเลิกวันหยุด " + rtxt(r) + " ?")) save({ type: "openRange", from: r[0], to: r[1] }, "ยกเลิกวันหยุดแล้ว"); };
      row.append(el("span", "", "🔴 " + rtxt(r) + (r[0] <= today && today <= r[1] ? " (วันนี้ปิด)" : "")), x); c2.append(row);
    });
  }
  wrap.appendChild(c1); wrap.appendChild(c2);

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
// (เครื่อง 57/58mm พิมพ์ได้จริงราว 46-48mm ถ้าขอบซ้าย/ขวายังขาด ให้ลดค่า CONTENT)
// FEED = จำนวนแถวเส้นประท้ายใบ ดันกระดาษให้พ้นแท่งฉีก ไม่งั้นบรรทัดท้าย ๆ จะค้างอยู่ในเครื่อง (ไดรเวอร์มักตัดพื้นที่ว่างท้ายหน้าทิ้ง จึงต้องมีเส้นพิมพ์จริง) ถ้ายังขาดให้เพิ่มเป็น 3
const ORD_PRINT = { PAPER: "57mm", CONTENT: "46mm", FEED: 2, EXTRA_MM: 6, FIXED_HEIGHT_MM: 0, SHOP: "2 กอ ผลไม้ปอกพร้อมทาน", LOGO: "./icons/logo-256.png" };

// ---- ตัวช่วยพิมพ์สลิปกลาง (ใช้ร่วมกันทุกใบ: ออเดอร์ออนไลน์ / สรุปยอด / บิลขาย) ----
// ทุกใบใช้ ORD_PRINT ชุดเดียวกัน ขนาดกระดาษจึงเท่ากันเสมอ แก้ที่ ORD_PRINT ที่เดียวมีผลทุกใบ
function slipEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ห่อเนื้อหา (bodyHtml) ด้วย CSS สลิปมาตรฐาน คืนเป็นหน้า HTML เต็ม
function slipDocument(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${slipEsc(title)}</title><style>
@page{margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{width:100%;max-width:${ORD_PRINT.CONTENT};margin:0 auto;padding:2mm 0 1mm;color:#000;font-family:"Noto Sans Thai","Sarabun","IBM Plex Sans Thai",sans-serif;font-size:12px;line-height:1.35}
.c{text-align:center}.logo{display:block;margin:0 auto 3px;width:22mm;height:auto;filter:grayscale(1) contrast(1.6)}
.shop{font-size:15px;font-weight:700;text-align:center}.sub{text-align:center;font-size:11px}
.hr{border:0;border-top:1px dashed #000;margin:5px 0}.hr2{border:0;border-top:2px solid #000;margin:5px 0}
.id{font-size:16px;font-weight:700;text-align:center}
.kv{word-break:break-word}.kv b{font-weight:700}
.it{margin-bottom:4px}.r{display:flex;justify-content:space-between;gap:6px}.r span:last-child{white-space:nowrap}
.fr{padding-left:8px;font-size:11px;word-break:break-word}
.tot{font-size:16px;font-weight:700}
.fd{margin-top:4mm;text-align:center;font-size:10px;line-height:1}
.note{border:1px solid #000;padding:2px 4px;margin-top:3px;word-break:break-word}
</style></head><body>
<img class="logo" id="logo" src="${slipEsc(new URL(ORD_PRINT.LOGO, location.href).href)}" alt="">
<div class="shop">${slipEsc(ORD_PRINT.SHOP)}</div>
${bodyHtml}
${Array(ORD_PRINT.FEED).fill('<div class="fd">- - - - - - - - - - - - - - -</div>').join("")}
</body></html>`;
}

// ส่งหน้า HTML ที่ได้จาก slipDocument เข้า iframe ซ่อน แล้วสั่งพิมพ์
function runSlipPrint(html) {
  const fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:57mm;height:10px;border:0;visibility:hidden";
  document.body.appendChild(fr);
  const doc = fr.contentDocument; doc.open(); doc.write(html); doc.close();
  const cleanup = () => setTimeout(() => fr.remove(), 1000);
  const go = () => {
    if (go.done) return; go.done = true;
    // ตั้งความยาวกระดาษเป็นตัวเลขจริงตามความสูงเนื้อหา (วัดหลังโหลดโลโก้แล้ว)
    // เดิมใช้ "size: 57mm auto" ซึ่งเป็นค่าที่ไม่ถูกต้องตามมาตรฐาน CSS เบราว์เซอร์จึงทิ้งทั้งบรรทัด
    // แล้วใช้ความยาวกระดาษเริ่มต้นของไดรเวอร์เครื่องพิมพ์แทน ทำให้ใบถูกตัดท้าย
    try {
      const mm = ORD_PRINT.FIXED_HEIGHT_MM || Math.max(40, Math.ceil(doc.body.scrollHeight * 25.4 / 96) + ORD_PRINT.EXTRA_MM);
      const st = doc.createElement("style"); st.textContent = "@page{size:" + ORD_PRINT.PAPER + " " + mm + "mm;margin:0}html,body{height:auto}";
      doc.head.appendChild(st);
    } catch (e) {}
    try { fr.contentWindow.focus(); fr.contentWindow.onafterprint = cleanup; fr.contentWindow.print(); }
    catch (e) { toast("สั่งพิมพ์ไม่สำเร็จ", true); cleanup(); return; }
    setTimeout(() => fr.remove(), 120000);
  };
  const img = doc.getElementById("logo");
  if (img && !img.complete) { img.onload = img.onerror = go; setTimeout(go, 2000); } else setTimeout(go, 150);
}

// ---- ใบออเดอร์ออนไลน์ (พฤติกรรมเดิมทุกอย่าง แค่ย้ายส่วนซ้ำไปใช้ตัวช่วยกลางด้านบน) ----
function printOrder(o) {
  const esc = slipEsc;
  const qtyAll = o.items.reduce((s, it) => s + it.qty, 0);
  const rows = o.items.map(it =>
    `<div class="it"><div class="r"><span>${esc(it.name)}</span></div>` +
    `<div class="r"><span>&nbsp;&nbsp;${money(it.price)} x ${it.qty}${it.unit ? " " + esc(it.unit) : ""}</span><span>${money(it.price * it.qty)}</span></div>` +
    (it.fruits && it.fruits.length ? `<div class="fr">ผลไม้: ${esc(it.fruits.join(", "))}</div>` : "") + `</div>`).join("");
  const line = (k, v) => v ? `<div class="kv"><b>${k}</b> ${esc(v)}</div>` : "";
  const body = `
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
<div class="c" style="margin-top:4px">ขอบคุณที่อุดหนุนค่ะ</div>`;
  runSlipPrint(slipDocument(o.id, body));
}

// ---- พิมพ์ "บิลขาย" จากหน้าสรุปรายการขาย (โหมดขายสินค้า) ----
// ใช้รายการในตะกร้า state.cart (รายการเดียวกับที่เห็นใน popup)
// กดพิมพ์ได้ทั้งก่อนและหลังตรวจรายการ ไม่ได้บันทึกขายให้ — การบันทึกยังทำที่ปุ่ม "บันทึกการขาย" เหมือนเดิม
function printSaleBill() {
  const items = state.cart;
  if (!items || !items.length) return toast("ยังไม่มีรายการให้พิมพ์", true);
  const esc = slipEsc;
  const ch = state.salesChannel || "";
  const isLM = String(ch).trim() === "Line Man";
  let qtyAll = 0, gross = 0, net = 0;
  const rows = items.map(p => {
    const q = Number(p.qty) || 0, pr = Number(p.price) || 0;
    qtyAll += q; gross += roundMoney(q * pr); net += computeSaleTotal(q, pr, ch);
    return `<div class="it"><div class="r"><span>${esc(p.menu.displayName)}</span></div>` +
      `<div class="r"><span>&nbsp;&nbsp;${money(pr)} x ${q}${p.unit ? " " + p.unit : ""}</span><span>${money(q * pr)}</span></div>` +
      (p.note ? `<div class="r"><span>&nbsp;&nbsp;(${esc(p.note)})</span></div>` : "") + `</div>`;
  }).join("");
  const now = new Date();
  const body = `
<div class="sub">ใบเสร็จรับเงิน</div>
<hr class="hr2">
${ch ? `<div class="c">ช่องทาง: ${esc(ch)}</div><hr class="hr">` : ""}
${(state.cartCustomer || "").trim() ? `<div class="c">ลูกค้า: ${esc(state.cartCustomer.trim())}</div><hr class="hr">` : ""}
<div><b>รายการ</b></div>
${rows}
<hr class="hr">
<div class="r"><span>รวมทั้งหมด ${qtyAll} ชิ้น</span></div>
${isLM ? `<div class="r"><span>ยอดก่อนหักค่าคอม</span><span>${money(gross)}</span></div><div class="r"><span>หักค่าคอม 32.10%</span><span>-${money(roundMoney(gross - net))}</span></div>` : ""}
<div class="r tot"><span>${isLM ? "ยอดสุทธิ" : "ยอดรวม"}</span><span>${money(roundMoney(net))}</span></div>
<hr class="hr">
<div class="sub">${state.employee ? "ผู้ขาย: " + esc(state.employee.name) + "<br>" : ""}พิมพ์ ${esc(now.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }))}</div>
<div class="c" style="margin-top:4px">ขอบคุณที่อุดหนุนค่ะ</div>`;
  runSlipPrint(slipDocument("บิลขาย", body));
}

// ---- พิมพ์ "สรุปยอด" จากหน้าสรุปยอด (หลังบ้าน) ----
// ใช้ข้อมูลชุดล่าสุดที่หน้าโหลดมาแล้ว (lastSummary) ไม่ยิง API ซ้ำ ตรงกับตัวเลขที่เห็นบนจอและไฟล์ Export
function printSummarySlip() {
  if (!lastSummary) return toast("ยังไม่มีข้อมูลให้พิมพ์", true);
  const sum = lastSummary, esc = slipEsc;
  // ค่าติดลบ (ต้นทุน/รายจ่าย) แสดงเป็น "-฿100" แทน "฿-100" ให้อ่านง่ายบนสลิป
  const fmt = v => (Number(v) < 0 ? "-" + money(Math.abs(v)) : money(v));
  const r = (k, v, cls) => `<div class="r${cls ? " " + cls : ""}"><span>${k}</span><span>${fmt(v)}</span></div>`;
  const list = sum.stockOutList || [];
  const body = `
<div class="sub">สรุปยอด</div>
<hr class="hr2">
<div class="id" style="font-size:13px">${esc(sum.period)}</div>
<hr class="hr">
${r("ยอดขาย", sum.totalRevenue)}
${r("ต้นทุนผลไม้ที่ตัดใช้จริง", -sum.totalRawMaterialCut)}
${r("ต้นทุนบรรจุภัณฑ์ที่ใช้", -sum.totalPackagingCost)}
${r("ต้นทุนสินค้าหมวดอื่นๆ", -sum.totalOtherGoodsCost)}
${r("มูลค่าของเสีย", -sum.totalWaste)}
${r("ค่าใช้จ่ายอื่น", -sum.totalOtherCosts)}
<hr class="hr">
${r("กำไรโดยประมาณ", sum.profit, "tot")}
<hr class="hr">
<div class="sub" style="text-align:left">รายการขาย ${list.length} รายการ</div>
<div class="sub">${state.employee ? "พิมพ์โดย: " + esc(state.employee.name) + "<br>" : ""}พิมพ์ ${esc(new Date().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }))}</div>`;
  runSlipPrint(slipDocument("สรุปยอด", body));
}

// ---- ติดตั้งปุ่มพิมพ์ 2 จุด (สร้างด้วย JS ไม่ต้องแก้ index.html) ----
// 1) หน้าสรุปยอด: วางไว้ซ้ายปุ่ม Export  2) popup สรุปรายการขาย: วางไว้ระหว่างปุ่มย้อนกลับกับปุ่มบันทึก
(function installPrintButtons() {
  const exp = document.getElementById("summary-export-btn");
  if (exp && !document.getElementById("summary-print-btn")) {
    const b = document.createElement("button");
    b.type = "button"; b.id = "summary-print-btn"; b.className = "btn outline"; b.textContent = "พิมพ์สลิป";
    b.style.marginRight = "8px";
    b.addEventListener("click", printSummarySlip);
    exp.parentNode.insertBefore(b, exp);
  }
  const ok = document.getElementById("btn-confirm-sale-summary");
  if (ok && !document.getElementById("btn-print-sale-bill")) {
    const b = document.createElement("button");
    b.type = "button"; b.id = "btn-print-sale-bill"; b.className = "btn outline"; b.textContent = "พิมพ์";
    b.style.flex = "1";
    b.addEventListener("click", printSaleBill);
    ok.parentNode.insertBefore(b, ok);
  }
})();

// ============================================================
// แก้ไข / ลบ รายการที่เคยบันทึกไว้ (หลังบ้าน)
// ใช้หน้าต่างแก้ไขกลางอันเดียว (openEditModal) สร้างด้วย JS ไม่ต้องเพิ่ม HTML ใน index.html
// ฝั่งเซิร์ฟเวอร์เป็นคนคืน/หักสต๊อกให้ตรงเอง (ดู Code.gs ส่วน "แก้ไข / ลบ รายการที่เคยบันทึกไว้")
// ============================================================
let showEmptyStock = false; // หน้าสต๊อก: แสดงสินค้าที่หมดแล้วด้วยหรือไม่ (ไว้เข้าไปแก้ไข/ลบ)
const WASTE_REASONS = ["ผลไม้เสีย/บูด", "หมดอายุ", "ปอกแล้วขายไม่ทัน", "ตกหล่น/เสียหายระหว่างทำ", "อื่นๆ"];
const COST_CATEGORIES = ["ค่าเช่าที่", "ค่าแรง/ค่าจ้าง", "ค่าน้ำแข็ง", "ค่าน้ำ/ค่าไฟ", "ค่าเดินทาง/ขนส่ง", "อื่นๆ"];
const PRODUCT_CATEGORIES = ["วัตถุดิบ", "บรรจุภัณฑ์", "อื่นๆ"];

function fmtDT(v) {
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ปุ่มเล็กสำหรับแถวรายการ (danger = สีแดง ใช้กับปุ่มลบ)
function actBtn(label, onClick, danger) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = label;
  b.style.cssText = "font-size:12.5px;padding:6px 12px;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;white-space:nowrap;border:1px solid " +
    (danger ? "#e3b4b4;color:#b23a3a" : "#d8d2c2;color:inherit");
  b.addEventListener("click", onClick);
  return b;
}
function actionRow(btns) {
  const d = document.createElement("div");
  d.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px";
  btns.forEach(b => d.appendChild(b));
  return d;
}
// แถวรายการมาตรฐาน: ชื่อ + บรรทัดรอง + ยอดเงินด้านขวา + ปุ่มด้านล่าง
function recordRow({ title, sub, amount, amountCls, actions }) {
  const row = document.createElement("div");
  row.className = "list-row";
  row.innerHTML = `<div class="main"><div class="title">${slipEsc(title)}</div><div class="sub">${slipEsc(sub)}</div></div>` +
    `<div class="trail ${amountCls || ""}">${slipEsc(amount)}</div>`;
  if (actions && actions.length) row.querySelector(".main").appendChild(actionRow(actions));
  return row;
}
// รายการตัวเลือกสำหรับ select: ถ้าค่าปัจจุบันไม่อยู่ในลิสต์ (ข้อมูลเก่า) เติมให้ด้วย จะได้ไม่หายตอนกดบันทึก
function optList(values, current, blankLabel) {
  const list = values.slice();
  if (current !== undefined && current !== null && current !== "" && list.indexOf(current) === -1) list.push(current);
  return list.map(v => ({ v, t: v === "" ? (blankLabel || "(ไม่ระบุ)") : v }));
}

// หน้าต่างแก้ไขกลาง
// spec = { title, hint?, fields:[{key,label,type?,value,options?,required?,min?,step?,placeholder?,maxlength?,hint?}],
//          onSave(values) -> Promise<{ok,error}>, onDone?(res), okMsg? }
function openEditModal(spec) {
  let back = document.getElementById("modal-generic-edit");
  if (!back) {
    back = document.createElement("div");
    back.className = "modal-backdrop hidden"; back.id = "modal-generic-edit"; back.style.zIndex = "200";
    back.innerHTML = '<div class="modal-sheet"><button type="button" class="modal-close" id="generic-edit-close">✕</button>' +
      '<h3 id="generic-edit-title"></h3><p class="hint hidden" id="generic-edit-hint"></p>' +
      '<form id="form-generic-edit"><div id="generic-edit-fields"></div><button class="btn" type="submit" style="margin-top:14px">บันทึก</button></form></div>';
    document.body.appendChild(back);
    document.getElementById("generic-edit-close").addEventListener("click", () => back.classList.add("hidden"));
  }
  document.getElementById("generic-edit-title").textContent = spec.title;
  const hint = document.getElementById("generic-edit-hint");
  hint.textContent = spec.hint || ""; hint.classList.toggle("hidden", !spec.hint);

  const box = document.getElementById("generic-edit-fields");
  box.innerHTML = "";
  spec.fields.forEach(f => {
    const wrap = document.createElement("div"); wrap.className = "field";
    const lab = document.createElement("label"); lab.textContent = f.label; wrap.appendChild(lab);
    let inp;
    if (f.type === "select") {
      inp = document.createElement("select");
      f.options.forEach(o => { const op = document.createElement("option"); op.value = o.v; op.textContent = o.t; inp.appendChild(op); });
      inp.value = f.value === undefined || f.value === null ? "" : f.value;
    } else {
      inp = document.createElement("input");
      inp.type = f.type || "text";
      if (f.type === "number") { inp.step = f.step || "any"; inp.min = f.min !== undefined ? f.min : "0"; }
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.maxlength) inp.maxLength = f.maxlength;
      inp.value = f.value === undefined || f.value === null ? "" : f.value;
    }
    if (f.required) inp.required = true;
    inp.dataset.key = f.key;
    if (f.scan) {
      // ช่องบาร์โค้ด: ปุ่มสแกนข้างช่อง + กัน Enter จากเครื่องยิงส่งฟอร์มก่อนเวลา
      const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px";
      inp.style.cssText = "flex:1;min-width:0"; inp.inputMode = "numeric"; inp.autocomplete = "off";
      inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.preventDefault(); });
      const sb = document.createElement("button");
      sb.type = "button"; sb.className = "btn outline"; sb.textContent = "📷 สแกน";
      sb.style.cssText = "width:auto;padding:0 14px;white-space:nowrap";
      sb.addEventListener("click", () => openScanner({ title: "สแกนบาร์โค้ดสินค้า", onScan: (code) => { inp.value = String(code).trim(); } }));
      row.appendChild(inp); row.appendChild(sb); wrap.appendChild(row);
    } else wrap.appendChild(inp);
    if (f.hint) { const h = document.createElement("div"); h.className = "hint"; h.textContent = f.hint; wrap.appendChild(h); }
    box.appendChild(wrap);
  });

  const form = document.getElementById("form-generic-edit");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const vals = {};
    box.querySelectorAll("[data-key]").forEach(el => { vals[el.dataset.key] = el.value; });
    const btn = form.querySelector('button[type="submit"]');
    const oldText = btn.textContent;
    btn.disabled = true; btn.textContent = "กำลังบันทึก...";
    try {
      const res = await spec.onSave(vals);
      if (res && res.ok) {
        back.classList.add("hidden");
        toast(spec.okMsg || "บันทึกแล้ว");
        if (spec.onDone) await spec.onDone(res);
      } else toast((res && res.error) || "บันทึกไม่สำเร็จ", true);
    } finally { btn.disabled = false; btn.textContent = oldText; }
  };
  back.classList.remove("hidden");
  const first = box.querySelector("input,select");
  if (first) setTimeout(() => first.focus(), 60);
}

// ถามยืนยันแล้วสั่งลบ (okMsg ส่งเป็นฟังก์ชันรับผลลัพธ์ได้) เสร็จแล้วเรียก after(res)
async function deleteWithConfirm(action, payload, msg, okMsg, after) {
  if (!confirm(msg)) return;
  const res = await apiPost(action, payload);
  if (res && res.ok) {
    toast(typeof okMsg === "function" ? okMsg(res) : okMsg);
    if (after) await after(res);
  } else toast((res && res.error) || "ทำรายการไม่สำเร็จ", true);
}

// หลังแก้/ลบรายการที่กระทบสต๊อกหรือยอด: โหลดสรุปยอด + สต๊อก + แจ้งเตือนใกล้หมดใหม่
function afterRecordChange() {
  loadSummary();
  refreshProducts();
  refreshLowStock();
}

// ---------- หน้าสรุปยอด: รายการตัดสต๊อก / ของเสีย / ค่าใช้จ่ายอื่น ----------
function ensureSummarySections() {
  if (document.getElementById("sum-stockcut-list")) return true;
  const anchor = document.getElementById("sum-stockout-list");
  if (!anchor) return false;
  anchor.insertAdjacentHTML("afterend",
    '<div class="section-label" style="margin-top:18px">รายการตัดสต๊อกผลไม้/วัตถุดิบ (ช่วงนี้)</div>' +
    '<div class="hint" style="margin:-6px 0 8px">ดูว่าตัดอะไรไปบ้าง — แก้จำนวนหรือลบได้ ระบบคืน/หักสต๊อกและต้นทุนให้ตรง</div>' +
    '<div class="card" id="sum-stockcut-list"><div class="empty-state">กำลังโหลด…</div></div>' +
    '<div class="section-label" style="margin-top:18px">รายการของเสีย (ช่วงนี้)</div>' +
    '<div class="card" id="sum-waste-list"><div class="empty-state">กำลังโหลด…</div></div>' +
    '<div class="section-label" style="margin-top:18px">ค่าใช้จ่ายอื่น (ช่วงนี้)</div>' +
    '<div class="card" id="sum-cost-list"><div class="empty-state">กำลังโหลด…</div></div>');
  return true;
}
function fillRecordList(id, list, emptyMsg, build) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  if (!list || !list.length) { wrap.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; return; }
  wrap.innerHTML = "";
  list.forEach(x => wrap.appendChild(build(x)));
}
function renderSummaryExtraLists(sum) {
  if (!ensureSummarySections()) return;

  fillRecordList("sum-stockcut-list", sum.stockCutList, "ยังไม่มีการตัดสต๊อกในช่วงนี้", r => recordRow({
    title: r.productName || "(ไม่ระบุชื่อ)",
    sub: `${fmtDT(r.date)} · ตัด ${r.qty}${r.note ? " · " + r.note : ""}${r.employee ? " · " + r.employee : ""}`,
    amount: money(r.cost), amountCls: "neg",
    actions: [
      actBtn("แก้ไข", () => openEditModal({
        title: "แก้ไขรายการตัดสต๊อก", hint: `${r.productName} · ${r.id} — แก้จำนวนแล้วสต๊อกและต้นทุนที่ตัดจะปรับตามให้`,
        fields: [
          { key: "qty", label: "จำนวนที่ตัด", type: "number", value: r.qty, min: "0.01", required: true },
          { key: "note", label: "หมายเหตุ", value: r.note || "" },
        ],
        onSave: v => apiPost("updateStockCut", { id: r.id, ts: r.ts, qty: v.qty, note: v.note }),
        onDone: afterRecordChange, okMsg: "แก้ไขรายการตัดสต๊อกแล้ว",
      })),
      actBtn("ลบ", () => deleteWithConfirm("deleteStockCut", { id: r.id, ts: r.ts },
        `ลบรายการตัดสต๊อก "${r.productName}" จำนวน ${r.qty}?\nสต๊อกจะถูกคืนกลับเข้าระบบ และต้นทุน ${money(r.cost)} จะถูกหักออกจากสรุปยอด`,
        "ลบรายการตัดสต๊อกแล้ว คืนสต๊อกให้แล้ว", afterRecordChange), true),
    ],
  }));

  fillRecordList("sum-waste-list", sum.wasteList, "ไม่มีของเสียในช่วงนี้", r => recordRow({
    title: r.productName || "(ไม่ระบุชื่อ)",
    sub: `${fmtDT(r.date)} · เสีย ${r.qty}${r.reason ? " · " + r.reason : ""}${r.employee ? " · " + r.employee : ""}`,
    amount: money(r.cost), amountCls: "neg",
    actions: [
      actBtn("แก้ไข", () => openEditModal({
        title: "แก้ไขรายการของเสีย", hint: `${r.productName} · ${r.id}`,
        fields: [
          { key: "qty", label: "จำนวนที่เสีย", type: "number", value: r.qty, min: "0.01", required: true },
          { key: "note", label: "สาเหตุ", type: "select", value: r.reason || "", options: optList(WASTE_REASONS, r.reason) },
        ],
        onSave: v => apiPost("updateWaste", { id: r.id, ts: r.ts, qty: v.qty, note: v.note }),
        onDone: afterRecordChange, okMsg: "แก้ไขรายการของเสียแล้ว",
      })),
      actBtn("ลบ", () => deleteWithConfirm("deleteWaste", { id: r.id, ts: r.ts },
        `ลบรายการของเสีย "${r.productName}" จำนวน ${r.qty}?\nสต๊อกจะถูกคืนกลับเข้าระบบ`,
        "ลบรายการของเสียแล้ว คืนสต๊อกให้แล้ว", afterRecordChange), true),
    ],
  }));

  fillRecordList("sum-cost-list", sum.costList, "ไม่มีค่าใช้จ่ายอื่นในช่วงนี้", r => recordRow({
    title: (r.category || "อื่นๆ") + (r.description ? " — " + r.description : ""),
    sub: `${fmtDT(r.date)}${r.employee ? " · " + r.employee : ""}`,
    amount: money(r.amount), amountCls: "neg",
    actions: [
      actBtn("แก้ไข", () => openEditModal({
        title: "แก้ไขค่าใช้จ่าย", hint: r.id,
        fields: [
          { key: "category", label: "ประเภท", type: "select", value: r.category || "", options: optList(COST_CATEGORIES, r.category) },
          { key: "description", label: "รายละเอียด", value: r.description || "" },
          { key: "amount", label: "จำนวนเงิน (บาท)", type: "number", value: r.amount, min: "0", required: true },
        ],
        onSave: v => apiPost("updateOtherCost", { id: r.id, ts: r.ts, category: v.category, description: v.description, amount: v.amount }),
        onDone: afterRecordChange, okMsg: "แก้ไขค่าใช้จ่ายแล้ว",
      })),
      actBtn("ลบ", () => deleteWithConfirm("deleteOtherCost", { id: r.id, ts: r.ts },
        `ลบค่าใช้จ่าย "${r.category || ""}${r.description ? " — " + r.description : ""}" ${money(r.amount)}?`,
        "ลบค่าใช้จ่ายแล้ว", afterRecordChange), true),
    ],
  }));
}

// แก้ไขรายการขาย (เรียกจากหน้าสรุปยอด)
function editSaleRecord(r) {
  openEditModal({
    title: "แก้ไขรายการขาย",
    hint: `${r.id} · ${fmtDT(r.date)} — ถ้าแก้จำนวน ระบบจะปรับบรรจุภัณฑ์ที่หักไปตามสัดส่วนให้`,
    fields: [
      { key: "itemName", label: "ชื่อรายการขาย", value: r.itemName || "", required: true },
      { key: "channel", label: "ช่องทางการจำหน่าย", type: "select", value: r.channel || "", options: optList(["", ...Object.keys(CHANNEL_PRICE_KEY)], r.channel) },
      { key: "qty", label: "จำนวน", type: "number", value: r.qty, min: "0.01", required: true },
      { key: "sellPrice", label: "ราคาขาย/หน่วย (บาท)", type: "number", value: r.sellPrice, min: "0", required: true,
        hint: "ยอดรวมคำนวณใหม่ให้อัตโนมัติ (ช่องทาง Line Man หักค่าคอมมิชชั่น 32.10%)" },
      { key: "note", label: "หมายเหตุ", value: r.note || "" },
    ],
    onSave: v => apiPost("updateStockOut", { id: r.id, ts: r.ts, itemName: v.itemName, channel: v.channel, qty: v.qty, sellPrice: v.sellPrice, note: v.note }),
    onDone: afterRecordChange, okMsg: "แก้ไขรายการขายแล้ว",
  });
}

// ---------- หน้าสต๊อกคงเหลือ: ปุ่มต่อสินค้า ----------
function productActions(p) {
  const id = p["รหัสสินค้า"], name = p["ชื่อสินค้า"], unit = p["หน่วยนับ"];
  const stock = Number(p["สต๊อกปัจจุบัน"]) || 0;
  return actionRow([
    actBtn("รับเข้า", () => openReceiveModal(p)),
    actBtn("แก้ไข", () => openEditModal({
      title: "แก้ไขสินค้า", hint: id,
      fields: [
        { key: "name", label: "ชื่อสินค้า", value: name, required: true },
        { key: "category", label: "หมวดหมู่", type: "select", value: p["หมวดหมู่"], options: optList(PRODUCT_CATEGORIES, p["หมวดหมู่"]) },
        { key: "unit", label: "หน่วยนับ", value: unit, required: true },
        { key: "minStock", label: "สต๊อกขั้นต่ำ", type: "number", value: p["สต๊อกขั้นต่ำ"], min: "0", required: true },
        { key: "barcode", label: "บาร์โค้ด (ไม่บังคับ — เว้นว่าง = ลบบาร์โค้ด)", value: p["บาร์โค้ด"] || "", scan: true, placeholder: "สแกนหรือพิมพ์เลขบาร์โค้ด" },
      ],
      onSave: v => apiPost("updateProduct", { productId: id, name: v.name, category: v.category, unit: v.unit, minStock: v.minStock, barcode: v.barcode }),
      onDone: () => { refreshProducts(); refreshLowStock(); }, okMsg: "แก้ไขสินค้าแล้ว",
    })),
    actBtn("ปรับจำนวน", () => {
      state.adjustTarget = { id, name, stock, unit };
      document.getElementById("adjust-product-name").textContent = name;
      document.getElementById("adjust-old").value = `${stock} ${unit}`;
      document.getElementById("adjust-new").value = stock;
      document.getElementById("adjust-note").value = "";
      openModal("modal-adjust");
    }),
    actBtn("ลบ", () => deleteWithConfirm("deleteProduct", { productId: id },
      `ลบสินค้า "${name}" ออกจากระบบ?\n` + (stock > 0 ? `คงเหลือ ${stock} ${unit} จะหายไปด้วย\n` : "") +
      "สินค้านี้จะถูกถอดออกจาก Code ที่ผูกไว้ (ประวัติการขาย/ตัดสต๊อกเก่ายังอยู่ครบ)",
      res => "ลบสินค้าแล้ว" + (res.codes && res.codes.length ? " · ถอดออกจาก Code: " + res.codes.join(", ") : ""),
      () => { refreshProducts(); refreshLowStock(); }), true),
  ]);
}

// ---------- พนักงาน ----------
function editEmployee(emp) {
  openEditModal({
    title: "แก้ไขพนักงาน", hint: emp.id,
    fields: [
      { key: "name", label: "ชื่อ", value: emp.name, required: true },
      { key: "pin", label: "PIN ใหม่ (4 หลัก)", placeholder: "เว้นว่าง = ไม่เปลี่ยน PIN", maxlength: 4 },
      { key: "role", label: "สิทธิ์", type: "select", value: emp.role, options: [{ v: "staff", t: "พนักงาน (staff)" }, { v: "admin", t: "ผู้ดูแลระบบ (admin)" }] },
      { key: "status", label: "สถานะ", type: "select", value: emp.status, options: [{ v: "active", t: "ใช้งาน" }, { v: "inactive", t: "ระงับ (เข้าระบบไม่ได้)" }] },
    ],
    onSave: async v => {
      const res = await apiPost("updateEmployee", { empId: emp.id, name: v.name, pin: v.pin, role: v.role, status: v.status });
      if (res.ok && state.employee && emp.id === state.employee.id) {
        state.employee.name = v.name.trim();
        localStorage.setItem("2kor_employee", JSON.stringify(state.employee));
        const t = document.getElementById("topbar-emp");
        if (t) t.textContent = state.employee.name + (state.employee.role === "admin" ? " · ผู้ดูแลระบบ" : " · พนักงาน");
      }
      return res;
    },
    onDone: loadEmployeesList, okMsg: "แก้ไขพนักงานแล้ว",
  });
}

// ---------- ปุ่มลบ Code / ลบเมนู / เลื่อนลำดับเมนู (ปุ่มวาดใน renderCodesList / renderMenusAdminList) ----------
document.getElementById("codes-list").addEventListener("click", (e) => {
  const b = e.target.closest(".btn-del-code");
  if (!b) return;
  const c = state.codes.find(x => x.id === b.dataset.codeId);
  if (!c) return;
  deleteWithConfirm("deleteCode", { codeId: c.id }, `ลบ Code "${c.name}"?`, "ลบ Code แล้ว", loadCodes);
});
document.getElementById("menus-list").addEventListener("click", async (e) => {
  const del = e.target.closest(".btn-del-menu");
  if (del) {
    const m = state.menus.find(x => x.id === del.dataset.menuId);
    if (!m) return;
    deleteWithConfirm("deleteMenu", { menuId: m.id },
      `ลบเมนู "${m.displayName}" ถาวร?\n(ถ้าแค่ไม่อยากให้แสดงชั่วคราว ให้ใช้ปุ่ม "ซ่อน" แทน)`, "ลบเมนูแล้ว", loadMenusAdmin);
    return;
  }
  const mv = e.target.closest(".btn-move-menu");
  if (mv) {
    mv.disabled = true;
    const res = await apiPost("moveMenu", { menuId: mv.dataset.menuId, dir: mv.dataset.dir });
    if (res.ok) loadMenusAdmin(); else { toast(res.error || "เลื่อนไม่สำเร็จ", true); mv.disabled = false; }
  }
});

// ช่องค้นหา + กรองหมวด ในหน้าดูคงเหลือ (กรองจากข้อมูลที่โหลดไว้แล้ว ไม่ยิง API ซ้ำ)
(function installProductSearch() {
  const inp = document.getElementById("prod-search");
  const sel = document.getElementById("prod-filter-cat");
  if (!inp || !sel) return;
  let t;
  inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => renderProductsList(true), 150); });
  sel.addEventListener("change", () => renderProductsList(true));
})();

// ---------- ติดตั้งส่วนเสริมบนหน้าที่มีอยู่แล้ว ----------
(function installEditExtras() {
  const pl = document.getElementById("products-list");
  if (pl && !document.getElementById("prod-show-empty")) {
    const d = document.createElement("label");
    d.style.cssText = "display:flex;align-items:center;gap:8px;margin:0 2px 10px;font-size:13px;color:#7a7566;cursor:pointer";
    d.innerHTML = '<input type="checkbox" id="prod-show-empty"> แสดงสินค้าที่หมดสต๊อกด้วย (ไว้แก้ไข/ลบ)';
    pl.parentNode.insertBefore(d, pl);
    d.querySelector("input").addEventListener("change", e => { showEmptyStock = e.target.checked; renderProductsList(); });
  }
  ensureSummarySections();
})();

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
    if (state.employee && state.employee.role === "admin") {
      const w = document.createElement("div"); w.style.cssText = "display:flex;gap:6px;align-items:stretch";
      b.style.flex = "1";
      w.append(b,
        actBtn("แก้ชื่อ", () => openEditModal({
          title: "แก้ชื่อผลไม้", fields: [{ key: "name", label: "ชื่อผลไม้", value: f.name, required: true }],
          onSave: v => apiPost("updateFruit", { id: f.id, name: v.name }), onDone: () => openFruits(), okMsg: "แก้ชื่อแล้ว",
        })),
        actBtn("ลบ", () => deleteWithConfirm("deleteFruit", { id: f.id }, `ลบผลไม้ "${f.name}" ออกจากรายการ?`, "ลบแล้ว", () => openFruits()), true));
      grid.appendChild(w);
    } else grid.appendChild(b);
  });
  document.getElementById("fruit-add").onclick = async () => {
    const r = await apiPost("addFruit", { name: document.getElementById("fruit-new").value });
    if (r.ok) openFruits(); else toast(r.error || "เพิ่มไม่สำเร็จ", true);
  };
}
