import json, sys, time, wave
import numpy as np
from faster_whisper import WhisperModel
audio, outdir, model_name = sys.argv[1], sys.argv[2], sys.argv[3]
t0 = time.time()
m = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=8)
w = wave.open(audio); pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
assert w.getframerate() == 16000 and w.getnchannels() == 1
segs, info = m.transcribe(pcm, language="en", beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False, compression_ratio_threshold=2.0)
out = []
for s in segs:
    out.append({"id": s.id, "start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip(),
                "avg_logprob": round(s.avg_logprob, 3), "no_speech_prob": round(s.no_speech_prob, 3),
                "words": [{"w": w.word, "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)} for w in (s.words or [])]})
meta = {"model": model_name, "compute_type": "int8", "device": "cpu", "language": info.language,
        "language_probability": info.language_probability, "duration": info.duration, "elapsed_s": round(time.time() - t0, 1)}
json.dump({"meta": meta, "segments": out}, open(f"{outdir}/en_segments.json", "w"), ensure_ascii=False, indent=2)
open(f"{outdir}/en.txt", "w").write("\n".join(s["text"] for s in out) + "\n")
print(json.dumps(meta))
