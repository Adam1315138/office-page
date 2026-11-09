/**
 * Office Copilot 主逻辑
 *
 * 核心流程：
 *   选中文字 → 输入指令 → 模型改写 → 预览对比 → 点「应用」写回文档
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const el = {
    statusDot: $('status-dot'),
    hostTag: $('host-tag'),
    selbar: $('selbar'),
    selText: $('sel-text'),
    btnReadSel: $('btn-read-sel'),
    messages: $('messages'),
    empty: $('empty'),
    quickGrid: $('quick-grid'),
    input: $('input'),
    sendBtn: $('btn-send'),
    hint: $('hint'),
    btnClear: $('btn-clear'),
    btnSettings: $('btn-settings'),
    drawer: $('drawer'),
    drawerMask: $('drawer-mask'),
    btnCloseDrawer: $('btn-close-drawer'),
    btnSave: $('btn-save'),
    useSelection: $('use-selection'),
    useDocument: $('use-document'),
    allowSearch: $('allow-search')
  };

  const DEFAULT_SETTINGS = {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    apiKey: '',
    preview: true,
    stream: true,
    maxChars: 20000,
    searchBase: 'http://localhost:3000',
    // 搜索源：'auto' 用免费内置；也可选 tavily/serper/brave/exa/custom 并配 key
    searchProvider: 'auto',
    searchKey: '',
    // 模型请求是否经本地服务转发（模型 API 不支持 CORS 时用）
    useProxy: false,
    prompt: ''
  };

  /** 服务没起时的兜底列表（正常应该从 /api/search-providers 拉） */
  const FALLBACK_PROVIDERS = [
    { id: 'auto', label: '自动（免费内置，无需 Key）', needsKey: false },
    { id: 'bing', label: '必应（免费，抓页面）', needsKey: false },
    { id: 'duckduckgo', label: 'DuckDuckGo（免费，抓页面）', needsKey: false },
    { id: 'tavily', label: 'Tavily（需 Key）', needsKey: true, keyHint: 'https://tavily.com 申请' },
    { id: 'serper', label: 'Serper（需 Key）', needsKey: true, keyHint: 'https://serper.dev 申请' },
    { id: 'brave', label: 'Brave（需 Key）', needsKey: true, keyHint: 'https://brave.com/search/api 申请' },
    { id: 'exa', label: 'Exa（需 Key）', needsKey: true, keyHint: 'https://exa.ai 申请' },
    { id: 'custom', label: '自定义（改 server.mjs）', needsKey: true, keyHint: '请求逻辑写在 search.mjs 的 custom provider' }
  ];

  let providerList = FALLBACK_PROVIDERS.slice();

  const state = {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    selection: '',
    selectionMeta: '',
    busy: false,
    controller: null,
    history: []
  };

  /* ------------------------------------------------------------------ */
  /* 设置                                                                */
  /* ------------------------------------------------------------------ */

  function loadSettings() {
    try {
      const raw = localStorage.getItem('office-copilot-settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed || {});
      }
    } catch (e) { /* ignore */ }
    applySettingsToUI();
  }

  function saveSettings() {
    state.settings = {
      baseUrl: ($('set-baseurl').value || DEFAULT_SETTINGS.baseUrl).trim(),
      model: ($('set-model').value || DEFAULT_SETTINGS.model).trim(),
      apiKey: ($('set-apikey').value || '').trim(),
      preview: $('set-preview').checked,
      stream: $('set-stream').checked,
      maxChars: Number($('set-maxchars').value) || DEFAULT_SETTINGS.maxChars,
      searchBase: ($('set-searchbase').value || DEFAULT_SETTINGS.searchBase).trim(),
      searchProvider: $('set-searchprovider').value || 'auto',
      searchKey: ($('set-searchkey').value || '').trim(),
      useProxy: $('set-useproxy').checked,
      prompt: ($('set-prompt').value || '').trim()
    };
    try {
      localStorage.setItem('office-copilot-settings', JSON.stringify(state.settings));
    } catch (e) { /* ignore */ }
    closeDrawer();
    setHint('设置已保存');
    updateStatus();
  }

  function applySettingsToUI() {
    const s = state.settings;
    $('set-baseurl').value = s.baseUrl;
    $('set-model').value = s.model;
    $('set-apikey').value = s.apiKey;
    $('set-preview').checked = s.preview !== false;
    $('set-stream').checked = s.stream !== false;
    $('set-maxchars').value = s.maxChars;
    $('set-searchbase').value = s.searchBase;
    $('set-searchkey').value = s.searchKey || '';
    $('set-useproxy').checked = !!s.useProxy;
    $('set-prompt').value = s.prompt || '';
    renderProviderOptions(s.searchProvider || 'auto');
    updateStatus();
  }

  /* ---------------- 搜索源 ---------------- */

  function renderProviderOptions(selected) {
    const sel = $('set-searchprovider');
    const withAuto = [{ id: 'auto', label: '自动（免费内置，无需 Key）', needsKey: false }].concat(providerList);
    sel.innerHTML = withAuto.map((p) =>
      '<option value="' + p.id + '">' + (p.label || p.id) + '</option>'
    ).join('');
    sel.value = selected || 'auto';
    if (!sel.value) sel.value = 'auto';
    updateProviderUI();
  }

  function currentProviderInfo() {
    const id = $('set-searchprovider').value;
    return providerList.find((p) => p.id === id) || { id: 'auto', needsKey: false };
  }

  function updateProviderUI() {
    const info = currentProviderInfo();
    const keyField = $('search-key-field');
    const hint = $('provider-hint');
    const keyHint = $('search-key-hint');

    if (info.id === 'auto') {
      keyField.hidden = true;
      hint.textContent = '默认服务端抓必应，失败自动换 DuckDuckGo，不需要任何 Key';
      return;
    }

    if (info.needsKey) {
      keyField.hidden = false;
      keyHint.textContent = info.keyHint || '填对应服务的 API Key';
      hint.textContent = '用商业 API，结果质量更好；失败会自动降级到免费内置';
    } else {
      keyField.hidden = true;
      hint.textContent = '免费内置源，不需要 Key';
    }
  }

  async function loadProviders() {
    const list = await AI.listProviders(state.settings.searchBase);
    if (list && list.length) {
      providerList = list;
      renderProviderOptions(state.settings.searchProvider || 'auto');
    }
  }

  /** 测试各搜索源连通性，结果可点击直接选中 */
  async function runProviderCheck() {
    const btn = $('btn-check-providers');
    const box = $('provider-status');
    btn.disabled = true;
    btn.textContent = '正在探测…';
    box.hidden = false;
    box.innerHTML = '<div class="provider-row"><span class="provider-mark">…</span><span class="provider-name">正在并发探测各服务</span></div>';

    try {
      const results = await AI.checkProviders(state.settings.searchBase);
      box.innerHTML = '';
      if (!results.length) {
        box.innerHTML = '<div class="provider-row"><span class="provider-name">没有可探测的搜索源</span></div>';
        return;
      }
      for (const r of results) {
        const row = document.createElement('div');
        row.className = 'provider-row ' + (r.reachable ? 'ok' : 'bad');
        row.title = r.label + (r.needsKey ? '（需 Key）' : '');
        row.innerHTML = '<span class="provider-mark">' + (r.reachable ? '✓' : '✕') + '</span>'
          + '<span class="provider-name"></span>'
          + '<span class="provider-meta"></span>';
        row.querySelector('.provider-name').textContent = r.label.replace(/（[^）]*）/, '');
        row.querySelector('.provider-meta').textContent = (r.status ? r.status + ' · ' : '') + r.ms + 'ms';
        row.addEventListener('click', () => {
          const sel = $('set-searchprovider');
          if ([...sel.options].some((o) => o.value === r.id)) {
            sel.value = r.id;
            updateProviderUI();
            setHint('已选中 ' + r.label);
          }
        });
        box.appendChild(row);
      }
    } catch (err) {
      box.innerHTML = '<div class="provider-row bad"><span class="provider-mark">✕</span>'
        + '<span class="provider-name">探测失败，本地服务可能没启动</span></div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '重新测试连通性';
    }
  }

  function openDrawer() {
    el.drawer.hidden = false;
    el.drawerMask.hidden = false;
  }

  function closeDrawer() {
    el.drawer.hidden = true;
    el.drawerMask.hidden = true;
  }

  function setHint(text) {
    el.hint.textContent = text || '';
  }

  function updateStatus() {
    const ready = state.settings.apiKey ? 'ok' : 'warn';
    el.statusDot.className = 'dot ' + (state.busy ? 'busy' : ready);
    el.hint.textContent = state.settings.apiKey
      ? state.settings.model
      : '先点齿轮填 API Key';
  }

  /* ------------------------------------------------------------------ */
  /* 选区                                                                */
  /* ------------------------------------------------------------------ */

  async function refreshSelection() {
    try {
      const sel = await OfficeAPI.getSelection();
      state.selection = sel.text || '';
      state.selectionMeta = sel.meta || '';

      if (sel.error) {
        el.selText.textContent = '读不到选区：' + sel.error;
        el.selbar.classList.remove('has-sel');
        return;
      }

      if (state.selection.trim()) {
        const preview = state.selection.replace(/\s+/g, ' ').slice(0, 40);
        el.selText.textContent = '已选 ' + state.selection.length + ' 字：' + preview
          + (state.selection.length > 40 ? '…' : '');
        el.selbar.classList.add('has-sel');
      } else {
        el.selText.textContent = '未选中内容（在文档里框选一段再问我）';
        el.selbar.classList.remove('has-sel');
      }
    } catch (err) {
      el.selText.textContent = '读取选区失败：' + (err && err.message ? err.message : String(err));
    }
  }

  /* ------------------------------------------------------------------ */
  /* 消息渲染                                                             */
  /* ------------------------------------------------------------------ */

  function clearEmpty() {
    if (el.empty && el.empty.parentNode) el.empty.remove();
  }

  function scrollBottom(force) {
    const m = el.messages;
    if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 120) {
      m.scrollTop = m.scrollHeight;
    }
  }

  function addUser(text) {
    clearEmpty();
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    el.messages.appendChild(wrap);
    scrollBottom(true);
    return wrap;
  }

  function addAssistant() {
    clearEmpty();
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-assistant';
    const toolBox = document.createElement('div');
    const body = document.createElement('div');
    body.className = 'body';
    wrap.appendChild(toolBox);
    wrap.appendChild(body);
    el.messages.appendChild(wrap);
    return { wrap, toolBox, body };
  }

  /** 用系统浏览器打开外链。WebView2 里 window.open 常常被拦，优先走 Office 的接口 */
  function openExternal(url) {
    if (!url) return;
    try {
      if (typeof Office !== 'undefined' && Office.context && Office.context.ui
        && typeof Office.context.ui.openBrowserWindow === 'function') {
        Office.context.ui.openBrowserWindow(url);
        return;
      }
    } catch (e) { /* 落到下面的兜底 */ }
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) { /* ignore */ }
  }

  /**
   * 把回答里的 [1] [2] 变成可点的链接，并在末尾附上来源列表。
   *
   * 模型输出的是纯文本角标，点击不了；这里按渲染后的 DOM 处理一遍，
   * 只改文本节点，跳过代码块和已有链接，避免破坏格式。
   */
  function applyCitations(container, sources) {
    if (!container) return;
    if (!sources || sources.length === 0) return;

    const max = sources.length;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'CODE' || tag === 'PRE' || tag === 'A') return NodeFilter.FILTER_REJECT;
        return /\[\d{1,2}\]/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const targets = [];
    let n;
    while ((n = walker.nextNode()) !== null) targets.push(n);

    for (const node of targets) {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0;
      const re = /\[(\d{1,2})\]/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const idx = Number(m[1]);
        if (idx < 1 || idx > max) continue;
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement('a');
        a.className = 'cite';
        a.href = sources[idx - 1].url || '#';
        a.textContent = '[' + idx + ']';
        a.title = sources[idx - 1].title || a.href;
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (last === 0) continue;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }

    // 末尾附来源列表（只有真的被引用过才加，避免堆一坨没人看的链接）
    const box = document.createElement('div');
    box.className = 'sources';

    const title = document.createElement('div');
    title.className = 'sources-title';
    title.textContent = '参考来源';
    box.appendChild(title);

    sources.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'source-item';

      const num = document.createElement('span');
      num.className = 'source-num';
      num.textContent = '[' + (i + 1) + ']';
      row.appendChild(num);

      const a = document.createElement('a');
      a.href = s.url || '#';
      a.textContent = s.title || s.url || '(无标题)';
      a.title = s.url || '';
      row.appendChild(a);

      box.appendChild(row);
    });

    container.appendChild(box);
  }

  function toolLine(container, text, spinning) {
    container.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'tool-line';
    line.innerHTML = (spinning ? '<span class="spinner"></span>' : '') + '<span></span>';
    line.querySelector('span:last-child').textContent = text;
    container.appendChild(line);
  }

  /** 搜索失败时的提示行：带一个"去设置 Key"的按钮，省得用户不知道怎么办 */
  function toolLineWithFix(container, text) {
    toolLine(container, text, false);
    const btn = document.createElement('button');
    btn.className = 'tool-fix';
    btn.textContent = '去填搜索 Key';
    btn.addEventListener('click', () => {
      openDrawer();
      const sel = $('set-searchprovider');
      if (sel && sel.value === 'auto') {
        // 直接跳到最可能可用的源
        sel.value = 'tavily';
        sel.dispatchEvent(new Event('change'));
      }
      const keyBox = $('set-searchkey');
      if (keyBox) keyBox.focus();
    });
    container.appendChild(btn);
  }

  function addError(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg';
    const box = document.createElement('div');
    box.className = 'msg-error';
    box.textContent = text;
    wrap.appendChild(box);
    el.messages.appendChild(wrap);
    scrollBottom(true);
  }

  /* ------------------------------------------------------------------ */
  /* 改写预览卡片                                                         */
  /* ------------------------------------------------------------------ */

  function addDiffCard({ original, revised, explain }) {
    const wrap = document.createElement('div');
    wrap.className = 'diff-card';

    const head = document.createElement('div');
    head.className = 'diff-head';
    head.innerHTML = '<span>改写结果</span><span>' + revised.length + ' 字</span>';

    const oldBox = document.createElement('div');
    oldBox.className = 'diff-old';
    oldBox.textContent = original;

    const newBox = document.createElement('div');
    newBox.className = 'diff-new';
    newBox.textContent = revised;

    const bar = document.createElement('div');
    bar.className = 'apply-bar';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn-apply';
    applyBtn.textContent = '应用到文档';
    const discardBtn = document.createElement('button');
    discardBtn.className = 'btn-discard';
    discardBtn.textContent = '丢弃';
    bar.appendChild(applyBtn);
    bar.appendChild(discardBtn);

    wrap.appendChild(head);
    wrap.appendChild(oldBox);
    wrap.appendChild(newBox);
    wrap.appendChild(bar);

    if (explain) {
      const note = document.createElement('div');
      note.className = 'result-note';
      note.textContent = explain;
      wrap.appendChild(note);
    }

    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = '写入中…';
      try {
        await OfficeAPI.replaceSelection(revised);
        wrap.classList.add('applied');
        const done = document.createElement('div');
        done.className = 'result-note';
        done.textContent = '已写入文档（不满意可以 Ctrl+Z 撤销）';
        wrap.appendChild(done);
        await refreshSelection();
      } catch (err) {
        applyBtn.disabled = false;
        applyBtn.textContent = '重试';
        const fail = document.createElement('div');
        fail.className = 'result-note';
        fail.style.color = 'var(--danger)';
        fail.textContent = '写入失败：' + (err && err.message ? err.message : String(err));
        wrap.appendChild(fail);
      }
    });

    discardBtn.addEventListener('click', () => {
      wrap.classList.add('applied');
      const done = document.createElement('div');
      done.className = 'result-note';
      done.style.color = 'var(--muted)';
      done.textContent = '已丢弃，文档没改动';
      wrap.appendChild(done);
    });

    el.messages.appendChild(wrap);
    scrollBottom(true);
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* 提示词                                                              */
  /* ------------------------------------------------------------------ */

  const BASE_SYSTEM = [
    '你是嵌入在 Office 文档里的写作助手，服务于中文用户。',
    '上下文可能包含这几块（没有的就是没有，不要假设它存在）：',
    '- <selection>：用户当前选中的原文',
    '- <document>：整篇文档',
    '- <search>：联网检索到的网页摘要',
    '关于检索的两条硬规则：',
    '1. 上下文里没有 <search> 块时，说明这次没检索到东西。需要说明就直说「这次没搜到结果」，不要写「无 <search> 内容」这种把内部标记暴露给用户的话，也不要把检索失败说成用户的问题。',
    '2. 有 <search> 时优先用它，并用 [1][2] 标注，不要把检索结果和自己的记忆混在一起说。',
    '回答用中文，简洁、直接，不要客套话。'
  ].join('\n');

  const REWRITE_SYSTEM = [
    '你是文本改写引擎。用户会给你原文和修改要求。',
    '严格只输出改写后的文本本身：',
    '- 不要解释、不要前言、不要"以下是修改后的内容"之类的话',
    '- 不要用引号或代码块包裹结果',
    '- 保持原文的段落结构和语言风格，除非用户要求改变',
    '- 保留原文中的数字、专有名词、专业术语，除非用户明确要求改',
    '直接输出结果，第一行就是正文。'
  ].join('\n');

  /** 判断是"改文档"还是"只是问问题" */
  function isRewriteIntent(text) {
    const t = String(text || '');
    const rewriteWords = /(改|润色|优化|重写|改写|翻译|压缩|精简|扩写|缩短|扩|调整|替换|换成|润饰|正式|口语|polish|rewrite|translate|shorten|expand|fix)/i;
    const questionWords = /(什么|为什么|怎么|如何|哪些|是否|解释|说明|分析|评价|建议|讲讲|说说|介绍|\?|？)/;
    const explicitRewrite = rewriteWords.test(t);
    const looksQuestion = questionWords.test(t) && !explicitRewrite;
    return explicitRewrite && !looksQuestion;
  }

  function buildContextBlocks({ selection, documentText, searchText }) {
    const parts = [];
    if (selection) parts.push('<selection>\n' + selection + '\n</selection>');
    if (documentText) parts.push('<document>\n' + documentText + '\n</document>');
    if (searchText) parts.push('<search>\n' + searchText + '\n</search>');
    return parts.join('\n\n');
  }

  /* ------------------------------------------------------------------ */
  /* 主流程                                                              */
  /* ------------------------------------------------------------------ */

  async function handleSend() {
    const text = el.input.value.trim();
    if (!text || state.busy) return;

    if (!state.settings.apiKey) {
      openDrawer();
      setHint('先填 API Key');
      return;
    }

    el.input.value = '';
    autoResize();
    addUser(text);

    state.busy = true;
    updateStatus();
    el.sendBtn.disabled = true;

    try {
      // 1. 取上下文
      let selection = '';
      if (el.useSelection.checked) {
        if (!state.selection) await refreshSelection();
        selection = state.selection || '';
      }

      let documentText = '';
      if (el.useDocument.checked) {
        setHint('读取全文…');
        documentText = await OfficeAPI.getDocumentText(state.settings.maxChars);
      }

      // 2. 联网检索
      let searchText = '';
      let sources = [];
      if (el.allowSearch.checked) {
        const dom = addAssistant();
        toolLine(dom.toolBox, '正在联网检索「' + text.slice(0, 24) + '」', true);
        let searchFailed = false;
        try {
          const out = await AI.search(text, state.settings.searchBase, {
            provider: state.settings.searchProvider,
            key: state.settings.searchKey
          });
          if (out.results && out.results.length) {
            searchText = AI.formatSearchResults(out.results);
            sources = out.results;
            toolLine(dom.toolBox, '检索到 ' + out.results.length + ' 条结果（' + out.provider + '）', false);
          } else {
            // 把真实的失败原因亮出来——不然用户只看到"没搜到"，不知道是网络还是源挂了
            const why = (out.errors && out.errors.length) ? out.errors.join('；') : '所有搜索源都没有返回结果';
            toolLineWithFix(dom.toolBox, '没搜到结果：' + String(why).slice(0, 130)
              + '。免费源被风控时可填一个搜索 Key 永久解决');
            searchFailed = true;
          }
        } catch (err) {
          toolLineWithFix(dom.toolBox, '搜索服务不可用：' + (err && err.message ? err.message : String(err)));
          searchFailed = true;
        }
        // 成功才把这条临时提示删掉；失败要留着，让用户看到原因和修复入口
        if (!searchFailed) dom.wrap.remove();
      }

      // 3. 判断意图
      const rewrite = isRewriteIntent(text) && selection.trim().length > 0;

      if (rewrite) {
        await doRewrite({ instruction: text, selection, documentText, searchText });
      } else {
        await doChat({ question: text, selection, documentText, searchText, sources });
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        addError('已停止');
      } else {
        addError(String(err && err.message ? err.message : err));
      }
    } finally {
      state.busy = false;
      state.controller = null;
      el.sendBtn.disabled = !el.input.value.trim();
      updateStatus();
      scrollBottom(false);
    }
  }

  async function doRewrite({ instruction, selection, documentText, searchText }) {
    const dom = addAssistant();
    toolLine(dom.toolBox, '正在改写…', true);

    const ctx = buildContextBlocks({ selection, documentText, searchText });
    const messages = [
      { role: 'system', content: REWRITE_SYSTEM },
      { role: 'user', content: ctx + '\n\n修改要求：' + instruction }
    ];

    state.controller = new AbortController();
    let content = '';

    const { content: finalText } = await AI.chat({
      settings: state.settings,
      messages,
      signal: state.controller.signal,
      onDelta: (d) => {
        content += d;
        if (state.settings.stream) {
          dom.body.textContent = content;
          scrollBottom(false);
        }
      }
    });

    const revised = (finalText || content || '').trim();

    // 清掉"正在改写"提示
    dom.toolBox.innerHTML = '';

    if (!revised) {
      dom.body.innerHTML = '<p style="color:var(--muted)">模型没有返回内容</p>';
      return;
    }

    if (state.settings.preview) {
      // 预览模式：body 清空，改用 diff 卡片
      dom.body.innerHTML = '';
      addDiffCard({ original: selection, revised });
    } else {
      // 直接应用
      dom.body.textContent = revised;
      try {
        await OfficeAPI.replaceSelection(revised);
        const note = document.createElement('div');
        note.className = 'result-note';
        note.textContent = '已直接写入文档（Ctrl+Z 可撤销）';
        dom.wrap.appendChild(note);
        await refreshSelection();
      } catch (err) {
        addError('写入失败：' + (err && err.message ? err.message : String(err)));
      }
    }
  }

  async function doChat({ question, selection, documentText, searchText, sources }) {
    const dom = addAssistant();
    toolLine(dom.toolBox, '思考中…', true);

    const ctx = buildContextBlocks({ selection, documentText, searchText });
    const systemPrompt = state.settings.prompt || BASE_SYSTEM;

    const messages = [{ role: 'system', content: systemPrompt }];
    // 最近 3 轮历史
    for (const h of state.history.slice(-6)) messages.push(h);
    messages.push({ role: 'user', content: (ctx ? ctx + '\n\n' : '') + question });

    state.controller = new AbortController();
    let content = '';

    const { content: finalText } = await AI.chat({
      settings: state.settings,
      messages,
      signal: state.controller.signal,
      onDelta: (d) => {
        content += d;
        if (state.settings.stream) {
          dom.body.innerHTML = MD.render(content) + '<span class="cursor-blink"></span>';
          scrollBottom(false);
        }
      }
    });

    dom.toolBox.innerHTML = '';
    dom.body.innerHTML = MD.render(finalText || content) || '<p style="color:var(--muted)">（无内容）</p>';
    applyCitations(dom.body, sources);
    scrollBottom(false);

    state.history.push({ role: 'user', content: question });
    state.history.push({ role: 'assistant', content: finalText || content });
    if (state.history.length > 12) state.history = state.history.slice(-12);
  }

  /* ------------------------------------------------------------------ */
  /* 输入框                                                              */
  /* ------------------------------------------------------------------ */

  function autoResize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(120, el.input.scrollHeight) + 'px';
  }

  const QUICK_PROMPTS = {
    polish: '把这段文字润色一下，更通顺自然，意思不变。',
    formal: '把这段文字改得更正式、更书面。',
    shorten: '把这段文字压缩精简，保留所有关键信息。',
    expand: '把这段文字扩写，补充细节和论证，保持原意。',
    translate: '把这段文字翻译成地道的英文。',
    outline: '总结这份文档的主要内容和结构，分条列出。'
  };

  /* ------------------------------------------------------------------ */
  /* 初始化                                                              */
  /* ------------------------------------------------------------------ */

  // 调试钩子：只在 ?debug=1 时暴露，供自动化检查用
  if (String(location.search).indexOf('debug=1') !== -1) {
    window.__oc = { applyCitations, openExternal };
  }

  function bindEvents() {
    // 回答里的链接（引用角标、来源列表、正文 URL）一律用系统浏览器打开。
    // WebView2 默认会把外链闷死在侧边栏里，必须拦下来自己处理。
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      openExternal(href);
    }, true);

    el.sendBtn.addEventListener('click', () => {
      if (state.busy) {
        if (state.controller) state.controller.abort();
        return;
      }
      handleSend();
    });

    el.input.addEventListener('input', () => {
      autoResize();
      if (!state.busy) el.sendBtn.disabled = !el.input.value.trim();
    });

    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!state.busy) handleSend();
      }
    });

    el.quickGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.quick');
      if (!btn) return;
      const act = btn.dataset.act;
      const prompt = QUICK_PROMPTS[act];
      if (!prompt) return;

      // "总结全文"不需要改写，直接当问题问
      if (act === 'outline') {
        el.input.value = prompt;
        el.useDocument.checked = true;
        handleSend();
        return;
      }

      if (!state.selection.trim()) {
        setHint('先在文档里选中一段文字');
        refreshSelection();
        return;
      }
      el.input.value = prompt;
      handleSend();
    });

    el.btnReadSel.addEventListener('click', () => {
      refreshSelection();
      setHint('已重新读取选区');
    });

    el.btnClear.addEventListener('click', () => {
      el.messages.innerHTML = '';
      state.history = [];
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.id = 'empty';
      empty.innerHTML = '<div class="empty-icon">◈</div>'
        + '<p class="empty-title">选中文字，告诉我要怎么改</p>'
        + '<p class="empty-sub">在文档里框选一段，然后在下面输入指令，比如「改得更正式」「翻成英文」「压缩到 100 字」。</p>'
        + '<div class="quick-grid" id="quick-grid"></div>';
      el.messages.appendChild(empty);
      el.empty = empty;
      buildQuickGrid($('quick-grid'));
    });

    el.btnSettings.addEventListener('click', openDrawer);
    el.btnCloseDrawer.addEventListener('click', closeDrawer);
    el.drawerMask.addEventListener('click', closeDrawer);
    el.btnSave.addEventListener('click', saveSettings);

    // 切换搜索源时，动态显示 key 输入框
    $('set-searchprovider').addEventListener('change', updateProviderUI);
    $('btn-check-providers').addEventListener('click', runProviderCheck);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.drawer.hidden) closeDrawer();
    });
  }

  function buildQuickGrid(root) {
    if (!root) return;
    const items = [
      ['polish', '润色文字'], ['formal', '改得更正式'],
      ['shorten', '压缩精简'], ['expand', '扩写补充'],
      ['translate', '翻译成英文'], ['outline', '总结全文大纲']
    ];
    root.innerHTML = items.map(([act, label]) =>
      '<button class="quick" data-act="' + act + '">' + label + '</button>'
    ).join('');
  }

  async function init() {
    loadSettings();
    bindEvents();
    buildQuickGrid(el.quickGrid);

    // 拉取服务端支持的搜索源（服务没起就用内置兜底列表）
    loadProviders();

    const st = await OfficeAPI.ready;
    el.hostTag.textContent = OfficeAPI.hostLabel();

    if (st.host === 'Unknown') {
      el.hostTag.textContent = '预览模式';
      el.selText.textContent = '不在 Office 里运行，只测试界面';
      el.statusDot.className = 'dot warn';
    } else {
      // 宿主要是有版本限制（比如 PPT 2021 不能读写选区），一进来就说清楚
      if (st.note) setHint(st.note);
      await refreshSelection();

      // 监听选区变化（Word / Excel 都支持）
      try {
        Office.context.document.addHandlerAsync(
          Office.EventType.DocumentSelectionChanged,
          () => { refreshSelection(); }
        );
      } catch (e) { /* 某些宿主不支持，忽略 */ }
    }

    updateStatus();
    el.sendBtn.disabled = true;

    if (!state.settings.apiKey) {
      setTimeout(() => openDrawer(), 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
