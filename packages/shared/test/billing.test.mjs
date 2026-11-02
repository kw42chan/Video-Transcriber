import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_PLANS, TOPUP_PACKS, hkdToStripeCents, planSeconds } from '../src/billing.ts';

test('billing plans match product intent', () => {
  assert.equal(BILLING_PLANS.starter.seconds, 120);
  assert.equal(BILLING_PLANS.starter.priceHkd, 148);
  assert.equal(BILLING_PLANS.pro.seconds, 360);
  assert.equal(BILLING_PLANS.studio.seconds, 900);
  assert.equal(TOPUP_PACKS.topup_100.seconds, 100);
  assert.equal(TOPUP_PACKS.topup_320.seconds, 320);
  assert.equal(planSeconds('pro'), 360);
  assert.equal(hkdToStripeCents(148), 14800);
});
