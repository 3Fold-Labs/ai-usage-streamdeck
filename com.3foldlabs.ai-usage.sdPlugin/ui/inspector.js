// Generated from src/inspector/. Do not edit directly.
"use strict";
(() => {
  // src/inspector/state.js
  var state = {
    socket: void 0,
    context: void 0,
    actionId: void 0,
    settings: {},
    pluginPalettes: { bar: [], key: [] },
    accountList: null,
    provider: null,
    returnFocus: null,
    sheetMode: null,
    editingId: null,
    pendingNickname: null
  };

  // src/inspector/lib.js
  var byId = (id) => document.getElementById(id);
  var esc = (s) => String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
  var SERVICE = {
    openai: "ChatGPT",
    anthropic: "Claude",
    grok: "Grok Bot",
    cursor: "Cursor",
    supergrok: "SuperGrok"
  };
  var APP = {
    openai: "Codex",
    anthropic: "Claude",
    grok: "Grok Bot",
    cursor: "Cursor",
    supergrok: "The Grok CLI"
  };
  var FOLDER = { openai: true, anthropic: true, supergrok: true };
  var BRAND = {
    openai: "#65DFBA",
    anthropic: "#E9AC8B",
    grok: "#D9E5F2",
    cursor: "#EDEDED",
    supergrok: "#8FA8FF"
  };
  var KEY_DEFAULT = "#11171D";
  var BAR_PRESETS = [
    "#65DFBA",
    "#E9AC8B",
    "#8FA8FF",
    "#D9E5F2",
    "#7ED4FF",
    "#B692F6",
    "#F3C16E",
    "#FF797D"
  ];
  var KEY_PRESETS = [
    "#11171D",
    "#000000",
    "#1E2A33",
    "#203040",
    "#2B2136",
    "#1B2E23",
    "#E9EDF0",
    "#FFFFFF"
  ];
  var CUSTOM_SLOTS = 8;
  var APP_MANAGED = {
    grok: "Grok Bot manages this account. Remove it inside Grok Bot and it disappears here.",
    cursor: "Cursor manages its sign-in. Sign out inside Cursor to remove it."
  };
  function providerOfAction() {
    if (state.actionId?.includes(".openai-")) return "openai";
    if (state.actionId?.includes(".grok-")) return "grok";
    if (state.actionId?.includes(".cursor-")) return "cursor";
    if (state.actionId?.includes(".supergrok-")) return "supergrok";
    return "anthropic";
  }
  function hex(value) {
    const text = String(value ?? "").trim();
    if (/^#[0-9a-fA-F]{3}$/.test(text))
      return ("#" + text.slice(1).split("").map((part) => part + part).join("")).toUpperCase();
    if (/^#[0-9a-fA-F]{8}$/.test(text)) return text.toUpperCase();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : "";
  }
  function splitColor(value) {
    const color = hex(value);
    if (!color) return { rgb: "", alpha: 1 };
    if (color.length === 9)
      return {
        rgb: color.slice(0, 7),
        alpha: parseInt(color.slice(7, 9), 16) / 255
      };
    return { rgb: color, alpha: 1 };
  }
  function joinColor(rgb, alpha) {
    const base = hex(rgb).slice(0, 7);
    if (!base) return "";
    if (alpha >= 0.995) return base;
    return base + Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0").toUpperCase();
  }
  function pickerValue(value, fallback) {
    return (hex(value) || hex(fallback) || KEY_DEFAULT).toLowerCase();
  }
  function hexToHsv(value) {
    const text = pickerValue(value, KEY_DEFAULT).slice(1);
    const r = parseInt(text.slice(0, 2), 16) / 255;
    const g = parseInt(text.slice(2, 4), 16) / 255;
    const b = parseInt(text.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: max ? d / max : 0, v: max };
  }
  function hsvToHex(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    };
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
    return ("#" + to(f(5)) + to(f(3)) + to(f(1))).toUpperCase();
  }
  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  // src/inspector/dialog.js
  function openSheet(html, focusSelector) {
    const sheet = byId("sheet");
    sheet.innerHTML = html;
    byId("backdrop").classList.add("open");
    byId("backdrop").setAttribute("aria-hidden", "false");
    const focus = focusSelector ? sheet.querySelector(focusSelector) : sheet.querySelector("button:not([disabled]), input, select");
    focus?.focus();
  }
  function closeSheet() {
    byId("backdrop").classList.remove("open");
    byId("backdrop").setAttribute("aria-hidden", "true");
    state.sheetMode = null;
    state.editingId = null;
    byId("sheet").innerHTML = "";
    if (state.returnFocus && document.body.contains(state.returnFocus))
      state.returnFocus.focus();
    state.returnFocus = null;
  }

  // src/inspector/transport.js
  var pending = [];
  var pendingSettings;
  function hasPendingSettings() {
    return pendingSettings !== void 0;
  }
  function send(payload) {
    const message = JSON.stringify({
      event: "sendToPlugin",
      action: state.actionId,
      context: state.context,
      payload
    });
    if (state.socket?.readyState === WebSocket.OPEN)
      state.socket.send(message);
    else pending.push(message);
  }
  function flushPending() {
    if (state.socket?.readyState !== WebSocket.OPEN) return;
    if (pendingSettings) {
      state.socket.send(pendingSettings);
      pendingSettings = void 0;
    }
    while (pending.length) state.socket.send(pending.shift());
  }
  function save() {
    const account = byId("account").disabled ? "follow" : byId("account").value;
    state.settings = {
      ...state.settings,
      account,
      ...state.provider === "cursor" ? {
        cursorPool: byId("cursorPool").value === "other-models" ? "other-models" : "cursor-models"
      } : {},
      grokConnected: byId("grokConnected").checked,
      cursorConnected: byId("cursorConnected").checked,
      superGrokConnected: byId("superGrokConnected").checked,
      superGrokAccount: byId("superGrokAccount").value.trim(),
      remaining: byId("display").value === "remaining",
      window: byId("window").value,
      codexPath: byId("codexPath").value.trim(),
      bucket: byId("bucket").value.trim(),
      claudeFile: byId("claudeFile").value.trim(),
      barColor: hex(state.settings.barColor) || state.settings.barColor || "",
      keyColor: hex(state.settings.keyColor) || state.settings.keyColor || ""
    };
    delete state.settings.layout;
    pendingSettings = JSON.stringify({
      event: "setSettings",
      context: state.context,
      payload: state.settings
    });
    flushPending();
    return !hasPendingSettings();
  }

  // src/inspector/colors.js
  function paintWells() {
    const bar = hex(state.settings.barColor) || barDefault();
    const key = hex(state.settings.keyColor) || KEY_DEFAULT;
    byId("barWell").style.background = bar.length === 9 ? `linear-gradient(${bar.slice(0, 7)}${bar.slice(7)}, ${bar.slice(0, 7)}${bar.slice(7)}), repeating-linear-gradient(45deg,#555 0 6px,#333 6px 12px)` : bar;
    byId("keyWell").style.background = key.length === 9 ? `linear-gradient(${key.slice(0, 7)}${key.slice(7)}, ${key.slice(0, 7)}${key.slice(7)}), repeating-linear-gradient(45deg,#555 0 6px,#333 6px 12px)` : key;
  }
  function openColorPicker(field) {
    const fallback = field === "barColor" ? barDefault() : KEY_DEFAULT;
    const start = hex(state.settings[field]) || hex(fallback) || KEY_DEFAULT;
    const parts = splitColor(start);
    const initialHsv = hexToHsv(parts.rgb);
    const title = field === "barColor" ? "Bar color" : "Key background";
    const state2 = {
      h: initialHsv.h,
      s: initialHsv.s,
      v: initialHsv.v,
      a: parts.alpha
    };
    openSheet(
      `
    <h2 id="sheetTitle">${title}</h2>
    <p>Starts on this key's current color, including opacity.</p>
    <div class="chart-row">
      <div class="sv" id="svChart"><div class="mark" id="svMark"></div></div>
      <div class="hue" id="hueStrip"><div class="hue-mark" id="hueMark"></div></div>
    </div>
    <div class="alpha-strip" id="alphaStrip"><div class="alpha-mark" id="alphaMark"></div></div>
    <div class="color-preview"><span id="colorPreview"></span></div>
    <label for="colorHex">Hex</label><input id="colorHex" class="plain" spellcheck="false" autocomplete="off">
    <div class="row">
      <button class="primary" type="button" id="applyColor">Use this color</button>
      <button type="button" id="addCustomColor">Add to custom colors</button>
      <button type="button" id="closeSheet">Cancel</button>
    </div>`,
      "#svChart"
    );
    const sv = byId("svChart");
    const hue = byId("hueStrip");
    const alpha = byId("alphaStrip");
    const current = () => joinColor(hsvToHex(state2.h, state2.s, state2.v), state2.a);
    const live = () => {
      const color = current();
      const rgb = hsvToHex(state2.h, state2.s, state2.v);
      sv.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hsvToHex(state2.h, 1, 1)})`;
      alpha.style.backgroundImage = `linear-gradient(to right,${rgb}00,${rgb}ff),linear-gradient(45deg,#555 25%,transparent 25%),linear-gradient(-45deg,#555 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#555 75%),linear-gradient(-45deg,transparent 75%,#555 75%)`;
      alpha.style.backgroundSize = "auto,10px 10px,10px 10px,10px 10px,10px 10px";
      byId("svMark").style.left = `${state2.s * 100}%`;
      byId("svMark").style.top = `${(1 - state2.v) * 100}%`;
      byId("hueMark").style.top = `${state2.h / 360 * 100}%`;
      byId("alphaMark").style.left = `${state2.a * 100}%`;
      byId("colorPreview").style.background = rgb;
      byId("colorPreview").style.opacity = String(state2.a);
      byId("colorHex").value = color;
      return color;
    };
    const pickSv = (event) => {
      const box = sv.getBoundingClientRect();
      state2.s = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      state2.v = 1 - Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
      live();
    };
    const pickHue = (event) => {
      const box = hue.getBoundingClientRect();
      state2.h = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) * 360;
      live();
    };
    const pickAlpha = (event) => {
      const box = alpha.getBoundingClientRect();
      state2.a = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      live();
    };
    const drag = (el, fn) => {
      el.addEventListener("pointerdown", (event) => {
        el.setPointerCapture(event.pointerId);
        fn(event);
      });
      el.addEventListener("pointermove", (event) => {
        if (event.buttons) fn(event);
      });
    };
    drag(sv, pickSv);
    drag(hue, pickHue);
    drag(alpha, pickAlpha);
    byId("colorHex").addEventListener("change", () => {
      const color = hex(byId("colorHex").value);
      if (!color) return;
      const next = splitColor(color);
      const hsv = hexToHsv(next.rgb);
      state2.h = hsv.h;
      state2.s = hsv.s;
      state2.v = hsv.v;
      state2.a = next.alpha;
      live();
    });
    byId("applyColor").addEventListener("click", () => {
      const color = live();
      byId(field).value = color;
      saveColors({ keepCustom: field });
      closeSheet();
    });
    byId("addCustomColor").addEventListener("click", () => {
      const color = live();
      const before = readCustoms(field).length;
      addCustom(field, color);
      const after = readCustoms(field).length;
      save();
      paintSwatches();
      byId("status").textContent = after > before ? `Saved ${color} in the next empty custom slot.` : after >= CUSTOM_SLOTS ? "Custom colors are full. That slot was not overwritten." : `${color} is already in the list.`;
    });
    byId("closeSheet").addEventListener("click", closeSheet);
    live();
  }
  var barDefault = () => BRAND[state.provider] || KEY_DEFAULT;
  function readCustoms(field) {
    const raw = field === "barColor" ? state.pluginPalettes.bar : state.pluginPalettes.key;
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? String(raw).split(/[\s,]+/) : [];
    const seen = /* @__PURE__ */ new Set();
    const next = [];
    for (const item of list) {
      const color = hex(item);
      if (!color || seen.has(color)) continue;
      seen.add(color);
      next.push(color);
      if (next.length >= CUSTOM_SLOTS) break;
    }
    return next;
  }
  function addCustom(field, color) {
    const next = hex(color);
    if (!next) return;
    const presets = field === "barColor" ? BAR_PRESETS : KEY_PRESETS;
    if (presets.includes(next)) return;
    const customs = readCustoms(field);
    if (customs.includes(next) || customs.length >= CUSTOM_SLOTS) return;
    customs.push(next);
    if (field === "barColor") state.pluginPalettes.bar = customs;
    else state.pluginPalettes.key = customs;
    send({
      palettes: {
        bar: state.pluginPalettes.bar,
        key: state.pluginPalettes.key
      }
    });
  }
  function bindSwatches(id, field, tiles, current) {
    byId(id).innerHTML = tiles.map((tile) => {
      const selected = !tile.empty && tile.color === current ? " selected" : "";
      const empty = tile.empty ? " empty" : "";
      const bg = tile.empty ? "" : `background:${tile.color};`;
      const label = tile.empty ? "Empty custom color" : tile.color;
      return `<button type="button" class="${(empty + selected).trim()}" data-field="${field}" data-color="${tile.color}" title="${label}" aria-label="${label}" style="${bg}"></button>`;
    }).join("");
    byId(id).querySelectorAll("button").forEach(
      (button) => button.addEventListener("click", () => {
        const fieldName = button.getAttribute("data-field");
        const color = hex(button.getAttribute("data-color"));
        if (!color) {
          openColorPicker(fieldName);
          return;
        }
        byId(fieldName).value = pickerValue(color);
        saveColors();
      })
    );
  }
  function paintSwatches() {
    const current = {
      barColor: hex(state.settings.barColor) || barDefault(),
      keyColor: hex(state.settings.keyColor) || KEY_DEFAULT
    };
    bindSwatches(
      "barPresets",
      "barColor",
      BAR_PRESETS.map((color) => ({ color, empty: false })),
      current.barColor
    );
    bindSwatches(
      "keyPresets",
      "keyColor",
      KEY_PRESETS.map((color) => ({ color, empty: false })),
      current.keyColor
    );
    bindSwatches(
      "barSwatches",
      "barColor",
      Array.from({ length: CUSTOM_SLOTS }, (_, i) => {
        const color = readCustoms("barColor")[i] || "";
        return { color, empty: !color };
      }),
      current.barColor
    );
    bindSwatches(
      "keySwatches",
      "keyColor",
      Array.from({ length: CUSTOM_SLOTS }, (_, i) => {
        const color = readCustoms("keyColor")[i] || "";
        return { color, empty: !color };
      }),
      current.keyColor
    );
  }
  function saveColors(opts = {}) {
    state.settings.barColor = hex(byId("barColor").value);
    state.settings.keyColor = hex(byId("keyColor").value);
    if (opts.keepCustom === "barColor")
      addCustom("barColor", state.settings.barColor);
    if (opts.keepCustom === "keyColor")
      addCustom("keyColor", state.settings.keyColor);
    save();
    paintWells();
    paintSwatches();
    byId("status").textContent = "Key colors saved.";
  }
  function resetColors() {
    state.settings.barColor = "";
    state.settings.keyColor = "";
    byId("barColor").value = pickerValue("", barDefault());
    byId("keyColor").value = pickerValue("", KEY_DEFAULT);
    save();
    paintWells();
    paintSwatches();
    byId("status").textContent = "Key colors reset to the defaults.";
  }

  // src/inspector/accounts.js
  function shownAccount() {
    if (!state.accountList) return null;
    const selected = state.settings.account && state.settings.account !== "follow" ? state.settings.account : null;
    if (selected)
      return state.accountList.accounts.find(
        (account) => account.id === selected
      ) || null;
    if (state.accountList.activeKey)
      return state.accountList.accounts.find(
        (account) => account.key.toLowerCase() === String(state.accountList.activeKey).toLowerCase()
      ) || null;
    return state.accountList.accounts[0] || null;
  }
  function stateLine(account) {
    const app = APP[state.provider] || "app";
    if (account.active) return `Signed in to ${app} now.`;
    if (account.idleSince) {
      try {
        return `Idle since ${new Date(account.idleSince).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
      } catch {
        return "Idle.";
      }
    }
    return state.provider === "anthropic" ? "Idle." : "Live.";
  }
  function populateAccounts() {
    const select = byId("account");
    const help = byId("accountHelp");
    const manage = byId("manage");
    const add = byId("addAccount");
    const label = SERVICE[state.provider] || "accounts";
    manage.textContent = `Manage ${label} accounts`;
    add.textContent = `Add ${label} account`;
    add.hidden = !state.accountList?.canAdd;
    if (!state.accountList) {
      select.replaceChildren(new Option("Follow app", "follow"));
      select.disabled = state.provider === "cursor";
      help.textContent = state.provider === "cursor" ? "Cursor keeps one account at a time, so this key always follows the Cursor app." : "Follow changes with the app. Picking an account keeps this key on it.";
      return;
    }
    select.replaceChildren();
    select.appendChild(
      new Option(
        state.accountList.followLabel || `Follow ${APP[state.provider]}`,
        "follow"
      )
    );
    for (const account of state.accountList.accounts)
      select.appendChild(
        new Option(
          account.nick ? `${account.nick} \xB7 ${account.name}` : account.name,
          account.id
        )
      );
    const canPin = state.accountList.canPin !== false && state.provider !== "cursor";
    select.disabled = !canPin;
    select.value = canPin && state.settings.account && state.settings.account !== "follow" && state.accountList.accounts.some(
      (account) => account.id === state.settings.account
    ) ? state.settings.account : "follow";
    help.textContent = canPin ? `Follow changes with ${APP[state.provider]}. Picking an account keeps this key on it.` : state.provider === "cursor" ? "Cursor keeps one account at a time, so this key always follows the Cursor app." : "This connection follows the signed-in account.";
    const shown = shownAccount();
    if (document.activeElement !== byId("nick"))
      byId("nick").value = shown?.nick ?? state.settings.nickname ?? "";
    byId("nick").disabled = false;
    byId("nickHelp").textContent = shown ? "Up to 5 letters or numbers. Leave blank to hide. Shared by keys showing this account. Press Save or Enter." : "Up to 5 letters or numbers. Leave blank to hide. Saved on this key until an account is connected. Press Save or Enter.";
  }
  function saveNick() {
    const nick = byId("nick").value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    byId("nick").value = nick;
    const shown = shownAccount();
    if (shown) {
      state.pendingNickname = { id: shown.id, nick };
      send({ rename: { id: shown.id, nick, name: shown.name } });
      byId("status").textContent = "Saving account nickname\u2026";
      return;
    }
    state.settings.nickname = nick;
    const sent = save();
    byId("status").textContent = !sent ? "Waiting for the plugin connection to save this nickname\u2026" : nick ? `Nickname ${nick} saved on this key.` : "Nickname cleared on this key.";
  }
  function manageList() {
    if (!state.accountList) return;
    state.sheetMode = "list";
    const label = SERVICE[state.provider] || "accounts";
    const rows = state.accountList.accounts.map((account) => {
      const n = account.keysSetTo || 0;
      return `<div class="acct-row"><span class="nk">${esc(account.nick)}</span><span><b>${esc(account.name)}</b><small>${esc(stateLine(account))}${n ? " " + plural(n, "key") + " set to it." : ""}</small></span><button class="btn" type="button" data-edit="${esc(account.id)}">Edit</button></div>`;
    }).join("");
    openSheet(
      `
    <h2 id="sheetTitle">${esc(label)} accounts</h2>
    <p>Nicknames show on the keys. ${state.accountList.canAdd ? "Add as many as you use." : state.provider === "cursor" ? "Cursor keeps one account at a time, but each one can still have its own nickname." : "Accounts available from this connection."}</p>
    <div class="acct-list">${rows || '<p class="help">No accounts yet.</p>'}</div>
    <div class="row">
      ${state.accountList.canAdd ? `<button class="primary" type="button" id="manageAdd">Add ${esc(label)} account</button>` : ""}
      <button type="button" id="closeSheet">Close</button>
    </div>`,
      state.accountList.accounts.length ? "[data-edit]" : "#closeSheet"
    );
    byId("sheet").querySelectorAll("[data-edit]").forEach(
      (button) => button.addEventListener(
        "click",
        () => manageEdit(button.getAttribute("data-edit"))
      )
    );
    byId("manageAdd")?.addEventListener("click", () => {
      closeSheet();
      send({ addAccount: true });
    });
    byId("closeSheet").addEventListener("click", closeSheet);
  }
  function manageEdit(id) {
    const account = state.accountList?.accounts.find(
      (entry) => entry.id === id
    );
    if (!account) return manageList();
    state.sheetMode = "edit";
    state.editingId = id;
    const label = SERVICE[state.provider] || "accounts";
    const app = APP[state.provider] || "app";
    const blocked = APP_MANAGED[state.provider] || (account.active ? `${app} is signed into this account right now. Switch it to another account first.` : "");
    const n = account.keysSetTo || 0;
    const where = `${stateLine(account)} ${n ? plural(n, "key") + " set to it; follow keys show it whenever " + app + " is signed into it." : "No keys are set to it; follow keys show it whenever " + app + " is signed into it."}`;
    openSheet(
      `
    <h2 id="sheetTitle">Edit ${esc(account.nick || account.name)}</h2>
    <p>Sign-in: ${esc(account.name)}</p>
    <div class="fields">
      <div><label for="editNick">Nickname on key</label><input id="editNick" type="text" maxlength="5" value="${esc(account.nick)}" spellcheck="false" autocomplete="off"><div class="help">Up to 5 characters. Leave blank to hide.</div></div>
      <div><label for="editName">Name</label><input id="editName" class="plain" type="text" maxlength="40" value="${esc(account.name)}" autocomplete="off"><div class="help">Shown in account lists and settings.</div></div>
    </div>
    <div class="row"><button class="primary" type="button" id="saveEdit">Save changes</button><button type="button" id="backBtn">Back to ${esc(label)} accounts</button></div>
    <section class="usage-note"><h3>Where it is used</h3><p>${esc(where)}</p></section>
    <section class="dz" aria-labelledby="dz">
      <h3 id="dz">Danger zone</h3>
      <p>${blocked ? esc(blocked) : `Removing forgets this account on the deck${FOLDER[state.provider] ? " and signs out its separate sign-in folder" : ""}. Keys set to it go back to following ${esc(app)}.`}</p>
      <button class="danger" type="button" id="removeBtn" ${blocked ? "disabled" : ""}>Remove ${esc(account.nick || account.name)}</button>
    </section>`,
      "#editNick"
    );
    byId("saveEdit").addEventListener("click", () => {
      send({
        rename: { id, nick: byId("editNick").value, name: byId("editName").value }
      });
    });
    byId("backBtn").addEventListener("click", manageList);
    if (!blocked)
      byId("removeBtn").addEventListener("click", () => manageConfirm(id));
  }
  function manageConfirm(id) {
    const account = state.accountList?.accounts.find(
      (entry) => entry.id === id
    );
    if (!account) return manageList();
    state.sheetMode = "confirm";
    state.editingId = id;
    const app = APP[state.provider] || "app";
    const n = account.keysSetTo || 0;
    openSheet(
      `
    <h2 id="sheetTitle">Remove ${esc(account.nick || account.name)}?</h2>
    <p>The deck forgets ${esc(account.name)}${FOLDER[state.provider] ? " and signs out its separate sign-in folder" : ""}. ${n ? plural(n, "key") + " set to it will follow " + esc(app) + " instead." : "No keys are set to it."} ${esc(app)} itself is not changed.</p>
    <div class="row"><button type="button" id="keepBtn">Keep ${esc(account.nick || account.name)}</button><button class="danger solid" type="button" id="confirmRemove">Remove ${esc(account.nick || account.name)}</button></div>`,
      "#keepBtn"
    );
    byId("keepBtn").addEventListener("click", () => manageEdit(id));
    byId("confirmRemove").addEventListener(
      "click",
      () => send({ remove: { id } })
    );
  }
  function showSignIn(data) {
    state.sheetMode = "signIn";
    if (data.kind === "code") {
      const title = state.provider === "supergrok" ? "Add a SuperGrok account" : state.provider === "openai" ? "Add a ChatGPT account" : state.provider === "anthropic" ? "Add a Claude account" : "Sign in";
      openSheet(
        `
      <h2 id="sheetTitle">${title}</h2>
      <p>${data.code && data.code !== "OPEN" ? state.provider === "supergrok" ? "<strong>Finish signing in on the xAI page.</strong> The code should already be filled in. Check that it matches the code below, click Continue, and approve the sign-in. If the browser asks for a code, enter the one below there." : "<strong>Enter this code in your browser</strong> (not in this panel). The sign-in page should open automatically." : "<strong>Complete sign-in in the browser window</strong> that just opened (or tap Open sign-in page). This panel has no code field on purpose."}</p>
      ${data.code && data.code !== "OPEN" ? `<div class="code" id="signInCode">${esc(data.code)}</div>` : ""}
      <p class="help" style="margin-top:-8px">Keep this panel open while you approve the sign-in in your browser. There is nothing to paste into Stream Deck. This sheet closes automatically when the provider confirms the sign-in.</p>
      <div class="row">
        <button class="primary" type="button" id="openSignIn">Open sign-in page</button>
        ${data.code && data.code !== "OPEN" ? '<button type="button" id="copyCode">Copy code</button>' : ""}
        <button type="button" id="cancelSignIn">Cancel</button>
      </div>`,
        "#openSignIn"
      );
      const openPage = () => {
        if (data.url) send({ openUrl: data.url });
      };
      byId("openSignIn").addEventListener("click", openPage);
      byId("copyCode")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(String(data.code || ""));
          byId("copyCode").textContent = "Copied";
        } catch {
          byId("copyCode").textContent = "Select code above";
        }
      });
      byId("cancelSignIn").addEventListener("click", () => {
        send({ cancelSignIn: true });
        closeSheet();
      });
      openPage();
      return;
    }
    if (data.kind === "app") {
      openSheet(
        `
      <h2 id="sheetTitle">Add a Grok Bot account</h2>
      <p>${esc(data.message || "")}</p>
      <ol class="steps" style="margin:0 0 12px;padding-left:18px;color:var(--ink,#e9edf0)">
        <li>Tap Open Grok Bot.</li>
        <li>Add or switch the account inside Grok Bot.</li>
        <li>This list updates when the new account appears. Tap Scan again if it does not.</li>
      </ol>
      <div class="row">
        <button class="primary" type="button" id="openApp">Open Grok Bot</button>
        <button type="button" id="scanAgain">Scan again</button>
        <button type="button" id="closeSheet">Close</button>
      </div>`,
        "#openApp"
      );
      byId("openApp").addEventListener("click", () => send({ openApp: true }));
      byId("scanAgain").addEventListener(
        "click",
        () => send({ addAccount: true })
      );
      byId("closeSheet").addEventListener("click", closeSheet);
      return;
    }
    const claude = state.provider === "anthropic";
    openSheet(
      `
    <h2 id="sheetTitle">${claude ? "Add a Claude account" : "Add account"}</h2>
    <p>${esc(data.message || "")}</p>
    ${claude ? `<ol class="steps" style="margin:0 0 12px;padding-left:18px;color:var(--ink,#e9edf0)">
      <li>In Claude Desktop or Claude Code, switch to the other subscription.</li>
      <li>Use it once (open Settings \u2192 Usage in Desktop, or send a short message in Code).</li>
      <li>Come back here and tap Scan again.</li>
    </ol>` : ""}
    <div class="row">
      <button class="primary" type="button" id="scanAgain">Scan again</button>
      <button type="button" id="closeSheet">Close</button>
    </div>`,
      "#scanAgain"
    );
    byId("scanAgain").addEventListener("click", () => send({ addAccount: true }));
    byId("closeSheet").addEventListener("click", closeSheet);
  }

  // src/inspector/main.js
  function populate() {
    byId("toggleConnection").textContent = state.settings.disconnected ? "Reconnect this button" : "Disconnect this button";
    byId("grokConnected").checked = state.settings.grokConnected === true;
    byId("cursorConnected").checked = state.settings.cursorConnected === true;
    byId("superGrokConnected").checked = state.settings.superGrokConnected === true;
    byId("cursorPool").value = state.settings.cursorPool === "other-models" ? "other-models" : "cursor-models";
    byId("display").value = state.settings.remaining ? "remaining" : "used";
    byId("window").value = state.settings.window || (state.actionId?.endsWith("-weekly") ? "weekly" : state.actionId?.endsWith("-monthly") ? "monthly" : "auto");
    if (document.activeElement !== byId("nick"))
      byId("nick").value = state.settings.nickname || "";
    for (const key of ["codexPath", "bucket", "claudeFile", "superGrokAccount"])
      byId(key).value = state.settings[key] || "";
    if (document.activeElement !== byId("barColor"))
      byId("barColor").value = pickerValue(
        state.settings.barColor,
        barDefault()
      );
    if (document.activeElement !== byId("keyColor"))
      byId("keyColor").value = pickerValue(
        state.settings.keyColor,
        KEY_DEFAULT
      );
    populateAccounts();
    paintWells();
    paintSwatches();
  }
  window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
    const action = JSON.parse(actionInfo);
    state.context = uuid;
    state.actionId = action.action;
    state.settings = action.payload.settings || {};
    state.provider = providerOfAction();
    const openai = state.provider === "openai";
    const grok = state.provider === "grok";
    const cursor = state.provider === "cursor";
    const supergrok = state.provider === "supergrok";
    byId("cursorPoolRow").hidden = !cursor;
    byId("name").textContent = openai ? "ChatGPT Usage" : grok ? "Grok Bot Usage" : cursor ? "Cursor Usage" : supergrok ? "SuperGrok Usage" : "Claude Usage";
    byId("allowance").textContent = openai ? "Subscription allowance: Codex included with ChatGPT. General ChatGPT message limits are not reported by this connection." : grok ? "Subscription allowance: Grok Bot weekly usage." : cursor ? "Plan allowance: choose Cursor Models or Other Models for the current billing cycle." : supergrok ? "Subscription allowance: SuperGrok shared weekly pool. Chat, Imagine, Voice, Build and the Grok CLI all draw from it. This is not the Grok Bot allowance or API billing." : "Subscription allowance: Claude usage.";
    byId("openai").hidden = !openai;
    byId("anthropic").hidden = openai || grok || cursor || supergrok;
    byId("grok").hidden = !grok;
    byId("cursor").hidden = !cursor;
    byId("supergrok").hidden = !supergrok;
    if (grok || supergrok) {
      byId("window").querySelector('option[value="short"]').remove();
      state.settings.window = "weekly";
    }
    if (cursor) {
      byId("window").replaceChildren(new Option("Billing cycle", "monthly"));
      state.settings.window = "monthly";
    }
    paintSwatches();
    populate();
    state.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    state.socket.onopen = () => {
      state.socket.send(JSON.stringify({ event: registerEvent, uuid }));
      flushPending();
      send({ refresh: true });
      send({ accounts: true });
    };
    state.socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.event === "didReceiveSettings") {
        if (hasPendingSettings()) return;
        state.settings = message.payload.settings || {};
        populate();
      }
      if (message.event !== "sendToPropertyInspector") return;
      const data = message.payload;
      if (data.setup) {
        byId("setup").textContent = data.setup;
        byId("connectClaude").disabled = false;
        if (data.claudeConnectedFile) {
          state.settings.claudeFile = data.claudeConnectedFile;
          populate();
        }
        return;
      }
      if (data.palettes) {
        state.pluginPalettes = {
          bar: Array.isArray(data.palettes.bar) ? data.palettes.bar : [],
          key: Array.isArray(data.palettes.key) ? data.palettes.key : []
        };
        paintSwatches();
        if (data.paletteError) byId("status").textContent = data.paletteError;
        return;
      }
      if (data.accountList) {
        state.accountList = data.accountList;
        state.provider = data.accountList.provider || state.provider;
        populateAccounts();
        if (state.pendingNickname && state.accountList.accounts.some(
          (account) => account.id === state.pendingNickname.id && account.nick === state.pendingNickname.nick
        )) {
          byId("status").textContent = state.pendingNickname.nick ? `Nickname ${state.pendingNickname.nick} saved for this account.` : "Nickname hidden for this account.";
          state.pendingNickname = null;
        }
        if (state.sheetMode === "list") manageList();
        else if (state.sheetMode === "edit" && state.editingId) {
          if (state.accountList.accounts.some(
            (account) => account.id === state.editingId
          ))
            manageEdit(state.editingId);
          else manageList();
        } else if (state.sheetMode === "confirm" && state.editingId) {
          if (state.accountList.accounts.some(
            (account) => account.id === state.editingId
          ))
            manageList();
          else manageList();
        }
        return;
      }
      if (data.working) {
        byId("status").textContent = data.working;
        return;
      }
      if (data.signIn) {
        byId("addAccount").disabled = false;
        showSignIn(data.signIn);
        return;
      }
      if (data.signInDone) {
        byId("addAccount").disabled = false;
        closeSheet();
        send({ accounts: true });
        byId("status").textContent = `Added ${data.signInDone.nick} (${data.signInDone.name}).`;
        return;
      }
      if (data.signInFailed) {
        byId("addAccount").disabled = false;
        closeSheet();
        byId("status").textContent = data.signInFailed;
        return;
      }
      if (data.accountError) {
        state.pendingNickname = null;
        byId("addAccount").disabled = false;
        byId("status").textContent = data.accountError;
        return;
      }
      const shortOption = byId("window").querySelector('option[value="short"]');
      if (shortOption) {
        const minutes = data.shortWindowMinutes;
        shortOption.textContent = typeof minutes === "number" && minutes > 0 ? minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute` : "5-hour";
      }
      byId("status").textContent = data.status;
      byId("status").classList.toggle(
        "idle",
        /idle|stale|Last known reading/i.test(String(data.status || ""))
      );
      byId("defaultFile").textContent = data.claudeFile;
      byId("details").textContent = [
        data.source || "",
        typeof data.used === "number" ? `${data.window}: ${data.used}% used` : "",
        Array.isArray(data.breakdown) && data.breakdown.length ? `${state.provider === "cursor" ? "Usage pools" : "By product"}: ${data.breakdown.map((item) => `${item.label} ${item.used}%`).join(" \xB7 ")}` : "",
        data.resetsAt ? `Resets: ${new Date(data.resetsAt * 1e3).toLocaleString()}` : data.resetHelp || "",
        data.observedAt ? `Last reading: ${new Date(data.observedAt).toLocaleString()}` : ""
      ].filter(Boolean).join("\n");
    };
    state.socket.onclose = () => {
      closeSheet();
      for (const control of document.querySelectorAll("input, select, button"))
        control.disabled = true;
      byId("status").textContent = "Plugin disconnected. Editing is disabled. Select the button again to reconnect.";
    };
  };
  for (const key of [
    "display",
    "window",
    "cursorPool",
    "codexPath",
    "bucket",
    "claudeFile",
    "grokConnected",
    "cursorConnected",
    "superGrokConnected",
    "superGrokAccount",
    "account"
  ]) {
    byId(key).addEventListener("change", () => {
      save();
      if (key === "account") populateAccounts();
    });
  }
  byId("barWell").addEventListener("click", () => {
    openColorPicker("barColor");
  });
  byId("keyWell").addEventListener("click", () => {
    openColorPicker("keyColor");
  });
  for (const key of ["barColor", "keyColor"]) {
    byId(key).addEventListener("change", () => saveColors({ keepCustom: key }));
  }
  byId("resetColors").addEventListener("click", resetColors);
  byId("nick").addEventListener("change", saveNick);
  byId("nick").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveNick();
    }
  });
  byId("saveNick").addEventListener("click", saveNick);
  byId("toggleConnection").addEventListener("click", () => {
    state.settings.disconnected = !state.settings.disconnected;
    populate();
    save();
  });
  byId("refresh").addEventListener("click", () => send({ refresh: true }));
  byId("connectClaude").addEventListener("click", () => {
    byId("connectClaude").disabled = true;
    send({ connectClaude: true });
  });
  byId("manage").addEventListener("click", (event) => {
    state.returnFocus = event.currentTarget;
    if (!state.accountList) send({ accounts: true });
    manageList();
  });
  byId("addAccount").addEventListener("click", (event) => {
    state.returnFocus = event.currentTarget;
    byId("status").textContent = "Starting sign-in\u2026";
    byId("addAccount").disabled = true;
    send({ addAccount: true });
    setTimeout(() => {
      byId("addAccount").disabled = false;
    }, 25e3);
  });
  byId("backdrop").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSheet();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && byId("backdrop").classList.contains("open")) {
      if (state.sheetMode === "signIn") send({ cancelSignIn: true });
      closeSheet();
    }
    if (event.key === "Tab" && byId("backdrop").classList.contains("open")) {
      const focusable = [
        ...byId("sheet").querySelectorAll("button:not([disabled]), input, select")
      ];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
})();
