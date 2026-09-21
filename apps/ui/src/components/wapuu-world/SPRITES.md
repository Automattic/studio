# Easter Egg Sprite Creation Guide

This documents the workflow for creating pixel art sprites for the Wapuu platformer easter egg. The code side is handled by Claude Code — this covers the manual art pipeline.

## Sprite specifications

| Asset | File | Frames | Frame size | Strip size |
|---|---|---|---|---|
| Wapuu walk | `wapuu-player-sprite.png` | 4 | 32×32px | 128×32px |
| Wapuu idle | `wapuu-player-idle-sprite.png` | 1 | 32×32px | 32×32px |
| Gutenberg block | `wapuu-gutenberg-sprite.png` | 4 | 32×32px | 128×32px |
| Mguy enemy | `wapuu-mguy-sprite.png` | 4 | 32×32px | 128×32px |
| Coin / collectible | `wapuu-sprites-coin.png` | 1 | 32×32px | 32×32px |
| Ground / platform tile | `wapuu-sprites-tiles.png` | 2 | 32×32px each | any |
| Flag | `wapuu-flag-sprite.png` | 1 | 32×64px | 32×64px |
| Water wave | `wapuu-wave-sprite.png` | 2 | 32×32px | 64×32px |
| Far background | `wapuu-bg-far.png` | — | 1024×1024px | — |
| Near background | `wapuu-bg-near.png` | — | 1024×757px | — |

Frames are arranged in a **horizontal strip** (left to right). All character sprites use a transparent background (RGBA PNG).

## Workflow

### 1. Generate base image
Use **OpenAI Platform → Images** ([platform.openai.com](https://platform.openai.com)) with their latest image model. Prompt for the character or object you need. Download when happy with the result.

### 2. Crop to subject
Cut out the single sprite or animation subject, removing whitespace around it. Any image editor works (Preview, Figma, etc.).

### 3. Convert to real pixel art — Unfaker
Open in **Unfaker** ([jenissimo.itch.io/unfaker](https://jenissimo.itch.io/unfaker)) to turn AI-generated "fake" pixel art into proper pixel art. Key settings to play with:
- Scale down to target 32px height
- Adjust palette reduction and outline options to get a clean look
- Export the result

### 4. Edit frames and export — Piskel
Open the result in **Piskelapp** ([piskelapp.com](https://www.piskelapp.com/p/create/sprite)):
- Split animation frames by duplicating the canvas and removing the non-needed parts of each frame
- Remove the background to make it transparent
- Align all frames consistently (feet at the same y position, horizontally centered)
- Use the animation preview to check the loop looks right
- **Save the `.piskel` source file** (File → Download) and drop it into `apps/studio/src/modules/wapuu-world/piskel/` — this lets you reopen and tweak the sprite without starting over
- Export as a sprite sheet (PNG, horizontal strip)

### 5. Add to project and wire up
Drop the exported PNG into `apps/studio/src/modules/wapuu-world/assets/`. Then ask Claude Code to update the renderer to use it — provide the filename, frame count, and frame size.

## Source files (Piskel)

`.piskel` source files live in `apps/studio/src/modules/wapuu-world/piskel/`. They are **not imported by code** — they exist only so sprites can be reopened and edited in Piskel without starting from scratch. Commit them alongside the exported PNGs so the full pipeline is in source control.

The `.piskel` format is JSON with base64-encoded PNG layers embedded directly — each file is self-contained and human-readable.

## Tips
- Keep feet anchored at the same pixel row across all frames — the renderer bottom-aligns sprites to the hitbox, so vertical drift between frames will look like bouncing
- 32×32px is the sweet spot for this game's tile size; going larger (e.g. 32×64) is fine for taller characters but needs a note when telling Claude the frame size
- Transparent backgrounds are required — white backgrounds will show as white rectangles in game
