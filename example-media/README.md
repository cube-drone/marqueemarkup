# Example media

Real files for `WRITING.mq`'s embed demos (and any example that wants them). The demos
reference these exact names — drop files in as:

| file | used as |
|---|---|
| `picture.jpg` | the image embed |
| `song.mp3` | the audio embed |
| `clip.mp4` | the video embed |
| `angry-burger-emoji.png` | the custom image emoji (`:angry-burger:` in the preview host's table) |
| `banner.jpg`, `pasta_1.jpg`–`pasta_4.jpg` | the Borsalino demo site (`examples/borsalino/`) |

Until a file exists, the preview tool shows a labeled placeholder box in its place — the same
graceful degradation as everything else, so nothing here blocks anything.

**Provenance and licensing:** everything in this directory is freely redistributable:

- `angry-burger-emoji.png` — drawn by cube-drone for this repo
- `picture.jpg`, `song.mp3`, `clip.mp4`, `banner.jpg`, `pasta_1.jpg`–`pasta_4.jpg` —
  generated with Google Gemini for this repo