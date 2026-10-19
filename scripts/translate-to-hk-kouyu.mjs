#!/usr/bin/env node
/**
 * EN transcript → Traditional Chinese HK 口語 (spoken Cantonese) via OpenRouter.
 * Usage:
 *   node scripts/translate-to-hk-kouyu.mjs                 # all clips
 *   node scripts/translate-to-hk-kouyu.mjs clip-01         # one clip
 *   node scripts/translate-to-hk-kouyu.mjs --force         # overwrite yue.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  requireEnv,
  env,
  listClipIds,
  clipPaths,
  readText,
  writeText,
  charCount,
  log,
  warn,
} from './lib/common.mjs';

const SYSTEM = `你係香港粵語（廣東話）翻譯專家。任務：把英文口語逐字稿翻成「香港口語粵語」（口語），用繁體字書寫。

硬性規則：
1. 必須係香港口語粵語，唔係書面語、唔係普通話、唔係書面粵語。
2. 用繁體字。多用口語助詞同詞彙：係、唔係、嘅、咗、緊、啦、喎、㗎、咩、噃、佢哋、攞、睇、傾偈、搞掂……
3. 嚴禁普通話詞彙／句式：例如「很」「什麼」「怎麼」「這樣」「那個」「我們」「你們」「正在」「了」當粵語用、「的」當粵語結構助詞（用「嘅」）、北方兒化、「嗎」作疑問（用「咩／呀／嗎」時要自然粵語）。
4. 保留原意、語氣、專有名詞可保留英文或按香港習慣音譯。
5. 只輸出譯文正文，不要前言、不要解釋、不要引號包裹整段。
6. 適合朗讀：短句為主，標點用中文標點（。！？，）。`;

async function translateOne(english) {
  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const model = env('OPENROUTER_MODEL', 'google/gemini-2.5-flash');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://phase0-cantonese-tts.local',
      'X-Title': 'phase0-cantonese-tts',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `請將以下英文口語逐字稿翻成香港口語粵語（繁體）：\n\n${english}`,
        },
      ],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`OpenRouter empty response: ${JSON.stringify(body).slice(0, 400)}`);
  return text.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '').trim();
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--force');
  const force = process.argv.includes('--force');
  const ids = args.length ? args : listClipIds();
  if (!ids.length) {
    warn(`No clips found under ${path.relative(ROOT, path.join(ROOT, 'clips'))}/<id>/en.txt`);
    process.exit(1);
  }

  for (const id of ids) {
    const { en, yue } = clipPaths(id);
    if (!fs.existsSync(en)) {
      warn(`Skip ${id}: missing en.txt`);
      continue;
    }
    if (fs.existsSync(yue) && !force) {
      log(`${id}: yue.txt exists (use --force to overwrite)`);
      continue;
    }
    const english = readText(en);
    log(`${id}: translating EN (${charCount(english)} chars) → HK 口語…`);
    const yueText = await translateOne(english);
    writeText(yue, yueText);
    log(`${id}: wrote yue.txt (${charCount(yueText)} chars)`);
    if (charCount(yueText) > 500) {
      warn(`${id}: yue.txt > 500 chars — Canto-Gen async cap is 500; split or shorten before tts-canto-gen`);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
