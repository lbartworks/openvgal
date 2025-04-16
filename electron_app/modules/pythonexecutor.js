/**
 * Executable Manager Module
 * Handles execution of predefined executables for JSON generation
 */

const { ipcRenderer } = require('electron');
const { resourcesBasePath } = require('./paths');

class PythonExecutor {
    constructor() {
        this.executablePath = '';
        this.messageCallback = null;
    }

    /**
     * Initializes the executor
     * @param {function} messageCallback - Callback function to display messages
     */
    initialize(messageCallback) {
        this.messageCallback = messageCallback;
        this.setupEventListeners();
    }

    /**
     * Sets the executable path
     * @param {Object} paths - Object containing the predefined executable path
     * @param {string} paths.predefinedPath - Path to predefined executable
     */
    setExecutionConfig(mode, paths) {
        this.executablePath = paths.predefinedPath + (process.platform === 'win32' ? '.exe' : '');
    }

    /**
     * Sets up IPC event listeners for executable output
     */
    setupEventListeners() {
        ipcRenderer.on('python-stdout', (event, data) => {
            this.displayMessage(data, 'blue');
        });

        ipcRenderer.on('python-stderr', (event, data) => {
            this.displayMessage(data, 'red');
        });

        ipcRenderer.on('python-script-result', (event, result) => {
            this.processPythonScriptResult(result);
        });
    }

    /**
     * Generates JSON using predefined executable
     * @param {string[]} folders - Array of folder paths
     */
    generateJSON(folders) {
        if (folders.length === 0) {
            this.displayMessage('Error: No folders selected. Please add at least one folder.', 'red');
            return;
        }

        if (!this.executablePath) {
            this.displayMessage('Error: Executable path not set.', 'red');
            return;
        }

        const openvgalFolder = resourcesBasePath;
        
        this.displayMessage('Generating JSON...', 'blue');

        const args = ['--openvgal_folder', openvgalFolder];
        const executablePath = this.executablePath;

        // Send IPC message to main process
        ipcRenderer.send('run-python-script', {
            executablePath,
            args,
        })
    }

    /**
     * Processes the Python script execution result
     * @param {Object} result - The result object from Python script execution
     */
    processPythonScriptResult({ stdout, stderr, error, exitCode }) {
        // Log raw output for debugging
        console.log('Raw Python output:', stdout);
        console.log('stderr:', stderr);
        console.log('exit code:', exitCode);
        
        if (error) {
            this.displayMessage(`Error executing Python script: ${error}`, 'red');
            console.error('Python execution error:', error);
            return;
        }

        if (stderr && stderr.trim() !== '') {
            this.displayMessage(`Python script error output: ${stderr}`, 'red');
            console.warn('Python stderr:', stderr);
            return;
        }

        if (exitCode !== 0) {
            this.displayMessage(`Python script failed with exit code: ${exitCode}`, 'red');
            return;
        }

        if (stdout && stdout.trim() !== '') {
            console.log('Python progress message:', stdout);
        }

        this.displayMessage('JSON generation completed successfully', 'green');
    }

    /**
     * Displays a message using the provided callback
     * @param {string} message - The message to display
     * @param {string} color - The color of the message
     */
    displayMessage(message, color) {
        if (this.messageCallback) {
            this.messageCallback(message, color);
        }
    }
}

module.exports = PythonExecutor;