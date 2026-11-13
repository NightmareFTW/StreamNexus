# Third party notices

## FFmpeg

The Windows installer includes the FFmpeg 6.1.1 Essentials build from [Gyan.dev](https://www.gyan.dev/ffmpeg/builds/). FFmpeg is launched as a separate process to convert the audio track to AAC for playback in the app. The video track is copied without re-encoding.

This FFmpeg build is licensed under GNU GPL version 3. The license and build details are installed beside the executable in the app's `resources/ffmpeg` directory. The FFmpeg source revision identified by the build is available at [e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93).
