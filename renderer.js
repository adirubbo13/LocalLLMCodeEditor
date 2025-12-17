// Global variables
let editors = new Map(); // tabId -> editor instance
let tabs = new Map(); // tabId -> {name, saved}
let activeTabId = null;
let ollamaAvailable = false;
let currentModel = 'llama3.2:3b';

// Initialize Monaco
require.config({ paths: { vs: 'node_modules/monaco-editor/min/vs' } });

require(['vs/editor/editor.main'], function() {
    // Define Claude theme
    monaco.editor.defineTheme('claude', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '8a8379' },
            { token: 'keyword', foreground: '148078' },
            { token: 'string', foreground: '1a9a93' },
            { token: 'number', foreground: '20b2aa' }
        ],
        colors: {
            'editor.background': '#f9f7f4',
            'editor.foreground': '#2d2925',
            'editorCursor.foreground': '#20b2aa',
            'editor.lineHighlightBackground': '#f4f2ed',
            'editor.selectionBackground': '#20b2aa30',
            'editorLineNumber.foreground': '#8a8379'
        }
    });

    // Create initial tab
    createNewTab();
});

// Tab Management
async function createNewTab(content = '', name = 'Untitled', filePath = null) {
    const result = await api.createTab();
    const tabId = result.id;
    
    // Create tab element
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.id = `tab-${tabId}`;
    tabEl.innerHTML = `
        <span class="tab-title">${name}</span>
        <span class="tab-close">×</span>
    `;
    
    // Add click handlers
    tabEl.querySelector('.tab-title').onclick = () => switchToTab(tabId);
    tabEl.querySelector('.tab-close').onclick = (e) => {
        e.stopPropagation();
        closeTab(tabId);
    };
    
    document.getElementById('tabs').appendChild(tabEl);
    
    // Create editor container
    const editorContainer = document.createElement('div');
    editorContainer.className = 'editor-container';
    editorContainer.id = `editor-${tabId}`;
    document.getElementById('editors-container').appendChild(editorContainer);
    
    // Create Monaco editor instance
    const editor = monaco.editor.create(editorContainer, {
        value: content,
        language: detectLanguage(name),
        theme: 'claude',
        fontSize: 14,
        minimap: { enabled: true },
        automaticLayout: true
    });
    
    // Track changes
    editor.onDidChangeModelContent(() => {
        markTabUnsaved(tabId);
        updateExplainButton();
        api.updateTabContent(tabId, editor.getValue());
    });
    
    editor.onDidChangeCursorSelection(() => {
        if (tabId === activeTabId) {
            updateExplainButton();
        }
    });
    
    editors.set(tabId, editor);
    tabs.set(tabId, { name, saved: true, path: filePath });
    
    switchToTab(tabId);
    updateFileCount();
    
    return tabId;
}

function switchToTab(tabId) {
    if (activeTabId === tabId) return;
    
    // Update tab UI
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
    
    // Update editor visibility
    document.querySelectorAll('.editor-container').forEach(container => {
        container.classList.remove('active');
    });
    document.getElementById(`editor-${tabId}`)?.classList.add('active');
    
    // Hide empty state
    document.getElementById('empty-state').style.display = 'none';
    
    activeTabId = tabId;
    
    // Update button states
    updateExplainButton();
    
    // Focus editor
    const editor = editors.get(tabId);
    if (editor) {
        editor.focus();
    }
}

async function closeTab(tabId) {
    const tab = tabs.get(tabId);
    if (!tab) return;
    
    if (!tab.saved) {
        if (!confirm(`Close unsaved file "${tab.name}"?`)) {
            return;
        }
    }
    
    // Remove from DOM
    document.getElementById(`tab-${tabId}`)?.remove();
    document.getElementById(`editor-${tabId}`)?.remove();
    
    // Clean up
    const editor = editors.get(tabId);
    if (editor) editor.dispose();
    
    editors.delete(tabId);
    tabs.delete(tabId);
    
    // Switch to another tab or show empty state
    if (tabId === activeTabId) {
        const remainingTabs = Array.from(tabs.keys());
        if (remainingTabs.length > 0) {
            switchToTab(remainingTabs[remainingTabs.length - 1]);
        } else {
            activeTabId = null;
            document.getElementById('empty-state').style.display = 'block';
        }
    }
    
    updateFileCount();
}

