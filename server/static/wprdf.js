let db = null;
let marimoIframe = null;
let currentNotebookName = null;

function showStatus(message, type = 'info') {
    const statusBar = document.getElementById('statusBar');
    statusBar.className = 'mt-2 text-sm px-4 py-2 rounded';
    
    if (type === 'success') {
        statusBar.className += ' bg-green-50 text-green-800 border border-green-200';
    } else if (type === 'error') {
        statusBar.className += ' bg-red-50 text-red-800 border border-red-200';
    } else {
        statusBar.className += ' bg-blue-50 text-blue-800 border border-blue-200';
    }
    
    statusBar.textContent = message;
    statusBar.classList.remove('hidden');
    
    setTimeout(() => statusBar.classList.add('hidden'), 5000);
}

async function initDB() {
    const SQL = await initSqlJs({
        locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
    });
    
    const savedDb = localStorage.getItem('wprdf_codebase');
    if (savedDb) {
        const arr = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
        db = new SQL.Database(arr);
    } else {
        db = new SQL.Database();
        createSchema();
    }
    
    updateNotebookList();
    setupMarimoIframe();
}

function createSchema() {
    db.run(`
        CREATE TABLE IF NOT EXISTS notebooks (
            name TEXT PRIMARY KEY,
            hash TEXT NOT NULL,
            code TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function saveDB() {
    const data = db.export();
    const base64 = btoa(String.fromCharCode.apply(null, data));
    localStorage.setItem('wprdf_codebase', base64);
    updateNotebookList();
}

async function calculateHash(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Setup Marimo iframe
function setupMarimoIframe() {
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (!welcomeScreen) return;
    
    welcomeScreen.innerHTML = `
        <iframe 
            id="marimoFrame" 
            src="/wasm/index.html" 
            class="w-full h-full border-0"
            allow="cross-origin-isolated"
        ></iframe>
    `;
    
    marimoIframe = document.getElementById('marimoFrame');
    
    // Listen for messages from Marimo
    window.addEventListener('message', handleMarimoMessage);
    
    // Wait for iframe to load
    marimoIframe.addEventListener('load', () => {
        showStatus('Marimo editor ready', 'success');
    });
}

// Handle messages from Marimo iframe
function handleMarimoMessage(event) {
    // Verify origin if needed
    // if (event.origin !== window.location.origin) return;
    
    const { type, data } = event.data;
    
    switch (type) {
        case 'marimo-ready':
            showStatus('Marimo editor connected', 'success');
            break;
            
        case 'marimo-code-changed':
            // Optionally auto-save on change
            break;
            
        case 'marimo-save-request':
            saveCurrentNotebook(data.code);
            break;
    }
}

// Send notebook code to Marimo
function loadNotebookIntoMarimo(name) {
    const result = db.exec("SELECT code FROM notebooks WHERE name = ?", [name]);
    
    if (!result[0]) {
        showStatus(`Notebook "${name}" not found`, 'error');
        return;
    }
    
    const code = result[0].values[0][0];
    currentNotebookName = name;
    
    document.getElementById('currentNotebookName').textContent = `Editing: ${name}`;
    
    // Send code to Marimo iframe
    if (marimoIframe && marimoIframe.contentWindow) {
        marimoIframe.contentWindow.postMessage({
            type: 'load-notebook',
            code: code,
            name: name
        }, '*');
        
        showStatus(`Loaded "${name}" into editor`, 'success');
    } else {
        showStatus('Marimo editor not ready', 'error');
    }
}

// Save current notebook from Marimo
async function saveCurrentNotebook(code) {
    if (!currentNotebookName) {
        showStatus('No notebook is currently loaded', 'error');
        return;
    }
    
    // If no code provided, request it from Marimo
    if (!code && marimoIframe && marimoIframe.contentWindow) {
        marimoIframe.contentWindow.postMessage({
            type: 'get-code'
        }, '*');
        
        // Wait for response
        return new Promise((resolve) => {
            const handler = (event) => {
                if (event.data.type === 'marimo-code-response') {
                    window.removeEventListener('message', handler);
                    saveCurrentNotebook(event.data.code).then(resolve);
                }
            };
            window.addEventListener('message', handler);
            
            // Timeout after 5 seconds
            setTimeout(() => {
                window.removeEventListener('message', handler);
                showStatus('Failed to get code from editor', 'error');
                resolve();
            }, 5000);
        });
    }
    
    const hash = await calculateHash(code);
    
    db.run(
        "UPDATE notebooks SET code = ?, hash = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
        [code, hash, currentNotebookName]
    );
    
    saveDB();
    showStatus(`Saved "${currentNotebookName}"`, 'success');
}

function updateNotebookList() {
    const result = db.exec("SELECT name, hash, updated_at FROM notebooks ORDER BY updated_at DESC");
    const count = result[0] ? result[0].values.length : 0;
    
    document.getElementById('notebookCount').textContent = `${count} notebook${count !== 1 ? 's' : ''}`;
    
    const listDiv = document.getElementById('notebookList');
    listDiv.innerHTML = '';
    
    if (!result[0]) {
        listDiv.innerHTML = '<p class="p-4 text-sm text-gray-500">No notebooks yet</p>';
        return;
    }
    
    const search = document.getElementById('searchNotebooks').value.toLowerCase();
    
    result[0].values.forEach(([name, hash, updated]) => {
        if (search && !name.toLowerCase().includes(search)) return;
        
        const div = document.createElement('div');
        div.className = 'mb-2 p-3 rounded-lg transition border';
        
        if (currentNotebookName === name) {
            div.className += ' bg-blue-50 border-blue-300';
        } else {
            div.className += ' bg-gray-50 border-gray-200 hover:bg-gray-100';
        }
        
        div.innerHTML = `
            <div class="font-medium text-gray-800 mb-1">${name}</div>
            <div class="text-xs text-gray-500 mb-2">${hash.slice(0, 8)}</div>
            <div class="flex gap-2">
                <button onclick="loadNotebookIntoMarimo('${name}')" 
                        class="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                    ${currentNotebookName === name ? '✓ Active' : '✏️ Edit'}
                </button>
                <button onclick="downloadNotebook('${name}')" 
                        class="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700">
                    ⬇️
                </button>
                <button onclick="deleteNotebook('${name}')" 
                        class="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                    🗑️
                </button>
            </div>
        `;
        
        listDiv.appendChild(div);
    });
}

function filterNotebooks() {
    updateNotebookList();
}

function downloadNotebook(name) {
    const result = db.exec("SELECT code FROM notebooks WHERE name = ?", [name]);
    if (!result[0]) return;
    
    const code = result[0].values[0][0];
    const blob = new Blob([code], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.py`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(`Downloaded ${name}.py`, 'success');
}

function deleteNotebook(name) {
    if (!confirm(`Delete "${name}"?`)) return;
    
    if (currentNotebookName === name) {
        currentNotebookName = null;
        document.getElementById('currentNotebookName').textContent = '';
    }
    
    db.run("DELETE FROM notebooks WHERE name = ?", [name]);
    saveDB();
    showStatus(`Deleted "${name}"`, 'success');
}

function createNewNotebook() {
    const name = prompt('Notebook name:');
    if (!name) return;
    
    const exists = db.exec("SELECT 1 FROM notebooks WHERE name = ?", [name]);
    if (exists[0]) {
        showStatus('Notebook with this name already exists', 'error');
        return;
    }
    
    const template = `import marimo

__generated_with = "0.9.14"
app = marimo.App(width="medium")

@app.cell
def __():
    import marimo as mo
    return mo,

@app.cell
def __(mo):
    mo.md("""
    # ${name}
    
    WPRDF Notebook - Create RDF triples in Parquet format
    """)
    return

@app.cell
async def __():
    import micropip
    await micropip.install(["pandas"])
    import pandas as pd
    import io
    import base64
    from datetime import datetime
    return base64, datetime, io, micropip, pd

@app.cell
def __(base64, datetime, pd):
    WPRDF_COLUMNS = [
        'subject', 'predicate', 'object_type', 'object',
        'technical_timestamp', 'business_validity_from',
        'business_validity_to', 'author', 'app'
    ]
    
    def create_wprdf_row(subject, predicate, object_type, obj, author, app,
                         business_from=None, business_to=None):
        if isinstance(obj, bytes):
            obj_encoded = base64.b64encode(obj).decode('utf-8')
        else:
            obj_encoded = base64.b64encode(str(obj).encode('utf-8')).decode('utf-8')
        
        return {
            'subject': subject, 'predicate': predicate,
            'object_type': object_type, 'object': obj_encoded,
            'technical_timestamp': datetime.now().isoformat(),
            'business_validity_from': (business_from or datetime.now()).isoformat(),
            'business_validity_to': business_to.isoformat() if business_to else None,
            'author': author, 'app': app
        }
    
    return WPRDF_COLUMNS, create_wprdf_row

@app.cell
def __(WPRDF_COLUMNS, pd):
    def create_wprdf_dataframe(rows):
        if not rows:
            return pd.DataFrame(columns=WPRDF_COLUMNS)
        return pd.DataFrame(rows)
    return create_wprdf_dataframe,

if __name__ == "__main__":
    app.run()
`;
    
    calculateHash(template).then(hash => {
        db.run(
            "INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)",
            [name, hash, template]
        );
        saveDB();
        loadNotebookIntoMarimo(name);
    });
}

function downloadCodebase() {
    const data = db.export();
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wprdf_codebase_${Date.now()}.db`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Codebase downloaded', 'success');
}

document.getElementById('dbUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    const SQL = await initSqlJs({
        locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
    });
    
    db = new SQL.Database(uint8Array);
    saveDB();
    showStatus('Codebase loaded', 'success');
});

// Sync functions (same as before)
async function syncToServer() {
    const data = db.export();
    const base64 = btoa(String.fromCharCode.apply(null, data));
    
    try {
        const response = await fetch('/api/sync/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db: base64 })
        });
        
        const result = await response.json();
        
        if (result.warnings && result.warnings.length > 0) {
            showStatus(`Synced! Warnings: ${result.warnings.join(', ')}`, 'info');
        } else {
            showStatus(`Synced to server! ${result.notebook_count} notebooks`, 'success');
        }
    } catch (error) {
        showStatus(`Sync failed: ${error.message}`, 'error');
    }
}

async function syncFromServer() {
    if (!confirm('Merge server notebooks with local codebase?')) return;
    
    try {
        const response = await fetch('/api/sync/download');
        const result = await response.json();
        
        const serverData = Uint8Array.from(atob(result.db), c => c.charCodeAt(0));
        
        const SQL = await initSqlJs({
            locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
        });
        
        const serverDb = new SQL.Database(serverData);
        const serverNotebooks = serverDb.exec("SELECT name, hash, code FROM notebooks");
        
        if (serverNotebooks[0]) {
            serverNotebooks[0].values.forEach(([name, hash, code]) => {
                const localExists = db.exec("SELECT hash FROM notebooks WHERE name = ?", [name]);
                
                if (!localExists[0]) {
                    db.run("INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)", [name, hash, code]);
                } else if (localExists[0].values[0][0] !== hash) {
                    let index = 1;
                    let newName = `${name}_${index}`;
                    while (db.exec("SELECT 1 FROM notebooks WHERE name = ?", [newName])[0]) {
                        index++;
                        newName = `${name}_${index}`;
                    }
                    db.run("INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)", [newName, hash, code]);
                    showStatus(`Conflict: "${name}" saved as "${newName}"`, 'info');
                }
            });
        }
        
        saveDB();
        showStatus('Synced from server!', 'success');
    } catch (error) {
        showStatus(`Sync failed: ${error.message}`, 'error');
    }
}

async function loadExamples() {
    const examples = ['excel2wprdf', 'json2wprdf', 'merge_wprdf'];
    let loaded = 0;
    
    for (const name of examples) {
        try {
            const response = await fetch(`/static/notebooks/${name}.py`);
            if (response.ok) {
                const code = await response.text();
                const hash = await calculateHash(code);
                
                db.run(
                    "INSERT OR IGNORE INTO notebooks (name, hash, code) VALUES (?, ?, ?)",
                    [name, hash, code]
                );
                loaded++;
            }
        } catch (error) {
            console.error(`Failed to load ${name}:`, error);
        }
    }
    
    saveDB();
    showStatus(`Loaded ${loaded} example notebooks!`, 'success');
}

window.addEventListener('load', async () => {
    await initDB();
});