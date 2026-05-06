import path from 'path';

export function getCliEntryPath( entryName: string ): string {
	const sourceCliRoot = path.resolve( import.meta.dirname, '..', '..' );
	const cliRoot =
		path.basename( import.meta.dirname ) === 'process-manager'
			? sourceCliRoot
			: import.meta.dirname;

	return path.resolve( cliRoot, entryName );
}
