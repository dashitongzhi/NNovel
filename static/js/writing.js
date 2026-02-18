let currentTaskId = null;
let pollingTimer = null;
let typeWriterTimer = null;
let fullContentCache = '';
let isPaused = false;
let isAutoScroll = true; // Default auto-scroll enabled
let isWriting = false; // Track writing state for toggle
const WRITING_TYPEWRITER_SPEED_KEY = 'writer:typewriterSpeed';
const WRITING_TYPEWRITER_ENABLED_KEY = 'writer:typewriterEnabled';
const WRITING_DEFAULT_TYPEWRITER_SPEED = 30;
let streamingPreviewActive = false;
let streamingPreviewTarget = '';
let streamingPreviewIndex = 0;
let streamingPreviewFinal = false;
let streamSkipEnabled = false;
let stoppingInFlight = false;
let startingInFlight = false;
let blockGenerationUpdates = false;
let pendingRecoveryInfo = null;
let hasFrontendContentStarted = false;
let generationEpoch = 0;
let currentRequestId = '';
const ACTION_DEBOUNCE_MS = 260;
const _actionLastTs = Object.create(null);
let pollingStartedAt = 0;
let pollingNoChangeRounds = 0;
let pollingLastPartial = '';
const GENERATION_STAGES = ['queued', 'generating', 'finishing', 'completed'];
let generationStage = 'idle';
let generationStageSince = 0;
let generationStageTimer = null;
let generationStageError = false;
let generationStageDurations = {
    queued: 0,
    generating: 0,
    finishing: 0,
    completed: 0,
};
const THINKING_PHASE_SEQUENCE = [
    '正在理解故事大纲，分析人物关系...',
    '正在构思本段情节的发展方向...',
    '正在撰写场景描写与人物对话...',
    '正在深入刻画人物内心活动...',
    '正在推进故事情节，制造冲突与悬念...',
    '正在润色文字，调整节奏与氛围...',
    '即将完成，进行最后的文字打磨...',
];
const THINKING_CYCLE_STEP_MS = 160;
let thinkingCycleMaxIndex = -1;
let thinkingCycleCompleted = false;
let thinkingCycleAnimating = false;
let pendingStreamPreviewText = '';
let pendingStreamPreviewFinalize = false;

function _stripPauseMarkerPrefix(text) {
    const raw = String(text || '');
    return raw.replace(/^\s*已暂停(?:\.{3}|…)?\s*/u, '');
}

function _normalizeThinkingForMatch(text) {
    return String(text || '')
        .replace(/\s+/g, '')
        .replace(/[.。!！?？]/g, '')
        .trim();
}

function _findThinkingPhaseIndex(text) {
    const target = _normalizeThinkingForMatch(text);
    if (!target) return -1;
    for (let i = 0; i < THINKING_PHASE_SEQUENCE.length; i++) {
        const phase = _normalizeThinkingForMatch(THINKING_PHASE_SEQUENCE[i]);
        if (!phase) continue;
        if (target === phase || target.includes(phase) || phase.includes(target)) {
            return i;
        }
    }
    return -1;
}

function _resetThinkingCycleState() {
    thinkingCycleMaxIndex = -1;
    thinkingCycleCompleted = false;
    thinkingCycleAnimating = false;
    pendingStreamPreviewText = '';
    pendingStreamPreviewFinalize = false;
}

function _recordThinkingPhase(text) {
    const idx = _findThinkingPhaseIndex(text);
    if (idx > thinkingCycleMaxIndex) {
        thinkingCycleMaxIndex = idx;
    }
    if (thinkingCycleMaxIndex >= THINKING_PHASE_SEQUENCE.length - 1) {
        thinkingCycleCompleted = true;
    }
}

function _flushBufferedStreamingPreview() {
    if (!thinkingCycleCompleted) return;
    const buffered = String(pendingStreamPreviewText || '');
    if (!buffered.trim()) return;
    const finalize = Boolean(pendingStreamPreviewFinalize);
    pendingStreamPreviewText = '';
    pendingStreamPreviewFinalize = false;
    queueStreamingPreview(buffered, finalize);
    if (generationStage === 'queued') {
        _setGenerationStage('generating');
    }
}

async function _ensureThinkingCycleThenStream() {
    if (thinkingCycleCompleted || thinkingCycleAnimating) {
        _flushBufferedStreamingPreview();
        return;
    }
    thinkingCycleAnimating = true;
    try {
        const start = Math.max(thinkingCycleMaxIndex + 1, 0);
        if (!hasFrontendContentStarted) {
            showThinkingUI();
        }
        for (let i = start; i < THINKING_PHASE_SEQUENCE.length; i++) {
            if (blockGenerationUpdates || stoppingInFlight) {
                break;
            }
            updateThinkingDisplay(THINKING_PHASE_SEQUENCE[i]);
            thinkingCycleMaxIndex = Math.max(thinkingCycleMaxIndex, i);
            await _sleep(THINKING_CYCLE_STEP_MS);
        }
        if (thinkingCycleMaxIndex >= THINKING_PHASE_SEQUENCE.length - 1) {
            thinkingCycleCompleted = true;
        }
    } finally {
        thinkingCycleAnimating = false;
        _flushBufferedStreamingPreview();
    }
}

function _actionDebounced(action, ms = ACTION_DEBOUNCE_MS) {
    const now = Date.now();
    const key = String(action || '');
    const last = Number(_actionLastTs[key] || 0);
    if (now - last < ms) {
        return true;
    }
    _actionLastTs[key] = now;
    return false;
}

function _requestTag(requestId = '') {
    const rid = String(requestId || currentRequestId || '').trim();
    if (!rid) return '';
    return ` [${rid}]`;
}

function setTopToolbarEngineStatus(statusText = '') {
    if (typeof window.setToolbarEngineStatusOverride === 'function') {
        window.setToolbarEngineStatusOverride(statusText);
    }
}

