/**
 * Folder Management Module
 * Handles folder operations and tree visualization
 */

const path = require('path');
const fs = require('fs');

class FolderManager {
    constructor() {
        this.addedFolders = [];
        this.folderTree = null;
    }

    /**
     * Initializes the folder manager
     * @param {HTMLElement} folderTreeElement - The DOM element for the folder tree
     */
    initialize(folderTreeElement) {
        this.folderTree = folderTreeElement;
        this.buildFolderTree();
    }

    /**
     * Adds new folders to the manager
     * @param {string[]} folderPaths - Array of folder paths to add
     */
    addFolders(folderPaths) {
        this.addedFolders.push(...folderPaths);
        this.buildFolderTree();
    }

    /**
     * Removes a folder from the manager
     * @param {string} folderPath - The path of the folder to remove
     */
    removeFolder(folderPath) {
        this.addedFolders = this.addedFolders.filter(f => f !== folderPath);
        this.buildFolderTree();
    }

    /**
     * Gets all currently managed folders
     * @returns {string[]} Array of folder paths
     */
    getFolders() {
        return [...this.addedFolders];
    }

    /**
     * Builds the folder tree UI
     */
    buildFolderTree() {
        if (!this.folderTree) return;

        this.folderTree.innerHTML = '';
        
        this.addedFolders.forEach((folder) => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="toggle">[+]</span> ${path.basename(folder)} <span class="remove" title="Remove this folder">&times;</span>`;
            li.addEventListener('click', (e) => {
                if (e.target.classList.contains('toggle')) {
                    this.toggleFolder(li, folder);
                } else if (e.target.classList.contains('remove')) {
                    this.removeFolder(folder);
                }
            });
            this.folderTree.appendChild(li);
        });
    }

    /**
     * Toggles folder expansion in the UI
     * @param {HTMLElement} li - The list item element
     * @param {string} folderPath - The path of the folder to toggle
     */
    toggleFolder(li, folderPath) {
        const toggleSpan = li.querySelector('.toggle');
        
        if (li.classList.contains('open')) {
            // Close folder
            li.classList.remove('open');
            toggleSpan.textContent = '[+]';
            const subUl = li.nextSibling;
            if (subUl && subUl.tagName === 'UL') {
                li.parentNode.removeChild(subUl);
            }
        } else {
            // Open folder
            li.classList.add('open');
            toggleSpan.textContent = '[-]';
            const subUl = document.createElement('ul');
            
            try {
                const files = fs.readdirSync(folderPath);
                files.forEach((file) => {
                    const fullPath = path.join(folderPath, file);
                    const stats = fs.statSync(fullPath);
                    const subLi = document.createElement('li');
                    
                    if (stats.isDirectory()) {
                        subLi.innerHTML = `<span class="toggle">[+]</span> ${file}`;
                        subLi.addEventListener('click', (e) => {
                            if (e.target.classList.contains('toggle')) {
                                this.toggleFolder(subLi, fullPath);
                            }
                        });
                    } else {
                        subLi.textContent = file;
                    }
                    
                    subUl.appendChild(subLi);
                });
                
                li.parentNode.insertBefore(subUl, li.nextSibling);
            } catch (err) {
                console.error(`Error reading folder: ${err.message}`);
                throw err;
            }
        }
    }
}

module.exports = FolderManager;