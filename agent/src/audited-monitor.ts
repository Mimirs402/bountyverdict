export type AuditedMonitor = "directory" | "distribution";

export function auditedMonitorRequiresRotation(
  monitor: AuditedMonitor,
  distributionReportOnly: boolean,
): boolean {
  return monitor === "directory" || !distributionReportOnly;
}
