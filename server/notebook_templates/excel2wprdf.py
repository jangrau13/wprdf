import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")

@app.cell(hide_code=True)
async def __():
    # WPRDF: sys and mo are provided by the master infrastructure in wprdf.js
    # We only handle notebook-specific dependencies here defensively.
    import sys
    micropip = sys.modules.get("micropip")
    if micropip is None:
        import micropip
            
    _pkgs = ["pandas", "openpyxl"]
    await micropip.install(_pkgs)
    return

@app.cell(hide_code=True)
def __(sys):
    # 2. Core Logic: Imports & WPRDF Functions
    # WPRDF: Defensive imports - check sys.modules first to avoid redundant loading in WASM.
    pd = sys.modules.get("pandas") or __import__("pandas")
    
    BytesIO = sys.modules.get("io").BytesIO if "io" in sys.modules else None
    if BytesIO is None: from io import BytesIO
    
    base64 = sys.modules.get("base64") or __import__("base64")
    
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

    def excel2wprdf(excel_bytes, author_uri, app_uri, config=None):
        try:
            df = pd.read_excel(BytesIO(excel_bytes), engine='openpyxl')
            new_columns = [str(c).replace('\n', ' ').strip() if not str(c).startswith('Unnamed:') else f"col_{i}" for i, c in enumerate(df.columns) ]
            df.columns = new_columns
            return dr2wprdf(df, author_uri, app_uri, config)
        except Exception:
            df = pd.read_excel(BytesIO(excel_bytes))
            return dr2wprdf(df, author_uri, app_uri, config)

    def csv2wprdf(csv_bytes, author_uri, app_uri, config=None):
        try:
            df = pd.read_csv(BytesIO(csv_bytes), sep=None, engine='python')
        except:
            df = pd.read_csv(BytesIO(csv_bytes))
        df.columns = [str(c).replace('\n', ' ').strip() if not str(c).startswith('Unnamed:') else f"col_{i}" for i, c in enumerate(df.columns)]
        return dr2wprdf(df, author_uri, app_uri, config)

    def dr2wprdf(df, author_uri, app_uri, config=None):
        config = config or {}
        subject_col = config.get("subject_col")
        subject_prefix = config.get("subject_prefix", "urn:row:")
        predicate_prefix = config.get("predicate_prefix", "urn:column:")
        rows = []
        for idx, row in df.iterrows():
            row_subject = f"{subject_prefix}{row[subject_col]}" if subject_col and subject_col in df.columns else f"{subject_prefix}{idx}"
            for col in df.columns:
                if col == subject_col or pd.isna(row[col]): continue
                rows.append(create_wprdf_row(row_subject, f"{predicate_prefix}{col}", row[col], author_uri, app_uri))
        return pd.DataFrame(rows, columns=WPRDF_COLUMNS)

    return (
        BytesIO,
        WPRDF_COLUMNS,
        base64,
        create_wprdf_row,
        csv2wprdf,
        datetime,
        dr2wprdf,
        excel2wprdf,
        pd,
    )

@app.cell(hide_code=True)
def __(mo):
    mo.md(
        r"""
        # 📊 Excel & CSV to WPRDF Converter
        
        This notebook provides utility functions to convert Excel and CSV files into the WPRDF (Wide Parquet RDF) format.
        
        ### Usage:
        ```python
        import excel2wprdf
        
        # 1. Load your file as bytes
        with open("data.xlsx", "rb") as f:
            file_bytes = f.read()
            
        # 2. Convert to WPRDF
        df = excel2wprdf.excel2wprdf(file_bytes, "user:uri", "app:uri")
        ```
        
        ### Interactive Upload:
        Use the file uploader below to test your files and see the WPRDF output.
        """
    )
    return

@app.cell
def __(mo):
    excel2wprdf_file_input = mo.ui.file(label="Upload Excel or CSV", filetypes=[".xlsx", ".xls", ".csv"])
    return (excel2wprdf_file_input,)

@app.cell
def __(
    excel2wprdf_file_input,
    mo,
):
    # UI for mapping columns
    excel2wprdf_subject_col = mo.ui.dropdown(
        options=["(Row Index)"] + ([f.name for f in excel2wprdf_file_input.value] if excel2wprdf_file_input.value else []),
        label="Subject Column",
        value="(Row Index)"
    )
    
    excel2wprdf_predicate_prefix = mo.ui.text(label="Predicate Prefix", value="urn:column:")
    excel2wprdf_subject_prefix = mo.ui.text(label="Subject Prefix", value="urn:row:")
    
    return excel2wprdf_subject_col, excel2wprdf_predicate_prefix, excel2wprdf_subject_prefix

@app.cell
def __(
    csv2wprdf,
    excel2wprdf,
    excel2wprdf_file_input,
    mo,
    excel2wprdf_predicate_prefix,
    excel2wprdf_subject_col,
    excel2wprdf_subject_prefix,
):
    def excel2wprdf_process_file(file):
        if not file:
            return None
        
        author = "urn:wprdf:user:local"
        app = "urn:wprdf:app:local"
        
        config = {
            "subject_col": excel2wprdf_subject_col.value if excel2wprdf_subject_col.value != "(Row Index)" else None,
            "subject_prefix": excel2wprdf_subject_prefix.value,
            "predicate_prefix": excel2wprdf_predicate_prefix.value
        }
        
        if file.name.endswith('.csv'):
            return csv2wprdf(file.contents, author, app, config)
        else:
            return excel2wprdf(file.contents, author, app, config)

    excel2wprdf_output_df = excel2wprdf_process_file(excel2wprdf_file_input.value[0]) if excel2wprdf_file_input.value else None
    
    # Use mo.download instead of mo.ui.download
    excel2wprdf_download_btn = mo.download(
        label="Download WPRDF Parquet",
        filename="data.parquet",
        data=lambda: excel2wprdf_output_df.to_parquet() if excel2wprdf_output_df is not None else None,
        disabled=excel2wprdf_output_df is None
    )
    
    return excel2wprdf_download_btn, excel2wprdf_output_df, excel2wprdf_process_file

@app.cell
def __(
    excel2wprdf_file_input,
    mo,
    excel2wprdf_output_df,
    excel2wprdf_predicate_prefix,
    excel2wprdf_subject_col,
    excel2wprdf_subject_prefix,
    excel2wprdf_download_btn,
):
    mo.vstack([
        mo.md("# 📊 Excel to WPRDF"),
        mo.md("1. **Upload** your Excel or CSV file."),
        excel2wprdf_file_input,
        mo.md("2. **Configure** (Optional)"),
        mo.hstack([excel2wprdf_subject_col, excel2wprdf_subject_prefix, excel2wprdf_predicate_prefix]) if excel2wprdf_file_input.value else mo.md(""),
        mo.md("3. **Download & Save**"),
        mo.hstack([
            excel2wprdf_download_btn,
            mo.md("💡 *After downloading, you can save this file to your local OPFS storage for persistence.*")
        ]) if excel2wprdf_output_df is not None else mo.md("_Upload a file to enable download_"),
        mo.ui.table(excel2wprdf_output_df) if excel2wprdf_output_df is not None else mo.md("")
    ])
    return

if __name__ == "__main__":
    app.run()