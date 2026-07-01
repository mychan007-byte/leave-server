// ===== ระบบการลาราชการ สภ.ดอนหัวฬ่อ : เซิร์ฟเวอร์กลาง =====
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const cfg = require("./config");
const db = require("./db");
const notify = require("./notify");
const roster = require("./roster");

// ---------- เริ่มต้นฐานข้อมูล ----------
let store = db.load();
if (!store.users || store.users.length === 0) {
  const seedPath = path.join(__dirname, "data", "seed.json");
  if (fs.existsSync(seedPath)) {
    const s = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    db.seed(s); store = db.load();
    console.log("โหลดรายชื่อเริ่มต้น", store.users.length, "นาย");
  } else {
    console.warn("ไม่พบ seed.json — เริ่มด้วยฐานข้อมูลว่าง (ใช้เมนูนำเข้า Excel ได้)");
  }
}

const RANK = { staff: 0, supervisor: 1, deputy: 2, commander: 3, admin: 0 };
const uById = id => store.users.find(u => u.id === id);
const short = roster.shortGroup;

// ---------- ตรรกะสายการอนุมัติ ----------
function buildChain(user) {
  const route = store.routing[user.group] || {};
  const levels = [
    { role: "supervisor", label: "หัวหน้างาน", rank: 1, approverId: route.sup },
    { role: "deputy",     label: "รอง ผกก.",   rank: 2, approverId: route.dep },
    { role: "commander",  label: "ผกก.",        rank: 3, approverId: store.commander }
  ];
  return levels
    .filter(l => l.rank > (RANK[user.role] || 0) && l.approverId && l.approverId !== user.id)
    .map(l => ({ role: l.role, label: l.label, approverId: l.approverId,
                 status: "pending", by: null, at: null, note: null }));
}
function currentStep(lv) { return lv.chain.findIndex(s => s.status === "pending"); }
function overallStatus(lv) {
  if (lv.chain.some(s => s.status === "rejected")) return "rejected";
  if (lv.chain.length === 0 || lv.chain.every(s => s.status === "approved")) return "approved";
  return "pending";
}
function isMyTurn(lv, userId) { const i = currentStep(lv); return i >= 0 && lv.chain[i].approverId === userId; }
function usedDays(userId, type, year) {
  return store.leaves.filter(l => l.userId === userId && l.type === type && overallStatus(l) === "approved"
    && new Date(l.from).getFullYear() === year).reduce((s, l) => s + l.days, 0);
}
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) + 1; }

// ---------- session (in-memory) ----------
const sessions = new Map();   // token -> {userId, admin}
function newToken() { return crypto.randomBytes(24).toString("hex"); }
function auth(req, res, next) {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.headers["x-token"] || req.query.token;
  const s = sessions.get(tok);
  if (!s) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  req.session = s;
  req.user = s.userId ? uById(s.userId) : null;
  next();
}
function adminOnly(req, res, next) {
  if (!req.session || !req.session.admin) return res.status(403).json({ error: "เฉพาะผู้ดูแลระบบ" });
  next();
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function pubUser(u) { return { id: u.id, name: u.name, rank: u.rank, pos: u.pos, group: u.group, role: u.role }; }

// ===== auth =====
app.post("/api/login", (req, res) => {
  const u = uById(req.body.userId);
  if (!u) return res.status(400).json({ error: "ไม่พบผู้ใช้" });
  const token = newToken();
  sessions.set(token, { userId: u.id, admin: false });
  res.json({ token, user: pubUser(u) });
});
app.post("/api/admin/login", (req, res) => {
  if ((req.body.password || "") !== cfg.ADMIN_PASSWORD)
    return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  const token = newToken();
  sessions.set(token, { userId: null, admin: true });
  res.json({ token, admin: true });
});
app.post("/api/logout", auth, (req, res) => {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  sessions.delete(tok); res.json({ ok: true });
});

// ===== bootstrap (หน้า login/ฟอร์ม) =====
app.get("/api/bootstrap", (req, res) => {
  res.json({
    station: cfg.STATION,
    leaveTypes: cfg.LEAVE_TYPES,
    users: store.users.map(pubUser),
    groups: [...new Set(store.users.map(u => u.group))]
  });
});
app.get("/api/me", auth, (req, res) => {
  if (req.session.admin) return res.json({ admin: true });
  res.json({ user: req.user });
});

// ===== leaves =====
app.get("/api/leaves", auth, (req, res) => {
  const scope = req.query.scope || "mine";
  let list = store.leaves;
  if (req.session.admin) { /* all */ }
  else if (scope === "mine") list = list.filter(l => l.userId === req.user.id);
  else if (scope === "approve") list = list.filter(l => overallStatus(l) === "pending" && isMyTurn(l, req.user.id));
  else if (scope === "all") list = list.filter(l => l.chain.some(s => s.approverId === req.user.id));
  const out = list.map(l => decorate(l));
  res.json(out);
});
app.get("/api/leaves/:id", auth, (req, res) => {
  const l = store.leaves.find(x => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: "ไม่พบใบลา" });
  res.json(decorate(l, true));
});
function decorate(l, full) {
  const u = uById(l.userId);
  const o = {
    id: l.id, no: l.no, userId: l.userId,
    userName: u ? u.name : "-", userPos: u ? u.pos : "", userGroup: u ? short(u.group) : "",
    type: l.type, from: l.from, to: l.to, days: l.days,
    status: overallStatus(l), createdAt: l.createdAt,
    stepLabel: overallStatus(l) === "pending" ? l.chain[currentStep(l)].label : null
  };
  if (full) {
    o.reason = l.reason; o.cover = l.cover;
    o.chain = l.chain.map(s => {
      const ap = uById(s.approverId);
      return { role: s.role, label: s.label, approverName: ap ? ap.name : "",
               status: s.status, by: s.by ? (uById(s.by) || {}).name : null, at: s.at, note: s.note };
    });
  }
  return o;
}

