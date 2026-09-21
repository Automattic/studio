let pendingBackup: File | null = null;

export function setPendingBackup( file: File ) {
	pendingBackup = file;
}

export function peekPendingBackup() {
	return pendingBackup;
}

export function clearPendingBackup() {
	pendingBackup = null;
}
