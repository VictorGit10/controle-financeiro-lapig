// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeAttr, escapeAttrJs, formatBRL, toInputDate } from '../frontend/js/pure-fns.js';
const fonte = readFileSync(resolve('frontend/js/pages/plano-trabalho.js'), 'utf8');
let page, queue, host, propostasBucket, planosBucket, ativo, rpcErro;
const ex = () => ({ data: { titulo: 'Plano sintético', data_documento: '2026-10-08',
  valor_total_plano: 500, rubricas: [{ rubrica_code: 'e', descricao_livre: 'Material', valor_previsto: 500 }],
  desembolsos: [{ parcela: 1, valor: 500 }] }, warnings: ['Aviso do parser'] });
const proposta = (nome = 'plano.docx') => ({ id: 'proposta-x', tipo: 'plano', status: 'pendente',
  project_id: 'x', arquivo_path: 'x/' + nome, payload: {
    arquivo_nome: nome, tipo: 'original', extraido: ex(), avisos: ['Aviso do parser', 'Aviso da ordem'],
  } });
beforeEach(() => {
  localStorage.clear(); queue = null; ativo = null; rpcErro = null;
  host = document.createElement('div'); document.body.append(host);
  for (const [k, v] of Object.entries({ escapeAttr, escapeAttrJs, formatBRL, toInputDate,
    formatDate: s => s, detalheTecnico: s => s,
    Router: { register: vi.fn() }, lucide: { createIcons: vi.fn() }, showToast: vi.fn(),
    confirmAction: vi.fn().mockResolvedValue(true),
    parsePtFromHtml: vi.fn(() => { throw new Error('Não deve reler números'); }),
    parsePtFromPdfText: vi.fn(() => { throw new Error('Não deve reler números'); }),
    mammoth: { convertToHtml: vi.fn().mockResolvedValue({ value: '<p>Documento sintético; valores distintos 999</p>' }) },
    ImportQueue: { open: vi.fn(opts => { queue = opts; }) },
  })) vi.stubGlobal(k, v);
  const mount = vi.fn(async (_host, opts) => {
    _host.innerHTML = opts.rightHTML; opts.onMount?.(_host); return { destroy: vi.fn() };
  });
  vi.stubGlobal('mountDocxSplitView', mount); vi.stubGlobal('mountPdfSplitView', mount);
  propostasBucket = { download: vi.fn().mockResolvedValue({ data: new Blob(['sintético']), error: null }) };
  planosBucket = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  vi.stubGlobal('supabaseClient', {
    from: tabela => {
      const q = { select: () => q, order: () => q, eq: () => q };
      q.then = (resolve, reject) => Promise.resolve({ data: tabela === 'projects'
        ? [{ id: 'y', name: 'Outro', code: '56.Y' }, { id: 'x', name: 'Da proposta', code: '56.X' }]
        : [{ conta_prefix: '7.', rubrica_code: 'e' }], error: null }).then(resolve, reject);
      return q;
    },
    rpc: vi.fn(async nome => nome === 'get_plano_ativo'
      ? { data: ativo, error: null } : { error: rpcErro }),
    storage: { from: vi.fn(nome => nome === 'propostas-agente' ? propostasBucket : planosBucket) },
  });
  page = new Function(fonte + '\nreturn PlanoTrabalhoPage;')();
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('Revisão de plano proposto', () => {
  it.each(['plano.docx', 'assinado.pdf'])('usa extraído sem reler números, monta revisão e salva atomicamente (%s)', async nome => {
    const p = proposta(nome), original = structuredClone(p);
    await page.revisarPropostaPlano(p, vi.fn());
    expect(propostasBucket.download).toHaveBeenCalledWith('x/' + nome);
    const handler = queue.handlers[0], file = queue.files[0];
    const extracted = await handler.parse(file);
    expect(extracted.data).toEqual(p.payload.extraido.data);
    expect(extracted.warnings).toEqual(['Aviso do parser', 'Aviso da ordem']);
    expect(parsePtFromHtml).not.toHaveBeenCalled(); expect(parsePtFromPdfText).not.toHaveBeenCalled();
    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(nome.endsWith('.docx') ? 1 : 0);
    await handler.renderReview(host, extracted, file);
    expect(host.querySelector('#pti-project').value).toBe('x');
    expect(host.querySelector('#pti-project').disabled).toBe(true);
    expect(host.querySelector('#pti-tipo').value).toBe('original');
    expect(host.querySelector('[data-pt-field="data_documento"]').value).toBe('2026-10-08');
    host.querySelector('[data-pt-rubrica="valor"]').value = '600'; // decisão humana na revisão
    await handler.save(host, extracted, file);
    const call = supabaseClient.rpc.mock.calls.find(c => c[0] === 'upsert_plano_trabalho');
    expect(call[1].p_payload).toMatchObject({ project_id: 'x', tipo: 'original', proposta_id: p.id,
      arquivo_nome: nome, rubricas: [{ valor_previsto: 600 }], raw_extraction: p.payload.extraido.data });
    expect(planosBucket.upload).toHaveBeenCalledWith(expect.stringMatching(/^x\//), file, { contentType: file.type });
    expect(p).toEqual(original);
  });
  it('projeto continua travado sem split-view e adulteração do seletor não grava', async () => {
    mountDocxSplitView.mockRejectedValue(new Error('Visualização indisponível'));
    await page.revisarPropostaPlano(proposta());
    const handler = queue.handlers[0], file = queue.files[0], extracted = await handler.parse(file);
    await handler.renderReview(host, extracted, file);
    const sel = host.querySelector('#pti-project');
    expect(sel.disabled).toBe(true); sel.value = 'y';
    await expect(handler.save(host, extracted, file)).rejects.toThrow('projeto deve ser o da proposta');
    expect(planosBucket.upload).not.toHaveBeenCalled();
  });
  it('remanejamento usa a mesma confirmação antes de enviar arquivo', async () => {
    const p = proposta(); p.payload.tipo = 'remanejamento'; ativo = { valor_total_plano: 700 };
    await page.revisarPropostaPlano(p);
    const h = queue.handlers[0], f = queue.files[0], extracted = await h.parse(f);
    await h.renderReview(host, extracted, f);
    expect(host.querySelector('#pti-tipo').value).toBe('remanejamento');
    confirmAction.mockResolvedValue(false);
    await expect(h.save(host, extracted, f)).rejects.toThrow('Salvamento cancelado');
    expect(planosBucket.upload).not.toHaveBeenCalled();
    confirmAction.mockResolvedValue(true);
    await h.save(host, extracted, f);
    expect(confirmAction.mock.calls[0][0]).toMatch(/700,00.*500,00/);
    expect(supabaseClient.rpc.mock.calls.find(c => c[0] === 'upsert_plano_trabalho')[1].p_payload.proposta_id).toBe(p.id);
  });
  it('sem plano anterior não pergunta por um falso zero; falha SQL limpa o upload', async () => {
    const p = proposta(); p.payload.tipo = 'remanejamento';
    await page.revisarPropostaPlano(p);
    const h = queue.handlers[0], f = queue.files[0], extracted = await h.parse(f);
    await h.renderReview(host, extracted, f);
    rpcErro = { message: 'Proposta não pendente' };
    await expect(h.save(host, extracted, f)).rejects.toThrow('Erro ao salvar plano');
    expect(confirmAction).not.toHaveBeenCalled();
    expect(planosBucket.remove).toHaveBeenCalledWith([planosBucket.upload.mock.calls[0][0]]);
  });

  it.each([true, false])('consulta de plano ativo falha: salva sem comparação nem aviso falso (Buriti=%s)', async buriti => {
    let h, f, extracted;
    if (buriti) {
      const p = proposta(); p.payload.tipo = 'remanejamento';
      await page.revisarPropostaPlano(p);
      h = queue.handlers[0]; f = queue.files[0]; extracted = await h.parse(f);
    } else {
      h = (await page.getImportHandlers()).plano;
      f = new File(['sintético'], 'plano.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      extracted = ex();
    }
    await h.renderReview(host, extracted, f);
    host.querySelector('#pti-tipo').value = 'remanejamento';
    supabaseClient.rpc.mockImplementation(async nome => nome === 'get_plano_ativo'
      ? { data: { valor_total_plano: 999 }, error: { message: 'Consulta indisponível' } }
      : { error: null });
    await expect(h.save(host, extracted, f)).resolves.toMatchObject({ label: 'Plano sintético' });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(planosBucket.upload).toHaveBeenCalledTimes(1);
    const call = supabaseClient.rpc.mock.calls.find(c => c[0] === 'upsert_plano_trabalho');
    expect(call[1].p_payload.tipo).toBe('remanejamento');
    if (buriti) expect(call[1].p_payload.proposta_id).toBe('proposta-x');
    else expect(call[1].p_payload.proposta_id).toBeUndefined();
  });
  it('não oferece fallback manual e recusa proposta inválida ou decidida', async () => {
    await page.revisarPropostaPlano(proposta());
    expect(queue.handlers[0].manualFallback).toBeUndefined();
    await expect(page.revisarPropostaPlano({ ...proposta(), status: 'aplicada' })).rejects.toThrow('pendente');
    await expect(page.revisarPropostaPlano({ ...proposta(), payload: {} })).rejects.toThrow('dados do plano');
  });
  it('falha de download só mostra detalhe técnico para admin', async () => {
    propostasBucket.download.mockResolvedValue({ error: { message: 'storage erro técnico' } });
    vi.stubGlobal('detalheTecnico', () => 'Avise o administrador.');
    await expect(page.revisarPropostaPlano(proposta())).rejects.toThrow('Avise o administrador');
    expect(queue).toBeNull();
  });
});
