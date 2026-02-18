const DRAFT_CACHE_TAIL_CHARS = 350;
const OUTLINE_REQUIRED_FIELD_IDS = [
    'outline-overall-flow',
    'outline-worldview',
    'outline-protagonist-tags',
    'outline-target-words',
    'outline-ending-pref'
];
const OUTLINE_ALL_FIELD_IDS = [
    'outline-overall-flow',
    'outline-selling-points',
    'outline-key-events',
    'outline-story-pace',
    'outline-worldview',
    'outline-protagonist-tags',
    'outline-motivation',
    'outline-relations',
    'outline-antagonist',
    'outline-foreshadowing',
    'outline-target-words',
    'outline-ending-pref'
];
const ENGINE_LABELS = {
    codex: 'ChatGPT',
    gemini: 'Gemini',
    claude: 'Claude',
    doubao: 'Doubao',
    personal: '个人配置'
};
const TYPEWRITER_SPEED_KEY = 'writer:typewriterSpeed';
const TYPEWRITER_ENABLED_KEY = 'writer:typewriterEnabled';
const CACHE_BOX_ENABLED_KEY = 'writer:cacheBoxEnabled';
const STAGE_TIMELINE_ENABLED_KEY = 'writer:stageTimelineEnabled';
const DEFAULT_TYPEWRITER_SPEED = 30;
const DISCARDED_PAGE_SIZE = 20;
const PERSONAL_MODEL_DRAG_HOLD_MS = 260;
const PERSONAL_MODEL_AUTOSCROLL_EDGE_PX = 52;
const PERSONAL_MODEL_AUTOSCROLL_MAX_STEP = 16;
const DEFAULT_DOUBAO_MODELS = [
    'doubao-seed-1-6-251015',
    'doubao-seed-1-6-lite-251015',
    'doubao-seed-1-6-flash-250828'
];
let draftAutosaveTimer = null;
let outlineAbortController = null;
let outlinePaused = false;
let enginePickerGlobalListenersAttached = false;
let sidebarTransitionTimer = null;
let configSelectGlobalListenersAttached = false;
let discardedItemsCache = [];
let discardedPage = 1;
let personalModelPressTimer = null;
let personalModelDragState = null;
let personalModelAutoscrollRaf = 0;
let personalModelPendingPress = null;
let toolbarStatusSnapshot = null;
let toolbarEngineStatusOverride = '';
let latestModelHealthRows = [];
let latestSelfCheckResult = null;
let latestBookshelf = null;
let personalModelContextTargetRow = null;
let contextMenuEditableTarget = null;
let infoBoxItems = [];
let infoBoxContextItemId = null;
let forceCreateBookRequired = false;

document.addEventListener('DOMContentLoaded', () => {
    initUI(); // Initialize Theme, Sidebar
    renderToolbar(); // Render Dynamic Toolbar
    initConfigSelects();
    initWriterSettings();
    loadConfig();
    loadDraft();
    checkBackendStatus();
    setTimeout(() => {
        API.post('/api/engine/prewarm', {}).catch(() => {});
    }, 400);
    setInterval(() => {
        checkBackendStatus({ silent: true });
    }, 10000);
    setTimeout(() => {
        runSelfCheck(true);
    }, 900);
    if (typeof detectRecoverableGeneration === 'function') {
        setTimeout(() => {
            detectRecoverableGeneration();
        }, 300);
    }

    document.getElementById('save-config-btn').addEventListener('click', saveConfig);
    document.getElementById('start-writing-btn').addEventListener('click', toggleGeneration);
    const sidebarStartBtn = document.getElementById('sidebar-start-writing-btn');
    if (sidebarStartBtn) {
        sidebarStartBtn.addEventListener('click', toggleGeneration);
    }
    document.getElementById('accept-btn').addEventListener('click', acceptBatch);
    document.getElementById('delete-btn').addEventListener('click', deleteBatch);
    document.getElementById('split-chapter-btn').addEventListener('click', splitChapter);

    // UI Event Listeners
    // document.getElementById('sidebar-toggle-btn').addEventListener('click', toggleSidebar); // Moved to Toolbar Config
    // document.getElementById('settings-btn').addEventListener('click', openSettingsModal); // Moved to Toolbar Config
    // document.getElementById('generate-outline-btn').addEventListener('click', openOutlineModal); // Moved to Toolbar Config
    
    const discardCollapseBtn = document.getElementById('discarded-collapse-btn');
    if (discardCollapseBtn) {
        discardCollapseBtn.addEventListener('click', toggleDiscardedPanel);
    }
    
    // Modal Close Buttons
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', closeSettingsModal);
    });

    document.getElementById('draft-content').addEventListener('input', () => {
        const text = getDraftEditorText();
        if (typeof updateDraftCharCountBadge === 'function') {
            updateDraftCharCountBadge(text);
        }
        if (typeof applyDraftEditLockByText === 'function') {
            applyDraftEditLockByText(text);
        }
        updateCacheDisplayFromDraftText(text);
        scheduleDraftAutosave(text);
    });

    const engineSelect = document.getElementById('engine-mode');
    if (engineSelect) {
        engineSelect.addEventListener('change', () => {
            const mode = engineSelect.value;
            toggleEngineFields(mode);
            updateEnginePickerUI(mode);
            if (mode === 'personal') {
                openPersonalConfigModal();
            }
        });
    }
    const codexAccessMode = document.getElementById('codex-access-mode');
    const geminiAccessMode = document.getElementById('gemini-access-mode');
    const claudeAccessMode = document.getElementById('claude-access-mode');
    const openAssistSettingsBtn = document.getElementById('open-assist-settings-btn');
    const openAccessSettingsBtn = document.getElementById('open-access-settings-btn');
    if (codexAccessMode) codexAccessMode.addEventListener('change', updateEngineAccessFields);
    if (geminiAccessMode) geminiAccessMode.addEventListener('change', updateEngineAccessFields);
    if (claudeAccessMode) claudeAccessMode.addEventListener('change', updateEngineAccessFields);
    if (openAssistSettingsBtn) openAssistSettingsBtn.addEventListener('click', openAssistSettingsModal);
    if (openAccessSettingsBtn) openAccessSettingsBtn.addEventListener('click', openAccessSettingsModal);
    const personalBaseUrlInput = document.getElementById('personal-base-url-input');
    const personalApiKeyInput = document.getElementById('personal-api-key-input');
    const personalModelSelect = document.getElementById('personal-model-select');
    const personalModelModalSelect = document.getElementById('personal-model-modal-select');
    const personalModelInputs = document.getElementById('personal-model-inputs');
    const personalModelAddBtn = document.getElementById('personal-model-add-btn');
    const doubaoConfigBtn = document.getElementById('doubao-config-btn');
    const doubaoModelSelect = document.getElementById('doubao-model-select');
    const doubaoModelModalSelect = document.getElementById('doubao-model-modal-select');
    const doubaoModelInputs = document.getElementById('doubao-model-inputs');
    const doubaoModelAddBtn = document.getElementById('doubao-model-add-btn');
    if (personalBaseUrlInput) {
        personalBaseUrlInput.addEventListener('input', updatePersonalConfigStatus);
    }
    if (personalApiKeyInput) {
        personalApiKeyInput.addEventListener('input', updatePersonalConfigStatus);
    }
    if (personalModelAddBtn) {
        personalModelAddBtn.addEventListener('click', () => {
            const row = _appendPersonalModelInputRow('');
            if (row) {
                const input = row.querySelector('.personal-model-id-input');
                if (input) input.focus();
            }
            setPersonalModelsDirty(true);
            syncPersonalModelInlineDisplay();
            updatePersonalConfigStatus();
        });
    }
    if (personalModelSelect) {
        personalModelSelect.addEventListener('change', () => {
            _promotePersonalModelToTop(personalModelSelect.value);
            syncPersonalModelInlineDisplay();
            setPersonalModelsDirty(true);
            updatePersonalConfigStatus();
        });
    }
    if (personalModelModalSelect) {
        personalModelModalSelect.addEventListener('change', () => {
            _promotePersonalModelToTop(personalModelModalSelect.value);
            syncPersonalModelInlineDisplay();
            setPersonalModelsDirty(true);
            updatePersonalConfigStatus();
        });
    }
    if (personalModelInputs) {
        personalModelInputs.addEventListener('input', (event) => {
            if (!event.target || !event.target.classList.contains('personal-model-id-input')) return;
            setPersonalModelsDirty(true);
            syncPersonalModelInlineDisplay();
            updatePersonalConfigStatus();
        });
        personalModelInputs.addEventListener('click', (event) => {
            const btn = event.target && event.target.closest
                ? event.target.closest('.personal-model-remove-btn')
                : null;
            if (!btn) return;
            const row = btn.closest('.personal-model-row');
            if (row) row.remove();
            if (!document.querySelector('#personal-model-inputs .personal-model-row')) {
                setPersonalModelConfig('');
                setPersonalModelsDirty(true);
            } else {
                setPersonalModelsDirty(true);
                syncPersonalModelInlineDisplay();
            }
            updatePersonalConfigStatus();
        });
        personalModelInputs.addEventListener('contextmenu', (event) => {
            if (personalModelDragState) {
                event.preventDefault();
                return;
            }
            const row = event.target && event.target.closest
                ? event.target.closest('.personal-model-row')
                : null;
            if (!row) return;
            event.preventDefault();
            const editable = resolveEditableTarget(event.target) || row.querySelector('.personal-model-id-input');
            openPersonalModelContextMenu(event, { row, editable });
        });
    }
    if (doubaoModelAddBtn) {
        doubaoModelAddBtn.addEventListener('click', () => {
            const row = appendDoubaoModelInputRow('');
            if (row) {
                const input = row.querySelector('.doubao-model-id-input');
                if (input) input.focus();
            }
            syncDoubaoModelInlineDisplay();
        });
    }
    if (doubaoConfigBtn) {
        doubaoConfigBtn.addEventListener('click', openDoubaoConfigModal);
    }
    if (doubaoModelSelect) {
        doubaoModelSelect.addEventListener('change', () => {
            promoteDoubaoModelToTop(doubaoModelSelect.value);
            syncDoubaoModelInlineDisplay();
        });
    }
    if (doubaoModelModalSelect) {
        doubaoModelModalSelect.addEventListener('change', () => {
            promoteDoubaoModelToTop(doubaoModelModalSelect.value);
            syncDoubaoModelInlineDisplay();
        });
    }
    if (doubaoModelInputs) {
        doubaoModelInputs.addEventListener('input', (event) => {
            if (!event.target || !event.target.classList.contains('doubao-model-id-input')) return;
            syncDoubaoModelInlineDisplay();
        });
        doubaoModelInputs.addEventListener('click', (event) => {
            const btn = event.target && event.target.closest
                ? event.target.closest('.doubao-model-remove-btn')
                : null;
            if (!btn) return;
            const row = btn.closest('.doubao-model-row');
            if (row) row.remove();
            if (!document.querySelector('#doubao-model-inputs .doubao-model-row')) {
                setDoubaoModelConfig('');
            } else {
                syncDoubaoModelInlineDisplay();
            }
        });
        doubaoModelInputs.addEventListener('contextmenu', (event) => {
            if (personalModelDragState) {
                event.preventDefault();
                return;
            }
            const row = event.target && event.target.closest
                ? event.target.closest('.doubao-model-row')
                : null;
            if (!row) return;
            event.preventDefault();
            const editable = resolveEditableTarget(event.target) || row.querySelector('.doubao-model-id-input');
            openPersonalModelContextMenu(event, { row, editable });
        });
    }
    const copyBtn = document.getElementById('personal-model-menu-copy');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            await handleContextMenuCopy();
            closePersonalModelContextMenu();
        });
    }
    const pasteBtn = document.getElementById('personal-model-menu-paste');
    if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
            await handleContextMenuPaste();
            closePersonalModelContextMenu();
        });
    }
    const cutBtn = document.getElementById('personal-model-menu-cut');
    if (cutBtn) {
        cutBtn.addEventListener('click', async () => {
            await handleContextMenuCut();
            closePersonalModelContextMenu();
        });
    }
    const pinTopBtn = document.getElementById('personal-model-menu-pin-top');
    if (pinTopBtn) {
        pinTopBtn.addEventListener('click', () => {
            const row = personalModelContextTargetRow;
            const container = row && row.parentElement ? row.parentElement : null;
            if (!container || !row) {
                closePersonalModelContextMenu();
                return;
            }
            if (container.firstElementChild !== row) {
                container.insertBefore(row, container.firstElementChild);
                if (row.classList.contains('doubao-model-row')) {
                    syncDoubaoModelInlineDisplay();
                } else {
                    setPersonalModelsDirty(true);
                    syncPersonalModelInlineDisplay();
                    updatePersonalConfigStatus();
                }
                showToast('已设为置顶模型（默认）', 'success');
            }
            closePersonalModelContextMenu();
        });
    }
    const infoMenuCopyBtn = document.getElementById('info-box-menu-copy');
    if (infoMenuCopyBtn) {
        infoMenuCopyBtn.addEventListener('click', async () => {
            await copyInfoBoxItemById(infoBoxContextItemId);
            closeInfoBoxContextMenu();
        });
    }
    const infoBoxList = document.getElementById('info-box-list');
    if (infoBoxList) {
        infoBoxList.addEventListener('click', async (event) => {
            const copyBtn = event.target && event.target.closest
                ? event.target.closest('.info-box-copy-btn')
                : null;
            if (!copyBtn) return;
            const itemId = copyBtn.getAttribute('data-item-id');
            await copyInfoBoxItemById(itemId);
        });
        infoBoxList.addEventListener('contextmenu', (event) => {
            const item = event.target && event.target.closest
                ? event.target.closest('.info-box-item')
                : null;
            if (!item) return;
            event.preventDefault();
            openInfoBoxContextMenu(event, item.getAttribute('data-item-id'));
        });
    }
    document.addEventListener('contextmenu', (event) => {
        if (event.defaultPrevented) return;
        const inEngineMenu = Boolean(event.target && event.target.closest && event.target.closest('#engine-picker-menu'));
        if (inEngineMenu) return;
        const inInfoBox = Boolean(event.target && event.target.closest && event.target.closest('#info-box-modal'));
        if (inInfoBox) return;
        const row = event.target && event.target.closest
            ? (event.target.closest('#personal-model-inputs .personal-model-row') || event.target.closest('#doubao-model-inputs .doubao-model-row'))
            : null;
        const editable = resolveEditableTarget(event.target)
            || (row && row.classList.contains('doubao-model-row') ? row.querySelector('.doubao-model-id-input') : null)
            || (row ? row.querySelector('.personal-model-id-input') : null);
        if (!row && !editable) return;
        event.preventDefault();
        openPersonalModelContextMenu(event, { row, editable });
    });
    document.addEventListener('click', (event) => {
        const menu = document.getElementById('personal-model-context-menu');
        if (menu && !menu.classList.contains('hidden') && !menu.contains(event.target)) {
            closePersonalModelContextMenu();
        }
        const infoMenu = document.getElementById('info-box-context-menu');
        if (infoMenu && !infoMenu.classList.contains('hidden') && !infoMenu.contains(event.target)) {
            closeInfoBoxContextMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closePersonalModelContextMenu();
            closeInfoBoxContextMenu();
        }
    });
    window.addEventListener('resize', () => {
        closePersonalModelContextMenu();
        closeInfoBoxContextMenu();
    });
    const personalConfigModal = document.getElementById('personal-config-modal');
    if (personalConfigModal) {
        personalConfigModal.addEventListener('click', (e) => {
            if (e.target === personalConfigModal) {
                closePersonalConfigModal();
            }
        });
    }
    const selfCheckModal = document.getElementById('self-check-modal');
    if (selfCheckModal) {
        selfCheckModal.addEventListener('click', (e) => {
            if (e.target === selfCheckModal) closeSelfCheckModal();
        });
    }
    const modelHealthModal = document.getElementById('model-health-modal');
    if (modelHealthModal) {
        modelHealthModal.addEventListener('click', (e) => {
            if (e.target === modelHealthModal) closeModelHealthModal();
        });
    }
    const settingsJsonModal = document.getElementById('settings-json-modal');
    if (settingsJsonModal) {
        settingsJsonModal.addEventListener('click', (e) => {
            if (e.target === settingsJsonModal) closeSettingsJsonModal();
        });
    }
    const authJsonModal = document.getElementById('auth-json-modal');
    if (authJsonModal) {
        authJsonModal.addEventListener('click', (e) => {
            if (e.target === authJsonModal) closeAuthJsonModal();
        });
    }
    const assistSettingsModal = document.getElementById('assist-settings-modal');
    if (assistSettingsModal) {
        assistSettingsModal.addEventListener('click', (e) => {
            if (e.target === assistSettingsModal) closeAssistSettingsModal();
        });
    }
    const accessSettingsModal = document.getElementById('access-settings-modal');
    if (accessSettingsModal) {
        accessSettingsModal.addEventListener('click', (e) => {
            if (e.target === accessSettingsModal) closeAccessSettingsModal();
        });
    }
    const doubaoConfigModal = document.getElementById('doubao-config-modal');
    if (doubaoConfigModal) {
        doubaoConfigModal.addEventListener('click', (e) => {
            if (e.target === doubaoConfigModal) closeDoubaoConfigModal();
        });
    }
    const bookshelfModal = document.getElementById('bookshelf-modal');
    if (bookshelfModal) {
        bookshelfModal.addEventListener('click', (e) => {
            if (e.target === bookshelfModal && !forceCreateBookRequired) closeBookshelfModal();
        });
    }
    const infoBoxModal = document.getElementById('info-box-modal');
    if (infoBoxModal) {
        infoBoxModal.addEventListener('click', (e) => {
            if (e.target === infoBoxModal) closeInfoBoxModal();
        });
    }
    const proxyPortInput = document.getElementById('proxy-port-input');
    if (proxyPortInput) {
        const syncProxy = () => {
            syncProxyPortGlobal({ silent: true });
        };
        proxyPortInput.addEventListener('change', syncProxy);
        proxyPortInput.addEventListener('blur', syncProxy);
    }

    // Engine Picker listeners are now handled in reattachEnginePickerListeners() called by renderToolbar()
    // The previous event listeners here are removed to avoid duplication/errors with dynamic rendering

    updateEnginePickerUI(getEngineMode());
    updateEngineAccessFields();
    updatePersonalConfigStatus();
    initOutlineModal();
    if (typeof initWritingButtonsUI === 'function') {
        initWritingButtonsUI();
    }
});

