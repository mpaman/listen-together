// เช็คว่าเบราว์เซอร์วาดภาพ 3D ด้วยการ์ดจอจริง หรือใช้ CPU วาดแทน (ช้ากว่าหลายสิบเท่า)
// เคสจริง 2026-11-28: Chrome ของ Man ปิด "Use graphics acceleration when available" ไว้
// → WebGL วิ่งบน "Microsoft Basic Render Driver" ทั้งที่เครื่องมี RTX 2050 → เกมกระตุกมาก
const SOFTWARE_GPU = /SwiftShader|Basic Render|llvmpipe|softpipe|Software Adapter|WARP/i;

export const isSoftwareGpu = (name) => typeof name === 'string' && SOFTWARE_GPU.test(name);

// ชื่อการ์ดจอที่ WebGL ใช้อยู่จริง (บางเบราว์เซอร์ไม่บอกชื่อจริง → คืนชื่อกลางๆ ซึ่งจะไม่ถูกนับว่าเป็น CPU)
export function gpuNameOf(gl) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}
