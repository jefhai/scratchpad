const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const { platformConfig } = require('../scripts/config.cjs');

test('the desktop policy permits local assets and native IPC, not Internet connections', () => {
  const policy = Object.fromEntries(config.app.security.csp.split(';').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name, values]));
  assert.deepEqual(policy['default-src'], ["'self'"]);
  assert.deepEqual(policy['connect-src'], ['ipc:']);
  for (const directive of ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src']) {
    assert(policy[directive].every(value => !/https?:|wss?:|ftp:|\*/i.test(value)));
  }
  assert.deepEqual(policy['frame-src'], ["'none'"]);
  assert.deepEqual(policy['object-src'], ["'none'"]);
  assert.deepEqual(policy['form-action'], ["'none'"]);
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.build.frontendDist, '../.web');
  assert.equal(config.bundle.createUpdaterArtifacts, false);
});

test('Mac sandbox entitlements deny both client and server networking', () => {
  const config = platformConfig('macos');
  const entitlements = fs.readFileSync(path.join(root, 'src-tauri', config.bundle.macOS.entitlements), 'utf8');
  assert.match(entitlements, /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/);
  const keys = [...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map(match => match[1]);
  assert.deepEqual(keys.sort(), ['com.apple.security.app-sandbox', 'com.apple.security.files.user-selected.read-write']);
  assert.equal(config.bundle.macOS.hardenedRuntime, true);
  assert.equal(config.bundle.macOS.minimumSystemVersion, '26.0');
});

test('capabilities expose no network, remote webview, filesystem, shell, or updater APIs', () => {
  const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/capabilities/workspaces.json'), 'utf8'));
  assert.deepEqual(capability.platforms, ['macOS', 'windows']);
  assert.deepEqual(capability.windows, ['scratchpad-*']);
  assert.equal(capability.local, true);
  assert.equal(capability.remote, undefined);
  assert.deepEqual([...capability.permissions].sort(), [
    'core:event:allow-listen', 'core:event:allow-unlisten',
    'allow-desktop-load', 'allow-desktop-save', 'allow-desktop-rename',
    'allow-desktop-ready', 'allow-desktop-flushed', 'allow-desktop-copy-text', 'allow-desktop-save-file',
  ].sort());
  const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  assert.doesNotMatch(cargo, /tauri-plugin-(?:http|shell|opener|updater|localhost)|^reqwest\s*=/m);
});

test('Windows uses only embedded IPC, a private fixed runtime, and elevated scoped offline setup', () => {
  const windows = platformConfig('windows');
  assert.equal(windows.bundle.macOS, undefined);
  assert.deepEqual(windows.bundle.targets, ['nsis']);
  assert.deepEqual(windows.bundle.windows.webviewInstallMode, { type: 'fixedRuntime', path: 'webview2' });
  assert.equal(windows.bundle.windows.nsis.installMode, 'perMachine');
  assert.match(windows.app.security.csp, /connect-src ipc: https:\/\/ipc\.localhost;/);
  assert.doesNotMatch(windows.app.security.csp, /https:\/\/(?!ipc\.localhost)|wss?:|\*/);
  assert.equal(windows.build.devUrl, undefined);
  assert.equal(windows.bundle.windows.minimumWebview2Version, undefined);
  const hooks = fs.readFileSync(path.join(root, 'src-tauri', windows.bundle.windows.nsis.installerHooks), 'utf8');
  for (const action of ['prepare', 'install', 'audit', 'remove']) assert(hooks.includes(`scratchpad-policy.exe" ${action} "$INSTDIR"`));
  assert(hooks.includes('.scratchpad-installing'));
  assert(hooks.includes('$%SCRATCHPAD_POLICY_BINARY%'));
  assert(hooks.includes('22000'));
  assert(hooks.includes('SCRATCHPAD_REQUIRE_CLOSED'));
  assert.doesNotMatch(hooks, /KillProcess|downloadBootstrapper|Set-NetFirewallProfile|netsh/i);
});
