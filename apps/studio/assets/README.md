# macOS installer artwork

Regenerate the SVG and the 1×/2× PNG backgrounds with:

```sh
node --experimental-strip-types scripts/generate-dmg-background.ts
```

The generator uses Studio's light theme tokens, Inter font, and the regular preview dot grid, with uniform opacity and no fades. Finder uses a static background image, so this surface stays light in either macOS appearance.

The instruction uses 16 px type. Native filename labels use 14 pt type, configured by `apps/studio/patches/ds-store+0.1.6.patch` because the packaging library hardcodes this value rather than exposing a label-size option.

The postinstall patch helper skips absent optional packages, so the macOS-only label patch does not prevent dependency installation on other platforms.

Edit the generator for artwork changes. The native icon positions and window size live in `scripts/dmg-layout.ts`, shared by both DMG build paths.

To preview the native installer around an existing packaged app, run `npm run make:dmg-arm64` or `npm run make:dmg-x64`. The packaged app must already exist in `apps/studio/out/Studio-darwin-<architecture>/Studio.app`.
