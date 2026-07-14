import { jsPDF } from 'jspdf';
import { COUNSEL_SECONDS, SECTION_LABELS } from '../core/constants.js';
import { effectiveCounselUsed, effectivePartElapsed } from '../core/timer-engine.js';
import { dateSlug, formatDuration, formatHoursMinutes, formatClock, truncate } from '../core/format.js';

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportJson(state) {
  downloadBlob(`reuniao-${dateSlug()}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportCsv(state, now = Date.now()) {
  const rows = [[
    'Posição', 'Seção', 'Parte', 'Orador', 'Previsto (s)', 'Usado (s)', 'Diferença (s)', 'Comentários', 'Conselho usado (s)',
  ]];
  state.parts.forEach((part, index) => {
    const used = Math.round(effectivePartElapsed(state, index, now));
    const planned = Math.round(part.min * 60);
    rows.push([
      index + 1,
      SECTION_LABELS[part.section],
      part.name,
      part.speaker,
      planned,
      used,
      used - planned,
      state.runtime.commentCounts[index] || 0,
      part.hasCounsel ? Math.round(effectiveCounselUsed(state, index, now)) : '',
    ]);
  });
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\n')}`;
  downloadBlob(`relatorio-reuniao-${dateSlug()}.csv`, csv, 'text/csv;charset=utf-8');
}

export function generatePdf(state, now = Date.now()) {
  const doc = new jsPDF();
  const marginX = 14;
  const rightX = 196;
  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Relatório da Reunião — Vida e Ministério Cristão', marginX, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Semana: ${state.weekLabel}`, marginX, y); y += 6;
  doc.text(`Gerado em: ${new Date(now).toLocaleString('pt-BR')}`, marginX, y); y += 6;
  if (state.settings.meetingStartIso) {
    const start = new Date(state.settings.meetingStartIso);
    const end = new Date(start.getTime() + state.settings.allowedMinutes * 60000);
    doc.text(`Início: ${formatClock(start)}    Término previsto: ${formatClock(end)}`, marginX, y); y += 6;
  }
  doc.text(`Tempo disponível: ${formatHoursMinutes(state.settings.allowedMinutes * 60)}`, marginX, y); y += 9;

  function tableHeader() {
    doc.setFillColor(34, 49, 74);
    doc.rect(marginX, y - 5, rightX - marginX, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('PARTE', marginX + 2, y);
    doc.text('ORADOR', 100, y);
    doc.text('PREV.', 140, y);
    doc.text('USADO', 158, y);
    doc.text('DIF.', 178, y);
    y += 6;
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'normal');
  }

  tableHeader();
  let lastSection = null;
  let totalPlanned = 0;
  let totalUsed = 0;
  const notes = [];

  state.parts.forEach((part, index) => {
    if (y > 275) { doc.addPage(); y = 18; tableHeader(); }
    if (['tesouros', 'ministerio', 'vida'].includes(part.section) && part.section !== lastSection) {
      doc.setFillColor(230, 224, 207);
      doc.rect(marginX, y - 4.5, rightX - marginX, 6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.setTextColor(60, 50, 30);
      doc.text(SECTION_LABELS[part.section].toUpperCase(), marginX + 2, y);
      doc.setTextColor(30, 30, 30);
      y += 7;
      doc.setFont('helvetica', 'normal');
    }
    lastSection = part.section;

    const used = Math.round(effectivePartElapsed(state, index, now));
    const planned = Math.round(part.min * 60);
    const difference = used - planned;
    totalPlanned += planned;
    totalUsed += used;

    doc.setFontSize(9.5);
    doc.text(truncate(part.name, 46), marginX + 2, y);
    doc.text(truncate(part.speaker || '—', 20), 100, y);
    doc.text(formatDuration(planned), 140, y);
    doc.text(formatDuration(used), 158, y);
    doc.text(`${difference > 0 ? '+' : difference < 0 ? '-' : ''}${formatDuration(Math.abs(difference))}`, 178, y);
    y += 5.5;

    if (part.details) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8);
      doc.setTextColor(100, 95, 80);
      const detailLines = doc.splitTextToSize(truncate(part.details, 160), 170);
      for (const line of detailLines) {
        if (y > 280) { doc.addPage(); y = 18; tableHeader(); }
        doc.text(line, marginX + 2, y); y += 4;
      }
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    }

    if (part.countComments) notes.push(`${part.name}: ${state.runtime.commentCounts[index] || 0} comentário(s).`);
    if (part.hasCounsel) notes.push(`${part.name}: conselho usado ${formatDuration(effectiveCounselUsed(state, index, now))} de ${formatDuration(COUNSEL_SECONDS)}.`);
    y += 1.5;
  });

  y += 3; doc.setDrawColor(34, 49, 74); doc.line(marginX, y, rightX, y); y += 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(`Total previsto: ${formatHoursMinutes(totalPlanned)}     Total usado: ${formatHoursMinutes(totalUsed)}`, marginX, y); y += 7;

  const difference = totalUsed - state.settings.allowedMinutes * 60;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  doc.text(difference > 0
    ? `Tempo disponível excedido em ${formatHoursMinutes(difference)}.`
    : `Dentro do tempo disponível, com ${formatHoursMinutes(-difference)} de folga.`, marginX, y);
  y += 9;

  if (notes.length) {
    if (y > 265) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Comentários e conselhos', marginX, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    for (const note of notes) {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.text(note, marginX + 2, y); y += 5.5;
    }
  }

  doc.save(`relatorio-reuniao-${dateSlug()}.pdf`);
}
