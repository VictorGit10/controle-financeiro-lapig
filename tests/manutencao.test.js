import { describe, it, expect } from 'vitest';
import * as Manutencao from '../frontend/js/manutencao.js';

describe('modo manutenção', () => {
  it('só liga com ativo: true e usa a mensagem padrão quando vazia', () => {
    expect(Manutencao.interpretar({ ativo: false, mensagem: 'x' })).toEqual({ ativo: false });
    expect(Manutencao.interpretar({ ativo: 'true' })).toEqual({ ativo: false });
    expect(Manutencao.interpretar(null)).toEqual({ ativo: false });
    expect(Manutencao.interpretar({ ativo: true, mensagem: ' Volto às 15h ' }).mensagem).toBe('Volto às 15h');
    expect(Manutencao.interpretar({ ativo: true, mensagem: '' }).mensagem).toMatch(/em atualização/);
  });
  it('o arquivo publicado começa desligado', async () => {
    const { readFileSync } = await import('node:fs');
    expect(JSON.parse(readFileSync('frontend/manutencao.json', 'utf8')).ativo).toBe(false);
  });
});
