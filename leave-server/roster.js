// ===== โมดูลอ่านรายชื่อจากไฟล์ Excel และกำหนดสิทธิ์/สายการอนุมัติอัตโนมัติ =====
const XLSX = require("xlsx");

// จัดกลุ่มงานให้สั้น (ตัด "(xx นาย)")
function shortGroup(g) { return (g || "").replace(/\s*\(\s*\d+\s*นาย\s*\)/, "").trim(); }

// ดึงยศ (คำนำหน้าที่เป็นตัวย่อ เช่น พ.ต.อ.) จากชื่อเต็ม
function rankOf(name) {
  const m = String(name).replace(/\s+/g, "").match(/^((?:[฀-๿]+\.)+)/);
  return m ? m[1] : "";
}

// กำหนดบทบาทจากตำแหน่ง
function roleOf(pos) {
  const p = String(pos).replace(/\s+/g, "");
  if (p.startsWith("ผกก.")) return "commander";
  if (p.startsWith("รองผกก.")) return "deputy";
  if (p.startsWith("สวป.") || p.startsWith("สว.") || p.startsWith("สว(")) return "supervisor";
  return "staff";
}

// อ่านไฟล์ xlsx -> [{no,name,rank,pos,group,tel,call,role}]
// รองรับรูปแบบไฟล์ทำเนียบกำลังพลแบบมีหัวข้อกลุ่มงาน (แถวที่ไม่มีเลขลำดับ = ชื่อกลุ่มงาน)
function parseRosterBuffer(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const people = [];
  let group = null;

  // หาแถวหัวคอลัมน์ (คอลัมน์แรก = "ลำดับ") เพื่อข้ามแถวชื่อเรื่อง/วันที่ด้านบน
  let start = 0;
  for (let i = 0; i < rows.length; i++) {
    const a0 = rows[i] && rows[i][0] != null ? String(rows[i][0]).replace(/\s+/g, "") : "";
    if (a0 === "ลำดับ") { start = i + 1; break; }
  }

  for (let ri = start; ri < rows.length; ri++) {
    const r = rows[ri];
    const c = r.map(x => (x == null ? "" : String(x).trim()));
    const a = c[0] || "", name = c[1] || "", pos = c[2] || "", tel = c[3] || "", call = c[4] || "";
    if (!a && !name) continue;
    const isNum = /^\d+$/.test(a);
    if (a && !isNum) { group = a; continue; }       // แถวหัวข้อกลุ่มงาน
    if (isNum) {
      people.push({
        no: parseInt(a),
        name: name.replace(/\s+/g, " ").trim(),
        rank: rankOf(name),
        pos, group: group || "ผู้บังคับบัญชา",
        tel, call,
        role: roleOf(pos)
      });
    }
  }
  return people;
}

// สร้าง users + routing (สายการอนุมัติต่อกลุ่มงาน) จากรายชื่อ
function buildUsersAndRouting(people) {
  const users = people.map(p => ({
    id: "u" + String(p.no).padStart(3, "0"),
    no: p.no, name: p.name, rank: p.rank, pos: p.pos,
    group: p.group, tel: p.tel, call: p.call,
    role: p.role, email: "", lineId: ""
  }));

  const commander = (users.find(u => u.role === "commander") || {}).id || null;
  const deputies = users.filter(u => u.role === "deputy");
  const firstDeputy = deputies.length ? deputies[0].id : null;

  const groups = [...new Set(users.map(u => u.group))];
  const routing = {};
  for (const g of groups) {
    const inG = users.filter(u => u.group === g);
    const sup = inG.find(u => u.role === "supervisor");
    const dep = deputies.find(d => d.group === g);
    routing[g] = {
      sup: sup ? sup.id : (inG[0] ? inG[0].id : null),
      dep: dep ? dep.id : firstDeputy
    };
  }
  return { users, routing, commander };
}

module.exports = { parseRosterBuffer, buildUsersAndRouting, shortGroup, rankOf, roleOf };
