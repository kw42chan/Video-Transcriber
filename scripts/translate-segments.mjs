#!/usr/bin/env node
// Segment-wise EN → HK 口語 with timing budgets. Usage: node scripts/translate-segments.mjs out/clip_A
import fs from 'node:fs';
import path from 'node:path';
import { requireEnv, env, charCount, log } from './lib/common.mjs';

const dir = process.argv[2];
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en_segments.json'), 'utf8'));
const total = en.meta.duration;
const segs = en.segments.map((s, i, a) => {
  const nextStart = i + 1 < a.length ? a[i + 1].start : total;
  const dur = s.end - s.start;
  const slot = nextStart - s.start;
  // HK Cantonese TTS ≈ 4.5–5 syllables/s; budget on spoken duration, slight headroom for gap
  const maxChars = Math.floor(Math.min(dur * 4.6, slot * 4.3) );
  return { id: s.id, start: s.start, end: s.end, dur: +dur.toFixed(2), slot: +slot.toFixed(2), maxChars, en: s.text };
});

const SYSTEM = `你係香港廣東話配音翻譯。將英文逐段翻成「香港口語粵語」（口語，繁體中文），用嚟做配音，要同原片時間對得上。

規則：
- 必須係香港人日常講嘢嘅口語：用 係／唔係／嘅／咗／緊／嘢／咁／啦／囉／喎／㗎／佢哋／啲／冇 等，自然加語氣詞，但唔好堆砌。
- 唔准用書面語或普通話：唔好用「的、了、是、很、什麼、怎麼、這、那、我們、你們、他們、沒有、在（表進行）、嗎（除非自然）」。
- 英文品牌／科技名詞保持英文（例如 autopilot 可以保留英文，如果香港人通常咁講）。
- 每段要喺大約同英文一樣嘅時間內講完：每段有 max_chars（中文字數上限，標點唔計，英文字一個算約2字），唔可以超過；寧願精簡意思，唔好逐字直譯。
- 段與段之間可以銜接（例如上一段係「下次你…」，下一段接住講），但每段內容要對應返嗰段英文，唔好將內容搬去第二段。
- 只輸出 JSON：{"segments":[{"id":1,"yue":"..."}, ...]}，唔好有其他文字。`;

const user = JSON.stringify({ segments: segs.map(({ id, dur, maxChars, en }) => ({ id, seconds: dur, max_chars: maxChars, en })) }, null, 1);

const model = env('OPENROUTER_MODEL', 'google/gemini-2.5-flash');
const t0 = Date.now();
const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${requireEnv('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json', 'X-Title': 'phase0-cantonese-tts' },
  body: JSON.stringify({ model, temperature: 0.3, response_format: { type: 'json_object' }, usage: { include: true },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
});
const body = await res.json();
if (!res.ok) { console.error('OpenRouter error', res.status, JSON.stringify(body).slice(0, 400)); process.exit(1); }
let txt = body.choices[0].message.content.trim().replace(/^```(json)?\s*/, '').replace(/```$/, '');
const parsed = JSON.parse(txt);
const byId = Object.fromEntries(parsed.segments.map((s) => [s.id, s.yue.trim()]));
const spokenLen = (t) => {
  const latin = (t.match(/[A-Za-z]+/g) || []).length * 2;
  const cjk = [...t.replace(/[A-Za-z0-9\s]/g, '')].filter((c) => /\p{Script=Han}/u.test(c)).length;
  return cjk + latin;
};
const outSegs = segs.map((s) => ({ ...s, yue: byId[s.id] || '', yue_chars: charCount(byId[s.id] || ''), yue_spoken_len: spokenLen(byId[s.id] || '') }));
const out = { meta: { model, latency_ms: Date.now() - t0, usage: body.usage || null, generated_at: new Date().toISOString() }, segments: outSegs };
fs.writeFileSync(path.join(dir, 'yue_segments.json'), JSON.stringify(out, null, 2));
const fmt = (t) => { const m = Math.floor(t / 60), s = (t % 60).toFixed(2).padStart(5, '0'); return `${String(m).padStart(2, '0')}:${s}`; };
let md = `# clip_A — EN → 香港口語 script (for review)\n\nModel: \`${model}\` via OpenRouter · ASR: faster-whisper medium.en (chunked)\n\n| # | Time | EN | 口語 | len / max |\n| --- | --- | --- | --- | --- |\n`;
for (const s of outSegs) md += `| ${s.id} | ${fmt(s.start)}–${fmt(s.end)} | ${s.en} | ${s.yue} | ${s.yue_spoken_len}/${s.maxChars}${s.yue_spoken_len > s.maxChars ? ' ⚠️' : ''} |\n`;
fs.writeFileSync(path.join(dir, 'yue_script.md'), md);
log(`model=${model} usage=${JSON.stringify(body.usage || {})}`);
for (const s of outSegs) console.log(`${s.id} [${s.yue_spoken_len}/${s.maxChars}] ${s.yue}`);
