const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
    'electronAPI', {
        handleMessage: (callback) => ipcRenderer.on('message', callback)
    }
);
