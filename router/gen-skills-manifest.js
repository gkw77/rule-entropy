// 扫 ~/.claude/skills/*/SKILL.md（仅直接子目录，排除 gstack/ 子集合），
// 抽 frontmatter 的 name / description / triggers，生成 skills-corpus.json。
// 这就是路由器要索引的语料 -- frontmatter 本就是触发面。

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = process.env.SKILLS_DIR || 'C:/Users/ketwo/.claude/skills';
const OUT = path.join(__dirname, '..', 'skills-corpus.json');

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const body = m[1];
  const result = { triggers: [] };
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
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

function main() {
  const entries = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => !name.startsWith('_') && name !== 'gstack'); // 排除 _gstack-command 和 gstack 子集合

  const manifest = [];
  let noDesc = 0;
  for (const name of entries) {
    const skillFile = path.join(SKILLS_DIR, name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const content = fs.readFileSync(skillFile, 'utf8');
    const fm = parseFrontmatter(content);
    const desc = fm.description || '';
    const triggers = fm.triggers || [];
    if (!desc && triggers.length === 0) noDesc++;
    manifest.push({
      name: fm.name || name,
      dir: name,
      description: desc,
      triggers,
    });
  }

  manifest.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2), 'utf8');

  const withTriggers = manifest.filter(m => m.triggers.length > 0).length;
  console.log(`扫描 ${entries.length} 个 skill 目录，${manifest.length} 个有 SKILL.md`);
  console.log(`有 description: ${manifest.filter(m => m.description).length}`);
  console.log(`有 triggers 列表: ${withTriggers}`);
  console.log(`两者皆无（仅靠名字）: ${noDesc}`);
  console.log(`\nmanifest 写入: ${OUT}`);
  console.log('\n前 8 个样例:');
  for (const m of manifest.slice(0, 8)) {
    console.log(`  ${m.name}: ${m.description.slice(0, 60) || '(无描述)'}  triggers=${m.triggers.length}`);
  }
}

main();
