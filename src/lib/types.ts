export type Phase =
  "waiting" | "scheduled" | "public" | "private" | "practice" | "ended";
export type Split = "public" | "private";
export type TaskId = "1" | "2" | "3";
export interface User {
  id: string;
  username: string;
  name: string;
  password: string;
  teamId: string | null;
  createdAt: number;
}
export type SafeUser = Omit<User, "password"> & { admin: boolean };
export interface Team {
  id: string;
  name: string;
  captainId: string;
  members: string[];
  inviteCode: string;
  createdAt: number;
}
export interface Contest {
  id: string;
  roundId?: string;
  packageId?: string;
  privateAt?: number | null;
  /** Version 1 uses explicit privateAt/endAt; absent fields retain legacy timing. */
  timingVersion?: 1;
  endAt?: number | null;
  privateStartedAt?: number;
  revision?: number;
  chatEpoch?: number;
  privatePolicy?: { lockPublic: boolean; revokeChatbot: boolean };
  submissionAccess?: Record<Split, { visible: boolean; enabled: boolean }>;
  chatbotAllowed?: boolean;
  chatbotUntil?: number | null;
  notebookAllowed?: boolean;
  practice?: { startAt: number; endAt: number | null };
  unlimited?: boolean;
  autoApprove?: boolean;
  hidden?: boolean;
  deletedAt?: number;
  taskCount?: number;
  title: string;
  startAt: number | null;
  forcedEndAt: number | null;
  publicSeconds: number;
  privateSeconds: number;
  publicLimit: number;
  privateLimit: number;
  createdAt: number;
}
export interface Asset {
  key: string;
  name: string;
  bytes: number;
  sha256: string;
  phase: "public" | "private";
  description: string;
  driveUrl?: string;
  task?: TaskId;
  workspaceLayout?: "task-root";
}
export interface TaskStatement {
  id: TaskId;
  title: string;
  content: string;
  maxScore?: number;
  columns?: string[];
  maxSubmissionBytes?: number;
}
export interface JudgeSpec {
  kind: "pinball" | "aspect-f1" | "pump-f1";
  maxScore: number;
  baseline: number;
  reference: number;
}
export interface DirectJudgeSpec {
  kind: "scaled-mae" | "multilabel-f1" | "trimap-iou" | "generation-chrf";
  maxScore: 100;
}
export interface Registration {
  userId: string;
  status: "approved" | "pending" | "rejected";
  registeredAt: number;
}
export interface ContestPackage {
  version: string;
  title?: string;
  tasks?: TaskStatement[];
  statement: string;
  assets: Asset[];
  judges: Record<"1" | "2", Record<Split, string>> & {
    "3"?: Record<Split, string>;
  };
  judgeSpecs?: Partial<Record<TaskId, JudgeSpec>>;
  directJudgeSpecs?: Partial<Record<TaskId, DirectJudgeSpec>>;
  importedAt: number;
}
export interface Submission {
  id: string;
  runId: string;
  teamId: string;
  userId: string;
  task: TaskId;
  split: Split;
  filename: string;
  createdAt: number;
  score: number;
  secondary: number;
  metric?: number;
  bytes: number;
  sha256: string;
  path: string;
  fileStorage?: "redis";
  note: string;
  status?: "accepted" | "invalid";
  error?: string;
  adminTest?: boolean;
}
export interface CVImage {
  id: string;
  width: number;
  height: number;
  masks: number[][];
}
export interface QAItem {
  id: string;
  context: string;
  answers: { text: string }[];
  is_impossible: boolean;
}
export interface JudgeResult {
  score: number;
  secondary: number;
  count: number;
  metric?: number;
}
