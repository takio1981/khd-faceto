import fs from 'fs';
import os from 'os';
import path from 'path';
import * as selfsigned from 'selfsigned';
import { config } from '../config';

const CERT_FILE = path.join(config.https.certDir, 'cert.pem');
const KEY_FILE = path.join(config.https.certDir, 'key.pem');
const HOSTS_FILE = path.join(config.https.certDir, 'hosts.json');

// All LAN-facing IPv4 addresses on this machine (Docker bridge/loopback
// excluded), so the cert covers whichever interface a phone/tablet actually
// reaches the server on — without requiring the operator to know it upfront.
function detectLanIPs(): string[] {
  const ips: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function buildHostList(): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1', ...detectLanIPs(), ...config.https.extraHosts]);
  return Array.from(hosts);
}

// Generates (or reuses) a self-signed cert covering localhost + every LAN IP
// this machine currently has + SERVER_LAN_IP from .env. Cached to disk so it
// survives restarts; regenerated automatically if the host list changes
// (e.g. the machine got a new IP, or SERVER_LAN_IP was added/edited).
export async function ensureSelfSignedCert(): Promise<{ cert: string; key: string }> {
  fs.mkdirSync(config.https.certDir, { recursive: true });
  const hosts = buildHostList();

  const cached = readCached(hosts);
  if (cached) return cached;

  const attrs = [{ name: 'commonName', value: hosts[0] }];
  const altNames: { type: 2 | 7; value?: string; ip?: string }[] = hosts.map((host) =>
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ? { type: 7, ip: host } : { type: 2, value: host }
  );

  const pems = await selfsigned.generate(attrs, {
    notAfterDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  fs.writeFileSync(CERT_FILE, pems.cert);
  fs.writeFileSync(KEY_FILE, pems.private);
  fs.writeFileSync(HOSTS_FILE, JSON.stringify(hosts));

  console.log(`[certs] generated self-signed HTTPS cert for: ${hosts.join(', ')}`);
  return { cert: pems.cert, key: pems.private };
}

function readCached(hosts: string[]): { cert: string; key: string } | null {
  try {
    const savedHosts = JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8')) as string[];
    const sameHosts = savedHosts.length === hosts.length && savedHosts.every((h) => hosts.includes(h));
    if (!sameHosts) return null;
    return { cert: fs.readFileSync(CERT_FILE, 'utf8'), key: fs.readFileSync(KEY_FILE, 'utf8') };
  } catch {
    return null;
  }
}
