# WoW Forever Model Viewer

A custom local model and sound viewer for the World of Warcraft **Forever Beta** (`wow_classic_beta`). Reads your installed client: creatures, mounts, companions, characters, equipment, world models and sounds. Flat black/white interface, continuous lists, skin previews and keyboard navigation.

Developed and tested on macOS with beta **1.60.1.70374**. Other builds may require parser or database-schema updates. The browser interface runs through a local Node.js server; the optional macOS app wraps that same interface.

## Install and run

You need:

- **Node.js 22 or newer**, including npm. Get it from [nodejs.org](https://nodejs.org/en/download), or use `brew install node` if you use Homebrew.
- Your own installed Forever Beta. Finish the Battle.net download first. The installation must have an active `wow_classic_beta` entry in `.build.info` and its local `Data` folder.
- Internet access for the initial npm dependency and community metadata downloads. No game assets are downloaded.

```sh
git clone https://github.com/gadaffihub/wow-forever-model-viewer.git
cd wow-forever-model-viewer
npm run setup
npm start
```

Open **http://127.0.0.1:4317**. First startup indexes the local archives and checks the model catalog; subsequent starts use a build-specific cache. Keep the Terminal process running while using the browser.

Setup installs Three.js and downloads filename labels and public key metadata. Database field definitions are fetched on first use, then cached. The filename list is a large download; interrupted downloads can be retried by running `npm run setup` again.

### Point it at your beta installation

Automatic detection checks `/Applications/World of Warcraft`, common `Applications` and `Games` folders in your home directory, and standard game folders on mounted macOS volumes. It selects a beta only when exactly one valid installation is found.

For a different location, save it once:

```sh
npm run configure -- "/Volumes/Games/World of Warcraft"
npm start
```

You can select the main **World of Warcraft** directory, its **`_classic_beta_`** directory, or the game app inside it. The viewer resolves the installation root and validates the beta product. A retail-only installation is rejected.

Other options:

```sh
# List installations detected in standard locations.
npm run configure -- --list

# Forget the saved path and return to automatic detection.
npm run configure -- --auto

# Use a path for this launch only.
npm start -- --wow-path "/path/to/World of Warcraft"

# Or use an environment variable.
WOW_PATH="/path/to/World of Warcraft" npm start
```

Precedence is **`--wow-path` → `WOW_PATH` → saved setting → automatic detection**. An invalid explicit or saved path produces an error; it never silently switches to another installation. Restart the server after changing a saved path. Settings stay in the ignored `.cache/settings.json` file.

### Optional macOS app

Install Apple's Command Line Tools if you do not already have them:

```sh
xcode-select --install
```

Then, after setup:

```sh
npm run build:mac
open "WoW Models.app"
```

Keep **WoW Models.app** in the project directory beside `server`, `public` and `node_modules`. It is a locally built launcher, not a standalone application bundle. It starts and stops its own local server, or connects to one already running on port 4317.

Use **Settings (top-right gear) → Choose folder…**, or **WoW Models → Choose WoW beta installation…** (**⌘O**), to choose the game folder. The app validates and saves your selection, then restarts its server. If the server was started separately in Terminal, restart that process yourself. In the browser version, Settings accepts a manual installation path; save it, then restart the server to apply it.

### Audio on Safari and the macOS app

Browsers that support Ogg/Vorbis play the original local audio. For browsers or WebKit versions that do not, install FFmpeg:

```sh
brew install ffmpeg
```

The viewer then converts Ogg to WAV locally in memory. It looks for `ffmpeg` on PATH and in the standard Homebrew locations. MP3 and WAV do not need this conversion. Conversion has a 128 MB decoded-audio limit; use a browser with native Ogg support for larger tracks.

## Browse

- **creature/**, **character/**, **item/** and **models/** select actual archive path prefixes. **misc** selects other roots such as **world/**, **spells/** and **sound/**. Expand **Subfolders** only when you want to narrow the list.
- **sound/** lists the installed Ogg, MP3 and WAV files with known paths. Click a row to play it. Search matches filenames, paths and file IDs. Folder, name, file ID and size sorting work across the continuous list; subfolders can narrow it to music, creatures or other audio groups. The player has play/pause, a seek bar and volume.
- Model lists offer folder, name, file ID, skin count and size sorting. Click a sort button again to reverse it.
- The table filter follows the selected folder: creature, item, character or sound records. For other model folders it checks the known reference tables. In **sound/**, choose **All installed**, **In sound tables** or **Not in sound tables**; sound references use the installed beta's `SoundKitEntry.FileDataID` records. The same status is shown in Info.
- **Skins** shows clickable previews. **Info** exposes available names, file paths, model/display references, textures, animations, sounds and raw client records. Click a sound in **Info → Sound files** to play or pause it.
- Only one sound plays at a time. Changing the selected file stops the previous sound. Animation starts paused by default and automatic rotation is opt-in.

### Settings

The gear at the top-right opens saved viewer defaults:

- **Autoplay animations:** start the selected animation when a model opens. Off by default.
- **Autoplay sounds:** play the selected sound when opening it or navigating the sound list. On by default; turn it off to select files silently and use the player manually. Some browsers require an initial press of Play before allowing audio.
- **Cycle skins automatically:** step through the current model's skins, with an adjustable interval of 1–60 seconds. Off by default. Manual skin selection restarts the interval; cycling stops while the page is hidden or when you leave the model.
- **Startup folder:** reopen the last folder, choose a top-level archive folder, or use **Use current folder** to save a subfolder. This takes effect on the next launch.
- **WoW installation:** choose the local game directory with the macOS folder picker or save a manual path in the browser.

Playback and startup-folder preferences save automatically in local browser storage, separately from the installation path. They persist across launches in the same app or browser profile. The macOS app and a separate browser have their own viewer preferences.

| Control | Action |
| --- | --- |
| Left / Right | Previous / next model or sound in the current list |
| Shift + Left / Right | Previous / next skin |
| Space | Play / pause animation or the selected sound |
| Drag / scroll / right drag | Orbit / zoom / pan |
| F | Favorite the current file |
| 0 | Reset model view |
| / | Focus search |

Keyboard shortcuts are ignored while typing in a field or using the audio player's controls.

## Where the data comes from

The reader selects the active `wow_classic_beta` row in `.build.info`, opens that build's encoding table and root manifest, and resolves locally installed content. Shared CASC storage can contain several WoW products, but **membership in the selected beta manifest is required**. It does not use the retail manifest or fetch missing game files. Complete asset reads are checked against the beta content hash.

Community data supplies filename labels, database field definitions and public TACT keys: [wow-listfile](https://github.com/wowdev/wow-listfile), [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) and [TACTKeys](https://github.com/wowdev/TACTKeys). These are metadata sources, not sources of models, textures or sounds. Some paths under `models/` are generated community labels for unnamed files. A missing label can prevent a file from appearing in a folder list.

The model catalog contains locally installed M2 meshes and root WMO world models. WMO group files load through their parent building. Models with no visible vertices are omitted. An installed file that needs an unavailable encryption key can still appear, with an explicit error when opened. Public or client-supplied keys are used where available; the viewer does not break encryption or invent a key.

Being present in the beta does not mean an asset is used in gameplay. A beta can ship assets originally used in retail expansions. Table references are separate from file presence:

- Creature references use `CreatureModelData.FileDataID`.
- Item references follow `ItemDisplayInfo.ModelResourcesID` → `ModelFileData.ModelResourcesID` → `FileDataID`.
- Character references follow `ChrModel.DisplayID` → `CreatureDisplayInfo.ModelID` → `CreatureModelData.FileDataID`.
- Sound references use `SoundKitEntry.FileDataID`. A table reference never adds a sound absent from the beta's locally installed files.

“Not in tables” means absent from the records the viewer can read. Unreadable encrypted sections cannot supply references. Mount records are exposed in Info; any additional filename-based classification is identified as inference.

The CASC/BLTE, Salsa20, M2/SKIN, WMO, DB2 and BLP readers are custom code in `server/`. Three.js handles WebGL rendering. This repository contains source code only: no game assets, extracted files, local settings, key lists or caches. Generated data stays under the ignored `.cache/` directory.

## Limits and troubleshooting

- Complex multi-layer materials, particle effects, full character customization and equipment texture composition are incomplete. WMO geometry is supported; embedded scenery placements are not fully reproduced. This is not a complete copy of WoW's renderer.
- Geometry may be readable while a required texture, animation or table section is encrypted. Missing names are not guessed. Cached gameplay hotfixes are not merged into the base tables.
- The archive reader currently selects neutral and enUS root records. Localized audio in other locale sections is not cataloged. Folder browsing depends on available filename labels.
- **No installation found:** use `npm run configure -- "/path/to/World of Warcraft"`. **Wrong saved path:** save the new path or run `npm run configure -- --auto`.
- **Missing filename list or metadata:** rerun `npm run setup`. A fresh installation needs network access for database definitions on its first launch.
- **Sound cannot play:** install FFmpeg if your browser cannot decode Ogg. An unavailable encryption key or missing local file is reported separately.
- **Port 4317 busy:** close the other viewer, or run `npm start -- --port 4318` and open that port in a browser. The native launcher uses 4317.
- **Native app cannot start:** check `.cache/viewer.log`. Ensure Node is installed and the app is still beside the source directory and dependencies.

## Development and checks

```sh
npm test                  # Pure tests; no WoW installation or network needed.
npm run test:integration  # Also exercises the installed beta and local audio decoding.
```

Integration fixtures target **1.60.1.70374** and require FFmpeg. They check beta membership, hashes, database joins, folder filters, sorting, real mesh/texture/animation reads, WMO geometry, decryption with known keys and sound playback data. Different client builds can change fixture IDs or counts.

To update an existing checkout, stop the viewer, run `git pull` and `npm run setup`, then rebuild the macOS app if you use it. Restart the viewer afterward. Caches are separated by beta build; deleting `.cache/` also deletes your saved installation path and downloaded metadata, so run setup again afterward.
