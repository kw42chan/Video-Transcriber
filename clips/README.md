# clips/

Drop 3 (or more) English source clips here. Expected layout per clip:

```
clips/<clip-id>/
  en.txt          # required — English transcript (plain text)
  video.mp4       # optional — source video (no lip sync in Day 1)
  yue.txt         # optional — pre-translated HK 口語; written by translate script if missing
```

`<clip-id>` is the folder name (e.g. `clip-01`, `demo-a`). Keep `en.txt` under ~500 Traditional characters after translation for Canto-Gen’s async text cap (scripts will warn and skip over-limit for that vendor).
