import { createEffect, createSignal } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import { seedState } from '../data/seed';
import type { CoderId, CodingState, PersistedEnvelope, Segment, Theme } from '../types';
import { adjudicationIsStale, emptyAdjudication, sameAssignments } from '../utils/adjudication';
import { readEnvelope, writeEnvelope } from '../utils/db';

const STORAGE_KEY = 'sologsb-1019-state-v1';
const TAB_ID = crypto.randomUUID();

/** 兼容旧数据：补齐裁决人、裁决字段，并把依据已对不上的旧裁决退回待裁决（原记录留存）。 */
const migrateState = (state: CodingState): CodingState => {
  const next = state as CodingState;
  if (typeof next.adjudicator !== 'string') next.adjudicator = '首席研究员';
  if (!Array.isArray(next.segments)) return next;
  next.segments.forEach((segment) => {
    if (!segment.adjudication) {
      segment.adjudication = emptyAdjudication();
      return;
    }
    if (!Array.isArray(segment.adjudication.history)) segment.adjudication.history = [];
    if (segment.adjudication.current && adjudicationIsStale(segment)) {
      segment.adjudication.history.unshift({
        ...segment.adjudication.current,
        archivedAt: next.updatedAt ?? new Date().toISOString(),
        supersededReason: 'judgment-changed'
      });
      segment.adjudication.current = null;
    }
  });
  return next;
};

const loadLocal = (): CodingState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateState(JSON.parse(raw) as CodingState);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return seedState();
};

const cloneState = (state: CodingState): CodingState => structuredClone(unwrap(state));

/** 任何写操作之后统一校验：A/B 判断已变化的裁决一律作废，回到待裁决，原记录转入 history 备查。 */
const invalidateStaleAdjudications = (draft: CodingState) => {
  draft.segments.forEach((segment) => {
    const adjudication = segment.adjudication;
    if (adjudication?.current && adjudicationIsStale(segment)) {
      adjudication.history.unshift({
        ...adjudication.current,
        archivedAt: draft.updatedAt,
        supersededReason: 'judgment-changed'
      });
      adjudication.current = null;
    }
  });
};

const [state, setState] = createStore<CodingState>(loadLocal());
const [undoStack, setUndoStack] = createSignal<CodingState[]>([]);
const [redoStack, setRedoStack] = createSignal<CodingState[]>([]);
const [remoteEnvelope, setRemoteEnvelope] = createSignal<PersistedEnvelope | null>(null);
const [storageReady, setStorageReady] = createSignal(false);
const [lastSavedAt, setLastSavedAt] = createSignal<Date | null>(null);
let channel: BroadcastChannel | null = null;
let saveTimer: number | undefined;

const persist = (snapshot: CodingState) => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const envelope: PersistedEnvelope = {
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      writerId: TAB_ID,
      state: snapshot
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    await writeEnvelope(envelope);
    setLastSavedAt(new Date());
    channel?.postMessage(envelope);
  }, 180);
};

createEffect(() => {
  const snapshot = cloneState(state);
  if (!storageReady()) return;
  persist(snapshot);
});

const transaction = (action: string, detail: string, mutator: (draft: CodingState) => void) => {
  setUndoStack((items) => [...items.slice(-49), cloneState(state)]);
  setRedoStack([]);
  const next = cloneState(state);
  next.revision = state.revision + 1;
  next.updatedAt = new Date().toISOString();
  mutator(next);
  invalidateStaleAdjudications(next);
  next.audit.unshift({ id: crypto.randomUUID(), at: next.updatedAt, action, detail });
  next.audit = next.audit.slice(0, 250);
  setState(reconcile(next, { merge: false }));
  persist(next);
};

const buildTreeOrder = (themes: Theme[]) => {
  const children = new Map<string | null, Theme[]>();
  themes.forEach((theme) => children.set(theme.parentId, [...(children.get(theme.parentId) ?? []), theme]));
  const result: Theme[] = [];
  const visit = (parentId: string | null, depth: number) => {
    [...(children.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).forEach((theme) => {
      result.push({ ...theme, name: `${'　'.repeat(depth)}${theme.name}` });
      visit(theme.id, depth + 1);
    });
  };
  visit(null, 0);
  return result;
};

const parseTranscript = (raw: string, speakerFallback: string): Array<Pick<Segment, 'time' | 'speaker' | 'text'>> => {
  const rows = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return rows.map((line, index) => {
    const timed = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:[-—])?\s*([^:：]{1,24})[:：]\s*(.+)$/);
    if (timed) return { time: timed[1], speaker: timed[2].trim(), text: timed[3].trim() };
    return { time: `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`, speaker: index % 2 === 0 ? speakerFallback : '访谈者', text: line };
  });
};

