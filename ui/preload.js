const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  handleMessage: callback => ipcRenderer.on('message', callback),
  handleLog: callback => ipcRenderer.on('log', callback),
  sendMessageToMain: message => ipcRenderer.send('message-from-renderer', message)
})