function _clearThinkingOnlyOutput() {
    const genBox = document.getElementById('generated-content');
    if (!genBox) return;
    const hasThinking = Boolean(genBox.querySelector('.thinking-container'));
    if (!hasThinking) return;
    const cached = String(fullContentCache || '').trim();
    if (cached) {
        genBox.innerText = cached;
    } else {
        genBox.innerHTML = '';
    }
}

function _setWriterErrorVisibleState() {
    updateStatus('error', '状态异常');
    _clearThinkingOnlyOutput();
}

function _formatStageSeconds(ms) {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function _stopGenerationStageTicker() {
    if (!generationStageTimer) return;
    clearInterval(generationStageTimer);
    generationStageTimer = null;
}

function _startGenerationStageTicker() {
    _stopGenerationStageTicker();
    generationStageTimer = setInterval(() => {
        _renderGenerationStageTimeline();
    }, 300);
}

function _resetGenerationStageTimeline() {
    _stopGenerationStageTicker();
    generationStage = 'idle';
    generationStageSince = 0;
    generationStageError = false;
    generationStageDurations = {
        queued: 0,
        generating: 0,
        finishing: 0,
        completed: 0,
    };
    _renderGenerationStageTimeline();
}

function _markGenerationStageError() {
    generationStageError = true;
    _stopGenerationStageTicker();
    _renderGenerationStageTimeline();
}

function _setGenerationStage(nextStage) {
    if (!GENERATION_STAGES.includes(nextStage)) return;
    const now = Date.now();
    if (GENERATION_STAGES.includes(generationStage) && generationStageSince > 0) {
        generationStageDurations[generationStage] += (now - generationStageSince);
    }
    generationStage = nextStage;
    generationStageSince = now;
    generationStageError = false;
    if (nextStage === 'completed') {
        _stopGenerationStageTicker();
    } else {
        _startGenerationStageTicker();
    }
    _renderGenerationStageTimeline();
}

function _renderGenerationStageTimeline() {
    const track = document.getElementById('generation-stage-track');
    if (!track) return;
    const now = Date.now();
    const stageIndex = GENERATION_STAGES.indexOf(generationStage);
    const activeStage = stageIndex >= 0 ? generationStage : '';

    track.querySelectorAll('.stage-item').forEach((item, idx) => {
        const stage = item.getAttribute('data-stage') || '';
        item.classList.remove('active', 'done', 'error');
        if (stageIndex > idx) {
            item.classList.add('done');
        } else if (stage === activeStage) {
            item.classList.add(generationStageError ? 'error' : 'active');
        }

        let duration = generationStageDurations[stage] || 0;
        if (stage === activeStage && generationStageSince > 0) {
            duration += (now - generationStageSince);
        }
        const timeEl = item.querySelector('.stage-time');
        if (timeEl) {
            timeEl.innerText = _formatStageSeconds(duration);
        }
    });
}

function classifyGenerationIssue(rawMessage, code = '') {
    const normalizedCode = String(code || '').trim().toLowerCase();
    if (normalizedCode === 'timeout' || normalizedCode === 'transport_timeout') {
        return { type: '超时', detail: String(rawMessage || '').trim() || '请求超时' };
    }
    if (normalizedCode === 'quota') {
        return { type: '余额不足', detail: String(rawMessage || '').trim() || '额度不足' };
    }
    if (normalizedCode === 'auth_key_missing') {
        return { type: '缺少密钥', detail: String(rawMessage || '').trim() || '未配置 API Key' };
    }
    if (normalizedCode === 'auth_key_invalid') {
        return { type: '密钥失效', detail: String(rawMessage || '').trim() || 'API Key 无效或已过期' };
    }
    if (normalizedCode === 'auth_permission') {
        return { type: '权限不足', detail: String(rawMessage || '').trim() || '当前账号无权限访问该模型' };
    }
    if (normalizedCode === 'auth') {
        return { type: '鉴权失败', detail: String(rawMessage || '').trim() || '鉴权失败' };
    }
    if (normalizedCode === 'transport_proxy') {
        return { type: '代理失败', detail: String(rawMessage || '').trim() || '代理连接失败' };
    }
    if (normalizedCode === 'transport_tls') {
        return { type: 'TLS失败', detail: String(rawMessage || '').trim() || 'TLS/SSL 握手失败' };
    }
    if (normalizedCode === 'transport') {
        return { type: '连接异常', detail: String(rawMessage || '').trim() || '网络连接异常' };
    }
    if (normalizedCode === 'stopped') {
        return { type: '已停止', detail: String(rawMessage || '').trim() || '已停止生成' };
    }

    const message = String(rawMessage || '').trim();
    const lower = message.toLowerCase();
    if (!message) {
        return { type: '未知异常', detail: '未知错误' };
    }
    if (/timeout|timed out|超时/.test(lower) || /超时/.test(message)) {
        return { type: '超时', detail: message };
    }
    if (/quota|insufficient|balance|credit|余额|额度不足|资源包/.test(lower) || /余额不足|额度不足/.test(message)) {
        return { type: '余额不足', detail: message };
    }
    if (/invalid api key|api key|unauthorized|forbidden|permission|token|401|403/.test(lower) || /令牌|密钥无效|鉴权失败|认证失败/.test(message)) {
        return { type: '令牌失效', detail: message };
    }
    if (/proxy|407|tunnel|代理/.test(lower) || /代理/.test(message)) {
        return { type: '代理失败', detail: message };
    }
    if (/tls|ssl|certificate|eof/.test(lower) || /TLS|SSL|证书/.test(message)) {
        return { type: 'TLS失败', detail: message };
    }
    if (/connection|network|ssl|transport|eof|连接|网络/.test(lower) || /连接|网络|SSL/.test(message)) {
        return { type: '连接异常', detail: message };
    }
    return { type: '异常', detail: message };
}

function formatGenerationIssueText(rawMessage, code = '') {
    const parsed = classifyGenerationIssue(rawMessage, code);
    return `${parsed.type}: ${parsed.detail}`;
}

const WRITER_BUTTON_ICONS = {
    play: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 3.5a.7.7 0 0 1 1.07-.6l6 4a.7.7 0 0 1 0 1.2l-6 4A.7.7 0 0 1 4 11.5z"/></svg>',
    stop: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.2"/></svg>',
    pause: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3.5" width="3" height="9" rx="1"/><rect x="9" y="3.5" width="3" height="9" rx="1"/></svg>',
    resume: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 3.5a.7.7 0 0 1 1.07-.6l6 4a.7.7 0 0 1 0 1.2l-6 4A.7.7 0 0 1 4 11.5z"/></svg>',
    loading: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="8" cy="8" r="5.3" stroke-opacity="0.3"></circle><path d="M13.3 8A5.3 5.3 0 0 0 8 2.7"></path></svg>',
    skip: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 4a.7.7 0 0 1 1.1-.57L8 6.17V4.7a.7.7 0 0 1 1.1-.57l3.8 2.53a.7.7 0 0 1 0 1.16L9.1 10.35A.7.7 0 0 1 8 9.78V8.3l-3.9 2.74A.7.7 0 0 1 3 10.47z"/></svg>'
};

function _setIconButton(btn, iconKey, titleText) {
    if (!btn) return;
    const icon = WRITER_BUTTON_ICONS[iconKey] || WRITER_BUTTON_ICONS.play;
    btn.innerHTML = `<span class="btn-icon-text" aria-hidden="true">${icon}</span>`;
    btn.classList.toggle('loading', iconKey === 'loading');
    btn.title = titleText || '';
    btn.setAttribute('aria-label', titleText || '');
}

function _setMainStartButtonVisual(state) {
    const btn = document.getElementById('start-writing-btn');
    if (!btn) return;

    btn.classList.add('writer-icon-btn');
    btn.classList.remove('btn-success', 'btn-danger', 'btn-warning', 'loading');

    if (state === 'running') {
        btn.disabled = false;
        btn.classList.add('btn-danger');
        _setIconButton(btn, 'stop', '停止写作');
        return;
    }

    if (state === 'starting') {
        btn.disabled = true;
        btn.classList.add('btn-warning');
        _setIconButton(btn, 'play', '启动中...');
        return;
    }

    btn.disabled = false;
    btn.classList.add('btn-success');
    _setIconButton(btn, 'play', '开始写作');
}

function _setSidebarStartButtonVisual(isGenerating, isStarting = false) {
    const btn = document.getElementById('sidebar-start-writing-btn');
    if (!btn) return;

    btn.classList.remove('loading');
    btn.classList.remove('btn-success', 'btn-danger', 'btn-warning');

    if (isStarting) {
        btn.disabled = true;
        btn.innerText = '启动中...';
        btn.classList.add('btn-warning');
        return;
    }

    btn.disabled = false;
    if (isGenerating) {
        btn.innerText = '停止写作';
        btn.classList.add('btn-danger');
    } else {
        btn.innerText = '开始写作';
        btn.classList.add('btn-success');
    }
}

function initWritingButtonsUI() {
    _setMainStartButtonVisual('idle');
    _setSidebarStartButtonVisual(false, false);
    const skipBtn = document.getElementById('skip-anim-btn');
    if (skipBtn) {
        skipBtn.classList.add('writer-icon-btn');
        _setIconButton(skipBtn, 'skip', '跳过动画');
    }
    refreshAutoScrollButtonVisual();
    updatePauseButton();
    _resetGenerationStageTimeline();
}

function getTypewriterSettings() {
    const savedEnabled = localStorage.getItem(WRITING_TYPEWRITER_ENABLED_KEY);
    const enabled = savedEnabled === null ? true : savedEnabled === 'true';
    const savedSpeed = parseInt(localStorage.getItem(WRITING_TYPEWRITER_SPEED_KEY) || '', 10);
    const speed = Number.isFinite(savedSpeed) && savedSpeed > 0 ? savedSpeed : WRITING_DEFAULT_TYPEWRITER_SPEED;
    return { enabled, speed };
}

function getPersonalModelIdForGenerate() {
    if (typeof getPersonalModelValue === 'function') {
        const model = String(getPersonalModelValue() || '').trim();
        if (model) return model;
    }
    const modelInputs = Array.from(document.querySelectorAll('#personal-model-inputs .personal-model-id-input'));
    const listRaw = modelInputs.map((input) => String(input.value || '').trim()).filter(Boolean).join('\n');
    const first = listRaw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/,/g, '\n')
        .split('\n')
        .map(v => String(v || '').trim())
        .find(Boolean);
    if (first) return first;
    const modelSelect = (document.getElementById('personal-model-select')?.value || '').trim();
    if (modelSelect) return modelSelect;
    const modalSelect = (document.getElementById('personal-model-modal-select')?.value || '').trim();
    if (modalSelect) return modalSelect;
    return 'deepseek-ai/deepseek-v3.2';
}

