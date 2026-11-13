# StreamNexus

StreamNexus is an independent desktop media discovery app built with Electron, React, and Vite. It brings together a browsable movie and series catalog, torrent search through Prowlarr, a Real-Debrid library, and subtitle lookup through OpenSubtitles.

## Features

- Browse separate movie and series shelves for trending titles, new releases, and highly rated picks from TMDB.
- Explore music and book collections, then load matching releases from Prowlarr.
- Search configured Prowlarr indexers by category for movies, series, music, and books.
- Open the profile menu for the personal list, Real-Debrid library, and settings.
- Enable the adult content category in Settings. It is disabled by default.
- Add Prowlarr torrent results to a Real-Debrid account.
- View Real-Debrid torrents, check their status, and play ready files in the built-in player.
- Search OpenSubtitles for Portuguese subtitles. Portugal Portuguese is preferred, with Brazilian Portuguese available as an alternative.
- Save titles to a personal list.

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

TMDB attribution is available in the Credits section under Settings. StreamNexus is an independent project and is not affiliated with TMDB, Real-Debrid, Prowlarr, or OpenSubtitles.

## Project commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite web preview |
| `npm run desktop` | Start Vite and Electron together |
| `npm run build` | Build the production UI bundle |
| `npm run preview` | Preview the production UI bundle |
| `npm run package:win` | Build and package the Windows installer |

