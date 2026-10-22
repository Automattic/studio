import { __ } from '@wordpress/i18n';
import { LearnMoreLink } from '@/components/learn-more';
import {
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
	useSetAllWordPressSkills,
	useWordPressSkills,
} from '@/data/queries/use-wordpress-skills';
import { SettingsGroup, SettingsRow, SettingsToggle } from './rows';
import styles from './style.module.css';

function getErrorMessage( error: unknown ): string | null {
	return error instanceof Error ? error.message : error ? String( error ) : null;
}

export function SkillsPanel() {
	const { data: skills, isLoading, error } = useWordPressSkills();
	const installSkill = useInstallWordPressSkill();
	const setAllSkills = useSetAllWordPressSkills();
	const removeSkill = useRemoveWordPressSkill();
	const skillList = skills ?? [];
	const anyInstalled = skillList.some( ( skill ) => skill.installed );
	const visibleError =
		getErrorMessage( error ) ??
		getErrorMessage( installSkill.error ) ??
		getErrorMessage( setAllSkills.error ) ??
		getErrorMessage( removeSkill.error );

	if ( isLoading ) {
		return <div className={ styles.state }>{ __( 'Loading skills…' ) }</div>;
	}

	return (
		<div className={ styles.preferencesPanel }>
			{ visibleError ? <div className={ styles.errorMessage }>{ visibleError }</div> : null }
			<SettingsGroup>
				<SettingsRow
					title={ __( 'WordPress skills' ) }
					description={ __(
						'Turn on WordPress skills for existing and new sites. Manage individual skills below.'
					) }
				>
					<SettingsToggle
						label={ __( 'WordPress skills' ) }
						checked={ anyInstalled }
						disabled={ setAllSkills.isPending || ! skillList.length }
						onChange={ ( installed ) =>
							setAllSkills.mutate( {
								skillIds: skillList
									.filter( ( skill ) => skill.installed !== installed )
									.map( ( skill ) => skill.id ),
								installed,
							} )
						}
					/>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup
				title={ __( 'Skills' ) }
				description={
					<>
						{ __(
							'Reusable instructions that teach agents specialized WordPress tasks. Studio adds the ones you turn on to every site.'
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsSkills" />
					</>
				}
			>
				{ skillList.map( ( skill ) => (
					<SettingsRow
						key={ skill.id }
						title={ skill.displayName }
						description={ skill.description }
					>
						<SettingsToggle
							label={ skill.displayName }
							checked={ skill.installed }
							disabled={ setAllSkills.isPending }
							onChange={ ( installed ) =>
								( installed ? installSkill : removeSkill ).mutate( skill.id )
							}
						/>
					</SettingsRow>
				) ) }
			</SettingsGroup>
		</div>
	);
}
