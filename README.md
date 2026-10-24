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
| `app/img/`, `app/img/silver/`, `app/fonts/` | Logo, watch layers (gold + silver), bundled fonts |
| `app/data/` | Latvian name days (MIT, see CREDITS.md) |
| `service.js` | Local helper on 127.0.0.1:8095: app list + icons, app launch (allowlist), remote keys (HDMI, Menu, Source, Home), /log |
| `docs/tizenbrew-review.md` | Code review of TizenBrew + installer |

## Screens
Home (H3) · menu drawer (H3-D) · All apps · Calendar · Weather · Change look · Sleep timer · About · Connect calendars · idle (I3) with night mode · iPhone AirPlay card.

## Preview on the PC
Open `app/index.html` with a local web server (e.g. `python -m http.server` in `app/`) at 1920×1080.
Arrows = remote, Enter = OK, Esc = Back.

## Rules
No telemetry, no ads, no remote code. Outbound: Open-Meteo weather, calendar.google.com (your secret iCal links, stored only on the TV), jsDelivr serving these files.
Secrets never go in this repo: calendar links and the remote-control token live in /home/owner/share on the TV.
