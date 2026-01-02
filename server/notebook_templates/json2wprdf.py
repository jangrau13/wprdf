import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium")

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
def __():
    import marimo as mo
    return (mo,)

@app.cell
async def __():
    import micropip
    await micropip.install(["pandas"])
    import pandas as pd
    import json
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
        micropip,
        pd,
    )

if __name__ == "__main__":
    app.run()