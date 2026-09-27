// Node default adapters used by createNodeRuntime(). No TGR network here — that is portal.ts.
import { promises as fsp, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { hardenDir } from './acl.js';
import type { AuditEntry, AuditSink, Clock, KeyValueStore } from '../../seams/index.js';

export const TGR_DIR = join(homedir(), '.tgr');

/** `hardenDir` spawns a process on Windows, so harden ONCE per process on first directory
 *  creation, not on every write. */
const hardened = new Set<string>();
function ensureHardened(dir: string): void {
  if (hardened.has(dir)) return;
  hardened.add(dir);
  hardenDir(dir);
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** fs-backed JSON store: ~/.tgr/<key>.json, atomic write.
 *
 *  Permissions: `0o700`/`0o600` are POSIX-only — on **Windows those modes are a no-op** (Node maps
 *  `mode` to the read-only attribute; NTFS ACLs are inherited). There the directory is restricted
 *  explicitly via `hardenDir`. Do not read the mode arguments below as a cross-platform
 *  guarantee — they are not one. */
export class FileKeyValueStore implements KeyValueStore {
  constructor(private readonly baseDir: string = TGR_DIR) {}
  private pathFor(key: string): string {
    return join(this.baseDir, `${key}.json`);
  }
  async read<T>(key: string): Promise<T | null> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.pathFor(key), 'utf8');
    } catch (err) {
      // A genuinely absent file is the normal "not authenticated" path.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      // Anything else (permissions, I/O, a directory in the way) is a real fault. Still degrade to
      // null so a read never throws, but SAY SO — silently reporting a disk problem as "no
      // session" sends the user to re-login forever and hides the cause.
      process.stderr.write(
        `tgr: no se pudo leer ${this.pathFor(key)}: ${(err as Error).message}\n`,
      );
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      process.stderr.write(
        `tgr: ${this.pathFor(key)} está corrupto (JSON inválido); se ignorará. ` +
          'Ejecuta `tgr auth login` para regenerarlo.\n',
      );
      return null;
    }
  }
  async write<T>(key: string, value: T): Promise<void> {
    await fsp.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    ensureHardened(this.baseDir); // no-op off Windows
    const target = this.pathFor(key);
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, target);
  }
  async delete(key: string): Promise<void> {
    try {
      await fsp.unlink(this.pathFor(key));
    } catch {
      // already gone
    }
  }
}

/** Append-only JSONL receipt: ~/.tgr/audit.jsonl. Best-effort, never throws. Same permission
 *  caveat as the store: the modes below are POSIX-only; Windows is handled by `hardenDir`. */
export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string = join(TGR_DIR, 'audit.jsonl')) {}
  record(entry: AuditEntry): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      ensureHardened(dirname(this.path));
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // a receipt is never a gatekeeper — failures degrade silently
    }
  }
}

export { hardenDir, hardenDirCommand } from './acl.js';
