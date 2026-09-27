import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Button, Chip, Divider } from '@suid/material';
import type { AdjudicationRecord, Segment } from '../types';
import type { useCodingStore } from '../store/coding-store';
import { activeAdjudication, hasDisagreement, segmentAdjudicationState } from '../utils/adjudication';

type Store = ReturnType<typeof useCodingStore>;

type Filter = 'pending' | 'deferred' | 'resolved';

const formatAt = (at: string) => new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 状态徽标：每一行都能看出最终用了哪个主题、哪些片段还没谈拢 */
export function AdjudicationBadge(props: { store: Store; segment: Segment }) {
  const status = () => segmentAdjudicationState(props.store.state, props.segment);
  return (
    <Show when={status() !== 'agreed'}>
      <span class={`adj-badge ${status()}`}>
        {status() === 'pending' && '待裁决'}
        {status() === 'deferred' && '保留分歧'}
        {status() === 'resolved' && `⚖ ${props.store.state.themes.find((theme) => theme.id === activeAdjudication(props.store.state, props.segment.id)?.finalThemeId)?.name ?? '最终主题已删除'}`}
      </span>
    </Show>
  );
}

export function AdjudicationStatusBar(props: { store: Store; segmentId: string; onGoAdjudicate: () => void }) {
  const segment = () => props.store.state.segments.find((item) => item.id === props.segmentId);
  const status = () => {
    const current = segment();
    return current ? segmentAdjudicationState(props.store.state, current) : 'agreed' as const;
  };
  const record = () => {
    const current = segment();
    return current ? activeAdjudication(props.store.state, current.id) : undefined;
  };
  return (
    <Show when={status() !== 'agreed'}>
      <div class={`adj-statusbar ${status()}`}>
        <Show when={status() === 'pending'}>
          <span>该片段尚未裁决，等待研究者定下最终主题或保留分歧。</span>
          <Button size="small" variant="contained" onClick={props.onGoAdjudicate}>去裁决</Button>
        </Show>
        <Show when={status() === 'deferred'}>
          <span>已标记「保留分歧」，继续讨论中。{record()?.note}</span>
          <Button size="small" variant="outlined" onClick={props.onGoAdjudicate}>重新裁决</Button>
        </Show>
        <Show when={status() === 'resolved'}>
          <span>最终主题：<strong>{props.store.state.themes.find((theme) => theme.id === record()?.finalThemeId)?.name ?? '（主题已删除）'}</strong>。裁决后 A/B 任一判断若被修改，将自动回到待裁决。</span>
          <Button size="small" variant="outlined" onClick={props.onGoAdjudicate}>查看 / 修改</Button>
        </Show>
      </div>
    </Show>
  );
}

