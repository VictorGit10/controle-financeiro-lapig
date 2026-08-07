// ==UserScript==
// @name         FUNAPE Conecta — nomear planilha de bolsas com o centro de custo
// @namespace    lapig-controle-financeiro
// @version      2.0
// @description  O portal Conecta exporta a planilha de bolsas como "bolsas.xlsx", sem nenhuma pista de qual centro de custo ela veio. Este script injeta o código FUNAPE (XX.XXX) no nome do arquivo — "bolsas-30.068.xlsx" — para que a importação no Controle Financeiro detecte o projeto sozinho.
// @match        https://conecta.funape.org.br/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
  Por que existe
  --------------
  O arquivo exportado pelo Conecta não carrega identificador nenhum: nome
  genérico, aba "Sheet1", docProps vazio, zero propriedades customizadas.
  Baixando 4 planilhas seguidas, viram "bolsas (10..13).xlsx" e não há como
  saber depois de qual projeto é cada uma.

  A informação existe — a página sabe qual centro de custo está selecionado
  no instante do export. Ela só é descartada na hora de nomear o arquivo.

  Por que a v1 não funcionou
  --------------------------
  No Chrome MV3 o Tampermonkey roda o script num "mundo isolado": ele
  compartilha o DOM com a página, mas NÃO o realm de JavaScript. Patchar
  `HTMLAnchorElement.prototype` lá dentro mexe num protótipo diferente do
  que o código do portal usa — o patch é aplicado e simplesmente não tem
  efeito nenhum sobre o download.

  A v2 resolve injetando o payload como uma tag <script> no documento, o
  que o faz executar no contexto da própria página. Funciona esteja o
  Tampermonkey isolado ou não, e dispensa ativar o modo desenvolvedor do
  Chrome. (Verificado: o portal não tem CSP que bloqueie script inline.)

  Diagnóstico
  -----------
  Abra o console (F12) antes de clicar em EXCEL. Você deve ver:
    [FUNAPE] Renomeador ativo (contexto da página).
    [FUNAPE] Renomeando export: bolsas.xlsx → bolsas-30.068.xlsx
  Se aparecer "blob gerado" mas nenhuma linha de "Renomeando", o portal
  não está usando o atributo `download` e o gancho precisa ser outro —
  nesse caso me mostre o que apareceu no console.
*/

(function () {
  'use strict';

  // Tudo dentro de `main` roda no contexto da página. Precisa ser
  // autossuficiente: nada de referências a variáveis deste escopo.
  function main() {
    /** Código FUNAPE (XX.XXX) do centro de custo selecionado no combobox. */
    function codigoSelecionado() {
      var preferidos = document.querySelectorAll('.MuiAutocomplete-root input');
      var todos = document.querySelectorAll('input');
      var lista = [].concat([].slice.call(preferidos), [].slice.call(todos));
      for (var i = 0; i < lista.length; i++) {
        var m = String(lista[i].value || '').match(/^\s*(\d{2}\.\d{3})\b/);
        if (m) return m[1];
      }
      return null;
    }

    /** "bolsas.xlsx" → "bolsas-30.068.xlsx" (no-op se não der para identificar). */
    function renomear(nome) {
      var nomeStr = String(nome == null ? '' : nome);
      if (!/\.(xlsx|xls)$/i.test(nomeStr)) return nome;

      var codigo = codigoSelecionado();
      if (!codigo) {
        console.warn('[FUNAPE] Centro de custo não identificado — nome mantido:', nomeStr);
        return nome;
      }
      if (nomeStr.indexOf(codigo) !== -1) return nome;

      var novo = nomeStr.replace(/\.(xlsx|xls)$/i, '-' + codigo + '.$1');
      console.log('[FUNAPE] Renomeando export:', nomeStr, '→', novo);
      return novo;
    }

    // Gancho 1: a.download = 'bolsas.xlsx'
    var desc = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'download');
    if (desc && desc.set && desc.get) {
      Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () { return desc.get.call(this); },
        set: function (v) { desc.set.call(this, renomear(v)); },
      });
    } else {
      console.warn('[FUNAPE] Propriedade `download` não interceptável neste navegador.');
    }

    // Gancho 2: a.setAttribute('download', 'bolsas.xlsx')
    var setAttrOriginal = HTMLAnchorElement.prototype.setAttribute;
    HTMLAnchorElement.prototype.setAttribute = function (nome, valor) {
      if (String(nome).toLowerCase() === 'download') valor = renomear(valor);
      return setAttrOriginal.call(this, nome, valor);
    };

    // Diagnóstico: se o blob nascer e nenhum gancho disparar, o portal usa
    // outro caminho para nomear o arquivo — e isso aparece no console.
    var criarURLOriginal = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      try { console.log('[FUNAPE] blob gerado:', blob && blob.size, 'bytes'); } catch (e) { /* noop */ }
      return criarURLOriginal(blob);
    };

    console.log('[FUNAPE] Renomeador ativo (contexto da página).');
  }

  var script = document.createElement('script');
  script.textContent = '(' + main.toString() + ')();';
  (document.head || document.documentElement).appendChild(script);
  script.remove();
})();
