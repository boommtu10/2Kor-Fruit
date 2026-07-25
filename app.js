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
  adjustTarget: null,   // สินค้าที่กำลังจะปรับคงเหลือ {id, name, stock, unit}
};

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
  setupAdminChip();

  goToView("dashboard");
  refreshProducts();
  refreshLowStock();
}

function setupAdminChip() {
  const row = document.querySelector('.chip-row');
  if (!row || document.getElementById("chip-employees")) return;
  if (state.employee.role === "admin") {
    const chip = document.createElement("button");
    chip.className = "chip"; chip.id = "chip-employees";
    chip.dataset.goto = "employees";
    chip.textContent = "👥 พนักงาน";
    row.appendChild(chip);
  }
}

function goToView(name) {
  document.querySelectorAll("[data-view]").forEach(s => s.classList.toggle("hidden", s.dataset.view !== name));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  if (name === "dashboard") loadDashboard();
  if (name === "products") renderProductsList();
  if (name === "stockout") loadPackagingOptions();
  if (name === "summary") loadSummary();
  if (name === "employees") loadEmployeesList();
}

document.querySelectorAll(".nav-btn").forEach(b =>
  b.addEventListener("click", () => goToView(b.dataset.view))
);
document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-goto]");
  if (chip) goToView(chip.dataset.goto);
});

document.getElementById("btn-low-stock").addEventListener("click", () => goToView("dashboard"));

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

function fillProductSelects() {
  const actives = state.products.filter(p => p["สถานะ"] !== "inactive");
  [["in-product"], ["waste-product"]].forEach(([id]) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = "";
    actives.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p["รหัสสินค้า"];
      opt.textContent = `${p["ชื่อสินค้า"]} (คงเหลือ ${p["สต๊อกปัจจุบัน"]} ${p["หน่วยนับ"]})`;
      opt.dataset.cost = p["ราคาทุนล่าสุด"];
      opt.dataset.stock = p["สต๊อกปัจจุบัน"];
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
  updateWasteHint();
}

function renderProductsList() {
  const wrap = document.getElementById("products-list");
  if (!state.products.length) { wrap.innerHTML = '<div class="empty-state">ยังไม่มีสินค้า กด + เพื่อเพิ่มสินค้าแรก</div>'; return; }
  wrap.innerHTML = "";
  state.products.forEach(p => {
    const stock = Number(p["สต๊อกปัจจุบัน"]);
    const min = Number(p["สต๊อกขั้นต่ำ"]) || 1;
    const pct = Math.max(0, Math.min(100, Math.round((stock / (min * 2)) * 100)));
    const low = stock <= min;
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="stock-ring ${low ? "low" : ""}" style="--pct:${pct}"><span>${stock}</span></div>
      <div class="main">
        <div class="title">${p["ชื่อสินค้า"]}</div>
        <div class="sub">${p["หมวดหมู่"]} · ทุน ${money(p["ราคาทุนล่าสุด"])} / หน่วย</div>
      </div>
      <button class="btn outline btn-adjust" data-adjust-id="${p["รหัสสินค้า"]}" data-adjust-name="${p["ชื่อสินค้า"]}" data-adjust-stock="${stock}" style="padding:6px 10px;font-size:12px">ปรับคงเหลือ</button>
    `;
    wrap.appendChild(row);
  });
}

// ---- ปรับคงเหลือแบบแมนนวล (ใช้บ่อยกับวัตถุดิบที่หักสต๊อกอัตโนมัติไม่ได้) ----
document.getElementById("products-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-adjust-id]");
  if (!btn) return;
  state.adjustTarget = {
    id: btn.dataset.adjustId,
    name: btn.dataset.adjustName,
    stock: btn.dataset.adjustStock,
  };
  document.getElementById("adjust-product-name").textContent = state.adjustTarget.name;
  document.getElementById("adjust-old").value = state.adjustTarget.stock;
  document.getElementById("adjust-new").value = "";
  document.getElementById("adjust-note").value = "";
  openModal("modal-adjust");
});

document.getElementById("form-adjust").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.adjustTarget) return;
  const res = await apiPost("adjustStock", {
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

document.getElementById("form-add-product").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await apiPost("addProduct", {
    name: document.getElementById("np-name").value,
    category: document.getElementById("np-category").value,
    unit: document.getElementById("np-unit").value,
    minStock: document.getElementById("np-minstock").value,
    costPrice: document.getElementById("np-cost").value,
    initialStock: document.getElementById("np-initstock").value,
  });
  if (res.ok) {
    toast("เพิ่มสินค้าเรียบร้อย");
    e.target.reset();
    closeModal("modal-product");
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "เพิ่มสินค้าไม่สำเร็จ", true);
});

// ============================================================
// STOCK IN
// ============================================================
document.getElementById("form-stockin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("in-product").value;
  if (!productId) return toast("ยังไม่มีสินค้าให้เลือก กรุณาเพิ่มสินค้าก่อน", true);
  const res = await apiPost("stockIn", {
    productId,
    qty: document.getElementById("in-qty").value,
    costPrice: document.getElementById("in-cost").value,
    note: document.getElementById("in-note").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast("บันทึกรับสินค้าเข้าเรียบร้อย");
    e.target.reset();
    refreshProducts(); refreshLowStock();
  } else toast(res.error || "บันทึกไม่สำเร็จ", true);
});

document.getElementById("in-product").addEventListener("change", (e) => {
  const opt = e.target.selectedOptions[0];
  if (opt) document.getElementById("in-cost").value = opt.dataset.cost || "";
});

// ============================================================
// STOCK OUT — พิมพ์ชื่อรายการ + ราคาเอง แล้วเลือกบรรจุภัณฑ์ที่ใช้
// ============================================================
// โหลดรายการบรรจุภัณฑ์ที่ยัง active มาแสดงเป็น checkbox + ช่องจำนวน
// ให้พนักงานเลือกเองว่าการขายครั้งนี้ใช้อะไรบ้าง (คนละอย่างกับผลไม้ที่ไม่หักสต๊อก)
async function loadPackagingOptions() {
  const wrap = document.getElementById("out-packaging-list");
  try {
    state.packaging = await apiGet("getPackaging");
    if (!state.packaging.length) {
      wrap.innerHTML = '<div class="empty-state">ยังไม่มีบรรจุภัณฑ์ในระบบ (เพิ่มได้ที่หน้า "สินค้า")</div>';
      return;
    }
    wrap.innerHTML = "";
    state.packaging.forEach(p => {
      const row = document.createElement("div");
      row.className = "list-row";
      row.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
          <input type="checkbox" class="pack-check" data-pack-id="${p["รหัสสินค้า"]}">
          <span>${p["ชื่อสินค้า"]} <span class="hint">(คงเหลือ ${p["สต๊อกปัจจุบัน"]} ${p["หน่วยนับ"]})</span></span>
        </label>
        <input type="number" class="pack-qty" data-pack-id="${p["รหัสสินค้า"]}" value="1" min="1" step="1" style="width:64px" disabled>
      `;
      wrap.appendChild(row);
    });
  } catch (err) {
    wrap.innerHTML = '<div class="empty-state">โหลดบรรจุภัณฑ์ไม่สำเร็จ</div>';
  }
}