app.post("/api/leaves", auth, (req, res) => {
  if (req.session.admin) return res.status(400).json({ error: "ผู้ดูแลระบบไม่มีสิทธิ์ยื่นใบลา" });
  const { type, from, to, reason, cover } = req.body;
  if (!cfg.LEAVE_TYPES[type]) return res.status(400).json({ error: "ประเภทการลาไม่ถูกต้อง" });
  if (!from || !to || new Date(to) < new Date(from)) return res.status(400).json({ error: "ช่วงวันที่ไม่ถูกต้อง" });
  if (!reason || !reason.trim()) return res.status(400).json({ error: "กรุณาระบุเหตุผล" });
  const days = daysBetween(from, to);
  const chain = buildChain(req.user);
  const lv = {
    id: "L" + crypto.randomBytes(5).toString("hex"),
    no: "ลา-" + String(store.seq++).padStart(4, "0") + "/" + (new Date().getFullYear() + 543),
    userId: req.user.id, type, from, to, days,
    reason: reason.trim(), cover: (cover || "").trim(),
    createdAt: new Date().toISOString(), chain
  };
  store.leaves.unshift(lv); db.save();
  // แจ้งเตือนผู้อนุมัติคนแรก
  if (chain.length) notify.notifyApprover(uById(chain[0].approverId), lv, req.user);
  res.json({ ok: true, id: lv.id, no: lv.no, autoApproved: chain.length === 0 });
});

app.post("/api/leaves/:id/action", auth, (req, res) => {
  const l = store.leaves.find(x => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: "ไม่พบใบลา" });
  if (req.session.admin) return res.status(403).json({ error: "ผู้ดูแลระบบไม่มีสิทธิ์อนุมัติ" });
  const i = currentStep(l);
  if (i < 0 || l.chain[i].approverId !== req.user.id)
    return res.status(403).json({ error: "ยังไม่ถึงคิวพิจารณาของท่าน" });
  const kind = req.body.kind;
  if (!["approve", "reject"].includes(kind)) return res.status(400).json({ error: "คำสั่งไม่ถูกต้อง" });
  const s = l.chain[i];
  s.by = req.user.id; s.at = new Date().toISOString(); s.note = (req.body.note || "").trim() || null;
  s.status = kind === "approve" ? "approved" : "rejected";
  db.save();
  const requester = uById(l.userId);
  const next = l.chain[currentStep(l)];
  if (kind === "approve" && next) notify.notifyApprover(uById(next.approverId), l, requester);
  else notify.notifyRequester(requester, l, kind, req.user.name);
  res.json({ ok: true, status: overallStatus(l) });
});

// ===== สรุปวันลา =====
app.get("/api/summary", auth, (req, res) => {
  if (req.session.admin) return res.json({});
  const yr = new Date().getFullYear();
  const out = {};
  for (const k of Object.keys(cfg.LEAVE_TYPES))
    out[k] = { used: usedDays(req.user.id, k, yr), max: cfg.LEAVE_TYPES[k].max };
  res.json({ year: yr + 543, summary: out });
});
app.get("/api/report", auth, adminOnly, (req, res) => {
  const st = k => store.leaves.filter(l => overallStatus(l) === k).length;
  const byType = {};
  for (const k of Object.keys(cfg.LEAVE_TYPES))
    byType[k] = store.leaves.filter(l => l.type === k && overallStatus(l) === "approved").reduce((s, l) => s + l.days, 0);
  res.json({ total: store.leaves.length, approved: st("approved"), pending: st("pending"),
             rejected: st("rejected"), byType });
});

