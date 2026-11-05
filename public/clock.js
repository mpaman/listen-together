// นาฬิกาแต่ละเครื่องไม่ตรงกัน (ต่างกันได้หลายวินาที) ถ้าไม่ชดเชย ทุกคนจะเล่นคนละจุด
// วิธี: ส่ง ping ไป server แล้วจับเวลาไป-กลับ (rtt) สมมติว่าขาไปกับขากลับใช้เวลาเท่ากัน
//   offset = เวลา server − (เวลาส่ง + เวลารับ) / 2
// วัดหลายครั้งแล้วเชื่อครั้งที่ rtt ต่ำสุด (เน็ตกระตุกน้อยที่สุด = แม่นที่สุด)

const SAMPLES = 5;
const RESYNC_MS = 30_000;
const PING_TIMEOUT_MS = 3000;

export function createClock(socket) {
  let offset = 0;

  async function measure() {
    let best = null;
    for (let i = 0; i < SAMPLES; i += 1) {
      try {
        const sentAt = Date.now();
        const serverTime = await socket.timeout(PING_TIMEOUT_MS).emitWithAck('time');
        const receivedAt = Date.now();
        const rtt = receivedAt - sentAt;
        if (!best || rtt < best.rtt) best = { rtt, offset: serverTime - (sentAt + receivedAt) / 2 };
      } catch {
        // ping หาย → ข้ามรอบนี้
      }
    }
    if (best) offset = best.offset;
  }

  socket.on('connect', measure);
  setInterval(() => socket.connected && measure(), RESYNC_MS);

  return {
    measure,
    serverNow: () => Date.now() + offset,
  };
}
