export interface ParsedTaskItem {
  title: string;
  categoryName: string | null;
  dueDate: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
}

export interface ParseTextInput {
  rawText: string;
}
