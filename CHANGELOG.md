# Changelog

## 0.7.7 — 2026-10-28
- Home: gold and silver under the week strip, in euros per gram of pure metal (gold 24K, silver 999), with a gold and a silver bar icon, today's change (▲/▼ in € and %) and a 30-day line. Refreshes every minute; dims if the prices are more than 30 minutes old.
- The hub helper reads the prices through a new local /metals endpoint (cached 55 s): live spot from xaus.com (fallback Yahoo Finance COMEX futures, then gold-api.com), EUR rate from Yahoo (fallback Frankfurter/ECB), today's change and 30 days from Yahoo daily closes. Public market data only, no account or key.

## 0.7.6 — 2026-10-26
- Quick play starts on this TV. Every station was failing with "timeout": the TV's own Samsung player takes longer to start a live stream than the 12 s the hub allowed. Each address now gets 20 s, and up to 45 s while it is visibly moving forward (data arriving in the buffer, header read, ready). The player sits in the page, loads straight away and is asked to play again once it is ready.
- The hub helper now passes streams on the way radio servers do (no chunked encoding, no keep-alive), which Samsung's player handles best, and gives up on a station that does not answer within 10 s.
- If a station still does not start, About › Quick play says how far it got and what the helper received (e.g. "helper got 0 KB, no answer in 10 s · direct timeout (connected)"), on up to two lines, so the next fix is never a guess.
- About › Sound test plays a 2-second chime stored in the hub: heard = the TV's player works; silent = the problem is the player, not the stations. The button shows the last result.

## 0.7.5 — 2026-10-25
- iPhone card: the Join home Wi-Fi side now shows the network name and the password in large type under a bigger QR code, so any guest can join: scan with any phone camera (iPhone or Android) or type it in. The card is wider to fit. The password is still kept only on the TV (Menu › Calendar & Wi-Fi).

## 0.7.4 — 2026-10-25
- New menu item **Calendar & Wi-Fi** (between Sleep timer and Updates) opens the phone setup screen directly, instead of Menu › About › Connect calendars. The phone page connects Google Calendar (secret iCal address) and saves the home Wi-Fi password for the iPhone card QR; both stay only on the TV.
- iPhone card: while no Wi-Fi password is saved, OK opens that setup screen. Once it is saved, the card shows the Join home Wi-Fi QR.
- The phone page confirms what it saved (calendars, Wi-Fi or both).

## 0.7.3 — 2026-10-25
- Quick play no longer cuts itself off. A short gap in a station's data ("stalled") no longer counts as a failure: sound keeps playing from the buffer, and if the buffer runs dry the hub waits up to 12 s for the sound to move again before it reconnects. The 20-second no-sound check only runs once the clock has been seen moving.
- About › Quick play now also shows how many times the station reconnected in the last hour and why, to tell a weak connection from a station problem.

