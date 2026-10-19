"""Place per-segment TTS at original start times, atempo ≤1.25x on overflow, build full-length track, mux into video.
Usage: python align_mux.py <clipDir> <video> <vendor> [--max-tempo 1.25]"""
import json, subprocess, sys, os
import numpy as np
clip_dir, video, vendor = sys.argv[1:4]
MAX_T = 1.25; SR = 44100; MIN_GAP = 0.05
def ff(*a): subprocess.run(["ffmpeg", "-y", "-v", "error", *a], check=True)
def decode(path, tempo=1.0):
    af = ["-af", f"atempo={tempo:.4f}"] if tempo > 1.0001 else []
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, *af, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()
def trim_silence(x, thr=10 ** (-45 / 20)):
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx): return x
    a, b = max(0, idx[0] - int(0.02 * SR)), min(len(x), idx[-1] + int(0.05 * SR))
    return x[a:b]
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], capture_output=True, text=True).stdout)
segs = json.load(open(f"{clip_dir}/yue_segments.json"))["segments"]
man = json.load(open(f"{clip_dir}/tts_manifest_{vendor}.json"))
ok = {s["id"]: s for s in man["segments"] if s.get("ok")}
track = np.zeros(int(round(dur * SR)) + SR * 5, dtype=np.float32)
log = []; prev_end = 0.0
for i, s in enumerate(segs):
    nxt = segs[i + 1]["start"] if i + 1 < len(segs) else dur
    slot = nxt - s["start"]; en_dur = s["end"] - s["start"]
    rec = {"id": s["id"], "start": s["start"], "en_dur": round(en_dur, 2), "slot": round(slot, 2)}
    if s["id"] not in ok:
        rec["status"] = "MISSING (TTS failed)"; log.append(rec); continue
    x = trim_silence(decode(ok[s["id"]]["outPath"]))
    raw_d = len(x) / SR; rec["raw_dur"] = round(raw_d, 2); tempo = 1.0
    if raw_d > slot - MIN_GAP:
        tempo = min(raw_d / (slot - MIN_GAP), MAX_T)
        x = trim_silence(decode(ok[s["id"]]["outPath"], tempo))
    d = len(x) / SR; rec["tempo"] = round(tempo, 3); rec["final_dur"] = round(d, 2)
    place = max(s["start"], prev_end + MIN_GAP if prev_end > 0 else 0)
    rec["placed_at"] = round(place, 2); rec["drift"] = round(place - s["start"], 2)
    end = place + d; rec["overflow"] = round(max(0, end - nxt), 2)
    rec["fill_ratio_vs_en"] = round(d / en_dur, 2)
    flags = []
    if tempo > 1.0001: flags.append(f"atempo {tempo:.2f}x")
    if rec["overflow"] > 0.01: flags.append(f"OVERFLOW {rec['overflow']}s into next slot")
    if rec["drift"] > 0.01: flags.append(f"DRIFT +{rec['drift']}s")
    if d / en_dur < 0.6: flags.append("short vs EN (<60%)")
    rec["flags"] = flags; rec["status"] = "ok"
    a = int(round(place * SR)); track[a:a + len(x)] += x; prev_end = end
    log.append(rec)
tail_over = max(0, prev_end - dur)
track = track[:int(round(dur * SR))]
peak = float(np.max(np.abs(track))) or 1.0
track = (track / peak * 10 ** (-1 / 20)).astype(np.float32)  # peak-normalise to -1 dBFS for fair A/B
tmp = f"{clip_dir}/_{vendor}_raw.f32"; track.tofile(tmp)
wav = f"{clip_dir}/{vendor}_yue.wav"; mp3 = f"{clip_dir}/{vendor}_yue.mp3"; mp4 = f"{clip_dir}/{os.path.basename(os.path.normpath(clip_dir))}_yue_{vendor}.mp4"
ff("-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", tmp, "-c:a", "pcm_s16le", wav); os.remove(tmp)
ff("-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", mp3)
ff("-i", video, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", str(SR), "-t", f"{dur:.3f}", "-movflags", "+faststart", mp4)
out = {"vendor": vendor, "video_dur": round(dur, 3), "track": wav, "mp3": mp3, "mp4": mp4, "tail_overrun_s": round(tail_over, 2), "segments": log}
json.dump(out, open(f"{clip_dir}/align_{vendor}.json", "w"), ensure_ascii=False, indent=2)
for r in log: print(r["id"], r.get("status"), r.get("raw_dur"), "→", r.get("final_dur"), "slot", r["slot"], r.get("flags"))
print("tail overrun", round(tail_over, 2), "|", mp4)
