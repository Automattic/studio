import { TabPanel } from '@wordpress/components';
import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import { InstalledBadge } from 'src/components/installed-badge';
import Modal from 'src/components/modal';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	INSTRUCTION_FILES,
	type InstructionFileType,
} from 'src/modules/agent-instructions/constants';
import { type InstructionFileStatus } from 'src/modules/agent-instructions/lib/instructions';
import { type SkillStatus } from 'src/modules/agent-instructions/lib/skills-constants';

interface AiSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	siteId: string;
	initialTab?: 'skills' | 'instructions';
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

	const handleInstallAll = useCallback( async () => {
		setError( null );
		for ( const status of statuses ) {
			if ( ! status.exists ) {
				await handleInstallFile( status.id, false );
			}
		}
	}, [ statuses, handleInstallFile ] );

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-frame-text">{ __( 'Agent instructions' ) }</h3>
					<p className="text-xs text-frame-text-secondary mt-0.5">
						{ __( 'Install instructions so agents know how to use Studio' ) }
					</p>
				</div>
				{ ! allInstalled && (
					<Button
						variant="link"
						onClick={ handleInstallAll }
						disabled={ installingFile !== null }
						className="text-sm"
					>
						{ installingFile !== null ? __( 'Installing...' ) : __( 'Install All' ) }
					</Button>
				) }
			</div>

			{ error && (
				<div className="bg-frame-surface border border-frame-error/30 text-frame-error px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-frame-border rounded-md overflow-hidden">
				{ statuses.map( ( status ) => {
					const config = INSTRUCTION_FILES[ status.id ];
					const isInstalling = installingFile === status.id;
					return (
						<div
							key={ status.id }
							className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
						>
							<div className="flex-1 min-w-0 pr-3">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-frame-text">
										{ config.displayName }
									</span>
									{ status.exists && <InstalledBadge /> }
								</div>
								<div className="text-xs text-frame-text-secondary">
									{ __( config.description ) }
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
		</div>
	);
}

function WordPressSkillsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< SkillStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installingSkillId, setInstallingSkillId ] = useState< string | null >( null );
	const [ removingSkillId, setRemovingSkillId ] = useState< string | null >( null );

	const refreshStatus = useCallback( async () => {
		try {
			const result = await getIpcApi().getWordPressSkillsStatus( siteId );
			setStatuses( result as SkillStatus[] );
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

	const handleInstallSkill = useCallback(
		async ( skillId: string ) => {
			setInstallingSkillId( skillId );
			setError( null );
			try {
				await getIpcApi().installWordPressSkillById( siteId, skillId );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			} finally {
				setInstallingSkillId( null );
			}
		},
		[ siteId, refreshStatus ]
	);

	const handleRemoveSkill = useCallback(
		async ( skillId: string ) => {
			setRemovingSkillId( skillId );
			setError( null );
			try {
				await getIpcApi().removeWordPressSkillById( siteId, skillId );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			} finally {
				setRemovingSkillId( null );
			}
		},
		[ siteId, refreshStatus ]
	);

	const handleInstallAll = useCallback( async () => {
		setInstallingSkillId( 'all' );
		setError( null );
		try {
			await getIpcApi().installWordPressSkills( siteId );
			await refreshStatus();
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		} finally {
			setInstallingSkillId( null );
		}
	}, [ siteId, refreshStatus ] );

	const allInstalled = statuses.length > 0 && statuses.every( ( s ) => s.installed );

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-frame-text">{ __( 'WordPress skills' ) }</h3>
					<p className="text-xs text-frame-text-secondary mt-0.5">
						{ __( 'WordPress development skills for AI agents' ) }
					</p>
				</div>
				{ ! allInstalled && (
					<Button
						variant="link"
						onClick={ handleInstallAll }
						disabled={ installingSkillId !== null || removingSkillId !== null }
						className="text-sm"
					>
						{ installingSkillId === 'all' ? __( 'Installing...' ) : __( 'Install All' ) }
					</Button>
				) }
			</div>

			{ error && (
				<div className="bg-frame-surface border border-frame-error/30 text-frame-error px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-frame-border rounded-md overflow-hidden">
				{ statuses.map( ( skill ) => {
					const isInstalling = installingSkillId === skill.id;
					return (
						<div
							key={ skill.id }
							className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
						>
							<div className="flex-1 min-w-0 pr-3">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-frame-text truncate">
										{ skill.displayName }
									</span>
									{ skill.installed && (
										<span className="inline-flex items-center gap-1 text-[11px] text-green-900 bg-green-50 dark:!text-green-300 dark:bg-green-950 px-2 py-0.5 rounded-full flex-shrink-0">
											<Icon className="dark:fill-green-300" icon={ check } size={ 12 } />
											{ __( 'Installed' ) }
										</span>
									) }
								</div>
								<div className="text-xs text-frame-text-secondary truncate">
									{ skill.description }
								</div>
							</div>
							<div className="flex items-center gap-2 flex-shrink-0">
								{ skill.installed ? (
									<>
										<Button
											variant="link"
											onClick={ () =>
												getIpcApi().openFileInIDE( `.agents/skills/${ skill.id }/SKILL.md`, siteId )
											}
											className="text-xs"
										>
											{ __( 'Open' ) }
										</Button>
										<Button
											variant="link"
											onClick={ () => handleRemoveSkill( skill.id ) }
											disabled={ removingSkillId !== null }
											className="text-xs !text-a8c-red-50"
										>
											{ removingSkillId === skill.id ? __( 'Removing...' ) : __( 'Remove' ) }
										</Button>
									</>
								) : (
									<Button
										variant="secondary"
										onClick={ () => handleInstallSkill( skill.id ) }
										disabled={ installingSkillId !== null }
										className="text-xs py-1 px-2"
									>
										{ isInstalling ? __( 'Installing...' ) : __( 'Install' ) }
									</Button>
								) }
							</div>
						</div>
					);
				} ) }
			</div>
		</div>
	);
}

export function AiSettingsModal( {
	isOpen,
	onClose,
	siteId,
	initialTab = 'skills',
}: AiSettingsModalProps ) {
	const { __ } = useI18n();

	if ( ! isOpen ) {
		return null;
	}

	const tabs = [
		{ name: 'skills', title: __( 'Skills' ) },
		{ name: 'instructions', title: __( 'Instructions' ) },
	];

	return (
		<Modal
			title={ __( 'AI settings' ) }
			isDismissible
			onRequestClose={ onClose }
			size="medium"
			className={ cx( 'min-h-[350px] app-no-drag-region', '[&_[role="document"]]:px-0' ) }
		>
			<TabPanel
				className="w-full"
				tabs={ tabs }
				initialTabName={ initialTab }
				orientation="horizontal"
			>
				{ ( { name } ) => (
					<div className="mt-6 px-8 pb-4 flex flex-col gap-4">
						{ name === 'skills' && <WordPressSkillsPanel siteId={ siteId } /> }
						{ name === 'instructions' && <AgentInstructionsPanel siteId={ siteId } /> }
					</div>
				) }
			</TabPanel>
		</Modal>
	);
}
