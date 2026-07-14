import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgramText } from '../src/core/parser.js';

test('importador reconhece seções, minutos, comentários e conselho', () => {
  const text = `13-19 DE JULHO\nTESOUROS DA PALAVRA DE DEUS\n2. Joias espirituais (10 min)\n3. Leitura da Bíblia (4 min)\nFAÇA SEU MELHOR NO MINISTÉRIO\n4. Iniciando conversas (3 min)`;
  const result = parseProgramText(text);
  assert.equal(result.parts.length, 3);
  assert.equal(result.parts[0].countComments, true);
  assert.equal(result.parts[1].hasCounsel, true);
  assert.equal(result.parts[2].section, 'ministerio');
});