// ติ๊กแล้วเปิดช่องจำนวนให้แก้ไขได้ (ไม่ติ๊ก = ไม่ใช้ ไม่หักสต๊อก)
document.getElementById("out-packaging-list").addEventListener("change", (e) => {
  if (!e.target.classList.contains("pack-check")) return;
  const id = e.target.dataset.packId;
  const qtyInput = document.querySelector(`.pack-qty[data-pack-id="${id}"]`);
  qtyInput.disabled = !e.target.checked;
});

function collectSelectedPackaging() {
  const selected = [];
  document.querySelectorAll(".pack-check:checked").forEach(chk => {
    const id = chk.dataset.packId;
    const qty = document.querySelector(`.pack-qty[data-pack-id="${id}"]`).value;
    selected.push({ productId: id, qty: Number(qty) || 1 });
  });
  return selected;
}

document.getElementById("form-stockout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const itemName = document.getElementById("out-name").value.trim();
  if (!itemName) return toast("กรุณาพิมพ์ชื่อรายการขาย", true);
  const res = await apiPost("stockOut", {
    itemName,
    qty: document.getElementById("out-qty").value,
    sellPrice: document.getElementById("out-price").value,
    packaging: collectSelectedPackaging(),
    note: document.getElementById("out-note").value,
    employee: state.employee.name,
  });
  if (res.ok) {
    toast((res.lowStock && res.lowStock.length) ? `บันทึกการขายแล้ว — บรรจุภัณฑ์ใกล้หมด: ${res.lowStock.join(", ")}` : "บันทึกการขายเรียบร้อย");
    e.target.reset();
    document.getElementById("out-qty").value = 1;
    loadPackagingOptions();
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
  hint.textContent = opt ? `คงเหลือในสต๊อก: ${opt.dataset.stock}` : "";
}
document.getElementById("waste-product").addEventListener("change", updateWasteHint);

document.getElementById("form-waste").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("waste-product").value;
  if (!productId) return toast("ยังไม่มีสินค้าให้เลือก", true);
  const res = await apiPost("addWaste", {
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
  const res = await apiPost("addOtherCost", {
    category: document.getElementById("cost-category").value,
    description: document.getElementById("cost-desc").value,
    amount: document.getElementById("cost-amount").value,
    employee: state.employee.name,
  });
  if (res.ok) { toast("บันทึกค่าใช้จ่ายเรียบร้อย"); e.target.reset(); }
  else toast(res.error || "บันทึกไม่สำเร็จ", true);
});

// ============================================================
// DASHBOARD (สรุปวันนี้)
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
// SUMMARY VIEW
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
  } catch (err) { toast("โหลดสรุปยอดไม่สำเร็จ", true); }
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
  const res = await apiPost("addEmployee", {
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
// INIT
// ============================================================
(function init() {
  renderPinDots();
  loadEmployeesForLogin();

  const saved = localStorage.getItem("2kor_employee");
  if (saved) {
    try { state.employee = JSON.parse(saved); enterApp(); } catch (e) { /* ignore */ }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
