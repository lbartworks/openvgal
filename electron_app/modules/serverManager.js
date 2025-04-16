/**
 * ServerManager class to handle web server operations
 */
class ServerManager {
  constructor() {
    this.webServerProcess = null;
    this.serverStartTimeout = null;
  }

  /**
   * Launch the web server
   * @param {Object} event - IPC event object
   * @param {Object} config - Configuration object containing server settings
   * @param {string} config.serverPath - Path to server executable
   */
  launchServer(event, config) {
    // Check if server is already running
    if (this.isServerRunning()) {
      console.log('Server is already running, opening browser');
      event.sender.send('launch-success', 'http://localhost:80');
      require('electron').shell.openExternal('http://localhost:80');
      return;
    }

    // Validate config object
    if (!config || typeof config !== 'object') {
      const errorMsg = 'Invalid configuration provided';
      console.error(errorMsg);
      event.sender.send('launch-error', errorMsg);
      return;
    }

    const fs = require('fs');
    
    // Validate executable path
    if (!config.serverPath || !fs.existsSync(config.serverPath)) {
      const errorMsg = `Server executable not found at ${config.serverPath || 'undefined path'}`;
      console.error(errorMsg);
      event.sender.send('launch-error', errorMsg);
      return;
    }

    try {
      this.startServerProcess(event, config);
    } catch (error) {
      console.error(`Failed to launch web server: ${error.message}`);
      event.sender.send('launch-error', `Failed to launch web server: ${error.message}`);
    }
  }

  /**
   * Start the server process
   * @private
   */
  startServerProcess(event, config) {
    const { spawn } = require('child_process');
    const path = require('path');
    const contentFolderPath = path.join(__dirname, '..', '..', 'web_server', 'content');
    const args = ['--port', '80', '--content_folder', contentFolderPath];
    
    // Run executable with arguments
    this.webServerProcess = spawn(config.serverPath, args, { shell: false });

    this.setupProcessTimeout(event);
    this.setupProcessListeners(event);
  }

  /**
   * Setup process timeout
   * @private
   */
  setupProcessTimeout(event) {
    // Clear any existing timeout first
    if (this.serverStartTimeout) {
      clearTimeout(this.serverStartTimeout);
    }
    
    this.serverStartTimeout = setTimeout(() => {
      if (this.webServerProcess) {
        // Check if server is actually running despite not receiving the ready message
        const http = require('http');
        const testConnection = http.get('http://localhost:80', (res) => {
          if (res.statusCode === 200) {
            this.handleServerStart(event);
          } else {
            this._handleStartupFailure(event, 'Server responded with non-200 status code');
          }
        });
        testConnection.on('error', (err) => {
          this._handleStartupFailure(event, `Connection error: ${err.message}`);
        });
        
        // Set a timeout for the connection attempt
        testConnection.setTimeout(2000, () => {
          testConnection.abort();
          this._handleStartupFailure(event, 'Connection timeout');
        });
      }
    }, 5000);
  }

  /**
   * Setup process event listeners
   * @private
   */
  setupProcessListeners(event) {
    const shell = require('electron').shell;

    this.webServerProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`Web server stdout: ${output}`);

