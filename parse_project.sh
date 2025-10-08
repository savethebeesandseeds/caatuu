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

# Walk recursively, skipping heavy folders
find "$folder" -type f \
  ! -path "*/.git/*" \
  ! -path "*/node_modules/*" \
  ! -path "*/target/*" \
  ! -path "*/dist/*" \
  | sort | while read -r file; do
    relpath="${file#$folder/}"
    echo "===== FILE: $relpath =====" >> "$outfile"
    cat "$file" >> "$outfile"
    echo -e "\n\n" >> "$outfile"
  done

echo "✅ Project contents written to $outfile"
echo "   (relative paths, recursively included)"
