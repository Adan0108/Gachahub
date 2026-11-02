export type ModerationWorkerInput =
  | {
      type: 'POST';
      title: string | null;
      content: string;
    }
  | {
      type: 'COMMENT';
      content: string;
    };

export interface ModerationAnalysisInputResponse {
  analysisJobId: string;
  caseId: string;
  generation: number;
  targetType: 'POST' | 'COMMENT';
  targetId: string;
  inputSchemaVersion: number;
  snapshotHash: string;
  classifierProfile: string;
  input: ModerationWorkerInput;
}
