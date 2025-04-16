const path = require('path');
const electron = require('electron');

// In Electron 12+, remote module is deprecated and removed
// We need to check if we're in the main process or renderer process
let app;
try {
  // Try to get app from main process
  app = electron.app;
} catch (e) {
  // If that fails, we're in the renderer process
  app = null;
}

// Define resourcesBasePath with a fallback for renderer process
const resourcesBasePath = app && app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, '..', '..');

console.log('resourcesBasePath:', resourcesBasePath);



module.exports = {
  resourcesBasePath,
};