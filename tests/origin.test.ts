import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin } from '../apps/api/src/origin.js';

test('local development accepts localhost, IPv4 and IPv6 aliases on the configured frontend port', () => {
  for (const configured of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
      assert.equal(isAllowedOrigin(origin, configured, 'development'), true);
    }
  }
});
test('development rejects other origins, ports, protocols and malformed origin values', () => {
  for (const origin of [undefined, 'null', 'http://evil.example', 'http://localhost.evil.example:5173',
    'http://127.0.0.2:5173', 'http://127.0.0.1:5174', 'https://127.0.0.1:5173',
    'http://localhost:5173/path', 'http://user:password@localhost:5173', 'http://localhost:5173/']) {
    assert.equal(isAllowedOrigin(origin, 'http://localhost:5173', 'development'), false, origin);
  }
});
test('production remains restricted to the exact configured origin', () => {
  assert.equal(isAllowedOrigin('https://travel.binarium.ro', 'https://travel.binarium.ro', 'production'), true);
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://evil.example']) {
    assert.equal(isAllowedOrigin(origin, 'https://travel.binarium.ro', 'production'), false);
  }
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', 'http://localhost:5173', 'production'), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', 'http://localhost:5173', 'test'), false);
});
test('a non-loopback development APP_URL does not implicitly trust local origins', () => {
  assert.equal(isAllowedOrigin('https://preview.example', 'https://preview.example', 'development'), true);
  assert.equal(isAllowedOrigin('https://localhost', 'https://preview.example', 'development'), false);
});
