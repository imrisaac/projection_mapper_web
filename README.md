# Projection Mapper Web App

Browser-based starter for projection mapping calibration.

## Features

- Draggable 4-corner warp for keystone/perspective correction
- Homography transform applied via `matrix3d`
- Built-in calibration patterns: grid, checkerboard, crosshair, color bars
- Multiple objects per preset (each object is independently warped)
- Per-object shape mode: warped polygon/square or circle
- Per-object display mode: Pattern, Solid Color, or Video
- Video mapping per object (upload and assign videos to mapped objects)
- Custom projector resolution
- Save/load/delete calibration presets in `localStorage`
- Composite mode: display multiple saved presets simultaneously
- Fullscreen projection mode

## Run

Because this is a static app, use any local web server from the project root:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Usage

1. Set your projector output resolution.
2. Set each object's `Display Mode` in `Media` (`Pattern`, `Solid Color`, or `Video`).
3. In `Objects`, add/duplicate/delete mapped objects and select the one you want to edit.
4. For the selected object, drag the four corner handles and set shape to warped polygon/square or circle.
5. If using `Video`, choose a loaded file and apply it to the selected object.
6. Use `Apply To Preset` to attach a video directly to a saved preset object.
7. In `Presets`, use the composite checklist to display multiple presets together.
8. Use `Fullscreen Stage` for live projection.

## Next upgrades

- Add edge-blend masks for multi-projector setups
- Add bezier/mesh warp (more than 4 control points)
- Add image mapping per preset
- Open a dedicated operator window and output window
