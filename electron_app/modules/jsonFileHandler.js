/**
 * JSON File Handler Module
 * Handles JSON file operations and text replacement
 */

const fs = require('fs');
const path = require('path');

class JSONFileHandler {
    /**
     * Finds all JSON files in the specified directory and its subdirectories
     * @param {string} directory - The directory to search in
     * @returns {string[]} - Array of JSON file paths
     */
    static findJSONFiles(directory) {
        const jsonFiles = [];
        try {
            const files = fs.readdirSync(directory);
            for (const file of files) {
                const filePath = path.join(directory, file);
                const stat = fs.statSync(filePath);
                
                if (stat.isDirectory()) {
                    jsonFiles.push(...this.findJSONFiles(filePath));
                } else if (path.extname(file).toLowerCase() === '.json') {
                    jsonFiles.push(filePath);
                }
            }
        } catch (error) {
            console.error('Error finding JSON files:', error);
        }
        return jsonFiles;
    }

    /**
     * Replaces text in JSON files
     * @param {string} directory - The directory containing JSON files
     * @param {string} searchText - The text to search for
     * @param {string} replacementText - The text to replace with
     * @param {Function} statusCallback - Callback function to update status
     * @returns {Object} - Results of the replacement operation
     */
    static replaceInJSONFiles(directory, searchText, replacementText, statusCallback) {
        const results = {
            success: true,
            filesProcessed: 0,
            filesModified: 0,
            errors: []
        };

        try {
            const jsonFiles = this.findJSONFiles(directory);
            results.filesProcessed = jsonFiles.length;

            if (jsonFiles.length === 0) {
                statusCallback('No JSON files found in the specified directory', 'red');
                results.success = false;
                return results;
            }

            for (const filePath of jsonFiles) {
                try {
                    let content = fs.readFileSync(filePath, 'utf8');
                    const originalContent = content;

                    // Replace all occurrences of searchText with replacementText
                    content = content.split(searchText).join(replacementText);

                    if (content !== originalContent) {
                        fs.writeFileSync(filePath, content, 'utf8');
                        results.filesModified++;
                        statusCallback(`Modified file: ${path.basename(filePath)}`, 'green');
                    }
                } catch (error) {
                    results.errors.push(`Error processing ${filePath}: ${error.message}`);
                    results.success = false;
                }
            }

            const summary = `Processed ${results.filesProcessed} files, modified ${results.filesModified} files`;
            statusCallback(summary, results.success ? 'green' : 'orange');

        } catch (error) {
            results.success = false;
            results.errors.push(`General error: ${error.message}`);
            statusCallback('Error processing files: ' + error.message, 'red');
        }

        return results;
    }
}

module.exports = JSONFileHandler;