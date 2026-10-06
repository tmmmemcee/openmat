/**
 * Coach links look like /t/<teamId>#k=TOKEN. Like staff links, the token is
 * moved from the #hash into this browser's storage and the address bar is
 * cleaned.
 */
const key = (teamId: string) => `openmat:team:${teamId}`;
const memory = new Map<string, string>();

export function getTeamToken(teamId: string): string | null {
  try {
    return localStorage.getItem(key(teamId)) ?? memory.get(teamId) ?? null;
  } catch {
    return memory.get(teamId) ?? null;
  }
}

export function setTeamToken(teamId: string, token: string): void {
  memory.set(teamId, token);
  try {
    localStorage.setItem(key(teamId), token);
  } catch {
    /* memory only */
  }
}

export function captureTeamToken(teamId: string): void {
  const match = window.location.hash.match(/[#&]k=([\w-]+)/);
  if (!match) return;
  setTeamToken(teamId, match[1]!);
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

export const coachLink = (teamId: string, token: string) => `${window.location.origin}/t/${teamId}#k=${token}`;
