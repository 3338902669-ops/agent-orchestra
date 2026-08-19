import fs from 'node:fs';
const md = fs.readFileSync('promotion.md', 'utf8');
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function render(md){
  const lines = md.split('\n');
  let html = '', inCode = false, inList = false;
  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('```')) {
      if (inCode) { html += '</pre>'; inCode = false; }
      else { html += '<pre>'; inCode = true; }
      continue;
    }
    if (inCode) { html += esc(line) + '\n'; continue; }
    if (line.startsWith('## ')) { html += '<h2>' + esc(line.slice(3)) + '</h2>'; continue; }
    if (line.startsWith('# ')) { html += '<h1>' + esc(line.slice(2)) + '</h1>'; continue; }
    if (line.startsWith('### ')) { html += '<h3>' + esc(line.slice(4)) + '</h3>'; continue; }
    if (line.startsWith('- ')) { if(!inList){html+='<ul>';inList=true;} html += '<li>' + esc(line.slice(2)) + '</li>'; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line.startsWith('> ')) { html += '<blockquote>' + esc(line.slice(2)) + '</blockquote>'; continue; }
    if (line.trim() === '') { html += '<div class="gap"></div>'; continue; }
    html += '<p>' + esc(line) + '</p>';
  }
  if (inCode) html += '</pre>';
  if (inList) html += '</ul>';
  return html;
}
const body = render(md);
const css = 'body{font-family:Segoe UI,Microsoft YaHei,sans-serif;color:#1f2328;line-height:1.7;max-width:760px;margin:0 auto;padding:48px 40px}'
 + ' h1{font-size:26px;border-bottom:3px solid #1f6feb;padding-bottom:10px}'
 + ' h2{font-size:20px;color:#0d1117;border-left:4px solid #1f6feb;padding-left:10px;margin-top:34px}'
 + ' h3{font-size:16px;color:#24292f}'
 + ' pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:12px 14px;font-family:Consolas,monospace;font-size:12.5px;white-space:pre-wrap}'
 + ' blockquote{background:#f6f8fa;border-left:4px solid #57606a;margin:10px 0;padding:8px 14px;color:#57606a}'
 + ' p{margin:8px 0} ul{margin:6px 0;padding-left:22px} .gap{height:6px}';
const doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + body + '</body></html>';
fs.writeFileSync('tmp-promotion.html', doc);
console.log('HTML written, length=' + doc.length);