export function useCodingStore() {
  const initialize = async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      const stored = await readEnvelope();
      const local = cloneState(state);
      if (stored && (stored.revision > local.revision || stored.updatedAt > local.updatedAt)) {
        setRemoteEnvelope(stored);
      }
    } finally {
      setStorageReady(true);
    }

    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('sologsb-1019-coding');
      channel.onmessage = (event: MessageEvent<PersistedEnvelope>) => {
        const incoming = event.data;
        if (!incoming || incoming.writerId === TAB_ID) return;
        if (incoming.revision === state.revision && incoming.updatedAt === state.updatedAt) return;
        setRemoteEnvelope(incoming);
      };
    }
  };

  const undo = () => {
    const items = undoStack();
    if (!items.length) return;
    const previous = items[items.length - 1];
    setUndoStack(items.slice(0, -1));
    setRedoStack((redo) => [...redo, cloneState(state)]);
    setState(reconcile(previous, { merge: false }));
    persist(previous);
  };

  const redo = () => {
    const items = redoStack();
    if (!items.length) return;
    const next = items[items.length - 1];
    setRedoStack(items.slice(0, -1));
    setUndoStack((undoItems) => [...undoItems, cloneState(state)]);
    setState(reconcile(next, { merge: false }));
    persist(next);
  };

  const selectSegment = (id: string) => setState('activeSegmentId', id);
  const selectTranscript = (id: string) => setState('activeTranscriptId', id);
  const selectTheme = (id: string) => setState('activeThemeId', id);
  const setCoder = (coder: CoderId, name: string) => {
    if (coder === 'A') setState('coderA', name);
    else setState('coderB', name);
  };
  const setAdjudicator = (name: string) => setState('adjudicator', name);

  const toggleAssignment = (segmentId: string, coder: CoderId, themeId: string, enabled: boolean) => {
    transaction('调整编码', `${coder === 'A' ? state.coderA : state.coderB} ${enabled ? '添加' : '移除'}主题`, (draft) => {
      const segment = draft.segments.find((item) => item.id === segmentId);
      if (!segment) return;
      const codes = new Set(segment.assignments[coder]);
      if (enabled) codes.add(themeId);
      else codes.delete(themeId);
      segment.assignments[coder] = [...codes];
    });
  };

  const batchAssign = (segmentIds: string[], coder: CoderId, themeId: string) => {
    if (!segmentIds.length) return;
    transaction('批量重编码', `将 ${segmentIds.length} 个片段分配给主题`, (draft) => {
      draft.segments.forEach((segment) => {
        if (segmentIds.includes(segment.id) && !segment.assignments[coder].includes(themeId)) segment.assignments[coder].push(themeId);
      });
    });
  };

  const addTheme = (name: string, parentId: string | null) => {
    const id = `t-${crypto.randomUUID()}`;
    transaction('新建主题', name, (draft) => {
      draft.themes.push({ id, name, parentId, color: parentId ? '#57978c' : '#267365', definition: '', memo: '', examples: [] });
      draft.activeThemeId = id;
    });
    return id;
  };

  const updateTheme = (themeId: string, patch: Partial<Theme>, fieldLabel: string) => {
    transaction('编辑主题', fieldLabel, (draft) => {
      const theme = draft.themes.find((item) => item.id === themeId);
      if (theme) Object.assign(theme, patch);
    });
  };

  const deleteTheme = (themeId: string) => {
    const theme = state.themes.find((item) => item.id === themeId);
    if (!theme) return;
    transaction('删除主题', theme.name, (draft) => {
      draft.themes = draft.themes.filter((item) => item.id !== themeId);
      draft.themes.forEach((item) => { if (item.parentId === themeId) item.parentId = null; });
      draft.segments.forEach((segment) => {
        segment.assignments.A = segment.assignments.A.filter((id) => id !== themeId);
        segment.assignments.B = segment.assignments.B.filter((id) => id !== themeId);
      });
      if (draft.activeThemeId === themeId) draft.activeThemeId = draft.themes[0]?.id ?? '';
    });
  };

  const mergeThemes = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    transaction('合并主题', `${state.themes.find((item) => item.id === sourceId)?.name ?? sourceId} → ${state.themes.find((item) => item.id === targetId)?.name ?? targetId}`, (draft) => {
      draft.segments.forEach((segment) => {
        (['A', 'B'] as CoderId[]).forEach((coder) => {
          const codes = new Set(segment.assignments[coder].filter((id) => id !== sourceId));
          if (segment.assignments[coder].includes(sourceId)) codes.add(targetId);
          segment.assignments[coder] = [...codes];
        });
      });
      draft.themes.forEach((theme) => { if (theme.parentId === sourceId) theme.parentId = targetId; });
      draft.themes = draft.themes.filter((theme) => theme.id !== sourceId);
      draft.activeThemeId = targetId;
    });
  };

  const splitTheme = (sourceId: string, newName: string, segmentIds: string[]) => {
    const newId = `t-${crypto.randomUUID()}`;
    transaction('拆分主题', newName, (draft) => {
      const source = draft.themes.find((theme) => theme.id === sourceId);
      if (!source) return;
      draft.themes.push({ ...source, id: newId, name: newName, examples: [] });
      draft.segments.forEach((segment) => {
        if (!segmentIds.includes(segment.id)) return;
        (['A', 'B'] as CoderId[]).forEach((coder) => {
          if (segment.assignments[coder].includes(sourceId)) {
            segment.assignments[coder] = segment.assignments[coder].map((id) => id === sourceId ? newId : id);
          }
        });
      });
      draft.activeThemeId = newId;
    });
    return newId;
  };

  const updateSegment = (segmentId: string, patch: Pick<Segment, 'speaker' | 'time' | 'text' | 'note'>) => {
    transaction('编辑片段', `片段 ${segmentId}`, (draft) => {
      const segment = draft.segments.find((item) => item.id === segmentId);
      if (segment) Object.assign(segment, patch);
    });
  };

  const importTranscript = (raw: string, title: string, participant: string, sourceName: string) => {
    const transcriptId = `tr-${crypto.randomUUID()}`;
    const rows = parseTranscript(raw, participant);
    transaction('导入转写', `${title}（${rows.length} 个片段）`, (draft) => {
      draft.transcripts.push({ id: transcriptId, title, participant, importedAt: new Date().toISOString(), sourceName });
      const start = draft.segments.length;
      const segments: Segment[] = rows.map((row, index) => ({
        id: `s-${crypto.randomUUID()}`,
        transcriptId,
        order: start + index,
        speaker: row.speaker,
        time: row.time,
        text: row.text,
        assignments: { A: [], B: [] },
        note: '',
        adjudication: emptyAdjudication()
      }));
      draft.segments.push(...segments);
      draft.activeTranscriptId = transcriptId;
      draft.activeSegmentId = segments[0]?.id ?? draft.activeSegmentId;
    });
  };

  const addExample = (themeId: string, example: string) => {
    const trimmed = example.trim();
    if (!trimmed) return;
    transaction('添加主题示例', trimmed, (draft) => {
      const theme = draft.themes.find((item) => item.id === themeId);
      if (theme && !theme.examples.includes(trimmed)) theme.examples.push(trimmed);
    });
  };

  /**
   * 对分歧片段作出裁决。
   * - resolved：以 finalThemeIds 作为最终判断（立即进入主题树计数与导出）；
   * - deferred：保留分歧，继续出现在待裁决清单。
   * 裁决冻结当时两份 A/B 判断；之后任一判断被修改，由 transaction 统一作废此裁决。
   */
  const adjudicate = (segmentId: string, status: 'resolved' | 'deferred', finalThemeIds: string[], note: string) => {
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment || sameAssignments(segment.assignments.A, segment.assignments.B)) return;
    const themeName = (id: string) => state.themes.find((theme) => theme.id === id)?.name ?? '未知主题';
    const label = status === 'resolved'
      ? `最终采用：${finalThemeIds.length ? finalThemeIds.map(themeName).join('、') : '未编码'}`
      : '保留分歧，继续讨论';
    transaction('分歧裁决', `${segment.time} · ${segment.speaker}｜${label}`, (draft) => {
      const target = draft.segments.find((item) => item.id === segmentId)!;
      target.adjudication ??= emptyAdjudication();
      if (target.adjudication.current) {
        target.adjudication.history.unshift({
          ...target.adjudication.current,
          archivedAt: draft.updatedAt,
          supersededReason: 're-adjudicated'
        });
      }
      target.adjudication.current = {
        at: draft.updatedAt,
        adjudicator: draft.adjudicator.trim() || '首席研究员',
        status,
        finalThemeIds: status === 'resolved' ? [...finalThemeIds] : [],
        basisA: [...target.assignments.A],
        basisB: [...target.assignments.B],
        note: note.trim()
      };
    });
  };

  const exportCoding = (format: 'json' | 'csv') => {
    const themeMap = new Map(state.themes.map((theme) => [theme.id, theme]));
    if (format === 'json') return JSON.stringify({ exportedAt: new Date().toISOString(), ...cloneState(state) }, null, 2);
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const themePath = (id: string) => {
      const names: string[] = [];
      let current = themeMap.get(id);
      while (current) {
        names.unshift(current.name);
        current = current.parentId ? themeMap.get(current.parentId) : undefined;
      }
      return names.join(' / ');
    };
    const pathsOf = (ids: string[]) => (ids.length ? ids.map(themePath).join(' | ') : '未编码');
    const rows = [[
      '片段编号', '时间', '发言人', '原文',
      `编码者A(${state.coderA})判断主题`,
      `编码者B(${state.coderB})判断主题`,
      '裁决状态', '最终主题', '裁决人', '裁决时间',
      '裁决依据A', '裁决依据B', '历史裁决', '备忘录'
    ].map(escape).join(',')];
    state.segments.forEach((segment) => {
      const adjudication = segment.adjudication?.current ?? null;
      const statusLabel = sameAssignments(segment.assignments.A, segment.assignments.B)
        ? '一致'
        : !adjudication
          ? '待裁决'
          : adjudication.status === 'resolved'
            ? '已裁决'
            : '保留分歧';
      const historyNote = (segment.adjudication?.history ?? [])
        .map((item) => `${new Date(item.archivedAt).toLocaleString('zh-CN')} 作废：${item.supersededReason === 'judgment-changed' ? '判断已变更' : '重新裁决'}（${item.status === 'resolved' ? item.finalThemeIds.map(themePath).join(' | ') || '未编码' : '保留分歧'}）`)
        .join(' ⏎ ');
      rows.push([
        segment.id,
        segment.time,
        segment.speaker,
        segment.text,
        pathsOf(segment.assignments.A),
        pathsOf(segment.assignments.B),
        statusLabel,
        adjudication?.status === 'resolved' ? pathsOf(adjudication.finalThemeIds) : '',
        adjudication?.adjudicator ?? '',
        adjudication ? new Date(adjudication.at).toLocaleString('zh-CN') : '',
        adjudication ? pathsOf(adjudication.basisA) : '',
        adjudication ? pathsOf(adjudication.basisB) : '',
        historyNote,
        segment.note
      ].map(escape).join(','));
    });
    return `﻿${rows.join('\n')}`;
  };

  const downloadExport = (format: 'json' | 'csv') => {
    const content = exportCoding(format);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `访谈编码结果-${new Date().toISOString().slice(0, 10)}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const keepLocalVersion = () => {
    setRemoteEnvelope(null);
    transaction('处理多标签冲突', '保留当前标签页版本并生成新修订', () => undefined);
  };

  const applyRemoteVersion = () => {
    const remote = remoteEnvelope();
    if (!remote) return;
    setUndoStack((items) => [...items, cloneState(state)]);
    setRedoStack([]);
    setState(reconcile(migrateState(structuredClone(remote.state)), { merge: false }));
    setRemoteEnvelope(null);
  };

  const orderedThemes = () => buildTreeOrder(state.themes);

  return {
    state,
    initialize,
    undo,
    redo,
    canUndo: () => undoStack().length > 0,
    canRedo: () => redoStack().length > 0,
    selectSegment,
    selectTranscript,
    selectTheme,
    setCoder,
    setAdjudicator,
    toggleAssignment,
    batchAssign,
    addTheme,
    updateTheme,
    deleteTheme,
    mergeThemes,
    splitTheme,
    updateSegment,
    importTranscript,
    addExample,
    adjudicate,
    exportCoding,
    downloadExport,
    orderedThemes,
    remoteEnvelope,
    keepLocalVersion,
    applyRemoteVersion,
    storageReady,
    lastSavedAt
  };
}
