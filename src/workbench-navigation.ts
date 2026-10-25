const commands = new Map<string, string[]>();
const directories = new Map<string, string>();
export function queueTerminalCommand(serverId: string, command: string) {
  const queue = commands.get(serverId) || [];
  if (queue.length >= 20) throw new Error('Too many queued terminal commands');
  queue.push(command); commands.set(serverId, queue);
  window.dispatchEvent(new CustomEvent('sc:terminal-command', { detail: { serverId } }));
}
export function takeTerminalCommand(serverId: string) { const queue = commands.get(serverId); const value = queue?.shift(); if (!queue?.length) commands.delete(serverId); return value; }
export function queueFilesPath(serverId: string, directory: string) { directories.set(serverId, directory); window.dispatchEvent(new CustomEvent('sc:files-path', { detail: { serverId } })); }
export function takeFilesPath(serverId: string) { const value = directories.get(serverId); directories.delete(serverId); return value; }
