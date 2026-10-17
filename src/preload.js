const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'meta', 'sysinfo', 'status', 'apply', 'revert', 'revertAll', 'action',
  'clean:scan', 'clean:run', 'drives', 'check:run', 'bloat:list', 'bloat:remove',
  'startup:list', 'startup:set', 'backup:info', 'backup:open', 'history',
  'settings:get', 'settings:set', 'guard:run', 'admin:relaunch', 'confirm', 'reboot',
];
const EVENTS = ['monitor', 'history', 'guard'];

contextBridge.exposeInMainWorld('api', {
  call: (ch, ...args) => {
    if (!CHANNELS.includes(ch)) return Promise.resolve({ ok: false, error: 'blocked channel' });
    return ipcRenderer.invoke(ch, ...args);
  },
  on: (ev, fn) => {
    if (!EVENTS.includes(ev)) return;
    ipcRenderer.on(ev, (_e, data) => fn(data));
  },
});
