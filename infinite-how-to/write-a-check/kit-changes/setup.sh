#!/usr/bin/env bash
# Motion Studio setup (adapted Oct 30 2026: uses the container's pre-installed Playwright + Chromium instead of pinning 1.56.1)
set -e
cd "$(dirname "$0")"
[ -f package.json ] || npm init -y >/dev/null
npm i -s @fontsource/cormorant-garamond@5 @fontsource/cinzel@5 @fontsource/jetbrains-mono@5 @fontsource-variable/archivo@5 @fontsource/inter@5 @fontsource/fredoka@5 @fontsource/caveat@5 @fontsource/nunito@5 >/dev/null
mkdir -p node_modules
# link the container's pre-installed Playwright (its location differs between images)
for d in "$(dirname "$(dirname "$(node -e "console.log(require.resolve('playwright/package.json'))" 2>/dev/null || echo /x/x/x)")")" "$(npm root -g)" /opt/node-tools/node_modules /usr/local/lib/node_modules_global ${NODE_PATH//:/ }; do
  [ -e node_modules/playwright ] || { [ -d "$d/playwright" ] && ln -s "$d/playwright" node_modules/playwright; }
  [ -e node_modules/playwright-core ] || { [ -d "$d/playwright-core" ] && ln -s "$d/playwright-core" node_modules/playwright-core; }
done
[ -e node_modules/playwright ] || { echo "Playwright not found"; exit 1; }
pip install --break-system-packages -q numpy scipy soundfile pyloudnorm pedalboard pillow librosa 2>/dev/null || true
sed "s#__FS__#$(pwd)/node_modules/@fontsource#g" web/page.tpl.html > web/page.html
command -v ffmpeg >/dev/null || { echo "ffmpeg missing"; exit 1; }
mkdir -p build out scenes
echo "Motion Studio ready."
