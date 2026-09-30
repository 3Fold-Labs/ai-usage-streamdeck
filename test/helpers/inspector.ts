import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
const root = process.cwd();
const pluginInfo = {
  application: { language: 'en', platform: 'windows', version: '7.1.0' }
};
export async function openInspector(
  action: string,
  settings: object = {},
  options: { deferOpen?: boolean } = {}
) {
  const sent: string[] = [];
  let activeSocket: any;
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
    querySelector(selector: string) {
      return selector === 'option[value="short"]' ? byId('short-option') : null;
    }
    querySelectorAll(selector: string) {
      if (selector !== '[data-edit]') return [];
      return [...this.innerHTML.matchAll(/data-edit="([^"]+)"/g)].map(
        (match) => {
          const button = byId('edit-' + match[1]);
          button.getAttribute = (name: string) =>
            name === 'data-edit' ? match[1] : null;
          return button;
        }
      );
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
  const html = await readFile(
    path.join(
      process.env.AI_USAGE_TEST_PACKAGE_ROOT || root,
      'com.3foldlabs.ai-usage.sdPlugin/ui/inspector.html'
    ),
    'utf8'
  );
  const controlIds = [
    ...html.matchAll(/<(?:input|select|button)\b[^>]*\bid="([^"]+)"/g)
  ].map((m) => m[1]);
  const document = {
    activeElement: null,
    body: { contains: () => false },
    getElementById: byId,
    createElement: () => new El('created'),
    addEventListener() {},
    querySelectorAll: (selector: string) =>
      selector === 'input, select, button' ? controlIds.map(byId) : []
  };
  class Socket {
    static OPEN = 1;
    readyState = options.deferOpen ? 0 : 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(public url: string) {
      activeSocket = this;
      if (!options.deferOpen) queueMicrotask(() => this.onopen?.());
    }
    send(message: string) {
      if (this.readyState !== 1) throw new Error('Socket is not open');
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
        'com.3foldlabs.ai-usage' + '.sdPlugin/ui/inspector.js'
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
    JSON.stringify({ action, payload: { settings } })
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
  return {
    byId,
    saved,
    palettes,
    connect: () => {
      activeSocket.readyState = 1;
      activeSocket.onopen();
    },
    disconnect: () => {
      activeSocket.readyState = 3;
      activeSocket.onclose();
    },
    receiveSettings: (settings: object) =>
      activeSocket.onmessage({
        data: JSON.stringify({
          event: 'didReceiveSettings',
          payload: { settings }
        })
      }),
    sent: () => sent.map((m) => JSON.parse(m)),
    receive: (payload: object) =>
      activeSocket.onmessage({
        data: JSON.stringify({ event: 'sendToPropertyInspector', payload })
      })
  };
}
