export type Role = "operator" | "builder";
export type TaskStatus = "inbox" | "in_progress" | "blocked" | "done";
export type TaskSource = "operator_request" | "builder_added";

export interface Profile {
  id: string;
  role: Role;
  display_name: string | null;
  created_at: string;
}

export interface Engagement {
  id: string;
  operator_id: string;
  builder_id: string;
  title: string;
  created_at: string;
}

export interface Task {
  id: string;
  engagement_id: string;
  title: string;
  description: string | null;
  source: TaskSource;
  status: TaskStatus;
  operator_visible: boolean;
  builder_estimate_hours: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  engagement?: Engagement;
}
