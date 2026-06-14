"use client";

import { useState, useEffect } from "react";
import { todayISODate } from "./effective-date";

// Returns today's local date as `YYYY-MM-DD`, computed only after mount.
// Starts empty so server-rendered HTML and the first client render agree (the
// server's timezone can be a calendar day ahead/behind the viewer's), avoiding
// a hydration mismatch on the live "current date".
export function useTodayISODate(): string {
  const [today, setToday] = useState("");
  useEffect(() => setToday(todayISODate()), []);
  return today;
}
