type Task = () => Promise<void>;
const queue: Task[] = [];

export function enqueuePostConnect(task: Task): void { queue.push(task); }
export async function runPostConnect(): Promise<void> {
  while (queue.length) {
    const t = queue.shift()!;
    try { await t(); } catch { /* swallow and continue */ }
  }
}