// --- Toolbar Logic ---

const TOOLBAR_CONFIG = [
    {
        id: 'sidebar-toggle-btn',
        icon: '☰',
        title: '收起/展开侧边栏',
        action: toggleSidebar,
        type: 'button',
        position: 'left'
    },
    {
        type: 'component',
        id: 'toolbar-status-bar',
        render: renderToolbarStatusComponent,
        position: 'left'
    },
    {
        id: 'generate-outline-btn',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
               <polyline points="14 2 14 8 20 8"></polyline>
               <line x1="16" y1="13" x2="8" y2="13"></line>
               <line x1="16" y1="17" x2="8" y2="17"></line>
               <polyline points="10 9 9 9 8 9"></polyline>
            </svg>`,
        title: '调用当前模型生成大纲',
        action: openOutlineModal,
        type: 'button',
        position: 'right'
    },
    {
        type: 'component',
        id: 'engine-picker-wrapper',
        render: renderEnginePickerComponent,
        position: 'right'
    },
    {
        id: 'self-check-btn',
        icon: '🧪',
        title: '环境自检',
        action: () => runSelfCheck(false),
        type: 'button',
        position: 'right'
    },
    {
        id: 'new-book-btn',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
               <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
               <path d="M12 7v6"></path>
               <path d="M9 10h6"></path>
            </svg>`,
        title: '新建书籍',
        action: createBookQuick,
        type: 'button',
        position: 'right'
    },
    {
        id: 'bookshelf-btn',
        icon: '📚',
        title: '打开书架',
        action: openBookshelfModal,
        type: 'button',
        position: 'right'
    },
    {
        id: 'model-health-btn',
        icon: '🩺',
        title: '模型健康面板',
        action: openModelHealthModal,
        type: 'button',
        position: 'right'
    },
    {
        id: 'info-box-btn',
        icon: '🔔',
        title: '打开信息箱',
        action: openInfoBoxModal,
        type: 'button',
        position: 'right'
    },
    {
        id: 'discarded-toggle-btn',
        icon: '🗑️',
        title: '查看废弃稿件',
        action: toggleDiscardedPanel,
        type: 'button',
        position: 'right'
    },
    {
        id: 'settings-btn',
        icon: '⚙️',
        title: '系统设置',
        action: openSettingsModal,
        type: 'button',
        position: 'right'
    }
];

function renderToolbar() {
    const container = document.getElementById('toolbar-container');
    if (!container) return;

    container.innerHTML = '';
    
    const leftGroup = document.createElement('div');
    leftGroup.className = 'toolbar-group left';
    
    const rightGroup = document.createElement('div');
    rightGroup.className = 'toolbar-group right';

    TOOLBAR_CONFIG.forEach(item => {
        let el;
        if (item.type === 'button') {
            el = document.createElement('button');
            el.id = item.id;
            el.className = 'icon-btn toolbar-icon-btn glass-btn';
            el.title = item.title;
            el.innerHTML = item.icon;
            el.onclick = item.action;
        } else if (item.type === 'component') {
            if (typeof item.render === 'function') {
                el = item.render();
            }
        }

        if (el) {
            if (item.position === 'left') {
                leftGroup.appendChild(el);
            } else {
                rightGroup.appendChild(el);
            }
        }
    });

    container.appendChild(leftGroup);
    container.appendChild(rightGroup);
    
    // Re-attach engine picker listeners since we re-rendered it
    reattachEnginePickerListeners();
    updateToolbarStatusBar(toolbarStatusSnapshot);
}

function renderToolbarStatusComponent() {
    const wrapper = document.createElement('div');
    wrapper.id = 'toolbar-status-bar';
    wrapper.className = 'toolbar-status-bar';
    wrapper.innerHTML = `
        <span id="toolbar-status-engine" class="toolbar-status-chip">状态: -</span>
        <span id="toolbar-status-current-model" class="toolbar-status-chip">当前模型: -</span>
    `;
    return wrapper;
}

function _modeReadyFromStatus(status) {
    if (!status) return false;
    if (status.engine_mode === 'gemini') {
        if (status.gemini_access_mode === 'api') return status.gemini_api_ready !== false;
        return status.gemini_available !== false;
    }
    if (status.engine_mode === 'claude') {
        if (status.claude_access_mode === 'api') return status.claude_api_ready !== false;
        return status.claude_available !== false;
    }
    if (status.engine_mode === 'doubao') return status.doubao_ready !== false;
    if (status.engine_mode === 'personal') return status.personal_ready !== false;
    if (status.engine_mode === 'api') return status.api_ready !== false;
    if (status.codex_access_mode === 'api') return status.codex_api_ready !== false;
    return status.codex_available !== false;
}

function _modeDefaultModelFromStatus(status) {
    if (!status) return '-';
    if (status.engine_mode === 'gemini') return status.gemini_model || '-';
    if (status.engine_mode === 'claude') return status.claude_model || '-';
    if (status.engine_mode === 'doubao') return status.doubao_model || '-';
    if (status.engine_mode === 'personal') return status.personal_model || '-';
    if (status.engine_mode === 'api') return status.api_model || '-';
    return status.codex_model || '-';
}

function updateToolbarStatusBar(status) {
    if (!status) return;
    toolbarStatusSnapshot = status;
    const engineEl = document.getElementById('toolbar-status-engine');
    const currentEl = document.getElementById('toolbar-status-current-model');
    if (!engineEl || !currentEl) return;

    const ready = _modeReadyFromStatus(status);
    const defaultModel = _modeDefaultModelFromStatus(status);
    const currentModel = String(status.runtime_last_model || defaultModel || '-');

    const engineStatusText = toolbarEngineStatusOverride || (ready ? '就绪' : '异常');
    engineEl.classList.remove('state-ready', 'state-error', 'state-success');
    if (engineStatusText === '成功') {
        engineEl.classList.add('state-success');
    } else if (engineStatusText === '就绪') {
        engineEl.classList.add('state-ready');
    } else {
        engineEl.classList.add('state-error');
    }
    engineEl.textContent = `状态: ${engineStatusText}`;
    currentEl.textContent = `当前模型: ${currentModel || '-'}`;
}

function setToolbarEngineStatusOverride(label = '') {
    toolbarEngineStatusOverride = String(label || '').trim();
    if (toolbarStatusSnapshot) {
        updateToolbarStatusBar(toolbarStatusSnapshot);
        return;
    }
    const engineEl = document.getElementById('toolbar-status-engine');
    if (!engineEl) return;
    const text = toolbarEngineStatusOverride || '-';
    engineEl.classList.remove('state-ready', 'state-error', 'state-success');
    if (text === '成功') {
        engineEl.classList.add('state-success');
    } else if (text === '就绪') {
        engineEl.classList.add('state-ready');
    } else if (text) {
        engineEl.classList.add('state-error');
    }
    engineEl.textContent = `状态: ${text}`;
}

window.setToolbarEngineStatusOverride = setToolbarEngineStatusOverride;

function _fmtPercent(rate) {
    if (rate === null || rate === undefined || Number.isNaN(Number(rate))) return '-';
    return `${(Number(rate) * 100).toFixed(0)}%`;
}

function _fmtMs(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return `${Math.round(Number(value))}`;
}

