import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { archive, code, commentContent, grid, preformatted } from '@wordpress/icons';
import { ButtonsSection, ButtonsSectionProps } from 'src/components/buttons-section';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useAppDispatch } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { createNewTask } from 'src/stores/tasks-slice';

interface ContentTabOverviewProps {
	selectedSite: SiteDetails;
}

function ShortcutsSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const { startServer, loadingServer } = useSiteDetails();
	const dispatch = useAppDispatch();
	const isServerLoading = loadingServer[ selectedSite.id ];

	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'New task' ),
			className: 'text-nowrap',
			icon: commentContent,
			onClick: () => {
				void dispatch( createNewTask( selectedSite.id ) );
			},
		},
		{
			label: isWindows()
				? // translators: name of app used to navigate files and folders on Windows
				  __( 'File Explorer' )
				: // translators: name of app used to navigate files and folders on macOS
				  __( 'Finder' ),
			className: 'text-nowrap',
			icon: archive,
			onClick: () => {
				getIpcApi().openLocalPath( selectedSite.path );
			},
		},
	];

	const editorConfig = editor ? supportedEditorConfig[ editor ] : false;
	if ( editor && editorConfig ) {
		buttonsArray.push( {
			label: editorConfig.label,
			className: 'text-nowrap',
			icon: code,
			onClick: async () => {
				await getIpcApi().openAppAtPath( editor, selectedSite.path );
			},
		} );
	}

	const terminalName = getTerminalName( terminal );
	buttonsArray.push( {
		label: terminalName,
		className: 'text-nowrap',
		icon: preformatted,
		onClick: async () => {
			try {
				await getIpcApi().openTerminalAtPath( selectedSite.path );
			} catch ( error ) {
				Sentry.captureException( error );
				alert( __( 'Could not open the terminal.' ) );
			}
		},
	} );

	buttonsArray.push( {
		label: __( 'phpMyAdmin' ),
		className: 'text-nowrap',
		icon: grid,
		disabled: isServerLoading,
		onClick: async () => {
			if ( ! selectedSite.running ) {
				await startServer( selectedSite );
			}
			getIpcApi().openSiteURL(
				selectedSite.id,
				'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
			);
		},
	} );

	return <ButtonsSection buttonsArray={ buttonsArray } title={ __( 'Open in…' ) } />;
}

export function ContentTabOverview( { selectedSite }: ContentTabOverviewProps ) {
	return (
		<div className="p-8 flex max-w-4xl">
			<ShortcutsSection selectedSite={ selectedSite } />
		</div>
	);
}
