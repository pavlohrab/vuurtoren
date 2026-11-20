/** Text and day helpers shared by native mode and the Anki export. */

/** Field text without HTML tags, with `&nbsp;` as a space. Not trimmed. */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
}

/** Start of the study day (4:00 local time) that `ms` falls in. */
export function studyDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > ms) d.setDate(d.getDate() - 1);
  return d.getTime();
}
