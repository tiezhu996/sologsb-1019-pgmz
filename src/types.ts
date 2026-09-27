export type CoderId = 'A' | 'B';

export type AdjudicationStatus = 'resolved' | 'deferred';

/** 一次裁决记录。basisA / basisB 冻结裁决当时两位编码者的判断，用于核对依据。 */
export interface Adjudication {
  at: string;
  adjudicator: string;
  /** resolved = 选定 finalThemeIds 作为最终判断；deferred = 保留分歧继续讨论 */
  status: AdjudicationStatus;
  finalThemeIds: string[];
  basisA: string[];
  basisB: string[];
  note: string;
}

/** 被作废的历史裁决：原记录保留备查，supersededReason 说明作废原因。 */
export interface ArchivedAdjudication extends Adjudication {
  archivedAt: string;
  supersededReason: 'judgment-changed' | 're-adjudicated';
}

export interface SegmentAdjudication {
  /** 当前生效的裁决；null 表示待裁决。 */
  current: Adjudication | null;
  history: ArchivedAdjudication[];
}

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
  adjudication?: SegmentAdjudication | null;
}

export interface Transcript {
  id: string;
  title: string;
  participant: string;
  importedAt: string;
  sourceName: string;
}

export interface CodingState {
  revision: number;
  updatedAt: string;
  activeTranscriptId: string;
  activeSegmentId: string;
  activeThemeId: string;
  coderA: string;
  coderB: string;
  /** 裁决负责人姓名 */
  adjudicator: string;
  transcripts: Transcript[];
  segments: Segment[];
  themes: Theme[];
  audit: Array<{ id: string; at: string; action: string; detail: string }>;
}

export interface PersistedEnvelope {
  revision: number;
  updatedAt: string;
  writerId: string;
  state: CodingState;
}
