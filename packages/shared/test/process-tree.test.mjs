import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runProcess } from '../../../scripts/lib/process.mjs';

test('timeout kills descendants that retain pipes after their group leader exits',
  { skip: process.platform === 'win32', timeout: 6000 }, async () => {
    const started = Date.now();
    await assert.rejects(runProcess(process.execPath, ['-e', `
      const {spawn}=require('node:child_process');
      spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});
      setInterval(()=>{},1000);
    `], { timeout: 300 }), /timed out/);
    assert.ok(Date.now()-started < 4000);
  });
