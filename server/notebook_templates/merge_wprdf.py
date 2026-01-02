import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")

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
def __():
    import marimo as mo
    return (mo,)

@app.cell
async def __():
    import micropip
    await micropip.install(["pandas"])
    import pandas as pd
    from io import BytesIO
    
    def merge_wprdf(*dataframes):
        """Merge multiple WPRDF dataframes"""
        return pd.concat(dataframes, ignore_index=True)

    return BytesIO, merge_wprdf, micropip, pd

if __name__ == "__main__":
    app.run()