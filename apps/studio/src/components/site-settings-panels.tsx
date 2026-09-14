import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	INSTRUCTION_FILES,
	type InstructionFileType,
} from 'src/modules/agent-instructions/constants';
import { type InstructionFileStatus } from 'src/modules/agent-instructions/lib/instructions';
import { type SkillStatus } from 'src/modules/agent-instructions/lib/skills-constants';

export function AgentInstructionsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< InstructionFileStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installingFile, setInstallingFile ] = useState< InstructionFileType | null >( null );
	const [ installingAll, setInstallingAll ] = useState( false );

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
		async ( fileType: InstructionFileType ) => {
			setInstallingFile( fileType );
			setError( null );
			try {
				await getIpcApi().installAgentInstructions( siteId, { fileType } );
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

	const handleRemoveFile = useCallback(
		async ( fileType: InstructionFileType ) => {
			setError( null );
			try {
				await getIpcApi().removeAgentInstruction( siteId, fileType );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			}
		},
		[ siteId, refreshStatus ]
	);

	const installedFiles = useMemo( () => statuses.filter( ( s ) => s.exists ), [ statuses ] );
	const availableFiles = useMemo( () => statuses.filter( ( s ) => ! s.exists ), [ statuses ] );

	const handleInstallAll = useCallback( async () => {
		setInstallingAll( true );
		setError( null );
		try {
			for ( const status of availableFiles ) {
				await handleInstallFile( status.id );
			}
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		} finally {
			setInstallingAll( false );
		}
	}, [ availableFiles, handleInstallFile ] );

	const isAnyInstalling = installingFile !== null || installingAll;

	return (
		<div className="flex flex-col gap-4 pb-2">
			<p className="a8c-body-small m-0">
				{ __( 'Install instruction files so AI agents know how to work with this site.' ) }
			</p>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			{ installedFiles.length > 0 && (
				<div className="border border-frame-border rounded-md overflow-hidden">
					<div className="flex items-center px-3 py-2 bg-frame-surface border-b border-frame-border">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-frame-text-secondary">
							{ __( 'Installed' ) }
						</span>
					</div>
					{ installedFiles.map( ( status ) => {
						const config = INSTRUCTION_FILES[ status.id ];
						return (
							<div
								key={ status.id }
								className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
							>
								<div className="flex-1 min-w-0 pr-3">
									<div className="text-sm font-medium text-frame-text">{ config.displayName }</div>
									<div className="text-xs text-frame-text-secondary">
										{ __( config.description ) }
									</div>
								</div>
								<DropdownMenu
									icon={ moreVertical }
									label={ __( 'Instruction actions' ) }
									className="flex items-center"
									popoverProps={ { position: 'bottom left', resize: true } }
								>
									{ ( { onClose }: { onClose: () => void } ) => (
										<MenuGroup>
											<MenuItem
												onClick={ () => {
													getIpcApi().openFileInIDE( config.fileName, siteId );
													onClose();
												} }
											>
												{ __( 'Open' ) }
											</MenuItem>
											<MenuItem
												isDestructive
												onClick={ () => {
													void handleRemoveFile( status.id );
													onClose();
												} }
											>
												{ __( 'Remove' ) }
											</MenuItem>
										</MenuGroup>
									) }
								</DropdownMenu>
							</div>
						);
					} ) }
				</div>
			) }

			{ availableFiles.length > 0 && (
				<div className="border border-frame-border rounded-md overflow-hidden">
					<div className="flex items-center justify-between px-3 py-2 bg-frame-surface border-b border-frame-border">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-frame-text-secondary">
							{ __( 'Available' ) }
						</span>
						<Button
							variant="secondary"
							onClick={ handleInstallAll }
							disabled={ isAnyInstalling }
							className="text-xs py-1 px-2 [&.is-secondary]:bg-frame"
						>
							{ installingAll ? __( 'Installing...' ) : __( 'Install all' ) }
						</Button>
					</div>
					{ availableFiles.map( ( status ) => {
						const config = INSTRUCTION_FILES[ status.id ];
						const isInstallingThis = installingFile === status.id;
						return (
							<div
								key={ status.id }
								className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
							>
								<div className="flex-1 min-w-0 pr-3">
									<div className="text-sm font-medium text-frame-text">{ config.displayName }</div>
									<div className="text-xs text-frame-text-secondary">
										{ __( config.description ) }
									</div>
								</div>
								<div className="flex-shrink-0">
									<Button
										variant="secondary"
										onClick={ () => handleInstallFile( status.id ) }
										disabled={ isAnyInstalling }
										className="text-xs py-1 px-2"
									>
										{ isInstallingThis ? __( 'Installing...' ) : __( 'Install' ) }
									</Button>
								</div>
							</div>
						);
					} ) }
				</div>
			) }

			{ statuses.length === 0 && ! error && (
				<div className="text-sm text-gray-500 text-center py-4">
					{ __( 'Loading instructions...' ) }
				</div>
			) }
		</div>
	);
}

export function WordPressSkillsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< SkillStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installingSkillId, setInstallingSkillId ] = useState< string | null >( null );
	const [ installingAll, setInstallingAll ] = useState( false );

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
			setError( null );
			try {
				await getIpcApi().removeWordPressSkillById( siteId, skillId );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			}
		},
		[ siteId, refreshStatus ]
	);

	const installedSkills = useMemo( () => statuses.filter( ( s ) => s.installed ), [ statuses ] );
	const availableSkills = useMemo( () => statuses.filter( ( s ) => ! s.installed ), [ statuses ] );

	const handleInstallAll = useCallback( async () => {
		setInstallingAll( true );
		setError( null );
		try {
			for ( const skill of availableSkills ) {
				await getIpcApi().installWordPressSkillById( siteId, skill.id );
			}
			await refreshStatus();
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		} finally {
			setInstallingAll( false );
		}
	}, [ siteId, availableSkills, refreshStatus ] );

	const isAnyInstalling = installingSkillId !== null || installingAll;

	return (
		<div className="flex flex-col gap-4 pb-2">
			<p className="a8c-body-small m-0">
				{ __(
					'Manage skills for this site. These override the global skills from Studio Settings.'
				) }
			</p>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			{ installedSkills.length > 0 && (
				<div className="border border-frame-border rounded-md overflow-hidden">
					<div className="flex items-center px-3 py-2 bg-frame-surface border-b border-frame-border">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-frame-text-secondary">
							{ __( 'Installed' ) }
						</span>
					</div>
					{ installedSkills.map( ( skill ) => (
						<div
							key={ skill.id }
							className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
						>
							<div className="flex-1 min-w-0 pr-3">
								<div className="text-sm font-medium text-frame-text">{ skill.displayName }</div>
								<div className="text-xs text-frame-text-secondary">{ skill.description }</div>
							</div>
							<DropdownMenu
								icon={ moreVertical }
								label={ __( 'Skill actions' ) }
								className="flex items-center"
								popoverProps={ { position: 'bottom left', resize: true } }
							>
								{ ( { onClose }: { onClose: () => void } ) => (
									<MenuGroup>
										<MenuItem
											onClick={ () => {
												getIpcApi().openFileInIDE(
													`.agents/skills/${ skill.id }/SKILL.md`,
													siteId
												);
												onClose();
											} }
										>
											{ __( 'Open' ) }
										</MenuItem>
										<MenuItem
											isDestructive
											onClick={ () => {
												void handleRemoveSkill( skill.id );
												onClose();
											} }
										>
											{ __( 'Remove' ) }
										</MenuItem>
									</MenuGroup>
								) }
							</DropdownMenu>
						</div>
					) ) }
				</div>
			) }

			{ availableSkills.length > 0 && (
				<div className="border border-frame-border rounded-md overflow-hidden">
					<div className="flex items-center justify-between px-3 py-2 bg-frame-surface border-b border-frame-border">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-frame-text-secondary">
							{ __( 'Available' ) }
						</span>
						<Button
							variant="secondary"
							onClick={ handleInstallAll }
							disabled={ isAnyInstalling }
							className="text-xs py-1 px-2 [&.is-secondary]:bg-frame"
						>
							{ installingAll ? __( 'Installing...' ) : __( 'Install all' ) }
						</Button>
					</div>
					{ availableSkills.map( ( skill ) => {
						const isInstallingThis = installingSkillId === skill.id;
						return (
							<div
								key={ skill.id }
								className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
							>
								<div className="flex-1 min-w-0 pr-3">
									<div className="text-sm font-medium text-frame-text">{ skill.displayName }</div>
									<div className="text-xs text-frame-text-secondary">{ skill.description }</div>
								</div>
								<div className="flex-shrink-0">
									<Button
										variant="secondary"
										onClick={ () => handleInstallSkill( skill.id ) }
										disabled={ isAnyInstalling }
										className="text-xs py-1 px-2"
									>
										{ isInstallingThis ? __( 'Installing...' ) : __( 'Install' ) }
									</Button>
								</div>
							</div>
						);
					} ) }
				</div>
			) }

			{ statuses.length === 0 && ! error && (
				<div className="text-sm text-gray-500 text-center py-4">{ __( 'Loading skills…' ) }</div>
			) }
		</div>
	);
}
