"""Objective QA: Whisper large-v3 language ID (yue vs zh) + back-transcription CER vs script + median F0 per segment."""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
clip_dir, vendor = sys.argv[1:3]
segs = json.load(open(f"{clip_dir}/yue_segments.json"))["segments"]
man = {s["id"]: s for s in json.load(open(f"{clip_dir}/tts_manifest_{vendor}.json"))["segments"] if s.get("ok")}
m = WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=8)
def load16(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()
def f0(x, sr=16000):
    out = []; fl = int(.04 * sr); hop = int(.01 * sr)
    for i in range(0, len(x) - fl, hop):
        f = x[i:i + fl]
        if np.sqrt((f ** 2).mean()) < .02: continue
        f = f - f.mean(); ac = np.correlate(f, f, "full")[fl - 1:]; lo, hi = int(sr / 400), int(sr / 70); k = lo + np.argmax(ac[lo:hi])
        if ac[k] / ac[0] > .45: out.append(sr / k)
    return float(np.median(out)) if out else None
def han(t): return [c for c in t if "\u4e00" <= c <= "\u9fff" or "\u3400" <= c <= "\u4dbf"]
def cer(ref, hyp):
    r, h = han(ref), han(hyp); d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]; d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1])); prev = cur
    return d[len(h)] / max(1, len(r))
rows = []
for s in segs:
    if s["id"] not in man: continue
    x = load16(man[s["id"]]["outPath"])
    _, info = m.transcribe(x, beam_size=1, without_timestamps=True)
    probs = dict(info.all_language_probs or [])
    segs_yue, _ = m.transcribe(x, language="yue", beam_size=5, condition_on_previous_text=False)
    hyp = "".join(z.text for z in segs_yue).strip()
    rows.append({"id": s["id"], "lid_top": info.language, "p_yue": round(probs.get("yue", 0), 3), "p_zh": round(probs.get("zh", 0), 3),
                 "back_transcript_yue": hyp, "cer_vs_script": round(cer(s["yue"], hyp), 3), "f0_median_hz": f0(x)})
    print(rows[-1], flush=True)
summ = {"mean_p_yue": round(float(np.mean([r["p_yue"] for r in rows])), 3), "mean_p_zh": round(float(np.mean([r["p_zh"] for r in rows])), 3),
        "mean_cer": round(float(np.mean([r["cer_vs_script"] for r in rows])), 3),
        "f0_median_hz": round(float(np.median([r["f0_median_hz"] for r in rows if r["f0_median_hz"]])), 1)}
json.dump({"vendor": vendor, "method": "faster-whisper large-v3 int8: LID on each TTS segment; forced-yue back-transcription; CER on Han chars vs script; autocorr F0", "summary": summ, "rows": rows},
          open(f"{clip_dir}/qa_{vendor}.json", "w"), ensure_ascii=False, indent=2)
print("SUMMARY", summ)
