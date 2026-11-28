// โหมดเล่นจริงจัง: เต็มจอ + ล็อกเมาส์ (Pointer Lock)
// ล็อกแล้วเมาส์ไม่หลุดขอบจอ: ขยับเมาส์ = หมุนกล้อง · คลิกซ้าย/ขวา = ส่งให้ลานประลองตัดสินใจ (ตี/บล็อก)
// ใช้ mousedown/mouseup ไม่ใช้ pointerdown เพราะ pointer events ไม่ยิง pointerdown ตอนกดปุ่มที่สองซ้อน
// (กดซ้ายค้างแล้วกดขวา = บล็อกระหว่างง้างไม่ติด) · Esc ออกจากล็อกเป็นพฤติกรรมของเบราว์เซอร์เอง
export function createCombatInput({ canvas, view, fullscreenEl, onLook, onButton, onLockChange, onFullscreenChange }) {
  const isLocked = () => document.pointerLockElement === canvas;
  const isFullscreen = () => document.fullscreenElement === fullscreenEl;

  function lock() {
    if (isLocked() || !canvas.requestPointerLock) return;
    try {
      // บางเบราว์เซอร์คืน Promise (ถูกปฏิเสธได้ถ้ากดถี่เกินหลังเพิ่งออก) บางตัวคืน undefined
      canvas.requestPointerLock()?.catch?.(() => {});
    } catch {
      // ไม่รองรับ/ถูกบล็อก → เล่นแบบเมาส์ปกติต่อได้
    }
  }
  function unlock() {
    if (isLocked()) document.exitPointerLock();
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) await document.exitFullscreen();
      else await fullscreenEl.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      // เบราว์เซอร์ไม่ให้เต็มจอ (เช่น อยู่ใน iframe) → ไม่เป็นไร ยังเล่นในหน้าต่างได้
    }
  }

  document.addEventListener('pointerlockchange', () => {
    view.classList.toggle('is-locked', isLocked());
    onLockChange?.(isLocked());
  });
  document.addEventListener('fullscreenchange', () => onFullscreenChange?.(isFullscreen()));
  document.addEventListener('mousemove', (e) => {
    if (isLocked()) onLook(e.movementX, e.movementY);
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!isLocked()) return;
    e.preventDefault();
    onButton(e.button, true);
  });
  document.addEventListener('mouseup', (e) => {
    if (isLocked()) onButton(e.button, false);
  });
  // หลุดล็อก (Esc / สลับแท็บ) ตอนกดค้างอยู่ → ถือว่าปล่อยปุ่มทั้งหมด (ไม่งั้นการ์ดค้าง)
  document.addEventListener('pointerlockchange', () => {
    if (!isLocked()) onButton(-1, false);
  });

  return { lock, unlock, isLocked, toggleFullscreen, isFullscreen };
}
