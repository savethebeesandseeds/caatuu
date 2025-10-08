#!/usr/bin/env bash
# parse_project.sh
# Usage: ./parse_project.sh /path/to/project

folder="$1"
if [ -z "$folder" ]; then
  echo "Usage: $0 /path/to/project"
  exit 1
fi

# Where to save the output
outfile="temp.txt"
> "$outfile"  # clear if exists

# ---------------------------------------
# List of patterns or files to ignore
# ---------------------------------------
ignore_list=(
  "*/.git/*"
  "*/.github/*"
  "*/node_modules/*"
  "*/target/*"
  "*/dist/*"
  "*/build/*"
  "*/venv/*"
  "*/__pycache__/*"
  "*/.idea/*"
  "*/.vscode/*"
  "*/.DS_Store"
  "*.lock"
  "*.log"
  "*.png"
  "*.jpg"
  "*.jpeg"
  "*.gif"
  "*.ico"
  "*.svg"
  "*.pdf"
  "*.zip"
  "*.tar"
  "*.gz"
  "*.wasm"
  "*.exe"
  "*.dll"
  "*.bin"
  "*.so"
  "*.class"
)

# Build the exclusion arguments dynamically
exclude_args=()
for pattern in "${ignore_list[@]}"; do
  exclude_args+=( ! -path "$pattern" )
done

# ---------------------------------------
# Main loop
# ---------------------------------------
find "$folder" -type f "${exclude_args[@]}" | sort | while read -r file; do
  relpath="${file#$folder/}"
  echo "===== FILE: $relpath =====" >> "$outfile"
  cat "$file" >> "$outfile"
  echo -e "\n\n" >> "$outfile"
done

echo "✅ Project contents written to $outfile"
echo "   (relative paths, recursively included, with ignore list)"
