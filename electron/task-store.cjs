// Disk records must retain execution inputs, independently of the public IPC view.
const EXECUTION_FIELDS = [
  'serverId', 'peerId', 'srcLocal', 'dstLocal', 'srcRemote', 'dstRemote',
  'direction', 'ignoreExisting', 'sourceVersion', 'stagedUploads', 'stagedDownloads',
];

function serializeTask(task, publicView) {
  const record = { ...publicView, schemaVersion: 2 };
  delete record.recentFiles;
  for (const key of EXECUTION_FIELDS) if (task[key] !== undefined) record[key] = task[key];
  return record;
}

function canResume(task) {
  if (!task.serverId) return false;
  if (task.kind === 'upload') return !!(task.srcLocal && task.dstRemote);
  if (task.kind === 'download') return !!(task.srcRemote && task.dstLocal);
  return !!(task.peerId && task.srcRemote && task.dstRemote);
}

module.exports = { serializeTask, canResume };
