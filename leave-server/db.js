// ===== ที่เก็บข้อมูลแบบไฟล์ JSON (atomic write) =====
// เหมาะกับปริมาณงานระดับสถานี ไม่ต้องติดตั้งฐานข้อมูลแยก และพอร์ตไป VPS ได้ทันที
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = null;

function _default() {
  return { users: [], routing: {}, commander: null, leaves: [], seq: 1 };
}

function load() {
  if (cache) return cache;
  if (fs.existsSync(DB_FILE)) {
    try { cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
    catch (e) { console.error("อ่าน db.json ไม่สำเร็จ:", e.message); cache = _default(); }
  } else {
    cache = _default();
  }
  return cache;
}

// เขียนแบบ atomic: เขียนไฟล์ชั่วคราวแล้ว rename ทับ กันไฟล์เสียหากไฟดับกลางคัน
function save() {
  if (!cache) return;
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function seed(usersRoutingCommander) {
  cache = load();
  cache.users = usersRoutingCommander.users;
  cache.routing = usersRoutingCommander.routing;
  cache.commander = usersRoutingCommander.commander;
  if (!Array.isArray(cache.leaves)) cache.leaves = [];
  if (!cache.seq) cache.seq = 1;
  save();
  return cache;
}

module.exports = { load, save, seed, DB_FILE, DATA_DIR };
