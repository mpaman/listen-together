// ลากเรียงคิวด้วยที่จับ ⠿ — ใช้ pointer events (เมาส์ + นิ้วบนมือถือ) ไม่ใช้ HTML5 drag (มือถือลากไม่ได้)
// หลักการ: ระหว่างลากไม่ย้าย DOM จริง แค่เลื่อนแถวด้วย transform (ลื่น ไม่กระตุก)
// ปล่อยมือแล้วค่อยย้าย DOM ทันที (กันกระพริบกลับที่เดิม) + ส่ง action ไป server ให้ทุกคนเห็นลำดับใหม่
const EDGE_PX = 40; // ลากเข้าใกล้ขอบรายการ → เลื่อนรายการตาม
const EDGE_SCROLL_STEP = 10;

export function createQueueDrag(list, { onMove, onEnd }) {
  let drag = null;
  let focusId = null; // แถวที่ต้องคืนโฟกัสหลังวาดคิวใหม่ (ย้ายด้วยคีย์บอร์ด)

  const rowsOf = () => [...list.querySelectorAll(':scope > .song')];
  const contentY = (clientY) => clientY - list.getBoundingClientRect().top + list.scrollTop;

  function start(e, handle) {
    const row = handle.closest('.song');
    const rows = rowsOf();
    const from = rows.indexOf(row);
    if (from === -1 || rows.length < 2) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const top = list.getBoundingClientRect().top - list.scrollTop;
    const centers = rows.map((r) => {
      const rect = r.getBoundingClientRect();
      return rect.top - top + rect.height / 2;
    });
    const gap = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom;
    drag = { row, rows, from, to: from, centers, shift: row.offsetHeight + Math.max(0, gap), startY: contentY(e.clientY), pointerId: e.pointerId };
    row.classList.add('is-dragging');
    list.classList.add('is-sorting');
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const listRect = list.getBoundingClientRect();
    if (e.clientY < listRect.top + EDGE_PX) list.scrollTop -= EDGE_SCROLL_STEP;
    else if (e.clientY > listRect.bottom - EDGE_PX) list.scrollTop += EDGE_SCROLL_STEP;

    const dy = contentY(e.clientY) - drag.startY;
    const center = drag.centers[drag.from] + dy;
    // ลำดับใหม่ = จำนวนแถวอื่นที่อยู่เหนือจุดกึ่งกลางของแถวที่ลาก
    const to = drag.centers.filter((c, i) => i !== drag.from && c < center).length;
    drag.to = to;
    drag.row.style.transform = `translateY(${dy}px)`;
    drag.rows.forEach((r, i) => {
      if (i === drag.from) return;
      const restIndex = i < drag.from ? i : i - 1;
      const offset = i < drag.from && restIndex >= to ? drag.shift : i > drag.from && restIndex < to ? -drag.shift : 0;
      r.style.transform = offset ? `translateY(${offset}px)` : '';
    });
  }

  function finish(e, cancelled = false) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { row, rows, from, to } = drag;
    drag = null;
    for (const r of rows) r.style.transform = '';
    row.classList.remove('is-dragging');
    list.classList.remove('is-sorting');
    if (!cancelled && to !== from) {
      const rest = rows.filter((r) => r !== row);
      if (to >= rest.length) list.append(row);
      else list.insertBefore(row, rest[to]);
      onMove(row.dataset.id, to);
    }
    onEnd();
  }

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (handle && e.button === 0) start(e, handle);
  });
  list.addEventListener('pointermove', move);
  list.addEventListener('pointerup', (e) => finish(e));
  list.addEventListener('pointercancel', (e) => finish(e, true));

  // คีย์บอร์ด: โฟกัสที่จับแล้วกด ↑/↓ ย้ายทีละช่อง
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const row = handle.closest('.song');
    const rows = rowsOf();
    const to = rows.indexOf(row) + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= rows.length) return;
    focusId = row.dataset.id;
    onMove(row.dataset.id, to);
  });

  return {
    isDragging: () => drag !== null,
    // เรียกหลังวาดคิวใหม่: คืนโฟกัสให้ที่จับของแถวที่เพิ่งย้ายด้วยคีย์บอร์ด
    restoreFocus() {
      if (!focusId) return;
      const row = [...list.children].find((r) => r.dataset.id === focusId);
      focusId = null;
      row?.querySelector('.drag-handle')?.focus();
    },
  };
}
