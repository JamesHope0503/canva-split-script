(function () {
    const STORAGE_KEY = 'canva-script.split-script.v1';
    const LEGACY_STORAGE_KEY = 'canva-script.split-copy.v1';
    const DEFAULT_TARGET = 24;
    const DEFAULT_SETS = 5;
    const EMPTY_LEFT_ROWS = 16;
    const MAX_SETS = 20;
    const MAX_TARGET = 999;

    const el = {
        projectName: document.getElementById('projectName'),
        filenameBox: document.getElementById('filenameBox'),
        targetCount: document.getElementById('targetCount'),
        templateSets: document.getElementById('templateSets'),
        leftCount: document.getElementById('leftCount'),
        rightMeta: document.getElementById('rightMeta'),
        btnCopyFilename: document.getElementById('btnCopyFilename'),
        btnIncrement: document.getElementById('btnIncrement'),
        btnHistory: document.getElementById('btnHistory'),
        btnCloseHistory: document.getElementById('btnCloseHistory'),
        btnResetSerial: document.getElementById('btnResetSerial'),
        btnClear: document.getElementById('btnClear'),
        btnClearYes: document.getElementById('btnClearYes'),
        btnClearNo: document.getElementById('btnClearNo'),
        btnExport: document.getElementById('btnExport'),
        historyMask: document.getElementById('historyMask'),
        historyDrawer: document.getElementById('historyDrawer'),
        historyBody: document.getElementById('historyBody'),
        historyEmpty: document.getElementById('historyEmpty'),
        toast: document.getElementById('toast'),
    };

    let leftHot = null;
    let rightHot = null;
    let lastActiveHot = null;
    let suppressHotSelect = false;
    let suppressPersist = false;
    let refreshTimer = 0;
    let store = loadStore();
    let filenameTouched = false;
    let refreshPaused = false;
    let pendingRefresh = false;

    function defaultStore() {
        return {
            nextIndex: 1,
            history: [],
            draft: {
                projectName: '',
                targetCount: DEFAULT_TARGET,
                templateSets: DEFAULT_SETS,
                originalRows: [],
                filename: '',
                filenameTouched: false,
            },
        };
    }

    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
                || localStorage.getItem(LEGACY_STORAGE_KEY);
            if (!raw) return defaultStore();
            const parsed = JSON.parse(raw);
            const base = defaultStore();
            return {
                nextIndex: Math.max(1, Number(parsed.nextIndex) || 1),
                history: Array.isArray(parsed.history) ? parsed.history : [],
                draft: Object.assign(base.draft, parsed.draft || {}),
            };
        } catch (e) {
            return defaultStore();
        }
    }

    function saveStore() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function todayStamp() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function indexToLetters(n) {
        let x = Math.max(1, Number(n) || 1);
        let s = '';
        while (x > 0) {
            x -= 1;
            s = String.fromCharCode(65 + (x % 26)) + s;
            x = Math.floor(x / 26);
        }
        return s;
    }

    function serialAt(index) {
        const n = Math.max(1, Number(index) || 1);
        return `${indexToLetters(n)}${n}`;
    }

    function serialIndexFromText(text) {
        const s = String(text || '').trim();
        const plain = s.match(/^([A-Z]+)(\d+)$/i);
        if (plain) return parseInt(plain[2], 10) || 0;
        const fromFile = s.match(/(?:^|[\\/\s])(\d{4}-\d{2}-\d{2})-([A-Z]+\d+)/i)
            || s.match(/^(\d{4}-\d{2}-\d{2})-([A-Z]+\d+)/i);
        if (fromFile) {
            const num = String(fromFile[2]).match(/(\d+)$/);
            return num ? parseInt(num[1], 10) : 0;
        }
        return 0;
    }

    function recordDate(item) {
        const date = String(item && item.date || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        const fromFile = String(item && item.filename || '').match(/(\d{4}-\d{2}-\d{2})/);
        return fromFile ? fromFile[1] : '';
    }

    function recordIndex(item) {
        const fromField = Number(item && item.index);
        if (Number.isFinite(fromField) && fromField > 0) return fromField;
        return Math.max(
            serialIndexFromText(item && item.serial),
            serialIndexFromText(item && item.filename)
        );
    }

    function todayMaxIndex() {
        const today = todayStamp();
        let max = 0;
        (store.history || []).forEach((item) => {
            if (recordDate(item) !== today) return;
            max = Math.max(max, recordIndex(item));
        });
        return max;
    }

    function nextSerialIndex() {
        return todayMaxIndex() + 1;
    }

    function sanitizeName(name) {
        return String(name || '')
            .trim()
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, ' ');
    }

    function buildFilename(index, name) {
        const serial = serialAt(index);
        const clean = sanitizeName(name);
        return clean ? `${todayStamp()}-${serial}-${clean}` : `${todayStamp()}-${serial}`;
    }

    function currentFilename() {
        return buildFilename(nextSerialIndex(), el.projectName.value);
    }

    function filenameInputValue() {
        return String(el.filenameBox.value || '').trim();
    }

    function exportBasename() {
        const typed = filenameInputValue().replace(/\.csv$/i, '');
        return typed || currentFilename();
    }

    function updateFilenameBox(force) {
        if (!force && filenameTouched) return;
        el.filenameBox.value = currentFilename();
        el.filenameBox.title = `${el.filenameBox.value}（当天最大流水号 + 1，可编辑）`;
    }

    function clampInt(value, min, max, fallback) {
        const n = parseInt(String(value), 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    function getTargetCount() {
        return clampInt(el.targetCount.value, 1, MAX_TARGET, DEFAULT_TARGET);
    }

    function getTemplateSets() {
        return clampInt(el.templateSets.value, 1, MAX_SETS, DEFAULT_SETS);
    }

    function emptyLeftGrid() {
        return Array.from({ length: EMPTY_LEFT_ROWS }, () => ['', '']);
    }

    function isFilledRow(row) {
        return Array.isArray(row) && row.some((c) => String(c || '').trim());
    }

    function readOriginalPairs() {
        const data = leftHot ? leftHot.getSourceData() : [];
        return (data || [])
            .filter(isFilledRow)
            .map((r) => [r[0] != null ? String(r[0]) : '', r[1] != null ? String(r[1]) : '']);
    }

    function takeTargetPairs(pairs, target) {
        const list = Array.isArray(pairs) ? pairs : [];
        const n = Math.max(0, Number(target) || 0);
        if (!list.length || n <= 0) return [];
        if (list.length >= n) return list.slice(0, n);
        const out = [];
        for (let i = 0; i < n; i += 1) out.push(list[i % list.length]);
        return out;
    }

    function pairsToGrid(pairs, sets) {
        const cols = Math.max(1, Number(sets) || 1);
        const items = Array.isArray(pairs) ? pairs : [];
        if (!items.length) return [];
        const rows = Math.ceil(items.length / cols);
        const grid = [];
        for (let r = 0; r < rows; r += 1) {
            const row = [];
            for (let c = 0; c < cols; c += 1) {
                const item = items[r * cols + c];
                row.push(item ? item[0] : '', item ? item[1] : '');
            }
            grid.push(row);
        }
        return grid;
    }

    function rightHeaders(sets) {
        const headers = [];
        for (let i = 1; i <= sets; i += 1) {
            headers.push(`标题${i}`, `内容${i}`);
        }
        return headers;
    }

    function rightColumns(sets) {
        const columns = [];
        for (let i = 0; i < sets; i += 1) {
            columns.push(
                { width: 140, copyable: true, renderer: cellTitleRenderer },
                { width: 220, copyable: true, renderer: cellTitleRenderer }
            );
        }
        return columns;
    }

    function csvEscape(value) {
        const s = value == null ? '' : String(value);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    function gridToCsv(headers, grid) {
        const lines = [headers.map(csvEscape).join(',')];
        (grid || []).forEach((row) => {
            const cells = headers.map((_, i) => csvEscape(row && row[i] != null ? row[i] : ''));
            lines.push(cells.join(','));
        });
        return `\uFEFF${lines.join('\r\n')}`;
    }

    function hasNativeSave() {
        return !!(window.pywebview && window.pywebview.api && window.pywebview.api.save_csv);
    }

    function waitForNativeSave(timeoutMs) {
        if (hasNativeSave()) return Promise.resolve(true);
        if (typeof window.pywebview === 'undefined') return Promise.resolve(false);
        return new Promise((resolve) => {
            const done = (ok) => {
                window.removeEventListener('pywebviewready', onReady);
                resolve(ok);
            };
            const onReady = () => done(hasNativeSave());
            window.addEventListener('pywebviewready', onReady);
            setTimeout(() => done(hasNativeSave()), timeoutMs);
        });
    }

    async function downloadText(filename, text, mime) {
        const ready = await waitForNativeSave(800);
        if (ready && hasNativeSave()) {
            try {
                const result = await window.pywebview.api.save_csv(filename, text);
                if (result && result.cancelled) return { ok: false, cancelled: true };
                if (result && result.ok) return { ok: true, path: result.path };
                return { ok: false, error: (result && result.error) || 'save failed' };
            } catch (err) {
                return { ok: false, error: String(err && err.message ? err.message : err) };
            }
        }
        const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 800);
        return { ok: true };
    }

    function showToast(msg, isError) {
        el.toast.textContent = msg || '';
        el.toast.classList.toggle('error', !!isError);
        el.toast.classList.add('show');
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => el.toast.classList.remove('show'), 2400);
    }

    function persistDraft() {
        if (suppressPersist) return;
        store.draft = {
            projectName: el.projectName.value,
            targetCount: getTargetCount(),
            templateSets: getTemplateSets(),
            originalRows: readOriginalPairs(),
            filename: filenameInputValue(),
            filenameTouched,
        };
        store.nextIndex = nextSerialIndex();
        saveStore();
    }

    function updateCounts(pairs, grid, sets) {
        el.leftCount.textContent = `${pairs.length} 条`;
        el.rightMeta.textContent = `${grid.length} 行 · ${sets} 列对`;
    }

    function anyEditorOpen() {
        return isHotEditorOpen(leftHot) || isHotEditorOpen(rightHot);
    }

    function refreshRight() {
        if (!rightHot || rightHot.isDestroyed) return;
        if (refreshPaused || anyEditorOpen()) {
            pendingRefresh = true;
            return;
        }
        const sets = getTemplateSets();
        const pairs = takeTargetPairs(readOriginalPairs(), getTargetCount());
        const grid = pairsToGrid(pairs, sets);
        const needRebuild = rightHot.countCols() !== sets * 2;
        suppressHotSelect = true;
        try {
            if (needRebuild) {
                rightHot.updateSettings({
                    colHeaders: rightHeaders(sets),
                    columns: rightColumns(sets),
                    stretchH: 'none',
                });
            }
            rightHot.loadData(grid);
        } finally {
            suppressHotSelect = false;
        }
        updateCounts(readOriginalPairs(), grid, sets);
        persistDraft();
    }

    function scheduleRefresh() {
        if (refreshPaused || anyEditorOpen()) {
            pendingRefresh = true;
            return;
        }
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refreshRight, 160);
    }

    function pauseSync() {
        refreshPaused = true;
    }

    function resumeSync() {
        refreshPaused = false;
        if (!pendingRefresh) return;
        pendingRefresh = false;
        scheduleRefresh();
    }

    function ensureLeftSpare(rows) {
        const list = Array.isArray(rows)
            ? rows.map((r) => [r[0] != null ? String(r[0]) : '', r[1] != null ? String(r[1]) : ''])
            : [];
        while (list.length < EMPTY_LEFT_ROWS) list.push(['', '']);
        return list;
    }

    function getSelectedRowCount(instance) {
        const selected = instance && instance.getSelected();
        if (!selected) return 1;
        const rowSet = new Set();
        selected.forEach(([r1, , r2]) => {
            const [min, max] = [Math.min(r1, r2), Math.max(r1, r2)];
            for (let i = min; i <= max; i += 1) rowSet.add(i);
        });
        return rowSet.size || 1;
    }

    function buildContextMenu(getHot) {
        const HT = window.Handsontable;
        const sep = HT && HT.plugins && HT.plugins.ContextMenu
            ? HT.plugins.ContextMenu.SEPARATOR
            : '---------';
        return {
            items: {
                copy: { name: '复制' },
                cut: { name: '剪切' },
                paste: {
                    name: '粘贴',
                    callback() {
                        const hot = getHot();
                        if (!hot) return;
                        setActiveHot(hot);
                        const applyText = (text, html) => {
                            const grid = resolvePasteGrid(text, html);
                            if (isMultiCellGrid(grid)) pasteGridAtAnchor(hot, grid);
                            else pastePlainIntoSelectedCell(hot, grid[0] && grid[0][0] != null ? grid[0][0] : text);
                        };
                        if (navigator.clipboard && navigator.clipboard.read) {
                            navigator.clipboard.read().then((items) => {
                                let plain = '';
                                let html = '';
                                const jobs = (items || []).map((item) => {
                                    const get = (type) => (item.types && item.types.includes(type)
                                        ? item.getType(type).then((b) => b.text()).catch(() => '')
                                        : Promise.resolve(''));
                                    return Promise.all([get('text/plain'), get('text/html')]).then(([p, h]) => {
                                        if (p) plain = p;
                                        if (h) html = h;
                                    });
                                });
                                return Promise.all(jobs).then(() => applyText(plain, html));
                            }).catch(() => {
                                if (navigator.clipboard.readText) {
                                    return navigator.clipboard.readText().then((t) => applyText(t, ''));
                                }
                            });
                            return;
                        }
                        if (navigator.clipboard && navigator.clipboard.readText) {
                            navigator.clipboard.readText().then((t) => applyText(t, '')).catch(() => {});
                        }
                    },
                },
                sp1: sep,
                undo: { name: '撤销' },
                redo: { name: '重做' },
                sp2: sep,
                row_above: {
                    name() {
                        const hot = getHot();
                        return `在上方插入 ${getSelectedRowCount(hot)} 行`;
                    },
                    callback(key, selection) {
                        const hot = getHot();
                        if (!hot || !selection || !selection[0]) return;
                        hot.alter('insert_row_above', selection[0].start.row, getSelectedRowCount(hot));
                    },
                },
                row_below: {
                    name() {
                        const hot = getHot();
                        return `在下方插入 ${getSelectedRowCount(hot)} 行`;
                    },
                    callback(key, selection) {
                        const hot = getHot();
                        if (!hot || !selection || !selection[0]) return;
                        hot.alter('insert_row_below', selection[0].end.row, getSelectedRowCount(hot));
                    },
                },
                custom_remove_row: {
                    name() {
                        const hot = getHot();
                        return `删除 ${getSelectedRowCount(hot)} 行`;
                    },
                    callback() {
                        const hot = getHot();
                        if (!hot) return;
                        const count = getSelectedRowCount(hot);
                        if (count > 50 && !window.confirm(`即将删除 ${count} 行，确认继续？`)) return;
                        const selected = hot.getSelected();
                        if (!selected) return;
                        selected
                            .map(([r1, , r2]) => [Math.min(r1, r2), Math.abs(r2 - r1) + 1])
                            .sort((a, b) => b[0] - a[0])
                            .forEach(([start, amount]) => hot.alter('remove_row', start, amount));
                    },
                },
            },
        };
    }

    function sharedHotSettings() {
        return {
            className: 'htLeft htMiddle',
            stretchH: 'all',
            height: '100%',
            rowHeights: 35,
            columnHeaderHeight: 28,
            renderAllRows: true,
            allowInsertRow: true,
            allowRemoveRow: true,
            wordWrap: false,
            autoRowSize: false,
            enterBeginsEditing: false,
            copyPaste: true,
            fillHandle: true,
            undo: true,
            outsideClickDeselects: false,
            licenseKey: 'non-commercial-and-evaluation',
        };
    }

    function isHotEditorOpen(hot) {
        if (!hot || hot.isDestroyed) return false;
        const ed = typeof hot.getActiveEditor === 'function' ? hot.getActiveEditor() : null;
        return !!(ed && typeof ed.isOpened === 'function' && ed.isOpened());
    }

    function hotHasSelection(hot) {
        if (!hot || hot.isDestroyed || !hot.getSelected) return false;
        const sel = hot.getSelected();
        return !!(sel && sel.length);
    }

    function hotFromEventTarget(target) {
        if (!target) return null;
        if (leftHot && leftHot.rootElement && leftHot.rootElement.contains(target)) return leftHot;
        if (rightHot && rightHot.rootElement && rightHot.rootElement.contains(target)) return rightHot;
        return null;
    }

    function setActiveHot(hot) {
        if (!hot || hot.isDestroyed) return false;
        lastActiveHot = hot;
        const other = hot === leftHot ? rightHot : leftHot;
        try { hot.listen(); } catch (e) { /* ignore */ }
        if (other && !other.isDestroyed) {
            try { other.unlisten(); } catch (e) { /* ignore */ }
            try { other.deselectCell(); } catch (e) { /* ignore */ }
        }
        return true;
    }

    function isNativeTextField(target) {
        if (!target) return false;
        if (target.isContentEditable) return true;
        const tag = String(target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        return !!(target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
    }

    function releaseHot() {
        lastActiveHot = null;
        [leftHot, rightHot].forEach((hot) => {
            if (!hot || hot.isDestroyed) return;
            try { hot.unlisten(); } catch (e) { /* ignore */ }
            try { hot.deselectCell(); } catch (e) { /* ignore */ }
        });
    }

    function resolveHotForClipboard(event) {
        if (isNativeTextField(event && event.target) || isNativeTextField(document.activeElement)) {
            releaseHot();
            return null;
        }
        const fromDom = event && hotFromEventTarget(event.target);
        if (fromDom && (hotHasSelection(fromDom) || isHotEditorOpen(fromDom))) {
            setActiveHot(fromDom);
            return fromDom;
        }
        if (lastActiveHot && (hotHasSelection(lastActiveHot) || isHotEditorOpen(lastActiveHot))) {
            setActiveHot(lastActiveHot);
            return lastActiveHot;
        }
        return null;
    }

    function parseHtmlTable(html) {
        const src = String(html == null ? '' : html);
        if (!src || !/<(table|tr|td|th)\b/i.test(src)) return null;
        try {
            const doc = new DOMParser().parseFromString(src, 'text/html');
            const table = doc.querySelector('table');
            if (!table) return null;
            const rows = [];
            table.querySelectorAll('tr').forEach((tr) => {
                const cells = Array.from(tr.querySelectorAll('th,td')).map((td) =>
                    String(td.innerText || '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
                );
                if (cells.length) rows.push(cells);
            });
            return rows.length ? rows : null;
        } catch (e) {
            return null;
        }
    }

    function parseSheetClip(text) {
        const src = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (!src) return [['']];
        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;
        for (let i = 0; i < src.length; i += 1) {
            const ch = src[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (src[i + 1] === '"') {
                        cell += '"';
                        i += 1;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cell += ch;
                }
                continue;
            }
            if (ch === '"') {
                inQuotes = true;
                continue;
            }
            if (ch === '\t') {
                row.push(cell);
                cell = '';
                continue;
            }
            if (ch === '\n') {
                row.push(cell);
                rows.push(row);
                row = [];
                cell = '';
                continue;
            }
            cell += ch;
        }
        row.push(cell);
        if (!(row.length === 1 && row[0] === '' && rows.length)) rows.push(row);
        while (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
            rows.pop();
        }
        return rows.length ? rows : [['']];
    }

    function resolvePasteGrid(plain, html) {
        const fromPlain = parseSheetClip(plain);
        if (isMultiCellGrid(fromPlain)) return fromPlain;
        const fromHtml = parseHtmlTable(html);
        if (fromHtml && isMultiCellGrid(fromHtml)) return fromHtml;
        if (fromHtml && fromHtml.length && fromHtml[0] && fromHtml[0][0] && !String(plain || '').trim()) {
            return fromHtml;
        }
        return fromPlain;
    }

    function isMultiCellGrid(grid) {
        if (!grid || !grid.length) return false;
        if (grid.length > 1) return true;
        return !!(grid[0] && grid[0].length > 1);
    }

    function ensureRowsForPaste(hot, lastRowIndex) {
        const have = hot.countRows();
        if (have <= 0) {
            hot.alter('insert_row_above', 0, Math.max(1, lastRowIndex + 1));
            return;
        }
        if (lastRowIndex >= have) {
            hot.alter('insert_row_below', have - 1, lastRowIndex - have + 1);
        }
    }

    function pasteGridAtAnchor(hot, grid) {
        if (!hot || hot.isDestroyed) return false;
        const sel = hot.getSelectedLast && hot.getSelectedLast();
        if (!sel) return false;
        const startRow = Math.min(sel[0], sel[2]);
        const startCol = Math.min(sel[1], sel[3]);
        if (startRow < 0 || startCol < 0) return false;
        const normalized = (grid || []).map((r) => (Array.isArray(r) ? r.slice() : [r]));
        if (!normalized.length) return false;
        ensureRowsForPaste(hot, startRow + normalized.length - 1);
        const maxCols = hot.countCols ? hot.countCols() : Infinity;
        const changes = [];
        for (let i = 0; i < normalized.length; i += 1) {
            const r = startRow + i;
            const line = normalized[i] || [];
            for (let j = 0; j < line.length; j += 1) {
                const c = startCol + j;
                if (c >= maxCols) break;
                const meta = hot.getCellMeta(r, c) || {};
                if (meta.readOnly || meta.editor === false) continue;
                changes.push([r, c, line[j] == null ? '' : String(line[j])]);
            }
        }
        if (!changes.length) return false;
        hot.setDataAtCell(changes, 'CopyPaste.paste');
        return true;
    }

    function pastePlainIntoSelectedCell(hot, text) {
        if (!hot || hot.isDestroyed) return false;
        const sel = hot.getSelectedLast && hot.getSelectedLast();
        if (!sel) return false;
        const row = Math.min(sel[0], sel[2]);
        const col = Math.min(sel[1], sel[3]);
        if (row < 0 || col < 0) return false;
        const meta = hot.getCellMeta(row, col) || {};
        if (meta.readOnly || meta.editor === false) return false;
        hot.setDataAtCell(row, col, String(text == null ? '' : text), 'CopyPaste.paste');
        return true;
    }

    function getSelectionGridData(hot) {
        if (!hot || hot.isDestroyed) return null;
        const sel = hot.getSelectedLast && hot.getSelectedLast();
        if (!sel) return null;
        const r1 = Math.min(sel[0], sel[2]);
        const r2 = Math.max(sel[0], sel[2]);
        const c1 = Math.min(sel[1], sel[3]);
        const c2 = Math.max(sel[1], sel[3]);
        if (r1 < 0 || c1 < 0) return null;
        const data = [];
        for (let r = r1; r <= r2; r += 1) {
            const row = [];
            for (let c = c1; c <= c2; c += 1) {
                const v = hot.getDataAtCell(r, c);
                row.push(v == null ? '' : String(v));
            }
            data.push(row);
        }
        return data;
    }

    function stringifySheetClip(data) {
        return (data || []).map((row) => (row || []).map((cell) => {
            const s = String(cell == null ? '' : cell);
            if (/[\t\n\r"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        }).join('\t')).join('\n');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function gridToHtmlTable(data) {
        const rows = (data || []).map((row) => {
            const tds = (row || []).map((c) => `<td>${escapeHtml(c)}</td>`).join('');
            return `<tr>${tds}</tr>`;
        }).join('');
        return `<table>${rows}</table>`;
    }

    function writeSelectionToClipboard(event, hot) {
        const data = getSelectionGridData(hot);
        if (!data || !data.length) return false;
        const textPlain = stringifySheetClip(data);
        if (event.clipboardData) {
            event.clipboardData.setData('text/plain', textPlain);
            event.clipboardData.setData('text/html', gridToHtmlTable(data));
        } else if (window.clipboardData) {
            window.clipboardData.setData('Text', textPlain);
        }
        return true;
    }

    function clearSelectionCells(hot) {
        const sel = hot.getSelectedLast && hot.getSelectedLast();
        if (!sel) return;
        const r1 = Math.min(sel[0], sel[2]);
        const r2 = Math.max(sel[0], sel[2]);
        const c1 = Math.min(sel[1], sel[3]);
        const c2 = Math.max(sel[1], sel[3]);
        const changes = [];
        for (let r = r1; r <= r2; r += 1) {
            for (let c = c1; c <= c2; c += 1) {
                if (r < 0 || c < 0) continue;
                const meta = hot.getCellMeta(r, c) || {};
                if (meta.readOnly || meta.editor === false) continue;
                changes.push([r, c, '']);
            }
        }
        if (changes.length) hot.setDataAtCell(changes, 'CopyPaste.cut');
    }

    function bindClipboardEvents() {
        document.addEventListener('paste', (event) => {
            const hot = resolveHotForClipboard(event);
            if (!hot || isHotEditorOpen(hot)) return;
            const sel = hot.getSelectedLast && hot.getSelectedLast();
            if (!sel) return;
            const plain = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
            const html = event.clipboardData ? (event.clipboardData.getData('text/html') || '') : '';
            if (plain == null && !html) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const multi = sel[0] !== sel[2] || sel[1] !== sel[3];
            const grid = resolvePasteGrid(plain, html);
            if (isMultiCellGrid(grid) || multi) pasteGridAtAnchor(hot, grid);
            else pastePlainIntoSelectedCell(hot, grid[0] && grid[0][0] != null ? grid[0][0] : plain);
        }, true);

        document.addEventListener('copy', (event) => {
            const hot = resolveHotForClipboard(event);
            if (!hot || isHotEditorOpen(hot)) return;
            if (!writeSelectionToClipboard(event, hot)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);

        document.addEventListener('cut', (event) => {
            const hot = resolveHotForClipboard(event);
            if (!hot || isHotEditorOpen(hot)) return;
            if (!writeSelectionToClipboard(event, hot)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            clearSelectionCells(hot);
        }, true);

        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) {
                const k = event.key && event.key.toLowerCase();
                if (k === 'v' || k === 'c' || k === 'x') resolveHotForClipboard(event);
            }
        }, true);
    }

    function cellTitleRenderer(instance, td, row, col, prop, value) {
        Handsontable.renderers.TextRenderer.apply(this, arguments);
        td.title = value == null ? '' : String(value);
    }

    function markEditing(container, on) {
        if (!container) return;
        container.classList.toggle('is-editing', !!on);
        const pane = container.closest('.alloc-left, .alloc-right');
        if (pane) pane.classList.toggle('is-editing', !!on);
    }

    function wrapEditorClose(hot, container) {
        const editor = typeof hot.getActiveEditor === 'function' ? hot.getActiveEditor() : null;
        if (!editor || typeof editor.close !== 'function' || editor._syncWrapped) return;
        const origClose = editor.close.bind(editor);
        editor.close = function closeEditorWrapped() {
            const result = origClose.apply(this, arguments);
            markEditing(container, false);
            setTimeout(() => {
                if (!anyEditorOpen()) resumeSync();
            }, 0);
            return result;
        };
        editor._syncWrapped = true;
    }

    function openCellEditor(hot, coords, event) {
        if (!hot || hot.isDestroyed || !coords) return;
        if (event && event.button !== 0) return;
        if (coords.row < 0 || coords.col < 0) return;
        const sel = hot.getSelectedLast && hot.getSelectedLast();
        if (!sel || sel[0] !== sel[2] || sel[1] !== sel[3]) return;
        const editor = typeof hot.getActiveEditor === 'function' ? hot.getActiveEditor() : null;
        if (!editor || typeof editor.beginEditing !== 'function') return;
        if (editor.isOpened && editor.isOpened()) return;
        pauseSync();
        editor.beginEditing();
    }

    function cellViewHooks(container) {
        return {
            afterOnCellMouseDown(event, coords) {
                setActiveHot(this);
                const target = event && event.target;
                const onHandle = !!(target && target.classList && (target.classList.contains('corner') || target.classList.contains('wtBorder')));
                this._viewCellKey = (!onHandle && coords && coords.row >= 0 && coords.col >= 0 && (!event || event.button === 0))
                    ? `${coords.row}:${coords.col}`
                    : '';
            },
            afterOnCellMouseUp(event, coords) {
                const key = coords ? `${coords.row}:${coords.col}` : '';
                const shouldOpen = this._viewCellKey && this._viewCellKey === key;
                this._viewCellKey = '';
                if (!shouldOpen) return;
                const hot = this;
                setTimeout(() => openCellEditor(hot, coords, event), 0);
            },
            afterBeginEditing() {
                pauseSync();
                markEditing(container, true);
                wrapEditorClose(this, container);
            },
            afterSelection() {
                if (suppressHotSelect || !hotHasSelection(this)) return;
                lastActiveHot = this;
                try { this.listen(); } catch (e) { /* ignore */ }
            },
        };
    }

    function renderLeftHot() {
        const container = document.getElementById('leftHot');
        leftHot = new Handsontable(container, {
            data: emptyLeftGrid(),
            rowHeaders: true,
            colHeaders: ['标题', '内容'],
            columns: [
                { width: 120, copyable: true, renderer: cellTitleRenderer },
                { width: 180, copyable: true, renderer: cellTitleRenderer },
            ],
            minSpareRows: 2,
            minRows: EMPTY_LEFT_ROWS,
            ...sharedHotSettings(),
            contextMenu: buildContextMenu(() => leftHot),
            afterGetColHeader(col, TH) {
                TH.classList.add('ht-sc-header');
            },
            afterChange(changes, source) {
                if (!changes || source === 'loadData') return;
                scheduleRefresh();
            },
            afterCreateRow(index, amount, source) {
                if (source === 'auto') return;
                scheduleRefresh();
            },
            afterRemoveRow(index, amount, source) {
                if (source === 'auto') return;
                scheduleRefresh();
            },
            ...cellViewHooks(container),
        });
    }

    function renderRightHot() {
        const container = document.getElementById('rightHot');
        const sets = getTemplateSets();
        rightHot = new Handsontable(container, {
            data: [],
            rowHeaders: true,
            colHeaders: rightHeaders(sets),
            columns: rightColumns(sets),
            minSpareRows: 0,
            minRows: 0,
            ...sharedHotSettings(),
            stretchH: 'none',
            width: '100%',
            contextMenu: buildContextMenu(() => rightHot),
            afterGetColHeader(col, TH) {
                TH.classList.add('ht-sc-header');
            },
            ...cellViewHooks(container),
        });
    }

    function setClearPhase(phase) {
        const confirming = phase === 'confirm';
        el.btnClear.hidden = confirming;
        el.btnClearYes.hidden = !confirming;
        el.btnClearNo.hidden = !confirming;
    }

    function clearAll() {
        suppressPersist = true;
        el.projectName.value = '';
        el.targetCount.value = String(DEFAULT_TARGET);
        el.templateSets.value = String(DEFAULT_SETS);
        if (leftHot) leftHot.loadData(emptyLeftGrid());
        store.draft = defaultStore().draft;
        saveStore();
        filenameTouched = false;
        suppressPersist = false;
        updateFilenameBox(true);
        refreshRight();
        showToast('已清空全部内容');
    }

    function exportCsv() {
        const name = sanitizeName(el.projectName.value);
        if (!name) {
            showToast('请先填写项目名称', true);
            el.projectName.focus();
            return;
        }
        if (!exportBasename()) {
            showToast('请先填写导出文件名', true);
            el.filenameBox.focus();
            return;
        }
        const original = readOriginalPairs();
        if (!original.length) {
            showToast('请先输入原始文案', true);
            return;
        }
        const sets = getTemplateSets();
        const pairs = takeTargetPairs(original, getTargetCount());
        const grid = pairsToGrid(pairs, sets);
        if (!grid.length) {
            showToast('分配结果为空，请检查原始文案', true);
            return;
        }
        const filename = `${exportBasename()}.csv`;
        const csv = gridToCsv(rightHeaders(sets), grid);
        el.btnExport.disabled = true;
        downloadText(filename, csv).then((result) => {
            if (result && result.cancelled) {
                showToast('已取消导出');
                return;
            }
            if (!result || !result.ok) {
                showToast('导出失败，请重试', true);
                return;
            }
            showToast(`已导出 ${filename}`);
        }).finally(() => {
            el.btnExport.disabled = false;
        });
    }

    function incrementSerial() {
        const index = nextSerialIndex();
        const serial = serialAt(index);
        const record = {
            index,
            serial,
            date: todayStamp(),
            name: sanitizeName(el.projectName.value),
            filename: `${exportBasename()}.csv`,
            recordedAt: new Date().toISOString(),
        };
        store.history.unshift(record);
        store.nextIndex = nextSerialIndex();
        filenameTouched = false;
        persistDraft();
        saveStore();
        updateFilenameBox(true);
        renderHistory();
        showToast(`已记录 ${serial}，下一条为 ${serialAt(store.nextIndex)}`);
    }

    function deleteHistory(index) {
        const item = store.history[index];
        if (!item) return;
        if (!window.confirm(`删除流水记录 ${item.serial}？`)) return;
        store.history.splice(index, 1);
        store.nextIndex = nextSerialIndex();
        saveStore();
        updateFilenameBox();
        renderHistory();
        showToast(`已删除 ${item.serial}`);
    }

    function renderHistory() {
        const list = store.history || [];
        el.historyBody.innerHTML = list.map((item, i) => `
            <tr>
                <td>${escapeHtml(item.serial)}</td>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.filename)}</td>
                <td class="col-action">
                    <button type="button" class="btn btn-mini btn-history-del" data-history-index="${i}">删除</button>
                </td>
            </tr>
        `).join('');
        el.historyEmpty.hidden = list.length > 0;
    }

    function refreshTablesSize() {
        [leftHot, rightHot].forEach((hot) => {
            if (!hot || hot.isDestroyed) return;
            try { hot.refreshDimensions(); } catch (e) { /* ignore */ }
        });
    }

    function openHistory() {
        renderHistory();
        document.body.classList.add('modal-open');
        el.historyMask.hidden = false;
        el.historyDrawer.hidden = false;
    }

    function closeHistory() {
        document.body.classList.remove('modal-open');
        el.historyMask.hidden = true;
        el.historyDrawer.hidden = true;
    }

    function resetSerial() {
        if (!window.confirm('将删除当天的流水记录，下一条从 A1 开始。确定？')) return;
        const today = todayStamp();
        store.history = (store.history || []).filter((item) => recordDate(item) !== today);
        store.nextIndex = nextSerialIndex();
        filenameTouched = false;
        persistDraft();
        saveStore();
        updateFilenameBox(true);
        renderHistory();
        showToast('当天记录已清除，下一条为 A1');
    }

    function restoreDraft() {
        const draft = store.draft || {};
        suppressPersist = true;
        el.projectName.value = draft.projectName || '';
        el.targetCount.value = String(clampInt(draft.targetCount, 1, MAX_TARGET, DEFAULT_TARGET));
        el.templateSets.value = String(clampInt(draft.templateSets, 1, MAX_SETS, DEFAULT_SETS));
        filenameTouched = !!draft.filenameTouched;
        if (leftHot) leftHot.loadData(ensureLeftSpare(draft.originalRows));
        if (filenameTouched && draft.filename) el.filenameBox.value = draft.filename;
        suppressPersist = false;
        store.nextIndex = nextSerialIndex();
        updateFilenameBox();
        refreshRight();
    }

    function bindUi() {
        el.projectName.addEventListener('input', () => {
            updateFilenameBox();
            persistDraft();
        });
        el.filenameBox.addEventListener('input', () => {
            filenameTouched = true;
            persistDraft();
        });
        el.targetCount.addEventListener('input', scheduleRefresh);
        el.templateSets.addEventListener('input', scheduleRefresh);
        el.targetCount.addEventListener('change', () => {
            el.targetCount.value = String(getTargetCount());
            scheduleRefresh();
        });
        el.templateSets.addEventListener('change', () => {
            el.templateSets.value = String(getTemplateSets());
            scheduleRefresh();
        });
        el.btnIncrement.addEventListener('click', incrementSerial);
        el.btnCopyFilename.addEventListener('click', async () => {
            const name = exportBasename();
            try {
                await navigator.clipboard.writeText(name);
                showToast('已复制文件名');
            } catch (e) {
                showToast('复制失败', true);
            }
        });
        el.btnHistory.addEventListener('click', openHistory);
        el.btnCloseHistory.addEventListener('click', closeHistory);
        el.historyMask.addEventListener('click', closeHistory);
        el.historyBody.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest('[data-history-index]');
            if (!btn) return;
            deleteHistory(Number(btn.getAttribute('data-history-index')));
        });
        el.btnResetSerial.addEventListener('click', resetSerial);
        el.btnClear.addEventListener('click', () => setClearPhase('confirm'));
        el.btnClearNo.addEventListener('click', () => setClearPhase('idle'));
        el.btnClearYes.addEventListener('click', () => {
            clearAll();
            setClearPhase('idle');
        });
        el.btnExport.addEventListener('click', exportCsv);
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !el.historyDrawer.hidden) closeHistory();
        });
        document.addEventListener('focusin', (ev) => {
            if (isNativeTextField(ev.target)) releaseHot();
        }, true);
        document.addEventListener('mousedown', (ev) => {
            if (isNativeTextField(ev.target)) {
                releaseHot();
                return;
            }
            const hot = hotFromEventTarget(ev.target);
            if (hot) setActiveHot(hot);
        }, true);
    }

    bindClipboardEvents();
    renderLeftHot();
    renderRightHot();
    bindUi();
    restoreDraft();
    requestAnimationFrame(refreshTablesSize);
    window.__leftHot = leftHot;
    window.__rightHot = rightHot;
})();