// ===== admin: จัดการรายชื่อ/สิทธิ์ =====
app.get("/api/admin/users", auth, adminOnly, (req, res) => res.json(store.users));
app.post("/api/admin/users", auth, adminOnly, (req, res) => {
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: "กรุณาระบุชื่อ" });
  if (b.id) {
    const u = uById(b.id);
    if (!u) return res.status(404).json({ error: "ไม่พบผู้ใช้" });
    Object.assign(u, { name: b.name.trim(), rank: b.rank || "", pos: b.pos || "",
      group: b.group || u.group, role: b.role || u.role, tel: b.tel || "",
      call: b.call || "", email: b.email || "", lineId: b.lineId || "" });
  } else {
    const maxNo = store.users.reduce((m, u) => Math.max(m, u.no || 0), 0) + 1;
    store.users.push({ id: "u" + crypto.randomBytes(4).toString("hex"), no: maxNo,
      name: b.name.trim(), rank: b.rank || "", pos: b.pos || "", group: b.group || "ไม่ระบุสังกัด",
      role: b.role || "staff", tel: b.tel || "", call: b.call || "", email: b.email || "", lineId: b.lineId || "" });
    if (!store.routing[b.group || "ไม่ระบุสังกัด"]) store.routing[b.group || "ไม่ระบุสังกัด"] = { sup: null, dep: store.commander };
  }
  db.save(); res.json({ ok: true });
});
app.delete("/api/admin/users/:id", auth, adminOnly, (req, res) => {
  store.users = store.users.filter(u => u.id !== req.params.id);
  db.save(); res.json({ ok: true });
});

// routing (สายการอนุมัติต่อกลุ่มงาน)
app.get("/api/admin/routing", auth, adminOnly, (req, res) =>
  res.json({ routing: store.routing, commander: store.commander,
             groups: [...new Set(store.users.map(u => u.group))] }));
app.post("/api/admin/routing", auth, adminOnly, (req, res) => {
  if (req.body.routing) store.routing = req.body.routing;
  if (req.body.commander) store.commander = req.body.commander;
  db.save(); res.json({ ok: true });
});

// นำเข้า Excel: rebuild users + routing (คงใบลาเดิม, คง email/lineId ตามชื่อ)
app.post("/api/admin/import", auth, adminOnly, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ไม่พบไฟล์" });
  let people;
  try { people = roster.parseRosterBuffer(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: "อ่านไฟล์ไม่สำเร็จ: " + e.message }); }
  if (!people.length) return res.status(400).json({ error: "ไม่พบรายชื่อในไฟล์ (ตรวจรูปแบบคอลัมน์)" });
  const built = roster.buildUsersAndRouting(people);
  // คง email/lineId เดิมโดยจับคู่ตามชื่อ
  const oldByName = new Map(store.users.map(u => [u.name, u]));
  for (const u of built.users) {
    const o = oldByName.get(u.name);
    if (o) { u.email = o.email || ""; u.lineId = o.lineId || ""; }
  }
  store.users = built.users;
  store.routing = built.routing;
  store.commander = built.commander;
  db.save();
  res.json({ ok: true, count: built.users.length,
    groups: [...new Set(built.users.map(u => u.group))].map(short),
    commander: built.commander ? uById(built.commander).name : null });
});

