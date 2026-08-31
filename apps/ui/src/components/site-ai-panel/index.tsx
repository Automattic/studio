import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useMemo } from 'react';
import {
	useInstallAllSiteAgentInstructionFiles,
	useInstallAllSiteSkills,
	useInstallSiteAgentInstructionFile,
	useInstallSiteSkill,
	useRemoveSiteAgentInstructionFile,
	useRemoveSiteSkill,
	useSiteAgentInstructions,
	useSiteSkills,
} from '@/data/queries/use-site-ai';
import styles from './style.module.css';

function getErrorMessage( error: unknown ): string | null {
	return error instanceof Error ? error.message : error ? String( error ) : null;
}

function ListRow( {
	displayName,
	description,
	checked,
	disabled,
	onToggle,
}: {
	displayName: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onToggle: () => void;
} ) {
	return (
		<li className={ styles.row }>
			<div className={ styles.rowDetails }>
				<span className={ styles.rowName }>{ displayName }</span>
				<span className={ styles.rowDescription }>{ description }</span>
			</div>
			<FormToggle
				checked={ checked }
				disabled={ disabled }
				aria-label={ displayName }
				onChange={ onToggle }
			/>
		</li>
	);
}

function SiteSkillsSection( { siteId }: { siteId: string } ) {
	const { data: skills, isLoading, error } = useSiteSkills( siteId );
	const installSkill = useInstallSiteSkill( siteId );
	const installAllSkills = useInstallAllSiteSkills( siteId );
	const removeSkill = useRemoveSiteSkill( siteId );
	const skillList = skills ?? [];
	const availableSkills = useMemo(
		() => ( skills ?? [] ).filter( ( skill ) => ! skill.installed ),
		[ skills ]
	);
	const visibleError =
		getErrorMessage( error ) ??
		getErrorMessage( installSkill.error ) ??
		getErrorMessage( installAllSkills.error ) ??
		getErrorMessage( removeSkill.error );

	return (
		<section className={ styles.section }>
			<div className={ styles.sectionHeader }>
				<div className={ styles.sectionHeaderRow }>
					<h2>{ __( 'Skills' ) }</h2>
					{ availableSkills.length > 0 ? (
						<Button
							type="button"
							variant="outline"
							tone="neutral"
							size="compact"
							disabled={ installAllSkills.isPending }
							loading={ installAllSkills.isPending }
							loadingAnnouncement={ __( 'Installing all skills' ) }
							onClick={ () =>
								installAllSkills.mutate( availableSkills.map( ( skill ) => skill.id ) )
							}
						>
							{ __( 'Install all' ) }
						</Button>
					) : null }
				</div>
				<p>
					{ __(
						'Skills teach agents how to complete specialized WordPress tasks. These override the global selection from Settings for just this site.'
					) }
				</p>
			</div>
			{ visibleError ? <div className={ styles.errorMessage }>{ visibleError }</div> : null }
			{ isLoading ? <div className={ styles.state }>{ __( 'Loading skills…' ) }</div> : null }
			{ ! isLoading && skillList.length === 0 ? (
				<div className={ styles.state }>{ __( 'No skills are available.' ) }</div>
			) : null }
			{ skillList.length > 0 ? (
				<ul className={ styles.list }>
					{ skillList.map( ( skill ) => (
						<ListRow
							key={ skill.id }
							displayName={ skill.displayName }
							description={ skill.description }
							checked={ skill.installed }
							disabled={ installAllSkills.isPending }
							onToggle={ () =>
								skill.installed ? removeSkill.mutate( skill.id ) : installSkill.mutate( skill.id )
							}
						/>
					) ) }
				</ul>
			) : null }
		</section>
	);
}

function SiteInstructionsSection( { siteId }: { siteId: string } ) {
	const { data: statuses, isLoading, error } = useSiteAgentInstructions( siteId );
	const installFile = useInstallSiteAgentInstructionFile( siteId );
	const installAllFiles = useInstallAllSiteAgentInstructionFiles( siteId );
	const removeFile = useRemoveSiteAgentInstructionFile( siteId );
	const fileList = statuses ?? [];
	const availableFiles = useMemo(
		() => ( statuses ?? [] ).filter( ( status ) => ! status.installed ),
		[ statuses ]
	);
	const visibleError =
		getErrorMessage( error ) ??
		getErrorMessage( installFile.error ) ??
		getErrorMessage( installAllFiles.error ) ??
		getErrorMessage( removeFile.error );

	return (
		<section className={ styles.section }>
			<div className={ styles.sectionHeader }>
				<div className={ styles.sectionHeaderRow }>
					<h2>{ __( 'Instructions' ) }</h2>
					{ availableFiles.length > 0 ? (
						<Button
							type="button"
							variant="outline"
							tone="neutral"
							size="compact"
							disabled={ installAllFiles.isPending }
							loading={ installAllFiles.isPending }
							loadingAnnouncement={ __( 'Installing all instruction files' ) }
							onClick={ () =>
								installAllFiles.mutate( availableFiles.map( ( status ) => status.id ) )
							}
						>
							{ __( 'Install all' ) }
						</Button>
					) : null }
				</div>
				<p>
					{ __(
						'Instruction files like AGENTS.md are installed at the site root so AI agents know how to work with this site.'
					) }
				</p>
			</div>
			{ visibleError ? <div className={ styles.errorMessage }>{ visibleError }</div> : null }
			{ isLoading ? <div className={ styles.state }>{ __( 'Loading instructions…' ) }</div> : null }
			{ fileList.length > 0 ? (
				<ul className={ styles.list }>
					{ fileList.map( ( status ) => (
						<ListRow
							key={ status.id }
							displayName={ status.displayName }
							description={ status.description }
							checked={ status.installed }
							disabled={ installAllFiles.isPending }
							onToggle={ () =>
								status.installed ? removeFile.mutate( status.id ) : installFile.mutate( status.id )
							}
						/>
					) ) }
				</ul>
			) : null }
		</section>
	);
}

export function SiteAiPanel( { siteId }: { siteId: string } ) {
	return (
		<div className={ styles.root }>
			<SiteSkillsSection siteId={ siteId } />
			<SiteInstructionsSection siteId={ siteId } />
		</div>
	);
}
