// DOCX mínimo, gerado só com conteúdo sintético. ZIP sem compressão.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path), data = Buffer.from(text);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(data), 16); dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42); central.push(dir, name);
    offset += header.length + name.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}
const xml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const p = (text, bold = false) => '<w:p><w:r>' + (bold ? '<w:rPr><w:b/></w:rPr>' : '') +
  '<w:t>' + xml(text) + '</w:t></w:r></w:p>';
const row = (name, value, bold = false) => '<w:tr><w:tc>' + p(name, bold) +
  '</w:tc><w:tc>' + p(value) + '</w:tc></w:tr>';
export function docxSintetico({ total = '1.200,00', totalLabel = 'Total', modelo = 'proad' } = {}) {
  const content = modelo === 'proad'
    ? '<w:tbl>' + row('Plano de Aplicação dos Recursos Financeiros', 'Valor (R$)') +
      row('a- Pessoal', '800,00', true) + row('Bolsas', '800,00') +
      row('b- Serviços de Terceiros P. Jurídica', '400,00', true) +
      row('Serviço sintético', '400,00') + row(totalLabel, total) + '</w:tbl>'
    : p('Termo de Fomento — Prefeitura. 10. Custos. 16. Cronograma de Desembolso. Documento sintético para testar o modelo fora do padrão.');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      p('Plano sintético PROAD. Vigência 01/01/2026 a 31/12/2026.') + p('Data do documento: 08/10/2026') + p('CIP Total R$ 100,00; D.A.O da Fundação R$ 60,00;') + content +
      // Fora da tabela financeira: nunca aproveitar roster nem CPF do plano.
      '<w:tbl>' + row('Equipe — pessoa sintética', '123.456.789-09') + '</w:tbl>' +
      '</w:body></w:document>',
  });
}
