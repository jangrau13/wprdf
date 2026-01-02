#!/bin/bash

set -e

echo "Setting up WPRDF - Automated Setup"

# Create template notebook
# (Removed: template is now managed via notebook_templates/wprdf_template.py and populate_db.py)

mkdir -p ./static

# Create marimo directory
mkdir -p ./wasm_editor/marimo/assets

# Export the template to WASM
echo "Exporting template to WASM..."
# Export marimo into marimo/ subdirectory - don't touch it!
echo "y" | uv run marimo export html-wasm ./notebook_templates/wprdf_template.py \
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

# Use a more robust way to inject the bootloader that works in both macOS and Linux
# and avoids "File name too long" errors with sed
python3 -c '
import sys
with open("/tmp/bootloader.html", "r") as f:
    bootloader = f.read()
with open("./wasm_editor/marimo/index.html", "r") as f:
    content = f.read()
with open("./wasm_editor/marimo/index.html", "w") as f:
    f.write(content.replace("<head>", "<head>" + bootloader))
'

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