export const EVENT_STATUSES = [
  "pending",
  "attending",
  "processed",
  "self-processed",
  "cancelled",
  "hidden",
] as const;

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "closed",
] as const;

export const TICKET_PRIORITIES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export const INTERVENTION_STATUSES = [
  "in_progress",
  "waiting",
  "transferred",
  "closed",
  "observation",
] as const;
