import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")

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
def __():
    import marimo as mo
    return (mo,)

@app.cell
def __(csv2wprdf, excel2wprdf, mo):
    file_input = mo.ui.file(label="Upload Excel and/or CSV", filetypes=[".xlsx", ".xls", ".csv"])
    return (file_input,)

@app.cell
def __(csv2wprdf, excel2wprdf, file_input):
    def process_file(file):
        if not file:
            return None
        
        # Get URIs from the environment (injected by WPRDF system)
        # For testing in this notebook, we'll use defaults
        author = "urn:wprdf:user:local"
        app = "urn:wprdf:app:local"
        
        if file.name.endswith('.csv'):
            return csv2wprdf(file.contents, author, app)
        else:
            return excel2wprdf(file.contents, author, app)

    output_df = process_file(file_input.value[0]) if file_input.value else None
    return output_df, process_file

@app.cell
def __(file_input, mo, output_df):
    mo.vstack([
        file_input,
        mo.ui.table(output_df) if output_df is not None else mo.md("_Upload a file to see the WPRDF conversion_")
    ])
    return

@app.cell
async def __():
    import micropip
    await micropip.install(["pandas", "openpyxl"])
    import pandas as pd
    from io import BytesIO
    import base64
    from datetime import datetime
    
    WPRDF_COLUMNS = [
        'subject', 'predicate', 'object_type', 'object',
        'technical_timestamp', 'business_validity_from',
        'business_validity_to', 'author', 'app'
    ]

    def create_wprdf_row(subject, predicate, obj, author="http://browser.app/user#default", app="http://browser.app/app#default", business_from=None):
        obj_type = type(obj).__name__
        val = base64.b64encode(str(obj).encode('utf-8')).decode('utf-8') if not isinstance(obj, bytes) else base64.b64encode(obj).decode('utf-8')
        now = datetime.now().isoformat()
        return {
            'subject': str(subject), 'predicate': str(predicate), 'object_type': obj_type,
            'object': val, 'technical_timestamp': now,
            'business_validity_from': (business_from or now), 'business_validity_to': None,
            'author': author, 'app': app
        }

    def excel2wprdf(excel_bytes, author_uri, app_uri):
        """Convert Excel file to WPRDF format"""
        df = pd.read_excel(BytesIO(excel_bytes))
        return _df2wprdf(df, author_uri, app_uri)

    def csv2wprdf(csv_bytes, author_uri, app_uri):
        """Convert CSV file to WPRDF format"""
        df = pd.read_csv(BytesIO(csv_bytes))
        return _df2wprdf(df, author_uri, app_uri)

    def _df2wprdf(df, author_uri, app_uri):
        rows = []
        for idx, row in df.iterrows():
            for col in df.columns:
                subject = f"urn:row:{idx}"
                predicate = f"urn:column:{col}"
                obj = row[col]
                
                rows.append(create_wprdf_row(
                    subject=subject,
                    predicate=predicate,
                    obj=obj,
                    author=author_uri,
                    app=app_uri
                ))
        
        return pd.DataFrame(rows, columns=WPRDF_COLUMNS)

    return (
        BytesIO,
        WPRDF_COLUMNS,
        _df2wprdf,
        base64,
        create_wprdf_row,
        csv2wprdf,
        datetime,
        excel2wprdf,
        micropip,
        pd,
    )

if __name__ == "__main__":
    app.run()