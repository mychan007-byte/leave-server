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
  const idOf = no => "u" + String(no).padStart(3, "0");

  // ผู้ใช้ที่ไม่ซ้ำ (ยึดเลขที่ - เอาแถวแรกที่พบ) รองรับไฟล์ที่ลิสต์หัวหน้าสายงานซ้ำต้นแต่ละงาน
  const seen = new Set();
  const users = [];
  for (const p of people) {
    if (seen.has(p.no)) continue;
    seen.add(p.no);
    users.push({
      id: idOf(p.no),
      no: p.no, name: p.name, rank: p.rank, pos: p.pos,
      group: p.group, tel: p.tel, call: p.call,
      role: p.role, email: "", lineId: ""
    });
  }

  const commanderRow = people.find(p => p.role === "commander");
  const commander = commanderRow ? idOf(commanderRow.no) : null;
  const deputies = people.filter(p => p.role === "deputy");
  const firstDeputy = deputies.length ? idOf(deputies[0].no) : null;

  // สายการอนุมัติต่อกลุ่มงาน: ใช้แถวทั้งหมดในแต่ละงาน (รวมหัวหน้าสายงานที่ลิสต์ซ้ำ)
  // - หัวหน้างาน = ผู้มีบทบาท supervisor ที่ปรากฏในงานนั้น (ถ้าไม่มี = สมาชิกคนแรกของงาน)
  // - รอง ผกก. = ผู้มีบทบาท deputy ที่ปรากฏในงานนั้น (ถ้าไม่มี = รอง ผกก. คนแรกของหน่วย)
  const groups = [...new Set(users.map(u => u.group))];
  const routing = {};
  for (const g of groups) {
    const rows = people.filter(p => p.group === g);
    const supRow = rows.find(p => p.role === "supervisor");
    const depRow = rows.find(p => p.role === "deputy");
    const firstMember = users.find(u => u.group === g);
    routing[g] = {
      sup: supRow ? idOf(supRow.no) : (firstMember ? firstMember.id : null),
      dep: depRow ? idOf(depRow.no) : firstDeputy
    };
  }
  return { users, routing, commander };
}

module.exports = { parseRosterBuffer, buildUsersAndRouting, shortGroup, rankOf, roleOf };