## 0.7.2 — 2026-10-25
- Quick play keeps playing. Once a station has played, a drop no longer turns it off: the stream ending, an error, a stall longer than 12 s or 20 s with no sound all reconnect by themselves (Reconnecting…), starting from the address that worked, waiting 2, 4, 8, 15, 30 then every 60 s.
- Stations with newer certificates play. The hub helper now carries the current public root certificates (Let's Encrypt, Sectigo, Google, Amazon, DigiCert, GlobalSign …) and uses them when the TV's 2019 list cannot check a station. Certificates are always checked. On the TV, https stations go through the helper first, and an https address on the standard port is also tried over plain http as a last resort.
- The helper closes a stream that sends nothing for 20 s, so the hub notices and reconnects instead of sitting silent.
- Radio Skonto added to Latvian radio.

## 0.7.1 — 2026-10-25
- Quick play uses Ričards's own station picks (14 stations): Latvian radio (SWH Rock, Pieci, Kurzemes Radio, Latvijas Radio 2), Lounge & jazz (Lounge FM, Jazz Radio, Radio Swiss Jazz, Jazz Radio Lounge, Lounge laut.fm), Lo-fi & chill (REYFM Lo-fi, Chillax FM, Nordic Chillout Radio) and a new News & talk row (BBC World Service, France Inter).

## 0.7.0 — 2026-10-25
- Quick play radio fixed. Each station address now gets 12 seconds to start before the next one is tried (0.6.0 could wait on "Connecting…" forever), a failed start is counted once (0.6.0 could skip the backup address), and the TV no longer tries .m3u8 streams it cannot play. Every address is also tried through the hub helper, which handles old Shoutcast servers, redirects and stations whose certificates are newer than the TV's own list (certificates are still checked). About shows the last Quick play result.
- Week strip: on Sundays it starts with today and runs to Saturday; Monday to Saturday it is Monday to Sunday. Saturday and Sunday in their own colour: soft blue on Sundays, coral red the rest of the week.
- Idle screen: name days, a "now" block (temperature, condition, feels like, rain outlook), next 10 hours in 2-hour steps with rain chance, time to sunset inside the sun arc with the day length under the horizon, today's next two meetings. Night view stays calm and centred.
- Weather screen: spacing on one 8 px grid, roomier detail tiles, day length under sunrise/sunset, and a wind row (direction arrow + m/s, amber in strong gusts) every 3 hours.
- Daylight globe lit by the real sun: day and night with a soft gold twilight band, one slow turn every 4 minutes, redrawn only when it moves.
- All apps shows only the kept apps (apps.json `_show`, 12 for now) and a stats bar for storage, memory and processor.
- Menu: Change look, Sleep timer, Updates, TV info, About (Samsung shortcuts removed). New Updates page (install, check, previous version; badge in the menu). New TV info page (model, system, screen, network, hub, remote keys; ring gauges for storage, memory, processor). About links to both.
- iPhone card: "Join home Wi-Fi" QR code. The network name comes from the TV; the password is added once on the phone setup page (Connect calendars) and kept only on the TV.

## 0.6.0 — 2026-10-25
- Weather screen redesigned: now, feels like, high/low and a plain-language outlook (rain timing, wind, tomorrow); wind, rain, humidity, UV, pressure, sunrise tiles; 24-hour temperature curve with rain chance; 7-day forecast with temperature range bars.
- Daylight screen: Greenwood-style globe turning in the middle of the sun path (drawn on the TV from Natural Earth land data, public domain; slows down or stops by itself on a slow TV), Rīga marked; first/last light, golden hours, solar noon, day length and change vs yesterday; Moon card (phase, % lit, age, next full and new moon); daylight through the year.
- Quick play radio on home: Latvian radio (LR1, LR2, LR3 Klasika, SWH, Star FM), lounge & jazz, lo-fi. Plays while the hub stays on screen; stops when another app or input opens. Stations in app/radio.json.
- Idle screen: next 5 hours of weather; shows the playing station. Night view brighter.
- All apps: only the apps from Samsung's own app list (same as the TV's Apps screen), Samsung Promotion and Privacy Choices hidden; filtered fallback if that list is not available.
- Sleep timer: confirms the TV really switched off and retries over the TV's network address (max 3 tries). About shows the last remote-key result and has "Test remote keys" (volume up + down).

## 0.5.2 — 2026-10-24
- First start of a new version tidies TizenBrew's list by itself: older Greenwood Hub entries are removed and autolaunch moves to the new version (other modules untouched, backup kept). No autolaunch setting needed on the TV.
- Remote keys: if the local remote channel refuses, the helper retries over the TV's own network address.

## 0.5.1 — 2026-10-24
- One-click updates: About shows "Install update vX" when a newer release exists (and a small badge on home). The hub points TizenBrew to the new version itself, starts it and reloads; no module names to type. "Previous version" rolls back the same way. TizenBrew's settings are backed up first (tizenbrewConfig.greenwood-backup.json).
- Clean hand-over between versions: a new helper asks the old one to free its port, and the sleep timer carries over.
- Calendar setup from a phone or laptop: the TV shows a QR code, web address and code; the page there takes the two Google Calendar links. No Claude needed.
- Automatic releases: uploading files with a new package.json version creates the matching tag (GitHub Actions).
- All apps fallback list (apps.json) included.

