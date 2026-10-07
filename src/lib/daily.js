// One-attempt-per-day policy for Daily Challenge.
//
// Keep this pure and shared between presentation and the start boundary so
// hiding a button is never the only thing enforcing the rule.
function dailyAttemptState(stats, date) {
  if (stats?.lastCompletedDate === date) return "completed";
  if (stats?.attemptedDate === date) return "attempted";
  return "available";
}

function canStartDaily(stats, date) {
  return dailyAttemptState(stats, date) === "available";
}

export { canStartDaily, dailyAttemptState };
