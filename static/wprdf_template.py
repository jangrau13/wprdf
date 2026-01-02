import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")

@app.cell
def __():
    import marimo as mo
    return (mo,)

@app.cell
def __(mo):
    mo.md("""
    # WPRDF Notebook
    
    Create RDF triples in Parquet format
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
