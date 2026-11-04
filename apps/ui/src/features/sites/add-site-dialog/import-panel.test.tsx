import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

type Failures = { createSite?: Error; import?: Error; deleteSite?: Error };

const backup = new File( [ 'backup' ], 'studio-backup-My Store-2026-07-17.zip' );

async function setup() {
	const connector = createFakeConnector();
	connector.extractBlueprintBundle.mockRejectedValue(
		new Error( 'No blueprint.json found in the ZIP.' )
	);
	connector.getFilePath.mockResolvedValue( '/tmp/backup.zip' );
	const view = renderApp( { connector, path: '/?addSite=import' } );
	const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
	fireEvent.change( dialog.querySelector( 'input[type="file"]' )!, {
		target: { files: [ backup ] },
	} );
	await waitFor( () =>
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'My Store' )
	);
	const submit = async ( name = 'Create site' ) => {
		const button = within( dialog ).getByRole( 'button', { name } );
		await waitFor( () => expect( button ).toBeEnabled() );
		fireEvent.click( button );
	};
	return { ...view, connector, dialog, submit };
}

describe( 'Add site › Import', () => {
	it( 'changes the backup from its source area while retaining edited settings', async () => {
		const { dialog } = await setup();
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'My Edited Store' },
		} );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Change' } ) );
		const choose = await within( dialog ).findByRole( 'button', { name: 'Choose file' } );
		expect( choose ).toBeVisible();
		fireEvent.change( dialog.querySelector( 'input[type="file"]' )!, {
			target: { files: [ new File( [ 'backup' ], 'another-backup.zip' ) ] },
		} );
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'My Edited Store' )
		);
		expect( within( dialog ).getByText( 'another-backup.zip' ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'button', { name: 'Create site' } ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) ).toBeVisible();
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

		await submit( 'Create site' );
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
		await submit( 'Create site' );
		expect( within( dialog ).getByRole( 'button', { name: /Create site/ } ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'button', { name: 'Change' } ) ).toBeVisible();
	} );

	it( 'ignores a second submit while the import is under way', async () => {
		const { connector, dialog } = await setup();
		connector.getFilePath.mockReturnValue( new Promise( () => {} ) );
		const button = within( dialog ).getByRole( 'button', { name: 'Create site' } );
		await waitFor( () => expect( button ).toBeEnabled() );
		fireEvent.click( button );
		fireEvent.click( button );
		await waitFor( () => expect( connector.getFilePath ).toHaveBeenCalledOnce() );
	} );

	it.each( [
		[
			'creating the site',
			{ createSite: new Error( 'EACCES: cannot create directory' ) },
			'WordPress Studio could not create the site.',
			/Review the site name and local folder/,
		],
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
