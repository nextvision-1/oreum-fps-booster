const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bench', {
  done: (result) => ipcRenderer.send('gpu:done', result),
});
