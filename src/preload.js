const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'meta', 'sysinfo', 'status', 'apply', 'revert', 'revertAll', 'action',
  'clean:scan', 'clean:run', 'drives', 'check:run', 'bloat:list', 'bloat:remove',
  'startup:list', 'startup:set', 'backup:info', 'backup:open', 'history',
  'settings:get', 'settings:set', 'guard:run', 'admin:relaunch', 'confirm', 'reboot',
  'update:state', 'update:check', 'update:download', 'update:install',
  'bench:meta', 'bench:list', 'bench:delete', 'bench:system', 'bench:procs', 'bench:game',
];
const EVENTS = ['monitor', 'history', 'guard', 'bench:progress', 'update'];

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
