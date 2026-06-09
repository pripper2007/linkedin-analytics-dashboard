#\!/bin/bash
# Setup script: Run this once after cloning to copy LinkedIn data into the project
# Usage: ./scripts/setup.sh /path/to/your/linkedin-data-folder

DATA_SOURCE="${1:-$HOME/Library/CloudStorage/Dropbox/Linkedin data downloads}"

echo "Copying LinkedIn data from: $DATA_SOURCE"

# Copy master JSON
if [ -f "$DATA_SOURCE/linkedin_analytics_master.json" ]; then
  cp "$DATA_SOURCE/linkedin_analytics_master.json" data/
  echo "✓ Copied linkedin_analytics_master.json"
else
  echo "✗ linkedin_analytics_master.json not found at $DATA_SOURCE"
  exit 1
fi

# Copy LinkedIn export CSVs
EXPORT_DIR="$DATA_SOURCE/Basic_LinkedInDataExport_04-07-2026.zip"
if [ -d "$EXPORT_DIR" ]; then
  for f in "$EXPORT_DIR"/*.csv; do
    [ -f "$f" ] && cp "$f" data/linkedin-export/ && echo "✓ Copied $(basename "$f")"
  done
  # Copy subdirectories
  [ -d "$EXPORT_DIR/Jobs" ] && cp -r "$EXPORT_DIR/Jobs" data/linkedin-export/
  [ -d "$EXPORT_DIR/Articles" ] && cp -r "$EXPORT_DIR/Articles/Articles" data/linkedin-export/Articles
  [ -d "$EXPORT_DIR/Verifications" ] && cp -r "$EXPORT_DIR/Verifications" data/linkedin-export/
fi

# Copy SinglePostAnalytics XLSX files
for f in "$DATA_SOURCE"/SinglePostAnalytics_*.xlsx; do
  [ -f "$f" ] && cp "$f" data/single-post-analytics/ && echo "✓ Copied $(basename "$f")"
done

# Copy AggregateAnalytics XLSX files
for f in "$DATA_SOURCE"/AggregateAnalytics_*.xlsx; do
  [ -f "$f" ] && cp "$f" data/aggregate-analytics/ && echo "✓ Copied $(basename "$f")"
done

echo ""
echo "Setup complete\! Run 'npm run dev' to start the dashboard."
