# StreamNexus

StreamNexus is an independent desktop media discovery app built with Electron, React, and Vite. It brings together a browsable movie and series catalog, torrent search through Prowlarr, a Real-Debrid library, and subtitle lookup through OpenSubtitles.

## Download

Grab the latest Windows installer from the [Releases page](https://github.com/NightmareFTW/StreamNexus/releases). The installer is not code-signed yet, so Windows SmartScreen may show a warning: choose **More info → Run anyway**.

Sharing with family? See the [quick guide for family members (Portuguese)](docs/GUIA-FAMILIA.md): install, paste an invite code and PIN generated in Settings, and connect your own Real-Debrid account.

## Features

- **Movies, series and TV shows** from TMDB, with shelves that keep loading as you scroll and genre grids with infinite scroll.
- **Live TV channels by country**, from public IPTV lists, with direct playback and automatic hiding of offline channels.
- **Music** discovery (iTunes, optionally Spotify), with embedded previews and free full-length tracks from the Internet Archive and Audius.
- **Books** discovery from Open Library, a personal reading shelf (dashboard, stats, history and achievements) and free legal sources: Project Gutenberg, Internet Archive and LibriVox.
- **Adult tab (disabled by default)**: videos from the public APIs of RedTube, Pornhub and Eporner, played in each site's embedded player, plus adult cinema from TMDB. Only enable it if you are of legal age in your country.
- **Prowlarr + Real-Debrid**: search indexers by category, add results to your Real-Debrid account and play ready files.
- **Built-in player**: direct play when the file is compatible, FFmpeg conversion otherwise, automatic resume, seeking, a quality menu (original, 1080p, 720p) and a prompt when the connection is slow.
- **Subtitles** from OpenSubtitles, with Portugal Portuguese listed first.
- Personal list and start-up scripts (`StreamNexus.bat` and `StreamNexus.vbs`, the latter without a console window).

## Requirements

- Node.js 20 or newer
- npm
- Windows for the current packaged desktop installer
- Accounts and API credentials for the services you want to use

## Install and run

Install the project dependencies once in the repository:

```bash
npm install
```

The desktop app runs on the official [castlabs Electron](https://github.com/castlabs/electron-releases) build with Widevine (needed for Spotify playback inside the app). `npm run desktop` installs it on first run (about 150 MB, checksum verified); you can also run `npm run setup:widevine` once. Without it, the app still works and Spotify falls back to remote control of another Spotify device.

Spotify inside the app also needs castlabs' free VMP signature (EVS), otherwise Spotify's licence server answers HTTP 500 and tracks skip. One-time setup, with the app closed: `python -m pip install --upgrade castlabs-evs`, `python -m castlabs_evs.account signup` (email, name, password and the code emailed to you), then `npm run sign:widevine`. `npm run desktop` re-signs automatically when needed; the EVS login expires monthly (`python -m castlabs_evs.account reauth`).

Start the desktop app in development mode:

```bash
npm run desktop
```

Create a production web bundle:

```bash
npm run build
```

Create a Windows installer:

```bash
npm run package:win
```

The installer is written to the `release` directory. On another computer, install Node.js and run `npm install` in the repository before using the development command. The packaged installer does not require a separate Node.js installation for everyday use.

## Configure integrations

Open **Settings** in StreamNexus and add only the services you plan to use.

### TMDB

Create a TMDB API Read Access Token in your TMDB account settings. Paste it into the TMDB field, test the connection, and save. StreamNexus uses TMDB for catalog data and artwork.

### Prowlarr

Enter the Prowlarr address and API key. Configure indexers in Prowlarr, then search by category in StreamNexus. Movies, series, music, and books map to their corresponding Torznab categories. Adult content can be enabled in Settings.

### Real-Debrid

Connect your account from the Real-Debrid section. StreamNexus can then send selected Prowlarr results to your account and play files that are ready.

### OpenSubtitles

Enter an OpenSubtitles.com API key, username, and password. Test the connection and save. During playback, open the subtitles panel, choose a result, and enable the track from the video player's subtitle controls. Portugal Portuguese results are listed first.

## Data and security

On desktop, API keys and service credentials are stored in Electron's encrypted application storage. Real-Debrid authorization is stored separately. The Vite browser preview uses session storage and does not provide the same desktop credential storage.

TMDB attribution is available in the Credits section under Settings. StreamNexus is an independent project and is not affiliated with TMDB, Real-Debrid, Prowlarr, OpenSubtitles, Spotify, Apple, the Internet Archive, Open Library, Project Gutenberg, LibriVox, Audius, iptv-org or any of the video sites above.

StreamNexus does not host or distribute media. It lists metadata from public services, embeds their own players and connects to the services you configure. You are responsible for the content you access and for complying with the laws and terms of service that apply to you.

## Project commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite web preview |
| `npm run desktop` | Start Vite and Electron together |
| `npm run build` | Build the production UI bundle |
| `npm run preview` | Preview the production UI bundle |
| `npm run package:win` | Build and package the Windows installer |

