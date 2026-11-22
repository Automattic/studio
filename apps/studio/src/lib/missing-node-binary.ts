import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { getExistingMainWindow } from 'src/main-window';

let reported = false;

// Antivirus software sometimes quarantines the bundled Node binary, after which every CLI command
// fails to spawn. Tell the user once per launch, and report it once rather than for every command.
export function reportCliSpawnError( error: NodeJS.ErrnoException, nodeBinary: string ): void {
	const isMissingNode =
		error.code === 'ENOENT' &&
		error.path === nodeBinary &&
		path.isAbsolute( nodeBinary ) &&
		! fs.existsSync( nodeBinary );
	if ( ! isMissingNode ) {
		Sentry.captureException( error );
		return;
	}
	if ( reported ) {
		return;
	}
	reported = true;
	Sentry.captureException( error );
	void showMissingNodeDialog();
}

async function showMissingNodeDialog() {
	const options: Electron.MessageBoxOptions = {
		type: 'error',
		message: __( 'WordPress Studio is missing some of its files' ),
		detail: __(
			'Studio can’t run your sites because one of its files was removed, often by antivirus software. Reinstall WordPress Studio to restore it. If it happens again, allow WordPress Studio in your antivirus settings.'
		),
		buttons: [ __( 'Download WordPress Studio' ), __( 'Not now' ) ],
		defaultId: 0,
		cancelId: 1,
	};
	const mainWindow = getExistingMainWindow();
	const { response } = mainWindow
		? await dialog.showMessageBox( mainWindow, options )
		: await dialog.showMessageBox( options );
	if ( response === 0 ) {
		void shellOpenExternalWrapper( 'https://wordpress.studio/' );
	}
}
