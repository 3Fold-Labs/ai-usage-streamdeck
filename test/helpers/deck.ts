import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const root = process.cwd();
async function cleanup(dir: string) {
  assert.ok(path.basename(dir).startsWith('ai-usage-'));
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
export type DeckMessage = {
  event: string;
  action?: string;
  context?: string;
  payload?: any;
};
export type DeckHandle = {
  dir: string;
  socket: any;
  stderr: () => string;
  messages: DeckMessage[];
  global: Record<string, unknown>;
  send: (message: object) => void;
  waitFor: (
    match: (message: DeckMessage) => boolean,
    ms?: number
  ) => Promise<DeckMessage>;
  close: () => Promise<void>;
};

const pluginInfo = {
  application: {
    language: 'en',
    platform: 'windows',
    platformVersion: '10',
    version: '7.1.0'
  },
  plugin: { uuid: 'com.3foldlabs.ai-usage', version: '0.1.0.0' },
  devicePixelRatio: 1,
  devices: [
    {
      id: 'test-device',
      name: 'Stream Deck',
      type: 0,
      size: { columns: 5, rows: 3 }
    }
  ]
};

export async function openDeck(
  initialGlobal: Record<string, unknown> = {},
  sharedData?: string,
  faults: { ignoreGlobalWrites?: boolean } = {}
): Promise<DeckHandle> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-lifecycle-'));
  const pluginUuid = 'com.3foldlabs.ai-usage';
  const pluginRoot = path.join(
    process.env.AI_USAGE_TEST_PACKAGE_ROOT || root,
    pluginUuid + '.sdPlugin'
  );
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  const global: Record<string, unknown> = { ...initialGlobal };
  const child = spawn(
    process.execPath,
    [
      path.join(pluginRoot, 'bin/plugin.js'),
      '-port',
      String(port),
      '-pluginUUID',
      pluginUuid,
      '-registerEvent',
      'registerPlugin',
      '-info',
      JSON.stringify({
        ...pluginInfo,
        plugin: { uuid: pluginUuid, version: '0.0.61.0' }
      })
    ],
    {
      cwd: pluginRoot,
      env: {
        ...process.env,
        AI_USAGE_DATA_DIR: sharedData || dir,
        CLAUDE_CONFIG_DIR: path.join(dir, 'config'),
        HOME: dir,
        USERPROFILE: dir,
        APPDATA: dir,
        LOCALAPPDATA: dir
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const inbox: DeckMessage[] = [];
  const messages: DeckMessage[] = [];
  const waiters: {
    match: (message: DeckMessage) => boolean;
    resolve: (message: DeckMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  let socket: any;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Plugin did not connect: ' + stderr)),
      8000
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on('connection', (client: any) => {
      socket = client;
      client.on('message', (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as DeckMessage;
        messages.push(message);
        if (message.event === 'getGlobalSettings') {
          client.send(
            JSON.stringify({
              event: 'didReceiveGlobalSettings',
              payload: { settings: global }
            })
          );
          return;
        }
        if (
          message.event === 'setGlobalSettings' &&
          !faults.ignoreGlobalWrites
        ) {
          Object.keys(global).forEach((key) => {
            delete global[key];
          });
          Object.assign(global, message.payload || {});
        }
        for (let i = 0; i < waiters.length; i++) {
          if (waiters[i].match(message)) {
            clearTimeout(waiters[i].timer);
            waiters[i].resolve(message);
            waiters.splice(i, 1);
            return;
          }
        }
        inbox.push(message);
      });
      clearTimeout(timer);
      resolve();
    });
  });
  return {
    dir,
    socket,
    messages,
    stderr: () => stderr,
    global,
    send: (message) => socket.send(JSON.stringify(message)),
    waitFor: (match, ms = 8000) =>
      new Promise((resolve, reject) => {
        for (let i = 0; i < inbox.length; i++) {
          if (match(inbox[i])) {
            resolve(inbox.splice(i, 1)[0]);
            return;
          }
        }
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(
            new Error(
              'Timed out waiting for plugin message: ' +
                stderr +
                JSON.stringify(
                  messages.slice(-12).map((m) => ({
                    event: m.event,
                    context: m.context,
                    payload: m.event === 'setImage' ? 'image' : m.payload
                  }))
                )
            )
          );
        }, ms);
        waiters.push({ match, resolve, reject, timer });
      }),
    close: async () => {
      child.kill();
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(resolve));
      await cleanup(dir);
    }
  };
}

export const appear = (action: string, context: string, settings: object) => ({
  event: 'willAppear',
  action,
  context,
  device: 'test-device',
  payload: {
    controller: 'Keypad',
    settings,
    coordinates: { column: 0, row: 0 },
    state: 0,
    isInMultiAction: false
  }
});

export const openPi = (action: string, context: string) => ({
  event: 'propertyInspectorDidAppear',
  action,
  context,
  device: 'test-device'
});
