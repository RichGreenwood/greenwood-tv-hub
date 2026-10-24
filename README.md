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
| `app/i18n.js` | Texts in English, Latviešu, Français |
| `app/vendor/` | QR code generator (MIT, see CREDITS.md) |
| `service.js` | Local helper on 127.0.0.1:8095: app list + icons, app launch (allowlist), remote keys (HDMI, Menu, Source, Home), calendar, sleep timer, updates, /log |
| `.github/workflows/release.yml` | Creates tag + release from `package.json` version after an upload |
| `docs/tizenbrew-review.md` | Code review of TizenBrew + installer |

## Screens
Home (H3) with week strip · left MENU (Change look, Sleep timer, About, Samsung shortcuts) · right SCREENS (Calendar week, Weather, Daylight, All apps, Idle, Night view) · Connect calendars (QR, phone page) · idle (I3) with sun path and night mode · iPhone AirPlay card.

## Releasing an update
1. Raise `version` in `package.json` (and `VERSION` in `app/main.js` + `service.js`), add a CHANGELOG entry.
2. Push / upload to `main`. The workflow creates tag `v<version>` and the release.
3. On the TV: About → **Install update vX** (rollback: **Previous version**). The hub rewrites only its own entry in TizenBrew's module list (backup: `tizenbrewConfig.greenwood-backup.json`), starts the new helper and reloads.

## Preview on the PC
Open `app/index.html` with a local web server (e.g. `python -m http.server` in `app/`) at 1920×1080.
Arrows = remote, Enter = OK, Esc = Back.

## Rules
No telemetry, no ads, no remote code. Outbound: Open-Meteo weather, calendar.google.com (your secret iCal links, stored only on the TV), jsDelivr serving these files.
Secrets never go in this repo: calendar links and the remote-control token live in /home/owner/share on the TV.
