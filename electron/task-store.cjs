// Disk records must retain execution inputs, independently of the public IPC view.
const EXECUTION_FIELDS = [
  'serverId', 'peerId', 'srcLocal', 'dstLocal', 'srcRemote', 'dstRemote',
  'direction', 'ignoreExisting', 'sourceVersion', 'stagedUploads', 'stagedDownloads',
  'recoveryReason',
];

function serializeTask(task, publicView) {
  const record = { ...publicView, schemaVersion: 2 };
  delete record.recentFiles;
  for (const key of EXECUTION_FIELDS) if (task[key] !== undefined) record[key] = task[key];
  return record;
}

function canResume(task) {
  if (task.recoveryReason || task._wantCancel || task.status === 'canceled') return false;
  if (!task.serverId) return false;
  if (task.kind === 'upload') return !!(task.srcLocal && task.dstRemote);
  if (task.kind === 'download') return !!(task.srcRemote && task.dstLocal);
  return !!(task.peerId && task.srcRemote && task.dstRemote);
}

function migrateTask(task) {
  const next = { ...task, speed: 0 };
  if (['running', 'queued'].includes(next.status)) next.status = 'paused';
  if (!canResume(next) && !['done', 'canceled'].includes(next.status)) {
    next.recoveryReason = 'legacy-missing-inputs';
    if (next.error === 'This older task has no recovery inputs. Start a new transfer from the file manager.') {
      next.status = 'paused';
      next.error = '';
    }
  }
  return next;
}

module.exports = { serializeTask, canResume, migrateTask };
