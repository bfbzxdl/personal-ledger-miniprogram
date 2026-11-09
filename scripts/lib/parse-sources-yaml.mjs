// scripts/lib/parse-sources-yaml.mjs
// 只解析 docs/SOURCES.yaml 用到的 YAML 子集：
//   顶层键、两空格缩进的列表、`- key: value` 列表项、`[a, b]` 行内数组、单/双引号标量、# 注释。
// 目的：让 SOURCES.yaml 保持唯一事实来源，同时让云函数无需引入 YAML 依赖。

/** 去掉行尾注释（引号内的 # 不处理：本文件没有该用法） */
function stripComment(line) {
  let inQuote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = '';
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(raw) {
  const v = String(raw).trim();
  if (v === '') return '';
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitInline(inner).map((x) => parseScalar(x));
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** 按逗号切分行内数组，忽略引号内的逗号 */
function splitInline(s) {
  const out = [];
  let buf = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ',') {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** 切第一个「冒号 + 空白或行尾」，且不在引号内 */
function splitKV(text) {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ':' && (i === text.length - 1 || /\s/.test(text[i + 1]))) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
  }
  throw new Error('无法解析的键值行: ' + text);
}

export function parseSourcesYaml(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, '  '));
  let i = 0;

  const indentOf = (l) => l.match(/^ */)[0].length;
  const skip = () => {
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || t.startsWith('#')) i++;
      else break;
    }
  };

  function parseBlock(minIndent) {
    skip();
    if (i >= lines.length) return null;
    const ind = indentOf(lines[i]);
    if (ind < minIndent) return null;
    return lines[i].trim().startsWith('- ') ? parseList(ind) : parseMap(ind);
  }

  function parseList(ind) {
    const arr = [];
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const line = lines[i];
      if (indentOf(line) !== ind || !line.trim().startsWith('- ')) break;
      const rest = line.trim().slice(2).trim();
      i++;
      if (/^[^:'"]+\s*:(\s|$)/.test(rest)) {
        const [k, v] = splitKV(rest);
        const item = {};
        item[k] = v === '' ? parseBlock(ind + 2) : parseScalar(v);
        Object.assign(item, parseMap(ind + 2) || {});
        arr.push(item);
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  function parseMap(ind) {
    const obj = {};
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const line = lines[i];
      const t = line.trim();
      if (indentOf(line) !== ind || t.startsWith('- ')) break;
      const [k, v] = splitKV(t);
      i++;
      obj[k] = v === '' ? parseBlock(ind + 1) : parseScalar(v);
      if (obj[k] === null) obj[k] = '';
    }
    return obj;
  }

  const doc = parseBlock(0);
  skip();
  if (i < lines.length) {
    throw new Error('第 ' + (i + 1) + ' 行无法归属到任何键: ' + lines[i]);
  }
  return doc;
}

export default parseSourcesYaml;