export default function AdjudicationWorkbench(props: { store: Store; onEditCompare: () => void }) {
  const [filter, setFilter] = createSignal<Filter>('pending');
  const [pickedTheme, setPickedTheme] = createSignal<string | null>(null);
  const [note, setNote] = createSignal('');

  // 待裁清单覆盖全部访谈，离开再回来（刷新 / 换标签页）状态随数据持久化
  const queue = createMemo(() => {
    const transcriptOrder = new Map(props.store.state.transcripts.map((item, index) => [item.id, index]));
    return props.store.state.segments
      .filter(hasDisagreement)
      .map((segment) => ({ segment, status: segmentAdjudicationState(props.store.state, segment) }))
      .sort((a, b) => (transcriptOrder.get(a.segment.transcriptId) ?? 0) - (transcriptOrder.get(b.segment.transcriptId) ?? 0) || a.segment.order - b.segment.order);
  });

  const counts = createMemo(() => ({
    pending: queue().filter((item) => item.status === 'pending').length,
    deferred: queue().filter((item) => item.status === 'deferred').length,
    resolved: queue().filter((item) => item.status === 'resolved').length
  }));

  const visible = createMemo(() => queue().filter((item) => item.status === filter()));

  const activeSegment = () => props.store.state.segments.find((item) => item.id === props.store.state.activeSegmentId);
  const activeItem = createMemo(() => {
    const current = activeSegment();
    if (!current || !hasDisagreement(current)) return undefined;
    return { segment: current, status: segmentAdjudicationState(props.store.state, current) as 'pending' | 'deferred' | 'resolved' };
  });
  const activeRecord = (): AdjudicationRecord | undefined => {
    const current = activeSegment();
    return current ? activeAdjudication(props.store.state, current.id) : undefined;
  };

  // 两位编码者提过的主题并集，作为裁决快捷候选
  const candidateThemes = createMemo(() => {
    const current = activeSegment();
    if (!current) return [];
    const ids = [...new Set([...current.assignments.A, ...current.assignments.B])];
    return ids.map((id) => props.store.state.themes.find((theme) => theme.id === id)).filter((theme): theme is NonNullable<typeof theme> => !!theme);
  });

  const transcriptTitle = (id: string) => props.store.state.transcripts.find((item) => item.id === id)?.title ?? '未知访谈';
  const themeName = (id: string) => props.store.state.themes.find((theme) => theme.id === id)?.name ?? '未知主题';

  // 切换选中片段时重置裁决表单
  const syncForm = (segment: Segment | undefined) => {
    const record = segment ? activeAdjudication(props.store.state, segment.id) : undefined;
    setPickedTheme(record?.outcome === 'resolved' ? record.finalThemeId : candidateThemes()[0]?.id ?? null);
    setNote(record?.note ?? '');
  };

  // 仅在切换选中片段时重置表单，避免无关事务打断正在填写的内容
  let lastSegmentId = '';
  createEffect(() => {
    const current = activeSegment();
    if (!current || current.id === lastSegmentId) return;
    lastSegmentId = current.id;
    if (hasDisagreement(current)) syncForm(current);
  });

  const selectAndFocus = (segmentId: string) => {
    const target = props.store.state.segments.find((item) => item.id === segmentId);
    if (target) {
      props.store.selectTranscript(target.transcriptId);
      props.store.selectSegment(segmentId);
      syncForm(target);
      document.querySelector('.segment-card.active')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const submitResolved = () => {
    const current = activeSegment();
    if (!current || !pickedTheme()) return;
    props.store.adjudicate(current.id, 'resolved', pickedTheme(), note());
  };
  const submitDeferred = () => {
    const current = activeSegment();
    if (!current) return;
    props.store.adjudicate(current.id, 'deferred', null, note());
  };

  const history = createMemo(() => {
    const current = activeSegment();
    return current ? props.store.adjudicationHistory(current.id) : [];
  });

  return (
    <div class="adj-panel">
      <div class="adj-summary">
        <button classList={{ active: filter() === 'pending' }} onClick={() => setFilter('pending')}>
          <strong>{counts().pending}</strong><span>待裁决</span>
        </button>
        <button classList={{ active: filter() === 'deferred' }} onClick={() => setFilter('deferred')}>
          <strong>{counts().deferred}</strong><span>保留分歧</span>
        </button>
        <button classList={{ active: filter() === 'resolved' }} onClick={() => setFilter('resolved')}>
          <strong>{counts().resolved}</strong><span>已裁决</span>
        </button>
      </div>

      <div class="adj-queue">
        <For each={visible()} fallback={<div class="muted">当前清单为空。{filter() === 'pending' ? '所有分歧都已有结论。' : ''}</div>}>
          {(item) => (
            <button
              class="adj-queue-item"
              classList={{ active: props.store.state.activeSegmentId === item.segment.id }}
              onClick={() => selectAndFocus(item.segment.id)}
            >
              <div class="adj-queue-meta">
                <span class={`adj-dot ${item.status}`} />
                <span>{transcriptTitle(item.segment.transcriptId)}</span>
                <span>{item.segment.time}</span>
              </div>
              <p>{item.segment.text}</p>
              <div class="adj-queue-themes">
                <span class="adj-side a">A：{item.segment.assignments.A.length ? item.segment.assignments.A.map(themeName).join('、') : '未编码'}</span>
                <span class="adj-side b">B：{item.segment.assignments.B.length ? item.segment.assignments.B.map(themeName).join('、') : '未编码'}</span>
                <Show when={item.status === 'resolved'}>
                  <span class="adj-final">⚖ {themeName(activeAdjudication(props.store.state, item.segment.id)?.finalThemeId ?? '')}</span>
                </Show>
              </div>
            </button>
          )}
        </For>
      </div>

      <Divider />

      <Show when={activeItem()} fallback={<div class="empty-state">从左侧正文或上方清单选择一个有分歧的片段，即可给出裁决。判断一致的片段无需裁决。</div>}>
        {(item) => {
          const current = () => item().segment;
          const record = () => activeAdjudication(props.store.state, current().id);
          return (
            <div class="adj-decision">
              <div class="adj-decision-head">
                <span class="eyebrow">DECISION</span>
                <AdjudicationBadge store={props.store} segment={current()} />
              </div>
              <blockquote class="adj-quote">“{current().text}”</blockquote>
              <div class="adj-coder-lines">
                <div><span class="avatar-a">A · {props.store.state.coderA}</span><For each={current().assignments.A} fallback={<em>未编码</em>}>{(id) => <Chip size="small" label={themeName(id)} />}</For></div>
                <div><span class="avatar-b">B · {props.store.state.coderB}</span><For each={current().assignments.B} fallback={<em>未编码</em>}>{(id) => <Chip size="small" label={themeName(id)} />}</For></div>
              </div>

              <Show when={record()} keyed>
                {(active) => (
                  <div class={`adj-prior ${active.outcome}`}>
                    {active.outcome === 'resolved'
                      ? <>当前裁决：最终主题为 <strong>{themeName(active.finalThemeId ?? '')}</strong>，{formatAt(active.decidedAt)} 决定。</>
                      : <>当前标记：保留分歧继续讨论，{formatAt(active.decidedAt)} 决定。</>}
                    <Show when={active.note}><p>备注：{active.note}</p></Show>
                  </div>
                )}
              </Show>

              <div class="adj-options">
                <div class="adj-options-label">选一个主题作为最终判断（来自两位编码者提过的主题）：</div>
                <div class="adj-option-list">
                  <For each={candidateThemes()}>{(candidate) => (
                    <button
                      class="adj-option"
                      classList={{ selected: pickedTheme() === candidate.id }}
                      style={{ '--option-color': candidate.color }}
                      onClick={() => setPickedTheme(candidate.id)}
                    >
                      <span class="theme-color" />{candidate.name}
                      <Show when={current().assignments.A.includes(candidate.id) && current().assignments.B.includes(candidate.id)}><i>双方共有</i></Show>
                    </button>
                  )}</For>
                </div>
                <select class="native-select full" value={candidateThemes().some((candidate) => candidate.id === pickedTheme()) ? '' : (pickedTheme() ?? '')} onChange={(event) => { if (event.currentTarget.value) setPickedTheme(event.currentTarget.value); }}>
                  <option value="">其他主题（从完整主题树选择）…</option>
                  <For each={props.store.orderedThemes()}>{(theme) => <option value={theme.id}>{theme.name}</option>}</For>
                </select>
              </div>

              <label class="field-label">裁决备注（可选）
                <textarea class="native-textarea" value={note()} onInput={(event) => setNote(event.currentTarget.value)} placeholder="记录选择理由、分歧焦点或待跟进问题" />
              </label>

              <div class="adj-actions">
                <Button size="small" variant="contained" disabled={!pickedTheme()} onClick={submitResolved}>定为最终主题</Button>
                <Button size="small" variant="outlined" color="warning" onClick={submitDeferred}>保留分歧，继续讨论</Button>
                <Show when={record()}>
                  <Button size="small" color="inherit" onClick={() => props.store.withdrawAdjudication(current().id)}>撤回裁决（回到待裁决）</Button>
                </Show>
                <Button size="small" onClick={props.onEditCompare}>修改 A / B 判断</Button>
              </div>

              <Show when={history().length > 1 || (history().length === 1 && !!history()[0].supersededAt)}>
                <div class="adj-history">
                  <div class="adj-history-title">历史裁决备查（{history().length}）</div>
                  <For each={history()}>{(entry) => (
                    <div class="adj-history-item" classList={{ stale: !!entry.supersededAt }}>
                      <div>
                        <strong>{entry.outcome === 'resolved' ? `最终：${themeName(entry.finalThemeId ?? '')}` : '保留分歧'}</strong>
                        <span>{formatAt(entry.decidedAt)}{entry.supersededAt ? ` · 已失效（${entry.supersedeReason || '判断已变更'}，${formatAt(entry.supersededAt)}）` : ' · 当前生效'}</span>
                      </div>
                      <Show when={entry.note}><p>{entry.note}</p></Show>
                    </div>
                  )}</For>
                </div>
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
