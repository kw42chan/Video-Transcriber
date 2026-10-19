"""Chunked Whisper ASR: split on detected silences (breath groups), transcribe each chunk independently.
Avoids long-context hallucination loops seen in full-file decoding."""
import json, sys, time, wave
import numpy as np
from faster_whisper import WhisperModel
audio, outdir, model_name, chunks_json = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
chunks = json.load(open(chunks_json))
w = wave.open(audio); sr = w.getframerate()
pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
t0 = time.time()
m = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=8)
out = []
for i, (cs, ce) in enumerate(chunks):
    pad = 0.15
    a, b = max(0, cs - pad), min(len(pcm) / sr, ce + pad)
    seg_pcm = pcm[int(a * sr):int(b * sr)]
    segs, _ = m.transcribe(seg_pcm, language="en", beam_size=5, word_timestamps=True, vad_filter=False,
                           condition_on_previous_text=False, temperature=0.0)
    segs = list(segs)
    words = [{"w": x.word, "s": round(a + x.start, 3), "e": round(a + x.end, 3), "p": round(x.probability, 3)} for s in segs for x in (s.words or [])]
    text = " ".join(s.text.strip() for s in segs).strip()
    start = words[0]["s"] if words else cs
    end = words[-1]["e"] if words else ce
    out.append({"id": i + 1, "start": round(start, 3), "end": round(end, 3), "chunk": [cs, ce], "text": text,
                "avg_logprob": round(float(np.mean([s.avg_logprob for s in segs])), 3) if segs else None,
                "min_word_p": min((x["p"] for x in words), default=None), "words": words})
    print(f"{i+1:>2} {start:6.2f}-{end:6.2f} | {text}", flush=True)
meta = {"model": model_name, "compute_type": "int8", "device": "cpu", "method": "silence-chunked (silencedetect -40dB/0.25s), per-chunk decode, no prev-text conditioning",
        "elapsed_s": round(time.time() - t0, 1), "duration": round(len(pcm) / sr, 3)}
json.dump({"meta": meta, "segments": out}, open(f"{outdir}/en_segments.json", "w"), ensure_ascii=False, indent=2)
open(f"{outdir}/en.txt", "w").write("\n".join(s["text"] for s in out) + "\n")
print(json.dumps(meta))
