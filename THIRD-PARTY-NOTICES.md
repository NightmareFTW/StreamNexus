# Third party notices

## FFmpeg

The Windows installer includes the FFmpeg 6.1.1 Essentials build from [Gyan.dev](https://www.gyan.dev/ffmpeg/builds/). FFmpeg is launched as a separate process to convert the audio track to AAC for playback in the app. By default the video track is copied without re-encoding; when the user chooses a lower quality (or the file needs it), the video is re-encoded to H.264 with the libx264 encoder included in this build.

This FFmpeg build is licensed under GNU GPL version 3. The license and build details are installed beside the executable in the app's `resources/ffmpeg` directory. The FFmpeg source revision identified by the build is available at [e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93).

## JavaScript libraries

- [React](https://react.dev/) and React DOM, MIT License.
- [hls.js](https://github.com/video-dev/hls.js), Apache License 2.0, used to play HLS live streams.
- [Electron](https://www.electronjs.org/), MIT License.
- [Vite](https://vite.dev/), MIT License.

## Data sources and attributions

- This product uses the TMDB API but is not endorsed or certified by TMDB.
- Music metadata: iTunes Search API and, optionally, the Spotify Web API. Embedded players are provided by Spotify and Apple Music. Free tracks come from the Internet Archive and Audius.
- Book data: Open Library, Project Gutenberg, the Internet Archive and LibriVox.
- Live TV lists: [iptv-org](https://github.com/iptv-org/iptv), [Free-TV/IPTV](https://github.com/Free-TV/IPTV) and [M3UPT](https://github.com/LITUATUI/M3UPT). Channel logos and streams belong to their respective owners.
- Adult tab (disabled by default): public APIs of RedTube, Pornhub (Webmasters) and Eporner, shown through each site's embedded player.
- Subtitles: OpenSubtitles.

All trademarks belong to their respective owners. StreamNexus is not affiliated with any of the services above.
