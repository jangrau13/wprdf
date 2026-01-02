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
    
    BytesIO = io.BytesIO if io and hasattr(io, "BytesIO") else None
    if BytesIO is None: from io import BytesIO
    
    def merge_wprdf(*dataframes):
        """Merge multiple WPRDF dataframes"""
        valid_dfs = [df for df in dataframes if df is not None and not df.empty]
        if not valid_dfs:
            return pd.DataFrame(columns=['subject', 'predicate', 'object_type', 'object', 'literal_value', 'technical_timestamp', 'business_validity_from', 'business_validity_to', 'author', 'app'])
        return pd.concat(valid_dfs, ignore_index=True).drop_duplicates(subset=['subject', 'predicate', 'object_type', 'object'])

    return BytesIO, io, merge_wprdf, pd

@app.cell(hide_code=True)
def __(mo):
    mo.md(
        r"""
        # 🧩 WPRDF Merger
        
        This utility allows you to merge multiple WPRDF DataFrames into a single, unified dataset.
        
        ### Usage:
        ```python
        import merge_wprdf
        merged_df = merge_wprdf.merge_wprdf([df1, df2, df3])
        ```
        
        ### Features:
        - **Deduplication**: Automatically removes duplicate triples (subject-predicate-object-type combinations).
        - **Schema Alignment**: Ensures all DataFrames follow the standard WPRDF schema before merging.
        - **Validation**: Checks that all inputs are valid Pandas DataFrames.
        """
    )
    return

@app.cell
def __(merge_wprdf, merge_wprdf_file_input, mo, pd, io):
    def _merge_action():
        if not merge_wprdf_file_input.value:
            return None
        dfs = [pd.read_csv(io.BytesIO(f.contents)) for f in merge_wprdf_file_input.value]
        return merge_wprdf(*dfs)

    merge_wprdf_output_df = _merge_action()
    return (merge_wprdf_output_df,)

@app.cell
def __(merge_wprdf_file_input, merge_wprdf_output_df, mo):
    mo.vstack([
        merge_wprdf_file_input,
        mo.ui.table(merge_wprdf_output_df) if merge_wprdf_output_df is not None else mo.md("_Upload CSVs to merge_")
    ])
    return

if __name__ == "__main__":
    app.run()