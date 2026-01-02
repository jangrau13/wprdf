#!/bin/bash

set -e

echo "Setting up WPRDF - Automated Setup"

# Create template notebook
cat > /tmp/wprdf_template.py << 'EOF'
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
EOF

mkdir -p ./static

echo "Saving template..."
cp /tmp/wprdf_template.py ./static/wprdf_template.py

# Create marimo directory
mkdir -p ./wasm_editor/marimo/assets

# Export the template to WASM
echo "Exporting template to WASM..."
# Export marimo into marimo/ subdirectory - don't touch it!
echo "y" | uv run marimo export html-wasm /tmp/wprdf_template.py \
    -o ./wasm_editor/marimo \
    --mode edit \
    --show-code

# Copy WPRDF modules
echo "Copying WPRDF modules from wasm_injections..."

if [ ! -d "./wasm_injections" ]; then
    echo "ERROR: wasm_injections directory not found"
    echo "Please create it with the required files: wprdf.css, wprdf.js, wprdf-ui.html"
    exit 1
fi

# Post-process the generated index.html to add a bootloader script
# This script runs BEFORE Marimo's main JS and replaces the code if a pending notebook exists
echo "Injecting bootloader into marimo/index.html..."
BOOTLOADER='<script>
  (function() {
    const pending = sessionStorage.getItem("wprdf_pending_code");
    if (pending) {
      console.log("WPRDF Bootloader: Found pending code, injecting into marimo-code");
      const observer = new MutationObserver((mutations) => {
        const el = document.querySelector("marimo-code");
        if (el) {
          el.textContent = encodeURIComponent(pending);
          console.log("WPRDF Bootloader: Successfully injected code");
          sessionStorage.removeItem("wprdf_pending_code");
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  })();
</script>'

# Insert the bootloader at the start of <head>
# We use a temporary file to avoid complex escaping with sed
echo "$BOOTLOADER" > /tmp/bootloader.html
sed -i '' "s|<head>|<head>$(cat /tmp/bootloader.html | tr -d '\n')|" ./wasm_editor/marimo/index.html

cp ./wasm_injections/wprdf.css ./wasm_editor/wprdf/
cp ./wasm_injections/wprdf.js ./wasm_editor/wprdf/

# Create the wrapper index.html (DO NOT inject into marimo's HTML!)
cp ./wasm_injections/wprdf-ui.html ./wasm_editor/index.html

echo ""
echo "WPRDF setup complete"
echo ""
echo "Structure:"
echo "  wasm_editor/"
echo "  ├── index.html (WPRDF wrapper - loads marimo in iframe)"
echo "  ├── marimo/ (Clean marimo WASM editor)"
echo "  │   ├── index.html"
echo "  │   └── assets/"
echo "  └── wprdf/"
echo "      ├── wprdf.css"
echo "      └── wprdf.js"
echo ""
echo "To test locally: cd wasm_editor && python -m http.server 8080"
echo "To start server: cd ../dev && ./start.sh"