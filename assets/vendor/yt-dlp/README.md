Place a platform-specific `yt-dlp` binary in this folder for packaged builds.

Expected filenames:
- `yt-dlp.exe` on Windows
- `yt-dlp` on Linux
- `yt-dlp` or `yt-dlp_macos` copied to `yt-dlp` on macOS

If no bundled binary is present, the app will try the cached downloaded binary in app data and then `python -m yt_dlp`.
