/**
 * Timestamped review comments on a comp (settings.comments). Agents and
 * people both write them; `author` says who.
 */
export type CompComment = {
  id: string;
  /** Comp time (s). */
  time: number;
  text: string;
  author?: string;
  createdAt: string;
  resolved?: boolean;
  /** Optional: the layer it's about. */
  layerId?: string;
};

export function newComment(time: number, text = "", author = "you"): CompComment {
  return { id: Math.random().toString(36).slice(2, 10), time, text, author, createdAt: new Date().toISOString() };
}
