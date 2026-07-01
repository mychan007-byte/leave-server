// ===== นำเข้ารายชื่อจากไฟล์ Excel ผ่านบรรทัดคำสั่ง =====
// วิธีใช้:  node import_roster.js "path/ถึง/ไฟล์.xlsx"
// จะสร้าง/อัปเดต data/db.json (คงใบลาเดิม, คงอีเมล/LINE เดิมตามชื่อ)
const fs = require("fs");
const roster = require("./roster");
const db = require("./db");

const file = process.argv[2];
if (!file) { console.error("โปรดระบุไฟล์: node import_roster.js <ไฟล์.xlsx>"); process.exit(1); }
if (!fs.existsSync(file)) { console.error("ไม่พบไฟล์:", file); process.exit(1); }

const buf = fs.readFileSync(file);
const people = roster.parseRosterBuffer(buf);
if (!people.length) { console.error("ไม่พบรายชื่อในไฟล์ (ตรวจรูปแบบคอลัมน์)"); process.exit(1); }

const built = roster.buildUsersAndRouting(people);
const store = db.load();
const oldByName = new Map((store.users || []).map(u => [u.name, u]));
for (const u of built.users) {
  const o = oldByName.get(u.name);
  if (o) { u.email = o.email || ""; u.lineId = o.lineId || ""; }
}
store.users = built.users;
store.routing = built.routing;
store.commander = built.commander;
if (!Array.isArray(store.leaves)) store.leaves = [];
if (!store.seq) store.seq = 1;
db.save();

console.log("นำเข้าสำเร็จ:", built.users.length, "นาย");
console.log("ผกก.:", built.commander ? (built.users.find(u => u.id === built.commander) || {}).name : "-");
console.log("กลุ่มงาน:", [...new Set(built.users.map(u => u.group))].map(roster.shortGroup).join(", "));
