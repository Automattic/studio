import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

type Failures = { createSite?: Error; import?: Error; deleteSite?: Error };

const backup = new File( [ 'backup' ], 'studio-backup-My Store-2026-07-17.zip' );

async function setup() {
	const connector = createFakeConnector();
	connector.readBlueprint.mockRejectedValue( new Error( 'No blueprint.json found in the ZIP.' ) );
	connector.getFilePath.mockResolvedValue( '/tmp/backup.zip' );
	const view = renderApp( { connector, path: '/?addSite=import' } );
	const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
	fireEvent.change( dialog.querySelector( 'input[type="file"]' )!, {
		target: { files: [ backup ] },
	} );
	await waitFor( () =>
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'My Store' )
	);
	const submit = async ( name = 'Add site' ) => {
		const button = within( dialog ).getByRole( 'button', { name } );
		await waitFor( () => expect( button ).toBeEnabled() );
		fireEvent.click( button );
	};
	return { ...view, connector, dialog, submit };
}

describe( 'Add site › Import', () => {
	it.each( [ true, false ] )(
		'recognizes a dropped existing site and refuses empty source folders: empty=%s',
		async ( isEmpty ) => {
			const { connector, dialog } = await setup();
			fireEvent.change( screen.getByLabelText( 'Site name' ), { target: { value: 'My bakery' } } );
			await waitFor( () =>
				expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute(
					'title',
					'/sites/My bakery'
				)
			);
			const previousPath = ( screen.getByLabelText( 'Site folder' ) as HTMLInputElement ).value;
			connector.getFilePath.mockResolvedValueOnce( '/projects/destination' );
			connector.selectSiteFolder.mockResolvedValue( {
				name: 'Destination',
				path: '/projects/destination',
				isEmpty,
				isWordPress: ! isEmpty,
			} );
			fireEvent.drop( dialog, {
				dataTransfer: {
					files: [ new File( [], 'destination' ) ],
					types: [ 'Files' ],
					items: [ { webkitGetAsEntry: () => ( { isDirectory: true } ) } ],
				},
			} );
			if ( isEmpty ) {
				await screen.findByText( 'Choose a folder containing an existing WordPress site.' );
				expect( screen.getByLabelText( 'Site folder' ) ).toHaveValue( previousPath );
				expect( within( dialog ).getByText( backup.name ) ).toBeVisible();
			} else {
				await screen.findByText( 'Existing WordPress site' );
				expect( screen.getByLabelText( 'Site folder' ) ).toHaveValue( '/projects/destination' );
				expect( within( dialog ).queryByText( backup.name ) ).not.toBeInTheDocument();
			}
			expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'My bakery' );
			expect( connector.createSite ).not.toHaveBeenCalled();
			expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
		}
	);

	it( 'keeps the backup selected and refuses an occupied destination folder', async () => {
		const { connector, dialog } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Existing site',
			path: '/sites/existing',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Change…',
			} )
		);
		await waitFor( () =>
			expect( screen.getByLabelText( 'Site folder' ) ).toHaveAccessibleDescription(
				/Choose an empty folder to use a source/
			)
		);
		expect( within( dialog ).getByText( backup.name ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
		expect( within( dialog ).getByRole( 'button', { name: 'Advanced' } ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect( connector.createSite ).not.toHaveBeenCalled();
		expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
	} );

	it( 'starts its AI prompt only after the backup finishes importing', async () => {
		const { connector, dialog, submit } = await setup();
		let finishImport!: () => void;
		connector.importSiteFromBackup.mockReturnValueOnce(
			new Promise< void >( ( resolve ) => {
				finishImport = resolve;
			} )
		);
		fireEvent.change( within( dialog ).getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Refresh this restored bakery site' },
		} );
		await submit();
		await waitFor( () => expect( connector.importSiteFromBackup ).toHaveBeenCalledOnce() );
		expect( connector.createSession ).not.toHaveBeenCalled();
		await act( async () => finishImport() );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.continueSession.mock.calls[ 0 ][ 1 ] ).toBe(
			'Refresh this restored bakery site'
		);
	} );

	it( 'keeps AI recovery through Settings without importing again or deleting the restored site', async () => {
		const { connector, dialog, submit } = await setup();
		connector.createSession.mockRejectedValueOnce( new Error( 'Chat storage unavailable' ) );
		fireEvent.change( within( dialog ).getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Refresh this restored bakery site' },
		} );
		await submit();
		await screen.findByText( 'Your site was created, but the AI chat could not start.' );
		act( () => connector.emit( 'onOpenSettings', { settingId: 'ai' } ) );
		const settings = await screen.findByRole( 'dialog', { name: 'Settings' } );
		fireEvent.click( within( settings ).getByRole( 'button', { name: /Close .*ettings/ } ) );
		await screen.findByText( 'Your site was created, but the AI chat could not start.' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.importSiteFromBackup ).toHaveBeenCalledOnce();
		expect( connector.createSite ).toHaveBeenCalledOnce();
		expect( connector.deleteSite ).not.toHaveBeenCalled();
	} );

	it( 'clears the selected backup and preserves edited settings when choosing another', async () => {
		const { dialog } = await setup();
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'Edited Store' },
		} );
		expect( within( dialog ).getByRole( 'button', { name: 'Back' } ) ).toBeVisible();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Change' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Start blank' } ) );
		await within( dialog ).findByRole( 'button', { name: /^Choose(?: file|…)$/ } );
		fireEvent.change( dialog.querySelector( 'input[type="file"]' )!, {
			target: { files: [ new File( [ 'backup' ], 'other.wpress' ) ] },
		} );
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'Edited Store' )
		);
	} );
	it( 'changes the backup from its source area while retaining edited settings', async () => {
		const { dialog } = await setup();
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'My Edited Store' },
		} );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Change' } ) );
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'My Edited Store' );
		fireEvent.change( dialog.querySelector( 'input[type="file"]' )!, {
			target: { files: [ new File( [ 'backup' ], 'another-backup.zip' ) ] },
		} );
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'My Edited Store' )
		);
		expect( within( dialog ).getByText( 'another-backup.zip' ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
		expect( within( dialog ).queryByRole( 'button', { name: 'Cancel' } ) ).not.toBeInTheDocument();
	} );

	it( 'adopts the chosen backup, resolving its path only on submit', async () => {
		const { connector, history, submit } = await setup();
		expect( connector.getFilePath ).not.toHaveBeenCalled();
		await submit();
		await waitFor( () =>
			expect( history.location.pathname ).toMatch( /^\/sites\/created-|^\/sessions\// )
		);
		expect( connector.getFilePath ).toHaveBeenCalledWith( backup );
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'My Store', skipStart: true } )
		);
		expect( connector.importSiteFromBackup ).toHaveBeenCalledWith(
			expect.stringMatching( /^created-/ ),
			'/tmp/backup.zip',
			expect.anything()
		);
	} );

	it( 'rolls back a failed import and retries the same backup with a fresh path', async () => {
		const { connector, dialog, history, submit } = await setup();
		connector.getFilePath
			.mockResolvedValueOnce( '/tmp/first/backup.zip' )
			.mockResolvedValueOnce( '/tmp/second/backup.zip' );
		connector.importSiteFromBackup.mockRejectedValueOnce( new Error( 'Import exploded' ) );
		await submit();
		expect(
			await within( dialog ).findByText( 'WordPress Studio could not import this backup.' )
		).toBeVisible();
		const [ firstSite ] = connector.importSiteFromBackup.mock.calls[ 0 ];
		expect( connector.deleteSite ).toHaveBeenCalledWith( firstSite, true );
		expect( within( dialog ).getByText( /removed the incomplete site/i ) ).toBeVisible();
		expect( within( dialog ).getByText( 'Import exploded' ) ).toBeInTheDocument();
		expect( within( dialog ).getByRole( 'button', { name: 'Change' } ) ).toBeVisible();

		await submit( 'Add site' );
		await waitFor( () => expect( history.location.pathname ).not.toBe( '/' ) );
		expect( connector.getFilePath ).toHaveBeenNthCalledWith( 2, backup );
		expect( connector.importSiteFromBackup ).toHaveBeenLastCalledWith(
			expect.not.stringMatching( firstSite ),
			'/tmp/second/backup.zip',
			expect.anything()
		);
	} );

	it( 'shows the progress the CLI publishes for the site it imports into', async () => {
		const { connector, dialog, submit } = await setup();
		connector.importSiteFromBackup.mockReturnValue( new Promise( () => {} ) );
		await submit();
		await waitFor( () => expect( connector.importSiteFromBackup ).toHaveBeenCalled() );
		const [ siteId ] = connector.importSiteFromBackup.mock.calls[ 0 ];
		act( () =>
			connector.emit( 'onSyncActivity', {
				siteId,
				activity: { kind: 'pending', direction: 'import', message: '25% · Extracting…' },
			} )
		);
		expect( await within( dialog ).findByText( '25% · Extracting…' ) ).toBeVisible();
	} );

	it( 'keeps its recovery actions when the backup cannot be read, through the retry', async () => {
		const { connector, dialog, submit } = await setup();
		connector.getFilePath.mockRejectedValueOnce( new Error( 'Upload failed' ) );
		await submit();
		expect(
			await within( dialog ).findByText( 'WordPress Studio could not access this backup.' )
		).toBeVisible();
		expect( within( dialog ).getByText( /still available and readable/i ) ).toBeVisible();
		expect( within( dialog ).getByText( 'Upload failed' ) ).toBeInTheDocument();
		expect( connector.createSite ).not.toHaveBeenCalled();

		connector.getFilePath.mockReturnValueOnce( new Promise( () => {} ) );
		await submit( 'Add site' );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Adding site Add site' } )
		).toBeVisible();
		expect( within( dialog ).getByRole( 'button', { name: 'Change' } ) ).toBeVisible();
	} );

	it( 'ignores a second submit while the import is under way', async () => {
		const { connector, dialog } = await setup();
		connector.getFilePath.mockReturnValue( new Promise( () => {} ) );
		const button = within( dialog ).getByRole( 'button', { name: 'Add site' } );
		await waitFor( () => expect( button ).toBeEnabled() );
		fireEvent.click( button );
		fireEvent.click( button );
		await waitFor( () => expect( connector.getFilePath ).toHaveBeenCalledOnce() );
	} );

	it( 'uses the bottom notice if the backup destination cannot be created', async () => {
		const { connector, dialog, submit } = await setup();
		connector.createSite.mockRejectedValue( new Error( 'EACCES: cannot create directory' ) );
		await submit();
		expect( await screen.findByText( 'Couldn’t create site: My Store' ) ).toBeVisible();
		expect( within( dialog ).queryByRole( 'alert' ) ).not.toBeInTheDocument();
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toBeEnabled();
	} );

	it.each( [
		[
			'an unsafe backup path',
			{ import: new Error( 'Failed to import site: absolute path: /wp-content/index.php' ) },
			/contains a file path WordPress Studio cannot safely restore/,
			/Export the site again/,
		],
		[
			'cleaning up',
			{ import: new Error( 'Invalid backup' ), deleteSite: new Error( 'Folder is locked' ) },
			'WordPress Studio could not finish cleaning up.',
			/could not remove “My Store”/,
		],
	] as [ string, Failures, string | RegExp, RegExp ][] )(
		'explains a failure %s',
		async ( _, failures, title, recovery ) => {
			const { connector, dialog, submit } = await setup();
			if ( failures.createSite ) connector.createSite.mockRejectedValue( failures.createSite );
			if ( failures.import ) connector.importSiteFromBackup.mockRejectedValue( failures.import );
			if ( failures.deleteSite ) connector.deleteSite.mockRejectedValue( failures.deleteSite );
			await submit();
			expect( await within( dialog ).findByText( title ) ).toBeVisible();
			expect( within( dialog ).getByText( recovery ) ).toBeVisible();
			expect( within( dialog ).getByLabelText( 'Site name' ) ).toBeEnabled();
		}
	);
} );
