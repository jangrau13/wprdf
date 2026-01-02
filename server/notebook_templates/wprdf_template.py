import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")

@app.cell(hide_code=True)
async def __():
    # WPRDF: sys is injected globally by wprdf.js. 
    # We do NOT import it here to avoid "Multiple definitions" errors in Marimo.
    
    # Checked import of marimo
    mo = sys.modules.get("marimo")
    if mo is None:
        import marimo as mo
    
    # 1. Infrastructure: WASM Environment & Dependencies
    if "pyodide" in sys.modules:
        micropip = sys.modules.get("micropip")
        if micropip is None:
            import micropip
            
        _pkgs = []
        # Check if pandas is already available
        if "pandas" not in sys.modules:
            try:
                import pandas as pd
            except ImportError:
                _pkgs.append("pandas")
        
        if _pkgs:
            await micropip.install(_pkgs)
        
    return (mo, sys)

@app.cell(hide_code=True)
def __(sys):
    # 2. Core Logic: Imports & WPRDF Functions
    # WPRDF: Defensive imports - check sys.modules first to avoid redundant loading in WASM.
    # This ensures we use the already-initialized environment and avoid "Variable redefined" errors.
    pd = sys.modules.get("pandas")
    if pd is None: import pandas as pd
    
    io = sys.modules.get("io")
    if io is None: import io
    
    base64 = sys.modules.get("base64")
    if base64 is None: import base64
    
    if "datetime" in sys.modules:
        from datetime import datetime
    else:
        from datetime import datetime
    
    WPRDF_COLUMNS = [
        'subject', 'predicate', 'object_type', 'object', 'literal_value',
        'technical_timestamp', 'business_validity_from',
        'business_validity_to', 'author', 'app'
    ]
    
    def create_wprdf_row(subject, predicate, object_type, obj, author, app,
                         business_from=None, business_to=None):
        literal_value = str(obj)
        if isinstance(obj, bytes):
            obj_encoded = base64.b64encode(obj).decode('utf-8')
        else:
            obj_encoded = base64.b64encode(str(obj).encode('utf-8')).decode('utf-8')
        
        now = datetime.now().isoformat()
        return {
            'subject': subject, 'predicate': predicate,
            'object_type': object_type, 'object': obj_encoded,
            'literal_value': literal_value,
            'technical_timestamp': now,
            'business_validity_from': (business_from or now),
            'business_validity_to': business_to if business_to else None,
            'author': author, 'app': app
        }

    def create_wprdf_dataframe(rows):
        if not rows:
            return pd.DataFrame(columns=WPRDF_COLUMNS)
        return pd.DataFrame(rows)

    return (
        WPRDF_COLUMNS,
        base64,
        create_wprdf_dataframe,
        create_wprdf_row,
        datetime,
        io,
        pd,
    )

@app.cell(hide_code=True)
def __(mo):
    mo.md("""
    # WPRDF Notebook
    
    Create RDF triples in Parquet format
    """)
    return

@app.cell(hide_code=True)
def __(mo):
    wprdf_file_input = mo.ui.file(label="Upload Data")
    return (wprdf_file_input,)

@app.cell(hide_code=True)
def __(mo, wprdf_file_input):
    mo.vstack([
        mo.md("### Preview"),
        wprdf_file_input
    ])
    return

if __name__ == "__main__":
    app.run()
