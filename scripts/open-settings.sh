#!/bin/bash
# Opens GitHub settings pages for all repos to set social previews
# Usage: ./scripts/open-settings.sh

echo "Opening GitHub settings pages to set social previews..."
echo "In each repo: Settings > Social preview > Edit > Upload an image"
echo "The image is already at: .github/social-preview.png"
echo ""

repos=(
  "catalysts"
  "ai-changelog"
  "anti-slop-lib"
  "whp-app"
  "prmpt-hstry"
  "rev-agg"
  "github-tndr"
  "coursebuilder"
  "habit-snapper"
  "ai-assistant-grows"
  "chart-predictoor"
  "kab-query"
  "spaces-chat"
)

for repo in "${repos[@]}"; do
  echo "Opening: $repo"
  open "https://github.com/rohunvora/$repo/settings"
  sleep 1
done

echo ""
echo "Done! Set the social preview in each tab."
echo "Tip: You can download from .github/social-preview.png and upload it"
