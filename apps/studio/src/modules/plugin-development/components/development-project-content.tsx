import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { archive, code, preformatted } from '@wordpress/icons';
import { useState } from 'react';
import { type ButtonsSectionProps } from 'src/components/buttons-section';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { getFileManagerLabel } from 'src/lib/file-manager';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { useDevelopmentProjects } from '../hooks/use-development-projects';
import { ProjectWorkbench } from './project-workbench';
import { RemotePluginContent } from './remote-plugin-content';
import { ProjectEmptyState } from './shared-ui';

export function DevelopmentProjectContent() {
	const { selectedProject, selectedRemotePlugin, removeProject, refreshProject } =
		useDevelopmentProjects();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const [ isRefreshing, setIsRefreshing ] = useState( false );

	if ( selectedRemotePlugin ) {
		return <RemotePluginContent plugin={ selectedRemotePlugin } />;
	}

	if ( ! selectedProject ) {
		return <ProjectEmptyState />;
	}

	const ipcApi = getIpcApi();
	const editorConfig = editor ? supportedEditorConfig[ editor ] : false;
	const terminalName = getTerminalName( terminal );
	const isBlocked = ! selectedProject.exists || Boolean( selectedProject.error );

	const openButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: getFileManagerLabel(),
			className: 'text-nowrap',
			icon: archive,
			disabled: ! selectedProject.exists,
			onClick: () => ipcApi.openLocalPath( selectedProject.path ),
		},
	];

	if ( editor && editorConfig ) {
		openButtons.push( {
			label: editorConfig.label,
			className: 'text-nowrap',
			icon: code,
			disabled: ! selectedProject.exists,
			onClick: async () => {
				await ipcApi.openAppAtPath( editor, selectedProject.path );
			},
		} );
	}

	openButtons.push( {
		label: terminalName,
		className: 'text-nowrap',
		icon: preformatted,
		disabled: ! selectedProject.exists,
		onClick: async () => {
			try {
				await ipcApi.openTerminalAtPath( selectedProject.path );
			} catch ( error ) {
				Sentry.captureException( error );
				alert( __( 'Could not open the terminal.' ) );
			}
		},
	} );

	const handleRefresh = async () => {
		setIsRefreshing( true );
		try {
			await refreshProject( selectedProject.id );
		} catch ( error ) {
			Sentry.captureException( error );
			ipcApi.showErrorMessageBox( {
				title: __( 'Could not refresh plugin project' ),
				message: __( 'Studio could not read the plugin metadata from this folder.' ),
				error: simplifyErrorForDisplay( error ),
			} );
		} finally {
			setIsRefreshing( false );
		}
	};

	const handleRemove = async () => {
		const REMOVE_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;
		const { response } = await ipcApi.showMessageBox( {
			type: 'warning',
			message: sprintf( __( 'Remove %s from Studio' ), selectedProject.name ),
			detail: __( 'The plugin folder will stay on your computer.' ),
			buttons: [ __( 'Remove project' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === REMOVE_BUTTON_INDEX ) {
			await removeProject( selectedProject.id );
		}
	};

	return (
		<ProjectWorkbench
			project={ selectedProject }
			isBlocked={ isBlocked }
			isRefreshing={ isRefreshing }
			onRefresh={ handleRefresh }
			onRemove={ handleRemove }
			openButtons={ openButtons }
		/>
	);
}
