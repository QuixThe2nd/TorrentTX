const { contextBridge, ipcRenderer } = require('electron')

        handleLog: (callback) => ipcRenderer.on('log', callback),
contextBridge.exposeInMainWorld('electronAPI', {
  handleMessage: callback => ipcRenderer.on('message', callback),
  sendMessageToMain: message => ipcRenderer.send('message-from-renderer', message)
})
