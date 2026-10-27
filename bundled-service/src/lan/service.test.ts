/**
 * Tests for the Luna wiring of the LAN service: the HTTP server follows the app's
 * start and stop, and comes back on the same port.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { registerLanService } from './service';

type Handler = (msg: { respond: (r: unknown) => void }) => void;

function fakeService() {
  const handlers: { [method: string]: Handler } = {};
  return {
    handlers,
    service: {
      register: (method: string, handler: Handler) => { handlers[method] = handler; },
      activityManager: { create: () => {}, complete: () => {} },
    },
  };
}

function call(handlers: { [method: string]: Handler }, method: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    handlers[method]({ respond: (r) => resolve(r as Record<string, unknown>) });
  });
}

let dataDir: string;
const blockers: net.Server[] = [];

afterEach(() => {
  while (blockers.length) blockers.pop()!.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

async function started() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-svc-test-'));
  const fake = fakeService();
  registerLanService(fake.service, dataDir);
  const first = await call(fake.handlers, 'start');
  return { ...fake, first };
}

describe('registerLanService', () => {
  it('starts on a port, and says it is running', async () => {
    const { handlers, first } = await started();
    expect(first.running).toBe(true);
    expect(first.port).toBeGreaterThan(0);
    await call(handlers, 'stop');
  });

  it('comes back on the same port after a stop and start, so a paused stream\'s URL stays good', async () => {
    const { handlers, first } = await started();
    expect((await call(handlers, 'stop')).stopped).toBe(true);
    const again = await call(handlers, 'start');
    expect(again.running).toBe(true);
    expect(again.port).toBe(first.port);
    await call(handlers, 'stop');
  });

  it('takes another port when the old one was taken meanwhile', async () => {
    const { handlers, first } = await started();
    await call(handlers, 'stop');
    // Wait for the stopped listener to let go, then hold its port.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const blocker = net.createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(first.port as number, '0.0.0.0', resolve);
    });
    const again = await call(handlers, 'start');
    expect(again.running).toBe(true);
    expect(again.port).not.toBe(first.port);
    await call(handlers, 'stop');
  });
});
