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
    # 2. Core Logic: Imports
    # WPRDF: Defensive imports - check sys.modules first to avoid redundant loading in WASM.
    # This ensures we use the already-initialized environment and avoid "Variable redefined" errors.
    pd = sys.modules.get("pandas")
    if pd is None: import pandas as pd
    
    io = sys.modules.get("io")
    if io is None: import io
    
    return io, pd

@app.cell(hide_code=True)
def __(mo):
    mo.md(
        r"""
        # 🏗️ WPRDF Orchestrator
        
        This notebook demonstrates how to build a pipeline by importing functions from your other notebooks.
        The WPRDF system automatically synchronizes all your notebooks to the local filesystem, allowing standard Python imports.
        
        ### Pipeline Steps:
        1. **Excel Source** (`excel2wprdf`): Converts Excel bytes to WPRDF Pandas DataFrame.
        2. **JSON Source** (`json2wprdf`): Flattens JSON bytes to WPRDF Pandas DataFrame.
        3. **Merge Utility** (`merge_wprdf`): Combines multiple WPRDF DataFrames.
        """
    )
    return

@app.cell
def __(mo):
    mo.md("## 1. Import from other notebooks")
    return

@app.cell
def __():
    # These are imported from the database via wprdf_import (injected by wprdf.js)
    try:
        excel2wprdf = wprdf_import("excel2wprdf")
        json2wprdf = wprdf_import("json2wprdf")
        merge_wprdf = wprdf_import("merge_wprdf")
        status = "✅ All modules imported successfully"
    except Exception as e:
        status = f"❌ Import failed: {str(e)}"
    
    return excel2wprdf, json2wprdf, merge_wprdf, status

@app.cell
def __(mo, status):
    mo.md(f"**Status:** {status}")
    return

@app.cell
def __(mo):
    mo.md(
        r"""
        ## 2. Run Pipeline
        This example simulates processing an Excel file and a JSON file, then merging them.
        """
    )
    return

@app.cell
def __(excel2wprdf, io, json2wprdf, merge_wprdf, mo):
    def run_pipeline():
        # 1. Process Excel (Mock data)
        excel_data = b"mock excel content"
        df1 = excel2wprdf.excel2wprdf(excel_data, "user:1", "app:1")
        
        # 2. Process JSON (Mock data)
        json_data = b'{"key": "value"}'
        df2 = json2wprdf.json2wprdf(json_data, "user:1", "app:1")
        
        # 3. Merge
        merged = merge_wprdf.merge_wprdf([df1, df2])
        
        return f"Pipeline execution simulated! Merged {len(merged)} rows."

    run_btn = mo.ui.button(label="Run Full Pipeline", on_click=lambda _: run_pipeline())
    return run_btn, run_pipeline

@app.cell
def __(run_btn):
    run_btn
    return

if __name__ == "__main__":
    app.run()