function getPersonalModelsForGenerate() {
    if (typeof getPersonalModelsText === 'function') {
        const modelsText = String(getPersonalModelsText() || '').trim();
        if (modelsText) return modelsText;
    }
    const modelInputs = Array.from(document.querySelectorAll('#personal-model-inputs .personal-model-id-input'));
    const raw = modelInputs.map((input) => String(input.value || '').trim()).filter(Boolean).join('\n');
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/,/g, '\n');
    const seen = new Set();
    const items = [];
    normalized.split('\n').forEach((line) => {
        const model = String(line || '').trim();
        if (!model) return;
        const key = model.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        items.push(model);
    });
    if (!items.length) items.push('deepseek-ai/deepseek-v3.2');
    return items.join('\n');
}

function resetStreamingPreviewState() {
    if (typeWriterTimer) {
        clearTimeout(typeWriterTimer);
        typeWriterTimer = null;
    }
    streamingPreviewActive = false;
    streamingPreviewTarget = '';
    streamingPreviewIndex = 0;
    streamingPreviewFinal = false;
    streamSkipEnabled = false;
    hasFrontendContentStarted = false;
    _resetThinkingCycleState();
}

function _haltFrontendTypingProgress() {
    if (!typeWriterTimer) return;
    clearTimeout(typeWriterTimer);
    clearInterval(typeWriterTimer);
    typeWriterTimer = null;
}

