export type Phase = "waiting" | "scheduled" | "public" | "private" | "ended";
export type Split = "public" | "private";
export type TaskId = "1" | "2";
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
  unlimited?: boolean;
  autoApprove?: boolean;
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
}
export interface TaskStatement {
  id: TaskId;
  title: string;
  content: string;
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
  judges: Record<TaskId, Record<Split, string>>;
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
  bytes: number;
  sha256: string;
  path: string;
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
}
