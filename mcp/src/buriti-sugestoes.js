// Sugestões de rubrica do Buriti para contas que chegam com o código
// cortado no PDF e fora da tabela de reduzidos (frontend/js/parsers/
// funape-contas.js). Chave: o código Reduzido, que é o mesmo em todos os
// centros de custo.
//
// São SUGESTÕES: vão na proposta com a justificativa ao lado, e quem
// decide é o humano na revisão. A semente é a lista que foi ao Victor em
// 2026-10-02 com as 17 perguntas dos balancetes de 2026-09. Quando ele
// responder diferente, corrija aqui — a próxima proposta já sai certa.

export const SUGESTOES = {
  // 30.068
  // `item` (mig. 053) é o item do plano; só vale onde o plano tiver esse item —
  // em outro projeto a revisão cai para a letra.
  '2597096': { rubrica: 'e', item: 'Impressão de material gráfico para divulgação do CEMPA-Cerrado',
               justificativa: 'Cartazes/brindes de divulgação: decisão do Victor de 01/10 — serviços gráficos e cartazes vão para impressão de material gráfico.' },
  // 30.076
  '2502012': { rubrica: 'a.enc', justificativa: 'PIS sobre férias é encargo da folha CLT, como as demais contas de 7.1.3.01.02.' },
  '2504019': { rubrica: 'e',     justificativa: 'Material de áudio, vídeo e foto é material de consumo (grupo 7.1.3.03).' },
  '2506006': { rubrica: 'b',     justificativa: 'Locação de imóvel é serviço contratado de pessoa jurídica.' },
  '2506017': { rubrica: 'a.enc', justificativa: 'Programa de Alimentação do Trabalhador é custo acessório da folha CLT.' },
  '2506026': { rubrica: 'a.enc', justificativa: 'Serviço médico/odontológico de funcionário CLT acompanha a folha.' },
  '2506031': { rubrica: 'a.enc', justificativa: 'Perícia médica para benefícios acompanha a folha CLT.' },
  '2506057': { rubrica: 'b',     justificativa: 'Impostos e taxas lançados entre os serviços de terceiros PJ.' },
  '2592090': { rubrica: 'b',     justificativa: 'Internet (provedor, e-mail) é serviço contratado de pessoa jurídica.' },
  '2508002': { rubrica: 'f',     justificativa: 'Aparelho e equipamento de comunicação é bem permanente (grupo 7.1.3.20).' },
  // 30.087
  '2504012': { rubrica: 'e',     justificativa: 'Material de copa e cozinha é material de consumo (grupo 7.1.3.03).' },
  '2504015': { rubrica: 'e',     justificativa: 'Material para manutenção de imóvel é material de consumo (grupo 7.1.3.03).' },
  '2506010': { rubrica: 'b',     justificativa: 'Manutenção e conservação de imóvel é serviço de pessoa jurídica.' },
  '2506013': { rubrica: 'b',     justificativa: 'Manutenção e conservação de bem móvel é serviço de pessoa jurídica.' },
  '2508011': { rubrica: 'f',     justificativa: 'Mobiliário é bem permanente (grupo 7.1.3.20).' },
  '2590217': { rubrica: 'b',     justificativa: 'Doação de adiantamento/ressarcimento de R$ 0,01: resíduo sem rubrica própria.' },
  // 78.215
  '2504014': { rubrica: 'e',     justificativa: 'Uniformes, tecidos e aviamentos são material de consumo (grupo 7.1.3.03).' },
};
