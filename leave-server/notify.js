// ===== โมดูลแจ้งเตือน: อีเมล (SMTP) และ LINE (Messaging API) =====
// ทั้งสองช่องทางปิดไว้โดยปริยาย เปิดใช้งานโดยตั้งค่าใน config.js / environment variables
const nodemailer = require("nodemailer");
const cfg = require("./config");

let transporter = null;
if (cfg.EMAIL.enabled) {
  transporter = nodemailer.createTransport({
    host: cfg.EMAIL.host, port: cfg.EMAIL.port, secure: cfg.EMAIL.secure,
    auth: cfg.EMAIL.user ? { user: cfg.EMAIL.user, pass: cfg.EMAIL.pass } : undefined
  });
}

async function sendEmail(to, subject, text) {
  if (!cfg.EMAIL.enabled || !transporter || !to) return;
  try {
    await transporter.sendMail({ from: cfg.EMAIL.from, to, subject, text });
    console.log("[email] ส่งถึง", to);
  } catch (e) { console.error("[email] ผิดพลาด:", e.message); }
}

// LINE Messaging API - push message (ต้องมี Channel Access Token)
async function sendLine(to, message) {
  if (!cfg.LINE.enabled || !cfg.LINE.channelAccessToken) return;
  const target = to || cfg.LINE.defaultTo;
  if (!target) return;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg.LINE.channelAccessToken
      },
      body: JSON.stringify({ to: target, messages: [{ type: "text", text: message }] })
    });
    if (!res.ok) console.error("[line] HTTP", res.status, await res.text());
    else console.log("[line] ส่งถึง", target);
  } catch (e) { console.error("[line] ผิดพลาด:", e.message); }
}

// แจ้งผู้อนุมัติว่ามีใบลารอพิจารณา
async function notifyApprover(approver, leave, requester) {
  if (!approver) return;
  const t = require("./config").LEAVE_TYPES[leave.type].label;
  const msg = `[ระบบการลา สภ.ดอนหัวฬ่อ]\nมีใบลารอพิจารณา\nเลขที่ ${leave.no}\nผู้ลา: ${requester.name}\nประเภท: ${t} ${leave.days} วัน\nช่วง: ${leave.from} ถึง ${leave.to}`;
  await Promise.all([
    sendEmail(approver.email, `ใบลารอพิจารณา ${leave.no}`, msg),
    sendLine(approver.lineId, msg)
  ]);
}

// แจ้งผู้ยื่นเมื่อมีผลการพิจารณา
async function notifyRequester(requester, leave, kind, actorName) {
  if (!requester) return;
  const t = require("./config").LEAVE_TYPES[leave.type].label;
  const result = kind === "approve" ? "ได้รับอนุมัติในระดับหนึ่ง/ครบแล้ว" : "ไม่ได้รับอนุมัติ";
  const msg = `[ระบบการลา สภ.ดอนหัวฬ่อ]\nใบลา ${leave.no} (${t}) ${result}\nโดย: ${actorName}`;
  await Promise.all([
    sendEmail(requester.email, `ผลการพิจารณาใบลา ${leave.no}`, msg),
    sendLine(requester.lineId, msg)
  ]);
}

module.exports = { sendEmail, sendLine, notifyApprover, notifyRequester };
