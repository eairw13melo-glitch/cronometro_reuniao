import { createPart } from './default-program.js';

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function parseProgramText(raw) {
  const lines = String(raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  let section = 'neutro';
  const result = [];
  const used = new Set();
  let weekLabel = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeText(line);

    if (!weekLabel && /DE\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/i.test(normalized) && /\d/.test(line) && line.length < 60) {
      weekLabel = line;
      continue;
    }

    if (normalized.includes('TESOUROS DA PALAVRA')) { section = 'tesouros'; continue; }
    if (normalized.includes('MELHOR NO MINISTERIO')) { section = 'ministerio'; continue; }
    if (normalized.includes('NOSSA VIDA CRISTA')) { section = 'vida'; continue; }

    const timeMatch = line.match(/\((\d{1,3})\s*min\)/i);
    if (timeMatch) {
      const min = Number(timeMatch[1]);
      const before = line.slice(0, timeMatch.index).trim();
      const after = line.slice(timeMatch.index + timeMatch[0].length).trim();
      let title = before;

      if (!title) {
        for (let previous = index - 1; previous >= 0; previous -= 1) {
          if (used.has(previous)) continue;
          const candidate = lines[previous];
          const candidateNormalized = normalizeText(candidate);
          if (candidateNormalized.includes('TESOUROS DA PALAVRA') || candidateNormalized.includes('MELHOR NO MINISTERIO') || candidateNormalized.includes('NOSSA VIDA CRISTA')) break;
          if (/\(\d{1,3}\s*min\)/i.test(candidate)) break;
          title = candidate;
          used.add(previous);
          break;
        }
      }

      let details = '';
      if (after.startsWith('|')) title = `${title || ''} ${after}`.trim();
      else if (after) details = after;
      if (!title) title = 'Parte sem título';

      const normalizedTitle = normalizeText(title);
      result.push(createPart(section, title, min, {
        details,
        countComments: normalizedTitle.includes('JOIAS ESPIRITUAIS'),
        hasCounsel: section === 'ministerio' || normalizedTitle.includes('LEITURA DA BIBLIA'),
      }));
      continue;
    }

    if (/^C[ÂA]NTICO\s+\d+$/i.test(normalized)) {
      const duplicate = result.some((part) => normalizeText(part.name).includes(normalized));
      if (!duplicate) result.push(createPart(section, `${line} (intervalo)`, 3));
    }
  }

  return { weekLabel, parts: result };
}
