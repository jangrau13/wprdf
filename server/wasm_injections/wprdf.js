// WPRDF - Complete Notebook Codebase Management
const wprdf = {
    db: null,
    initialized: false,
    currentNotebook: null,
    serverUrl: window.location.origin,
    _isReloading: false, // Flag to prevent detection during reload
    _footprint: null, // Browser footprint hash
    
    async init() {
        if (this.initialized) return;
        console.log('Initializing WPRDF...');
        
        try {
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
            
            this.initialized = true;
            this.updateNotebookList();
            this.setupEventListeners();
            
            // Load default notebooks from server on first run
            if (!savedDb) {
                await this.loadDefaultNotebooks();
            }
            
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
        } catch (e) {
            console.error('WPRDF Initialization failed:', e);
            this.showStatus('Initialization failed. Please refresh.', 'error');
        }
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
        if (!this.db) {
            this.showStatus('Database not ready yet...', 'info');
            return;
        }
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
        if (!this.db) return null;
        const result = this.db.exec("SELECT code FROM notebooks WHERE name = ?", [name]);
        if (result[0] && result[0].values[0]) {
            return result[0].values[0][0];
        }
        return null;
    },
    
    async loadDefaultNotebooks(force = false) {
        if (!this.db) return;
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
        if (!this.db) return;
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
        if (!this.db) return;
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
        if (!this.db) return;
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
        
        // 0. Aggressively strip any existing infrastructure cells to prevent redefinition errors.
        // We look for cells that return 'sys', 'mo', or 'wprdf_import'.
        const infraRegex = /@app\.cell\(.*?\)\s+(?:async\s+)?def\s+__\(.*?\):[\s\S]*?return\s+[^@\n]*?\b(sys|mo|wprdf_import)\b[\s\S]*?(?=\n@app\.cell|\nif __name__|$)/g;
        code = code.replace(infraRegex, '');

        // 1. Master Infrastructure: The SOLE provider of 'sys', 'mo', and 'wprdf_import'.
        const masterInfra = `
@app.cell(hide_code=True)
def __():
    import sys
    import marimo as mo
    
    def wprdf_import(notebook_name, member_name=None):
        if "pyodide" not in sys.modules: return None
        types = sys.modules.get("types") or __import__("types")
        js = sys.modules.get("js") or __import__("js")
        re = sys.modules.get("re") or __import__("re")
        importlib_abc = sys.modules.get("importlib.abc") or __import__("importlib.abc").abc
        importlib_util = sys.modules.get("importlib.util") or __import__("importlib.util").util
        
        class WPRDFLoader(importlib_abc.Loader):
            def __init__(self, name, code):
                self.name, self.code = name, code
            def exec_module(self, module):
                flat_code = self.code
                if "app = marimo.App" in flat_code:
                    bodies = re.findall(r'@app\\\\.cell(?:\\\\(.*?\\\\))?\\\\n(?:async )?def __\\\\(.*?\\\\):\\\\n(.*?)\\\\n\\\\s+return', flat_code, re.DOTALL)
                    core_bodies = [b[2].replace("\\\\n    ", "\\\\n") for b in bodies 
                                 if "micropip.install" not in b[2] and not any(x in b[2] for x in ["mo.md", "mo.vstack", "mo.ui"])]
                    flat_code = "\\\\n\\\\n".join(core_bodies)
                exec(flat_code, module.__dict__)

        class WPRDFPathFinder(importlib_abc.MetaPathFinder):
            def find_spec(self, fullname, path, target=None):
                if js and hasattr(js, "wprdf") and hasattr(js.wprdf, "getNotebookCode"):
                    code = js.wprdf.getNotebookCode(fullname)
                    if code: return importlib_util.spec_from_loader(fullname, WPRDFLoader(fullname, code))
                return None

        if not any(f.__class__.__name__ == 'WPRDFPathFinder' for f in sys.meta_path):
            sys.meta_path.insert(0, WPRDFPathFinder())
        
        mod = __import__(notebook_name)
        return getattr(mod, member_name) if member_name else mod
        
    return mo, sys, wprdf_import
`;

        // Inject at the top of the app
        if (code.includes('app = marimo.App(')) {
            code = code.replace(/(app = marimo\.App\(.*?\))/, `$1\n${masterInfra}`);
        }

        // 2. Basic Marimo-ification if it's just a snippet
        if (!code.includes('app = marimo.App(')) {
            console.log('WPRDF: Wrapping plain Python code into Marimo app structure');
            
            let utils = '';
            if (code.includes('create_wprdf_row') || code.includes('WPRDF_COLUMNS')) {
                utils = `
@app.cell
def __(base64, datetime):
    WPRDF_COLUMNS = [
        'subject', 'predicate', 'object_type', 'object', 'literal_value',
        'technical_timestamp', 'business_validity_from',
        'business_validity_to', 'author', 'app'
    ]

    def create_wprdf_row(subject, predicate, obj, author="${authorUri}", app="${appUri}", business_from=None):
        obj_type = type(obj).__name__
        literal_value = str(obj)
        val = base64.b64encode(str(obj).encode('utf-8')).decode('utf-8') if not isinstance(obj, bytes) else base64.b64encode(obj).decode('utf-8')
        now = datetime.now().isoformat()
        return {
            'subject': str(subject), 'predicate': str(predicate), 'object_type': obj_type,
            'object': val, 'literal_value': literal_value, 'technical_timestamp': now,
            'business_validity_from': (business_from or now), 'business_validity_to': None,
            'author': author, 'app': app
        }
    return WPRDF_COLUMNS, create_wprdf_row
`;
            }

            code = `import marimo
app = marimo.App(width="medium")

@app.cell
def __():
    import marimo as mo
    import sys
    return mo, sys
${utils}
@app.cell
def __():
${code.split('\n').map(line => '    ' + line).join('\n')}
    return

if __name__ == "__main__":
    app.run()`;
        }

        return code;
    },

    setCurrentCode(code) {
        const iframe = document.getElementById('marimoFrame');
        if (iframe && iframe.contentWindow) {
            // We use sessionStorage to pass the code to the bootloader in the iframe
            sessionStorage.setItem('wprdf_pending_code', code);
            // Reload the iframe to trigger the bootloader
            iframe.contentWindow.location.reload();
        }
    },

    handleMarimoMessage(event) {
        if (event.data.type === 'MARIMO_CODE_UPDATE') {
            console.log('WPRDF: Received code update from Marimo');
            // This is handled by detectCurrentNotebook periodic check usually,
            // but we can trigger an immediate check here if needed.
        }
    },

    async createNotebook() {
        if (!this.db) return;
        const name = prompt('Enter notebook name:');
        if (!name) return;

        // Check if exists
        const exists = this.db.exec("SELECT name FROM notebooks WHERE name = ?", [name]);
        if (exists[0]) {
            alert('A notebook with this name already exists.');
            return;
        }

        const templateResponse = await fetch('/wprdf_template.py');
        let code = await templateResponse.text();
        
        // Prepare code with infrastructure
        code = this.prepareCode(code);
        const hash = await this.calculateHash(code);

        this.db.run("INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)", [name, hash, code]);
        this.saveDB();
        this.loadNotebook(name);
        this.showStatus(`Created notebook "${name}"`, 'success');
    },

    async saveCurrentNotebook() {
        if (!this.db) return;
        if (!this.currentNotebook) {
            const name = prompt('Save as new notebook:');
            if (!name) return;
            this.currentNotebook = name;
        }

        const code = this.getCurrentCode();
        if (!code) {
            this.showStatus('Could not retrieve code from Marimo', 'error');
            return;
        }

        const hash = await this.calculateHash(code);
        this.db.run(
            "INSERT OR REPLACE INTO notebooks (name, hash, code, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
            [this.currentNotebook, hash, code]
        );
        this.saveDB();
        this.showStatus(`Saved "${this.currentNotebook}"`, 'success');
    },

    async downloadDB() {
        if (!this.db) return;
        const data = this.db.export();
        const blob = new Blob([data], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'wprdf_codebase.db';
        a.click();
        URL.revokeObjectURL(url);
    },

    async syncToServer() {
        if (!this.db) return;
        try {
            this.showStatus('Pushing to server...', 'info');
            const result = this.db.exec("SELECT name, hash, code FROM notebooks");
            if (!result[0]) {
                this.showStatus('No notebooks to sync', 'info');
                return;
            }

            const notebooks = result[0].values.map(([name, hash, code]) => ({ name, hash, code }));
            const response = await fetch('/api/notebooks/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notebooks })
            });

            if (response.ok) {
                this.showStatus('Successfully synced to server', 'success');
            } else {
                this.showStatus('Sync failed: ' + response.statusText, 'error');
            }
        } catch (e) {
            this.showStatus('Sync error: ' + e.message, 'error');
        }
    },

    async syncFromServer() {
        if (!this.db) return;
        await this.loadDefaultNotebooks(true);
    },

    loadNotebook(name) {
        if (!this.db) return;
        const result = this.db.exec("SELECT code FROM notebooks WHERE name = ?", [name]);
        if (result[0] && result[0].values[0]) {
            this.currentNotebook = name;
            let code = result[0].values[0][0];
            
            // Ensure the notebook has the latest infrastructure injected
            code = this.prepareCode(code);
            
            this.setCurrentCode(code);
            this.updateNotebookList();
            this.showStatus(`Loaded "${name}"`, 'success');
        }
    },

    deleteNotebook(name) {
        if (!this.db) return;
        if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
        
        this.db.run("DELETE FROM notebooks WHERE name = ?", [name]);
        if (this.currentNotebook === name) this.currentNotebook = null;
        this.saveDB();
        this.showStatus(`Deleted "${name}"`, 'success');
    },

    resetLocalDatabase() {
        if (!confirm("This will delete ALL local notebooks and reload defaults. Continue?")) return;
        localStorage.removeItem('wprdf_codebase');
        window.location.reload();
    },

    detectCurrentNotebook() {
        if (this._isReloading) return;
        if (!this.db) return;
        
        const code = this.getCurrentCode();
        if (!code) return;

        // Try to find which notebook this code belongs to by hash
        this.calculateHash(code).then(hash => {
            const result = this.db.exec("SELECT name FROM notebooks WHERE hash = ?", [hash]);
            if (result[0] && result[0].values[0]) {
                const detectedName = result[0].values[0][0];
                if (this.currentNotebook !== detectedName) {
                    this.currentNotebook = detectedName;
                    this.updateNotebookList();
                }
            }
        });
    },

    setupEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('wprdf-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.updateNotebookList();
            });
        }

        // DB Upload
        const dbUpload = document.getElementById('wprdf-db-upload');
        if (dbUpload) {
            dbUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const arr = new Uint8Array(event.target.result);
                        // We need to ensure initSqlJs is available or use the existing one
                        initSqlJs({
                            locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
                        }).then(SQL => {
                            this.db = new SQL.Database(arr);
                            this.saveDB();
                            this.showStatus('Database loaded successfully', 'success');
                            window.location.reload();
                        });
                    } catch (err) {
                        this.showStatus('Failed to load database file', 'error');
                    }
                };
                reader.readAsArrayBuffer(file);
            });
        }
    }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    wprdf.init();
});