## 0.5.0 — 2026-10-24
- Two side panels: left MENU (Change look, Sleep timer, About + Samsung shortcuts), right SCREENS (Calendar, Weather, Daylight, All apps, Idle screen, Night view). Right from the last tile or the right edge tab opens it; Back or Left closes.
- Calendar: personal + Aerones Google calendars via their secret iCal links (stored only on the TV). Today's meetings on home; week strip Mon-Sun under them (today lit, dot = meetings). Calendar screen shows the next 7 days, days without meetings left out, "+N more" per day. service.js reads Monday of this week to today+7, every 15 min; time zones (incl. clock changes), repeating, moved, cancelled and all-day meetings handled.
- One-time calendar setup: About -> Connect calendars shows a 6-digit code; the laptop sends the links to port 8096 only while the code is shown (10 min, 5 wrong tries max, Google links only).
- Languages: English (default), Latviešu, Français. Optional second language shown smaller next to the main one (greeting, date, labels, menus, screens, weather words). Latvian name days (data: slikts/vardadienas, MIT).
- Daylight: sun path for Rīga — day arc with the sun's current position, dashed night arc with the moon, sunrise/sunset, day length, "Sunset in / Sunrise in". Uses Open-Meteo sunrise/sunset, calculated locally if offline. Shown on the Daylight screen and the idle screen.
- Idle screen: watch moves left; right panel with date, weather, sun path, next meeting.
- Night view (Screens) and automatic night mode 22:00-07:00 (theme.json "night"): dimmed watch, date and sun path.
- Weather screen: 3-day forecast with sunrise and sunset (same Open-Meteo request).
- Change look: watch face gold / silver / digital, language, second language, guest mode, night mode. Every option is wired and saved on the TV.
- Guest mode: hides your name and meeting titles ("Busy").
- Sleep timer: 15/30/60/90/120 min; at the end the helper switches the TV off only if it is still on.
- About screen: version, helper, remote keys, weather and calendar age, free storage, network.

## 0.4.0 — 2026-10-24
- New: All apps screen. Every installed app (read live from the TV by service.js, with real icons), Greenwood tile style, 6 per row, most used first, D-pad + Back. Fallback list from apps.json if the live list is not available. Opened from the menu and from the new "All apps" button in CONNECT.
- New: I3 idle screen. After 20 s without a key on the home screen (theme.json idleSeconds), the watch moves to the centre with date and weather. Any key wakes. Never over video; does not block the TV's auto power off. Also "Idle screen now" in the menu.
- New: weather icon follows the weather (sun/moon, partly cloudy, cloud, fog, rain, snow, storm).
- Clock and timers pause while another app is on screen; weather refreshes when you come back.
- service.js: /apps and /icon (icons only for apps on the TV's own list), launch allowlist = fixed IDs + the TV's own app list.
- Remote-key messages name the matching remote button as a fallback.

## 0.3.2 — 2026-10-24
- Remote keys (Settings, Sources, Samsung Home, HDMI): on-screen error now shows the exact cause, e.g. "key failed (closed / ms.channel.connect)".
- service.js: client name sent like samsungtvws (proven on this TV from the laptop), waits 1 s before closing, retries once if the TV closes the connection (first "Allow"), queues presses instead of refusing them, keeps a short log at 127.0.0.1:8095/log.

## 0.3.1 — 2026-10-24
- Fix: on the TV the hub showed "PC preview" and did not open apps. TizenBrew serves the page from 127.0.0.1:8081 without the Tizen API, so the page now detects TizenBrew by its address.
- App tiles now open apps through service.js (/launch, fixed allowlist of the six app IDs). Tested against a simulated TizenBrew page.
- Preview badge hidden on the TV.

## 0.3.0 — 2026-10-24 (tag v0.3.0, first run on the TV)
- Split the single-file preview (0.2.1) into real module files: app/index.html, style.css, main.js, img/, fonts/, theme.json, apps.json.
- WATCH row: Tet+ replaces Megogo.
- apps.json: native app IDs filled from the TV's own app list (apps.csv, 24 Oct).
- Remote keys (HDMI 1–3, Menu, Source, Home) now go through service.js → wss://127.0.0.1:8002 with a saved token. The TV refuses plain ws://:8001.
- service.js: fixed key allowlist, 127.0.0.1 only, no dependencies, survives being started twice.

## 0.2.1 — preview only
- H3 layout, CLK-4 watch (pre-rendered layers, only hands rotate), H3-D drawer, iPhone AirPlay card, Open-Meteo weather (cached 30 min).