function renderModelHealthPanel(rows = []) {
    latestModelHealthRows = Array.isArray(rows) ? rows : [];
    const body = document.getElementById('model-health-body');
    if (!body) return;
    if (!latestModelHealthRows.length) {
        body.innerHTML = '<tr><td colspan="6" class="health-empty">暂无数据</td></tr>';
        return;
    }
    body.innerHTML = latestModelHealthRows.map((row) => {
        const cooldown = Number(row.cooldown_ms || 0);
        const cooldownText = cooldown > 0 ? `${Math.ceil(cooldown / 1000)}s` : '-';
        return `
            <tr>
                <td>${row.engine || '-'}</td>
                <td title="${row.model || '-'}">${row.model || '-'}</td>
                <td>${_fmtPercent(row.success_rate)} (${row.success_n || 0}/${row.recent_n || 0})</td>
                <td>${_fmtMs(row.avg_first_token_ms)}</td>
                <td>${_fmtMs(row.avg_total_ms)}</td>
                <td>${cooldownText}</td>
            </tr>
        `;
    }).join('');
}

function openModelHealthModal() {
    const modal = document.getElementById('model-health-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderModelHealthPanel(latestModelHealthRows);
}

function closeModelHealthModal() {
    const modal = document.getElementById('model-health-modal');
    if (!modal) return;
    modal.classList.add('hidden');
}

async function refreshModelHealthPanel() {
    await checkBackendStatus({ silent: true });
    renderModelHealthPanel(latestModelHealthRows);
}

function _formatInfoBoxTime(ts) {
    const date = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(date.getTime())) return '-';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function _escapeInfoHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function _getInfoBoxTextById(itemId) {
    const id = String(itemId || '').trim();
    if (!id) return '';
    const item = infoBoxItems.find((x) => String(x.id) === id);
    return item ? String(item.text || '') : '';
}

function renderInfoBoxList() {
    const listEl = document.getElementById('info-box-list');
    if (!listEl) return;
    if (!Array.isArray(infoBoxItems) || !infoBoxItems.length) {
        listEl.innerHTML = '<div class="info-box-empty">暂无异常信息</div>';
        return;
    }
    listEl.innerHTML = infoBoxItems.map((item) => `
        <div class="info-box-item" data-item-id="${item.id}">
            <div class="info-box-row">
                <span class="info-box-time">${_formatInfoBoxTime(item.created_at)}</span>
                <button class="btn btn-primary btn-sm info-box-copy-btn" type="button" data-item-id="${item.id}">复制</button>
            </div>
            <div class="info-box-text">${_escapeInfoHtml(item.text)}</div>
        </div>
    `).join('');
}

function addInfoBoxItem(message) {
    const text = String(message || '').trim();
    if (!text) return;
    const item = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        text,
        created_at: new Date().toISOString(),
    };
    infoBoxItems.unshift(item);
    if (infoBoxItems.length > 200) {
        infoBoxItems = infoBoxItems.slice(0, 200);
    }
    renderInfoBoxList();
}

async function copyInfoBoxItemById(itemId) {
    const text = _getInfoBoxTextById(itemId);
    if (!text) {
        showToast('没有可复制内容', 'error');
        return false;
    }
    let ok = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            ok = true;
        }
    } catch (_) {
        ok = false;
    }
    if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            ok = document.execCommand('copy');
        } catch (_) {
            ok = false;
        }
        document.body.removeChild(ta);
    }
    showToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
    return ok;
}

function openInfoBoxContextMenu(event, itemId) {
    const menu = document.getElementById('info-box-context-menu');
    if (!menu) return;
    infoBoxContextItemId = String(itemId || '').trim();
    if (!infoBoxContextItemId) {
        closeInfoBoxContextMenu();
        return;
    }
    menu.classList.remove('hidden');
    const maxLeft = window.innerWidth - menu.offsetWidth - 8;
    const maxTop = window.innerHeight - menu.offsetHeight - 8;
    menu.style.left = `${Math.min(event.clientX, Math.max(8, maxLeft))}px`;
    menu.style.top = `${Math.min(event.clientY, Math.max(8, maxTop))}px`;
}

function closeInfoBoxContextMenu() {
    const menu = document.getElementById('info-box-context-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    infoBoxContextItemId = null;
}

function openInfoBoxModal() {
    const modal = document.getElementById('info-box-modal');
    const btn = document.getElementById('info-box-btn');
    if (!modal) return;
    renderInfoBoxList();
    modal.classList.remove('hidden');
    if (btn) btn.classList.add('active');
}

function closeInfoBoxModal() {
    const modal = document.getElementById('info-box-modal');
    const btn = document.getElementById('info-box-btn');
    if (!modal) return;
    modal.classList.add('hidden');
    closeInfoBoxContextMenu();
    if (btn) btn.classList.remove('active');
}

function clearInfoBoxItems() {
    infoBoxItems = [];
    renderInfoBoxList();
    showToast('信息箱已清空', 'success');
}

window.addInfoBoxItem = addInfoBoxItem;

function renderSelfCheck(result) {
    latestSelfCheckResult = result || null;
    const listEl = document.getElementById('self-check-list');
    const summaryEl = document.getElementById('self-check-summary');
    if (!listEl || !summaryEl) return;

    if (!result || !Array.isArray(result.checks)) {
        summaryEl.innerText = '无法读取自检结果';
        listEl.innerHTML = '<div class="self-check-item bad"><div class="check-name">读取失败</div><div class="check-state">异常</div></div>';
        return;
    }

    const required = new Set(Array.isArray(result.required_ids) ? result.required_ids : []);
    const requiredFailed = result.checks.filter((x) => required.has(x.id) && !x.ok);
    if (requiredFailed.length) {
        summaryEl.innerText = `当前引擎所需项异常：${requiredFailed.length} 项`;
    } else {
        summaryEl.innerText = '当前引擎所需项均已就绪';
    }

    listEl.innerHTML = result.checks.map((item) => {
        const bad = !item.ok;
        const requiredMark = required.has(item.id) ? '（必需）' : '';
        return `
            <div class="self-check-item ${bad ? 'bad' : 'ok'}">
                <div>
                    <div class="check-name">${item.name || item.id} ${requiredMark}</div>
                    <div class="check-detail">${item.detail || ''}</div>
                </div>
                <div class="check-state">${bad ? '异常' : '就绪'}</div>
            </div>
        `;
    }).join('');
}

function openSelfCheckModal() {
    const modal = document.getElementById('self-check-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderSelfCheck(latestSelfCheckResult);
}

function closeSelfCheckModal() {
    const modal = document.getElementById('self-check-modal');
    if (!modal) return;
    modal.classList.add('hidden');
}

function setSelfCheckLoading(loading) {
    const loadingEl = document.getElementById('self-check-loading');
    const listEl = document.getElementById('self-check-list');
    const summaryEl = document.getElementById('self-check-summary');
    if (loadingEl) loadingEl.classList.toggle('hidden', !loading);
    if (loading) {
        if (summaryEl) summaryEl.innerText = '正在检测环境，请稍候...';
        if (listEl) listEl.innerHTML = '';
    }
}

async function runSelfCheck(auto = false) {
    if (!auto) {
        openSelfCheckModal();
    }
    await syncProxyPortGlobal({ silent: true });
    setSelfCheckLoading(true);
    try {
        const result = await API.get('/api/self-check');
        renderSelfCheck(result);
        const required = new Set(Array.isArray(result.required_ids) ? result.required_ids : []);
        const failed = (result.checks || []).filter((x) => required.has(x.id) && !x.ok);
        if (failed.length) {
            const msg = `环境自检：当前引擎有 ${failed.length} 项异常`;
            if (!auto) showToast(msg, 'error');
        } else if (!auto) {
            showToast('环境自检通过', 'success');
        }
    } catch (error) {
        if (!auto) showToast('环境自检失败: ' + (error.message || 'unknown'), 'error');
    } finally {
        setSelfCheckLoading(false);
    }
}

function _isDefaultSeedBook(config) {
    const books = Array.isArray(config?.books) ? config.books : [];
    const active = config?.active_book || {};
    if (books.length !== 1) return false;
    return String(active.id || '') === 'default'
        && String(active.title || '') === '默认作品'
        && String(active.folder || '') === 'default_book';
}

function _setLockedForFirstRun(locked) {
    forceCreateBookRequired = Boolean(locked);
    const closeBtn = document.querySelector('#bookshelf-modal .icon-btn');
    if (closeBtn) closeBtn.classList.toggle('hidden', forceCreateBookRequired);
    const startBtn = document.getElementById('start-writing-btn');
    const sidebarStartBtn = document.getElementById('sidebar-start-writing-btn');
    const saveBtn = document.getElementById('save-config-btn');
    const disabled = forceCreateBookRequired;
    if (startBtn) startBtn.disabled = disabled;
    if (sidebarStartBtn) sidebarStartBtn.disabled = disabled;
    if (saveBtn) saveBtn.disabled = disabled;
    document.querySelectorAll('#config-panel textarea, #config-panel input, #config-panel select').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (el.id === 'new-book-title-input') return;
        if ('disabled' in el) {
            el.disabled = disabled;
        }
    });
}

function enforceFirstRunBookCreation(config) {
    const required = Boolean(config && config.first_run_required) || _isDefaultSeedBook(config || {});
    _setLockedForFirstRun(required);
    if (required) {
        openBookshelfModal();
        showToast('首次运行请先创建一本书', 'warning');
    }
}

function renderBookshelf(shelf) {
    latestBookshelf = shelf || null;
    const list = document.getElementById('bookshelf-list');
    if (!list) return;
    const books = Array.isArray((shelf || {}).books) ? shelf.books : [];
    const activeId = String((shelf || {}).active_book_id || '');
    if (!books.length) {
        list.innerHTML = '<div class="book-meta">暂无书籍</div>';
        return;
    }
    list.innerHTML = books.map((book) => {
        const id = String(book.id || '');
        const title = String(book.title || '未命名作品');
        const folder = String(book.folder || '');
        const active = id === activeId;
        return `
            <div class="book-card ${active ? 'active' : ''}">
                <div class="book-cover">${title}</div>
                <div class="book-meta">文件夹：${folder}</div>
                <div class="book-meta">更新时间：${book.updated_at || '-'}</div>
                <button class="btn btn-primary btn-sm" type="button" data-book-id="${id}" onclick="switchBookById(this.dataset.bookId)">${active ? '当前写作中' : '切换到此书'}</button>
            </div>
        `;
    }).join('');
}

async function refreshBookshelf() {
    try {
        const shelf = await API.get('/api/books');
        renderBookshelf(shelf);
        return shelf;
    } catch (error) {
        showToast('读取书架失败: ' + error.message, 'error');
        return null;
    }
}

