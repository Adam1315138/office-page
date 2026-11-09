/**
 * 极简 Markdown 渲染（先转义再处理，模型输出不可信）
 */

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeUrl(url) {
    const u = String(url || '').trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^mailto:/i.test(u)) return u;
    if (/^\/\//.test(u)) return 'https:' + u;
    return '';
  }

  function inline(text) {
    let s = escapeHtml(text);

    // 行内代码先处理，避免里面内容被后续规则改坏
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // 链接
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = sanitizeUrl(url);
      if (!safe) return label;
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });

    // 裸链接
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });

    s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => '<code>' + codes[Number(i)] + '</code>');
    return s;
  }

  function render(markdown) {
    const src = String(markdown || '');
    if (!src.trim()) return '';

    const lines = src.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      if (/^```/.test(line)) {
        const lang = line.slice(3).trim();
        const buf = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        i += 1;
        out.push('<pre><code' + (lang ? ' class="language-' + escapeHtml(lang) + '"' : '') + '>'
          + escapeHtml(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 标题
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const level = Math.min(4, h[1].length) + 2;
        out.push('<h' + level + '>' + inline(h[2]) + '</h' + level + '>');
        i += 1;
        continue;
      }

      // 分隔线
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
        out.push('<hr>');
        i += 1;
        continue;
      }

      // 列表
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')) + '</li>');
          i += 1;
        }
        out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
        continue;
      }

      // 空行
      if (!line.trim()) {
        i += 1;
        continue;
      }

      // 段落
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|[-*+]\s|\d+[.)]\s)/.test(lines[i])) {
        para.push(lines[i]);
        i += 1;
      }
      if (para.length) out.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
    }

    return out.join('\n');
  }

  window.MD = { render, escapeHtml, sanitizeUrl };
})();
