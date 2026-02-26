# Projection Mapper Web App

Browser-based projection mapping app with multi-object warping, media assignment, and dedicated Raspberry Pi HDMI output mode.

## Features

- Draggable 4-corner warp for keystone/perspective correction
- Homography transform applied via `matrix3d`
- Built-in calibration patterns: grid, checkerboard, crosshair, color bars
- Multiple objects per preset (each object is independently warped)
- Per-object shape mode: warped polygon/square or circle
- Per-object display mode: Pattern, Solid Color, or Video
- Video mapping per object (upload and assign videos to mapped objects)
- Per-object video transparency slider (0-100%)
- Custom projector resolution
- Save/load/delete calibration presets in `localStorage`
- Composite mode: display multiple presets simultaneously
- Dedicated HDMI output mode (`?mode=output`) for fullscreen stage-only display
- Real-time sync API for remote operator control and Pi output display

## Run

Run the built-in sync server from the project root:

```bash
node server.js
```

Then open:
- Operator UI: `http://localhost:8080/`
- Output-only UI: `http://localhost:8080/?mode=output`

Note: The old static-server approach still works for local-only editing, but multi-device sync and shared video uploads require `node server.js`.

## Usage

1. Set your projector output resolution.
2. Set each object's `Display Mode` in `Media` (`Pattern`, `Solid Color`, or `Video`).
3. In `Objects`, add/duplicate/delete mapped objects and select the one you want to edit.
4. For the selected object, drag the four corner handles and set shape to warped polygon/square or circle.
5. If using `Video`, choose a loaded file, apply it, then set `Video Transparency`.
6. Use `Apply To Preset` to attach a video directly to a saved preset object.
7. In `Presets`, use the composite checklist to display multiple presets together.
8. Use `Fullscreen Stage` for live projection.

## Raspberry Pi HDMI Kiosk

1. Start the server on the Pi:
```bash
cd /home/pi/projection_mapper
node server.js
```
2. On the Pi HDMI display, open fullscreen output mode:
```bash
/home/pi/projection_mapper/pi/open-output-kiosk.sh
```
3. From a remote computer on the same network, open:
```text
http://<PI_IP_ADDRESS>:8080/
```
4. The Pi HDMI screen should stay on:
```text
http://localhost:8080/?mode=output
```

## Boot Autostart (Pi)

Server autostart via systemd:
1. Copy service file:
```bash
sudo cp /home/pi/projection_mapper/pi/projection-mapper.service /etc/systemd/system/
```
2. Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now projection-mapper.service
```

Chromium kiosk autostart (desktop session):
1. Edit autostart file:
```bash
nano /home/pi/.config/lxsession/LXDE-pi/autostart
```
2. Add this line:
```text
@/home/pi/projection_mapper/pi/open-output-kiosk.sh
```

## Next upgrades

- Add edge-blend masks for multi-projector setups
- Add bezier/mesh warp (more than 4 control points)
- Add image mapping per preset
- Open a dedicated operator window and output window
