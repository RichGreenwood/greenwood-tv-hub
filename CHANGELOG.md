# Changelog

## 0.3.0 — 2026-10-24 (not released)
- Split the single-file preview (0.2.1) into real module files: app/index.html, style.css, main.js, img/, fonts/, theme.json, apps.json.
- WATCH row: Tet+ replaces Megogo.
- apps.json: native app IDs filled from the TV's own app list (apps.csv, 24 Oct).
- Remote keys (HDMI 1–3, Menu, Source, Home) now go through service.js → wss://127.0.0.1:8002 with a saved token. The TV refuses plain ws://:8001.
- service.js: fixed key allowlist, 127.0.0.1 only, no dependencies, survives being started twice.

## 0.2.1 — preview only
- H3 layout, CLK-4 watch (pre-rendered layers, only hands rotate), H3-D drawer, iPhone AirPlay card, Open-Meteo weather (cached 30 min).
