async function splitChapter() {
    const currentDraft = document.getElementById('draft-content').innerText;
    if (!currentDraft || currentDraft.length < 10) {
        showToast('草稿内容太少，无法分章', 'error');
        return;
    }

    const btn = document.getElementById('split-chapter-btn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '生成标题中...';
    btn.classList.add('loading');

    try {
        // 1. 生成标题
        const response = await API.post('/api/chapter/generate-title', { content: currentDraft });
        const generatedTitle = response.title || '新章节';

        // 2. 显示弹窗
        showTitleModal(generatedTitle, async (confirmedTitle) => {
             // 4. 用户确认保存
            btn.disabled = true; 
            btn.innerText = '保存中...';
            btn.classList.add('loading');
            
            const loadingOverlay = document.getElementById('draft-loading-overlay');
            if (loadingOverlay) {
                const span = loadingOverlay.querySelector('span');
                if (span) span.innerText = '正在保存，并进行记忆/连贯性校验...';
                loadingOverlay.classList.remove('hidden');
            }

            try {
                const memoryInput = document.getElementById('global_memory-input');
                const oldMemory = memoryInput ? memoryInput.value : '';

                const result = await API.post('/api/chapter/save', {
                    content: currentDraft,
                    title: confirmedTitle
                });
                
                if (memoryInput && typeof result.global_memory === 'string') {
                    memoryInput.value = result.global_memory;
                }

                if (result.memory_updated) {
                    // Calculate diff
                    const diff = diffMemories(oldMemory, result.global_memory);
                    const updateCount = diff.added.length + diff.replaced.length;
                    
                    showToast(`分章保存成功，已更新 ${updateCount} 条记忆`, 'success');
                    
                    // Show modal and highlight
                    showMemoryPreviewModal(diff);
                    highlightMemoryChanges(result.global_memory, diff);
                } else {
                    showToast('分章保存成功！', 'success');
                }
                
                if (result.memory_error) {
                    showToast('全局记忆同步失败：' + result.memory_error, 'warning');
                }

                if (result.consistency_checked) {
                    const conflicts = Array.isArray(result.consistency_conflicts) ? result.consistency_conflicts : [];
                    if (result.consistency_has_conflicts && conflicts.length > 0) {
                        showToast(`检测到 ${conflicts.length} 处连贯性冲突`, 'warning');
                        showConsistencyModal({
                            summary: result.consistency_summary || '',
                            conflicts
                        });
                    } else {
                        showToast('连贯性校验通过', 'success');
                    }
                } else if (result.consistency_error) {
                    showToast('连贯性校验失败：' + result.consistency_error, 'warning');
                }

                updateDraftDisplay('');
            } catch (error) {
                 showToast('保存失败: ' + error.message, 'error');
            } finally {
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
                btn.disabled = false;
                btn.innerText = originalText;
                btn.classList.remove('loading');
            }
        });

    } catch (error) {
        showToast('生成标题失败: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
        btn.classList.remove('loading');
    }
}

function showTitleModal(initialTitle, onConfirm) {
    const modal = document.getElementById('title-modal');
    const input = document.getElementById('chapter-title-input');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    input.value = initialTitle;
    modal.classList.remove('hidden');
    input.focus();

    const closeModal = () => {
        modal.classList.add('hidden');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        document.removeEventListener('keydown', handleEsc);
    };

    const handleConfirm = () => {
        const title = input.value.trim();
        if (!title) {
            showToast('标题不能为空', 'error');
            return;
        }
        closeModal();
        onConfirm(title);
    };

    const handleEsc = (e) => {
        if (e.key === 'Escape') closeModal();
    };

    confirmBtn.onclick = handleConfirm;
    cancelBtn.onclick = closeModal;
    document.addEventListener('keydown', handleEsc);
}

// --- Global Memory Helper Functions ---

function parseMemory(text) {
    const lines = (text || '').split('\n');
    const map = new Map();
    const items = [];

    // Regex matching python: ^\s*([^|｜]+)\s*[|｜]\s*([^|｜]+)\s*[|｜]\s*(.+?)\s*$
    const regex = /^\s*([^|｜]+)\s*[|｜]\s*([^|｜]+)\s*[|｜]\s*(.+?)\s*$/;

    lines.forEach((line, index) => {
        const match = line.match(regex);
        if (match) {
            const type = match[1].trim();
            const name = match[2].trim();
            const summary = match[3].trim();
            const key = type + '|' + name;
            const item = { key, type, name, summary, line, raw: line };
            map.set(key, item);
            items.push(item);
        } else if (line.trim()) {
            // Keep track of non-matching lines if needed, or ignore
            items.push({ key: null, line, raw: line });
        }
    });
    return { map, items };
}

function diffMemories(oldText, newText) {
    const oldMem = parseMemory(oldText);
    const newMem = parseMemory(newText);
    
    const added = [];
    const replaced = [];
    const unchanged = [];
    const seenKeys = new Set();

    newMem.items.forEach(item => {
        if (!item.key) return; // Skip raw lines
        seenKeys.add(item.key);

        const oldItem = oldMem.map.get(item.key);
        if (!oldItem) {
            added.push(item);
        } else if (oldItem.summary !== item.summary) {
            item.oldSummary = oldItem.summary;
            replaced.push(item);
        } else {
            unchanged.push(item);
        }
    });

    return { added, replaced, unchanged };
}

function showMemoryPreviewModal(diff) {
    const modal = document.getElementById('memory-preview-modal');
    const list = document.getElementById('memory-change-list');
    const statAdded = document.getElementById('mem-stat-added');
    const statReplaced = document.getElementById('mem-stat-replaced');
    const statUnchanged = document.getElementById('mem-stat-unchanged');

    // Update stats
    statAdded.innerText = diff.added.length;
    statReplaced.innerText = diff.replaced.length;
    statUnchanged.innerText = diff.unchanged.length;

    // Build list HTML
    let html = '';
    
    // Helper to create item HTML
    const createItem = (item, type, label, oldSum = null) => {
        const oldHtml = oldSum ? `<div class="diff-old">${escapeHtml(oldSum)}</div>` : '';
        return `
            <div class="memory-change-item">
                <div><span class="change-tag tag-${type}">${label}</span></div>
                <div class="change-content">
                    <div class="change-key">${escapeHtml(item.type)} | ${escapeHtml(item.name)}</div>
                    <div class="change-diff">
                        ${oldHtml}
                        <div class="diff-new">${escapeHtml(item.summary)}</div>
                    </div>
                </div>
            </div>
        `;
    };

    diff.added.forEach(item => html += createItem(item, 'added', '新增'));
    diff.replaced.forEach(item => html += createItem(item, 'replaced', '变更', item.oldSummary));
    diff.unchanged.forEach(item => html += createItem(item, 'unchanged', '未变'));

    if (html === '') {
        html = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">无有效记忆条目</div>';
    }

    list.innerHTML = html;
    modal.classList.remove('hidden');
}

function closeMemoryPreviewModal() {
    document.getElementById('memory-preview-modal').classList.add('hidden');
}

function showConsistencyModal(result) {
    const modal = document.getElementById('consistency-modal');
    const summaryEl = document.getElementById('consistency-summary');
    const listEl = document.getElementById('consistency-conflict-list');
    if (!modal || !summaryEl || !listEl) return;

    const summary = (result && typeof result.summary === 'string') ? result.summary.trim() : '';
    const conflicts = (result && Array.isArray(result.conflicts)) ? result.conflicts : [];

    summaryEl.innerText = summary || '检测到连贯性冲突，请按以下建议修复。';

    if (conflicts.length === 0) {
        listEl.innerHTML = '<div style="padding: 16px; color: var(--text-secondary);">未返回具体冲突条目。</div>';
    } else {
        listEl.innerHTML = conflicts.map((item, index) => {
            const type = escapeHtml(String(item.type || '其他'));
            const issue = escapeHtml(String(item.issue || ''));
            const evidence = escapeHtml(String(item.evidence || ''));
            const suggestion = escapeHtml(String(item.suggestion || ''));

            return `
                <div class="consistency-item">
                    <div class="consistency-head">#${index + 1} · ${type}</div>
                    <div class="consistency-line"><strong>冲突：</strong>${issue || '（未提供）'}</div>
                    <div class="consistency-line"><strong>依据：</strong>${evidence || '（未提供）'}</div>
                    <div class="consistency-line"><strong>修复建议：</strong>${suggestion || '（未提供）'}</div>
                </div>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
}

function closeConsistencyModal() {
    const modal = document.getElementById('consistency-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function highlightMemoryChanges(newText, diff) {
    const overlay = document.getElementById('memory-highlight-overlay');
    const textarea = document.getElementById('global_memory-input');
    if (!overlay || !textarea) return;

    // Identify keys to highlight (added + replaced)
    const highlightKeys = new Set([
        ...diff.added.map(i => i.key),
        ...diff.replaced.map(i => i.key)
    ]);

    // Parse newText again line by line to preserve structure exactly for overlay
    const lines = newText.split('\n');
    const regex = /^\s*([^|｜]+)\s*[|｜]\s*([^|｜]+)\s*[|｜]\s*(.+?)\s*$/;

    const htmlLines = lines.map(line => {
        const match = line.match(regex);
        if (match) {
            const key = match[1].trim() + '|' + match[2].trim();
            if (highlightKeys.has(key)) {
                return `<span class="highlight-line">${escapeHtml(line)}</span>`;
            }
        }
        return escapeHtml(line); // No highlight
    });

    // Sync styles
    const styles = window.getComputedStyle(textarea);
    overlay.style.fontFamily = styles.fontFamily;
    overlay.style.fontSize = styles.fontSize;
    overlay.style.lineHeight = styles.lineHeight;
    overlay.style.padding = styles.padding;
    overlay.style.whiteSpace = styles.whiteSpace;
    overlay.style.wordWrap = styles.wordWrap;
    // ... add more if needed

    overlay.innerHTML = htmlLines.join('<br>'); // textarea uses newlines, HTML uses <br> or just newlines in pre-wrap
    // Since we set white-space: pre-wrap, \n should work, but <br> is safer for empty lines if not handled well.
    // Actually pre-wrap respects \n. Let's use \n.
    overlay.innerHTML = htmlLines.join('\n');

    // Show overlay, hide textarea text (make transparent color)
    overlay.classList.add('active');
    const originalColor = textarea.style.color;
    textarea.style.color = 'transparent'; 
    textarea.style.caretColor = styles.getPropertyValue('--text-primary'); // Keep caret visible if possible? 
    // Actually if we make text transparent, caret might take that color. 
    // Better to just overlay ON TOP (pointer-events: none) and keep textarea visible underneath?
    // If overlay has background, it covers textarea. 
    // Our overlay has `background: var(--input-bg)`. So it covers the textarea completely.
    // That's good.

    // Scroll sync
    overlay.scrollTop = textarea.scrollTop;
    
    const handleScroll = () => {
        overlay.scrollTop = textarea.scrollTop;
    };
    textarea.addEventListener('scroll', handleScroll);

    let timerId = null;

    const clearHighlight = () => {
        overlay.classList.remove('active');
        textarea.style.color = originalColor;
        if (timerId) clearTimeout(timerId);
        textarea.removeEventListener('input', clearHighlight);
        textarea.removeEventListener('scroll', handleScroll);
    };

    // Restore after 3 seconds
    timerId = setTimeout(clearHighlight, 3000);
    
    // Clear immediately if user types
    textarea.addEventListener('input', clearHighlight, { once: true });
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