function openBookshelfModal() {
    const modal = document.getElementById('bookshelf-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    refreshBookshelf();
}

function closeBookshelfModal() {
    const modal = document.getElementById('bookshelf-modal');
    if (!modal) return;
    if (forceCreateBookRequired) return;
    modal.classList.add('hidden');
}

async function createNewBook() {
    const input = document.getElementById('new-book-title-input');
    const title = String(input ? input.value : '').trim();
    if (!title) {
        showToast('请输入书名', 'error');
        return;
    }
    try {
        const res = await API.post('/api/books', { title });
        if (input) input.value = '';
        renderBookshelf(res.shelf || null);
        await loadConfig();
        await loadDraft();
        if (typeof loadDiscardedDrafts === 'function') {
            await loadDiscardedDrafts();
        }
        const folder = (((res || {}).paths || {}).root_dir || '').toString();
        showToast(`已创建并切换：${res.book?.title || title}`, 'success');
        _setLockedForFirstRun(false);
        closeBookshelfModal();
        if (folder) {
            document.getElementById('bookshelf-tip').innerText = `已创建目录：${folder}。本书的大纲、参考、缓存、章节、草稿都会保存在该目录。`;
        }
        await checkBackendStatus({ silent: true });
    } catch (error) {
        showToast('创建新书失败: ' + error.message, 'error');
    }
}

function createBookQuick() {
    openBookshelfModal();
    const input = document.getElementById('new-book-title-input');
    if (input) {
        input.focus();
        input.select();
    }
}

async function switchBookById(bookId) {
    const target = String(bookId || '').trim();
    if (!target) return;
    try {
        const res = await API.post('/api/books/switch', { book_id: target });
        renderBookshelf(res.shelf || null);
        await loadConfig();
        await loadDraft();
        if (typeof loadDiscardedDrafts === 'function') {
            await loadDiscardedDrafts();
        }
        if (typeof updateStatus === 'function') {
            updateStatus('ready', '就绪');
        }
        _setLockedForFirstRun(false);
        const activeTitle = (((res || {}).book || {}).title || '新书').toString();
        showToast(`已切换到：${activeTitle}`, 'success');
        closeBookshelfModal();
        await checkBackendStatus({ silent: true });
    } catch (error) {
        showToast('切换书籍失败: ' + error.message, 'error');
    }
}

async function openSettingsJsonModal() {
    const modal = document.getElementById('settings-json-modal');
    const editor = document.getElementById('settings-json-editor');
    const pathEl = document.getElementById('settings-json-path');
    if (!modal || !editor || !pathEl) return;
    modal.classList.remove('hidden');
    editor.value = '';
    pathEl.innerText = '路径：读取中...';
    try {
        const res = await API.get('/api/settings/file');
        editor.value = String(res.content || '');
        pathEl.innerText = `路径：${res.path || '-'}`;
    } catch (error) {
        showToast('读取 settings.json 失败: ' + error.message, 'error');
        pathEl.innerText = '路径：读取失败';
    }
}

function closeSettingsJsonModal() {
    const modal = document.getElementById('settings-json-modal');
    if (!modal) return;
    modal.classList.add('hidden');
}

async function saveSettingsJsonFile() {
    const editor = document.getElementById('settings-json-editor');
    if (!editor) return;
    const content = String(editor.value || '');
    try {
        await API.post('/api/settings/file', { content });
        await loadConfig();
        await checkBackendStatus({ silent: true });
        showToast('settings.json 已保存', 'success');
    } catch (error) {
        showToast('settings.json 保存失败: ' + error.message, 'error');
    }
}

async function restoreSettingsJsonFile() {
    try {
        const res = await API.post('/api/settings/file/restore', {});
        await openSettingsJsonModal();
        await loadConfig();
        await checkBackendStatus({ silent: true });
        showToast(`已复原 settings.json（来源：${res.backup_path || 'backup'}）`, 'success');
    } catch (error) {
        showToast('复原失败: ' + error.message, 'error');
    }
}

async function openAuthJsonModal() {
    const modal = document.getElementById('auth-json-modal');
    const editor = document.getElementById('auth-json-editor');
    const pathEl = document.getElementById('auth-json-path');
    if (!modal || !editor || !pathEl) return;
    modal.classList.remove('hidden');
    editor.value = '';
    pathEl.innerText = '路径：读取中...';
    try {
        const res = await API.get('/api/auth/file');
        editor.value = String(res.content || '');
        pathEl.innerText = `路径：${res.path || '-'}`;
    } catch (error) {
        showToast('读取 auth.json 失败: ' + error.message, 'error');
        pathEl.innerText = '路径：读取失败';
    }
}

function closeAuthJsonModal() {
    const modal = document.getElementById('auth-json-modal');
    if (!modal) return;
    modal.classList.add('hidden');
}

async function saveAuthJsonFile() {
    const editor = document.getElementById('auth-json-editor');
    if (!editor) return;
    const content = String(editor.value || '');
    try {
        await API.post('/api/auth/file', { content });
        await loadConfig();
        await checkBackendStatus({ silent: true });
        showToast('auth.json 已保存', 'success');
    } catch (error) {
        showToast('auth.json 保存失败: ' + error.message, 'error');
    }
}

async function restoreAuthJsonFile() {
    try {
        const res = await API.post('/api/auth/file/restore', {});
        await openAuthJsonModal();
        await loadConfig();
        await checkBackendStatus({ silent: true });
        showToast(`已复原 auth.json（来源：${res.backup_path || 'backup'}）`, 'success');
    } catch (error) {
        showToast('复原失败: ' + error.message, 'error');
    }
}

function resolveEditableTarget(target) {
    const el = target && target.closest ? target.closest('input, textarea, [contenteditable="true"]') : null;
    return el || null;
}

function canPasteToTarget(target) {
    if (!target) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return !target.readOnly && !target.disabled;
    }
    return Boolean(target.isContentEditable);
}

function updateContextMenuActionState() {
    const menu = document.getElementById('personal-model-context-menu');
    if (!menu) return;
    const copyBtn = document.getElementById('personal-model-menu-copy');
    const pasteBtn = document.getElementById('personal-model-menu-paste');
    const cutBtn = document.getElementById('personal-model-menu-cut');
    const pinTopBtn = document.getElementById('personal-model-menu-pin-top');
    if (!copyBtn || !pasteBtn || !cutBtn || !pinTopBtn) return;

    const selectedText = String(window.getSelection ? window.getSelection().toString() : '').trim();
    const target = contextMenuEditableTarget;
    const hasTarget = Boolean(target);
    copyBtn.disabled = !hasTarget && !selectedText;
    cutBtn.disabled = !hasTarget;
    pasteBtn.disabled = !canPasteToTarget(target);
    pinTopBtn.classList.toggle('hidden', !personalModelContextTargetRow);
}

async function _copyText(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch (_) {
        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) {
            return false;
        }
    }
}

async function _readClipboardText() {
    try {
        const text = await navigator.clipboard.readText();
        return String(text || '');
    } catch (_) {
        return '';
    }
}

function _editableSelectionText(target) {
    if (!target) return '';
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const s = Number.isFinite(target.selectionStart) ? target.selectionStart : 0;
        const e = Number.isFinite(target.selectionEnd) ? target.selectionEnd : 0;
        if (e > s) return target.value.slice(s, e);
        return '';
    }
    if (target.isContentEditable && window.getSelection) {
        return String(window.getSelection().toString() || '');
    }
    return '';
}

async function handleContextMenuCopy() {
    let text = _editableSelectionText(contextMenuEditableTarget);
    if (!text) {
        text = String(window.getSelection ? window.getSelection().toString() : '');
    }
    if (!text) {
        showToast('没有可复制内容', 'error');
        return;
    }
    const ok = await _copyText(text);
    showToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
}

async function handleContextMenuCut() {
    const target = contextMenuEditableTarget;
    if (!target) {
        showToast('当前区域不支持剪切', 'error');
        return;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (target.readOnly || target.disabled) {
            showToast('当前区域不支持剪切', 'error');
            return;
        }
        const s = Number.isFinite(target.selectionStart) ? target.selectionStart : 0;
        const e = Number.isFinite(target.selectionEnd) ? target.selectionEnd : 0;
        const text = e > s ? target.value.slice(s, e) : '';
        if (!text) {
            showToast('请选择要剪切的内容', 'error');
            return;
        }
        const ok = await _copyText(text);
        if (!ok) {
            showToast('剪切失败', 'error');
            return;
        }
        target.setRangeText('', s, e, 'start');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        refreshModelListByContextRow(personalModelContextTargetRow);
        showToast('已剪切', 'success');
        return;
    }
    if (target.isContentEditable) {
        try {
            document.execCommand('cut');
            showToast('已剪切', 'success');
        } catch (_) {
            showToast('剪切失败', 'error');
        }
        return;
    }
    showToast('当前区域不支持剪切', 'error');
}

async function handleContextMenuPaste() {
    const target = contextMenuEditableTarget;
    if (!canPasteToTarget(target)) {
        showToast('当前区域不支持粘贴', 'error');
        return;
    }
    const text = await _readClipboardText();
    if (!text) {
        showToast('剪贴板为空或无权限', 'error');
        return;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const s = Number.isFinite(target.selectionStart) ? target.selectionStart : target.value.length;
        const e = Number.isFinite(target.selectionEnd) ? target.selectionEnd : target.value.length;
        target.setRangeText(text, s, e, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        refreshModelListByContextRow(personalModelContextTargetRow);
        showToast('已粘贴', 'success');
        return;
    }
    if (target.isContentEditable) {
        target.focus();
        try {
            document.execCommand('insertText', false, text);
            showToast('已粘贴', 'success');
        } catch (_) {
            showToast('粘贴失败', 'error');
        }
    }
}

function openPersonalModelContextMenu(event, context = {}) {
    const menu = document.getElementById('personal-model-context-menu');
    if (!menu) return;
    personalModelContextTargetRow = context.row || null;
    contextMenuEditableTarget = context.editable || resolveEditableTarget(event.target);
    menu.classList.remove('hidden');
    updateContextMenuActionState();

    const margin = 8;
    const menuWidth = menu.offsetWidth || 160;
    const menuHeight = menu.offsetHeight || 120;
    const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);
    const x = Math.min(Math.max(margin, event.clientX || 0), maxX);
    const y = Math.min(Math.max(margin, event.clientY || 0), maxY);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}

function closePersonalModelContextMenu() {
    const menu = document.getElementById('personal-model-context-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    personalModelContextTargetRow = null;
    contextMenuEditableTarget = null;
}

function refreshModelListByContextRow(row) {
    if (!row || !row.classList) return;
    if (row.classList.contains('doubao-model-row')) {
        syncDoubaoModelInlineDisplay();
        return;
    }
    if (row.classList.contains('personal-model-row')) {
        setPersonalModelsDirty(true);
        syncPersonalModelInlineDisplay();
    }
}

function renderEnginePickerComponent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'engine-picker';
    wrapper.innerHTML = `
        <button id="engine-picker-btn" class="engine-picker-btn glass-btn" type="button" title="切换模型供应商">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
              <rect x="9" y="9" width="6" height="6"></rect>
              <line x1="9" y1="1" x2="9" y2="4"></line>
              <line x1="15" y1="1" x2="15" y2="4"></line>
              <line x1="9" y1="20" x2="9" y2="23"></line>
              <line x1="15" y1="20" x2="15" y2="23"></line>
              <line x1="20" y1="9" x2="23" y2="9"></line>
              <line x1="20" y1="14" x2="23" y2="14"></line>
              <line x1="1" y1="9" x2="4" y2="9"></line>
              <line x1="1" y1="14" x2="4" y2="14"></line>
            </svg>
            <span>模型: ChatGPT</span>
        </button>
        <div id="engine-picker-menu" class="engine-picker-menu hidden glass-panel">
            <button type="button" data-engine="codex">ChatGPT</button>
            <button type="button" data-engine="gemini">Gemini</button>
            <button type="button" data-engine="claude">Claude</button>
            <button type="button" data-engine="doubao">Doubao</button>
            <button type="button" data-engine="personal">个人配置</button>
        </div>
    `;
    return wrapper;
}

function reattachEnginePickerListeners() {
    const enginePickerBtn = document.getElementById('engine-picker-btn');
    const enginePickerMenu = document.getElementById('engine-picker-menu');
    if (enginePickerBtn && enginePickerMenu) {
        enginePickerBtn.onclick = (e) => {
            e.stopPropagation();
            enginePickerMenu.classList.toggle('hidden');
        };

        enginePickerMenu.onclick = (e) => {
            const target = e.target.closest('button[data-engine]');
            if (!target) return;
            const mode = target.getAttribute('data-engine');
            setEngineMode(mode);
            enginePickerMenu.classList.add('hidden');
            const label = ENGINE_LABELS[mode] || 'ChatGPT';
            showToast(`已切换模型：${label}`, 'success');
        };

        if (!enginePickerGlobalListenersAttached) {
            enginePickerGlobalListenersAttached = true;
            document.addEventListener('click', (e) => {
                const menu = document.getElementById('engine-picker-menu');
                const btn = document.getElementById('engine-picker-btn');
                if (!menu || !btn || menu.classList.contains('hidden')) return;
                if (!menu.contains(e.target) && e.target !== btn) {
                    menu.classList.add('hidden');
                }
            });

            document.addEventListener('keydown', (e) => {
                const menu = document.getElementById('engine-picker-menu');
                if (e.key === 'Escape' && menu && !menu.classList.contains('hidden')) {
                    menu.classList.add('hidden');
                }
            });
        }
    }
}

// --- UI Logic ---

function setSelectValueWithFallback(selectEl, value, defaultValue = '') {
    if (!selectEl) return;
    if (!(selectEl instanceof HTMLSelectElement)) {
        const raw = String(value || '').trim();
        if (selectEl instanceof HTMLInputElement || selectEl instanceof HTMLTextAreaElement) {
            selectEl.value = raw || String(defaultValue || '');
        } else {
            selectEl.value = raw || String(defaultValue || '');
        }
        return;
    }
    const normalized = (value || '').trim();
    if (!normalized) {
        if (defaultValue && Array.from(selectEl.options).some(opt => opt.value === defaultValue)) {
            selectEl.value = defaultValue;
        } else if (selectEl.options.length > 0) {
            selectEl.selectedIndex = 0;
        }
        return;
    }
    const exists = Array.from(selectEl.options).some(opt => opt.value === normalized);
    if (!exists) {
        const option = document.createElement('option');
        option.value = normalized;
        option.textContent = normalized;
        selectEl.appendChild(option);
    }
    selectEl.value = normalized;
    refreshConfigSelectUI(selectEl);
}

