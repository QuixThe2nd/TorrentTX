const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  handleMessage: callback => ipcRenderer.on('message', callback),
  handleLog: (type, log) => ipcRenderer.on('log', type, log),
  sendMessageToMain: message => ipcRenderer.send('message-from-renderer', message)
})