function markTabUnsaved(tabId) {
    const tab = tabs.get(tabId);
    if (tab && tab.saved) {
        tab.saved = false;
        document.getElementById(`tab-${tabId}`)?.classList.add('unsaved');
    }
}

function markTabSaved(tabId) {
    const tab = tabs.get(tabId);
    if (tab) {
        tab.saved = true;
        document.getElementById(`tab-${tabId}`)?.classList.remove('unsaved');
    }
}

function updateFileCount() {
    const count = tabs.size;
    document.getElementById('file-count').textContent = 
        `${count} ${count === 1 ? 'file' : 'files'} open`;
}

function detectLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'js': 'javascript', 'jsx': 'javascript',
        'ts': 'typescript', 'tsx': 'typescript',
        'py': 'python',
        'html': 'html', 'htm': 'html',
        'css': 'css', 'scss': 'scss',
        'json': 'json',
        'md': 'markdown',
        'xml': 'xml',
        'yaml': 'yaml', 'yml': 'yaml'
    };
    return map[ext] || 'plaintext';
}

// File Operations
async function newFile() {
    createNewTab();
}

async function openFile() {
    const result = await api.openFile();
    if (result) {
        await createNewTab(result.content, result.name, result.path);
    }
}

async function saveFile() {
    if (!activeTabId) return;
    
    const editor = editors.get(activeTabId);
    const content = editor.getValue();
    
    const result = await api.saveFile(activeTabId, content);
    if (result) {
        const tab = tabs.get(activeTabId);
        tab.name = result.name;
        tab.path = result.path;
        markTabSaved(activeTabId);
        
        // Update tab title
        document.querySelector(`#tab-${activeTabId} .tab-title`).textContent = result.name;
        
        showNotification('File saved');
    }
}

async function saveFileAs() {
    if (!activeTabId) return;
    
    const editor = editors.get(activeTabId);
    const content = editor.getValue();
    
    const result = await api.saveFileAs(activeTabId, content);
    if (result) {
        const tab = tabs.get(activeTabId);
        tab.name = result.name;
        tab.path = result.path;
        markTabSaved(activeTabId);
        
        // Update tab title
        document.querySelector(`#tab-${activeTabId} .tab-title`).textContent = result.name;
        
        showNotification('File saved');
    }
}

// Ollama Functions
async function checkOllama() {
    const statusDot = document.getElementById('ollama-status');
    const statusText = document.getElementById('ollama-text');
    
    try {
        const result = await api.checkOllama();
        ollamaAvailable = result.available;
        
        if (result.available) {
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Ollama Connected';
            enableAIButtons();
            
            const hasModels = result.models && result.models.length > 0;
            if (!hasModels) {
                showNotification('Run: ollama pull llama3.2:3b', 'warning');
            }
        } else {
            setOfflineMode();
        }
    } catch (error) {
        setOfflineMode();
    }
}

function setOfflineMode() {
    const statusDot = document.getElementById('ollama-status');
    const statusText = document.getElementById('ollama-text');
    
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Ollama Offline (Editor Only)';
    ollamaAvailable = false;
    disableAIButtons();
    
    setTimeout(checkOllama, 5000);
}

function enableAIButtons() {
    document.getElementById('generate-btn').disabled = false;
    document.getElementById('debug-btn').disabled = false;
    updateExplainButton();
}

function disableAIButtons() {
    document.getElementById('generate-btn').disabled = true;
    document.getElementById('debug-btn').disabled = true;
    document.getElementById('explain-btn').disabled = true;
}

