/* ============================================================
   Contrato das tools do assistente (fase 3) + trava anti-deriva
   ============================================================
   A camada de IA tem DOIS adaptadores sobre as mesmas RPCs: o
   servidor MCP (`mcp/src/`, pacote Node) e a aba do site
   (`frontend/js/ai/`, sem build). Eles existem separados por
   encanamento — stdio/zod/npm de um lado, <script type="module">
   do outro — não por terem regras diferentes.

   É exatamente esse tipo de par que deriva em silêncio: alguém
   acrescenta uma tool num, ajusta o enquadramento no outro, e
   meses depois o MCP e o site respondem coisas diferentes sobre
   o mesmo número. Este teste lê o fonte do MCP como texto e
   trava as duas coisas que não podem divergir: a LISTA de tools
   e as QUATRO REGRAS transversais.

   O que pode divergir de propósito (e por isso não é comparado):
   as descrições individuais, que no MCP viajam no `registerTool`
   e aqui ficam no próprio objeto da tool.
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { TOOLS, especificacoes, rotuloDaTool } from '../frontend/js/ai/tools.js';
import { INSTRUCOES, conversaNova } from '../frontend/js/ai/agent.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const fonteMcp = readFileSync(resolve(aqui, '..', 'mcp', 'src', 'index.js'), 'utf8');

/** As tools registradas no servidor MCP, lidas do fonte. */
function toolsDoMcp() {
  const nomes = [...fonteMcp.matchAll(/\btool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  return [...new Set(nomes)].sort();
}

/** O bloco das quatro regras, que tem de ser idêntico nos dois consumidores. */
function quatroRegras(texto) {
  const inicio = texto.indexOf('Quatro regras valem para todas as tools:');
  const fim = texto.indexOf('alfabética e não significa prioridade.');
  if (inicio === -1 || fim === -1) return null;
  return texto
    .slice(inicio, fim + 'alfabética e não significa prioridade.'.length)
    .replace(/\s+/g, ' ')
    .trim();
}

describe('lista de tools', () => {
  it('é a mesma do servidor MCP', () => {
    const noSite = TOOLS.map((t) => t.nome).sort();
    expect(noSite).toEqual(toolsDoMcp());
  });

  it('tem as nove tools esperadas', () => {
    expect(TOOLS.map((t) => t.nome).sort()).toEqual([
      'consultar_bolsas',
      'listar_centros_de_custo',
      'panorama',
      'plano_de_trabalho',
      'previsto_vs_realizado',
      'projecao_de_caixa',
      'quem_sou_eu',
      'saldo_livre',
      'simular_alocacao',
    ]);
  });

  it('não repete nome', () => {
    const nomes = TOOLS.map((t) => t.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  // As tools do Buriti (mig. 051) criam propostas e só funcionam com login de
  // papel agente. São do MCP e NUNCA do Assistente do site: quem conversa no
  // site é o humano, que aplica — não propõe para si mesmo.
  it('as tools do Buriti existem no MCP e não no site', () => {
    const doBuriti = [...fonteMcp.matchAll(/\bburiti\(\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(doBuriti).toEqual(['listar_propostas', 'perguntar', 'propor_balancete']);
    const noSite = TOOLS.map((t) => t.nome);
    for (const nome of doBuriti) expect(noSite).not.toContain(nome);
  });
});

describe('enquadramento', () => {
  it('repete palavra por palavra as quatro regras do handshake do MCP', () => {
    const doMcp = quatroRegras(fonteMcp);
    const doSite = quatroRegras(INSTRUCOES);
    expect(doMcp).not.toBeNull();
    expect(doSite).not.toBeNull();
    expect(doSite).toBe(doMcp);
  });

  it('carrega as quatro regras nomeadas', () => {
    expect(INSTRUCOES).toContain('Não calcule');
    expect(INSTRUCOES).toContain('Não recomende — apresente');
    expect(INSTRUCOES).toContain('Diga o que o número cobre');
    expect(INSTRUCOES).toContain('"panorama" descreve, "simular_alocacao" ranqueia');
  });

  it('abre a conversa com o enquadramento na posição de system', () => {
    const conversa = conversaNova();
    expect(conversa).toHaveLength(1);
    expect(conversa[0].role).toBe('system');
    expect(conversa[0].content).toBe(INSTRUCOES);
  });
});

describe('schema enviado ao modelo', () => {
  const specs = especificacoes();

  it('gera uma função por tool, no formato do Ollama', () => {
    expect(specs).toHaveLength(TOOLS.length);
    for (const s of specs) {
      expect(s.type).toBe('function');
      expect(typeof s.function.name).toBe('string');
      expect(s.function.parameters.type).toBe('object');
    }
  });

  it('descreve toda tool e todo parâmetro', () => {
    for (const t of TOOLS) {
      expect(t.descricao.length, t.nome).toBeGreaterThan(40);
      const props = t.parametros.properties || {};
      for (const [nome, def] of Object.entries(props)) {
        expect(def.type, `${t.nome}.${nome}`).toBeTruthy();
        expect(def.description, `${t.nome}.${nome}`).toBeTruthy();
      }
    }
  });

  it('só exige parâmetro que existe em properties', () => {
    for (const t of TOOLS) {
      for (const req of t.parametros.required || []) {
        expect(Object.keys(t.parametros.properties || {}), t.nome).toContain(req);
      }
    }
  });

  it('tem executor em toda tool', () => {
    for (const t of TOOLS) {
      expect(typeof t.executar, t.nome).toBe('function');
      expect(typeof t.rotulo, t.nome).toBe('string');
    }
  });

  it('rotuloDaTool devolve o nome cru quando a tool não existe', () => {
    expect(rotuloDaTool('panorama')).toBe('Panorama de todos os centros de custo');
    expect(rotuloDaTool('nao_existe')).toBe('nao_existe');
  });
});

describe('PII', () => {
  // A regra do projeto: as tools devolvem o que o usuário já vê na tela, e CPF
  // nunca. A consulta de bolsas é a única que toca em scholarship_holders, e o
  // que a protege é a lista explícita de colunas — um `select('*')` ali passaria
  // a vazar cpf e e-mail sem ninguém notar.
  const fonteTools = readFileSync(
    resolve(aqui, '..', 'frontend', 'js', 'ai', 'tools.js'),
    'utf8'
  );

  it('nunca faz select(*)', () => {
    expect(fonteTools).not.toMatch(/\.select\(\s*['"`]\s*\*/);
  });

  it('não pede cpf nem e-mail de bolsista em select algum', () => {
    // Cada `.select(` até o `)` que o fecha — basta para pegar as colunas,
    // inclusive quando a lista é quebrada em concatenação de várias linhas.
    const selects = [...fonteTools.matchAll(/\.select\(([\s\S]*?)\)\s*\n?\s*\./g)].map(
      (m) => m[1]
    );
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s.toLowerCase(), s.slice(0, 80)).not.toContain('cpf');
      expect(s.toLowerCase(), s.slice(0, 80)).not.toContain('email');
    }
  });
});
