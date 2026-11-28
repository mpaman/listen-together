import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSoftwareGpu } from '../public/gpu-check.js';

test('รู้ว่าเบราว์เซอร์ใช้ CPU วาดภาพแทนการ์ดจอ', () => {
  assert.equal(isSoftwareGpu('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)'), true);
  assert.equal(isSoftwareGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), true);
  assert.equal(isSoftwareGpu('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
});

test('การ์ดจอจริง / ชื่อที่เบราว์เซอร์ซ่อน → ไม่ใช่ CPU', () => {
  assert.equal(isSoftwareGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050 Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
  assert.equal(isSoftwareGpu('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
  assert.equal(isSoftwareGpu('WebKit WebGL'), false);
  assert.equal(isSoftwareGpu(undefined), false);
});
