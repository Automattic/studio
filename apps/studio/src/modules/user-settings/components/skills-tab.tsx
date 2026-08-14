import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { LearnMoreLink } from 'src/components/learn-more';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { type SkillStatus } from 'src/modules/agent-instructions/lib/skills-constants';

export function SkillsTab() {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< SkillStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installingSkillId, setInstallingSkillId ] = useState< string | null >( null );
	const [ installingAll, setInstallingAll ] = useState( false );

	const refreshStatus = useCallback( async () => {
		try {
			const result = await getIpcApi().getWordPressSkillsStatusAllSites();
			setStatuses( result as SkillStatus[] );
			setError( null );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		}
	}, [] );

	useEffect( () => {
		void refreshStatus();
		const handleFocus = () => void refreshStatus();
		window.addEventListener( 'focus', handleFocus );
		return () => window.removeEventListener( 'focus', handleFocus );
	}, [ refreshStatus ] );

	const handleRemoveSkill = useCallback(
		async ( skillId: string ) => {
			setError( null );
			try {
				await getIpcApi().removeWordPressSkillFromAllSites( skillId );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			}
		},
		[ refreshStatus ]
	);

	const handleInstallSkill = useCallback(
		async ( skillId: string ) => {
			setInstallingSkillId( skillId );
			setError( null );
			try {
				await getIpcApi().installWordPressSkillsToAllSites( { skillId } );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			} finally {
				setInstallingSkillId( null );
			}
		},
		[ refreshStatus ]
	);

	const installedSkills = useMemo( () => statuses.filter( ( s ) => s.installed ), [ statuses ] );
	const availableSkills = useMemo( () => statuses.filter( ( s ) => ! s.installed ), [ statuses ] );

	const handleInstallAll = useCallback( async () => {
		setInstallingAll( true );
		setError( null );
		try {
			for ( const skill of availableSkills ) {
				await getIpcApi().installWordPressSkillsToAllSites( { skillId: skill.id } );
			}
			await refreshStatus();
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		} finally {
			setInstallingAll( false );
		}
	}, [ availableSkills, refreshStatus ] );

	const isAnyInstalling = installingSkillId !== null || installingAll;

	return (
		<div className="flex flex-col gap-4 pb-2">
			<p className="a8c-body-small m-0">
				{ createInterpolateElement(
					__(
						'Select the skills that will be placed in all existing and new sites. Agents can decide to use skills to help them accomplish specialized tasks. <learn_more_link />'
					),
					{
						learn_more_link: <LearnMoreLink docsLinksKey="docsSkills" />,
					}
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
