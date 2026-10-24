# TizenBrew code review (Stage 3 prep, 24 Oct 2026)

Read-only review. Nothing installed. Source read from GitHub (shallow clones):

- `reisxd/TizenBrew` — commit 14760a3 (2026-05-18) · GPL-3.0 · widget v2.0.5, app id `xvvl3S1bvH.TizenBrewStandalone`
- `reisxd/TizenBrewInstaller` — commit 579e2d2 (2026-07-28) · GPL-3.0

## What the TizenBrew Installer Desktop does (our case: Tizen 5.0)

1. Runs a local web page on the laptop: `http://localhost:8091`.
2. Connects to the TV's SDB debug port `<TV_IP>:26101`. This only works with Developer Mode ON and Host PC IP = the laptop.
3. Gets the latest `.wgt` release from GitHub `reisxd/TizenBrew` (api.github.com, then the file download).
4. Copies it to `/home/owner/share/tmp/sdk_tools/` on the TV and installs it with `vd_appinstall`. That is the same standard install Tizen Studio uses.
5. Re-signing and a Samsung certificate are used only on Tizen 7+. **Not used on our TV.**
6. It does not uninstall anything and does not touch firmware or network settings.
   - Exception: on Tizen 3.0 TVs only, it sets Developer IP to 127.0.0.1 itself. Our TV runs Tizen 5.0, so this doesn't apply.

## What TizenBrew itself does on the TV

- **One app plus a background service.** The service listens only on `127.0.0.1:8081`, a local port the TV doesn't expose to the network.
- **Privileges:** internet, tv.inputdevice, application.launch, recorder/mediacapture (for TizenTube voice), unlimitedstorage. No settings, no package management.
- **Modules load from jsDelivr:** `https://cdn.jsdelivr.net/<module>/...`. For us that means `gh/RichGreenwood/greenwood-tv-hub@<tag>`.
  - The hub page is served through TizenBrew at `http://127.0.0.1:8081/module/...`.
- **Needs internet to load the hub.** Each launch fetches the hub from jsDelivr. With no internet, the hub doesn't load; the Samsung TV is unaffected.
- **Module service files** (our `service.js`) run in TizenBrew's Node service with full Node access. Only code we write and review goes there.
- **Config file:** `/home/owner/share/tizenbrewConfig.json` holds the module list, auto-launch module and auto-launch services.
  - Default module: TizenTube (`npm/@foxreis/tizentube`).
- **TizenBrew checks Developer Mode at start:** it expects Developer IP = 127.0.0.1 and Developer Mode = 1. This matches our rule 5.

## Risk verdict

Low, and inside the rule book:

- standard app install
- no root
- no system changes on Tizen 5
- removable from the Apps menu like any app

**Licence:** TizenBrew is GPL-3.0. We use it as is and copy none of its code into the hub. Our hub stays MIT.

## Stage 4 plan (needs Ričards, one step at a time)

1. **Developer Mode ON, Host PC IP = laptop.** Apps → type 12345 → Developer Mode On → laptop IP → restart TV. Photo first.
2. **Download the TizenBrew Installer Desktop for Windows** from github.com/reisxd/TizenBrewInstaller/releases. Claude checks the file name and size first.
3. **Run it.** Choose **Install TizenBrew**, not "Install TizenBrew Installer". Enter the TV IP.
4. **Check:** TizenBrew is in Apps and opens.
5. **Developer Mode Host PC IP back to 127.0.0.1**, restart TV, confirm on the status page.
6. **Log every step.**

## Facts this changes in our hub spec

- **Weather isn't the only outbound request:** the hub files themselves come from jsDelivr.
- **App launch:** the hub page runs inside TizenBrew's window, so `tizen.application.launch(appId)` uses TizenBrew's launch privilege.
- **HDMI keys:** this TV refuses the plain `ws://127.0.0.1:8001` remote socket (unauthorized). The hub sends keys through `service.js` instead, over `wss://127.0.0.1:8002` with a saved token. First use shows "Allow" on the TV once.
