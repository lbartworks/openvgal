const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ServerManager = require('./modules/serverManager');

let mainWindow;



// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});



app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Initialize server manager
const serverManager = new ServerManager();

// Kill web server when app is quitting
app.on('quit', () => {
  serverManager.cleanup();
});

// Launch web server
ipcMain.on('launch-web-server', (event, config) => {
  console.log('Launching web server with config:', config);
  serverManager.launchServer(event, config);
});

// Stop web server IPC handler
ipcMain.on('stop-web-server', (event) => {
  serverManager.stopServer(event);
});

// Existing folder selection IPC handler
ipcMain.on('open-folder-dialog', (event) => {
  dialog
    .showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      defaultPath: path.join(__dirname, '..', 'web_server', 'content')
    })
    .then((result) => {
      if (!result.canceled) {
        event.sender.send('selected-folders', result.filePaths);
      }
    })
    .catch((err) => {
      console.error(err);
    });
});



// File selection dialog for Python executable
ipcMain.on('select-python-executable', (event) => {
  // Set platform-specific filters for Python executable
  let filters;
  if (process.platform === 'win32') {
    filters = [{ name: 'Executable', extensions: ['exe'] }];
  } else if (process.platform === 'darwin') {
    filters = [
      { name: 'All Executables', extensions: ['*'] },
      { name: 'Python', extensions: ['py', 'pyc'] }
    ];
  } else {
    // Linux and other platforms
    filters = [{ name: 'All Executables', extensions: ['*'] }];
  }

  dialog
    .showOpenDialog({
      properties: ['openFile'],
      filters: filters
    })
    .then((result) => {
      if (!result.canceled) {
        event.sender.send('selected-python-executable', result.filePaths[0]);
      }
    })
    .catch((err) => {
      console.error(err);
    });
});



// Python script execution IPC handler
ipcMain.on('run-python-script', (event, { executablePath, args }) => {
  const { spawn } = require('child_process');
  const process = spawn(executablePath, args);

  process.stdout.on('data', (data) => {
    event.sender.send('python-stdout', data.toString());
  });

  process.stderr.on('data', (data) => {
    event.sender.send('python-stderr', data.toString());
  });

  process.on('close', (code) => {
    event.sender.send('python-script-result', {
      stdout: null,
      stderr: null,
      error: code !== 0 ? `Process exited with code ${code}` : null,
      exitCode: code
    });
  });

  process.on('error', (error) => {
    event.sender.send('python-script-result', {
      stdout: null,
      stderr: null,
      error: `Error executing script: ${error.message}`
    });
  });
});