function updateRefStatusVisibilityBySkipState() {
    const refEl = document.getElementById('ref-status');
    if (!refEl) return;
    const hasText = Boolean((refEl.textContent || '').trim());
    if (!hasText) {
        refEl.style.display = 'none';
        return;
    }
    const skipBtn = document.getElementById('skip-anim-btn');
    const skipVisible = Boolean(skipBtn && !skipBtn.classList.contains('hidden'));
    refEl.style.display = skipVisible ? 'none' : 'inline';
}

function _ensureStreamingPreviewUI() {
    const genBox = document.getElementById('generated-content');
    const hasThinking = Boolean(genBox.querySelector('.thinking-container'));
    if (!streamingPreviewActive || hasThinking) {
        genBox.innerHTML = '';
        const cursor = document.createElement('span');
        cursor.className = 'cursor-blink';
        genBox.appendChild(cursor);
        streamingPreviewActive = true;
        document.getElementById('gen-actions').classList.add('hidden');
        document.getElementById('skip-anim-btn').classList.add('hidden');
        updateRefStatusVisibilityBySkipState();
    } else if (!genBox.querySelector('.cursor-blink')) {
        const cursor = document.createElement('span');
        cursor.className = 'cursor-blink';
        genBox.appendChild(cursor);
    }
}

function _finishStreamingPreview() {
    if (typeWriterTimer) {
        clearTimeout(typeWriterTimer);
        typeWriterTimer = null;
    }
    const genBox = document.getElementById('generated-content');
    genBox.innerText = streamingPreviewTarget;
    if (isAutoScroll) {
        genBox.scrollTop = genBox.scrollHeight;
    }
    document.getElementById('skip-anim-btn').classList.add('hidden');
    updateRefStatusVisibilityBySkipState();
    document.getElementById('gen-actions').classList.remove('hidden');
    updateStatus('ready', '生成完成');
    _setGenerationStage('completed');
    currentTaskId = null;
    isPaused = false;
    updatePauseButton();
    showToast('内容生成完毕' + _requestTag(), 'success');
    streamingPreviewActive = false;
    streamingPreviewFinal = false;
    streamSkipEnabled = false;
    currentRequestId = '';
}

function queueStreamingPreview(content, finalize = false) {
    const text = String(content || '');
    if (!text.trim()) return;

    hasFrontendContentStarted = true;
    _ensureStreamingPreviewUI();
    fullContentCache = text;
    streamingPreviewTarget = text;
    if (finalize) {
        streamingPreviewFinal = true;
        streamSkipEnabled = true;
    }
    const skipBtn = document.getElementById('skip-anim-btn');
    if (skipBtn) {
        skipBtn.classList.toggle('hidden', !streamSkipEnabled);
    }
    updateRefStatusVisibilityBySkipState();

    const genBox = document.getElementById('generated-content');
    if (streamingPreviewIndex > streamingPreviewTarget.length) {
        streamingPreviewIndex = streamingPreviewTarget.length;
        genBox.innerText = streamingPreviewTarget;
    }

    if (typeWriterTimer) return;

    const tick = () => {
        const currentSettings = getTypewriterSettings();

        if (streamingPreviewIndex < streamingPreviewTarget.length) {
            const cursor = genBox.querySelector('.cursor-blink');
            const char = streamingPreviewTarget.charAt(streamingPreviewIndex);
            const textNode = document.createTextNode(char);
            if (cursor) {
                genBox.insertBefore(textNode, cursor);
            } else {
                genBox.appendChild(textNode);
            }
            streamingPreviewIndex++;
            if (isAutoScroll) {
                genBox.scrollTop = genBox.scrollHeight;
            }
            typeWriterTimer = setTimeout(tick, currentSettings.speed);
            return;
        }
        typeWriterTimer = null;
        if (streamingPreviewFinal) {
            _finishStreamingPreview();
        }
    };
    const initialSpeed = getTypewriterSettings().speed;
    typeWriterTimer = setTimeout(tick, initialSpeed);
}

async function toggleGeneration() {
    if (_actionDebounced('toggle-generation')) return;
    if (isWriting || startingInFlight) {
        await stopWriting();
    } else {
        await startGenerate();
    }
}

