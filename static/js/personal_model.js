(function () {
    let personalModelsDirty = false;
    const DEFAULT_MODEL = 'deepseek-ai/deepseek-v3.2';

    function _normalizePersonalModelsText(value) {
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
            lines.push(DEFAULT_MODEL);
        }
        return lines.join('\n');
    }

    function _parsePersonalModels(value) {
        return _normalizePersonalModelsText(value).split('\n').map(v => v.trim()).filter(Boolean);
    }

    function getPersonalModelsText() {
        const modelInputs = Array.from(document.querySelectorAll('#personal-model-inputs .personal-model-id-input'));
        const raw = modelInputs.map((input) => String(input.value || '').trim()).filter(Boolean).join('\n');
        return _normalizePersonalModelsText(raw);
    }

    function _setPersonalModelOptions(selectEl, models, selectedModel) {
        if (!selectEl) return '';
        const normalizedModels = Array.isArray(models) && models.length
            ? models
            : [DEFAULT_MODEL];
        const preferred = String(selectedModel || '').trim();
        const nextValue = normalizedModels.includes(preferred) ? preferred : normalizedModels[0];

        selectEl.innerHTML = '';
        normalizedModels.forEach((model) => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            selectEl.appendChild(option);
        });
        selectEl.value = nextValue;
        if (typeof window.refreshConfigSelectUI === 'function') {
            window.refreshConfigSelectUI(selectEl);
        }
        return nextValue;
    }

    function _setPersonalModelListSummary(count) {
        const summaryEl = document.getElementById('personal-model-list-summary');
        if (!summaryEl) return;
        const safeCount = Number.isFinite(count) ? count : 0;
        summaryEl.innerText = `${safeCount} 个`;
    }

    function _setPersonalModelListDefaultFold(models) {
        const detailsEl = document.getElementById('personal-model-list-details');
        if (!detailsEl) return;
        const count = Array.isArray(models) ? models.length : 0;
        detailsEl.open = count <= 1;
    }

    function _promotePersonalModelToTop(modelId) {
        const target = String(modelId || '').trim();
        if (!target) return false;
        const container = document.getElementById('personal-model-inputs');
        if (!container) return false;
        const rows = Array.from(container.querySelectorAll('.personal-model-row'));
        const row = rows.find((item) => {
            const input = item.querySelector('.personal-model-id-input');
            return String(input?.value || '').trim() === target;
        });
        if (!row || container.firstElementChild === row) return false;
        container.insertBefore(row, container.firstElementChild);
        return true;
    }

    function getPersonalModelValue() {
        const models = _parsePersonalModels(getPersonalModelsText());
        return models[0] || DEFAULT_MODEL;
    }

    function _hasPersonalModelInputValue() {
        const inputs = Array.from(document.querySelectorAll('#personal-model-inputs .personal-model-id-input'));
        return inputs.some((input) => String(input.value || '').trim().length > 0);
    }

    function updatePersonalConfigSaveButtonState() {
        const saveBtn = document.getElementById('personal-config-save-btn');
        if (!saveBtn) return;
        const baseUrl = (document.getElementById('personal-base-url-input')?.value || '').trim();
        const apiKey = (document.getElementById('personal-api-key-input')?.value || '').trim();
        const hasModel = _hasPersonalModelInputValue();
        saveBtn.disabled = !(baseUrl && apiKey && hasModel);
    }

    function setPersonalModelConfig(modelsText, preferredModel = '', options = {}) {
        const normalizedText = _normalizePersonalModelsText(modelsText);
        const models = _parsePersonalModels(normalizedText);
        const engineSelect = document.getElementById('personal-model-select');
        const modalSelect = document.getElementById('personal-model-modal-select');
        const selected = models[0] || 'deepseek-ai/deepseek-v3.2';

        if (typeof window._renderPersonalModelInputs === 'function') {
            window._renderPersonalModelInputs(models);
        }
        const normalizedModels = _parsePersonalModels(getPersonalModelsText());
        const model = _setPersonalModelOptions(engineSelect, normalizedModels, selected);
        _setPersonalModelOptions(modalSelect, normalizedModels, model);
        _setPersonalModelListSummary(normalizedModels.length);

        if (options && options.applyDefaultFold) {
            _setPersonalModelListDefaultFold(normalizedModels);
        }

        return { model, modelsText: normalizedText };
    }

    function syncPersonalModelInlineDisplay(preferredModel = '') {
        const models = _parsePersonalModels(getPersonalModelsText());
        const engineSelect = document.getElementById('personal-model-select');
        const modalSelect = document.getElementById('personal-model-modal-select');
        const selected = models[0] || DEFAULT_MODEL;
        const model = _setPersonalModelOptions(engineSelect, models, selected);
        _setPersonalModelOptions(modalSelect, models, model);
        _setPersonalModelListSummary(models.length);
        updatePersonalConfigSaveButtonState();
    }

    function setPersonalModelsDirty(dirty) {
        personalModelsDirty = Boolean(dirty);
        const btn = document.getElementById('save-config-btn');
        if (!btn) return;
        btn.classList.toggle('dirty', personalModelsDirty);
    }

    function updatePersonalConfigStatus() {
        const baseUrl = (document.getElementById('personal-base-url-input')?.value || '').trim();
        const apiKey = (document.getElementById('personal-api-key-input')?.value || '').trim();
        const statusEl = document.getElementById('personal-config-status');
        if (!statusEl) return;
        const ready = Boolean(baseUrl && apiKey && _hasPersonalModelInputValue());
        statusEl.innerText = ready ? '已配置' : '未配置';
        statusEl.classList.toggle('ready', ready);
        updatePersonalConfigSaveButtonState();
    }

    function openPersonalConfigModal() {
        const modal = document.getElementById('personal-config-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        const btn = document.getElementById('personal-config-btn');
        if (btn) btn.classList.add('active');
        setPersonalModelConfig(getPersonalModelsText(), getPersonalModelValue(), { applyDefaultFold: true });
        updatePersonalConfigStatus();
        updatePersonalConfigSaveButtonState();
    }

    function closePersonalConfigModal() {
        if (typeof window.closePersonalModelContextMenu === 'function') {
            window.closePersonalModelContextMenu();
        }
        const modal = document.getElementById('personal-config-modal');
        if (modal) modal.classList.add('hidden');
        const btn = document.getElementById('personal-config-btn');
        if (btn) btn.classList.remove('active');
    }

    async function savePersonalConfigFromModal() {
        const baseUrlInput = document.getElementById('personal-base-url-input');
        const apiKeyInput = document.getElementById('personal-api-key-input');
        const baseUrl = (baseUrlInput ? baseUrlInput.value : '').trim();
        const apiKey = (apiKeyInput ? apiKeyInput.value : '').trim();
        const hasModel = _hasPersonalModelInputValue();
        if (!baseUrl || !apiKey || !hasModel) {
            if (typeof window.showToast === 'function') {
                window.showToast('请填写模型 ID、base url 与 api key', 'error');
            }
            return;
        }
        const applied = setPersonalModelConfig(getPersonalModelsText(), getPersonalModelValue());
        if (!applied.model) {
            if (typeof window.showToast === 'function') {
                window.showToast('请至少配置一个模型 ID', 'error');
            }
            return;
        }
        updatePersonalConfigStatus();
        closePersonalConfigModal();
        if (typeof window.saveConfig === 'function') {
            await window.saveConfig();
        }
    }

    window._normalizePersonalModelsText = _normalizePersonalModelsText;
    window._parsePersonalModels = _parsePersonalModels;
    window._promotePersonalModelToTop = _promotePersonalModelToTop;
    window.getPersonalModelsText = getPersonalModelsText;
    window.getPersonalModelValue = getPersonalModelValue;
    window.setPersonalModelConfig = setPersonalModelConfig;
    window.syncPersonalModelInlineDisplay = syncPersonalModelInlineDisplay;
    window.setPersonalModelsDirty = setPersonalModelsDirty;
    window.updatePersonalConfigStatus = updatePersonalConfigStatus;
    window.updatePersonalConfigSaveButtonState = updatePersonalConfigSaveButtonState;
    window.openPersonalConfigModal = openPersonalConfigModal;
    window.closePersonalConfigModal = closePersonalConfigModal;
    window.savePersonalConfigFromModal = savePersonalConfigFromModal;
})();
