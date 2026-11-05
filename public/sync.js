// หัวใจของการฟังพร้อมกัน: เรียกทุก ~0.4 วินาที
// เทียบ "สิ่งที่ห้องบอกว่าควรเป็น" กับ "สิ่งที่ตัวเล่นเครื่องนี้เป็นอยู่" แล้วแก้ให้ตรง
//
// ทำไมไม่ seek ทุกครั้งที่ต่างกันนิดเดียว: seek ทำให้เสียงสะดุด จึงยอมให้คลาดได้ DRIFT_TOLERANCE
// ทำไมต้องมี cooldown: ช่วงโฆษณา/โหลด ตัวเล่นยังไม่ตาม ถ้า seek รัวๆ จะยิ่งโหลดไม่จบ
// โฆษณาจบเมื่อไร รอบถัดไปจะเห็นว่าคลาด แล้ว seek ไปตำแหน่งที่คนอื่นฟังอยู่เอง

const DRIFT_TOLERANCE_SEC = 0.3;
const SEEK_COOLDOWN_MS = 2500;
const PAUSED_DRIFT_SEC = 1;

export function expectedPosition(room, serverNow) {
  if (!room.isPlaying) return room.position;
  return room.position + (serverNow - room.refTime) / 1000;
}

export function currentItem(room) {
  return room.queue.find((item) => item.id === room.currentId) ?? null;
}

export function createSyncer(player) {
  let lastSeekAt = 0;
  // จำ "รายการในคิว" ที่โหลดอยู่ ไม่ใช่แค่ videoId — เพลงเดียวกันอยู่ในคิว 2 ครั้งต้องโหลดใหม่ได้
  let loadedItemId = null;
  const S = player.states;

  function seekWithCooldown(target) {
    const now = Date.now();
    if (now - lastSeekAt < SEEK_COOLDOWN_MS) return;
    lastSeekAt = now;
    player.seek(target);
  }

  function reconcile(room, serverNow) {
    const item = currentItem(room);
    if (!item) {
      if (loadedItemId) player.unload();
      loadedItemId = null;
      return;
    }

    const expected = expectedPosition(room, serverNow);

    // เปลี่ยนเพลง → โหลดใหม่โดยเริ่มที่ตำแหน่งที่ห้องเล่นอยู่ (คนเข้ามากลางเพลงจะไม่ได้เริ่มจาก 0)
    if (loadedItemId !== item.id) {
      loadedItemId = item.id;
      lastSeekAt = Date.now();
      player.load(item.videoId, expected, room.isPlaying);
      return;
    }

    const state = player.state();
    if (room.isPlaying) {
      // เล่นจบไปแล้วแต่ห้องสั่งเล่นอีก (กด play หลังคิวจบ / ย้อนต้นเพลง) → กรอกลับแล้วเล่น
      if (state === S.ENDED && expected < player.duration() - 1) {
        player.seek(expected);
        player.play();
        return;
      }
      if (state === S.PAUSED || state === S.CUED || state === S.UNSTARTED) player.play();
      if (state === S.PLAYING && Math.abs(player.currentTime() - expected) > DRIFT_TOLERANCE_SEC) {
        seekWithCooldown(expected);
      }
      return;
    }

    if (state === S.PLAYING || state === S.BUFFERING) player.pause();
    if (state === S.PAUSED && Math.abs(player.currentTime() - expected) > PAUSED_DRIFT_SEC) {
      seekWithCooldown(expected);
    }
  }

  return { reconcile, loadedItemId: () => loadedItemId };
}