async function startGenerate() {
    if (_actionDebounced('start-generation')) return;
    if (stoppingInFlight || startingInFlight) return;
    startingInFlight = true;
    const myEpoch = ++generationEpoch;
    blockGenerationUpdates = false;
    isWriting = true;
    isPaused = false;
    updatePauseButton();
    resetStreamingPreviewState();
    hasFrontendContentStarted = false;
    currentRequestId = '';
    setGenerating(true);
    setTopToolbarEngineStatus('');
    _resetGenerationStageTimeline();
    _setGenerationStage('queued');

    updateStatus('thinking', 'AI 正在创作...');
    document.getElementById('ref-status').style.display = 'none';

    // Show Thinking UI immediately
    showThinkingUI();

    try {
        const isObsolete = () => (
            myEpoch !== generationEpoch || blockGenerationUpdates || !isWriting
        );
        try {
            const [chapters, config] = await Promise.all([
                API.get('/api/chapters'),
                API.get('/api/config')
            ]);
            if (isObsolete()) return;
            const count = chapters && chapters.length ? chapters.length : 0;
            const cacheText = config && typeof config.cache === 'string' ? config.cache : '';
            const hasCache = cacheText.trim().length > 0;
            const refText = (count > 0 || hasCache) ? `已加载提要` : `首次创作`;
            const refEl = document.getElementById('ref-status');
            refEl.textContent = refText;
            updateRefStatusVisibilityBySkipState();
        } catch (e) {
            console.warn('Failed to fetch chapters/config', e);
        }

        const config = {
            outline: document.getElementById('outline-input').value,
            reference: document.getElementById('reference-input').value,
            requirements: document.getElementById('requirements-input').value,
            extra_settings: document.getElementById('extra_settings-input').value,
            global_memory: document.getElementById('global_memory-input').value,
            engine_mode: typeof getEngineMode === 'function' ? getEngineMode() : 'codex',
            codex_model: document.getElementById('codex-model-select').value,
            gemini_model: document.getElementById('gemini-model-select').value,
            claude_model: document.getElementById('claude-model-select').value,
            codex_access_mode: document.getElementById('codex-access-mode')?.value || 'cli',
            gemini_access_mode: document.getElementById('gemini-access-mode')?.value || 'cli',
            claude_access_mode: document.getElementById('claude-access-mode')?.value || 'cli',
            codex_api_key: (document.getElementById('codex-api-key-input')?.value || '').trim(),
            gemini_api_key: (document.getElementById('gemini-api-key-input')?.value || '').trim(),
            claude_api_key: (document.getElementById('claude-api-key-input')?.value || '').trim(),
            codex_reasoning_effort: document.getElementById('codex-reasoning-select').value,
            gemini_reasoning_effort: document.getElementById('gemini-reasoning-select').value,
            claude_reasoning_effort: document.getElementById('claude-reasoning-select').value,
            doubao_reasoning_effort: document.getElementById('doubao-reasoning-select').value,
            doubao_models: (typeof getDoubaoModelsText === 'function')
                ? getDoubaoModelsText()
                : (document.getElementById('doubao-model-select')?.value || ''),
            doubao_model: (typeof getDoubaoModelValue === 'function')
                ? getDoubaoModelValue()
                : (document.getElementById('doubao-model-select')?.value || ''),
            personal_base_url: (document.getElementById('personal-base-url-input')?.value || '').trim(),
            personal_api_key: (document.getElementById('personal-api-key-input')?.value || '').trim(),
            personal_models: getPersonalModelsForGenerate(),
            personal_model: getPersonalModelIdForGenerate(),
            proxy_port: (() => {
                const el = document.getElementById('proxy-port-input');
                const raw = (el ? String(el.value || '') : '').trim();
                const n = parseInt(raw, 10);
                return Number.isFinite(n) && n >= 1 && n <= 65535 ? String(n) : '10808';
            })()
        };

        API.post('/api/engine/test-connectivity', config)
            .then(() => {
                if (typeof checkBackendStatus === 'function') {
                    checkBackendStatus({ silent: true });
                }
            })
            .catch(() => {});
        if (isObsolete()) return;

        let response = null;
        if (pendingRecoveryInfo && pendingRecoveryInfo.recoverable) {
            response = await API.post('/api/generate/resume', {});
            if (isObsolete()) {
                if (response && response.task_id) {
                    try { await API.post(`/api/generate/stop/${response.task_id}`, {}); } catch (_) {}
                }
                return;
            }
            pendingRecoveryInfo = null;
            currentRequestId = String(response.request_id || currentRequestId || '');
            showToast('已从异常中断位置继续写作' + _requestTag(response.request_id || ''), 'success');
        } else {
            response = await API.post('/api/generate', config);
            if (isObsolete()) {
                if (response && response.task_id) {
                    try { await API.post(`/api/generate/stop/${response.task_id}`, {}); } catch (_) {}
                }
                return;
            }
        }
        if (response.task_id) {
            currentTaskId = response.task_id;
            currentRequestId = String(response.request_id || '');
            isWriting = true;
            updatePauseButton();
            setGenerating(true); // This sets button to 'Stop'
            setTopToolbarEngineStatus('成功');
            _setGenerationStage('generating');
            updateStatus('thinking', 'AI 正在创作...');
            startPolling(currentTaskId);
        } else {
            throw new Error('未获取到任务ID');
        }
    } catch (error) {
        if (myEpoch !== generationEpoch || blockGenerationUpdates || !isWriting) {
            return;
        }
        const reason = formatGenerationIssueText(error.message, error.error_code || '');
        const rid = String(error.request_id || currentRequestId || '');
        showToast('启动生成失败: ' + reason + _requestTag(rid), 'error');
        isWriting = false;
        setGenerating(false); // Revert button
        setTopToolbarEngineStatus('异常');
        _markGenerationStageError();
        _setWriterErrorVisibleState();
    } finally {
        if (myEpoch === generationEpoch) {
            startingInFlight = false;
        } else if (!isWriting) {
            startingInFlight = false;
        }
    }
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function _finalizeStoppedUI(messageText = '已停止') {
    stopPolling();
    resetStreamingPreviewState();
    _resetGenerationStageTimeline();
    currentTaskId = null;
    startingInFlight = false;
    isPaused = false;
    isWriting = false;
    currentRequestId = '';
    blockGenerationUpdates = true;
    setTopToolbarEngineStatus('');
    setGenerating(false);
    updatePauseButton();
    updateStatus('stopped', messageText);
    const genBox = document.getElementById('generated-content');
    if (genBox) {
        genBox.innerHTML = '<div style="color: var(--text-secondary); text-align: center; margin-top: 20px;">(写作已停止)</div>';
    }
}

async function detectRecoverableGeneration() {
    try {
        const res = await API.get('/api/generate/recovery');
        if (!res || !res.recoverable) {
            pendingRecoveryInfo = null;
            return;
        }
        pendingRecoveryInfo = res;
        if (res && res.request_id) {
            currentRequestId = String(res.request_id || '');
        }
        if (res.live_task && res.task_id) {
            pendingRecoveryInfo = null;
            currentTaskId = String(res.task_id);
            isWriting = true;
            isPaused = false;
            blockGenerationUpdates = false;
            setGenerating(true);
            _resetGenerationStageTimeline();
            _setGenerationStage('generating');
            updatePauseButton();
            startPolling(currentTaskId, true);
            showToast('已连接到未完成的生成任务' + _requestTag(res.request_id || ''), 'warning');
            return;
        }
        const partial = _stripPauseMarkerPrefix(String(res.partial_content || '')).trim();
        if (partial) {
            const genBox = document.getElementById('generated-content');
            if (genBox) {
                genBox.innerText = partial;
            }
            document.getElementById('gen-actions').classList.add('hidden');
            updateStatus('paused', '检测到中断任务，可继续');
        }
        showToast('检测到异常中断任务，点击开始写作将自动断点续写' + _requestTag(res.request_id || ''), 'warning');
    } catch (error) {
        console.warn('Failed to detect recoverable generation', error);
    }
}

async function hardStopWritingForRestore() {
    await stopWriting(true);
}

async function stopWriting(silent = false) {
    if (_actionDebounced('stop-generation')) return;
    if (stoppingInFlight) return;
    startingInFlight = false;
    const myEpoch = ++generationEpoch;
    const taskId = currentTaskId;
    stoppingInFlight = true;
    _finalizeStoppedUI('已停止');
    if (!silent) showToast('写作已停止' + _requestTag(), 'warning');
    if (!taskId) {
        stoppingInFlight = false;
        return;
    }

    try {
        const res = await API.post(`/api/generate/stop/${taskId}`, {});
        if (res && res.request_id) {
            currentRequestId = String(res.request_id || '');
        }
    } catch (error) {
        console.warn('Failed to stop generation cleanly', error);
    } finally {
        if (myEpoch === generationEpoch) {
            stoppingInFlight = false;
        }
    }
}

function _nextPollingDelayMs() {
    const elapsed = Math.max(0, Date.now() - pollingStartedAt);
    let base = 700;
    if (elapsed > 9000) base = 1000;
    if (elapsed > 28000) base = 1400;
    if (elapsed > 65000) base = 2100;

    if (pollingNoChangeRounds >= 6) base += 500;
    if (pollingNoChangeRounds >= 12) base += 800;
    if (pollingNoChangeRounds >= 20) base += 1000;
    return Math.min(4200, Math.max(500, base));
}

async function _pollGenerationStatus(taskId) {
    try {
        if (blockGenerationUpdates || stoppingInFlight || isPaused) {
            return true;
        }
        const status = await API.get(`/api/generate/status/${taskId}`);
        if (status && status.request_id) {
            currentRequestId = String(status.request_id || currentRequestId || '');
        }
        if (blockGenerationUpdates || stoppingInFlight || isPaused) {
            return true;
        }

        if (status.state === 'done') {
            stopPolling();
            currentTaskId = null;
            isPaused = false;
            isWriting = false; // Done writing
            setTopToolbarEngineStatus('');
            _setGenerationStage('finishing');
            updatePauseButton();
            setGenerating(false); // Reset button to Start
            const finalText = _stripPauseMarkerPrefix(String(status.content || ''));
            const { enabled: typewriterEnabled } = getTypewriterSettings();
            if (typewriterEnabled) {
                pendingStreamPreviewText = finalText;
                pendingStreamPreviewFinalize = true;
                if (!thinkingCycleCompleted) {
                    await _ensureThinkingCycleThenStream();
                } else {
                    _flushBufferedStreamingPreview();
                }
            } else {
                resetStreamingPreviewState();
                hasFrontendContentStarted = true;
                fullContentCache = finalText;
                const genBox = document.getElementById('generated-content');
                genBox.innerText = finalText;
                if (isAutoScroll) {
                    genBox.scrollTop = genBox.scrollHeight;
                }
                document.getElementById('skip-anim-btn').classList.add('hidden');
                updateRefStatusVisibilityBySkipState();
                document.getElementById('gen-actions').classList.remove('hidden');
                updateStatus('ready', '生成完成');
                showToast('内容生成完毕', 'success');
                _setGenerationStage('completed');
            }
            currentRequestId = '';
            return false;
        }
        if (status.state === 'error') {
            stopPolling();
            resetStreamingPreviewState();
            currentTaskId = null;
            isPaused = false;
            isWriting = false;
            setTopToolbarEngineStatus('异常');
            _markGenerationStageError();
            updatePauseButton();
            setGenerating(false);
            const reason = formatGenerationIssueText(status.message || '生成失败', status.error_code || '');
            showToast('生成出错: ' + reason + _requestTag(status.request_id || ''), 'error');
            _setWriterErrorVisibleState();
            currentRequestId = '';
            return false;
        }
        if (status.state === 'stopped' || status.state === 'stopping') {
            currentRequestId = '';
            return false;
        }

        const thinking = status.thinking || 'AI 正在构思...';
        const partial = _stripPauseMarkerPrefix(String(status.partial_content || ''));
        _recordThinkingPhase(thinking);
        const { enabled: typewriterEnabled } = getTypewriterSettings();
        if (partial && partial === pollingLastPartial) {
            pollingNoChangeRounds += 1;
        } else {
            pollingNoChangeRounds = 0;
            pollingLastPartial = partial;
        }

        if (typewriterEnabled && partial.trim()) {
            if (thinkingCycleCompleted) {
                queueStreamingPreview(partial, false);
                if (generationStage === 'queued') {
                    _setGenerationStage('generating');
                }
            } else {
                pendingStreamPreviewText = partial;
                pendingStreamPreviewFinalize = false;
                if (!hasFrontendContentStarted) {
                    updateThinkingDisplay(thinking);
                }
                void _ensureThinkingCycleThenStream();
            }
        } else if (!hasFrontendContentStarted) {
            updateThinkingDisplay(thinking);
        }
        if (!partial.trim() && !hasFrontendContentStarted) {
            setTopToolbarEngineStatus('成功');
        }
        updateStatus('thinking', 'AI 正在创作...');
        return true;
    } catch (error) {
        stopPolling();
        resetStreamingPreviewState();
        currentTaskId = null;
        isPaused = false;
        isWriting = false;
        setTopToolbarEngineStatus('异常');
        _markGenerationStageError();
        updatePauseButton();
        setGenerating(false);
        const reason = formatGenerationIssueText(error.message || '连接中断', error.error_code || '');
        showToast('轮询状态失败: ' + reason + _requestTag(error.request_id || ''), 'error');
        _setWriterErrorVisibleState();
        currentRequestId = '';
        return false;
    }
}

function _scheduleNextPoll(taskId) {
    if (blockGenerationUpdates || stoppingInFlight || isPaused || !isWriting || currentTaskId !== taskId) {
        return;
    }
    const delay = _nextPollingDelayMs();
    pollingTimer = setTimeout(async () => {
        pollingTimer = null;
        const shouldContinue = await _pollGenerationStatus(taskId);
        if (shouldContinue) {
            _scheduleNextPoll(taskId);
        }
    }, delay);
}

function startPolling(taskId, preserveContent = false) {
    stopPolling();
    pollingStartedAt = Date.now();
    pollingNoChangeRounds = 0;
    pollingLastPartial = preserveContent ? String(fullContentCache || '') : '';

    Promise.resolve().then(async () => {
        const shouldContinue = await _pollGenerationStatus(taskId);
        if (shouldContinue) {
            _scheduleNextPoll(taskId);
        }
    });
}

function stopPolling() {
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
    }
}

