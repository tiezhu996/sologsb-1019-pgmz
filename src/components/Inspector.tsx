import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Button, Chip, Divider, Paper, Typography } from '@suid/material';
import type { Theme } from '../types';
import { ADJUDICATION_STATUS_LABEL, STATUS_LABEL, finalThemesOf, segmentStatus } from '../utils/adjudication';
import type { useCodingStore } from '../store/coding-store';

type Store = ReturnType<typeof useCodingStore>;

export default function Inspector(props: { store: Store }) {
  const [definition, setDefinition] = createSignal('');
  const [memo, setMemo] = createSignal('');
  const [example, setExample] = createSignal('');
  const [segmentNote, setSegmentNote] = createSignal('');
  const [section, setSection] = createSignal<'theme' | 'compare' | 'adjudicate' | 'audit'>('theme');

  const theme = createMemo(() => props.store.state.themes.find((item) => item.id === props.store.state.activeThemeId));
  const segment = createMemo(() => props.store.state.segments.find((item) => item.id === props.store.state.activeSegmentId));
  const citations = createMemo(() => {
    const current = theme();
    if (!current) return [];
    return props.store.state.segments.filter((item) => item.assignments.A.includes(current.id) || item.assignments.B.includes(current.id));
  });

  const themeName = (id: string) => props.store.state.themes.find((item) => item.id === id)?.name ?? '未知主题';

  createEffect(() => {
    const current = theme();
    setDefinition(current?.definition ?? '');
    setMemo(current?.memo ?? '');
    setExample('');
  });

  createEffect(() => setSegmentNote(segment()?.note ?? ''));

  const saveThemeField = (field: 'definition' | 'memo', value: string) => {
    const current = theme();
    if (!current || current[field] === value) return;
    props.store.updateTheme(current.id, { [field]: value } as Partial<Theme>, field === 'definition' ? '主题定义' : '研究备忘录');
  };

  const saveNote = () => {
    const current = segment();
    if (!current || current.note === segmentNote()) return;
    props.store.updateSegment(current.id, { speaker: current.speaker, time: current.time, text: current.text, note: segmentNote() });
  };

  return (
    <Paper class="panel inspector-panel" elevation={0}>
      <div class="panel-heading">
        <div>
          <Typography variant="overline">03 / 研究记录</Typography>
          <Typography variant="h6">主题与判断</Typography>
        </div>
      </div>
      <div class="inspector-tabs four">
        <button classList={{ active: section() === 'theme' }} onClick={() => setSection('theme')}>主题记事</button>
        <button classList={{ active: section() === 'compare' }} onClick={() => setSection('compare')}>双人比较</button>
        <button classList={{ active: section() === 'adjudicate' }} onClick={() => setSection('adjudicate')}>裁决</button>
        <button classList={{ active: section() === 'audit' }} onClick={() => setSection('audit')}>操作记录</button>
      </div>
      <Divider />

      <Show when={section() === 'theme'}>
        <Show when={theme()} fallback={<div class="empty-state">从中间主题树选择一个主题，添加定义、备忘录和示例。</div>}>
          {(current) => <>
            <div class="selected-theme-title"><span style={{ background: current().color }} /> <strong>{current().name}</strong></div>
            <Show when={segment()}>
              {(activeSegment) => <div class="quote-card">
                <div class="quote-meta">{activeSegment().time} · {activeSegment().speaker}</div>
                <blockquote>“{activeSegment().text}”</blockquote>
                <button class="link-button" onClick={() => document.querySelector('.segment-card.active')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>↗ 回到原文位置</button>
              </div>}
            </Show>
            <label class="field-label">操作定义
              <textarea class="native-textarea" value={definition()} onInput={(event) => setDefinition(event.currentTarget.value)} onBlur={() => saveThemeField('definition', definition())} placeholder="说明什么内容应/不应归入该主题" />
            </label>
            <label class="field-label">研究备忘录
              <textarea class="native-textarea" value={memo()} onInput={(event) => setMemo(event.currentTarget.value)} onBlur={() => saveThemeField('memo', memo())} placeholder="记录判断边界、疑问或编码规则" />
            </label>
            <label class="field-label">添加典型示例
              <div class="inline-input">
                <input class="native-input" value={example()} onInput={(event) => setExample(event.currentTarget.value)} placeholder="输入示例文本" />
                <Button size="small" variant="contained" disabled={!example().trim()} onClick={() => { props.store.addExample(current().id, example()); setExample(''); }}>添加</Button>
              </div>
            </label>
            <Show when={current().examples.length} fallback={<div class="muted">暂无示例</div>}>
              <ul class="example-list"><For each={current().examples}>{(item) => <li>{item}</li>}</For></ul>
            </Show>
            <Show when={citations().length}>
              <div class="citation-heading">回原文引用 <span>{citations().length} 条</span></div>
              <div class="citation-list">
                <For each={citations()}>{(item) => (
                  <button class="citation-link" onClick={() => { props.store.selectSegment(item.id); window.setTimeout(() => document.querySelector('.segment-card.active')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }}>
                    <span>{item.time} · {item.speaker}</span>
                    <p>{item.text}</p>
                  </button>
                )}</For>
              </div>
            </Show>
          </>}
        </Show>
      </Show>

      <Show when={section() === 'compare'}>
        <Show when={segment()} fallback={<div class="empty-state">请先从左侧正文选择片段。</div>}>
          {(activeSegment) => <>
            <div class="compare-intro">比较同一位受访者在同一片段上的主题判断。任何不一致都会保留，直到研究者在“分歧裁决”中明确处理。</div>
            <div class="compare-grid">
              <div class="coder-column">
                <div class="coder-header"><span class="avatar">A</span><strong>{props.store.state.coderA}</strong></div>
                <For each={activeSegment().assignments.A} fallback={<div class="muted">未编码</div>}>{(id) => <div class="compare-chip"><Chip size="small" label={themeName(id)} /><button class="icon-text" onClick={() => props.store.toggleAssignment(activeSegment().id, 'A', id, false)}>×</button></div>}</For>
                <select class="native-select full" value="" onChange={(event) => event.currentTarget.value && props.store.toggleAssignment(activeSegment().id, 'A', event.currentTarget.value, true)}>
                  <option value="">＋ 给编码者 A 添加主题</option>
                  <For each={props.store.orderedThemes()}>{(item) => <option value={item.id}>{item.name}</option>}</For>
                </select>
              </div>
              <div class="coder-column">
                <div class="coder-header"><span class="avatar b">B</span><strong>{props.store.state.coderB}</strong></div>
                <For each={activeSegment().assignments.B} fallback={<div class="muted">未编码</div>}>{(id) => <div class="compare-chip"><Chip size="small" label={themeName(id)} /><button class="icon-text" onClick={() => props.store.toggleAssignment(activeSegment().id, 'B', id, false)}>×</button></div>}</For>
                <select class="native-select full" value="" onChange={(event) => event.currentTarget.value && props.store.toggleAssignment(activeSegment().id, 'B', event.currentTarget.value, true)}>
                  <option value="">＋ 给编码者 B 添加主题</option>
                  <For each={props.store.orderedThemes()}>{(item) => <option value={item.id}>{item.name}</option>}</For>
                </select>
              </div>
            </div>
            <div class={`status-banner ${segmentStatus(activeSegment())}`}>
              <Show when={segmentStatus(activeSegment()) === 'agreed'}>✓ 当前判断完全一致，无需裁决。</Show>
              <Show when={segmentStatus(activeSegment()) === 'pending'}>
                <span>⚠ 存在分歧，尚未裁决。</span>
                <button class="link-button strong" onClick={() => setSection('adjudicate')}>前往裁决 →</button>
              </Show>
              <Show when={segmentStatus(activeSegment()) === 'resolved'}>
                <span>✓ 已裁决，最终主题：{finalThemesOf(activeSegment()).map(themeName).join('、') || '未编码'}</span>
                <button class="link-button" onClick={() => setSection('adjudicate')}>查看/修改裁决</button>
              </Show>
              <Show when={segmentStatus(activeSegment()) === 'deferred'}>
                <span>⏸ 已保留分歧，约定继续讨论，仍在待裁决清单中。</span>
                <button class="link-button strong" onClick={() => setSection('adjudicate')}>现在裁决</button>
              </Show>
            </div>
            <label class="field-label">片段编码备忘
              <textarea class="native-textarea" value={segmentNote()} onInput={(event) => setSegmentNote(event.currentTarget.value)} onBlur={saveNote} placeholder="记录此片段的分歧处理或引文提示" />
            </label>
          </>}
        </Show>
      </Show>

      <Show when={section() === 'adjudicate'}>
        <AdjudicationPanel store={props.store} />
      </Show>

      <Show when={section() === 'audit'}>
        <div class="audit-summary">
          <div><strong>{props.store.state.audit.length}</strong><span>次最近操作</span></div>
          <div><strong>{citations().length}</strong><span>条当前主题引用</span></div>
        </div>
        <div class="audit-list">
          <For each={props.store.state.themes.filter((item) => item.definition || item.memo)}>{(item) => (
            <div class="citation" onClick={() => props.store.selectTheme(item.id)}>
              <strong>{item.name}</strong>
              <span>{item.definition ? '含操作定义' : ''}{item.definition && item.memo ? ' · ' : ''}{item.memo ? '含备忘录' : ''}</span>
            </div>
          )}</For>
        </div>
        <Divider />
        <div class="audit-list">
          <For each={props.store.state.audit.slice(0, 14)}>{(entry) => (
            <div class="audit-item"><span>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span><div><strong>{entry.action}</strong><p>{entry.detail}</p></div></div>
          )}</For>
        </div>
      </Show>
    </Paper>
  );
}

function AdjudicationPanel(props: { store: Store }) {
  const [adjudicatorName, setAdjudicatorName] = createSignal(props.store.state.adjudicator);
  const [picked, setPicked] = createSignal<string[]>([]);
  const [adjudicationNote, setAdjudicationNote] = createSignal('');
  const [showHistory, setShowHistory] = createSignal(false);

  createEffect(() => setAdjudicatorName(props.store.state.adjudicator));

  const transcriptTitle = (id: string) => props.store.state.transcripts.find((item) => item.id === id)?.title ?? '其他访谈';
  const segment = () => props.store.state.segments.find((item) => item.id === props.store.state.activeSegmentId);

  // 待裁决清单：有分歧且没有生效裁决（含“保留分歧”）。刷新/换标签页后状态持久在数据里。
  const queue = createMemo(() => props.store.state.segments
    .map((item) => ({ item, status: segmentStatus(item) }))
    .filter((entry) => entry.status === 'pending' || entry.status === 'deferred')
    .sort((a, b) => transcriptTitle(a.item.transcriptId).localeCompare(transcriptTitle(b.item.transcriptId), 'zh-CN') || a.item.order - b.item.order));

  const resolvedCount = createMemo(() => props.store.state.segments.filter((item) => segmentStatus(item) === 'resolved').length);

  // 当前片段 A∪B 的候选最终主题；切换片段或裁决状态时重置选择
  const candidates = createMemo(() => {
    const current = segment();
    if (!current) return [];
    return [...new Set([...current.assignments.A, ...current.assignments.B])]
      .map((id) => props.store.state.themes.find((theme) => theme.id === id))
      .filter((theme): theme is Theme => Boolean(theme));
  });

  const themeName = (id: string) => props.store.state.themes.find((item) => item.id === id)?.name ?? '未知主题（可能已删除）';

  createEffect(() => {
    const current = segment();
    const active = current?.adjudication?.current;
    setShowHistory(false);
    setAdjudicationNote(active?.note ?? '');
    if (active?.status === 'resolved') setPicked([...active.finalThemeIds]);
    else setPicked(current ? [...current.assignments.A] : []);
  });

  const focusSegment = (id: string, transcriptId: string) => {
    props.store.selectTranscript(transcriptId);
    props.store.selectSegment(id);
  };

  const togglePicked = (id: string) => setPicked((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const submitResolved = () => {
    const current = segment();
    if (!current) return;
    props.store.adjudicate(current.id, 'resolved', picked(), adjudicationNote());
  };
  const submitDeferred = () => {
    const current = segment();
    if (!current) return;
    props.store.adjudicate(current.id, 'deferred', [], adjudicationNote());
  };
  const saveAdjudicator = () => {
    const value = adjudicatorName().trim();
    if (value && value !== props.store.state.adjudicator) props.store.setAdjudicator(value);
  };

  return (
    <div class="adjudicate-panel">
      <div class="adj-summary">
        <div><strong>{queue().length}</strong><span>待裁决 / 保留分歧</span></div>
        <div><strong>{resolvedCount()}</strong><span>已裁决片段</span></div>
      </div>
      <label class="field-label compact">裁决人
        <input class="native-input" value={adjudicatorName()} onInput={(event) => setAdjudicatorName(event.currentTarget.value)} onBlur={saveAdjudicator} placeholder="裁决研究者姓名" />
      </label>

      <div class="adj-queue">
        <For each={queue()} fallback={<div class="empty-state">没有待处理的分歧。两位编码者判断一致或所有分歧均已裁决。</div>}>{(entry) => (
          <button
            class="adj-queue-item"
            classList={{ active: segment()?.id === entry.item.id, deferred: entry.status === 'deferred' }}
            onClick={() => focusSegment(entry.item.id, entry.item.transcriptId)}
          >
            <span class={`status-chip ${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
            <span class="adj-queue-meta">{transcriptTitle(entry.item.transcriptId)} · {entry.item.time} · {entry.item.speaker}</span>
            <small>{entry.item.text}</small>
          </button>
        )}</For>
      </div>

      <Show when={segment()} fallback={<div class="empty-state">从左侧正文或上方清单选择一个片段。</div>}>
        {(activeSegment) => {
          const status = () => segmentStatus(activeSegment());
          const current = () => activeSegment().adjudication?.current ?? null;
          return <>
            <Divider />
            <div class="adj-detail-head">
              <span class={`status-chip ${status()}`}>{STATUS_LABEL[status()]}</span>
              <strong>{activeSegment().time} · {activeSegment().speaker}</strong>
            </div>
            <blockquote class="adj-quote">“{activeSegment().text}”</blockquote>

            <Show when={status() === 'agreed'}>
              <div class="status-banner agreed">✓ A / B 判断一致，无需裁决。最终判断即：{activeSegment().assignments.A.map(themeName).join('、') || '未编码'}</div>
            </Show>

            <Show when={status() !== 'agreed'}>
              <div class="adj-coders">
                <div><span class="avatar">A</span><div class="adj-chips"><For each={activeSegment().assignments.A} fallback={<em>未编码</em>}>{(id) => <Chip size="small" label={themeName(id)} />}</For></div></div>
                <div><span class="avatar b">B</span><div class="adj-chips"><For each={activeSegment().assignments.B} fallback={<em>未编码</em>}>{(id) => <Chip size="small" label={themeName(id)} />}</For></div></div>
              </div>

              <Show when={current()} fallback={<div class="status-banner pending">裁决依据为上方当前两份判断。选定最终主题后立即计入主题树与导出；也可以保留分歧继续讨论。</div>}>
                {(record) => <div class={`status-banner ${record().status}`}>
                  <Show when={record().status === 'resolved'}>
                    ✓ {record().adjudicator} 已于 {new Date(record().at).toLocaleString('zh-CN')} 裁决，最终主题：{record().finalThemeIds.map(themeName).join('、') || '未编码'}。再次提交即覆盖本次裁决，原记录转入备查。
                  </Show>
                  <Show when={record().status === 'deferred'}>
                    ⏸ {record().adjudicator} 已于 {new Date(record().at).toLocaleString('zh-CN')} 选择保留分歧（{ADJUDICATION_STATUS_LABEL.deferred}）。
                  </Show>
                </div>}</Show>

              <div class="adj-pick">
                <div class="adj-pick-head">选择最终主题（来自两位编码者的判断，可多选）
                  <div class="adj-pick-shortcuts">
                    <Button size="small" onClick={() => setPicked([...activeSegment().assignments.A])}>采用 A</Button>
                    <Button size="small" onClick={() => setPicked([...activeSegment().assignments.B])}>采用 B</Button>
                  </div>
                </div>
                <For each={candidates()} fallback={<div class="muted">双方均未编码，可直接裁决为“未编码”。</div>}>{(candidate) => (
                  <label class="adj-pick-item" classList={{ on: picked().includes(candidate.id) }}>
                    <input type="checkbox" checked={picked().includes(candidate.id)} onChange={() => togglePicked(candidate.id)} />
                    <span class="theme-color" style={{ background: candidate.color }} />
                    {candidate.name}
                  </label>
                )}</For>
                <label class="field-label compact">裁决说明
                  <input class="native-input" value={adjudicationNote()} onInput={(event) => setAdjudicationNote(event.currentTarget.value)} placeholder="记录裁决理由或讨论约定" />
                </label>
                <div class="adj-actions">
                  <Button size="small" variant="contained" onClick={submitResolved}>确定最终主题</Button>
                  <Button size="small" variant="outlined" color="warning" onClick={submitDeferred}>保留分歧继续讨论</Button>
                </div>
                <p class="adj-warn">若此后有人修改本片段的 A 或 B 判断，本次裁决将自动失效、回到待裁决，原裁决记录保留在下方备查。</p>
              </div>

              <Show when={(activeSegment().adjudication?.history.length ?? 0) > 0}>
                <button class="link-button" onClick={() => setShowHistory((open) => !open)}>{showHistory() ? '隐藏' : '查看'}作废裁决备查（{activeSegment().adjudication?.history.length}）</button>
                <Show when={showHistory()}>
                  <div class="adj-history">
                    <For each={activeSegment().adjudication?.history ?? []}>{(item) => (
                      <div class="adj-history-item">
                        <div>
                          <span class={`status-chip ${item.status}`}>{ADJUDICATION_STATUS_LABEL[item.status]}</span>
                          <strong>{item.status === 'resolved' ? (item.finalThemeIds.length ? item.finalThemeIds.map(themeName).join('、') : '未编码') : '保留分歧'}</strong>
                        </div>
                        <p>{item.adjudicator} · {new Date(item.at).toLocaleString('zh-CN')} 裁决</p>
                        <p class="adj-history-reason">{new Date(item.archivedAt).toLocaleString('zh-CN')} 作废：{item.supersededReason === 'judgment-changed' ? '此后 A/B 判断被修改，裁决依据已变化' : '被一次新的裁决覆盖'}</p>
                        <Show when={item.note}><p class="adj-history-note">“{item.note}”</p></Show>
                      </div>
                    )}</For>
                  </div>
                </Show>
              </Show>
            </Show>
          </>;
        }}
      </Show>
    </div>
  );
}