function initConfigSelects() {
    document.querySelectorAll('select.config-select-btn').forEach((select) => {
        enhanceConfigSelect(select);
    });
    if (!configSelectGlobalListenersAttached) {
        configSelectGlobalListenersAttached = true;
        document.addEventListener('click', (e) => {
            const openMenu = document.querySelector('.config-select-menu:not(.hidden)');
            if (!openMenu) return;
            const wrapper = openMenu.closest('.config-select');
            if (wrapper && !wrapper.contains(e.target)) {
                openMenu.classList.add('hidden');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            document.querySelectorAll('.config-select-menu:not(.hidden)').forEach((menu) => {
                menu.classList.add('hidden');
            });
        });
    }
}

function enhanceConfigSelect(select) {
    if (!select || select.dataset.configSelectEnhanced === 'true') {
        refreshConfigSelectUI(select);
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'config-select';
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'config-select-btn';
    button.innerHTML = '<span class="config-select-label"></span>';
    wrapper.appendChild(button);

    const menu = document.createElement('div');
    menu.className = 'config-select-menu hidden glass-panel';
    wrapper.appendChild(menu);

    select.dataset.configSelectEnhanced = 'true';
    select._configSelect = { button, menu, wrapper };

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.config-select-menu:not(.hidden)').forEach((openMenu) => {
            if (openMenu !== menu) openMenu.classList.add('hidden');
        });
        menu.classList.toggle('hidden');
    });

    menu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-value]');
        if (!item) return;
        const value = item.getAttribute('data-value');
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        menu.classList.add('hidden');
    });

    select.addEventListener('change', () => refreshConfigSelectUI(select));

    refreshConfigSelectUI(select);
}

function refreshConfigSelectUI(select) {
    if (!select || select.dataset.configSelectEnhanced !== 'true') return;
    const ui = select._configSelect;
    if (!ui) return;

    const label = ui.button.querySelector('.config-select-label');
    const selectedOption = select.selectedOptions && select.selectedOptions[0];
    if (label) {
        label.textContent = selectedOption ? selectedOption.textContent : '';
    }

    ui.menu.innerHTML = '';
    Array.from(select.options || []).forEach((option) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'config-select-option';
        btn.textContent = option.textContent;
        btn.setAttribute('data-value', option.value);
        if (option.value === select.value) {
            btn.classList.add('active');
        }
        ui.menu.appendChild(btn);
    });
}

function normalizeEngineMode(mode) {
    return ['codex', 'gemini', 'claude', 'doubao', 'personal'].includes(mode) ? mode : 'codex';
}

function updateEnginePickerUI(mode) {
    const normalized = normalizeEngineMode(mode);
    const btn = document.getElementById('engine-picker-btn');
    if (btn) {
        const label = `模型: ${ENGINE_LABELS[normalized] || 'ChatGPT'}`;
        const span = btn.querySelector('span');
        if (span) {
            span.innerText = label;
        } else {
            btn.innerText = label;
        }
    }
    const menu = document.getElementById('engine-picker-menu');
    if (menu) {
        menu.querySelectorAll('button[data-engine]').forEach((button) => {
            button.classList.toggle('active', button.getAttribute('data-engine') === normalized);
        });
    }
}

function setEngineMode(mode) {
    const normalized = normalizeEngineMode(mode);
    const engineSelect = document.getElementById('engine-mode');
    if (engineSelect) {
        engineSelect.value = normalized;
    }
    toggleEngineFields(normalized);
    updateEnginePickerUI(normalized);
    if (normalized === 'personal') {
        openPersonalConfigModal();
    }
    checkBackendStatus({ silent: true });
}

function initUI() {
    // Theme Initialization
    const savedTheme = localStorage.getItem('theme') || 'auto';
    setTheme(savedTheme);

    // Sidebar
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        document.getElementById('app').classList.add('sidebar-collapsed');
    }

    // Theme Radio Listeners
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                setTheme(e.target.value);
            }
        });
    });

    // System Preference Listener
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem('theme') === 'auto') {
            applyThemeClass(e.matches ? 'dark' : 'light');
        }
    });
}

function initWriterSettings() {
    const speedInput = document.getElementById('typewriter-speed');
    const speedValue = document.getElementById('typewriter-speed-value');
    const enabledInput = document.getElementById('typewriter-enabled');
    const cacheEnabledInput = document.getElementById('cache-box-enabled');
    const stageTimelineEnabledInput = document.getElementById('stage-timeline-enabled');
    if (!speedInput || !speedValue || !enabledInput) return;

    const savedSpeed = parseInt(localStorage.getItem(TYPEWRITER_SPEED_KEY) || '', 10);
    const speed = Number.isFinite(savedSpeed) && savedSpeed > 0 ? savedSpeed : DEFAULT_TYPEWRITER_SPEED;
    const savedEnabled = localStorage.getItem(TYPEWRITER_ENABLED_KEY);
    const enabled = savedEnabled === null ? true : savedEnabled === 'true';

    speedInput.value = String(speed);
    enabledInput.checked = enabled;
    updateTypewriterSpeedLabel(speedValue, speed);
    applyCacheBoxVisibility(getCacheBoxEnabled());
    applyStageTimelineVisibility(getStageTimelineEnabled());
    if (cacheEnabledInput) {
        cacheEnabledInput.checked = getCacheBoxEnabled();
    }
    if (stageTimelineEnabledInput) {
        stageTimelineEnabledInput.checked = getStageTimelineEnabled();
    }

    speedInput.addEventListener('input', () => {
        const nextSpeed = parseInt(speedInput.value || '', 10);
        const value = Number.isFinite(nextSpeed) ? nextSpeed : DEFAULT_TYPEWRITER_SPEED;
        localStorage.setItem(TYPEWRITER_SPEED_KEY, String(value));
        updateTypewriterSpeedLabel(speedValue, value);
    });

    enabledInput.addEventListener('change', () => {
        localStorage.setItem(TYPEWRITER_ENABLED_KEY, String(enabledInput.checked));
    });

    if (cacheEnabledInput) {
        cacheEnabledInput.addEventListener('change', () => {
            setCacheBoxEnabled(cacheEnabledInput.checked);
        });
    }
    if (stageTimelineEnabledInput) {
        stageTimelineEnabledInput.addEventListener('change', () => {
            setStageTimelineEnabled(stageTimelineEnabledInput.checked);
        });
    }
}

function getCacheBoxEnabled() {
    const raw = localStorage.getItem(CACHE_BOX_ENABLED_KEY);
    if (raw === null) return true;
    return raw === 'true';
}

function setCacheBoxEnabled(enabled) {
    const value = Boolean(enabled);
    localStorage.setItem(CACHE_BOX_ENABLED_KEY, String(value));
    applyCacheBoxVisibility(value);
}

function applyCacheBoxVisibility(enabled) {
    const box = document.getElementById('cache-box');
    if (!box) return;
    box.classList.toggle('hidden', !enabled);

    const content = document.getElementById('cache-content');
    const headerTitle = document.querySelector('#cache-box .card-header h3 span');
    if (!enabled) {
        if (content) content.classList.add('hidden');
        if (headerTitle) headerTitle.textContent = '(已关闭)';
    } else if (headerTitle) {
        headerTitle.textContent = content && content.classList.contains('hidden')
            ? '(点击展开)'
            : '(点击收起)';
    }
}

function getStageTimelineEnabled() {
    const raw = localStorage.getItem(STAGE_TIMELINE_ENABLED_KEY);
    if (raw === null) return true;
    return raw === 'true';
}

function setStageTimelineEnabled(enabled) {
    const value = Boolean(enabled);
    localStorage.setItem(STAGE_TIMELINE_ENABLED_KEY, String(value));
    applyStageTimelineVisibility(value);
}

function applyStageTimelineVisibility(enabled) {
    const track = document.getElementById('generation-stage-track');
    if (!track) return;
    track.classList.toggle('hidden', !enabled);
}

function updateTypewriterSpeedLabel(labelEl, speed) {
    if (!labelEl) return;
    labelEl.innerText = `${speed}ms/字`;
}

function setTheme(mode) {
    // 1. Update Local Storage
    localStorage.setItem('theme', mode);

    // 2. Update UI (Radio Buttons)
    const radio = document.querySelector(`input[name="theme"][value="${mode}"]`);
    if (radio) radio.checked = true;

    // 3. Apply Theme
    if (mode === 'auto') {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyThemeClass(systemDark ? 'dark' : 'light');
    } else {
        applyThemeClass(mode);
    }
}

function applyThemeClass(mode) {
    if (mode === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    } else {
        document.body.removeAttribute('data-theme');
    }
}

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
    const cacheEnabledInput = document.getElementById('cache-box-enabled');
    const stageTimelineEnabledInput = document.getElementById('stage-timeline-enabled');
    if (cacheEnabledInput) {
        cacheEnabledInput.checked = getCacheBoxEnabled();
    }
    if (stageTimelineEnabledInput) {
        stageTimelineEnabledInput.checked = getStageTimelineEnabled();
    }
    const btn = document.getElementById('settings-btn');
    if (btn) btn.classList.add('active');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
    const btn = document.getElementById('settings-btn');
    if (btn) btn.classList.remove('active');
}

function openAssistSettingsModal() {
    const modal = document.getElementById('assist-settings-modal');
    if (modal) modal.classList.remove('hidden');
    const cacheEnabledInput = document.getElementById('cache-box-enabled');
    const stageTimelineEnabledInput = document.getElementById('stage-timeline-enabled');
    if (cacheEnabledInput) cacheEnabledInput.checked = getCacheBoxEnabled();
    if (stageTimelineEnabledInput) stageTimelineEnabledInput.checked = getStageTimelineEnabled();
}

function closeAssistSettingsModal() {
    const modal = document.getElementById('assist-settings-modal');
    if (modal) modal.classList.add('hidden');
}

function openAccessSettingsModal() {
    const modal = document.getElementById('access-settings-modal');
    if (modal) modal.classList.remove('hidden');
    updateEngineAccessFields();
}

function closeAccessSettingsModal() {
    const modal = document.getElementById('access-settings-modal');
    if (modal) modal.classList.add('hidden');
}

// Personal model config source-of-truth helpers moved to `static/js/personal_model.js`.

function _clearPersonalModelPressTimer() {
    if (personalModelPressTimer) {
        clearTimeout(personalModelPressTimer);
        personalModelPressTimer = null;
    }
}

function _clearPersonalModelPendingPress() {
    if (!personalModelPendingPress) return;
    window.removeEventListener('pointermove', _onPersonalModelHoldPointerMove, { passive: false });
    window.removeEventListener('pointerup', _onPersonalModelHoldPointerEnd);
    window.removeEventListener('pointercancel', _onPersonalModelHoldPointerEnd);
    personalModelPendingPress = null;
}

function _stopPersonalModelAutoscroll() {
    if (personalModelAutoscrollRaf) {
        cancelAnimationFrame(personalModelAutoscrollRaf);
        personalModelAutoscrollRaf = 0;
    }
    if (personalModelDragState) {
        personalModelDragState.autoscrollStep = 0;
    }
}

function _setPersonalModelAutoscrollStep(step) {
    if (!personalModelDragState) return;
    personalModelDragState.autoscrollStep = step;
    if (!step) {
        _stopPersonalModelAutoscroll();
        return;
    }
    if (personalModelAutoscrollRaf) return;
    const tick = () => {
        if (!personalModelDragState || !personalModelDragState.autoscrollStep) {
            personalModelAutoscrollRaf = 0;
            return;
        }
        const state = personalModelDragState;
        state.container.scrollTop += state.autoscrollStep;
        _updatePersonalModelPlaceholderByPointer(state.lastClientY);
        personalModelAutoscrollRaf = requestAnimationFrame(tick);
    };
    personalModelAutoscrollRaf = requestAnimationFrame(tick);
}

function _getPersonalModelOrderedNodes(container, includePlaceholder = true) {
    return Array.from(container.children).filter((el) => {
        if (el.classList.contains('personal-model-row')) return true;
        if (includePlaceholder && el.classList.contains('personal-model-placeholder')) return true;
        return false;
    });
}

function _placeholderOrderIndex(container, placeholder) {
    return _getPersonalModelOrderedNodes(container, true).indexOf(placeholder);
}

function _movePersonalPlaceholderToIndex(container, placeholder, targetIndex) {
    const rows = _getPersonalModelOrderedNodes(container, false);
    if (!rows.length) {
        container.appendChild(placeholder);
        return;
    }
    if (targetIndex <= 0) {
        container.insertBefore(placeholder, rows[0]);
        return;
    }
    if (targetIndex >= rows.length) {
        container.appendChild(placeholder);
        return;
    }
    container.insertBefore(placeholder, rows[targetIndex]);
}

function _updatePersonalModelPlaceholderByPointer(clientY) {
    const state = personalModelDragState;
    if (!state) return;
    const { container, placeholder } = state;
    const rows = _getPersonalModelOrderedNodes(container, false);
    if (!rows.length) {
        container.appendChild(placeholder);
        state.toIndex = 0;
        return;
    }

    let placed = false;
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        if (clientY < centerY) {
            if (placeholder !== row.previousElementSibling) {
                container.insertBefore(placeholder, row);
            }
            placed = true;
            break;
        }
    }
    if (!placed) {
        container.appendChild(placeholder);
    }
    state.toIndex = _placeholderOrderIndex(container, placeholder);
}

