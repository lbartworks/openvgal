/**
 * OpenVGal Electron App - Renderer Process
 * 
 * This file handles the renderer process logic for the OpenVGal application,
 * including folder management, CSV/JSON generation, and Python script execution.
 */

// Import required modules
const { ipcRenderer } = require('electron');
const path = require('path');
const { resourcesBasePath } = require('./modules/paths');
const URLReplacer = require('./modules/urlReplacer');
const FolderManager = require('./modules/folderManager');
const CSVGenerator = require('./modules/csvGenerator');
const PythonExecutor = require('./modules/pythonExecutor');

// Initialize modules
const urlReplacer = new URLReplacer();
const folderManager = new FolderManager();
const csvGenerator = new CSVGenerator();
const pythonExecutor = new PythonExecutor();

// Initialize modules when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Initialize URL replacer
  urlReplacer.initialize();

  // Initialize folder manager
  folderManager.initialize(document.getElementById('folder-tree'));

  csvGenerator.initialize(displayMessage);
  pythonExecutor.initialize(displayMessage);
});

// ===== UI HELPER FUNCTIONS =====

/**
 * Displays a message in the UI with specified color
 * @param {string} text - The message to display
 * @param {string} color - The color of the message (default: 'red')
 */
function displayMessage(text, color = 'black') {
  const messageDiv = document.getElementById('generate-message');
  if (!messageDiv) {
    console.error('Error: generate-message element not found');
    return;
  }
  console.log('Setting message:', text);
  
  // Clear previous content
  messageDiv.innerHTML = '';
  
  // Handle multi-line messages by preserving line breaks
  if (text.includes('\n')) {
    // For multi-line messages, create a pre element to preserve formatting
    const pre = document.createElement('pre');
    pre.style.margin = '0';
    pre.style.fontFamily = 'monospace';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.color = color;
    pre.textContent = text;
    messageDiv.appendChild(pre);
  } else {
    // For single line messages, just set the text content
    messageDiv.textContent = text;
    messageDiv.style.color = color;
  }
}

/**
 * Shows the loading overlay
 */
function showLoadingOverlay() {
  document.querySelector('.loading-overlay').style.display = 'flex';
}

/**
 * Hides the loading overlay
 */
function hideLoadingOverlay() {
  document.querySelector('.loading-overlay').style.display = 'none';
}

// ===== EVENT LISTENERS =====

// Handle execution mode selection - Python functionality disabled
document.querySelectorAll('input[name="execution-mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const localConfig = document.getElementById('local-python-config');
    
    // Always keep Python inputs disabled
    const pythonInput = document.getElementById('python');
    const selectPythonBtn = document.getElementById('select-python');
    
    // Always hide local config and keep inputs disabled
    localConfig.style.display = 'none';
    pythonInput.disabled = true;
    selectPythonBtn.disabled = true;
  });
});

// Python executable file selection - functionality disabled
document.getElementById('select-python')?.addEventListener('click', () => {
  // Python selection functionality removed
  displayMessage('Python interpreter selection has been disabled. Using predefined executables only.', 'blue');
});

// Add folder button
document.getElementById('add-folder').addEventListener('click', () => {
  ipcRenderer.send('open-folder-dialog');
});

// Generate CSV button
document.getElementById('generate-csv').addEventListener('click', () => {
  csvGenerator.generateCSV(folderManager.getFolders());
});

// Generate JSON button
document.getElementById('generate-json').addEventListener('click', () => {
  // Always use predefined executables regardless of radio button selection
  const executionMode = 'predefined';
  const paths = {
    localPath: '', // Not used
    predefinedPath: path.join(resourcesBasePath, 'python', 'VR_gallery') // Use path.join for cross-platform compatibility
  };
  pythonExecutor.setExecutionConfig(executionMode, paths);
  pythonExecutor.generateJSON(folderManager.getFolders());
});

// Launch button
document.getElementById('launch').addEventListener('click', () => {
  console.log('Launch clicked');
  displayMessage('Launching web server and opening browser...', 'blue');
  showLoadingOverlay();
  
  // Always use predefined executables
  const executionMode = 'predefined';
  
  // Determine file extensions based on platform
  const isWin = process.platform === 'win32';
  const exeExt = isWin ? '.exe' : '';
  
  const config = {
    mode: executionMode,
    pythonPath: '', // Not used
    serverPath: resourcesBasePath + '/web_server/http_server' + exeExt,
    galleryScript: resourcesBasePath + '/python/dist/VR_gallery' + exeExt
  };
  
  // Send IPC message to main process to launch web server with config
  ipcRenderer.send('launch-web-server', config);
});

// ===== IPC EVENT HANDLERS =====

// Handle selected Python executable
ipcRenderer.on('selected-python-executable', (event, filePath) => {
  document.getElementById('python').value = filePath;
  pythonExecutor.setPythonPath(filePath);
});

// Handle selected folders
ipcRenderer.on('selected-folders', (event, folderPaths) => {
  folderManager.addFolders(folderPaths);
});

// Handle launch success
ipcRenderer.on('launch-success', (event, url) => {
  hideLoadingOverlay();
  displayMessage(`Successfully launched OpenVGal at ${url}`, 'green');
});

// Handle launch error
ipcRenderer.on('launch-error', (event, errorMessage) => {
  hideLoadingOverlay();
  displayMessage(`Launch failed: ${errorMessage}`, 'red');
});

// Shutdown button
document.getElementById('shutdown').addEventListener('click', () => {
  console.log('Shutdown clicked');
  displayMessage('Shutting down web server...', 'blue');
  showLoadingOverlay();
  
  // Send IPC message to main process to stop web server
  ipcRenderer.send('stop-web-server');
});

// Handle server stopped
ipcRenderer.on('server-stopped', () => {
  hideLoadingOverlay();
  displayMessage('Web server stopped successfully', 'green');
});

// Handle server error
ipcRenderer.on('server-error', (event, errorMessage) => {
  hideLoadingOverlay();
  
  // Check if message is actually a successful request (contains HTTP 200)
  if (errorMessage.includes('" 200 -')) {
    displayMessage(`Server request: ${errorMessage}`, 'green');
  } else {
    displayMessage(`Server error: ${errorMessage}`, 'red');
  }
});