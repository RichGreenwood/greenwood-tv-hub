# Greenwood Hub

Home screen for one Samsung TV (UE55RU7172, 2019, Tizen 5.0), loaded through TizenBrew.
Additive only: Samsung's Home bar, apps and settings stay exactly as they are.

**TizenBrew module name:** `gh/RichGreenwood/greenwood-tv-hub@<tag>` (always pin a tag; rollback = previous tag).

## Files
| Path | What |
|---|---|
| `package.json` | TizenBrew module manifest (packageType app) |
| `app/index.html`, `style.css`, `main.js` | The hub page (Chromium M63 safe, ES2017 max) |
| `app/theme.json` | All looks: colours, name, tiles, weather. Ričards edits this. |
| `app/apps.json` | Tile → native app ID or remote key. IDs come only from the TV's own app list. |
| `app/img/`, `app/fonts/` | Logo, watch layers, bundled fonts |
| `service.js` | Local key bridge on 127.0.0.1:8095 (HDMI, Menu, Source, Home only) |
| `docs/tizenbrew-review.md` | Code review of TizenBrew + installer |

## Preview on the PC
Open `app/index.html` with a local web server (e.g. `python -m http.server` in `app/`) at 1920×1080.
Arrows = remote, Enter = OK, Esc = Back.

## Rules
No telemetry, no ads, no remote code. Outbound: Open-Meteo weather only (plus jsDelivr serving these files).