// ===== พิมพ์ใบลา / รายงาน (HTML สำหรับ Save as PDF ผ่านเบราว์เซอร์) =====
const TH_MONTH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function thDate(iso) { if (!iso) return "-"; const d = new Date(iso + "T00:00:00"); return `${d.getDate()} ${TH_MONTH[d.getMonth()]} ${d.getFullYear()+543}`; }
function esc(s){return (s==null?"":String(s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

app.get("/print/leave/:id", (req, res) => {
  const l = store.leaves.find(x => x.id === req.params.id);
  if (!l) return res.status(404).send("ไม่พบใบลา");
  const u = uById(l.userId);
  const t = cfg.LEAVE_TYPES[l.type].label;
  const approvals = l.chain.map(s => {
    const ap = uById(s.approverId);
    const stat = s.status === "approved" ? "อนุมัติ" : s.status === "rejected" ? "ไม่อนุมัติ" : "รอพิจารณา";
    return `<div class="apbox">
      <div class="aptitle">${esc(s.label)}</div>
      <div class="apname">(${esc(ap ? ap.name : "")})</div>
      <div>ความเห็น: ${esc(s.note || "..............................")}</div>
      <div>ผล: <b>${stat}</b> ${s.at ? "· " + thDate(s.at.slice(0,10)) : ""}</div>
    </div>`;
  }).join("");
  res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ใบลา ${esc(l.no)}</title>
  <style>
    @page{size:A4;margin:2cm}
    *{font-family:"TH Sarabun New","Sarabun","Angsana New",serif}
    body{font-size:16pt;color:#000;line-height:1.6}
    .center{text-align:center}
    h3{margin:4px 0}
    .row{margin:6px 0}
    .sig{display:flex;flex-wrap:wrap;gap:16px;margin-top:24px}
    .apbox{border:1px solid #000;padding:10px;flex:1;min-width:200px;font-size:15pt}
    .aptitle{font-weight:bold}
    .noprint{margin:16px;text-align:center}
    @media print{.noprint{display:none}}
    button{font-size:14pt;padding:8px 18px}
  </style></head><body>
  <div class="noprint"><button onclick="window.print()">🖨️ พิมพ์ / บันทึกเป็น PDF</button></div>
  <div class="center"><h3>ใบลา${esc(t)}</h3>
    <div>${esc(cfg.STATION)}</div>
    <div>เลขที่ ${esc(l.no)}</div></div>
  <div class="row">เรียน  ผู้กำกับการสถานีตำรวจภูธรดอนหัวฬ่อ</div>
  <div class="row">ข้าพเจ้า <b>${esc(u.name)}</b> ตำแหน่ง ${esc(u.pos)} สังกัด ${esc(short(u.group))}</div>
  <div class="row">ขอลา${esc(t)} ตั้งแต่วันที่ <b>${thDate(l.from)}</b> ถึงวันที่ <b>${thDate(l.to)}</b>
     มีกำหนด <b>${l.days}</b> วัน</div>
  <div class="row">เนื่องจาก ${esc(l.reason)}</div>
  ${l.cover ? `<div class="row">ผู้ปฏิบัติหน้าที่แทน: ${esc(l.cover)}</div>` : ""}
  <div class="row">ยื่นเมื่อ ${thDate(l.createdAt.slice(0,10))}</div>
  <div class="row" style="margin-top:20px">ลงชื่อ ...................................... ผู้ลา</div>
  <div class="center" style="margin:16px 0"><b>การพิจารณาตามลำดับชั้น</b></div>
  <div class="sig">${approvals}</div>
  </body></html>`);
});

app.get("/print/report", (req, res) => {
  const rows = store.leaves.map(l => {
    const u = uById(l.userId); const st = overallStatus(l);
    const stTh = st === "approved" ? "อนุมัติแล้ว" : st === "rejected" ? "ไม่อนุมัติ" : "รออนุมัติ";
    return `<tr><td>${esc(l.no)}</td><td>${esc(u?u.name:"-")}</td><td>${esc(u?short(u.group):"")}</td>
      <td>${esc(cfg.LEAVE_TYPES[l.type].label)}</td><td>${thDate(l.from)} - ${thDate(l.to)}</td>
      <td style="text-align:center">${l.days}</td><td>${stTh}</td></tr>`;
  }).join("");
  res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>รายงานการลา</title>
  <style>@page{size:A4 landscape;margin:1.5cm}
   *{font-family:"TH Sarabun New","Sarabun","Angsana New",serif}
   body{font-size:14pt}h3{text-align:center}
   table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:4px 6px}
   th{background:#eee}.noprint{text-align:center;margin:12px}@media print{.noprint{display:none}}
   button{font-size:13pt;padding:6px 16px}</style></head><body>
   <div class="noprint"><button onclick="window.print()">🖨️ พิมพ์ / บันทึกเป็น PDF</button></div>
   <h3>รายงานสรุปการลา — ${esc(cfg.STATION)}<br><span style="font-size:12pt">ณ วันที่ ${thDate(new Date().toISOString().slice(0,10))}</span></h3>
   <table><thead><tr><th>เลขที่</th><th>ผู้ลา</th><th>สังกัด</th><th>ประเภท</th><th>ช่วงวันลา</th><th>วัน</th><th>สถานะ</th></tr></thead>
   <tbody>${rows || '<tr><td colspan=7 style="text-align:center">ไม่มีข้อมูล</td></tr>'}</tbody></table>
   </body></html>`);
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(cfg.PORT, () => {
  console.log(`ระบบการลา สภ.ดอนหัวฬ่อ ทำงานที่พอร์ต ${cfg.PORT}`);
  console.log(`เปิด http://localhost:${cfg.PORT}`);
});