function updatePauseButton() {
    const btn = document.getElementById('pause-writing-btn');
    if (!btn) return;
    btn.classList.add('writer-icon-btn');
    if (!currentTaskId) {
        btn.classList.add('hidden');
        _setIconButton(btn, 'pause', '暂停写作');
        return;
    }
    btn.classList.remove('hidden');
    if (isPaused) {
        _setIconButton(btn, 'resume', '继续写作');
    } else {
        _setIconButton(btn, 'pause', '暂停写作');
    }
}

function togglePauseWriting() {
    if (_actionDebounced('pause-generation')) return;
    if (!currentTaskId) return;
    const genBox = document.getElementById('generated-content');
    
    if (!isPaused) {
        isPaused = true;
        _haltFrontendTypingProgress();
        stopPolling();
        updateStatus('paused', '已暂停');
        updatePauseButton();
        
        const spinner = genBox.querySelector('.thinking-spinner');
        if (spinner) spinner.classList.add('paused');
        const thinkingText = document.getElementById('thinking-text');
        if (thinkingText) {
            thinkingText.classList.add('paused');
        }
        const snapshotContent = _stripPauseMarkerPrefix(
            String(fullContentCache || genBox.innerText || '')
        ).trim();
        API.post('/api/generate/pause-snapshot', {
            task_id: currentTaskId,
            request_id: currentRequestId,
            content: snapshotContent,
        }).catch(() => {});
        
        return;
    }

    isPaused = false;
    updatePauseButton();
    const spinner = genBox.querySelector('.thinking-spinner');
    if (spinner) spinner.classList.remove('paused');
    
    // Immediate text update
    updateStatus('thinking', 'AI 正在创作...');
    const thinkingText = document.getElementById('thinking-text');
    if (thinkingText) {
        thinkingText.innerText = 'AI 正在构思...';
        thinkingText.classList.remove('paused');
    }

    startPolling(currentTaskId, true);
}

