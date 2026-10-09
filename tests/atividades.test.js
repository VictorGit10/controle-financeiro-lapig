import { describe, it, expect } from 'vitest';
import { grupoAtividade, motivoAgora, proximoPasso, prazoCurto, lerCaptura } from '../frontend/js/components/buriti-tarefas.js';

const hoje = new Date(2026, 9, 9, 15, 0);
const tarefa = (extra = {}) => ({ id: 't', status: 'em_andamento', prazo: null, situacao: null, precisa_atencao: false,
  aviso_responsavel: null, tarefa_passos: [{ id: 'p1', ordem: 1, descricao: 'Ligar para a FUNAPE', quem: 'Arthur', executor: 'pessoa', estado: 'pendente' }], ...extra });

describe('grupos da tela de Atividades', () => {
  it('prazo em até 2 dias, vencida ou travada: precisa de atenção, para todos', () => {
    expect(grupoAtividade(tarefa({ prazo: '2026-10-11' }), { hoje })).toBe('agora');
    expect(grupoAtividade(tarefa({ prazo: '2026-10-12' }), { hoje })).toBe('andamento');
    expect(grupoAtividade(tarefa({ prazo: '2026-10-01' }), { hoje })).toBe('agora');
    expect(grupoAtividade(tarefa({ situacao: 'travado' }), { hoje })).toBe('agora');
  });
  it('passo marcado como feito e pedido de atenção só puxam para cima na visão do admin', () => {
    const feita = tarefa({ tarefa_passos: [{ ...tarefa().tarefa_passos[0], estado: 'sugerido' }] });
    expect(grupoAtividade(feita, { admin: true, hoje })).toBe('agora');
    expect(grupoAtividade(feita, { admin: false, hoje })).toBe('andamento');
    expect(grupoAtividade(tarefa({ aviso_responsavel: 'Arthur: travado' }), { admin: true, hoje })).toBe('agora');
    expect(grupoAtividade(tarefa({ precisa_atencao: true, motivo_atencao: 'x' }), { admin: false, hoje })).toBe('andamento');
  });
  it('esperando alguém de fora e encerradas', () => {
    expect(grupoAtividade(tarefa({ status: 'aguardando_terceiro' }), { hoje })).toBe('esperando');
    expect(grupoAtividade(tarefa({ situacao: 'esperando' }), { hoje })).toBe('esperando');
    expect(grupoAtividade(tarefa({ status: 'aguardando_terceiro', prazo: '2026-10-09' }), { hoje })).toBe('agora');
    expect(grupoAtividade(tarefa({ status: 'concluida' }), { hoje })).toBe('encerrada');
  });
  it('o motivo diz o principal em poucas palavras', () => {
    expect(motivoAgora(tarefa({ prazo: '2026-10-07' }), { hoje })).toBe('vencida há 2 dias');
    expect(motivoAgora(tarefa({ prazo: '2026-10-08' }), { hoje })).toBe('vencida há 1 dia');
    expect(motivoAgora(tarefa({ prazo: '2026-10-09' }), { hoje })).toBe('vence hoje');
    expect(motivoAgora(tarefa({ prazo: '2026-10-10' }), { hoje })).toBe('vence amanhã');
    expect(motivoAgora(tarefa({ situacao: 'travado', prazo: '2026-10-10' }), { hoje })).toBe('travada');
    expect(motivoAgora(tarefa({ tarefa_passos: [{ ...tarefa().tarefa_passos[0], estado: 'sugerido' }] }), { admin: true, hoje })).toBe('confirmar');
  });
});

