import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function isPrivateOrLocalHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  return octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) || octets[0] === 0;
}

function validPaymentUrl(value, allowedOrigins) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (isPrivateOrLocalHostname(url.hostname)) return null;
    if (allowedOrigins.size > 0 && !allowedOrigins.has(url.origin)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const strict = new Set(['https://payments.example.test']);
const cases = [
  ['strict allowlisted HTTPS', 'https://payments.example.test/pay/1', strict, true],
  ['strict unknown domain', 'https://unknown.example/pay/1', strict, false],
  ['provider HTTPS mode accepts public domain', 'https://provider.example/pay/1', new Set(), true],
  ['HTTP', 'http://payments.example.test/pay/1', new Set(), false],
  ['javascript', 'javascript:alert(1)', new Set(), false],
  ['data', 'data:text/html,hello', new Set(), false],
  ['file', 'file:///tmp/test', new Set(), false],
  ['credentials embedded', 'https://user:pass@payments.example.test/pay/1', new Set(), false],
  ['malformed', 'not a url', new Set(), false],
  ['localhost', 'https://localhost/pay/1', new Set(), false],
  ['dot local', 'https://payments.local/pay/1', new Set(), false],
  ['private 10/8', 'https://10.0.0.1/pay/1', new Set(), false],
  ['private 172.16/12', 'https://172.16.5.2/pay/1', new Set(), false],
  ['private 192.168/16', 'https://192.168.1.2/pay/1', new Set(), false],
  ['loopback IPv4', 'https://127.0.0.1/pay/1', new Set(), false],
  ['link-local IPv4', 'https://169.254.1.2/pay/1', new Set(), false],
  ['loopback IPv6', 'https://[::1]/pay/1', new Set(), false],
  ['link-local IPv6', 'https://[fe80::1]/pay/1', new Set(), false],
  ['unique-local IPv6 fc', 'https://[fc00::1]/pay/1', new Set(), false],
  ['unique-local IPv6 fd', 'https://[fd00::1]/pay/1', new Set(), false]
];

const results = cases.map(([name, url, origins, expected]) => {
  const accepted = Boolean(validPaymentUrl(url, origins));
  assert.equal(accepted, expected, name);
  return { name, passed: true };
});

const report = { passed: results.length, failed: 0, tests: results };
const output = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'redirect-origin-results.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
