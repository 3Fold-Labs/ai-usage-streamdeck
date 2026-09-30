import { state as appState } from './state.js';
import { APP, byId, SERVICE, esc, plural, APP_MANAGED, FOLDER } from './lib.js';
import { send, save } from './transport.js';
import { openSheet, closeSheet } from './dialog.js';

function shownAccount() {
  if (!appState.accountList) return null;
  const selected =
    appState.settings.account && appState.settings.account !== 'follow'
      ? appState.settings.account
      : null;
  if (selected)
    return (
      appState.accountList.accounts.find(
        (account) => account.id === selected
      ) || null
    );
  if (appState.accountList.activeKey)
    return (
      appState.accountList.accounts.find(
        (account) =>
          account.key.toLowerCase() ===
          String(appState.accountList.activeKey).toLowerCase()
      ) || null
    );
  return appState.accountList.accounts[0] || null;
}

function stateLine(account) {
  const app = APP[appState.provider] || 'app';
  if (account.active) return `Signed in to ${app} now.`;
  if (account.idleSince) {
    try {
      return `Idle since ${new Date(account.idleSince).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
    } catch {
      return 'Idle.';
    }
  }
  return appState.provider === 'anthropic' ? 'Idle.' : 'Live.';
}

export function populateAccounts() {
  const select = byId('account');
  const help = byId('accountHelp');
  const manage = byId('manage');
  const add = byId('addAccount');
  const label = SERVICE[appState.provider] || 'accounts';
  manage.textContent = `Manage ${label} accounts`;
  add.textContent = `Add ${label} account`;
  add.hidden = !appState.accountList?.canAdd;
  if (!appState.accountList) {
    select.replaceChildren(new Option('Follow app', 'follow'));
    select.disabled = appState.provider === 'cursor';
    help.textContent =
      appState.provider === 'cursor'
        ? 'Cursor keeps one account at a time, so this key always follows the Cursor app.'
        : 'Follow changes with the app. Picking an account keeps this key on it.';
    return;
  }
  select.replaceChildren();
  select.appendChild(
    new Option(
      appState.accountList.followLabel || `Follow ${APP[appState.provider]}`,
      'follow'
    )
  );
  for (const account of appState.accountList.accounts)
    select.appendChild(
      new Option(
        account.nick ? `${account.nick} · ${account.name}` : account.name,
        account.id
      )
    );
  const canPin =
    appState.accountList.canPin !== false && appState.provider !== 'cursor';
  select.disabled = !canPin;
  select.value =
    canPin &&
    appState.settings.account &&
    appState.settings.account !== 'follow' &&
    appState.accountList.accounts.some(
      (account) => account.id === appState.settings.account
    )
      ? appState.settings.account
      : 'follow';
  help.textContent = canPin
    ? `Follow changes with ${APP[appState.provider]}. Picking an account keeps this key on it.`
    : appState.provider === 'cursor'
      ? 'Cursor keeps one account at a time, so this key always follows the Cursor app.'
      : 'This connection follows the signed-in account.';
  const shown = shownAccount();
  if (document.activeElement !== byId('nick'))
    byId('nick').value = shown?.nick ?? appState.settings.nickname ?? '';
  byId('nick').disabled = false;
  byId('nickHelp').textContent = shown
    ? 'Up to 5 letters or numbers. Leave blank to hide. Shared by keys showing this account. Press Save or Enter.'
    : 'Up to 5 letters or numbers. Leave blank to hide. Saved on this key until an account is connected. Press Save or Enter.';
}

export function saveNick() {
  const nick = byId('nick')
    .value.toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
  byId('nick').value = nick;
  const shown = shownAccount();
  if (shown) {
    appState.pendingNickname = { id: shown.id, nick };
    send({ rename: { id: shown.id, nick, name: shown.name } });
    byId('status').textContent = 'Saving account nickname…';
    return;
  }
  appState.settings.nickname = nick;
  const sent = save();
  byId('status').textContent = !sent
    ? 'Waiting for the plugin connection to save this nickname…'
    : nick
      ? `Nickname ${nick} saved on this key.`
      : 'Nickname cleared on this key.';
}

export function manageList() {
  if (!appState.accountList) return;
  appState.sheetMode = 'list';
  const label = SERVICE[appState.provider] || 'accounts';
  const rows = appState.accountList.accounts
    .map((account) => {
      const n = account.keysSetTo || 0;
      return `<div class="acct-row"><span class="nk">${esc(account.nick)}</span><span><b>${esc(account.name)}</b><small>${esc(stateLine(account))}${n ? ' ' + plural(n, 'key') + ' set to it.' : ''}</small></span><button class="btn" type="button" data-edit="${esc(account.id)}">Edit</button></div>`;
    })
    .join('');
  openSheet(
    `
    <h2 id="sheetTitle">${esc(label)} accounts</h2>
    <p>Nicknames show on the keys. ${appState.accountList.canAdd ? 'Add as many as you use.' : appState.provider === 'cursor' ? 'Cursor keeps one account at a time, but each one can still have its own nickname.' : 'Accounts available from this connection.'}</p>
    <div class="acct-list">${rows || '<p class="help">No accounts yet.</p>'}</div>
    <div class="row">
      ${appState.accountList.canAdd ? `<button class="primary" type="button" id="manageAdd">Add ${esc(label)} account</button>` : ''}
      <button type="button" id="closeSheet">Close</button>
    </div>`,
    appState.accountList.accounts.length ? '[data-edit]' : '#closeSheet'
  );
  byId('sheet')
    .querySelectorAll('[data-edit]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        manageEdit(button.getAttribute('data-edit'))
      )
    );
  byId('manageAdd')?.addEventListener('click', () => {
    closeSheet();
    send({ addAccount: true });
  });
  byId('closeSheet').addEventListener('click', closeSheet);
}

export function manageEdit(id) {
  const account = appState.accountList?.accounts.find(
    (entry) => entry.id === id
  );
  if (!account) return manageList();
  appState.sheetMode = 'edit';
  appState.editingId = id;
  const label = SERVICE[appState.provider] || 'accounts';
  const app = APP[appState.provider] || 'app';
  const blocked =
    APP_MANAGED[appState.provider] ||
    (account.active
      ? `${app} is signed into this account right now. Switch it to another account first.`
      : '');
  const n = account.keysSetTo || 0;
  const where = `${stateLine(account)} ${n ? plural(n, 'key') + ' set to it; follow keys show it whenever ' + app + ' is signed into it.' : 'No keys are set to it; follow keys show it whenever ' + app + ' is signed into it.'}`;
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
      <p>${blocked ? esc(blocked) : `Removing forgets this account on the deck${FOLDER[appState.provider] ? ' and signs out its separate sign-in folder' : ''}. Keys set to it go back to following ${esc(app)}.`}</p>
      <button class="danger" type="button" id="removeBtn" ${blocked ? 'disabled' : ''}>Remove ${esc(account.nick || account.name)}</button>
    </section>`,
    '#editNick'
  );
  byId('saveEdit').addEventListener('click', () => {
    send({
      rename: { id, nick: byId('editNick').value, name: byId('editName').value }
    });
  });
  byId('backBtn').addEventListener('click', manageList);
  if (!blocked)
    byId('removeBtn').addEventListener('click', () => manageConfirm(id));
}

function manageConfirm(id) {
  const account = appState.accountList?.accounts.find(
    (entry) => entry.id === id
  );
  if (!account) return manageList();
  appState.sheetMode = 'confirm';
  appState.editingId = id;
  const app = APP[appState.provider] || 'app';
  const n = account.keysSetTo || 0;
  openSheet(
    `
    <h2 id="sheetTitle">Remove ${esc(account.nick || account.name)}?</h2>
    <p>The deck forgets ${esc(account.name)}${FOLDER[appState.provider] ? ' and signs out its separate sign-in folder' : ''}. ${n ? plural(n, 'key') + ' set to it will follow ' + esc(app) + ' instead.' : 'No keys are set to it.'} ${esc(app)} itself is not changed.</p>
    <div class="row"><button type="button" id="keepBtn">Keep ${esc(account.nick || account.name)}</button><button class="danger solid" type="button" id="confirmRemove">Remove ${esc(account.nick || account.name)}</button></div>`,
    '#keepBtn'
  );
  byId('keepBtn').addEventListener('click', () => manageEdit(id));
  byId('confirmRemove').addEventListener('click', () =>
    send({ remove: { id } })
  );
}

export function showSignIn(data) {
  appState.sheetMode = 'signIn';
  if (data.kind === 'code') {
    const title =
      appState.provider === 'supergrok'
        ? 'Add a SuperGrok account'
        : appState.provider === 'openai'
          ? 'Add a ChatGPT account'
          : appState.provider === 'anthropic'
            ? 'Add a Claude account'
            : 'Sign in';
    openSheet(
      `
      <h2 id="sheetTitle">${title}</h2>
      <p>${
        data.code && data.code !== 'OPEN'
          ? appState.provider === 'supergrok'
            ? '<strong>Finish signing in on the xAI page.</strong> The code should already be filled in. Check that it matches the code below, click Continue, and approve the sign-in. If the browser asks for a code, enter the one below there.'
            : '<strong>Enter this code in your browser</strong> (not in this panel). The sign-in page should open automatically.'
          : '<strong>Complete sign-in in the browser window</strong> that just opened (or tap Open sign-in page). This panel has no code field on purpose.'
      }</p>
      ${data.code && data.code !== 'OPEN' ? `<div class="code" id="signInCode">${esc(data.code)}</div>` : ''}
      <p class="help" style="margin-top:-8px">Keep this panel open while you approve the sign-in in your browser. There is nothing to paste into Stream Deck. This sheet closes automatically when the provider confirms the sign-in.</p>
      <div class="row">
        <button class="primary" type="button" id="openSignIn">Open sign-in page</button>
        ${data.code && data.code !== 'OPEN' ? '<button type="button" id="copyCode">Copy code</button>' : ''}
        <button type="button" id="cancelSignIn">Cancel</button>
      </div>`,
      '#openSignIn'
    );
    const openPage = () => {
      if (data.url) send({ openUrl: data.url });
    };
    byId('openSignIn').addEventListener('click', openPage);
    byId('copyCode')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(data.code || ''));
        byId('copyCode').textContent = 'Copied';
      } catch {
        byId('copyCode').textContent = 'Select code above';
      }
    });
    byId('cancelSignIn').addEventListener('click', () => {
      send({ cancelSignIn: true });
      closeSheet();
    });
    // Open the browser immediately so the code has somewhere to go.
    openPage();
    return;
  }
  if (data.kind === 'app') {
    openSheet(
      `
      <h2 id="sheetTitle">Add a Grok Bot account</h2>
      <p>${esc(data.message || '')}</p>
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
      '#openApp'
    );
    byId('openApp').addEventListener('click', () => send({ openApp: true }));
    byId('scanAgain').addEventListener('click', () =>
      send({ addAccount: true })
    );
    byId('closeSheet').addEventListener('click', closeSheet);
    return;
  }
  const claude = appState.provider === 'anthropic';
  openSheet(
    `
    <h2 id="sheetTitle">${claude ? 'Add a Claude account' : 'Add account'}</h2>
    <p>${esc(data.message || '')}</p>
    ${
      claude
        ? `<ol class="steps" style="margin:0 0 12px;padding-left:18px;color:var(--ink,#e9edf0)">
      <li>In Claude Desktop or Claude Code, switch to the other subscription.</li>
      <li>Use it once (open Settings → Usage in Desktop, or send a short message in Code).</li>
      <li>Come back here and tap Scan again.</li>
    </ol>`
        : ''
    }
    <div class="row">
      <button class="primary" type="button" id="scanAgain">Scan again</button>
      <button type="button" id="closeSheet">Close</button>
    </div>`,
    '#scanAgain'
  );
  byId('scanAgain').addEventListener('click', () => send({ addAccount: true }));
  byId('closeSheet').addEventListener('click', closeSheet);
}
