let pendingBackup: File | null = null;

export function setPendingBackup( file: File ) {
	pendingBackup = file;
}

export function takePendingBackup() {
	const file = pendingBackup;
	pendingBackup = null;
	return file;
}
