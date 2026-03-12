import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	DEFAULT_INSTRUCTIONS_MAP,
	INSTRUCTION_FILES,
	INSTRUCTION_FILE_TYPES,
	type InstructionFileType,
} from 'src/modules/agent-instructions/constants';
import { type InstructionFileStatus } from 'src/modules/agent-instructions/lib/instructions';

interface AiSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	siteId: string;
}

function AgentInstructionsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< InstructionFileStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installingFile, setInstallingFile ] = useState< InstructionFileType | null >( null );

	const refreshStatus = useCallback( async () => {
		try {
			const result = await getIpcApi().getAgentInstructionsStatus( siteId );
			setStatuses( result as InstructionFileStatus[] );
			setError( null );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		}
	}, [ siteId ] );

	useEffect( () => {
		void refreshStatus();
		const handleFocus = () => void refreshStatus();
		window.addEventListener( 'focus', handleFocus );
		return () => window.removeEventListener( 'focus', handleFocus );
	}, [ refreshStatus ] );

	const handleInstallFile = useCallback(
		async ( fileType: InstructionFileType, overwrite: boolean ) => {
			setInstallingFile( fileType );
			setError( null );
			try {
				await getIpcApi().installAgentInstructions( siteId, { overwrite, fileType } );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			} finally {
				setInstallingFile( null );
			}
		},
		[ siteId, refreshStatus ]
	);

	const allInstalled = statuses.length > 0 && statuses.every( ( s ) => s.exists );

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-gray-900">{ __( 'Agent instructions' ) }</h3>
					<p className="text-xs text-gray-500 mt-0.5">
						{ __( 'Install instructions so agents know how to use Studio' ) }
					</p>
				</div>
				{ ! allInstalled && (
					<Button
						variant="link"
						onClick={ async () => {
							for ( const fileType of INSTRUCTION_FILE_TYPES ) {
								await handleInstallFile( fileType, false );
							}
						} }
						disabled={ installingFile !== null }
						className="text-sm"
					>
						{ installingFile !== null ? __( 'Installing...' ) : __( 'Install All' ) }
					</Button>
				) }
			</div>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-gray-200 rounded-md overflow-hidden">
				{ statuses.map( ( status ) => {
					const config = INSTRUCTION_FILES[ status.id ];
					const isInstalling = installingFile === status.id;
					return (
						<div
							key={ status.id }
							className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 last:border-b-0"
						>
							<div className="flex-1 min-w-0 pr-3">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-gray-900">{ config.displayName }</span>
									{ status.exists && ! status.isCustomized && (
										<span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
											<Icon icon={ check } size={ 12 } />
											{ __( 'Installed' ) }
										</span>
									) }
									{ status.exists && status.isCustomized && (
										<span className="inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
											{ __( 'Custom' ) }
										</span>
									) }
								</div>
								<div className="text-xs text-gray-500">
									{ status.isCustomized
										? __(
												'You are using a custom version of this file. You can use the "Reinstall" option to use the newest Studio version. Your customizations will be overwritten.'
										  )
										: __( config.description ) }
								</div>
							</div>
							<div className="flex items-center gap-2 flex-shrink-0">
								{ status.exists && (
									<Button
										variant="link"
										onClick={ () => getIpcApi().openFileInIDE( config.fileName, siteId ) }
										className="text-xs"
									>
										{ __( 'Open' ) }
									</Button>
								) }
								<Button
									variant="secondary"
									onClick={ () => handleInstallFile( status.id, status.exists ) }
									disabled={ isInstalling }
									className="text-xs py-1 px-2"
								>
									{ isInstalling
										? __( 'Installing...' )
										: status.exists
										? __( 'Reinstall' )
										: __( 'Install' ) }
								</Button>
							</div>
						</div>
					);
				} ) }
			</div>

			{ statuses.map( ( status ) => (
				<details key={ `preview-${ status.id }` } className="group">
					<summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
						{ `${ __( 'View template content' ) } — ${ status.fileName }` }
					</summary>
					<div className="mt-2 border border-gray-200 rounded-md bg-gray-50 p-3 max-h-48 overflow-y-auto">
						<pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
							{ DEFAULT_INSTRUCTIONS_MAP[ status.id ] }
						</pre>
					</div>
				</details>
			) ) }
		</div>
	);
}

export function AiSettingsModal( { isOpen, onClose, siteId }: AiSettingsModalProps ) {
	const { __ } = useI18n();

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			title={ __( 'AI settings' ) }
			isDismissible
			onRequestClose={ onClose }
			size="medium"
			className="min-h-[350px] app-no-drag-region"
		>
			<div className="px-2 pb-4 flex gap-4 flex-col">
				<AgentInstructionsPanel siteId={ siteId } />
			</div>
		</Modal>
	);
}
