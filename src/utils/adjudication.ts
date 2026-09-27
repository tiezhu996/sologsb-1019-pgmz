import type { AdjudicationRecord, CodingState, Segment, SegmentAdjudicationState } from '../types';

/** 兼容旧数据：没有裁决字段的存档补空数组 */
export function migrateAdjudications(state: CodingState): CodingState {
  if (!Array.isArray(state.adjudications)) state.adjudications = [];
  return state;
}

const sameCodes = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** 片段当前是否存在两位编码者判断分歧（顺序无关） */
export function hasDisagreement(segment: Segment): boolean {
  return !sameCodes(segment.assignments.A, segment.assignments.B);
}

/** 找到片段当前生效（未失效）的裁决记录 */
export function activeAdjudication(state: Pick<CodingState, 'adjudications'>, segmentId: string): AdjudicationRecord | undefined {
  return state.adjudications.find((record) => record.segmentId === segmentId && !record.supersededAt);
}

/**
 * 事务收尾：凡裁决所依据的 A/B 判断已与当下不符（任一方增删主题、
 * 批量重编码、合并拆分或删除主题都可能触发），裁决自动失效，
 * 片段回到待裁决，原记录保留并注明原因。
 */
export function pruneStaleAdjudications(draft: CodingState, reason: string): void {
  const at = new Date().toISOString();
  draft.adjudications.forEach((record) => {
    if (record.supersededAt) return;
    const segment = draft.segments.find((item) => item.id === record.segmentId);
    if (!segment || !sameCodes(record.basisA, segment.assignments.A) || !sameCodes(record.basisB, segment.assignments.B)) {
      record.supersededAt = at;
      record.supersedeReason = reason;
    }
  });
}

/** 片段裁决状态（派生值，不持久化） */
export function segmentAdjudicationState(state: Pick<CodingState, 'adjudications'>, segment: Segment): SegmentAdjudicationState {
  if (!hasDisagreement(segment)) return 'agreed';
  const record = activeAdjudication(state, segment.id);
  if (record?.outcome === 'resolved') return 'resolved';
  if (record?.outcome === 'deferred') return 'deferred';
  return 'pending';
}

/** 尚未谈拢：有分歧且未形成有效裁决（含保留分歧继续讨论） */
export function isUnresolved(state: Pick<CodingState, 'adjudications'>, segment: Segment): boolean {
  const status = segmentAdjudicationState(state, segment);
  return status === 'pending' || status === 'deferred';
}

/**
 * 主题树计数与"回原文引用"使用的生效主题：
 * 已裁决的分歧只计最终主题；无分歧或未谈拢的片段按两位编码者实际判断并集计算。
 */
export function effectiveThemeIdsForSegment(state: Pick<CodingState, 'adjudications'>, segment: Segment): string[] {
  const status = segmentAdjudicationState(state, segment);
  if (status === 'resolved') {
    const finalId = activeAdjudication(state, segment.id)?.finalThemeId;
    return finalId ? [finalId] : [];
  }
  return [...new Set([...segment.assignments.A, ...segment.assignments.B])];
}