function updateExplainButton() {
    if (!activeTabId || !ollamaAvailable) {
        document.getElementById('explain-btn').disabled = true;
        return;
    }
    
    const editor = editors.get(activeTabId);
    if (editor) {
        const selection = editor.getSelection();
        const hasSelection = !selection.isEmpty();
        document.getElementById('explain-btn').disabled = !hasSelection;
    }
}

// AI Operations
async function generateCode() {
    if (!ollamaAvailable || !activeTabId) return;
    
    const editor = editors.get(activeTabId);
    showLoading();
    
    const prompt = 'Generate useful code:\n' + editor.getValue();
    
    try {
        const result = await api.sendToOllama({ prompt, model: currentModel });
        hideLoading();
        
        if (result.success) {
            editor.setValue(result.response);
            showNotification('Code generated!');
        } else {
            showNotification('Generation failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showNotification('Error: ' + error.message, 'error');
    }
}

async function debugCode() {
    if (!ollamaAvailable || !activeTabId) return;
    
    const editor = editors.get(activeTabId);
    showLoading();
    showSidebar('Debug Analysis');
    
    const code = editor.getValue();
    const prompt = `Debug this code and list issues:\n\n${code}`;
    
    try {
        const result = await api.sendToOllama({ prompt, model: currentModel });
        hideLoading();
        
        if (result.success) {
            document.getElementById('sidebar-content').textContent = result.response;
            showNotification('Debug complete');
        }
    } catch (error) {
        hideLoading();
        showNotification('Error: ' + error.message, 'error');
    }
}

async function explainCode() {
    if (!ollamaAvailable || !activeTabId) return;
    
    const editor = editors.get(activeTabId);
    const selection = editor.getModel().getValueInRange(editor.getSelection());
    if (!selection) return;
    
    showLoading();
    showSidebar('Code Explanation');
    
    const prompt = `Explain this code:\n\n${selection}`;
    
    try {
        const result = await api.sendToOllama({ prompt, model: currentModel });
        hideLoading();
        
        if (result.success) {
            document.getElementById('sidebar-content').textContent = result.response;
            showNotification('Explanation ready');
        }
    } catch (error) {
        hideLoading();
        showNotification('Error: ' + error.message, 'error');
    }
}

// UI Helpers
function showSidebar(title) {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('sidebar-title').textContent = title;
}

function hideSidebar() {
    document.getElementById('sidebar').classList.add('hidden');
}

function showLoading() {
    document.getElementById('loading').classList.add('show');
}

function hideLoading() {
    document.getElementById('loading').classList.remove('show');
}

function showNotification(message, type = 'success') {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = message;
    if (type === 'error') notif.style.background = '#dc3545';
    if (type === 'warning') notif.style.background = '#f39c12';
    
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// Event Listeners
document.getElementById('add-tab').addEventListener('click', () => createNewTab());
document.getElementById('model-select').addEventListener('change', (e) => {
    currentModel = e.target.value;
});

document.getElementById('generate-btn').addEventListener('click', generateCode);
document.getElementById('debug-btn').addEventListener('click', debugCode);
document.getElementById('explain-btn').addEventListener('click', explainCode);

document.getElementById('toggle-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('hidden');
});

document.getElementById('close-sidebar').addEventListener('click', hideSidebar);

// Menu commands
api.onCommand((command) => {
    switch(command) {
        case 'new-tab': createNewTab(); break;
        case 'close-tab': if (activeTabId) closeTab(activeTabId); break;
        case 'new': newFile(); break;
        case 'open': openFile(); break;
        case 'save': saveFile(); break;
        case 'save-as': saveFileAs(); break;
        case 'generate': generateCode(); break;
        case 'debug': debugCode(); break;
        case 'explain': explainCode(); break;
        case 'ollama-failed': 
            showNotification('Ollama not installed or failed to start', 'warning');
            setOfflineMode();
            break;
    }
});

// Initialize
setTimeout(() => {
    checkOllama();
}, 1000);

// Periodic check
setInterval(() => {
    if (!ollamaAvailable) checkOllama();
}, 10000);
