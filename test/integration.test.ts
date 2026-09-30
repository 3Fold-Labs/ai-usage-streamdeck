import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  readdir
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readCodex, findBundledCodex } from '../src/providers/codex.js';
import { UsageService } from '../src/service.js';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const root = process.cwd();
async function cleanup(directory: string) {
  const relative = path.relative(
    path.resolve(tmpdir()),
    path.resolve(directory)
  );
  assert.ok(
    relative &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      path.basename(directory).startsWith('ai-usage-')
  );
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

test('Codex detection skips helper-only bundles instead of rejecting the installation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-bundles-'));
  try {
    await mkdir(path.join(dir, 'cli'));
    await mkdir(path.join(dir, 'helper'));
    await writeFile(path.join(dir, 'cli', 'codex.exe'), 'fixture');
    assert.equal(
      await findBundledCodex(dir),
      path.join(dir, 'cli', 'codex.exe')
    );
  } finally {
    await cleanup(dir);
  }
});

test('Claude bridge saves only quota data and feeds the real service', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-'));
  try {
    const child = spawn(
      process.execPath,
      [path.join(root, 'scripts/claude-statusline.mjs')],
      {
        env: { ...process.env, AI_USAGE_DATA_DIR: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stdin.end(
      JSON.stringify({
        prompt: 'PRIVATE',
        transcript_path: 'SECRET',
        rate_limits: {
          five_hour: {
            used_percentage: 27,
            resets_at: Date.now() / 1000 + 3600
          },
          seven_day: { used_percentage: 60 }
        }
      })
    );
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Bridge failed'))
      );
    });
    const file = path.join(dir, 'claude.json');
    const raw = await readFile(file, 'utf8');
    assert.doesNotMatch(raw, /PRIVATE|SECRET|prompt|transcript/);
    assert.match(output, /5h 27%/);
    const service = new UsageService();
    const snapshot = await service.get('anthropic', { claudeFile: file });
    assert.equal(snapshot.short?.used, 27);
    assert.equal(snapshot.weekly?.used, 60);
  } finally {
    await cleanup(dir);
  }
});

test('Claude connection preserves existing settings and is safe to run twice', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-setup-'));
  const configDir = path.join(dir, 'config');
  const dataDir = path.join(dir, 'data');
  await mkdir(configDir);
  const settingsFile = path.join(configDir, 'settings.json');
  const original = {
    permissions: { allow: ['Read'] },
    statusLine: { type: 'command', command: 'echo previous-status', padding: 1 }
  };
  await writeFile(settingsFile, JSON.stringify(original));
  const connect = () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(root, 'scripts/connect-claude.mjs')],
        {
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: configDir,
            AI_USAGE_DATA_DIR: dataDir
          },
          windowsHide: true,
          stdio: 'ignore'
        }
      );
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Setup failed'))
      );
    });
  try {
    await connect();
    await connect();
    const config = JSON.parse(await readFile(settingsFile, 'utf8'));
    assert.deepEqual(config.permissions, original.permissions);
    assert.equal(config.statusLine.padding, 1);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(dataDir, 'previous-statusline.json'), 'utf8')
      ),
      original.statusLine
    );
    assert.equal(
      (await readdir(configDir)).filter((file) => file.includes('backup'))
        .length,
      1
    );
    assert.match(config.statusLine.command, /claude-statusline.mjs/);
  } finally {
    await cleanup(dir);
  }
});

test('Codex RPC handshake requests only usage, without creating a turn', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-rpc-'));
  await writeFile(
    path.join(dir, 'app-server'),
    `const readline=require('node:readline');let initialized=false;readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize') console.log(JSON.stringify({id:m.id,result:{}}));else if(m.method==='initialized')initialized=true;else if(m.method==='account/rateLimits/read'&&initialized)console.log(JSON.stringify({id:m.id,result:{rateLimits:{primary:{usedPercent:17,windowDurationMins:300}}}}));else process.exit(2);});`
  );
  try {
    process.chdir(dir);
    const result = (await readCodex(process.execPath, 3000)) as {
      rateLimits: { primary: { usedPercent: number } };
    };
    assert.equal(result.rateLimits.primary.usedPercent, 17);
  } finally {
    process.chdir(root);
    await cleanup(dir);
  }
});

