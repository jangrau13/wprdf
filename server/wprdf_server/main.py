from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
import aiosqlite
import base64
from pathlib import Path
import logging
import os
import mimetypes

# Add proper MIME types for JavaScript
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/wasm', '.wasm')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="WPRDF Sync Server")

IS_DEV = os.getenv("ENV", "development") == "development"

# Paths - go up TWO levels from wprdf_server/main.py to reach server/
BASE_DIR = Path(__file__).parent.parent
ROOT_DIR = BASE_DIR.parent
DB_PATH = ROOT_DIR / "dev_data" / "notebooks.db"
WASM_DIR = BASE_DIR / "wasm_editor"

# Ensure wasm_editor exists
if not WASM_DIR.exists():
    logger.warning(f"WASM editor not found at {WASM_DIR}")
    logger.warning("Run ./setup_marimo_wasm.sh to generate it")

DB_PATH.parent.mkdir(parents=True, exist_ok=True)

class SyncUpload(BaseModel):
    db: str

class SyncResult(BaseModel):
    status: str
    notebook_count: int
    warnings: list[str] = []

async def init_db():
    """Initialize the database schema"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS notebooks (
                name TEXT PRIMARY KEY,
                hash TEXT NOT NULL,
                code TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()

@app.on_event("startup")
async def startup():
    await init_db()
    logger.info("WPRDF Sync Server running")
    logger.info(f"Database: {DB_PATH}")
    if IS_DEV:
        logger.info("http://localhost:8080")

@app.post("/api/sync/upload", response_model=SyncResult)
async def sync_upload(data: SyncUpload):
    """Upload and merge client database to server"""
    warnings = []
    
    try:
        client_db_bytes = base64.b64decode(data.db)
        temp_client_db = DB_PATH.parent / f"temp_client_{os.getpid()}.db"
        temp_client_db.write_bytes(client_db_bytes)
        
        try:
            async with aiosqlite.connect(temp_client_db) as client_db:
                async with client_db.execute(
                    "SELECT name, hash, code FROM notebooks"
                ) as cursor:
                    client_notebooks = await cursor.fetchall()
            
            async with aiosqlite.connect(DB_PATH) as server_db:
                for original_name, client_hash, code in client_notebooks:
                    async with server_db.execute(
                        "SELECT 1 FROM notebooks WHERE name = ? AND hash = ?", 
                        (original_name, client_hash)
                    ) as cursor:
                        exact_match = await cursor.fetchone()
                    
                    if exact_match:
                        continue
                    
                    async with server_db.execute(
                        "SELECT hash FROM notebooks WHERE name = ?", (original_name,)
                    ) as cursor:
                        name_collision = await cursor.fetchone()
                    
                    if not name_collision:
                        name = original_name
                    else:
                        index = 1
                        while True:
                            candidate_name = f"{original_name}_{index}"
                            async with server_db.execute(
                                "SELECT 1 FROM notebooks WHERE name = ?", (candidate_name,)
                            ) as cursor:
                                exists = await cursor.fetchone()
                            
                            if not exists:
                                name = candidate_name
                                break
                            index += 1
                        
                        warnings.append(f"Renamed '{original_name}' to '{name}'")
                    
                    await server_db.execute(
                        "INSERT INTO notebooks (name, hash, code, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                        (name, client_hash, code)
                    )
                
                await server_db.commit()
            
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute("SELECT COUNT(*) FROM notebooks") as cursor:
                    total_count = (await cursor.fetchone())[0]
            
            return SyncResult(
                status="success",
                notebook_count=total_count,
                warnings=warnings
            )
            
        finally:
            if temp_client_db.exists():
                temp_client_db.unlink()
    
    except Exception as e:
        logger.error(f"Sync upload failed: {e}")
        raise HTTPException(500, f"Sync failed: {str(e)}")

@app.get("/api/sync/download")
async def sync_download():
    """Download server database"""
    if not DB_PATH.exists():
        temp_db = DB_PATH.parent / f"temp_empty_{os.getpid()}.db"
        try:
            async with aiosqlite.connect(temp_db) as db:
                await db.execute("""
                    CREATE TABLE notebooks (
                        name TEXT PRIMARY KEY,
                        hash TEXT NOT NULL,
                        code TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                await db.commit()
            db_bytes = temp_db.read_bytes()
        finally:
            if temp_db.exists():
                temp_db.unlink()
    else:
        db_bytes = DB_PATH.read_bytes()
    
    db_base64 = base64.b64encode(db_bytes).decode()
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM notebooks") as cursor:
            count = (await cursor.fetchone())[0]
    
    return {"db": db_base64, "notebook_count": count}

@app.get("/api/template")
async def get_template():
    """Get the notebook template from the database"""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT code FROM notebooks WHERE name = 'template'") as cursor:
                row = await cursor.fetchone()
                if row:
                    return {"code": row[0]}
    except Exception as e:
        logger.error(f"Failed to fetch template from DB: {e}")
    
    # Fallback template
    return {"code": """import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")

@app.cell
def __():
    import marimo as mo
    return (mo,)

@app.cell
def __(mo):
    mo.md(\"\"\"
    # WPRDF Notebook
    
    Create RDF triples in Parquet format
    \"\"\")
    return

if __name__ == "__main__":
    app.run()
"""}

@app.get("/api/notebooks/defaults")
async def get_default_notebooks():
    """
    Get all notebooks from the server database to initialize the client.
    
    CRITICAL: The codebase is SQLite-only. Do NOT attempt to load notebooks 
    from the filesystem or any other source here. All notebooks must be 
    synced into the SQLite database (e.g., via dev/populate_db.py) 
    before they can be served.
    """
    if not DB_PATH.exists():
        return {"notebooks": []}
    
    notebooks = []
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT name, hash, code FROM notebooks") as cursor:
            async for row in cursor:
                notebooks.append({
                    "name": row[0],
                    "hash": row[1],
                    "code": row[2]
                })
    return {"notebooks": notebooks}

@app.get("/health")
async def health():
    """Health check endpoint"""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM notebooks") as cursor:
            count = (await cursor.fetchone())[0]
    return {
        "status": "ok",
        "mode": "development" if IS_DEV else "production",
        "notebook_count": count
    }

# Custom StaticFiles class with proper MIME types
class FixedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as e:
            # If controller.js is requested but missing, return 404 so Marimo falls back
            if path == "controller.js":
                raise e
            raise e
            
        # Fix MIME types for JavaScript files
        if path.endswith('.js') or path.endswith('.mjs'):
            response.headers['content-type'] = 'application/javascript; charset=utf-8'
        elif path.endswith('.css'):
            response.headers['content-type'] = 'text/css; charset=utf-8'
        elif path.endswith('.wasm'):
            response.headers['content-type'] = 'application/wasm'
        
        return response

# Mount static directories
if WASM_DIR.exists():
    marimo_dir = WASM_DIR / "marimo"
    
    if marimo_dir.exists():
        # CRITICAL: Mount /wasm FIRST (marimo expects its files at /wasm/)
        app.mount("/wasm", FixedStaticFiles(directory=marimo_dir, html=True), name="wasm")
        
        # Also mount at /marimo for iframe src
        app.mount("/marimo", FixedStaticFiles(directory=marimo_dir, html=True), name="marimo")
        
        # Mount assets separately
        assets_dir = marimo_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", FixedStaticFiles(directory=assets_dir), name="assets")
    
    # Serve wprdf static files
    wprdf_dir = WASM_DIR / "wprdf"
    if wprdf_dir.exists():
        app.mount("/wprdf", FixedStaticFiles(directory=wprdf_dir), name="wprdf")
    
    # Serve main wrapper page
    @app.get("/")
    async def root():
        index_file = WASM_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {"error": "index.html not found"}
else:
    @app.get("/")
    async def root():
        return {
            "error": "WASM editor not setup",
            "message": "Run ./setup_marimo_wasm.sh to generate the editor",
            "health": "/health",
            "sync_upload": "/api/sync/upload",
            "sync_download": "/api/sync/download"
        }