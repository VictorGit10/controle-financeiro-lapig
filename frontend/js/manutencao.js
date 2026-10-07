/* ============================================================
   Modo manutenção — tela de "estamos atualizando" durante migrações
   ============================================================
   Liga/desliga em frontend/manutencao.json ({"ativo": true, "mensagem": "..."}), publicado no master.
   Confere ao abrir e a cada minuto, então também pega quem já está com o site aberto; ao desligar,
   recarrega a página. Falha de leitura NÃO bloqueia o site (o arquivo some ou a rede cai: segue normal). */
const PADRAO = 'O Controle Financeiro está em atualização. Volte em alguns minutos — não é preciso fazer nada.';
let ativa = false;

// Pura: decide a partir do JSON. Só "ativo": true liga.
export function interpretar(json) {
    if (!json || json.ativo !== true) return { ativo: false };
    const msg = typeof json.mensagem === 'string' && json.mensagem.trim() ? json.mensagem.trim().slice(0, 500) : PADRAO;
    return { ativo: true, mensagem: msg };
  }

  function mostrar(mensagem) {
    let el = document.getElementById('manutencao-tela');
    if (!el) {
      el = document.createElement('div');
      el.id = 'manutencao-tela';
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-live', 'assertive');
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
        'padding:24px;background:#f5f1e6;color:#1f3a2b;font-family:Arial,Helvetica,sans-serif;text-align:center;';
      const caixa = document.createElement('div');
      caixa.style.cssText = 'max-width:440px;border-top:4px solid #1f3a2b;border-bottom:2px solid #c9a227;padding:28px 8px;';
      const titulo = document.createElement('h1');
      titulo.textContent = 'Em atualização';
      titulo.style.cssText = 'font-family:Georgia,serif;font-size:26px;margin:0 0 12px;';
      const texto = document.createElement('p');
      texto.id = 'manutencao-texto';
      texto.style.cssText = 'font-size:16px;line-height:1.6;margin:0;color:#2b2b2b;';
      caixa.append(titulo, texto);
      el.append(caixa);
      document.body.append(el);
    }
    document.getElementById('manutencao-texto').textContent = mensagem;
    ativa = true;
  }

  async function conferir() {
    try {
      const r = await fetch('manutencao.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const estado = interpretar(await r.json());
      if (estado.ativo) mostrar(estado.mensagem);
      else if (ativa) location.reload();
    } catch { /* sem arquivo ou sem rede: o site segue normal */ }
  }

if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof fetch !== 'undefined' && !window.__VITEST__) {
  const iniciar = () => { conferir(); setInterval(conferir, 60000); };
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
}
