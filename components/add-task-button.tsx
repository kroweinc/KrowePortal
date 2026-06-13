"use client";

import { Plus } from "lucide-react";

export const OPEN_NEW_TASK_EVENT = "krowe:open-new-task";

export function openNewTask() {
  window.dispatchEvent(new CustomEvent(OPEN_NEW_TASK_EVENT));
}

export function AddTaskButton() {
  return (
    <button type="button" className="krowe-add-btn" onClick={openNewTask}>
      <Plus width={16} height={16} strokeWidth={2.25} /> Add task
    </button>
  );
}
