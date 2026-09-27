import type { AdjudicationStatus, Segment, SegmentAdjudication } from '../types';

/** 比较两份主题判断是否一致（忽略顺序与重复）。 */
export const sameAssignments = (a: string[], b: string[]) =>
  a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

export const emptyAdjudication = (): SegmentAdjudication => ({ current: null, history: [] });

/** 裁决所依据的 A/B 判断是否还是当下的判断；任一被改过即作废。 */
export const adjudicationIsStale = (segment: Pick<Segment, 'assignments' | 'adjudication'>) => {
  const current = segment.adjudication?.current;
  if (!current) return false;
  return !sameAssignments(current.basisA, segment.assignments.A) ||
    !sameAssignments(current.basisB, segment.assignments.B);
};

export type SegmentStatus = 'agreed' | 'pending' | 'resolved' | 'deferred';

/** agreed：A/B 一致无需裁决；pending：有分歧且未裁决；resolved：已选定最终主题；deferred：保留分歧。 */
export const segmentStatus = (segment: Pick<Segment, 'assignments' | 'adjudication'>): SegmentStatus => {
  const disagree = !sameAssignments(segment.assignments.A, segment.assignments.B);
  if (!disagree) return 'agreed';
  const current = adjudicationIsStale(segment) ? null : segment.adjudication?.current ?? null;
  if (!current) return 'pending';
  return current.status;
};

/** 该片段计入主题树/导出的最终主题；待裁决与保留分歧不产出最终判断。 */
export const finalThemesOf = (segment: Pick<Segment, 'assignments' | 'adjudication'>): string[] => {
  const current = segmentStatus(segment) === 'resolved' ? segment.adjudication!.current : null;
  return current ? [...current.finalThemeIds] : [];
};

export const STATUS_LABEL: Record<SegmentStatus, string> = {
  agreed: '一致',
  pending: '待裁决',
  resolved: '已裁决',
  deferred: '保留分歧'
};

export const ADJUDICATION_STATUS_LABEL: Record<AdjudicationStatus, string> = {
  resolved: '选定最终主题',
  deferred: '保留分歧继续讨论'
};
