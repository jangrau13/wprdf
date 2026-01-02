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
    
    json = sys.modules.get("json")
    if json is None: import json
    
    base64 = sys.modules.get("base64")
    if base64 is None: import base64
    
    # datetime is a bit special as we usually want the class
    if "datetime" in sys.modules:
        from datetime import datetime
    else:
        from datetime import datetime
    
    WPRDF_COLUMNS = [
        'subject', 'predicate', 'object_type', 'object', 'literal_value',
        'technical_timestamp', 'business_validity_from',
        'business_validity_to', 'author', 'app'
    ]

    def create_wprdf_row(subject, predicate, obj, author="http://browser.app/user#default", app="http://browser.app/app#default", business_from=None):
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

    def json2wprdf(json_bytes, author_uri, app_uri, base_subject="urn:json:root"):
        """Convert JSON to WPRDF format"""
        data = json.loads(json_bytes)
        
        def flatten(obj, subject):
            rows = []
            if isinstance(obj, dict):
                for key, value in obj.items():
                    predicate = f"urn:json:key:{key}"
                    if isinstance(value, (dict, list)):
                        child_subject = f"{subject}/{key}"
                        rows.extend(flatten(value, child_subject))
                    else:
                        rows.append(create_wprdf_row(
                            subject=subject,
                            predicate=predicate,
                            obj=value,
                            author=author_uri,
                            app=app_uri
                        ))
            elif isinstance(obj, list):
                for idx, item in enumerate(obj):
                    child_subject = f"{subject}[{idx}]"
                    rows.extend(flatten(item, child_subject))
            return rows
        
        rows = flatten(data, base_subject)
        return pd.DataFrame(rows, columns=WPRDF_COLUMNS)

    return (
        WPRDF_COLUMNS,
        base64,
        create_wprdf_row,
        datetime,
        json,
        json2wprdf,
        pd,
    )

@app.cell(hide_code=True)
def __(mo):
    mo.md(
        r"""
        # 📄 JSON to WPRDF Converter
        
        This notebook provides a utility function to flatten nested JSON structures into the WPRDF (Wide Parquet RDF) format.
        
        ### Usage:
        ```python
        import json2wprdf
        df = json2wprdf.json2wprdf(json_bytes, author_uri, app_uri)
        ```
        
        ### Features:
        - **Recursive Flattening**: Automatically handles nested dictionaries and lists.
        - **URI Generation**: Generates subjects based on the JSON path (e.g., `urn:json:root/user/name`).
        - **Type Preservation**: Records the original JSON type in the `object_type` column.
        """
    )
    return

@app.cell
def __(mo):
    json2wprdf_file_input = mo.ui.file(label="Upload JSON", filetypes=[".json"])
    return (json2wprdf_file_input,)

@app.cell
def __(json2wprdf, json2wprdf_file_input, mo):
    json2wprdf_output_df = (
        json2wprdf(json2wprdf_file_input.value[0].contents, "urn:wprdf:user:local", "urn:wprdf:app:local")
        if json2wprdf_file_input.value
        else None
    )
    return (json2wprdf_output_df,)

@app.cell
def __(json2wprdf_file_input, json2wprdf_output_df, mo):
    mo.vstack([
        mo.md("# 📄 JSON to WPRDF"),
        json2wprdf_file_input,
        mo.ui.table(json2wprdf_output_df) if json2wprdf_output_df is not None else mo.md("_Upload a JSON file to see the WPRDF conversion_")
    ])
    return

if __name__ == "__main__":
    app.run()