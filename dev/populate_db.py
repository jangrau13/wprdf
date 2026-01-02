import sqlite3
import os
import hashlib
from pathlib import Path
import datetime

# Paths relative to this script's location
SCRIPT_DIR = Path(__file__).parent.absolute()
ROOT_DIR = SCRIPT_DIR.parent
DB_PATH = ROOT_DIR / "dev_data" / "notebooks.db"
TEMPLATES_DIR = ROOT_DIR / "server" / "notebook_templates"

def calculate_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def populate():
    print(f"🔍 Checking for notebooks in {TEMPLATES_DIR}...")
    
    if not TEMPLATES_DIR.exists():
        print(f"❌ Error: {TEMPLATES_DIR} does not exist.")
        return

    if not DB_PATH.parent.exists():
        DB_PATH.parent.mkdir(parents=True)
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Ensure table exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notebooks (
            name TEXT PRIMARY KEY,
            hash TEXT NOT NULL,
            code TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    files = list(TEMPLATES_DIR.glob("*.py"))
    
    if not files:
        print("⚠️ No .py files found in templates directory.")
        return

    for notebook_file in files:
        # If it's the template, name it 'template', otherwise use stem
        name = 'template' if notebook_file.name == 'wprdf_template.py' else notebook_file.stem
        code = notebook_file.read_text()
        h = calculate_hash(code)
        
        cursor.execute("SELECT 1 FROM notebooks WHERE name = ?", (name,))
        if cursor.fetchone():
            print(f"🔄 Updating {name}...")
            cursor.execute(
                "UPDATE notebooks SET code = ?, hash = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?", 
                (code, h, name)
            )
        else:
            print(f"✨ Adding {name}...")
            cursor.execute(
                "INSERT INTO notebooks (name, hash, code) VALUES (?, ?, ?)", 
                (name, h, code)
            )
            
    conn.commit()
    conn.close()
    print(f"✅ Database populated with {len(files)} notebooks.")

if __name__ == "__main__":
    populate()