function _beginPersonalModelDesktopDrag(event, row) {
    if (personalModelDragState || !row) return;
    const container = row.closest('#personal-model-inputs, #doubao-model-inputs');
    if (!container) return;

    const rect = row.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.className = 'personal-model-placeholder';
    placeholder.style.height = `${rect.height}px`;
    container.insertBefore(placeholder, row);
    const fromIndex = _placeholderOrderIndex(container, placeholder);

    row.classList.add('dragging-current');
    row.style.width = `${rect.width}px`;
    row.style.left = `${rect.left}px`;
    row.style.top = `${rect.top}px`;
    row.style.position = 'fixed';
    row.style.zIndex = '3500';
    row.style.pointerEvents = 'none';

    container.classList.add('dragging-active');
    document.body.appendChild(row);

    personalModelDragState = {
        row,
        container,
        placeholder,
        pointerId: event.pointerId,
        offsetY: event.clientY - rect.top,
        fromIndex,
        toIndex: fromIndex,
        lastClientY: event.clientY,
        autoscrollStep: 0,
    };
    _updatePersonalModelPlaceholderByPointer(event.clientY);
}

function _finishPersonalModelDesktopDrag(commit = true) {
    _clearPersonalModelPressTimer();
    _stopPersonalModelAutoscroll();
    const state = personalModelDragState;
    personalModelDragState = null;
    if (!state) return;

    const { row, container, placeholder, fromIndex } = state;
    window.removeEventListener('pointermove', _onPersonalModelDragPointerMove, { passive: false });
    window.removeEventListener('pointerup', _onPersonalModelDragPointerUp);
    window.removeEventListener('pointercancel', _onPersonalModelDragCancel);
    window.removeEventListener('blur', _onPersonalModelDragCancel);

    if (!commit) {
        _movePersonalPlaceholderToIndex(container, placeholder, fromIndex);
    }

    const finalIndex = _placeholderOrderIndex(container, placeholder);
    container.insertBefore(row, placeholder);
    placeholder.remove();

    row.classList.remove('dragging-current');
    row.style.width = '';
    row.style.left = '';
    row.style.top = '';
    row.style.position = '';
    row.style.zIndex = '';
    row.style.pointerEvents = '';
    container.classList.remove('dragging-active');

    const isDoubaoContainer = container.id === 'doubao-model-inputs';
    if (commit && fromIndex !== finalIndex) {
        if (isDoubaoContainer) {
            syncDoubaoModelInlineDisplay();
        } else {
            setPersonalModelsDirty(true);
        }
    }
    if (isDoubaoContainer) {
        syncDoubaoModelInlineDisplay();
    } else {
        syncPersonalModelInlineDisplay();
    }
}

function _onPersonalModelDragPointerMove(event) {
    const state = personalModelDragState;
    if (!state) return;
    if (event.pointerId !== state.pointerId) return;
    event.preventDefault();

    state.lastClientY = event.clientY;
    state.row.style.top = `${event.clientY - state.offsetY}px`;
    _updatePersonalModelPlaceholderByPointer(event.clientY);

    const containerRect = state.container.getBoundingClientRect();
    const edge = PERSONAL_MODEL_AUTOSCROLL_EDGE_PX;
    let step = 0;
    if (event.clientY < containerRect.top + edge) {
        const ratio = Math.min(1, Math.max(0, (containerRect.top + edge - event.clientY) / edge));
        step = -Math.max(2, Math.round(PERSONAL_MODEL_AUTOSCROLL_MAX_STEP * ratio));
    } else if (event.clientY > containerRect.bottom - edge) {
        const ratio = Math.min(1, Math.max(0, (event.clientY - (containerRect.bottom - edge)) / edge));
        step = Math.max(2, Math.round(PERSONAL_MODEL_AUTOSCROLL_MAX_STEP * ratio));
    }
    _setPersonalModelAutoscrollStep(step);
}

function _onPersonalModelDragPointerUp(event) {
    const state = personalModelDragState;
    if (!state) {
        _clearPersonalModelPressTimer();
        return;
    }
    if (event.pointerId !== state.pointerId) return;
    _finishPersonalModelDesktopDrag(true);
}

function _onPersonalModelDragCancel(event) {
    const state = personalModelDragState;
    if (!state) {
        _clearPersonalModelPressTimer();
        return;
    }
    if (event && event.pointerId != null && event.pointerId !== state.pointerId) return;
    _finishPersonalModelDesktopDrag(false);
}

function _onPersonalModelHoldPointerMove(event) {
    const hold = personalModelPendingPress;
    if (!hold) return;
    if (event.pointerId !== hold.pointerId) return;
    const dx = Math.abs((event.clientX || 0) - hold.startX);
    const dy = Math.abs((event.clientY || 0) - hold.startY);
    if (dx > 6 || dy > 6) {
        _clearPersonalModelPressTimer();
        _clearPersonalModelPendingPress();
    }
}

function _onPersonalModelHoldPointerEnd(event) {
    const hold = personalModelPendingPress;
    if (!hold) return;
    if (event.pointerId !== hold.pointerId) return;
    _clearPersonalModelPressTimer();
    _clearPersonalModelPendingPress();
}

function _armPersonalModelDragOnHold(row, event, dragTarget) {
    _clearPersonalModelPressTimer();
    _clearPersonalModelPendingPress();
    personalModelPendingPress = {
        pointerId: event.pointerId,
        startX: event.clientX || 0,
        startY: event.clientY || 0,
    };
    window.addEventListener('pointermove', _onPersonalModelHoldPointerMove, { passive: false });
    window.addEventListener('pointerup', _onPersonalModelHoldPointerEnd);
    window.addEventListener('pointercancel', _onPersonalModelHoldPointerEnd);
    personalModelPressTimer = setTimeout(() => {
        _clearPersonalModelPendingPress();
        if (dragTarget && typeof dragTarget.blur === 'function') {
            dragTarget.blur();
        }
        _beginPersonalModelDesktopDrag(event, row);
        window.addEventListener('pointermove', _onPersonalModelDragPointerMove, { passive: false });
        window.addEventListener('pointerup', _onPersonalModelDragPointerUp);
        window.addEventListener('pointercancel', _onPersonalModelDragCancel);
        window.addEventListener('blur', _onPersonalModelDragCancel);
    }, PERSONAL_MODEL_DRAG_HOLD_MS);
}

function _releasePersonalModelHold() {
    _clearPersonalModelPressTimer();
    _clearPersonalModelPendingPress();
}

function _bindPersonalModelRowDnD(row, dragTarget) {
    if (!row || !dragTarget) return;
    dragTarget.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.pointerType && event.pointerType !== 'mouse') return;
        closePersonalModelContextMenu();
        _armPersonalModelDragOnHold(row, event, dragTarget);
    });
    dragTarget.addEventListener('pointerup', _releasePersonalModelHold);
    dragTarget.addEventListener('pointercancel', _releasePersonalModelHold);
    dragTarget.addEventListener('pointerleave', _releasePersonalModelHold);
}

function _appendPersonalModelInputRow(value = '') {
    const container = document.getElementById('personal-model-inputs');
    if (!container) return null;

    const row = document.createElement('div');
    row.className = 'personal-model-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-number-input personal-model-id-input';
    input.value = value;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn personal-model-remove-btn';
    removeBtn.title = '删除该模型';
    removeBtn.setAttribute('aria-label', '删除该模型');
    removeBtn.innerText = '×';

    row.appendChild(input);
    row.appendChild(removeBtn);
    container.appendChild(row);
    _bindPersonalModelRowDnD(row, input);
    return row;
}

function _renderPersonalModelInputs(models) {
    const container = document.getElementById('personal-model-inputs');
    if (!container) return;

    container.innerHTML = '';
    const normalizedModels = Array.isArray(models) && models.length
        ? models
        : ['deepseek-ai/deepseek-v3.2'];
    normalizedModels.forEach((model) => {
        _appendPersonalModelInputRow(model);
    });
}

function normalizeDoubaoModelsText(value) {
    const raw = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/,/g, '\n');
    const seen = new Set();
    const lines = [];
    raw.split('\n').forEach((line) => {
        const item = String(line || '').trim();
        if (!item) return;
        const key = item.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        lines.push(item);
    });
    if (!lines.length) {
        lines.push(...DEFAULT_DOUBAO_MODELS);
    }
    return lines.join('\n');
}

function parseDoubaoModels(value) {
    return normalizeDoubaoModelsText(value).split('\n').map(v => v.trim()).filter(Boolean);
}

function getDoubaoModelsText() {
    const inputs = Array.from(document.querySelectorAll('#doubao-model-inputs .doubao-model-id-input'));
    const raw = inputs.map((input) => String(input.value || '').trim()).filter(Boolean).join('\n');
    return normalizeDoubaoModelsText(raw);
}

function setDoubaoModelListSummary(count) {
    const summaryEl = document.getElementById('doubao-model-list-summary');
    if (!summaryEl) return;
    const safeCount = Number.isFinite(count) ? count : 0;
    summaryEl.innerText = `${safeCount} 个`;
}

function appendDoubaoModelInputRow(value = '') {
    const container = document.getElementById('doubao-model-inputs');
    if (!container) return null;
    const row = document.createElement('div');
    row.className = 'doubao-model-row personal-model-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-number-input doubao-model-id-input';
    input.value = value;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn doubao-model-remove-btn personal-model-remove-btn';
    removeBtn.title = '删除该模型';
    removeBtn.setAttribute('aria-label', '删除该模型');
    removeBtn.innerText = '×';

    row.appendChild(input);
    row.appendChild(removeBtn);
    container.appendChild(row);
    _bindPersonalModelRowDnD(row, input);
    return row;
}

function setDoubaoModelOptions(selectEl, models, preferred = '') {
    if (!selectEl) return '';
    const list = Array.isArray(models) && models.length ? models : [...DEFAULT_DOUBAO_MODELS];
    const selected = list.includes(preferred) ? preferred : list[0];
    selectEl.innerHTML = '';
    list.forEach((model) => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        selectEl.appendChild(option);
    });
    selectEl.value = selected;
    if (typeof refreshConfigSelectUI === 'function') {
        refreshConfigSelectUI(selectEl);
    }
    return selected;
}

function promoteDoubaoModelToTop(modelId) {
    const target = String(modelId || '').trim();
    if (!target) return false;
    const container = document.getElementById('doubao-model-inputs');
    if (!container) return false;
    const rows = Array.from(container.querySelectorAll('.doubao-model-row'));
    const row = rows.find((item) => {
        const input = item.querySelector('.doubao-model-id-input');
        return String(input?.value || '').trim() === target;
    });
    if (!row || container.firstElementChild === row) return false;
    container.insertBefore(row, container.firstElementChild);
    return true;
}

function setDoubaoModelConfig(modelsText, preferredModel = '', options = {}) {
    const container = document.getElementById('doubao-model-inputs');
    const detailsEl = document.getElementById('doubao-model-list-details');
    const inlineSelectEl = document.getElementById('doubao-model-select');
    const modalSelectEl = document.getElementById('doubao-model-modal-select');
    if (!container) return { model: '', modelsText: normalizeDoubaoModelsText(modelsText) };

    const models = parseDoubaoModels(modelsText);
    container.innerHTML = '';
    models.forEach((model) => appendDoubaoModelInputRow(model));

    const preferred = String(preferredModel || '').trim();
    const current = setDoubaoModelOptions(inlineSelectEl, models, preferred);
    setDoubaoModelOptions(modalSelectEl, models, current);
    setDoubaoModelListSummary(models.length);
    if (detailsEl && options && options.applyDefaultFold) {
        detailsEl.open = models.length <= 1;
    }
    return { model: current, modelsText: models.join('\n') };
}

function syncDoubaoModelInlineDisplay(preferredModel = '') {
    const inlineSelectEl = document.getElementById('doubao-model-select');
    const modalSelectEl = document.getElementById('doubao-model-modal-select');
    const models = parseDoubaoModels(getDoubaoModelsText());
    const preferred = String(preferredModel || '').trim();
    const current = setDoubaoModelOptions(inlineSelectEl, models, preferred);
    setDoubaoModelOptions(modalSelectEl, models, current);
    setDoubaoModelListSummary(models.length);
    return current;
}

function getDoubaoModelValue() {
    const models = parseDoubaoModels(getDoubaoModelsText());
    return models[0] || DEFAULT_DOUBAO_MODELS[0];
}

function openDoubaoConfigModal() {
    const modal = document.getElementById('doubao-config-modal');
    if (!modal) return;
    setDoubaoModelConfig(getDoubaoModelsText(), getDoubaoModelValue(), { applyDefaultFold: true });
    modal.classList.remove('hidden');
    const btn = document.getElementById('doubao-config-btn');
    if (btn) btn.classList.add('active');
}

