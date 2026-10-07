import { describe, it, expect } from 'vitest';
import { lerCredencial, caminhoCredencial } from '../mcp/src/operador-credencial.js';

describe('credencial do Buriti operador', () => {
  it('prefere o ambiente e cai para o arquivo', () => {
    expect(lerCredencial({ CF_OPERADOR_EMAIL: 'a@b.c', CF_OPERADOR_PASSWORD: 'x' }, () => { throw new Error('não lê'); }))
      .toEqual({ email: 'a@b.c', senha: 'x' });
    expect(lerCredencial({ USERPROFILE: 'C:/u' }, () => '\uFEFF{"email":"a@b.c","senha":"y"}')).toEqual({ email: 'a@b.c', senha: 'y' });
    expect(caminhoCredencial({ USERPROFILE: 'C:/u' }).split(String.fromCharCode(92)).join('/')).toBe('C:/u/.buriti/operador.json');
  });
  it('erros dizem o que fazer e nunca mostram a senha', () => {
    expect(() => lerCredencial({ USERPROFILE: 'C:/u' }, () => { throw new Error('ENOENT'); })).toThrow(/configurar-operador/);
    expect(() => lerCredencial({ USERPROFILE: 'C:/u' }, () => '{"email":"a@b.c","senha":"segredo"')).toThrow(/inválido/);
    try { lerCredencial({ USERPROFILE: 'C:/u' }, () => '{"email":"a@b.c"}'); } catch (e) { expect(e.message).not.toMatch(/segredo/); }
  });
});
