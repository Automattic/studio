import { __ } from '@wordpress/i18n';
import { LearnMoreLink } from '@/components/learn-more';
import { Button } from '@/components/ui/button';
import {
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
	useSetAllWordPressSkills,
	useWordPressSkills,
} from '@/data/queries/use-wordpress-skills';
import { SettingsGroup, SettingsLoadState, SettingsRow, SettingsToggle } from './rows';
import styles from './style.module.css';

function getErrorMessage( error: unknown ): string | null {
	return error instanceof Error ? error.message : error ? String( error ) : null;
}

export function SkillsPanel( { onManageSite }: { onManageSite?: () => void } ) {
	const { data: skills, isLoading, isError, refetch } = useWordPressSkills();
	const installSkill = useInstallWordPressSkill();
	const setAllSkills = useSetAllWordPressSkills();
	const removeSkill = useRemoveWordPressSkill();
	const saving = installSkill.isPending || setAllSkills.isPending || removeSkill.isPending;
	const visibleError =
		getErrorMessage( installSkill.error ) ??
		getErrorMessage( setAllSkills.error ) ??
		getErrorMessage( removeSkill.error );

	if ( ! skills ) {
		return (
			<SettingsLoadState loadFailed={ ! isLoading && isError } onRetry={ () => void refetch() } />
		);
	}
	if ( ! skills.length ) {
		return <div className={ styles.state }>{ __( 'No skills are available.' ) }</div>;
	}
	const enabled = skills.some( ( skill ) => skill.installed );

	return (
		<div className={ styles.preferencesPanel }>
			{ visibleError ? <div className={ styles.errorMessage }>{ visibleError }</div> : null }
			<SettingsGroup>
				<SettingsRow
					title={ __( 'WordPress skills' ) }
					description={
						<>
							{ __(
								'Turn on WordPress skills for existing and new sites. Manage individual skills below.'
							) }
							{ onManageSite ? (
								<Button
									className={ styles.manageLink }
									variant="inline-link"
									size="inline"
									disabled={ saving }
									onClick={ onManageSite }
								>
									{ __( 'Manage skills for this site' ) }
								</Button>
							) : null }
						</>
					}
				>
					<SettingsToggle
						label={ __( 'WordPress skills' ) }
						checked={ enabled }
						disabled={ saving }
						onChange={ ( installed ) =>
							setAllSkills.mutate( {
								skillIds: skills
									.filter( ( skill ) => skill.installed !== installed )
									.map( ( skill ) => skill.id ),
								installed,
							} )
						}
					/>
				</SettingsRow>
			</SettingsGroup>
			{ enabled ? (
				<SettingsGroup
					title={ __( 'Skills' ) }
					description={
						<>
							{ __(
								'Reusable instructions that teach agents specialized WordPress tasks. WordPress Studio adds the ones you turn on to every site.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsSkills" />
						</>
					}
				>
					{ skills.map( ( skill ) => (
						<SettingsRow
							key={ skill.id }
							title={ skill.displayName }
							description={ skill.description }
						>
							<SettingsToggle
								label={ skill.displayName }
								checked={ skill.installed }
								disabled={ saving }
								onChange={ ( installed ) =>
									( installed ? installSkill : removeSkill ).mutate( skill.id )
								}
							/>
						</SettingsRow>
					) ) }
				</SettingsGroup>
			) : null }
		</div>
	);
}
