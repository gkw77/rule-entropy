// 扫全部 skill 源（个人 + gstack + marketplaces + cache），跟随符号链接，
// 生成 skills-corpus-full.json（带 source 字段，按 name 去重）。
//
// 对比 skills-corpus.json（仅 70 个个人直接子目录，且漏了符号链接 skill）：
//   - 本生成器补两件事：(1) 跟随符号链接拿到 caveman/diagnose 等；(2) 扫 gstack/marketplace/cache
//   - 目标 1143 = 70 personal + 545 gstack + 466 marketplace + 61 cache
// source 优先级 personal > gstack > marketplace > cache（同名去重保留高优先级）。

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
const ROOTS = [
  { source: 'personal', dir: `${CLAUDE}/skills`, direct: true }, // 仅直接子目录
  { source: 'gstack', dir: `${CLAUDE}/skills/gstack`, direct: false },
  { source: 'marketplace', dir: `${CLAUDE}/plugins/marketplaces`, direct: false },
  { source: 'cache', dir: `${CLAUDE}/plugins/cache`, direct: false },
];
const OUT = path.join(__dirname, '..', 'skills-corpus-full.json');
const PERSONAL_EXCLUDE = new Set(['gstack', '_gstack-command']); // gstack 单独扫；_gstack-command 是命令非 skill

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const body = m[1];
  const result = { triggers: [] };
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // YAML 块标量：field: | 或 > （多行，gstack/ctx-* 用这格式，之前误把 | 当描述）
    const blockMatch = line.match(/^(name|description):\s*([|>])-?\s*$/);
    if (blockMatch) {
      const field = blockMatch[1];
      const folded = blockMatch[2] === '>';
      i++;
      const blockLines = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l === '') { i++; continue; }
        if (/^\s+/.test(l)) { blockLines.push(l.replace(/^\s+/, '')); i++; continue; }
        break;
      }
      const val = blockLines.join(folded ? ' ' : '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (field === 'name') result.name = val;
      else result.description = val;
      continue;
    }
    const nameMatch = line.match(/^name:\s*(.+)$/);
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (nameMatch) result.name = nameMatch[1].trim();
    else if (descMatch) result.description = descMatch[1].trim();
    else if (/^triggers:\s*$/.test(line)) {
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        result.triggers.push(lines[i].replace(/^\s+-\s+/, '').trim());
        i++;
      }
      continue;
    }
    i++;
  }
  return result;
}

// 收集 SKILL.md 文件路径。direct=true 只取直接子目录下的 SKILL.md；
// direct=false 递归找。statSync 跟随符号链接，visited 防环。
function collectSkillFiles(root) {
  const out = [];
  const visited = new Set();
  function real(p) { try { return fs.realpathSync(p); } catch { return p; } }

  if (root.direct) {
    let entries;
    try { entries = fs.readdirSync(root.dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (PERSONAL_EXCLUDE.has(e.name)) continue;
      const p = path.join(root.dir, e.name);
      let st;
      try { st = fs.statSync(p); } catch { continue; } // 跟随符号链接
      if (!st.isDirectory()) continue;
      const sf = path.join(p, 'SKILL.md');
      if (fs.existsSync(sf)) out.push({ source: root.source, file: sf, dir: e.name });
    }
    return out;
  }

  function rec(d) {
    const rp = real(d);
    if (visited.has(rp)) return;
    visited.add(rp);
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.github') continue;
      const p = path.join(d, e.name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) rec(p);
      else if (e.name === 'SKILL.md') out.push({ source: root.source, file: p, dir: path.basename(d) });
    }
  }
  rec(root.dir);
  return out;
}

function main() {
  const files = [];
  for (const r of ROOTS) {
    const got = collectSkillFiles(r);
    console.log(`${r.source.padEnd(12)} ${got.length} 个 SKILL.md  (${r.dir})`);
    files.push(...got);
  }
  console.log(`合计 ${files.length} 个 SKILL.md 文件\n`);

  // 解析 frontmatter，按 name 去重（首现保留，ROOTS 顺序即优先级）
  const manifest = [];
  const seen = new Set();
  let noDesc = 0;
  const perSource = {};
  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f.file, 'utf8'); } catch { continue; }
    const fm = parseFrontmatter(content);
    const name = fm.name || f.dir;
    if (seen.has(name)) continue; // 同名去重
    seen.add(name);
    const desc = fm.description || '';
    const triggers = fm.triggers || [];
    if (!desc && triggers.length === 0) noDesc++;
    let mtime = null;
    try { mtime = fs.statSync(f.file).mtime.toISOString(); } catch {}
    manifest.push({ name, dir: f.dir, source: f.source, description: desc, triggers, file: path.relative(CLAUDE, f.file).replace(/\\/g, '/'), mtime });
    perSource[f.source] = (perSource[f.source] || 0) + 1;
  }

  manifest.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`去重后 ${manifest.length} 个 skill 入 manifest`);
  console.log('按 source:', JSON.stringify(perSource));
  console.log(`有 description: ${manifest.filter(m => m.description).length}`);
  console.log(`有 triggers: ${manifest.filter(m => m.triggers.length > 0).length}`);
  console.log(`两者皆无(仅靠名字): ${noDesc}`);
  console.log(`\nmanifest 写入: ${OUT}`);
  console.log('\n各 source 样例 (前 2):');
  for (const src of ['personal', 'gstack', 'marketplace', 'cache']) {
    const samples = manifest.filter(m => m.source === src).slice(0, 2);
    for (const m of samples) {
      console.log(`  [${src}] ${m.name}: ${(m.description || '(无描述)').slice(0, 70)}`);
    }
  }
}

main();
