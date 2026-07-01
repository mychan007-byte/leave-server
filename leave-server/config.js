// ===== การตั้งค่าระบบ =====
// โหลดค่าจากไฟล์ .env (ถ้ามี) แบบง่าย ไม่ต้องพึ่ง dependency ภายนอก
(function loadEnv() {
  const fs = require("fs"), path = require("path");
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i < 0) continue;
    const k = s.slice(0, i).trim(), v = s.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
})();

// แก้ไขค่าเหล่านี้ หรือกำหนดผ่านตัวแปรสภาพแวดล้อม (environment variables) บน VPS
module.exports = {
  PORT: process.env.PORT || 3000,
  STATION: "สถานีตำรวจภูธรดอนหัวฬ่อ",

  // รหัสผ่านผู้ดูแลระบบ (สำหรับหน้าจัดการรายชื่อ/สิทธิ์/นำเข้า Excel)
  // *** สำคัญ: เปลี่ยนรหัสนี้ก่อนใช้งานจริง ***
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "dhl-admin-2569",

  // ประเภทการลา และสิทธิสูงสุดต่อปี (วัน)
  LEAVE_TYPES: {
    sick:     { label: "ลาป่วย",        max: 60 },
    personal: { label: "ลากิจส่วนตัว",  max: 45 },
    vacation: { label: "ลาพักผ่อน",     max: 10 }
  },

  // ===== การแจ้งเตือนอีเมล (SMTP) — ปิดไว้โดยปริยาย =====
  EMAIL: {
    enabled: process.env.EMAIL_ENABLED === "1",
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "1",     // true สำหรับ port 465
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",           // Gmail ใช้ App Password
    from: process.env.SMTP_FROM || "ระบบการลา สภ.ดอนหัวฬ่อ <no-reply@example.com>"
  },

  // ===== การแจ้งเตือน LINE (Messaging API) — ปิดไว้โดยปริยาย =====
  // หมายเหตุ: LINE Notify เดิมถูกยกเลิกบริการแล้ว จึงใช้ LINE Messaging API (push message) แทน
  // ต้องสร้าง Messaging API channel ที่ https://developers.line.biz แล้วนำ Channel Access Token มาใส่
  LINE: {
    enabled: process.env.LINE_ENABLED === "1",
    channelAccessToken: process.env.LINE_TOKEN || "",
    // userId หรือ groupId ปลายทางเริ่มต้น (เช่น กลุ่มธุรการ) หากผู้ใช้ไม่ได้ผูก lineId ของตนเอง
    defaultTo: process.env.LINE_DEFAULT_TO || ""
  }
};
