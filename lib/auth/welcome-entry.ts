export function welcomeEntryDestination(authenticated: boolean) {
  return authenticated ? "/dashboard" : "/login?next=%2Fdashboard";
}
