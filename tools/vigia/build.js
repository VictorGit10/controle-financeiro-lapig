const fs = require('node:fs');
const path = require('node:path');
function build() {
  const ordem = ['00-util.js', 'mascara.js', 'triagem.js', 'ligacao.js', 'evidencia.js', 'prazos.js', 'modelo.js', 'processar.js', 'resumo.js'];
  const arquivos = ['src', 'apps-script'].flatMap(dir => fs.readdirSync(path.join(__dirname, dir)).filter(f => f.endsWith('.js')).sort((a, b) => dir === 'src' ? ordem.indexOf(a) - ordem.indexOf(b) : a.localeCompare(b)).map(f => path.join(dir, f)));
  const texto = '// GERADO por node tools/vigia/build.js — edite os fontes.\n' + arquivos.map(f => {
    const fonte = fs.readFileSync(path.join(__dirname, f), 'utf8')
      .replace(/^if \(typeof module !== 'undefined'\) module\.exports = \w+;\r?\n?/gm, '')
      .replace(/typeof module !== 'undefined' \? require\('[^']+'\) : (\w+)/g, '$1');
    return '// ' + f + '\n' + fonte;
  }).join('\n\n') + '\n';
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  const destino = path.join(__dirname, 'dist', 'Vigia.gs');
  fs.writeFileSync(destino, texto);
  return destino;
}
if (require.main === module) console.log(build());
module.exports = { build };