test('Codex requests time out and clean up an unresponsive process', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-timeout-'));
  await writeFile(path.join(dir, 'app-server'), 'setInterval(()=>{},1000);');
  try {
    process.chdir(dir);
    await assert.rejects(readCodex(process.execPath, 100), /timed out/);
  } finally {
    process.chdir(root);
    await cleanup(dir);
  }
});

type DeckMessage = {
  event: string;
  action?: string;
  context?: string;
  payload?: any;
};
type DeckHandle = {
  dir: string;
  socket: any;
  stderr: () => string;
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
    version: '6.9.0'
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

async function openDeck(
  prefix = 'ai-usage-deck-',
  initialGlobal: Record<string, unknown> = {}
): Promise<DeckHandle> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  const global: Record<string, unknown> = { ...initialGlobal };
  const child = spawn(
    process.execPath,
    [
      path.join(
        process.env.AI_USAGE_TEST_PACKAGE_ROOT || root,
        'com.3foldlabs.ai-usage.sdPlugin/bin/plugin.js'
      ),
      '-port',
      String(port),
      '-pluginUUID',
      'test-plugin',
      '-registerEvent',
      'registerPlugin',
      '-info',
      JSON.stringify(pluginInfo)
    ],
    {
      cwd: path.join(
        process.env.AI_USAGE_TEST_PACKAGE_ROOT || root,
        'com.3foldlabs.ai-usage.sdPlugin'
      ),
      env: {
        ...process.env,
        AI_USAGE_DATA_DIR: dir,
        CLAUDE_CONFIG_DIR: path.join(dir, 'config')
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
        if (message.event === 'getGlobalSettings') {
          client.send(
            JSON.stringify({
              event: 'didReceiveGlobalSettings',
              payload: { settings: global }
            })
          );
          return;
        }
        if (message.event === 'setGlobalSettings') {
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
          reject(new Error('Timed out waiting for plugin message: ' + stderr));
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

const appear = (action: string, context: string, settings: object) => ({
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

const openPi = (action: string, context: string) => ({
  event: 'propertyInspectorDidAppear',
  action,
  context,
  device: 'test-device'
});

test(
  'connecting Claude selects the exporter, renders its reset, restores usage and stops painting hidden keys',
  { timeout: 15000 },
  async () => {
    const deck = await openDeck();
    const file = path.join(deck.dir, 'claude.json');
    const desktopFile = path.join(deck.dir, 'desktop-history.json');
    await writeFile(
      desktopFile,
      JSON.stringify({ samples: [{ t: Date.now(), u: { fh: 99, sd: 88 } }] })
    );
    await writeFile(
      file,
      JSON.stringify({
        observedAt: Date.now(),
        rate_limits: {
          five_hour: {
            used_percentage: 42,
            resets_at: Date.now() / 1000 + 7200
          }
        }
      })
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Plugin did not render: ' + deck.stderr())),
          10000
        );
        let stage = 'desktop';
        let savedSource = false;
        let hiddenAt = 0;
        const onMessage = async () => {
          for (;;) {
            const message = await deck
              .waitFor(() => true, 10000)
              .catch((error) => {
                clearTimeout(timer);
                throw error;
              });
            if (message.event === 'registerPlugin')
              deck.send(
                appear('com.3foldlabs.ai-usage.anthropic-short', 'test-key', {
                  claudeFile: desktopFile
                })
              );
            if (message.event === 'setSettings')
              savedSource = message.payload.claudeFile === file;
            if (message.event !== 'setImage') continue;
            const svg = Buffer.from(
              message.payload.image.split(',')[1],
              'base64'
            ).toString();
            if (stage === 'desktop' && svg.includes('>99%<')) {
              stage = 'usage';
              deck.send({
                event: 'sendToPlugin',
                action: 'com.3foldlabs.ai-usage.anthropic-short',
                context: 'test-key',
                payload: { connectClaude: true }
              });
            } else if (stage === 'usage' && svg.includes('>42%<')) {
              if (!savedSource) {
                clearTimeout(timer);
                reject(
                  new Error('Exporter was not saved as the button source')
                );
                return;
              }
              stage = 'countdown';
              deck.send({
                event: 'keyDown',
                action: 'com.3foldlabs.ai-usage.anthropic-short',
                context: 'test-key',
                device: 'test-device',
                payload: {
                  controller: 'Keypad',
                  settings: { claudeFile: file },
                  coordinates: { column: 0, row: 0 },
                  state: 0,
                  isInMultiAction: false
                }
              });
            } else if (
              stage === 'countdown' &&
              svg.includes('>RESET<') &&
              />(1h 59m|2h 0m)</.test(svg)
            )
              stage = 'restored';
            else if (stage === 'restored' && svg.includes('>42%<')) {
              stage = 'hidden';
              hiddenAt = Date.now();
              deck.send({
                event: 'willDisappear',
                action: 'com.3foldlabs.ai-usage.anthropic-short',
                context: 'test-key',
                device: 'test-device',
                payload: {
                  controller: 'Keypad',
                  settings: { claudeFile: file },
                  coordinates: { column: 0, row: 0 },
                  state: 0,
                  isInMultiAction: false
                }
              });
              setTimeout(() => {
                clearTimeout(timer);
                resolve();
              }, 500);
            } else if (stage === 'hidden' && Date.now() - hiddenAt > 125) {
              clearTimeout(timer);
              reject(new Error('Hidden key kept receiving animation frames'));
              return;
            }
          }
        };
        onMessage().catch(reject);
      });
    } finally {
      await deck.close();
    }
  }
);

test(
  'a chosen account paints its nickname on the key',
  {
    timeout: 15000,
    skip:
      process.platform === 'linux'
        ? 'Desktop discovery requires Windows or macOS; covered by release verification.'
        : false
  },
  async () => {
    const org = '11111111-1111-4111-8111-111111111111';
    const accountId = 'anthropic-abcd1234';
    const accounts = {
      version: 1,
      accounts: [
        {
          id: accountId,
          provider: 'anthropic',
          key: org,
          nick: 'C2',
          name: 'Claude subscription 2',
          addedAt: 1
        }
      ]
    };
    const deck = await openDeck('ai-usage-nick-', { accounts });
    await mkdir(path.join(deck.dir, 'claude-accounts'));
    await writeFile(
      path.join(deck.dir, 'claude-accounts', `${org}.json`),
      JSON.stringify({
        observedAt: Date.now(),
        account: { org, name: 'Claude subscription 2' },
        rate_limits: {
          seven_day: {
            used_percentage: 64,
            resets_at: Date.now() / 1000 + 3600
          }
        }
      })
    );
    try {
      await deck.waitFor((message) => message.event === 'registerPlugin');
      deck.send(
        appear('com.3foldlabs.ai-usage.anthropic-weekly', 'nick-key', {
          account: accountId
        })
      );
      const image = await deck.waitFor((message) => {
        if (message.event !== 'setImage' || message.context !== 'nick-key')
          return false;
        const svg = Buffer.from(
          message.payload.image.split(',')[1],
          'base64'
        ).toString();
        return svg.includes('>C2</text>') && svg.includes('>64%<');
      });
      const svg = Buffer.from(
        image.payload.image.split(',')[1],
        'base64'
      ).toString();
      assert.match(svg, />C2<\/text>/);
      assert.match(svg, />64%</);
    } finally {
      await deck.close();
    }
  }
);

test(
  'removing an account resets keys to follow and reports blocked removals',
  { timeout: 15000 },
  async () => {
    const org = '22222222-2222-4222-8222-222222222222';
    const accountId = 'anthropic-deadbeef';
    const grokId = 'grok-managed1';
    const accounts = {
      version: 1,
      accounts: [
        {
          id: accountId,
          provider: 'anthropic',
          key: org,
          nick: 'C3',
          name: 'Claude subscription 3',
          addedAt: 1
        },
        {
          id: grokId,
          provider: 'grok',
          key: 'smfixture@example.invalid',
          nick: 'SM',
          name: 'smfixture@example.invalid',
          addedAt: 1
        }
      ]
    };
    const deck = await openDeck('ai-usage-remove-', { accounts });
    await mkdir(path.join(deck.dir, 'claude-accounts'));
    await writeFile(
      path.join(deck.dir, 'claude-accounts', `${org}.json`),
      JSON.stringify({
        observedAt: Date.now(),
        account: { org, name: 'Claude subscription 3' },
        rate_limits: {
          seven_day: { used_percentage: 8, resets_at: Date.now() / 1000 + 3600 }
        }
      })
    );
    try {
      await deck.waitFor((message) => message.event === 'registerPlugin');
      deck.send(
        appear('com.3foldlabs.ai-usage.anthropic-weekly', 'key-a', {
          account: accountId
        })
      );
      deck.send(
        appear('com.3foldlabs.ai-usage.anthropic-short', 'key-b', {
          account: accountId
        })
      );
      await deck.waitFor(
        (message) => message.event === 'setImage' && message.context === 'key-a'
      );
      await deck.waitFor(
        (message) => message.event === 'setImage' && message.context === 'key-b'
      );
      deck.send(openPi('com.3foldlabs.ai-usage.anthropic-weekly', 'key-a'));
      deck.send({
        event: 'sendToPlugin',
        action: 'com.3foldlabs.ai-usage.anthropic-weekly',
        context: 'key-a',
        payload: { remove: { id: grokId } }
      });
      const blocked = await deck.waitFor(
        (message) =>
          message.event === 'sendToPropertyInspector' &&
          message.payload?.accountError
      );
      assert.equal(
        blocked.payload.accountError,
        'Grok Bot manages this account. Remove it inside Grok Bot and it disappears here.'
      );
      deck.send({
        event: 'sendToPlugin',
        action: 'com.3foldlabs.ai-usage.anthropic-weekly',
        context: 'key-a',
        payload: { remove: { id: accountId } }
      });
      const resetA = await deck.waitFor(
        (message) =>
          message.event === 'setSettings' &&
          message.context === 'key-a' &&
          message.payload?.account === 'follow'
      );
      const resetB = await deck.waitFor(
        (message) =>
          message.event === 'setSettings' &&
          message.context === 'key-b' &&
          message.payload?.account === 'follow'
      );
      assert.equal(resetA.payload.account, 'follow');
      assert.equal(resetB.payload.account, 'follow');
      const next = (deck.global.accounts as { accounts: { id: string }[] })
        .accounts;
      assert.ok(!next.some((account) => account.id === accountId));
      assert.ok(next.some((account) => account.id === grokId));
    } finally {
      await deck.close();
    }
  }
);

test(
  'a key paints the bar and background colors saved in its settings',
  { timeout: 15000 },
  async () => {
    const deck = await openDeck('ai-usage-colors-');
    const file = path.join(deck.dir, 'claude.json');
    await writeFile(
      file,
      JSON.stringify({
        observedAt: Date.now(),
        rate_limits: {
          seven_day: {
            used_percentage: 55,
            resets_at: Date.now() / 1000 + 7200
          }
        }
      })
    );
    try {
      await deck.waitFor((message) => message.event === 'registerPlugin');
      deck.send(
        appear('com.3foldlabs.ai-usage.anthropic-weekly', 'color-key', {
          claudeFile: file,
          barColor: '#12ab34',
          keyColor: '#f5f5f5'
        })
      );
      const image = await deck.waitFor((message) => {
        if (message.event !== 'setImage' || message.context !== 'color-key')
          return false;
        const svg = Buffer.from(
          message.payload.image.split(',')[1],
          'base64'
        ).toString();
        return svg.includes('>55%<');
      });
      const svg = Buffer.from(
        image.payload.image.split(',')[1],
        'base64'
      ).toString();
      assert.match(
        svg,
        /<rect width="144" height="144" rx="15" fill="#F5F5F5"/
      );
      assert.match(svg, /rx="3" fill="#12AB34"/);
      // Light background means dark ink on the percentage.
      assert.match(
        svg,
        /fill="#11171D" font-family="Arial, sans-serif" font-size="\d+"/
      );
    } finally {
      await deck.close();
    }
  }
);

// The property inspector is browser code, so it runs here against a small DOM and socket stand-in.
async function openInspector(action: string) {
  const sent: string[] = [];
  class El {
    handlers: Record<string, ((event: any) => void)[]> = {};
    value = '';
    textContent = '';
    checked = false;
    disabled = false;
    hidden = false;
    innerHTML = '';
    style: Record<string, string> = {};
    classList = { add() {}, remove() {}, contains: () => false, toggle() {} };
    constructor(public id: string) {}
    addEventListener(type: string, fn: (event: any) => void) {
      (this.handlers[type] ||= []).push(fn);
    }
    fire(type: string, extra: object = {}) {
      for (const fn of [...(this.handlers[type] || [])])
        fn({
          type,
          preventDefault() {},
          currentTarget: this,
          target: this,
          ...extra
        });
    }
    setAttribute() {}
    getAttribute() {
      return null;
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    replaceChildren() {}
    appendChild() {}
    remove() {}
    focus() {}
  }
  const elements = new Map<string, any>();
  const byId = (id: string) => {
    if (!elements.has(id)) elements.set(id, new El(id));
    return elements.get(id);
  };
  const document = {
    activeElement: null,
    body: { contains: () => false },
    getElementById: byId,
    createElement: () => new El('created'),
    addEventListener() {},
    querySelectorAll: () => []
  };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(public url: string) {
      queueMicrotask(() => this.onopen?.());
    }
    send(message: string) {
      sent.push(message);
    }
  }
  const context: any = vm.createContext({
    window: {},
    document,
    WebSocket: Socket,
    Option: class {
      constructor(
        public text: string,
        public value: string
      ) {}
    },
    navigator: { clipboard: {} },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask
  });
  vm.runInContext(
    await readFile(
      path.join(
        process.env.AI_USAGE_TEST_PACKAGE_ROOT || root,
        'com.3foldlabs.ai-usage.sdPlugin/ui/inspector.js'
      ),
      'utf8'
    ),
    context
  );
  context.window.connectElgatoStreamDeckSocket(
    1,
    'pi-context',
    'registerPropertyInspector',
    JSON.stringify(pluginInfo),
    JSON.stringify({ action, payload: { settings: {} } })
  );
  await new Promise((resolve) => setImmediate(resolve));
  const saved = () =>
    sent
      .map((message) => JSON.parse(message))
      .filter((message) => message.event === 'setSettings')
      .map((message) => message.payload);
  const palettes = () =>
    sent
      .map((message) => JSON.parse(message))
      .filter(
        (message) =>
          message.event === 'sendToPlugin' && message.payload?.palettes
      )
      .map((message) => message.payload.palettes);
  return { byId, saved, palettes };
}

test('the inspector saves key colors as soon as they change', async () => {
  const pi = await openInspector('com.3foldlabs.ai-usage.anthropic-weekly');
  pi.byId('barColor').value = '#12ab34';
  pi.byId('barColor').fire('change');
  let last = pi.saved().at(-1);
  assert.equal(last.barColor, '#12AB34');
  pi.byId('keyColor').value = '#f5f5f5';
  pi.byId('keyColor').fire('change');
  last = pi.saved().at(-1);
  assert.equal(last.barColor, '#12AB34');
  assert.equal(last.keyColor, '#F5F5F5');
  // Existing controls keep saving alongside the colors.
  pi.byId('display').value = 'remaining';
  pi.byId('display').fire('change');
  last = pi.saved().at(-1);
  assert.equal(last.remaining, true);
  assert.equal(last.keyColor, '#F5F5F5');
  pi.byId('resetColors').fire('click');
  last = pi.saved().at(-1);
  assert.equal(last.barColor, '');
  assert.equal(last.keyColor, '');
});

test('a custom color fills the next empty tile and the picker keeps the current color', async () => {
  const pi = await openInspector('com.3foldlabs.ai-usage.anthropic-weekly');
  pi.byId('barColor').value = '#12ab34';
  pi.byId('barColor').fire('change');
  let last = pi.palettes().at(-1);
  assert.deepEqual(last.bar, ['#12AB34']);
  pi.byId('barColor').value = '#abcdef';
  pi.byId('barColor').fire('change');
  last = pi.palettes().at(-1);
  assert.deepEqual(last.bar, ['#12AB34', '#ABCDEF']);
  pi.byId('barColor').value = '#12ab34';
  pi.byId('barColor').fire('change');
  last = pi.palettes().at(-1);
  assert.deepEqual(last.bar, ['#12AB34', '#ABCDEF']);
  assert.equal(pi.byId('barColor').value, '#12ab34');
});

test(
  'accountList payload lists provider accounts with key counts',
  { timeout: 15000 },
  async () => {
    const org1 = '33333333-3333-4333-8333-333333333333';
    const org2 = '44444444-4444-4444-8444-444444444444';
    const id1 = 'anthropic-list0001';
    const id2 = 'anthropic-list0002';
    const accounts = {
      version: 1,
      accounts: [
        {
          id: id1,
          provider: 'anthropic',
          key: org1,
          nick: 'C1',
          name: 'Claude subscription 1',
          addedAt: 1
        },
        {
          id: id2,
          provider: 'anthropic',
          key: org2,
          nick: 'C2',
          name: 'Claude subscription 2',
          addedAt: 2
        }
      ]
    };
    const deck = await openDeck('ai-usage-list-', { accounts });
    await mkdir(path.join(deck.dir, 'claude-accounts'));
    await writeFile(
      path.join(deck.dir, 'claude-accounts', `${org1}.json`),
      JSON.stringify({
        observedAt: Date.now(),
        account: { org: org1, email: 'one@example.com' },
        rate_limits: {
          seven_day: {
            used_percentage: 21,
            resets_at: Date.now() / 1000 + 3600
          }
        }
      })
    );
    await writeFile(
      path.join(deck.dir, 'claude-accounts', `${org2}.json`),
      JSON.stringify({
        observedAt: Date.now() - 3600_000,
        account: { org: org2, name: 'Claude subscription 2' },
        rate_limits: {
          seven_day: {
            used_percentage: 64,
            resets_at: Date.now() / 1000 + 3600
          }
        }
      })
    );
    await writeFile(
      path.join(deck.dir, 'claude.json'),
      JSON.stringify({
        observedAt: Date.now(),
        account: { org: org1, email: 'one@example.com' },
        rate_limits: {
          seven_day: {
            used_percentage: 21,
            resets_at: Date.now() / 1000 + 3600
          }
        }
      })
    );
    try {
      await deck.waitFor((message) => message.event === 'registerPlugin');
      const claudeFile = path.join(deck.dir, 'claude.json');
      deck.send(
        appear('com.3foldlabs.ai-usage.anthropic-weekly', 'list-key', {
          account: id2,
          claudeFile
        })
      );
      await deck.waitFor(
        (message) =>
          message.event === 'setImage' && message.context === 'list-key'
      );
      deck.send(openPi('com.3foldlabs.ai-usage.anthropic-weekly', 'list-key'));
      deck.send({
        event: 'sendToPlugin',
        action: 'com.3foldlabs.ai-usage.anthropic-weekly',
        context: 'list-key',
        payload: { accounts: true }
      });
      const listed = await deck.waitFor(
        (message) =>
          message.event === 'sendToPropertyInspector' &&
          message.payload?.accountList
      );
      const list = listed.payload.accountList;
      assert.equal(list.provider, 'anthropic');
      assert.equal(list.canPin, true);
      assert.equal(list.canAdd, true);
      assert.equal(list.appManaged, false);
      assert.match(list.followLabel, /^Follow Claude/);
      assert.ok(Array.isArray(list.accounts));
      const pinned = list.accounts.find((account: any) => account.id === id2);
      assert.equal(pinned.nick, 'C2');
      assert.equal(pinned.name, 'Claude subscription 2');
      assert.equal(pinned.key, org2);
      assert.equal(pinned.keysSetTo, 1);
      assert.equal(typeof pinned.active, 'boolean');
      assert.ok('idleSince' in pinned);
    } finally {
      await deck.close();
    }
  }
);
