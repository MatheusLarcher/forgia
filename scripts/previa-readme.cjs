'use strict';
// Pré-visualização local do README.md (não é o GitHub): converte o Markdown com um conversor
// mínimo daqui (o que o README usa: HTML, títulos, parágrafos, negrito, código, links, listas,
// tabelas, <details>) e captura a página inteira com estilos parecidos com os do GitHub.
//   npx electron scripts/previa-readme.cjs [saida.png]   (padrão: docs/fase-e-evidence/readme-previa.png)
// Gera também <saida>-aberto.png com as perguntas (<details>) abertas. Perfil temporário.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv.find((a) => a.endsWith('.png')) || path.join('docs', 'fase-e-evidence', 'readme-previa.png'));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'forgia-readme-'));
app.setPath('userData', perfil);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(esc(c)) - 1}\u0000`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}
const isBlockStart = (l) => /^(#{1,6}\s|```|---\s*$|\||\d+\.\s|[-*]\s|\s*<)/.test(l);

function md(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  // itens de lista: o conteúdo continua nas linhas recuadas (e nas vazias entre elas)
  const listItems = (re, indent) => {
    const items = [];
    while (i < lines.length && re.test(lines[i])) {
      const buf = [lines[i].replace(re, '')];
      i++;
      while (i < lines.length && (lines[i].startsWith(' '.repeat(indent)) || (!lines[i].trim() && i + 1 < lines.length && lines[i + 1].startsWith(' '.repeat(indent))))) buf.push(lines[i++].slice(indent));
      items.push(md(buf.join('\n')));
      while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && re.test(lines[i + 1])) i++;
    }
    return items.map((x) => `<li>${x}</li>`).join('');
  };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^---\s*$/.test(l)) {
      out.push('<hr>');
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*</.test(l)) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join('\n'));
      continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const [head, , ...body] = rows;
      const th = cells(head).map((c) => `<th>${c}</th>`).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\d+\.\s/.test(l)) {
      out.push(`<ol>${listItems(/^\d+\.\s+/, 3)}</ol>`);
      continue;
    }
    if (/^[-*]\s/.test(l)) {
      out.push(`<ul>${listItems(/^[-*]\s+/, 2)}</ul>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines[i]))) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const CSS = `
body { margin: 0; background: #fff; color: #1f2328; font: 16px/1.5 -apple-system, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 32px 45px 48px; border: 1px solid #d1d9e0; border-radius: 6px; margin-top: 24px; margin-bottom: 24px; }
h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; margin: .67em 0 16px; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; margin: 24px 0 16px; font-weight: 600; }
p, ul, ol, table, pre, details { margin: 0 0 16px; }
a { color: #0969da; text-decoration: none; }
code { font: 85% ui-monospace, Consolas, monospace; background: rgba(129,139,152,.12); padding: .2em .4em; border-radius: 6px; }
pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; font-size: 85%; }
hr { height: 4px; border: 0; background: #d1d9e0; margin: 24px 0; }
table { border-collapse: collapse; }
td, th { border: 1px solid #d1d9e0; padding: 6px 13px; }
tr:nth-child(2n) td { background: #f6f8fa; }
img { max-width: 100%; }
summary { cursor: pointer; }
sub { font-size: 75%; color: #59636e; }
`;

app.whenReady().then(async () => {
  let code = 0;
  try {
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base href="file:///${ROOT.replace(/\\/g, '/')}/"><style>${CSS}</style></head><body><main>${md(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'))}</main></body></html>`;
    const tmp = path.join(perfil, 'readme.html');
    fs.writeFileSync(tmp, html);
    const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { offscreen: false, sandbox: true } });
    await win.loadFile(tmp);
    const shot = async (file) => {
      await new Promise((r) => setTimeout(r, 1500)); // imagens e GIFs carregados
      const h = await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
      win.setContentSize(1100, Math.min(h, 16000));
      await new Promise((r) => setTimeout(r, 600));
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, img.toPNG());
      const bad = await win.webContents.executeJavaScript('[...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute("src"))');
      console.log(path.relative(ROOT, file), `${h}px`, bad.length ? `imagens que não carregaram: ${bad.join(', ')}` : 'todas as imagens carregaram');
      if (bad.length) code = 1;
    };
    await shot(OUT);
    await win.webContents.executeJavaScript('document.querySelectorAll("details").forEach((d) => (d.open = true)), true');
    await shot(OUT.replace(/\.png$/, '-aberto.png'));
    win.destroy();
  } catch (err) {
    console.error(err);
    code = 1;
  }
  app.exit(code);
});
app.on('quit', () => fs.rmSync(perfil, { recursive: true, force: true }));
