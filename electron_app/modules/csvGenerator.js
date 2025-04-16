/**
 * CSV Generation Module
 * Handles CSV file generation from folder paths
 */

const path = require('path');
const fs = require('fs');
const { resourcesBasePath } = require('./paths');

class CSVGenerator {
    constructor() {
        this.messageCallback = null;
    }

    /**
     * Initializes the CSV generator
     * @param {function} messageCallback - Callback function to display messages
     */
    initialize(messageCallback) {
        this.messageCallback = messageCallback;
    }

    /**
     * Generates a CSV file from the provided folders
     * @param {string[]} folders - Array of folder paths
     * @returns {boolean} - Whether the generation was successful
     */
    generateCSV(folders) {
        if (folders.length === 0) {
            this.displayMessage('Error: No folders selected. Please add at least one folder.', 'red');
            return false;
        }
        
        let csvContent = 'Gallery name,Parent,Folder\n';
        csvContent += 'root,none,\n';
        
        folders.forEach((folder) => {
            const galleryName = path.basename(folder);
            const parent = 'root';
            
            // Extract only the path after 'web_server/content'
            let folderPath = folder;
            // Handle both Windows and Unix-style paths
            const contentIndexWin = folder.indexOf('web_server\\content');
            const contentIndexUnix = folder.indexOf('web_server/content');
            
            if (contentIndexWin !== -1) {
                // Windows path handling
                folderPath = folder.substring(contentIndexWin + 'web_server\\content'.length).replace(/\\/g, '/');
            } else if (contentIndexUnix !== -1) {
                // Unix path handling
                folderPath = folder.substring(contentIndexUnix + 'web_server/content'.length);
            }
            
            // Ensure the path starts with a slash
            if (folderPath && !folderPath.startsWith('/')) {
                folderPath = '/' + folderPath;
            }
            
            csvContent += `${galleryName},${parent},${folderPath}\n`;
        });
        
        //manage paths
        const localPath = '/python/building_v2.csv';
        const csvPath = path.join(resourcesBasePath, localPath);
        
        
        
        try {
            fs.writeFileSync(csvPath, csvContent);
            this.displayMessage(`Success: building_v2.csv generated at ${localPath}`, 'green');
            return true;
        } catch (err) {
            this.displayMessage(`Error: Failed to generate CSV - ${err.message}`, 'red');
            return false;
        }
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

module.exports = CSVGenerator;