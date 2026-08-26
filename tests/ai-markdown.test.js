/* ============================================================
   Markdown do assistente — formatação e, sobretudo, escape
   ============================================================
   Este é o ponto em que texto de fora vira HTML: o modelo
   escreve a resposta e repete dentro dela nome de bolsista e de
   projeto vindos do banco. Se o escape falhar aqui, um nome
   cadastrado com `<img onerror=...>` executa no navegador de
   quem abrir a conversa.

   O que os testes travam é a ORDEM (escapar antes de formatar) e
   a ausência de itálico por `_`, que despedaçaria os nomes de
   campo snake_case das RPCs.
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../frontend/js/ai/markdown.js';

describe('escape', () => {
  it('neutraliza tag HTML no texto do modelo', () => {
    const saida = renderMarkdown('O saldo é <script>alert(1)</script> reais');
    expect(saida).not.toContain('<script>');
    expect(saida).toContain('&lt;script&gt;');
  });

  it('neutraliza atributo de evento em nome vindo do banco', () => {
    const nome = '<img src=x onerror="alert(document.cookie)">';
    const saida = renderMarkdown(`Bolsista ${nome} recebe R$ 2.000,00`);
    expect(saida).not.toContain('<img');
    expect(saida).not.toContain('onerror="');
  });

  it('escapa aspas e apóstrofo', () => {
    const saida = renderMarkdown(`aspas " e apóstrofo '`);
    expect(saida).toContain('&quot;');
    expect(saida).toContain('&#39;');
  });

  it('não deixa o negrito reintroduzir HTML', () => {
    const saida = renderMarkdown('**<b>x</b>**');
    expect(saida).toContain('<strong>');
    expect(saida).toContain('&lt;b&gt;');
    expect(saida).not.toContain('<b>');
  });
});

describe('formatação', () => {
  it('converte negrito', () => {
    expect(renderMarkdown('saldo **livre**')).toContain('<strong>livre</strong>');
  });

  it('converte código inline', () => {
    expect(renderMarkdown('veja `saldo_livre`')).toContain('<code>saldo_livre</code>');
  });

  it('monta lista com marcador', () => {
    const saida = renderMarkdown('- Cerrado\n- Amazônia');
    expect(saida).toContain('<ul>');
    expect(saida).toContain('<li>Cerrado</li>');
    expect(saida).toContain('<li>Amazônia</li>');
  });

  it('monta lista numerada', () => {
    const saida = renderMarkdown('1. primeiro\n2. segundo');
    expect(saida).toContain('<ol>');
    expect(saida).toContain('<li>primeiro</li>');
  });

  it('separa parágrafos e quebra linha simples', () => {
    const saida = renderMarkdown('linha um\nlinha dois\n\noutro parágrafo');
    expect(saida).toContain('linha um<br>linha dois');
    expect((saida.match(/<p>/g) || []).length).toBe(2);
  });

  it('rebaixa cabeçalho a negrito', () => {
    expect(renderMarkdown('## Resumo')).toContain('<strong>Resumo</strong>');
  });

  it('NÃO trata sublinhado como itálico — snake_case tem de sobreviver', () => {
    const saida = renderMarkdown('campos: saldo_livre_realocavel e motivo_codigo');
    expect(saida).toContain('saldo_livre_realocavel');
    expect(saida).toContain('motivo_codigo');
    expect(saida).not.toContain('<em>');
  });

  it('devolve vazio para texto vazio', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });
});
