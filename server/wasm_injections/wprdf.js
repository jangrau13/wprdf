// WPRDF - Complete Notebook Codebase Management
const wprdf = {
    db: null,
    currentNotebook: null,
    serverUrl: window.location.origin,
    _isReloading: false, // Flag to prevent detection during reload
    _footprint: null, // Browser footprint hash
    
    async init() {
        console.log('Initializing WPRDF...');
        
        // Generate browser footprint
        this._footprint = await this.generateFootprint();
        console.log('Browser Footprint:', this._footprint);
        
        // Initialize SQLite with CORRECT CDN URL
        const SQL = await initSqlJs({
            locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
        });
        
        const savedDb = localStorage.getItem('wprdf_codebase');
        if (savedDb) {
            const arr = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
            this.db = new SQL.Database(arr);
        } else {
            this.db = new SQL.Database();
            this.createSchema();
        }
        
        this.updateNotebookList();
        this.setupEventListeners();
        
        // Load default notebooks from server on first run
        if (!savedDb) {
            await this.loadDefaultNotebooks();
        }
        
        // Sync notebooks to virtual filesystem for cross-notebook imports
        this.syncToVirtualFS();
        
        // Listen for messages from Marimo iframe
        window.addEventListener('message', this.handleMarimoMessage.bind(this));
        
        // Start periodic detection to keep UI in sync
        setInterval(() => this.detectCurrentNotebook(), 2000);
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('wprdf-notebook-dropdown');
            const list = document.getElementById('wprdf-notebook-list');
            if (dropdown && !dropdown.contains(e.target)) {
                list.classList.remove('open');
            }
            
            // Close modal when clicking outside content
            const modal = document.getElementById('wprdf-modal');
            if (e.target === modal) {
                this.closeModal();
            }
        });
        
        console.log('WPRDF initialized');
    },

    async generateFootprint() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = "top";
        ctx.font = "14px 'Arial'";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#f60";
        ctx.fillRect(125,1,62,20);
        ctx.fillStyle = "#069";
        ctx.fillText("wprdf-footprint", 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
        ctx.fillText("wprdf-footprint", 4, 17);
        const fingerprint = canvas.toDataURL();
        return this.calculateHash(fingerprint + navigator.userAgent + screen.width + screen.height);
    },

    getAuthorUri() {
        return `http://browser.app/user#${this._footprint}`;
    },

    getAppUri() {
        return `http://browser.app/app#${this._footprint}`;
    },
    
    showModal(title, content, actions = []) {
        const modal = document.getElementById('wprdf-modal');
        const modalTitle = document.getElementById('wprdf-modal-title');
        const modalBody = document.getElementById('wprdf-modal-body');
        const modalActions = document.getElementById('wprdf-modal-actions');
        
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        modalActions.innerHTML = '';
        
        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = `wprdf-btn wprdf-btn-${action.type || 'secondary'}`;
            btn.textContent = action.label;
            btn.onclick = () => action.onClick(modalBody);
            modalActions.appendChild(btn);
        });
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'wprdf-btn wprdf-btn-secondary';
        closeBtn.textContent = 'Cancel';
        closeBtn.onclick = () => this.closeModal();
        modalActions.appendChild(closeBtn);
        
        modal.style.display = 'flex';
    },
    
    closeModal() {
        document.getElementById('wprdf-modal').style.display = 'none';
    },
    
    manageNotebooks() {
        const result = this.db.exec("SELECT name, updated_at FROM notebooks ORDER BY updated_at DESC");
        let html = `
            <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; display: flex; gap: 10px; align-items: center;">
                <button class="wprdf-btn wprdf-btn-primary wprdf-btn-sm" onclick="wprdf.loadDefaultNotebooks(true).then(() => wprdf.manageNotebooks())">
                    🔄 Force Refresh
                </button>
                <button class="wprdf-btn wprdf-btn-danger wprdf-btn-sm" onclick="wprdf.resetLocalDatabase()">
                    🗑️ Reset Local DB
                </button>
            </div>
            <div class="wprdf-manage-list">
        `;
        
        if (!result[0]) {
            html += '<p>No notebooks found.</p>';
        } else {
            result[0].values.forEach(([name, updated]) => {
                html += `
                    <div class="wprdf-manage-item">
                        <div class="wprdf-manage-info">
                            <strong>${this.escapeHtml(name)}</strong>
                            <span>Last updated: ${new Date(updated).toLocaleString()}</span>
                        </div>
                        <div class="wprdf-manage-actions">
                            <button class="wprdf-btn wprdf-btn-secondary wprdf-btn-sm" onclick="wprdf.renameNotebookPrompt('${this.escapeHtml(name)}')">Rename</button>
                            <button class="wprdf-btn wprdf-btn-danger wprdf-btn-sm" onclick="wprdf.deleteNotebook('${this.escapeHtml(name)}'); wprdf.manageNotebooks();">Delete</button>
                        </div>
                    </div>
                `;
            });
        }
        html += '</div>';
        
        this.showModal('Manage Notebooks', html);
    },
    
    renameNotebookPrompt(oldName) {
        const newName = prompt('New name:', oldName);
        if (!newName || newName === oldName) return;
        
        try {
            this.db.run("UPDATE notebooks SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?", [newName, oldName]);
            if (this.currentNotebook === oldName) this.currentNotebook = newName;
            this.saveDB();
            this.manageNotebooks();
            this.showStatus(`Renamed to "${newName}"`, 'success');
        } catch (e) {
            this.showStatus('Rename failed: ' + e.message, 'error');
        }
    },
    
    // Helper for the Python Import Hook to fetch code on demand
    getNotebookCode(name) {
        const result = this.db.exec("SELECT code FROM notebooks WHERE name = ?", [name]);
        if (result[0] && result[0].values[0]) {
            return result[0].values[0][0];
        }
        return null;
    },
    
    async loadDefaultNotebooks(force = false) {
        try {
            this.showStatus('Syncing with server...', 'info');
            const response = await fetch('/api/notebooks/defaults');
            if (response.ok) {
                const data = await response.json();
                if (data.notebooks && data.notebooks.length > 0) {
                    data.notebooks.forEach(nb => {
                        // If force is true, we overwrite everything. 
                        // Otherwise, we only update if the hash is different.
                        if (force) {
                            this.db.run(
                                `INSERT OR REPLACE INTO notebooks (name, hash, code, updated_at) 
                                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                                [nb.name, nb.hash, nb.code]
                            );
                        } else {
                            this.db.run(
                                `INSERT INTO notebooks (name, hash, code, updated_at) 
                                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                                 ON CONFLICT(name) DO UPDATE SET 
                                    hash = excluded.hash,
                                    code = excluded.code,
                                    updated_at = CURRENT_TIMESTAMP
                                 WHERE hash != excluded.hash`,
                                [nb.name, nb.hash, nb.code]
                            );
                        }
                    });
                    this.saveDB();
                    this.showStatus(`Synced ${data.notebooks.length} notebooks from server`, 'success');
                }
            }
        } catch (e) {
            console.error('Failed to load default notebooks:', e);
        }
    },

    createSchema() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS notebooks (
                name TEXT PRIMARY KEY,
                hash TEXT NOT NULL,
                code TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    },
    
    saveDB() {
        const data = this.db.export();
        const base64 = btoa(String.fromCharCode.apply(null, data));
        localStorage.setItem('wprdf_codebase', base64);
        this.updateNotebookList();
    },
    
    async calculateHash(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    
    showStatus(message, type = 'info') {
        const status = document.getElementById('wprdf-status');
        status.textContent = message;
        status.className = type;
        status.style.display = 'block';
        setTimeout(() => status.style.display = 'none', 5000);
    },
    
    toggleNotebookList() {
        const list = document.getElementById('wprdf-notebook-list');
        list.classList.toggle('open');
    },
    
    updateNotebookList() {
        const result = this.db.exec("SELECT name, hash FROM notebooks ORDER BY updated_at DESC");
        const count = result[0] ? result[0].values.length : 0;
        
        document.getElementById('wprdf-count').textContent = `${count} notebook${count !== 1 ? 's' : ''}`;
        
        // Update current notebook display
        if (this.currentNotebook) {
            document.getElementById('wprdf-current').textContent = `Current: ${this.currentNotebook}`;
        } else {
            document.getElementById('wprdf-current').textContent = '';
        }
        
        const listDiv = document.getElementById('wprdf-notebook-list');
        listDiv.innerHTML = '';
        
        if (!result[0]) {
            listDiv.innerHTML = '<p style="padding: 12px; color: #6b7280; font-size: 12px;">No notebooks yet</p>';
            return;
        }
        
        const search = document.getElementById('wprdf-search').value.toLowerCase();
        
        result[0].values.forEach(([name, hash]) => {
            if (search && !name.toLowerCase().includes(search)) return;
            
            const div = document.createElement('div');
            div.className = 'wprdf-notebook-item';
            if (this.currentNotebook === name) div.classList.add('active');
            
            div.innerHTML = `
                <div class="wprdf-notebook-name">${this.escapeHtml(name)}</div>
                <div class="wprdf-notebook-hash">${hash.slice(0, 12)}</div>
                <div class="wprdf-notebook-actions">
                    <button class="wprdf-btn wprdf-btn-primary wprdf-btn-sm" onclick="wprdf.loadNotebook('${this.escapeHtml(name)}'); event.stopPropagation();">
                        ${this.currentNotebook === name ? '✓ Active' : 'Load'}
                    </button>
                    <button class="wprdf-btn wprdf-btn-secondary wprdf-btn-sm" onclick="wprdf.deleteNotebook('${this.escapeHtml(name)}'); event.stopPropagation();">
                        Delete
                    </button>
                </div>
            `;
            
            listDiv.appendChild(div);
        });
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    getCurrentCode() {
        const iframe = document.getElementById('marimoFrame');
        if (iframe && iframe.contentWindow) {
            try {
                const marimoDoc = iframe.contentDocument || iframe.contentWindow.document;
                const marimoCodeElement = marimoDoc.querySelector('marimo-code');
                if (marimoCodeElement) {
                    return decodeURIComponent(marimoCodeElement.textContent);
                }
            } catch (e) {
                console.error('Cannot access iframe content (cross-origin):', e);
            }
        }
        return null;
    },
    
    prepareCode(code) {
        console.log('WPRDF: Preparing code for Marimo...');
        
        const authorUri = this.getAuthorUri();
        const appUri = this.getAppUri();
        
        // 1. Basic Marimo-ification if it's just a snippet
        if (!code.includes('app = marimo.App(')) {
            console.log('WPRDF: Wrapping plain Python code into Marimo app structure');
            
            // Check for WPRDF specific utilities
            let utils = '';
            if (code.includes('create_wprdf_row') || code.includes('WPRDF_SCHEMA')) {
                utils = `
@app.cell
def __(base64, datetime, pa):
    WPRDF_SCHEMA = pa.schema([
        ('subject', pa.string()),
        ('predicate', pa.string()),
        ('object_type', pa.string()),
        ('object', pa.string()),
        ('technical_timestamp', pa.string()),
        ('business_validity_from', pa.string()),
        ('business_validity_to', pa.string()),
        ('author', pa.string()),
        ('app', pa.string())
    ])

    def create_wprdf_row(subject, predicate, obj, author="${authorUri}", app="${appUri}", business_from=None):
        obj_type = type(obj).__name__
        val = base64.b64encode(str(obj).encode('utf-8')).decode('utf-8') if not isinstance(obj, bytes) else base64.b64encode(obj).decode('utf-8')
        now = datetime.now().isoformat()
        return {
            'subject': str(subject), 'predicate': str(predicate), 'object_type': obj_type,
            'object': val, 'technical_timestamp': now,
            'business_validity_from': (business_from or now), 'business_validity_to': None,
            'author': author, 'app': app
        }
    return WPRDF_SCHEMA, create_wprdf_row
`;
            }

            code = `import marimo
app = marimo.App(width="medium")

@app.cell
def __():
    import marimo as mo
    return (mo,)
${utils}
@app.cell
def __():
${code.split('\n').map(line => '    ' + line).join('\n')}
    return

if __name__ == "__main__":
    app.run()`;
        }

        // 2. Dynamic Dependency Injection
        const deps = [];
        if (code.includes('import pandas') || code.includes('pd.')) deps.push('pandas', 'openpyxl');
        if (code.includes('import pyarrow') || code.includes('pa.')) deps.push('pyarrow');
        if (code.includes('import numpy') || code.includes('np.')) deps.push('numpy');

        if (deps.length > 0 && !code.includes('micropip.install')) {
            console.log('WPRDF: Injecting dependency loader for:', deps);
            const uniqueDeps = [...new Set(deps)];
            const installCell = `
@app.cell
async def __():
    import micropip
    await micropip.install(${JSON.stringify(uniqueDeps)})
    import pandas as pd
    import pyarrow as pa
    import io
    import base64
    from datetime import datetime
    return base64, datetime, io, pa, pd
`;
            // Insert after the app definition
            code = code.replace(/(app = marimo\.App\(.*?\))/, `$1\n${installCell}`);
        }

        // 3. Inject WPRDF SQLite Import Hook
        // This replaces the "Virtual FS Sync" with a scalable on-demand loader
        const importHook = `
@app.cell(hide_code=True)
def __():
    import sys
    import types
    import js
    from importlib.abc import Loader, MetaPathFinder
    from importlib.util import spec_from_loader

    class WPRDFLoader(Loader):
        def __init__(self, name, code):
            self.name = name
            self.code = code
        def exec_module(self, module):
            # Flatten Marimo code to standard Python on the fly
            flat_code = self.code
            if "app = marimo.App" in flat_code:
                import re
                # Extract cell bodies and join them
                bodies = re.findall(r'@app\\.cell(?:\\(.*?\\))?\\n(?:async )?def __\\(.*?\\):\\n(.*?)\\n\\s+return', flat_code, re.DOTALL)
                flat_code = "\\n\\n".join([b[1].replace("\\n    ", "\\n") for b in bodies if "micropip.install" not in b[1]])
            
            exec(flat_code, module.__dict__)

    class WPRDFPathFinder(MetaPathFinder):
        def find_spec(self, fullname, path, target=None):
            # Only handle top-level imports that exist in our DB
            code = js.wprdf.getNotebookCode(fullname)
            if code:
                return spec_from_loader(fullname, WPRDFLoader(fullname, code))
            return None

    # Register the finder if not already present
    if not any(isinstance(f, WPRDFPathFinder) for f in sys.meta_path):
        sys.meta_path.insert(0, WPRDFPathFinder())
    return
`;
        // Insert after the app definition
        code = code.replace(/(app = marimo\.App\(.*?\))/, `$1\n${importHook}`);

        return code;
    },

    setCurrentCode(code) {
        const preparedCode = this.prepareCode(code);
        console.log('WPRDF: Setting pending code and reloading iframe...');
        console.log('WPRDF: Code length:', code.length);
        
        // Store in sessionStorage so the bootloader inside the iframe can pick it up
        sessionStorage.setItem('wprdf_pending_code', preparedCode);
        
        this._isReloading = true;
        const iframe = document.getElementById('marimoFrame');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.location.reload();
            // Flag will be reset by detectCurrentNotebook if it sees the new code
            // or after a safety timeout
            setTimeout(() => { this._isReloading = false; }, 5000);
        }
    },
    
    handleMarimoMessage(event) {
        // Handle messages from Marimo iframe if needed
        if (event.data && event.data.type === 'marimo-ready') {
            console.log('WPRDF: Marimo iframe reported ready');
        }
    },
    
    detectCurrentNotebook() {
        if (this._isReloading) {
            console.log('WPRDF: Skipping detection during reload');
            return;
        }
        
        const currentCode = this.getCurrentCode();
        if (!currentCode) return;
        
        console.log('WPRDF: Detecting notebook from current code...');
        const result = this.db.exec("SELECT name FROM notebooks");
        if (result[0]) {
            for (const [name] of result[0].values) {
                const nbResult = this.db.exec("SELECT code FROM notebooks WHERE name = ?", [name]);
                if (nbResult[0] && nbResult[0].values[0][0] === currentCode) {
                    if (this.currentNotebook !== name) {
                        console.log(`WPRDF: Detected notebook change to "${name}"`);
                        this.currentNotebook = name;
                        this.updateNotebookList();
                    }
                    return;
                }
            }
        }
    },
    
    loadNotebook(name) {
        console.log(`WPRDF: Loading notebook "${name}"`);
        const result = this.db.exec("SELECT code FROM notebooks WHERE name = ?", [name]);
        if (!result[0]) {
            console.error(`WPRDF: Notebook "${name}" not found in DB`);
            this.showStatus(`Notebook "${name}" not found`, 'error');
            return;
        }
        
        const code = result[0].values[0][0];
        this.currentNotebook = name;
        this.setCurrentCode(code);
        this.toggleNotebookList(); // Close dropdown after loading
        this.showStatus(`Loading "${name}"...`, 'info');
    },
    
    async saveCurrentNotebook() {
        const code = this.getCurrentCode();
        if (!code) {
            this.showStatus('No code to save - marimo might not be loaded yet', 'error');
            return;
        }
        
        let name = this.currentNotebook;
        if (!name) {
            name = prompt('Save as:');
            if (!name) return;
        }
        
        const hash = await this.calculateHash(code);
        
        this.db.run(
            `INSERT INTO notebooks (name, hash, code, updated_at) 
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(name) DO UPDATE SET 
                hash = excluded.hash,
                code = excluded.code,
                updated_at = CURRENT_TIMESTAMP`,
            [name, hash, code]
        );
        
        this.currentNotebook = name;
        this.saveDB();
        this.showStatus(`Saved "${name}"`, 'success');
    },
    
    async createNotebook() {
        const name = prompt('Notebook name:');
        if (!name) return;
        
        const exists = this.db.exec("SELECT 1 FROM notebooks WHERE name = ?", [name]);
        if (exists[0]) {
            this.showStatus('Notebook already exists', 'error');
            return;
        }
        
        // Fetch template from server
        try {
            const response = await fetch('/api/template');
            const data = await response.json();
            let templateCode = data.code;
            
            // Inject footprint into template if it has placeholders
            const authorUri = this.getAuthorUri();
            const appUri = this.getAppUri();
            
            templateCode = templateCode.replace(/author\s*=\s*["'][^"']*["']/g, `author="${authorUri}"`);
            templateCode = templateCode.replace(/app\s*=\s*["'][^"']*["']/g, `app="${appUri}"`);
            
            const hash = await this.calculateHash(templateCode);
            
            this.db.run(
                "INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)",
                [name, hash, templateCode]
            );
            
            this.currentNotebook = name;
            this.saveDB();
            this.setCurrentCode(templateCode);
            this.showStatus(`Created "${name}"`, 'success');
        } catch (e) {
            console.error('Failed to fetch template:', e);
            this.showStatus('Failed to create notebook: template error', 'error');
        }
    },
    
    deleteNotebook(name) {
        if (!confirm(`Delete "${name}"?`)) return;
        
        this.db.run("DELETE FROM notebooks WHERE name = ?", [name]);
        
        if (this.currentNotebook === name) {
            this.currentNotebook = null;
        }
        
        this.saveDB();
        this.showStatus(`Deleted "${name}"`, 'success');
    },
    
    downloadDB() {
        const data = this.db.export();
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wprdf_codebase_${Date.now()}.db`;
        a.click();
        URL.revokeObjectURL(url);
        this.showStatus('Codebase downloaded', 'success');
    },
    
    async syncToServer() {
        const data = this.db.export();
        const base64 = btoa(String.fromCharCode.apply(null, data));
        
        try {
            const response = await fetch(this.serverUrl + '/api/sync/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ db: base64 })
            });
            
            const result = await response.json();
            this.showStatus(`Synced! ${result.notebook_count} notebooks on server`, 'success');
        } catch (error) {
            this.showStatus(`Sync failed: ${error.message}`, 'error');
        }
    },
    
    async syncFromServer() {
        if (!confirm('Merge server notebooks with local?')) return;
        
        try {
            const response = await fetch(this.serverUrl + '/api/sync/download');
            const result = await response.json();
            
            const serverData = Uint8Array.from(atob(result.db), c => c.charCodeAt(0));
            const SQL = await initSqlJs({
                locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
            });
            
            const serverDb = new SQL.Database(serverData);
            const serverNotebooks = serverDb.exec("SELECT name, hash, code FROM notebooks");
            
            if (serverNotebooks[0]) {
                serverNotebooks[0].values.forEach(([name, hash, code]) => {
                    // Validate that the code is a valid marimo app
                    if (!code.includes('app = marimo.App(')) {
                        console.warn(`WPRDF: Skipping invalid notebook "${name}" - not a marimo app`);
                        return;
                    }

                    const localExists = this.db.exec("SELECT hash FROM notebooks WHERE name = ?", [name]);
                    
                    if (!localExists[0]) {
                        this.db.run("INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)", [name, hash, code]);
                    } else if (localExists[0].values[0][0] !== hash) {
                        let index = 1;
                        let newName = `${name}_${index}`;
                        while (this.db.exec("SELECT 1 FROM notebooks WHERE name = ?", [newName])[0]) {
                            index++;
                            newName = `${name}_${index}`;
                        }
                        this.db.run("INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)", [newName, hash, code]);
                        this.showStatus(`Renamed "${name}" to "${newName}"`, 'info');
                    }
                });
            }
            
            this.saveDB();
            this.showStatus('Synced from server!', 'success');
        } catch (error) {
            this.showStatus(`Sync failed: ${error.message}`, 'error');
        }
    },
    
    syncToVirtualFS() {
        console.log('WPRDF: Syncing notebooks to virtual filesystem...');
        const result = this.db.exec("SELECT name, code FROM notebooks");
        if (result[0]) {
            result[0].values.forEach(([name, code]) => {
                // We can't directly write to Pyodide FS from here easily without a handle,
                // but we can store them in a way that prepareCode can inject them
                // or the bootloader can write them to the emscripten FS.
                console.log(`WPRDF: Prepared virtual module: ${name}.py`);
            });
        }
    },
    
    async resetLocalDatabase() {
        if (!confirm('⚠️ DANGER: This will delete ALL local notebooks and reset to server defaults. Continue?')) return;
        
        localStorage.removeItem('wprdf_codebase');
        this.showStatus('Local database cleared. Reloading...', 'info');
        
        // Re-initialize with empty DB and load defaults
        const SQL = await initSqlJs({
            locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
        });
        this.db = new SQL.Database();
        this.createSchema();
        await this.loadDefaultNotebooks(true);
        
        this.currentNotebook = null;
        this.saveDB();
        this.closeModal();
        
        // Reload the page to ensure a clean state
        window.location.reload();
    },

    setupEventListeners() {
        document.getElementById('wprdf-search').addEventListener('input', () => {
            this.updateNotebookList();
        });
        
        document.getElementById('wprdf-db-upload').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            const SQL = await initSqlJs({
                locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
            });
            
            this.db = new SQL.Database(uint8Array);
            this.saveDB();
            this.showStatus('Codebase loaded', 'success');
        });
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wprdf.init());
} else {
    wprdf.init();
}