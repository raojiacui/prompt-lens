export function isDeferredDashboardFeature(tab: string | null) {
  return tab === "audio" || tab === "edit";
}
