// Publica o Vigia na conta logada no clasp (victoramaral.lapig): build e push do Código.gs.
// Uso: node tools/vigia/publicar.js          (repetir a cada mudança; reaproveita o projeto)
//      node tools/vigia/publicar.js --seco   (monta o palco e mostra os passos, sem chamar o clasp)
// O vigia não é web app: sem implantação, sem token. Quem publica é o Claude; no link do editor
// o Victor só preenche as Propriedades do script e executa testarConfiguracao, checar (autoriza),
// resumoDiario e instalarGatilhos.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { build } = require('./build');

const PALCO = path.join(__dirname, '.publicar');
const SECO = process.argv.indexOf('--seco') >= 0;

function clasp(args) {
  return execSync('clasp ' + args, { cwd: PALCO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
// Só "arquivo não existe" vira padrão: JSON corrompido ou acesso negado param tudo, senão o script
// recriaria o projeto em silêncio e perderia o scriptId original.
function lerJson(f, padrao) {
  let texto;
  try { texto = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return padrao; throw e; }
  try { return JSON.parse(texto.replace(/^﻿/, '')); } catch { throw new Error('Arquivo inválido, conserte ou apague: ' + f); }
}

function main() {
  const destino = build();
  fs.mkdirSync(PALCO, { recursive: true });
  fs.copyFileSync(destino, path.join(PALCO, 'Vigia.gs'));
  fs.copyFileSync(path.join(__dirname, 'apps-script', 'appsscript.json'), path.join(PALCO, 'appsscript.json'));
  fs.writeFileSync(path.join(PALCO, '.claspignore'), '**/**\n!Vigia.gs\n!appsscript.json\n');

  const primeira = !fs.existsSync(path.join(PALCO, '.clasp.json'));
  const criar = 'clasp create-script --type standalone --title "Vigia LAPIG" --rootDir .';
  if (SECO) {
    console.log('--seco: palco pronto em ' + PALCO);
    fs.readdirSync(PALCO).forEach(f => console.log('  ' + f + ' (' + fs.statSync(path.join(PALCO, f)).size + ' bytes)'));
    console.log(primeira ? 'Faria, na primeira publicação: ' + criar : 'Reaproveitaria o projeto de .clasp.json (sem create).');
    console.log('Faria sempre: clasp push -f');
    console.log('Nada foi enviado. Sem --seco, o clasp roda de verdade.');
    return;
  }

  if (primeira) {
    clasp('create-script --type standalone --title "Vigia LAPIG" --rootDir .');
    console.log('Projeto criado no Apps Script.');
    // O create-script pode gravar o manifesto padrão no palco: recopiar o nosso antes do push.
    fs.copyFileSync(path.join(__dirname, 'apps-script', 'appsscript.json'), path.join(PALCO, 'appsscript.json'));
    fs.copyFileSync(destino, path.join(PALCO, 'Vigia.gs'));
  }
  clasp('push -f');
  console.log('Push concluído.');
  const id = lerJson(path.join(PALCO, '.clasp.json'), {}).scriptId;
  console.log('Editor: https://script.google.com/d/' + (typeof id === 'string' ? id : '<scriptId>') + '/edit');
  console.log(['', 'No editor (conta do Victor):',
    '1. Propriedades do script: preencher a tabela do README (valores com o administrador).',
    '2. Executar testarConfiguracao: as obrigatórias devem dizer ok.',
    '3. Executar checar e autorizar os escopos com a conta (Gmail, e-mail, conexões, gatilhos).',
    '4. Executar resumoDiario: deve chegar um resumo, mesmo sem tarefas.',
    '5. Executar instalarGatilhos: checagem a cada 30 min e resumo na faixa das 8h.'].join('\n'));
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(String(e.stderr || e.message || e)); process.exit(1); }
}