describe('próximo passo e prazo curto', () => {
  const passos = [
    { id: 'a', ordem: 2, descricao: 'Orçamentos', quem: 'Arthur', executor: 'pessoa', estado: 'pendente' },
    { id: 'b', ordem: 1, descricao: 'Falar com o Prof. Manuel', quem: 'Arthur', executor: 'pessoa', estado: 'sugerido' },
    { id: 'c', ordem: 0, descricao: 'Levantar dados', quem: 'Buriti', executor: 'buriti', estado: 'confirmado' },
  ];
  it('admin vê primeiro o que tem para confirmar; os demais, o primeiro pendente', () => {
    expect(proximoPasso({ tarefa_passos: passos }, true)).toEqual({ texto: 'Falar com o Prof. Manuel', confirmar: true, quem: 'Arthur' });
    expect(proximoPasso({ tarefa_passos: passos }, false)).toEqual({ texto: 'Orçamentos', confirmar: false, quem: 'Arthur' });
    expect(proximoPasso({ tarefa_passos: [passos[2]] }, true)).toBeNull();
  });
  it('prazo em palavras perto, data longe', () => {
    expect(prazoCurto(null, hoje)).toEqual({ texto: 'sem prazo', nivel: 'nenhum' });
    expect(prazoCurto('2026-10-09', hoje).texto).toBe('hoje');
    expect(prazoCurto('2026-10-10', hoje).texto).toBe('amanhã');
    expect(prazoCurto('2026-10-14', hoje)).toEqual({ texto: 'em 5 dias', nivel: 'perto' });
    expect(prazoCurto('2026-10-31', hoje)).toEqual({ texto: '31 out', nivel: 'longe' });
    expect(prazoCurto('2026-10-06', hoje)).toEqual({ texto: 'venceu há 3 dias', nivel: 'vencido' });
  });
});

describe('anotar como no caderno', () => {
  const centros = [{ id: 'p68', code: '30.068', name: 'CEMPA FAPEG' }, { id: 'p106', code: '30.106', name: 'Parques Urbanos' }];
  const pessoas = [{ user_id: 'v', display_name: 'Victor Amaral' }, { user_id: 'a', display_name: 'arthurpietro.lapig' },
    { user_id: 'm', display_name: 'Manuel Ferreira' }, { user_id: 'm2', display_name: 'Marcia Souza' }];
  const ler = texto => lerCaptura(texto, { centros, pessoas, eu: 'v', hoje });

  it('centro, o que fazer, prazo e responsável', () => {
    const r = ler('30.106 pedido de salgados para o evento até 31/10 @Arthur');
    expect(r.centro.id).toBe('p106');
    expect(r.titulo).toBe('Pedido de salgados para o evento');
    expect(r.prazo).toBe('2026-10-31');
    expect(r.responsavel.user_id).toBe('a');
  });
  it('sem @ fica com quem anota; sem data fica sem prazo; acento e caixa não importam', () => {
    const r = ler('Remanejamento de rubricas do 30.068');
    expect(r).toMatchObject({ titulo: 'Remanejamento de rubricas', prazo: null });
    expect(r.responsavel.user_id).toBe('v');
    expect(ler('30.068 x @MANUEL').responsavel.user_id).toBe('m');
    expect(ler('30.068: conferir bolsas — 20/10').prazo).toBe('2026-10-20');
    expect(ler('30.068: conferir bolsas — 20/10').titulo).toBe('Conferir bolsas');
  });
  it('data sem ano já passada há mais de um mês é do ano seguinte; com ano, respeita', () => {
    expect(ler('30.068 renovar até 15/01').prazo).toBe('2027-01-15');
    expect(ler('30.068 renovar até 01/10').prazo).toBe('2026-10-01');
    expect(ler('30.068 renovar até 15/01/26').prazo).toBe('2026-01-15');
  });
  it('recusa em vez de adivinhar', () => {
    expect(() => ler('')).toThrow('Escreva');
    expect(() => ler('remanejar rubricas')).toThrow('código do centro');
    expect(() => ler('30.999 remanejar')).toThrow('30.999');
    expect(() => ler('30.068 e 30.106 remanejar')).toThrow('um centro');
    expect(() => ler('30.068 remanejar até 31/11')).toThrow('não existe');
    expect(() => ler('30.068 remanejar @M')).toThrow('mais de uma pessoa');
    expect(() => ler('30.068 remanejar @Laerte')).toThrow('Não achei');
    expect(() => ler('30.068 @Arthur')).toThrow('o que fazer');
    expect(() => ler('30.068 escrever para fulano@funape.org.br')).toThrow('e-mail');
  });
});
