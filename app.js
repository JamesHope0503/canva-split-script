(function () {
    const APP_VERSION = '1.5.3';
    document.title = `Canva分割文案 · v${APP_VERSION}`;

    const STORAGE_KEY = 'canva-script.split-script.v2';
    const LEGACY_STORAGE_KEYS = [
        'canva-script.split-script.v1',
        'canva-script.split-copy.v1',
    ];
    const DEFAULT_TARGET = 1;
    const DEFAULT_SETS = 1;
    const DEFAULT_LEFT_ROWS = 23;
    const LEFT_SPARE_ROWS = 7;
    const MAX_SETS = 99;
    const MAX_TARGET = 99;
    const ROW_H = 35;
    const COL_SIGN_W = 100;
    const COL_TITLE_W = 120;
    const COL_CONTENT_W = 150;

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
        btnClearSign: document.getElementById('btnClearSign'),
        btnClearTitleContent: document.getElementById('btnClearTitleContent'),
        btnExport: document.getElementById('btnExport'),
        historyMask: document.getElementById('historyMask'),
        historyDrawer: document.getElementById('historyDrawer'),
        historyBody: document.getElementById('historyBody'),
        historyEmpty: document.getElementById('historyEmpty'),
        toast: document.getElementById('toast'),
        allocHint: document.getElementById('allocHint'),
        signToggle: document.getElementById('signToggle'),
        app: document.getElementById('app'),
    };

    let leftHot = null;
    let rightHot = null;
    let lastActiveHot = null;
    let suppressHotSelect = false;
    let suppressPersist = false;
    let refreshTimer = 0;
    let store = loadStore();
    let filenameTouched = false;
    let pendingRefresh = false;
    let syncingLeftRows = false;
    let leftSyncTimer = 0;

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
                useSignature: true,
            },
        };
    }

    function parseStore(raw, resetParams) {
        const parsed = JSON.parse(raw);
        const base = defaultStore();
        const draft = Object.assign({}, base.draft, parsed.draft || {});
        if (resetParams) {
            draft.targetCount = DEFAULT_TARGET;
            draft.templateSets = DEFAULT_SETS;
        }
        return {
            nextIndex: Math.max(1, Number(parsed.nextIndex) || 1),
            history: Array.isArray(parsed.history) ? parsed.history : [],
            draft,
        };
    }

    function loadStore() {
        try {
            const current = localStorage.getItem(STORAGE_KEY);
            if (current) return parseStore(current, false);
            for (let i = 0; i < LEGACY_STORAGE_KEYS.length; i += 1) {
                const raw = localStorage.getItem(LEGACY_STORAGE_KEYS[i]);
                if (raw) return parseStore(raw, true);
            }
            return defaultStore();
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

    function leftMinRows() {
        return Math.max(DEFAULT_LEFT_ROWS, getTargetCount());
    }

    function lastFilledRowIndex(rows) {
        let last = -1;
        (rows || []).forEach((row, index) => {
            if (isFilledRow(row)) last = index;
        });
        return last;
    }

    function desiredLeftRowCount(rows) {
        const filledSpan = lastFilledRowIndex(rows) + 1;
        return Math.max(leftMinRows(), filledSpan + LEFT_SPARE_ROWS);
    }

    function emptyLeftGrid() {
        return Array.from({ length: leftMinRows() }, () => ['', '', '']);
    }

    function normalizeLeftRow(row) {
        const cells = Array.isArray(row) ? row : [];
        if (cells.length >= 3) {
            return [cellText(cells[0]), cellText(cells[1]), cellText(cells[2])];
        }
        return ['', cellText(cells[0]), cellText(cells[1])];
    }

    function cellText(value) {
        return value == null ? '' : String(value).trim();
    }

    function isFilledRow(row) {
        return Array.isArray(row) && row.some((c) => cellText(c));
    }

    function useSign() {
        return store.draft.useSignature !== false;
    }

    function inspectLeftRows() {
        const data = leftHot ? leftHot.getSourceData() : [];
        const signed = useSign();
        const filled = [];
        let missingTitle = false;
        let missingContent = false;
        let missingSign = false;
        (data || []).forEach((row) => {
            const [sign, title, content] = normalizeLeftRow(row);
            if (signed) {
                if (!sign && !title && !content) return;
            } else if (!title && !content) {
                return;
            }
            filled.push([sign, title, content]);
            if (!title) missingTitle = true;
            if (!content) missingContent = true;
            if (signed && title && content && !sign) missingSign = true;
        });
        return {
            filled,
            complete: filled.filter((item) => item[1] && item[2]),
            missingTitle,
            missingContent,
            missingSign,
        };
    }

    function readOriginalPairs() {
        return inspectLeftRows().filled.map((row) => [row[0], row[1], row[2]]);
    }

    function hasAllocErrors(info, target) {
        const rows = info || inspectLeftRows();
        const n = Number.isFinite(target) ? target : getTargetCount();
        return !!(
            rows.missingTitle
            || rows.missingContent
            || rows.missingSign
            || (rows.filled.length && rows.complete.length < n)
        );
    }

    function takeTargetPairs(pairs, target) {
        const list = Array.isArray(pairs) ? pairs : [];
        const n = Math.max(0, Number(target) || 0);
        if (!list.length || n <= 0) return [];
        return list.slice(0, n);
    }

    function updateAllocHint(info, target) {
        if (!el.allocHint) return;
        const rows = info || inspectLeftRows();
        const n = Number.isFinite(target) ? target : getTargetCount();
        const msgs = [];
        if (rows.missingTitle) msgs.push('缺标题');
        if (rows.missingContent) msgs.push('缺内容');
        if (rows.missingSign) msgs.push('没有署名');
        if (rows.filled.length && rows.complete.length < n) msgs.push('文案不够');
        el.allocHint.textContent = msgs.join(' / ');
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
                if (useSign()) {
                    row.push(item ? item[0] : '', item ? item[1] : '', item ? item[2] : '');
                } else {
                    row.push(item ? item[1] : '', item ? item[2] : '');
                }
            }
            grid.push(row);
        }
        return grid;
    }

    function rightHeaders(sets) {
        const headers = [];
        for (let i = 1; i <= sets; i += 1) {
            if (useSign()) headers.push(`署名${i}`);
            headers.push(`标题${i}`, `内容${i}`);
        }
        return headers;
    }

    function signColumn() {
        return { type: 'text', width: COL_SIGN_W, wordWrap: false };
    }

    function titleColumn() {
        return { type: 'text', width: COL_TITLE_W, wordWrap: false };
    }

    function contentColumn() {
        return { type: 'text', width: COL_CONTENT_W, wordWrap: false };
    }

    function rightColumns(sets) {
        const columns = [];
        for (let i = 0; i < sets; i += 1) {
            if (useSign()) columns.push(signColumn());
            columns.push(titleColumn(), contentColumn());
        }
        return columns;
    }

    function colsPerSet() {
        return useSign() ? 3 : 2;
    }

    function emptyRightRow() {
        return useSign() ? ['', '', ''] : ['', ''];
    }

    function leftTableWidth() {
        const cols = (useSign() ? COL_SIGN_W : 0) + COL_TITLE_W + COL_CONTENT_W;
        return 36 + cols;
    }

    function rightTableWidth(sets) {
        const pairW = (useSign() ? COL_SIGN_W : 0) + COL_TITLE_W + COL_CONTENT_W;
        return 36 + Math.max(1, Number(sets) || 1) * pairW;
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
            useSignature: useSign(),
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

    function syncLeftRowCount() {
        if (!leftHot || leftHot.isDestroyed || syncingLeftRows) return;
        const want = desiredLeftRowCount(leftHot.getSourceData());
        const have = leftHot.countRows();
        if (have === want) return;
        syncingLeftRows = true;
        try {
            if (have < want) {
                leftHot.alter('insert_row_below', Math.max(0, have - 1), want - have);
            } else {
                leftHot.alter('remove_row', want, have - want);
            }
        } finally {
            syncingLeftRows = false;
        }
    }

    function scheduleLeftTableMaintenance() {
        if (syncingLeftRows) return;
        clearTimeout(leftSyncTimer);
        leftSyncTimer = setTimeout(() => {
            if (syncingLeftRows) return;
            syncLeftRowCount();
            persistDraft();
            scheduleRefresh();
        }, 0);
    }

    function refreshLeftTargetRows() {
        syncLeftRowCount();
        if (leftHot && !leftHot.isDestroyed) leftHot.render();
    }

    function applyRightTable() {
        if (!rightHot || rightHot.isDestroyed) return;
        const sets = getTemplateSets();
        const target = getTargetCount();
        const info = inspectLeftRows();
        const pairs = takeTargetPairs(info.complete, target);
        const grid = pairsToGrid(pairs, sets);
        suppressHotSelect = true;
        try {
            rightHot.updateSettings({
                colHeaders: rightHeaders(sets),
                columns: rightColumns(sets),
                stretchH: 'none',
                width: rightTableWidth(sets),
                height: 'auto',
            });
            rightHot.loadData(grid.length ? grid : [emptyRightRow()]);
        } finally {
            suppressHotSelect = false;
        }
        updateCounts(info.filled, grid, sets);
        updateAllocHint(info, target);
        persistDraft();
    }

    function refreshRight(force) {
        if (!rightHot || rightHot.isDestroyed) return;
        if (!force && anyEditorOpen()) {
            pendingRefresh = true;
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => refreshRight(false), 80);
            return;
        }
        pendingRefresh = false;
        applyRightTable();
    }

    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => refreshRight(false), 80);
    }

    function ensureLeftSpare(rows) {
        const list = Array.isArray(rows)
            ? rows.map((r) => {
                const cells = Array.isArray(r) ? r : [];
                if (cells.length >= 3) {
                    return [
                        cells[0] != null ? String(cells[0]) : '',
                        cells[1] != null ? String(cells[1]) : '',
                        cells[2] != null ? String(cells[2]) : '',
                    ];
                }
                return [
                    '',
                    cells[0] != null ? String(cells[0]) : '',
                    cells[1] != null ? String(cells[1]) : '',
                ];
            })
            : [];
        const filled = list.filter(isFilledRow);
        const out = filled.length ? filled.slice() : [];
        const min = desiredLeftRowCount(out);
        while (out.length < min) out.push(['', '', '']);
        return out;
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
                            const sel = hot.getSelectedLast && hot.getSelectedLast();
                            const multi = !!(sel && (sel[0] !== sel[2] || sel[1] !== sel[3]));
                            const grid = resolvePasteGrid(text, html);
                            if (isMultiCellGrid(grid) || multi) pasteIntoSelectionLikeExcel(hot, text, html);
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
            tableClassName: 'app-handsontable',
            className: 'htLeft htMiddle',
            height: '100%',
            rowHeights: ROW_H,
            columnHeaderHeight: 28,
            rowHeaderWidth: 36,
            renderAllRows: true,
            allowInsertRow: true,
            allowRemoveRow: true,
            stretchH: 'none',
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

    function isHotSurface(target) {
        if (!target) return false;
        if (target.classList && (target.classList.contains('handsontableInput') || target.classList.contains('handsontableInputHolder'))) {
            return true;
        }
        return !!(target.closest && target.closest('#leftHot, #rightHot, .handsontable, .handsontableInputHolder, .htContextMenu'));
    }

    function isNativeTextField(target) {
        if (!target || isHotSurface(target)) return false;
        if (target.isContentEditable) return true;
        const tag = String(target.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'SELECT';
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

    function cellClipboardText(node) {
        return String(node && node.textContent != null ? node.textContent : '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    }

    function parseHtmlTable(html) {
        const src = String(html == null ? '' : html);
        if (!src || !/<(table|tr|td|th)\b/i.test(src)) return null;
        try {
            const doc = new DOMParser().parseFromString(src, 'text/html');
            const table = doc.querySelector('table');
            if (!table) return null;
            if (table.getAttribute('data-ht-copy') === 'cell') {
                const td = table.querySelector('th,td');
                return [[cellClipboardText(td)]];
            }
            const rows = [];
            table.querySelectorAll('tr').forEach((tr) => {
                const cells = Array.from(tr.querySelectorAll('th,td')).map((td) => cellClipboardText(td));
                if (cells.length) rows.push(cells);
            });
            return rows.length ? rows : null;
        } catch (e) {
            return null;
        }
    }

    function unwrapQuotedClipboard(plain) {
        let s = String(plain == null ? '' : plain).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (s.endsWith('\n') && s.indexOf('\n') !== s.length - 1) s = s.slice(0, -1);
        if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
            return s.slice(1, -1).replace(/""/g, '"');
        }
        return null;
    }

    function extractCopiedCellValue(plain, html) {
        if (html && /data-ht-copy\s*=\s*["']cell["']/.test(html)) {
            const fromHtml = parseHtmlTable(html);
            if (fromHtml && fromHtml[0]) return fromHtml[0][0] == null ? '' : String(fromHtml[0][0]);
        }
        const htmlGrid = parseHtmlTable(html);
        if (isSingleCellGrid(htmlGrid)) return htmlGrid[0][0] == null ? '' : String(htmlGrid[0][0]);
        const quoted = unwrapQuotedClipboard(plain);
        if (quoted !== null) return quoted;
        const plainGrid = parseSheetClip(plain);
        if (isSingleCellGrid(plainGrid)) return plainGrid[0][0] == null ? '' : String(plainGrid[0][0]);
        return null;
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
            if (ch === '"' && cell === '') {
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

    function isSingleCellGrid(grid) {
        return !!(grid && grid.length === 1 && grid[0] && grid[0].length === 1);
    }

    function quoteCount(grid) {
        let n = 0;
        (grid || []).forEach((row) => {
            (row || []).forEach((cell) => {
                const s = String(cell == null ? '' : cell);
                for (let i = 0; i < s.length; i += 1) {
                    if (s.charAt(i) === '"') n += 1;
                }
            });
        });
        return n;
    }

    function sameGridShape(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if ((a[i] || []).length !== (b[i] || []).length) return false;
        }
        return true;
    }

    function pickPasteGrid(preferred, other) {
        if (!preferred) return other;
        if (!other) return preferred;
        if (sameGridShape(preferred, other) && quoteCount(other) > quoteCount(preferred)) return other;
        return preferred;
    }

    function resolvePasteGrid(plain, html) {
        const fromHtml = parseHtmlTable(html);
        const fromPlain = parseSheetClip(plain);
        // 单格 HTML 优先：单元格内换行不能被 text/plain 拆成多行
        if (isSingleCellGrid(fromHtml)) return pickPasteGrid(fromHtml, fromPlain);
        if (isSingleCellGrid(fromPlain)) return fromPlain;
        if (isMultiCellGrid(fromPlain)) return pickPasteGrid(fromPlain, fromHtml);
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

    function isColHidden(hot, col) {
        const plugin = hot.getPlugin && hot.getPlugin('hiddenColumns');
        if (plugin && typeof plugin.isHidden === 'function') return !!plugin.isHidden(col);
        if (plugin && typeof plugin.getHiddenColumns === 'function') {
            const hidden = plugin.getHiddenColumns() || [];
            return hidden.indexOf(col) !== -1;
        }
        return false;
    }

    function pasteValueIntoSelection(hot, text) {
        if (!hot || hot.isDestroyed) return false;
        const ranges = hot.getSelected && hot.getSelected();
        if (!ranges || !ranges.length) return false;
        const value = String(text == null ? '' : text);
        const maxCols = hot.countCols ? hot.countCols() : Infinity;
        let lastRow = 0;
        ranges.forEach((range) => {
            lastRow = Math.max(lastRow, Math.max(range[0], range[2]));
        });
        ensureRowsForPaste(hot, lastRow);
        const changes = [];
        ranges.forEach((range) => {
            const r1 = Math.min(range[0], range[2]);
            const r2 = Math.max(range[0], range[2]);
            const c1 = Math.min(range[1], range[3]);
            const c2 = Math.max(range[1], range[3]);
            for (let r = r1; r <= r2; r += 1) {
                for (let c = c1; c <= c2; c += 1) {
                    if (r < 0 || c < 0 || c >= maxCols || isColHidden(hot, c)) continue;
                    const meta = hot.getCellMeta(r, c) || {};
                    if (meta.readOnly || meta.editor === false) continue;
                    changes.push([r, c, value]);
                }
            }
        });
        if (!changes.length) return false;
        hot.setDataAtCell(changes, 'CopyPaste.paste');
        return true;
    }

    function pasteIntoSelectionLikeExcel(hot, plain, html) {
        if (!hot || hot.isDestroyed) return false;
        const cellValue = extractCopiedCellValue(plain, html);
        if (cellValue !== null) return pasteValueIntoSelection(hot, cellValue);
        const grid = resolvePasteGrid(plain, html);
        if (isMultiCellGrid(grid)) return pasteGridAtAnchor(hot, grid);
        const one = grid[0] && grid[0][0] != null ? grid[0][0] : plain;
        return pasteValueIntoSelection(hot, one);
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
        const single = !!(data && data.length === 1 && data[0] && data[0].length === 1);
        const rows = (data || []).map((row) => {
            const tds = (row || []).map((c) => `<td>${escapeHtml(c)}</td>`).join('');
            return `<tr>${tds}</tr>`;
        }).join('');
        return `<table data-ht-copy="${single ? 'cell' : 'grid'}">${rows}</table>`;
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
            if (isMultiCellGrid(grid) || multi) pasteIntoSelectionLikeExcel(hot, plain, html);
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

    function tableFocusHooks() {
        return {
            afterOnCellMouseDown() {
                lastActiveHot = this;
            },
            afterFinishEditing() {
                if (this === leftHot) scheduleRefresh();
            },
            afterSelection() {
                if (suppressHotSelect || !hotHasSelection(this)) return;
                setActiveHot(this);
            },
        };
    }

    function renderLeftHot() {
        const container = document.getElementById('leftHot');
        leftHot = new Handsontable(container, {
            data: emptyLeftGrid(),
            rowHeaders: true,
            colHeaders: ['署名', '标题', '内容'],
            columns: [
                signColumn(),
                titleColumn(),
                contentColumn(),
            ],
            minSpareRows: 0,
            minRows: leftMinRows(),
            ...sharedHotSettings(),
            stretchH: 'none',
            width: leftTableWidth(),
            height: 'auto',
            hiddenColumns: {
                columns: useSign() ? [] : [0],
                indicators: false,
                copyPasteEnabled: false,
            },
            contextMenu: buildContextMenu(() => leftHot),
            afterGetColHeader(col, TH) {
                TH.classList.add('ht-sc-header');
            },
            afterRenderer(td, row) {
                td.classList.toggle('ht-target-row', row < getTargetCount());
            },
            afterChange(changes, source) {
                if (!changes || source === 'loadData' || syncingLeftRows) return;
                scheduleLeftTableMaintenance();
            },
            afterCreateRow() {
                if (syncingLeftRows) return;
                scheduleLeftTableMaintenance();
            },
            afterRemoveRow() {
                if (syncingLeftRows) return;
                scheduleLeftTableMaintenance();
            },
            afterUndo() {
                scheduleLeftTableMaintenance();
            },
            afterRedo() {
                scheduleLeftTableMaintenance();
            },
            ...tableFocusHooks(),
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
            minRows: 1,
            ...sharedHotSettings(),
            width: rightTableWidth(sets),
            height: 'auto',
            stretchH: 'none',
            contextMenu: buildContextMenu(() => rightHot),
            afterGetColHeader(col, TH) {
                TH.classList.add('ht-sc-header');
            },
            ...tableFocusHooks(),
        });
    }

    function setClearPhase(phase) {
        const confirming = phase === 'confirm';
        el.btnClear.hidden = confirming;
        el.btnClearYes.hidden = !confirming;
        el.btnClearNo.hidden = !confirming;
    }

    function clearCopyContent() {
        pendingRefresh = false;
        clearTimeout(refreshTimer);
        suppressPersist = true;
        el.targetCount.value = String(DEFAULT_TARGET);
        el.templateSets.value = String(DEFAULT_SETS);
        if (leftHot) {
            try { leftHot.destroyEditor(true); } catch (e) { /* ignore */ }
            try { leftHot.deselectCell(); } catch (e) { /* ignore */ }
            leftHot.loadData(emptyLeftGrid());
        }
        store.draft.projectName = el.projectName.value;
        store.draft.filename = filenameInputValue();
        store.draft.filenameTouched = filenameTouched;
        store.draft.targetCount = DEFAULT_TARGET;
        store.draft.templateSets = DEFAULT_SETS;
        store.draft.originalRows = [];
        saveStore();
        suppressPersist = false;
        refreshRight(true);
        showToast('已清空设置/表格内容');
    }

    function clearLeftColumns(cols, message) {
        if (!leftHot || leftHot.isDestroyed) return;
        try { leftHot.destroyEditor(true); } catch (e) { /* ignore */ }
        const rows = leftHot.countRows();
        const changes = [];
        for (let r = 0; r < rows; r += 1) {
            cols.forEach((col) => changes.push([r, col, '']));
        }
        if (changes.length) leftHot.setDataAtCell(changes, 'Clear.column');
        persistDraft();
        scheduleRefresh();
        showToast(message);
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
        const info = inspectLeftRows();
        const target = getTargetCount();
        updateAllocHint(info, target);
        if (hasAllocErrors(info, target) && !window.confirm('有报错，是否继续导出?')) {
            return;
        }
        if (!info.complete.length) {
            showToast(el.allocHint.textContent || '请先输入原始文案', true);
            return;
        }
        const sets = getTemplateSets();
        const pairs = takeTargetPairs(info.complete, target);
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

    function updateSignToggleUi() {
        if (!el.signToggle) return;
        el.signToggle.value = useSign() ? '1' : '0';
    }

    function applySignMode() {
        if (el.app) el.app.classList.toggle('no-sign', !useSign());
        updateSignToggleUi();
        if (leftHot && !leftHot.isDestroyed) {
            leftHot.updateSettings({
                hiddenColumns: {
                    columns: useSign() ? [] : [0],
                    indicators: false,
                    copyPasteEnabled: false,
                },
                stretchH: 'none',
                width: leftTableWidth(),
                height: 'auto',
            });
            try { leftHot.refreshDimensions(); } catch (e) { /* ignore */ }
        }
    }

    function setUseSign(on) {
        store.draft.useSignature = !!on;
        applySignMode();
        persistDraft();
        refreshRight(true);
        requestAnimationFrame(refreshTablesSize);
    }

    function restoreDraft() {
        const draft = store.draft || {};
        suppressPersist = true;
        el.projectName.value = draft.projectName || '';
        el.targetCount.value = String(clampInt(draft.targetCount, 1, MAX_TARGET, DEFAULT_TARGET));
        el.templateSets.value = String(clampInt(draft.templateSets, 1, MAX_SETS, DEFAULT_SETS));
        filenameTouched = !!draft.filenameTouched;
        if (typeof draft.useSignature !== 'boolean') draft.useSignature = true;
        store.draft.useSignature = draft.useSignature;
        if (leftHot) leftHot.loadData(ensureLeftSpare(draft.originalRows));
        if (filenameTouched && draft.filename) el.filenameBox.value = draft.filename;
        applySignMode();
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
        el.targetCount.addEventListener('input', () => {
            persistDraft();
            refreshLeftTargetRows();
            scheduleRefresh();
        });
        el.templateSets.addEventListener('input', scheduleRefresh);
        el.targetCount.addEventListener('change', () => {
            el.targetCount.value = String(getTargetCount());
            persistDraft();
            refreshLeftTargetRows();
            scheduleRefresh();
        });
        el.templateSets.addEventListener('change', () => {
            el.templateSets.value = String(getTemplateSets());
            scheduleRefresh();
        });
        [el.targetCount, el.templateSets].forEach((input) => {
            input.addEventListener('focus', () => input.select());
            input.addEventListener('mouseup', (event) => event.preventDefault());
        });
        if (el.signToggle) {
            el.signToggle.addEventListener('change', () => {
                setUseSign(el.signToggle.value === '1');
            });
        }
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
            clearCopyContent();
            setClearPhase('idle');
        });
        if (el.btnClearSign) {
            el.btnClearSign.addEventListener('click', () => {
                clearLeftColumns([0], '已清空署名');
            });
        }
        if (el.btnClearTitleContent) {
            el.btnClearTitleContent.addEventListener('click', () => {
                clearLeftColumns([1, 2], '已清空标题/内容');
            });
        }
        el.btnExport.addEventListener('click', exportCsv);
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !el.historyDrawer.hidden) closeHistory();
        });
    }

    bindClipboardEvents();
    renderLeftHot();
    renderRightHot();
    bindUi();
    restoreDraft();
    window.__leftHot = leftHot;
    window.__rightHot = rightHot;
    requestAnimationFrame(refreshTablesSize);
})();