function closeDoubaoConfigModal() {
    const modal = document.getElementById('doubao-config-modal');
    if (modal) modal.classList.add('hidden');
    const btn = document.getElementById('doubao-config-btn');
    if (btn) btn.classList.remove('active');
}

async function saveDoubaoConfigFromModal() {
    const applied = setDoubaoModelConfig(getDoubaoModelsText(), getDoubaoModelValue(), { applyDefaultFold: true });
    if (!applied.model) {
        showToast('请至少配置一个豆包模型 ID', 'error');
        return;
    }
    closeDoubaoConfigModal();
    await saveConfig();
}

// Personal model management logic moved to `static/js/personal_model.js`.

function toggleSidebar() {
    const app = document.getElementById('app');
    if (sidebarTransitionTimer) {
        clearTimeout(sidebarTransitionTimer);
        sidebarTransitionTimer = null;
    }
    app.classList.add('sidebar-transition');
    app.classList.toggle('sidebar-collapsed');
    const isCollapsed = app.classList.contains('sidebar-collapsed');
    const persist = () => localStorage.setItem('sidebarCollapsed', isCollapsed);
    sidebarTransitionTimer = setTimeout(() => {
        app.classList.remove('sidebar-transition');
        sidebarTransitionTimer = null;
    }, 200);
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(persist, { timeout: 500 });
    } else {
        setTimeout(persist, 0);
    }
}

// --- End UI Logic ---

function toggleEngineFields(mode) {
    const codexBox = document.getElementById('codex-settings');
    const geminiBox = document.getElementById('gemini-settings');
    const claudeBox = document.getElementById('claude-settings');
    const doubaoBox = document.getElementById('doubao-settings');
    const personalBox = document.getElementById('personal-settings');
    if (!codexBox || !geminiBox || !claudeBox || !doubaoBox || !personalBox) return;

    codexBox.classList.toggle('hidden', mode !== 'codex');
    geminiBox.classList.toggle('hidden', mode !== 'gemini');
    claudeBox.classList.toggle('hidden', mode !== 'claude');
    doubaoBox.classList.toggle('hidden', mode !== 'doubao');
    personalBox.classList.toggle('hidden', mode !== 'personal');
    updateEngineAccessFields();
}

function getEngineMode() {
    const engineSelect = document.getElementById('engine-mode');
    return engineSelect ? engineSelect.value : 'codex';
}

function _accessModeValue(selectId) {
    const el = document.getElementById(selectId);
    const val = String(el && el.value ? el.value : 'cli').trim().toLowerCase();
    return val === 'api' ? 'api' : 'cli';
}

function updateEngineAccessFields() {
    const codexApiKey = document.getElementById('codex-api-key-input');
    const geminiApiKey = document.getElementById('gemini-api-key-input');
    const claudeApiKey = document.getElementById('claude-api-key-input');
    if (codexApiKey) {
        const hide = _accessModeValue('codex-access-mode') !== 'api';
        codexApiKey.classList.toggle('hidden', hide);
        const row = codexApiKey.closest('.settings-row');
        if (row) row.classList.toggle('hidden', hide);
    }
    if (geminiApiKey) {
        const hide = _accessModeValue('gemini-access-mode') !== 'api';
        geminiApiKey.classList.toggle('hidden', hide);
        const row = geminiApiKey.closest('.settings-row');
        if (row) row.classList.toggle('hidden', hide);
    }
    if (claudeApiKey) {
        const hide = _accessModeValue('claude-access-mode') !== 'api';
        claudeApiKey.classList.toggle('hidden', hide);
        const row = claudeApiKey.closest('.settings-row');
        if (row) row.classList.toggle('hidden', hide);
    }
}

async function checkBackendStatus(options = {}) {
    const silent = Boolean(options && options.silent);
    try {
        const status = await API.get('/api/status');
        if (!status) return;
        updateToolbarStatusBar(status);
        renderModelHealthPanel(Array.isArray(status.model_health) ? status.model_health : []);
        if (status.engine_mode === 'gemini') {
            if (status.gemini_access_mode === 'api') {
                if (status.gemini_api_ready === false && !silent) {
                    showToast('Gemini API 模式未配置密钥，请填写 API Key 或设置 GEMINI_API_KEY', 'error');
                }
            } else if (status.gemini_available === false) {
                if (!silent) showToast('未检测到 gemini 可执行文件，请确保已安装并在 PATH 中', 'error');
            }
        } else if (status.engine_mode === 'claude') {
            if (status.claude_access_mode === 'api') {
                if (status.claude_api_ready === false && !silent) {
                    showToast('Claude API 模式未配置密钥，请填写 API Key 或设置 ANTHROPIC_API_KEY', 'error');
                }
            } else if (status.claude_available === false) {
                if (!silent) showToast('未检测到 claude 可执行文件，请确保已安装并在 PATH 中', 'error');
            }
        } else if (status.engine_mode === 'doubao') {
            if (status.doubao_ready === false) {
                if (!silent) showToast('豆包未配置密钥，请设置 DOUBAO_API_KEY 或 ARK_API_KEY', 'error');
            }
        } else if (status.engine_mode === 'personal') {
            if (status.personal_ready === false) {
                if (!silent) showToast('个人配置未完成，请填写 base url 与 api key', 'error');
            }
        } else if (status.codex_access_mode === 'api') {
            if (status.codex_api_ready === false && !silent) {
                showToast('ChatGPT API 模式未配置密钥，请填写 API Key 或设置 OPENAI_API_KEY', 'error');
            }
        } else if (status.codex_available === false) {
            if (!silent) showToast('未检测到 ChatGPT(codex) 可执行文件，请确保 codex 已安装并在 PATH 中', 'error');
        }
    } catch (error) {
        console.warn('Failed to load backend status', error);
    }
}

async function saveConfig() {
    const btn = document.getElementById('save-config-btn');
    const originalText = btn ? btn.innerText : '';
    if (btn) {
        btn.innerText = '保存中...';
        btn.disabled = true;
    }
    let ok = false;

    try {
        const config = collectCurrentConfig();
        await API.post('/api/config', config);
        setPersonalModelsDirty(false);
        showToast('配置已保存', 'success');
        ok = true;
    } catch (error) {
        showToast('保存配置失败', 'error');
    } finally {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }
    return ok;
}

async function saveSettingsModal() {
    const ok = await saveConfig();
    if (ok) {
        closeSettingsModal();
    }
}

function getProxyPortValue() {
    const el = document.getElementById('proxy-port-input');
    const raw = (el ? String(el.value || '') : '').trim();
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 65535) {
        return String(n);
    }
    return '10808';
}

async function syncProxyPortGlobal({ silent = false } = {}) {
    const port = getProxyPortValue();
    const input = document.getElementById('proxy-port-input');
    if (input) input.value = port;
    try {
        const res = await API.post('/api/config/proxy', { proxy_port: port });
        const applied = String((res || {}).proxy_port || port);
        if (input) input.value = applied;
        return applied;
    } catch (error) {
        if (!silent) {
            showToast('代理端口同步失败: ' + error.message, 'error');
        }
        return port;
    }
}

function collectCurrentConfig() {
    return {
        outline: document.getElementById('outline-input').value,
        reference: document.getElementById('reference-input').value,
        requirements: document.getElementById('requirements-input').value,
        extra_settings: document.getElementById('extra_settings-input').value,
        global_memory: document.getElementById('global_memory-input').value,
        engine_mode: getEngineMode(),
        codex_model: document.getElementById('codex-model-select').value,
        gemini_model: document.getElementById('gemini-model-select').value,
        claude_model: document.getElementById('claude-model-select').value,
        codex_access_mode: _accessModeValue('codex-access-mode'),
        gemini_access_mode: _accessModeValue('gemini-access-mode'),
        claude_access_mode: _accessModeValue('claude-access-mode'),
        codex_api_key: (document.getElementById('codex-api-key-input')?.value || '').trim(),
        gemini_api_key: (document.getElementById('gemini-api-key-input')?.value || '').trim(),
        claude_api_key: (document.getElementById('claude-api-key-input')?.value || '').trim(),
        codex_reasoning_effort: document.getElementById('codex-reasoning-select').value,
        gemini_reasoning_effort: document.getElementById('gemini-reasoning-select').value,
        claude_reasoning_effort: document.getElementById('claude-reasoning-select').value,
        doubao_reasoning_effort: document.getElementById('doubao-reasoning-select').value,
        doubao_models: getDoubaoModelsText(),
        doubao_model: getDoubaoModelValue(),
        personal_base_url: (document.getElementById('personal-base-url-input')?.value || '').trim(),
        personal_api_key: (document.getElementById('personal-api-key-input')?.value || '').trim(),
        personal_models: getPersonalModelsText(),
        personal_model: getPersonalModelValue(),
        proxy_port: getProxyPortValue()
    };
}

async function generateOutlineWithModel() {
    const btn = document.getElementById('outline-generate-confirm-btn');
    const cancelBtn = document.querySelector('#outline-modal .btn-danger');
    const overlay = document.getElementById('outline-loading-overlay');
    
    if (!btn) return;
    
    // Setup State
    outlineAbortController = new AbortController();
    outlinePaused = false;
    
    // UI Updates
    if (overlay) overlay.classList.remove('hidden');
    btn.innerHTML = '暂停'; 
    if (cancelBtn) cancelBtn.disabled = true; 
    
    btn.disabled = false;

    try {
        const payload = collectCurrentConfig();
        payload.outline = buildOutlineSeedFromModal();
        
        const res = await API.post('/api/outline/generate', payload, {
            signal: outlineAbortController.signal
        });
        
        const outlineInput = document.getElementById('outline-input');
        if (outlineInput && typeof res.outline === 'string') {
            outlineInput.value = res.outline;
        }
        
        closeOutlineModal();
        showToast('大纲生成完成', 'success');
    } catch (error) {
        if (error.name === 'AbortError') {
             // Handled in closeOutlineModal or silently ignored if aborted manually
        } else {
            showToast('生成大纲失败: ' + error.message, 'error');
            resetOutlineUI(); // Reset only on error, success handled by closeOutlineModal
        }
    }
}

function toggleOutlinePause() {
    const confirmBtn = document.getElementById('outline-generate-confirm-btn');
    const cancelBtn = document.querySelector('#outline-modal .btn-danger');
    const spinner = document.querySelector('#outline-loading-overlay .spinner');
    const loadingText = document.querySelector('#outline-loading-overlay .loading-text');
    
    if (outlinePaused) {
        // Resume
        outlinePaused = false;
        confirmBtn.innerHTML = '暂停';
        if (cancelBtn) cancelBtn.disabled = true;
        if (spinner) spinner.classList.remove('paused');
        if (loadingText) loadingText.textContent = '正在生成大纲...';
    } else {
        // Pause
        outlinePaused = true;
        confirmBtn.innerHTML = '继续';
        if (cancelBtn) cancelBtn.disabled = false;
        if (spinner) spinner.classList.add('paused');
        if (loadingText) loadingText.textContent = '已暂停生成大纲';
    }
}

async function submitOutlineGenerate() {
    if (outlineAbortController) {
        toggleOutlinePause();
    } else {
        if (!isOutlineFormValid()) {
            showToast('请先填写所有必填项', 'error');
            return;
        }
        await generateOutlineWithModel();
    }
}
function initOutlineModal() {
    const modal = document.getElementById('outline-modal');
    if (!modal) return;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeOutlineModal();
        }
    });

    OUTLINE_ALL_FIELD_IDS.forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('input', updateOutlineGenerateButtonState);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeOutlineModal();
        }
    });

    updateOutlineGenerateButtonState();
}

