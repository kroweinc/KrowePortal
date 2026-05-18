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
  operator?: { display_name: string | null };
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
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  pushed_to_main: boolean;
  completion_note: string | null;
  completed_at: string | null;
  engagement?: Engagement;
  task_attachments?: TaskAttachment[];
}

export interface Subtask {
  id: string;
  task_id: string;
  created_by: string;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export type AttachmentType = "file" | "link" | "text";

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  attachment_type: AttachmentType;
  file_name: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  text_content: string | null;
  is_deliverable: boolean;
  created_at: string;
  uploader?: Pick<Profile, "id" | "display_name" | "role">;
}