async function acceptBatch() {
    const content = document.getElementById('generated-content').innerText;
    if (!content || content === '(写作已停止)') return;

    // UI Setup
    const acceptBtn = document.getElementById('accept-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const overlay = document.getElementById('draft-loading-overlay');
    const overlayText = overlay ? overlay.querySelector('span') : null;

    acceptBtn.disabled = true;
    deleteBtn.disabled = true;
    
    if (overlay) {
        if (overlayText) overlayText.innerText = '正在保存...';
        overlay.classList.remove('hidden');
    }

    try {
        const response = await API.post('/api/draft/accept', { content: content });
        updateDraftDisplay(response.draft_content);

        document.getElementById('generated-content').innerHTML = '';
        document.getElementById('gen-actions').classList.add('hidden');
        updateStatus('ready', '已采纳，准备下一段...');

        // Refresh config to update cache
        await loadConfig();

        setTimeout(() => {
            isPaused = false;
            updatePauseButton();
            // Do NOT auto-restart, user must click start
            // startGenerate(); 
        }, 500);

    } catch (error) {
        showToast('采纳内容失败: ' + error.message, 'error');
        acceptBtn.disabled = false;
        deleteBtn.disabled = false;
    } finally {
        if (overlay) overlay.classList.add('hidden');
    }
}

async function deleteBatch() {
    try {
        const content = (document.getElementById('generated-content').innerText || '').trim();
        const res = await API.post('/api/draft/delete', { content });
        if (res && res.discarded_added) {
            if (typeof loadDiscardedDrafts === 'function') {
                await loadDiscardedDrafts();
            }
            showToast('已存入废弃稿件', 'success');
        }

        document.getElementById('generated-content').innerHTML = '';
        document.getElementById('gen-actions').classList.add('hidden');
        updateStatus('thinking', '重新生成中...');

        isPaused = false;
        updatePauseButton();
        // Do NOT auto-restart
        startGenerate();

    } catch (error) {
        showToast('操作失败: ' + error.message, 'error');
    }
}

function updateDraftDisplay(content) {
    const draftBox = document.getElementById('draft-content');
    draftBox.innerText = content;

    if (typeof updateDraftCharCountBadge === 'function') {
        updateDraftCharCountBadge(content || '');
    } else {
        const count = content ? content.length : 0;
        document.getElementById('draft-char-count').innerText = `${count}字`;
    }
    if (typeof applyDraftEditLockByText === 'function') {
        applyDraftEditLockByText(content || '');
    }
    if (typeof updateCacheDisplayFromDraftText === 'function') {
        updateCacheDisplayFromDraftText(content || '');
    }
}

function showThinkingUI() {
    const genBox = document.getElementById('generated-content');
    genBox.innerHTML = `
        <div class="thinking-container">
            <div class="thinking-spinner"></div>
            <div id="thinking-text" class="thinking-text">AI 正在构思...</div>
        </div>
    `;
    document.getElementById('gen-actions').classList.add('hidden');
    document.getElementById('skip-anim-btn').classList.add('hidden');
    updateRefStatusVisibilityBySkipState();
}

function updateThinkingDisplay(text) {
    if (hasFrontendContentStarted) {
        return;
    }
    const textEl = document.getElementById('thinking-text');
    if (textEl) {
        textEl.innerText = text;
    } else {
        showThinkingUI();
        document.getElementById('thinking-text').innerText = text;
    }
}

function setGenerating(isGenerating) {
    const acceptBtn = document.getElementById('accept-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const pauseBtn = document.getElementById('pause-writing-btn');

    if (isGenerating) {
        _setMainStartButtonVisual('running');
        _setSidebarStartButtonVisual(true, false);
        
        acceptBtn.disabled = true;
        deleteBtn.disabled = true;
        if (pauseBtn && currentTaskId) {
            pauseBtn.classList.remove('hidden');
        }
    } else {
        _setMainStartButtonVisual('idle');
        _setSidebarStartButtonVisual(false, false);
        
        acceptBtn.disabled = false;
        deleteBtn.disabled = false;
        if (pauseBtn) {
            pauseBtn.classList.add('hidden');
        }
        isPaused = false;
        updatePauseButton();
    }
}

function startTypewriter(content) {
    resetStreamingPreviewState();
    fullContentCache = content;
    const genBox = document.getElementById('generated-content');
    genBox.innerHTML = ''; // Clear thinking UI

    const { speed } = getTypewriterSettings();

    const cursor = document.createElement('span');
    cursor.className = 'cursor-blink';
    genBox.appendChild(cursor);

    const skipBtn = document.getElementById('skip-anim-btn');
    skipBtn.classList.remove('hidden');
    updateRefStatusVisibilityBySkipState();

    let index = 0;

    if (typeWriterTimer) clearInterval(typeWriterTimer);

    typeWriterTimer = setInterval(() => {
        if (index < content.length) {
            const char = content.charAt(index);
            const textNode = document.createTextNode(char);
            genBox.insertBefore(textNode, cursor);
            index++;
            if (isAutoScroll) {
                genBox.scrollTop = genBox.scrollHeight;
            }
        } else {
            finishTypewriter();
        }
    }, speed);
}

function skipAnimation() {
    if (streamingPreviewActive) {
        const genBox = document.getElementById('generated-content');
        if (typeWriterTimer) {
            clearInterval(typeWriterTimer);
            typeWriterTimer = null;
        }
        streamingPreviewIndex = streamingPreviewTarget.length;
        genBox.innerText = streamingPreviewTarget;
        if (streamingPreviewFinal) {
            _finishStreamingPreview();
        }
        return;
    }
    if (typeWriterTimer) {
        clearInterval(typeWriterTimer);
        typeWriterTimer = null;
    }
    const genBox = document.getElementById('generated-content');
    const cursor = genBox.querySelector('.cursor-blink');
    if (cursor) cursor.remove();
    finishTypewriter();
}

function finishTypewriter() {
    if (typeWriterTimer) {
        clearInterval(typeWriterTimer);
        typeWriterTimer = null;
    }

    const genBox = document.getElementById('generated-content');
    genBox.innerText = fullContentCache;

    // Final scroll check
    if (isAutoScroll) {
        genBox.scrollTop = genBox.scrollHeight;
    }

    document.getElementById('skip-anim-btn').classList.add('hidden');
    updateRefStatusVisibilityBySkipState();
    document.getElementById('gen-actions').classList.remove('hidden');
    updateStatus('ready', '生成完成');
    _setGenerationStage('completed');

    currentTaskId = null;
    // Don't modify isWriting/setGenerating here, as they are already handled by startPolling logic
    // But verify cleanliness:
    isPaused = false;
    updatePauseButton();
    showToast('内容生成完毕' + _requestTag(), 'success');
    currentRequestId = '';
}

function restoreGeneratedFromDiscarded(content) {
    const text = String(content || '').trim();
    if (!text) return;

    resetStreamingPreviewState();

    if (typeWriterTimer) {
        clearInterval(typeWriterTimer);
        typeWriterTimer = null;
    }

    fullContentCache = text;
    const genBox = document.getElementById('generated-content');
    genBox.innerText = text;
    document.getElementById('skip-anim-btn').classList.add('hidden');
    updateRefStatusVisibilityBySkipState();
    document.getElementById('gen-actions').classList.remove('hidden');

    currentTaskId = null;
    isPaused = false;
    isWriting = false;
    setTopToolbarEngineStatus('');
    _resetGenerationStageTimeline();
    setGenerating(false);
    updatePauseButton();
    updateStatus('ready', '已复原废弃稿件');
}

// --- New Status & Scroll Functions ---

function updateStatus(state, text) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');

    // Reset classes
    dot.className = 'status-dot';
    
    // Add new state class
    if (state === 'ready') dot.classList.add('ready');
    else if (state === 'success') dot.classList.add('success');
    else if (state === 'thinking') dot.classList.add('thinking');
    else if (state === 'stopped') dot.classList.add('stopped');
    else if (state === 'paused') dot.classList.add('paused');
    else if (state === 'error') dot.classList.add('error');

    label.innerText = text;
}

function toggleAutoScroll() {
    isAutoScroll = !isAutoScroll;
    refreshAutoScrollButtonVisual();
    if (isAutoScroll) showToast('自动滚动已开启', 'success');
    else showToast('自动滚动已关闭', 'success');
}

function refreshAutoScrollButtonVisual() {
    const btn = document.getElementById('auto-scroll-btn');
    if (!btn) return;
    btn.classList.toggle('active', isAutoScroll);
    btn.classList.toggle('lock-on', isAutoScroll);
    btn.classList.toggle('lock-off', !isAutoScroll);
    btn.innerHTML = '<span class="btn-icon-text" aria-hidden="true">▼</span>';
    btn.title = isAutoScroll ? '自动滚动: 开' : '自动滚动: 关';
    btn.setAttribute('aria-label', btn.title);
}
