import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/core/state.js';
import {
  effectivePartElapsed,
  partRemaining,
  pausePartTimer,
  startPartTimer,
  switchPart,
  toggleCounsel,
  effectiveCounselUsed,
} from '../src/core/timer-engine.js';

const START = 1_700_000_000_000;

test('cronômetro usa tempo absoluto e registra excesso', () => {
  const state = createDefaultState();
  state.parts[0].min = 1;
  startPartTimer(state, START);
  assert.equal(Math.round(effectivePartElapsed(state, 0, START + 70_000)), 70);
  assert.equal(Math.round(partRemaining(state, 0, START + 70_000)), -10);
});

test('pausar acumula e voltar para a parte preserva o progresso', () => {
  const state = createDefaultState();
  startPartTimer(state, START);
  pausePartTimer(state, START + 20_000);
  switchPart(state, 1, START + 20_000);
  switchPart(state, 0, START + 20_000);
  assert.equal(Math.round(effectivePartElapsed(state, 0, START + 20_000)), 20);
});

test('apenas um conselho fica ativo por vez', () => {
  const state = createDefaultState();
  toggleCounsel(state, 4, START);
  toggleCounsel(state, 5, START + 10_000);
  assert.equal(state.runtime.counsel[4].running, false);
  assert.equal(state.runtime.counsel[5].running, true);
  assert.equal(Math.round(effectiveCounselUsed(state, 4, START + 10_000)), 10);
});
