function createId(prefix = 'part') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createPart(section, name, min, extra = {}) {
  return {
    id: extra.id || createId(),
    section,
    name,
    min,
    speaker: '',
    details: '',
    link: '',
    countComments: false,
    hasCounsel: false,
    ...extra,
  };
}

export function createDefaultParts() {
  return [
    createPart('neutro', 'Cântico 34 e comentários iniciais', 1),
    createPart('neutro', 'Oração inicial', 1),
    createPart('tesouros', '1. Faz diferença em quem confiamos!', 10, {
      details: 'Confiar somente em humanos desagrada a Jeová; confiar Nele traz sucesso (Jer. 17:5-8; Isa. 30:1,2).',
      link: 'https://wol.jw.org/pt/wol/bc/r5/lp-t/202026242/1/0',
    }),
    createPart('tesouros', '2. Joias espirituais', 10, {
      details: 'Perguntas sobre Jer. 17:7 e as joias espirituais encontradas na leitura da semana.',
      link: 'https://wol.jw.org/pt/wol/bc/r5/lp-t/202026242/4/0',
      countComments: true,
    }),
    createPart('tesouros', '3. Leitura da Bíblia', 4, {
      details: 'Jer. 17:5-18 (th lição 5).',
      link: 'https://wol.jw.org/pt/wol/bc/r5/lp-t/202026242/5/0',
      hasCounsel: true,
    }),
    createPart('ministerio', '4. Iniciando conversas', 3, {
      details: 'De casa em casa. Usar um vídeo do Kit de Ensino (lmd lição 5 ponto 5).',
      link: 'https://wol.jw.org/pt/wol/pc/r5/lp-t/202026242/5/0',
      hasCounsel: true,
    }),
    createPart('ministerio', '5. Cultivando o interesse', 4, {
      details: 'De casa em casa. Oferecer um estudo bíblico (lmd lição 7 ponto 4).',
      link: 'https://wol.jw.org/pt/wol/pc/r5/lp-t/202026242/6/0',
      hasCounsel: true,
    }),
    createPart('ministerio', '6. Fazendo discípulos', 5, {
      details: 'lff lição 19 “Resumo”, “Revisão” e “Tente o Seguinte” (lmd lição 11 ponto 3).',
      link: 'https://wol.jw.org/pt/wol/pc/r5/lp-t/202026242/7/0',
      hasCounsel: true,
    }),
    createPart('vida', 'Cântico 54 (intervalo)', 3),
    createPart('vida', '7. Jovens, confiem nos conselhos da Bíblia', 15, {
      details: 'Consideração com perguntas e o vídeo “A Bíblia Pode Ajudar Você?”.',
    }),
    createPart('vida', '8. Estudo bíblico de congregação', 30, {
      details: 'lfb histórias 102-103.',
      link: 'https://wol.jw.org/pt/wol/pc/r5/lp-t/202026242/10/0',
    }),
    createPart('neutro', 'Comentários finais', 2),
    createPart('neutro', 'Oração final', 1),
  ];
}
