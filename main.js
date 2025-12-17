const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

let mainWindow;
let ollamaProcess = null;
let openFiles = new Map(); // Track open files: tabId -> {path, content, saved}
let activeTabId = null;
let nextTabId = 1;

// Auto-start Ollama
function startOllama() {
  console.log('Attempting to start Ollama...');
  
  try {
    // Check if Ollama is already running
    fetch('http://localhost:11434/api/tags')
      .then(response => {
        if (response.ok) {
          console.log('Ollama already running');
        } else {
          launchOllamaProcess();
        }
      })
      .catch(() => {
        launchOllamaProcess();
      });
  } catch (error) {
    launchOllamaProcess();
  }
}

function launchOllamaProcess() {
  try {
    ollamaProcess = spawn('ollama', ['serve'], {
      detached: false,
      stdio: 'pipe'
    });

    ollamaProcess.stdout.on('data', (data) => {
      console.log(`Ollama: ${data}`);
    });

    ollamaProcess.stderr.on('data', (data) => {
      console.error(`Ollama error: ${data}`);
    });

    ollamaProcess.on('error', (error) => {
      console.error('Failed to start Ollama:', error);
      // Notify renderer that Ollama couldn't start
      if (mainWindow) {
        mainWindow.webContents.send('ollama-start-failed');
      }
    });

    console.log('Ollama process started');
  } catch (error) {
    console.error('Could not start Ollama:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'build/icons/icon.png'), // Add this line
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#f9f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  // Build menu
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => mainWindow.webContents.send('file-new-tab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => mainWindow.webContents.send('file-close-tab') },
        { type: 'separator' },
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('file-new') },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('file-open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('file-save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('file-save-as') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'AI',
      submenu: [
        { label: 'Generate Code', accelerator: 'CmdOrCtrl+G', click: () => mainWindow.webContents.send('ai-generate') },
        { label: 'Debug Code', accelerator: 'CmdOrCtrl+D', click: () => mainWindow.webContents.send('ai-debug') },
        { label: 'Explain Selection', accelerator: 'CmdOrCtrl+E', click: () => mainWindow.webContents.send('ai-explain') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Start Ollama when window is ready
  mainWindow.once('ready-to-show', () => {
    startOllama();
  });
}

// Tab management handlers
ipcMain.handle('create-tab', async () => {
  const tabId = `tab-${nextTabId++}`;
  openFiles.set(tabId, {
    path: null,
    content: '',
    saved: true,
    name: 'Untitled'
  });
  return { id: tabId, name: 'Untitled' };
});

ipcMain.handle('close-tab', async (event, tabId) => {
  if (openFiles.has(tabId)) {
    const file = openFiles.get(tabId);
    if (!file.saved) {
      // Return false if unsaved, let renderer handle confirmation
      return { shouldClose: false };
    }
    openFiles.delete(tabId);
    return { shouldClose: true };
  }
  return { shouldClose: true };
});

ipcMain.handle('get-tab-content', async (event, tabId) => {
  const file = openFiles.get(tabId);
  return file ? file.content : '';
});

ipcMain.handle('update-tab-content', async (event, tabId, content) => {
  if (openFiles.has(tabId)) {
    const file = openFiles.get(tabId);
    file.content = content;
    file.saved = false;
    openFiles.set(tabId, file);
  }
});

// File handlers - now tab-aware
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'JavaScript', extensions: ['js', 'jsx'] },
      { name: 'Python', extensions: ['py'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'CSS', extensions: ['css'] }
    ]
  });

  if (!result.canceled && result.filePaths[0]) {
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const name = path.basename(filePath);
    
    // Create new tab for opened file
    const tabId = `tab-${nextTabId++}`;
    openFiles.set(tabId, {
      path: filePath,
      content: content,
      saved: true,
      name: name
    });
    
    return { id: tabId, path: filePath, content, name };
  }
  return null;
});

ipcMain.handle('save-file', async (event, tabId, content) => {
  const file = openFiles.get(tabId);
  
  if (!file || !file.path) {
    // No existing path, trigger save-as
    return await ipcMain.handle('save-file-as', event, tabId, content);
  }
  
  await fs.writeFile(file.path, content, 'utf-8');
  file.content = content;
  file.saved = true;
  openFiles.set(tabId, file);
  
  return { path: file.path, name: file.name };
});

ipcMain.handle('save-file-as', async (event, tabId, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'JavaScript', extensions: ['js'] },
      { name: 'Python', extensions: ['py'] },
      { name: 'HTML', extensions: ['html'] }
    ]
  });

  if (!result.canceled) {
    const filePath = result.filePath;
    await fs.writeFile(filePath, content, 'utf-8');
    
    const name = path.basename(filePath);
    const file = openFiles.get(tabId);
    if (file) {
      file.path = filePath;
      file.content = content;
      file.saved = true;
      file.name = name;
      openFiles.set(tabId, file);
    }
    
    return { path: filePath, name };
  }
  return null;
});

// Ollama handlers
ipcMain.handle('ollama-request', async (event, { prompt, model }) => {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.2:3b',
        prompt: prompt,
        stream: false
      })
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, response: data.response };
    }
    return { success: false, error: 'Failed to get response' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-ollama', async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      return { available: true, models: data.models || [] };
    }
    return { available: false };
  } catch (error) {
    return { available: false };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Clean up Ollama process
  if (ollamaProcess) {
    console.log('Stopping Ollama...');
    ollamaProcess.kill();
  }
  
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Clean up on quit
app.on('before-quit', () => {
  if (ollamaProcess) {
    ollamaProcess.kill();
  }
});
