export type CoderId = 'A' | 'B';

export interface Theme {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  definition: string;
  memo: string;
  examples: string[];
}

export interface Segment {
  id: string;
  transcriptId: string;
  order: number;
  speaker: string;
  time: string;
  text: string;
  assignments: Record<CoderId, string[]>;
  note: string;
}

export interface Transcript {
  id: string;
  title: string;
  participant: string;
  importedAt: string;
  sourceName: string;
}

/** 裁决结果：选定最终主题，或明确保留分歧继续讨论 */
export type AdjudicationOutcome = 'resolved' | 'deferred';

/**
 * 一条裁决记录。basisA/basisB 是裁决当时两位编码者的判断快照，
 * 之后同一片段任一方判断变更，该记录即标记 supersededAt 失效，
 * 片段回到待裁决；记录本身保留备查，不会被删除。
 */
export interface AdjudicationRecord {
  id: string;
  segmentId: string;
  decidedAt: string;
  basisA: string[];
  basisB: string[];
  outcome: AdjudicationOutcome;
  /** outcome 为 resolved 时选定的最终主题；deferred 时为 null */
  finalThemeId: string | null;
  note: string;
  supersededAt: string | null;
  supersedeReason: string;
}

/** 片段层面的裁决状态：无分歧 / 待裁决 / 已裁决 / 保留分歧 */
export type SegmentAdjudicationState = 'agreed' | 'pending' | 'resolved' | 'deferred';

export interface CodingState {
  revision: number;
  updatedAt: string;
  activeTranscriptId: string;
  activeSegmentId: string;
  activeThemeId: string;
  coderA: string;
  coderB: string;
  transcripts: Transcript[];
  segments: Segment[];
  themes: Theme[];
  adjudications: AdjudicationRecord[];
  audit: Array<{ id: string; at: string; action: string; detail: string }>;
}

export interface PersistedEnvelope {
  revision: number;
  updatedAt: string;
  writerId: string;
  state: CodingState;
}