      if (output.includes('Server started') || output.includes('listening on port')) {
        this.handleServerStart(event);
      }
    });

    this.webServerProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.error(`Web server stderr: ${error}`);
      event.sender.send('server-error', error);
    });

    this.webServerProcess.on('close', (code) => {
      this.handleServerClose(event, code);
    });

    this.webServerProcess.on('error', (error) => {
      this.handleServerError(event, error);
    });
  }

  /**
   * Handle server start
   * @private
   */
  handleServerStart(event) {
    console.log('Web server is ready');
    // Clear any pending timeouts
    if (this.serverStartTimeout) {
      clearTimeout(this.serverStartTimeout);
      this.serverStartTimeout = null;
    }

    // Small delay to ensure server is fully ready before opening browser
    setTimeout(() => {
      if (!this.webServerProcess) {
        console.warn('Server process no longer exists, cannot open browser');
        return;
      }
      
      const serverUrl = 'http://localhost:80';
      event.sender.send('launch-success', serverUrl);
      
      // Open browser with error handling
      require('electron').shell.openExternal(serverUrl).catch(err => {
        console.error('Failed to open browser:', err);
        event.sender.send('server-error', `Server started but failed to open browser: ${err.message}`);
      });
    }, 1000);
  }

  /**
   * Handle server close
   * @private
   */
  handleServerClose(event, code) {
    console.log(`Web server process exited with code ${code}`);
    if (this.serverStartTimeout) {
      clearTimeout(this.serverStartTimeout);
      this.serverStartTimeout = null;
    }
    this.webServerProcess = null;

    if (code !== 0) {
      event.sender.send('launch-error', `Web server process exited with code ${code}`);
    }
    event.sender.send('server-stopped');
  }

  /**
   * Handle server startup failure
   * @private
   */
  _handleStartupFailure(event, reason) {
    console.error(`Server failed to start: ${reason}`);
    event.sender.send('launch-error', `Server failed to start: ${reason}`);
    this.stopServer();
  }

  /**
   * Handle server error
   * @private
   */
  handleServerError(event, error) {
    console.error(`Web server process error: ${error.message}`);
    if (this.serverStartTimeout) {
      clearTimeout(this.serverStartTimeout);
      this.serverStartTimeout = null;
    }
    event.sender.send('launch-error', `Failed to start web server: ${error.message}`);
    this.webServerProcess = null;
  }

  /**
   * Terminates the web server process
   * @private
   * @param {Object} [event] - IPC event object (optional)
   * @param {boolean} [isCleanup=false] - Whether this is being called during cleanup
   * @returns {Promise<void>} A promise that resolves when the process is terminated
   */
  _terminateProcess(event, isCleanup = false) {
    return new Promise((resolve) => {
      if (!this.webServerProcess) {
        console.log('No web server process to stop');
        if (event && event.sender && !isCleanup) {
          event.sender.send('server-stopped');
        }
        resolve();
        return;
      }

      try {
        console.log(isCleanup ? 'Cleaning up web server process tree...' : 'Attempting to stop web server process and its children...');
        const treeKill = require('tree-kill');
        
        // Use tree-kill to terminate the process tree
        treeKill(this.webServerProcess.pid, 'SIGTERM', (err) => {
          if (err) {
            console.error(isCleanup ? 'Error cleaning up process tree:' : 'Error stopping process tree:', err);
            // Try force kill if SIGTERM fails
            treeKill(this.webServerProcess.pid, 'SIGKILL', (killErr) => {
              if (killErr) {
                console.error(isCleanup ? 'Error force killing process tree during cleanup:' : 'Error force killing process tree:', killErr);
                if (event && event.sender && !isCleanup) {
                  event.sender.send('server-error', `Failed to stop web server process tree: ${killErr.message}`);
                }
              } else {
                console.log(isCleanup ? 'Web server process tree cleaned up successfully' : 'Web server process tree force killed successfully');
              }
              this.webServerProcess = null;
              if (event && event.sender && !isCleanup) {
                event.sender.send('server-stopped');
              }
              resolve();
            });
          } else {
            console.log(isCleanup ? 'Web server process tree cleaned up successfully' : 'Web server process tree stopped successfully');
            this.webServerProcess = null;
            if (event && event.sender && !isCleanup) {
              event.sender.send('server-stopped');
            }
            resolve();
          }
        });
      } catch (err) {
        console.error(isCleanup ? 'Error cleaning up web server process:' : 'Error stopping web server:', err);
        if (event && event.sender && !isCleanup) {
          event.sender.send('server-error', `Failed to stop web server: ${err.message}`);
        }
        this.webServerProcess = null;
        resolve();
      }
    });
  }

  /**
   * Stop the web server
   * @param {Object} [event] - IPC event object (optional)
   */
  stopServer(event) {
    this._terminateProcess(event, false);
  }

  /**
   * Check if server is running
   * @returns {boolean}
   */
  isServerRunning() {
    if (this.webServerProcess) {
      try {
        // More reliable check for Windows process status
        const isRunning = this.webServerProcess.pid && this.webServerProcess.exitCode === null;
        if (!isRunning) {
          this.webServerProcess = null;
        }
        return isRunning;
      } catch (e) {
        console.error('Error checking server status:', e);
        this.webServerProcess = null;
        return false;
      }
    }
    return false;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    // Clear any pending timeouts first
    if (this.serverStartTimeout) {
      clearTimeout(this.serverStartTimeout);
      this.serverStartTimeout = null;
    }
    
    // Terminate the process if it exists
    this._terminateProcess(null, true);
  }
}

module.exports = ServerManager;