function openOutlineModal() {
    const modal = document.getElementById('outline-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const btn = document.getElementById('generate-outline-btn');
    if (btn) btn.classList.add('active');
    updateOutlineGenerateButtonState();
    const first = document.getElementById('outline-overall-flow');
    if (first) first.focus();
}

function closeOutlineModal() {
    if (outlineAbortController) {
        outlineAbortController.abort();
        showToast('已取消生成', 'info');
    }
    resetOutlineUI();
    const modal = document.getElementById('outline-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    const btn = document.getElementById('generate-outline-btn');
    if (btn) btn.classList.remove('active');
}

function resetOutlineUI() {
    const btn = document.getElementById('outline-generate-confirm-btn');
    const cancelBtn = document.querySelector('#outline-modal .btn-danger');
    const overlay = document.getElementById('outline-loading-overlay');
    
    if (overlay) overlay.classList.add('hidden');
    if (btn) {
        btn.innerHTML = '生成大纲';
        // Re-evaluate validation state
        updateOutlineGenerateButtonState(); 
    }
    if (cancelBtn) cancelBtn.disabled = false;
    
    outlineAbortController = null;
    outlinePaused = false;
}

function _outlineFieldValue(id) {
    const el = document.getElementById(id);
    return (el ? el.value : '').trim();
}

function isOutlineFormValid() {
    return OUTLINE_REQUIRED_FIELD_IDS.every((id) => Boolean(_outlineFieldValue(id)));
}

function updateOutlineGenerateButtonState() {
    if (outlineAbortController) return;
    const btn = document.getElementById('outline-generate-confirm-btn');
    if (!btn) return;
    btn.disabled = !isOutlineFormValid();
}

function buildOutlineSeedFromModal() {
    const sections = [];

    const pushField = (label, value, force = false) => {
        const v = String(value || '').trim();
        if (!v && !force) return;
        sections.push(`${label}：${v || '无'}`);
    };

    sections.push('请基于以下信息，生成可执行、可分章创作的长篇小说大纲。');
    sections.push('');
    sections.push('【小说框架】');
    pushField('总体流程', _outlineFieldValue('outline-overall-flow'), true);
    pushField('主要卖点', _outlineFieldValue('outline-selling-points'));
    pushField('关键事件', _outlineFieldValue('outline-key-events'));
    pushField('故事节奏', _outlineFieldValue('outline-story-pace'));
    sections.push('');
    sections.push('【主要世界观】');
    pushField('世界观描述', _outlineFieldValue('outline-worldview'), true);
    sections.push('');
    sections.push('【核心人物设定】');
    pushField('主角性格标签', _outlineFieldValue('outline-protagonist-tags'), true);
    pushField('角色动机与欲望', _outlineFieldValue('outline-motivation'));
    pushField('人物关系图谱', _outlineFieldValue('outline-relations'));
    pushField('反派的描绘', _outlineFieldValue('outline-antagonist'));
    pushField('重要伏笔', _outlineFieldValue('outline-foreshadowing'));
    sections.push('');
    sections.push('【输出控制参数】');
    pushField('预期字数', _outlineFieldValue('outline-target-words'), true);
    pushField('结局偏好', _outlineFieldValue('outline-ending-pref'), true);

    return sections.join('\n');
}



async function loadConfig() {
    try {
        const config = await API.get('/api/config');
        if (config) {
            document.getElementById('outline-input').value = config.outline || '';
            document.getElementById('reference-input').value = config.reference || '';
            document.getElementById('requirements-input').value = config.requirements || '';
            document.getElementById('extra_settings-input').value = config.extra_settings || '';
            const memoryInput = document.getElementById('global_memory-input');
            if (memoryInput) memoryInput.value = config.global_memory || '';
            const engineSelect = document.getElementById('engine-mode');
            if (engineSelect) {
                const mode = (config.engine_mode === 'gemini' || config.engine_mode === 'codex' || config.engine_mode === 'claude' || config.engine_mode === 'doubao' || config.engine_mode === 'personal')
                    ? config.engine_mode
                    : 'codex';
                engineSelect.value = mode;
                toggleEngineFields(engineSelect.value);
                updateEnginePickerUI(engineSelect.value);
            }
            const codexModel = document.getElementById('codex-model-select');
            setSelectValueWithFallback(codexModel, config.codex_model || '');
            const geminiModel = document.getElementById('gemini-model-select');
            setSelectValueWithFallback(geminiModel, config.gemini_model || '');
            const claudeModel = document.getElementById('claude-model-select');
            setSelectValueWithFallback(claudeModel, config.claude_model || '');
            const codexAccess = document.getElementById('codex-access-mode');
            setSelectValueWithFallback(codexAccess, config.codex_access_mode || 'cli', 'cli');
            const geminiAccess = document.getElementById('gemini-access-mode');
            setSelectValueWithFallback(geminiAccess, config.gemini_access_mode || 'cli', 'cli');
            const claudeAccess = document.getElementById('claude-access-mode');
            setSelectValueWithFallback(claudeAccess, config.claude_access_mode || 'cli', 'cli');
            const codexApiKeyInput = document.getElementById('codex-api-key-input');
            if (codexApiKeyInput) codexApiKeyInput.value = config.codex_api_key || '';
            const geminiApiKeyInput = document.getElementById('gemini-api-key-input');
            if (geminiApiKeyInput) geminiApiKeyInput.value = config.gemini_api_key || '';
            const claudeApiKeyInput = document.getElementById('claude-api-key-input');
            if (claudeApiKeyInput) claudeApiKeyInput.value = config.claude_api_key || '';
            setDoubaoModelConfig(
                config.doubao_models || config.doubao_model || DEFAULT_DOUBAO_MODELS.join('\n'),
                config.doubao_model || '',
                { applyDefaultFold: true }
            );
            const codexReasoning = document.getElementById('codex-reasoning-select');
            setSelectValueWithFallback(codexReasoning, config.codex_reasoning_effort || 'medium', 'medium');
            const geminiReasoning = document.getElementById('gemini-reasoning-select');
            setSelectValueWithFallback(geminiReasoning, config.gemini_reasoning_effort || 'medium', 'medium');
            const claudeReasoning = document.getElementById('claude-reasoning-select');
            setSelectValueWithFallback(claudeReasoning, config.claude_reasoning_effort || 'medium', 'medium');
            const doubaoReasoning = document.getElementById('doubao-reasoning-select');
            setSelectValueWithFallback(doubaoReasoning, config.doubao_reasoning_effort || 'medium', 'medium');
            const personalBaseUrlInput = document.getElementById('personal-base-url-input');
            if (personalBaseUrlInput) {
                personalBaseUrlInput.value = config.personal_base_url || '';
            }
            const personalApiKeyInput = document.getElementById('personal-api-key-input');
            if (personalApiKeyInput) {
                personalApiKeyInput.value = config.personal_api_key || '';
            }
            setPersonalModelConfig(
                config.personal_models || config.personal_model || 'deepseek-ai/deepseek-v3.2',
                config.personal_model || '',
                { applyDefaultFold: true },
            );
            setPersonalModelsDirty(false);
            updatePersonalConfigStatus();
            const proxyPortInput = document.getElementById('proxy-port-input');
            if (proxyPortInput) {
                proxyPortInput.value = config.proxy_port || '10808';
            }
            updateEngineAccessFields();

            updateCacheDisplayFromDraftText(getDraftEditorText() || (config.cache || ''));
            applyCacheBoxVisibility(getCacheBoxEnabled());
            applyStageTimelineVisibility(getStageTimelineEnabled());
            if (Array.isArray(config.books)) {
                latestBookshelf = {
                    books: config.books,
                    active_book: config.active_book || {},
                    active_book_id: (config.active_book || {}).id || '',
                    active_paths: config.book_paths || {},
                };
                renderBookshelf(latestBookshelf);
                const tip = document.getElementById('bookshelf-tip');
                if (tip) {
                    const root = String((config.book_paths || {}).root_dir || '');
                    tip.innerText = root
                        ? `当前书籍目录：${root}。本书的大纲、参考、缓存、章节、草稿都会单独保存在这里。`
                        : '每本书会在独立文件夹中保存：大纲、参考、缓存、章节、草稿都会单独隔离。';
                }
            }
            enforceFirstRunBookCreation(config);
        }
    } catch (error) {
        console.error('Failed to load config', error);
    }
}

function toggleCache() {
    if (!getCacheBoxEnabled()) {
        return;
    }
    const content = document.getElementById('cache-content');
    if (!content) return;
    content.classList.toggle('hidden');
    
    // Optional: Update title hint
    const headerTitle = document.querySelector('#cache-box .card-header h3 span');
    if (headerTitle) {
        if (content.classList.contains('hidden')) {
            headerTitle.textContent = '(点击展开)';
        } else {
            headerTitle.textContent = '(点击收起)';
        }
    }
}

async function loadDraft() {
    try {
        const data = await API.get('/api/draft');
        const content = (data && typeof data.content === 'string') ? data.content : '';
        updateDraftDisplay(content);
        updateCacheDisplayFromDraftText(content);
    } catch (error) {
        console.error('Failed to load draft', error);
    }
}

function updateDraftCharCountBadge(text) {
    const badge = document.getElementById('draft-char-count');
    if (!badge) return;
    const raw = String(text || '');
    const normalized = raw.replace(/\u00a0/g, ' ').trim();
    const count = normalized ? raw.length : 0;
    badge.innerText = `${count}字`;
}

function applyDraftEditLockByText(text) {
    const draftEl = document.getElementById('draft-content');
    if (!draftEl) return;
    const hasContent = String(text || '').replace(/\u00a0/g, ' ').trim().length > 0;
    draftEl.contentEditable = hasContent ? 'true' : 'false';
    draftEl.classList.toggle('draft-readonly', !hasContent);
}

function toggleDiscardedPanel() {
    const panel = document.getElementById('discarded-drafts-panel');
    if (!panel) return;
    const isHidden = panel.classList.toggle('hidden');
    const btn = document.getElementById('discarded-toggle-btn');
    if (btn) {
        btn.classList.toggle('active', !isHidden);
    }
    if (!isHidden) {
        loadDiscardedDrafts();
    }
}

async function loadDiscardedDrafts() {
    const listEl = document.getElementById('discarded-drafts-list');
    const countEl = document.getElementById('discarded-count-text');
    if (!listEl || !countEl) return;

    try {
        const data = await API.get('/api/discarded');
        const items = Array.isArray(data.items) ? data.items : [];
        countEl.innerText = `${items.length} 条`;

        if (!items.length) {
            listEl.innerHTML = '<div class="discarded-empty">（暂无废弃稿件）</div>';
            return;
        }

        listEl.innerHTML = items.map((item) => {
            const id = Number(item.id || 0);
            const content = String(item.content || '');
            const title = content.replace(/\s+/g, ' ').trim().slice(0, 36) || `稿件 #${id}`;
            const meta = `${item.created_at || ''} · ${Number(item.char_count || 0)}字`;
            return `
                <details class="discarded-item" data-id="${id}">
                    <summary>
                        <span class="discarded-item-title">${_escapeHtml(title)}</span>
                        <span class="discarded-item-meta">${_escapeHtml(meta)}</span>
                    </summary>
                    <div class="discarded-item-content">
                        <pre class="discarded-item-text">${_escapeHtml(content)}</pre>
                        <div class="discarded-item-actions">
                            <button class="btn btn-success btn-sm" onclick="restoreDiscardedDraft(${id})">复原</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteDiscardedDraft(${id})">删除</button>
                        </div>
                    </div>
                </details>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to load discarded drafts', error);
        listEl.innerHTML = '<div class="discarded-empty">加载失败</div>';
    }
}

function _escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function restoreDiscardedDraft(id) {
    try {
        if (typeof hardStopWritingForRestore === 'function') {
            await hardStopWritingForRestore();
        }

        const res = await API.post('/api/discarded/restore', { id });
        const content = String((res && res.content) || '');
        if (!content) {
            showToast('复原失败：内容为空', 'error');
            return;
        }
        if (typeof restoreGeneratedFromDiscarded === 'function') {
            restoreGeneratedFromDiscarded(content);
        } else {
            const gen = document.getElementById('generated-content');
            if (gen) gen.innerText = content;
            const actions = document.getElementById('gen-actions');
            if (actions) actions.classList.remove('hidden');
        }
        await loadDiscardedDrafts();
        showToast('已复原废弃稿件', 'success');
    } catch (error) {
        showToast('复原失败: ' + error.message, 'error');
    }
}

async function deleteDiscardedDraft(id) {
    try {
        await API.delete(`/api/discarded/${id}`);
        await loadDiscardedDrafts();
        showToast('已删除废弃稿件', 'success');
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

function getDraftEditorText() {
    const draftEl = document.getElementById('draft-content');
    return draftEl ? (draftEl.innerText || '') : '';
}

function buildCacheTextFromDraft(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    if (!normalized) return '';
    if (normalized.length <= 400) return normalized;
    return normalized.slice(-DRAFT_CACHE_TAIL_CHARS);
}

function updateCacheDisplayFromDraftText(text) {
    const cacheText = document.getElementById('cache-text');
    if (!cacheText) return;
    const summary = buildCacheTextFromDraft(text);
    cacheText.textContent = summary || '（暂无缓存内容）';
}

function scheduleDraftAutosave(content) {
    if (draftAutosaveTimer) {
        clearTimeout(draftAutosaveTimer);
    }
    draftAutosaveTimer = setTimeout(async () => {
        try {
            await API.post('/api/draft/save', { content: content || '' });
        } catch (error) {
            console.warn('Draft autosave failed', error);
        }
    }, 500);
}

async function handleFileImport(target) {
    const fileInput = document.getElementById(`file-${target}`);
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('target', target);

    try {
        const response = await fetch('/api/upload-file', { method: 'POST', body: formData });
        if (response.ok) {
            const data = await response.json();
            const textarea = document.getElementById(`${target}-input`);
            if (textarea) { textarea.value = data.content; }
            showToast('文件导入成功', 'success');
        } else {
            const err = await response.json().catch(() => ({}));
            showToast(err.message || '文件导入失败', 'error');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showToast('文件导入失败', 'error');
    } finally {
        fileInput.value = '';
    }
}

function showToast(message, type = 'success') {
    if (type === 'error') {
        addInfoBoxItem(message);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}
