export interface GitHubConnection {
  id: string;
  user_id: string;
  access_token: string;
  github_username: string;
  github_user_id: number;
  connected_at: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description: string | null;
  updated_at: string;
}

export type Role = "operator" | "builder";
export type TaskStatus = "inbox" | "in_progress" | "blocked" | "done";
export type TaskSource = "operator_request" | "builder_added";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

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
  priority: TaskPriority;
  operator_visible: boolean;
  builder_estimate_hours: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  engagement?: Engagement;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploader?: Pick<Profile, "id" | "display_name" | "role">;
}
