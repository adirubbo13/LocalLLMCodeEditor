const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Tab operations
  createTab: () => ipcRenderer.invoke('create-tab'),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  getTabContent: (tabId) => ipcRenderer.invoke('get-tab-content', tabId),
  updateTabContent: (tabId, content) => ipcRenderer.invoke('update-tab-content', tabId, content),
  
  // File operations
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  saveFile: (tabId, content) => ipcRenderer.invoke('save-file', tabId, content),
  saveFileAs: (tabId, content) => ipcRenderer.invoke('save-file-as', tabId, content),
  
  // Ollama operations
  checkOllama: () => ipcRenderer.invoke('check-ollama'),
  sendToOllama: (params) => ipcRenderer.invoke('ollama-request', params),
  
  // Listen for menu commands
  onCommand: (callback) => {
    ipcRenderer.on('file-new-tab', () => callback('new-tab'));
    ipcRenderer.on('file-close-tab', () => callback('close-tab'));
    ipcRenderer.on('file-new', () => callback('new'));
    ipcRenderer.on('file-open', () => callback('open'));
    ipcRenderer.on('file-save', () => callback('save'));
    ipcRenderer.on('file-save-as', () => callback('save-as'));
    ipcRenderer.on('ai-generate', () => callback('generate'));
    ipcRenderer.on('ai-debug', () => callback('debug'));
    ipcRenderer.on('ai-explain', () => callback('explain'));
    ipcRenderer.on('ollama-start-failed', () => callback('ollama-failed'));
  }
});
