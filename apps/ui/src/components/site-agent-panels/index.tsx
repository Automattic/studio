import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	useAgentInstructionsStatus,
	useInstallAgentInstructions,
	useInstallSiteWordPressSkill,
	useRemoveAgentInstruction,
	useRemoveSiteWordPressSkill,
	useSiteWordPressSkillsStatus,
} from '@/data/queries/use-site-agent-config';
import styles from './style.module.css';
import type { InstructionFileType, SkillStatus } from '@/data/core';

const INSTRUCTION_FILES: Record<
	InstructionFileType,
	{ fileName: string; displayName: string; description: string }
> = {
	agents: {
		fileName: 'AGENTS.md',
		displayName: 'AGENTS.md',
		description: 'Instructions for Codex, Goose, and other AI agents',
	},
	claude: {
		fileName: 'CLAUDE.md',
		displayName: 'CLAUDE.md',
		description: 'Reference for Claude Code to read AGENTS.md',
	},
	studio: {
		fileName: 'STUDIO.md',
		displayName: 'STUDIO.md',
		description: 'Detailed Studio-specific WordPress development instructions',
	},
};

function PanelError( { message }: { message: string } ) {
	return <div className={ styles.error }>{ message }</div>;
}

export function AgentInstructionsPanel( { siteId }: { siteId: string } ) {
	const connector = useConnector();
	const { data: statuses = [], isLoading, error } = useAgentInstructionsStatus( siteId );
	const installMutation = useInstallAgentInstructions( siteId );
	const removeMutation = useRemoveAgentInstruction( siteId );
	const [ installingAll, setInstallingAll ] = useState( false );

	const installedFiles = useMemo(
		() => statuses.filter( ( status ) => status.exists ),
		[ statuses ]
	);
	const availableFiles = useMemo(
		() => statuses.filter( ( status ) => ! status.exists ),
		[ statuses ]
	);
	const isAnyInstalling = installingAll || installMutation.isPending || removeMutation.isPending;

	const handleInstallAll = async () => {
		setInstallingAll( true );
		try {
			for ( const status of availableFiles ) {
				await installMutation.mutateAsync( status.id );
			}
		} finally {
			setInstallingAll( false );
		}
	};

	return (
		<div className={ styles.panel }>
			<p className={ styles.intro }>
				{ __( 'Install instruction files so AI agents know how to work with this site.' ) }
			</p>

			{ error && <PanelError message={ ( error as Error ).message } /> }
			{ installMutation.error && (
				<PanelError message={ ( installMutation.error as Error ).message } />
			) }
			{ removeMutation.error && (
				<PanelError message={ ( removeMutation.error as Error ).message } />
			) }

			{ installedFiles.length > 0 && (
				<div className={ styles.section }>
					<div className={ styles.sectionHeader }>
						<span>{ __( 'Installed' ) }</span>
					</div>
					{ installedFiles.map( ( status ) => {
						const config = INSTRUCTION_FILES[ status.id ];
						return (
							<div key={ status.id } className={ styles.row }>
								<div className={ styles.rowContent }>
									<div className={ styles.rowTitle }>{ config.displayName }</div>
									<div className={ styles.rowDescription }>{ __( config.description ) }</div>
								</div>
								<DropdownMenu
									icon={ moreVertical }
									label={ __( 'Instruction actions' ) }
									popoverProps={ { position: 'bottom left', resize: true } }
								>
									{ ( { onClose } ) => (
										<MenuGroup>
											<MenuItem
												onClick={ () => {
													void connector.openSiteFileInEditor( siteId, config.fileName );
													onClose();
												} }
											>
												{ __( 'Open' ) }
											</MenuItem>
											<MenuItem
												isDestructive
												onClick={ () => {
													void removeMutation.mutate( status.id );
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
				<div className={ styles.section }>
					<div className={ styles.sectionHeaderWithAction }>
						<span>{ __( 'Available' ) }</span>
						<Button
							variant="outline"
							size="compact"
							onClick={ () => void handleInstallAll() }
							disabled={ isAnyInstalling }
							loading={ installingAll }
						>
							{ __( 'Install all' ) }
						</Button>
					</div>
					{ availableFiles.map( ( status ) => {
						const config = INSTRUCTION_FILES[ status.id ];
						const isInstalling =
							installMutation.isPending && installMutation.variables === status.id;
						return (
							<div key={ status.id } className={ styles.row }>
								<div className={ styles.rowContent }>
									<div className={ styles.rowTitle }>{ config.displayName }</div>
									<div className={ styles.rowDescription }>{ __( config.description ) }</div>
								</div>
								<Button
									variant="outline"
									size="compact"
									onClick={ () => installMutation.mutate( status.id ) }
									disabled={ isAnyInstalling }
									loading={ isInstalling }
								>
									{ __( 'Install' ) }
								</Button>
							</div>
						);
					} ) }
				</div>
			) }

			{ isLoading && statuses.length === 0 && (
				<div className={ styles.loading }>{ __( 'Loading instructions…' ) }</div>
			) }
		</div>
	);
}

export function WordPressSkillsPanel( { siteId }: { siteId: string } ) {
	const connector = useConnector();
	const { data: statuses = [], isLoading, error } = useSiteWordPressSkillsStatus( siteId );
	const installMutation = useInstallSiteWordPressSkill( siteId );
	const removeMutation = useRemoveSiteWordPressSkill( siteId );
	const [ installingAll, setInstallingAll ] = useState( false );

	const installedSkills = useMemo(
		() => statuses.filter( ( skill: SkillStatus ) => skill.installed ),
		[ statuses ]
	);
	const availableSkills = useMemo(
		() => statuses.filter( ( skill: SkillStatus ) => ! skill.installed ),
		[ statuses ]
	);
	const isAnyInstalling = installingAll || installMutation.isPending || removeMutation.isPending;

	const handleInstallAll = async () => {
		setInstallingAll( true );
		try {
			for ( const skill of availableSkills ) {
				await installMutation.mutateAsync( skill.id );
			}
		} finally {
			setInstallingAll( false );
		}
	};

	return (
		<div className={ styles.panel }>
			<p className={ styles.intro }>
				{ __(
					'Manage skills for this site. These override the global skills from Studio Settings.'
				) }
			</p>

			{ error && <PanelError message={ ( error as Error ).message } /> }
			{ installMutation.error && (
				<PanelError message={ ( installMutation.error as Error ).message } />
			) }
			{ removeMutation.error && (
				<PanelError message={ ( removeMutation.error as Error ).message } />
			) }

			{ installedSkills.length > 0 && (
				<div className={ styles.section }>
					<div className={ styles.sectionHeader }>
						<span>{ __( 'Installed' ) }</span>
					</div>
					{ installedSkills.map( ( skill ) => (
						<div key={ skill.id } className={ styles.row }>
							<div className={ styles.rowContent }>
								<div className={ styles.rowTitle }>{ skill.displayName }</div>
								<div className={ styles.rowDescription }>{ skill.description }</div>
							</div>
							<DropdownMenu
								icon={ moreVertical }
								label={ __( 'Skill actions' ) }
								popoverProps={ { position: 'bottom left', resize: true } }
							>
								{ ( { onClose } ) => (
									<MenuGroup>
										<MenuItem
											onClick={ () => {
												void connector.openSiteFileInEditor(
													siteId,
													`.agents/skills/${ skill.id }/SKILL.md`
												);
												onClose();
											} }
										>
											{ __( 'Open' ) }
										</MenuItem>
										<MenuItem
											isDestructive
											onClick={ () => {
												void removeMutation.mutate( skill.id );
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
				<div className={ styles.section }>
					<div className={ styles.sectionHeaderWithAction }>
						<span>{ __( 'Available' ) }</span>
						<Button
							variant="outline"
							size="compact"
							onClick={ () => void handleInstallAll() }
							disabled={ isAnyInstalling }
							loading={ installingAll }
						>
							{ __( 'Install all' ) }
						</Button>
					</div>
					{ availableSkills.map( ( skill ) => {
						const isInstalling =
							installMutation.isPending && installMutation.variables === skill.id;
						return (
							<div key={ skill.id } className={ styles.row }>
								<div className={ styles.rowContent }>
									<div className={ styles.rowTitle }>{ skill.displayName }</div>
									<div className={ styles.rowDescription }>{ skill.description }</div>
								</div>
								<Button
									variant="outline"
									size="compact"
									onClick={ () => installMutation.mutate( skill.id ) }
									disabled={ isAnyInstalling }
									loading={ isInstalling }
								>
									{ __( 'Install' ) }
								</Button>
							</div>
						);
					} ) }
				</div>
			) }

			{ isLoading && statuses.length === 0 && (
				<div className={ styles.loading }>{ __( 'Loading skills…' ) }</div>
			) }
		</div>
	);
}
