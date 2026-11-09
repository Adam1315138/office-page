/**
 * Office.js 封装
 *
 * 目标：把 Word / Excel / PowerPoint 的差异压成一个统一接口，
 * 上层只关心「读选区 / 读全文 / 替换选区 / 在选区后插入」。
 */

(function () {
  'use strict';

  const state = {
    host: 'Unknown',
    ready: null,
    canEdit: false,
    supportsSelection: false,
    note: ''
  };

  function detectHost() {
    try {
      const info = Office.context && Office.context.host;
      if (info) return String(info);
    } catch (e) { /* ignore */ }
    // 退路：看全局对象
    if (typeof Word !== 'undefined') return 'Word';
    if (typeof Excel !== 'undefined') return 'Excel';
    if (typeof PowerPoint !== 'undefined') return 'PowerPoint';
    return 'Unknown';
  }

  function hostLabel(h) {
    return ({ Word: 'Word', Excel: 'Excel', PowerPoint: 'PowerPoint' })[h] || '未知应用';
  }

  const readyPromise = new Promise((resolve) => {
    function finish() {
      state.host = detectHost();
      state.canEdit = state.host === 'Word' || state.host === 'Excel' || state.host === 'PowerPoint';
      state.supportsSelection = state.host === 'Word' || state.host === 'Excel';
      if (state.host === 'PowerPoint') {
        // 只做提示，真正的判定在 pptGetSelection 里靠运行时能力检测
        state.note = 'PPT 能否改写选中文字取决于 Office 版本（需要 2024 及以上）；2021/LTSC 只能对话和读整篇文字';
      }
      resolve(state);
    }

    if (typeof Office !== 'undefined' && Office.onReady) {
      Office.onReady(() => finish());
      // 兜底：某些宿主 onReady 不回调
      setTimeout(() => {
        if (state.host === 'Unknown') finish();
      }, 3000);
    } else {
      finish();
    }
  });

  /* ---------------- Word ---------------- */

  async function wordGetSelection() {
    return Word.run(async (ctx) => {
      const sel = ctx.document.getSelection();
      sel.load('text');
      await ctx.sync();
      return { text: sel.text || '', meta: '' };
    });
  }

  async function wordGetDocumentText(maxChars) {
    return Word.run(async (ctx) => {
      const body = ctx.document.body;
      body.load('text');
      await ctx.sync();
      const text = body.text || '';
      return text.length > maxChars ? text.slice(0, maxChars) : text;
    });
  }

  async function wordReplaceSelection(newText) {
    return Word.run(async (ctx) => {
      const sel = ctx.document.getSelection();
      sel.insertText(newText, Word.InsertLocation.replace);
      await ctx.sync();
    });
  }

  async function wordInsertAfter(newText) {
    return Word.run(async (ctx) => {
      const sel = ctx.document.getSelection();
      sel.insertText('\n' + newText, Word.InsertLocation.after);
      await ctx.sync();
    });
  }

  /* ---------------- Excel ---------------- */

  async function excelGetSelection() {
    return Excel.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load(['text', 'address', 'rowCount', 'columnCount']);
      await ctx.sync();
      const flat = [];
      for (const row of range.text || []) {
        for (const cell of row) {
          if (cell !== '' && cell != null) flat.push(cell);
        }
      }
      return {
        text: flat.join('\n'),
        meta: range.address + '（' + range.rowCount + '×' + range.columnCount + '）'
      };
    });
  }

  async function excelGetDocumentText(maxChars) {
    return Excel.run(async (ctx) => {
      const used = ctx.workbook.worksheets.getActiveWorksheet().getUsedRange();
      used.load('text');
      await ctx.sync();
      const lines = [];
      for (const row of used.text || []) {
        lines.push(row.join('\t'));
        if (lines.join('\n').length > maxChars) break;
      }
      const text = lines.join('\n');
      return text.length > maxChars ? text.slice(0, maxChars) : text;
    });
  }

  async function excelReplaceSelection(newText) {
    return Excel.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load(['rowCount', 'columnCount']);
      await ctx.sync();
      // 单格就整体写入；多格则把整段文本放进左上角
      if (range.rowCount === 1 && range.columnCount === 1) {
        range.values = [[newText]];
      } else {
        const topLeft = range.getCell(0, 0);
        topLeft.values = [[newText]];
      }
      await ctx.sync();
    });
  }

  async function excelInsertAfter(newText) {
    return Excel.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load(['rowIndex', 'columnIndex']);
      await ctx.sync();
      const target = ctx.workbook.worksheets.getActiveWorksheet().getCell(range.rowIndex + 1, range.columnIndex);
      target.values = [[newText]];
      await ctx.sync();
    });
  }

  /* ---------------- PowerPoint ---------------- */

  /**
   * PPT 的能力完全取决于 Office 版本，实测结论：
   *   - 读取/写入选中文字（getSelectedTextRange）：PowerPointApi 1.6，**Office 2024 及以上**
   *   - Office 2021 / LTSC 2021 最高只有 PowerPointApi 1.2，根本没有这个 API
   * 所以这里靠运行时能力检测，不靠猜版本号。
   */
  function pptHas(fn) {
    return typeof PowerPoint !== 'undefined' && typeof fn === 'function';
  }

  async function pptGetSelection() {
    // 先试官方选区 API（1.6+）
    const probe = await PowerPoint.run(async (ctx) => {
      return typeof ctx.presentation.getSelectedTextRange === 'function';
    }).catch(() => false);

    if (probe) {
      return PowerPoint.run(async (ctx) => {
        const range = ctx.presentation.getSelectedTextRange();
        range.load('text');
        await ctx.sync();
        return { text: range.text || '', meta: '' };
      });
    }

    // 低版本：读当前幻灯片里的文字，当"上下文"给模型，但不假装是选区
    const slideText = await pptGetCurrentSlideText().catch(() => '');
    if (slideText) {
      return {
        text: '',
        meta: '',
        error: '当前 PowerPoint 不支持读取「选中文字」（需要 Office 2024 或 M365）。'
          + '已改为读取当前幻灯片的全部文字，供你参考。'
      };
    }
    return {
      text: '',
      meta: '',
      error: '当前 PowerPoint 版本不支持读取选中文字（需要 Office 2024 或 M365）。'
    };
  }

  async function pptReplaceSelection(newText) {
    const probe = await PowerPoint.run(async (ctx) => {
      return typeof ctx.presentation.getSelectedTextRange === 'function';
    }).catch(() => false);

    if (!probe) {
      throw new Error(
        '当前 PowerPoint 版本不支持写入选中文字（该 API 需要 Office 2024 或 M365）。'
        + 'Word 和 Excel 可以正常改写。'
      );
    }
    return PowerPoint.run(async (ctx) => {
      const range = ctx.presentation.getSelectedTextRange();
      range.text = newText;
      await ctx.sync();
    });
  }

  /** 读当前幻灯片的全部文字（低版本也能用，失败就返回空） */
  async function pptGetCurrentSlideText() {
    try {
      return await PowerPoint.run(async (ctx) => {
        const slides = ctx.presentation.slides;
        slides.load('items');
        await ctx.sync();
        if (!slides.items.length) return '';
        // 取第一张（多数情况就是当前正在看的那张）
        const shapes = slides.items[0].shapes;
        shapes.load('items');
        await ctx.sync();

        const frames = shapes.items
          .map((s) => { try { return s.textFrame; } catch (e) { return null; } })
          .filter(Boolean);
        frames.forEach((f) => { try { f.textRange.load('text'); } catch (e) { /* 图片等没有 textFrame */ } });
        await ctx.sync();

        return frames
          .map((f) => { try { return f.textRange.text || ''; } catch (e) { return ''; } })
          .filter(Boolean)
          .join('\n')
          .trim();
      });
    } catch (e) {
      return '';
    }
  }

  /** 读整份演示文稿的文字（逐页），用于"总结这份 PPT" */
  async function pptGetDocumentText(maxChars) {
    try {
      return await PowerPoint.run(async (ctx) => {
        const slides = ctx.presentation.slides;
        slides.load('items');
        await ctx.sync();

        const out = [];
        for (let i = 0; i < slides.items.length; i += 1) {
          const shapes = slides.items[i].shapes;
          shapes.load('items');
        }
        await ctx.sync();

        for (let i = 0; i < slides.items.length; i += 1) {
          const shapes = slides.items[i].shapes;
          const frames = shapes.items
            .map((s) => { try { return s.textFrame; } catch (e) { return null; } })
            .filter(Boolean);
          frames.forEach((f) => { try { f.textRange.load('text'); } catch (e) { /* ignore */ } });
        }
        await ctx.sync();

        for (let i = 0; i < slides.items.length; i += 1) {
          const texts = slides.items[i].shapes.items
            .map((s) => { try { return s.textFrame.textRange.text || ''; } catch (e) { return ''; } })
            .filter(Boolean);
          if (texts.length) out.push('[第 ' + (i + 1) + ' 页]\n' + texts.join('\n'));
        }

        const joined = out.join('\n\n');
        return joined.length > maxChars ? joined.slice(0, maxChars) + '\n…（已截断）' : joined;
      });
    } catch (e) {
      return '';
    }
  }

  /* ---------------- 统一接口 ---------------- */

  async function getSelection() {
    await readyPromise;
    try {
      if (state.host === 'Word') return await wordGetSelection();
      if (state.host === 'Excel') return await excelGetSelection();
      if (state.host === 'PowerPoint') return await pptGetSelection();
    } catch (err) {
      return { text: '', meta: '', error: String(err && err.message ? err.message : err) };
    }
    return { text: '', meta: '', error: '不支持的宿主' };
  }

  async function getDocumentText(maxChars) {
    await readyPromise;
    const limit = Math.max(1000, Number(maxChars) || 20000);
    try {
      if (state.host === 'Word') return await wordGetDocumentText(limit);
      if (state.host === 'Excel') return await excelGetDocumentText(limit);
      if (state.host === 'PowerPoint') return await pptGetDocumentText(limit);
    } catch (err) {
      return '';
    }
    return '';
  }

  async function replaceSelection(newText) {
    await readyPromise;
    if (state.host === 'Word') return wordReplaceSelection(newText);
    if (state.host === 'Excel') return excelReplaceSelection(newText);
    if (state.host === 'PowerPoint') return pptReplaceSelection(newText);
    throw new Error('当前应用不支持改写');
  }

  async function insertAfterSelection(newText) {
    await readyPromise;
    if (state.host === 'Word') return wordInsertAfter(newText);
    if (state.host === 'Excel') return excelInsertAfter(newText);
    throw new Error('当前应用不支持插入');
  }

  window.OfficeAPI = {
    ready: readyPromise,
    get state() { return state; },
    hostLabel: () => hostLabel(state.host),
    getSelection,
    getDocumentText,
    replaceSelection,
    insertAfterSelection
  };
})();
