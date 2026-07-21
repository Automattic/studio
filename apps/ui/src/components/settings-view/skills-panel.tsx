import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useMemo } from 'react';
import { LearnMoreLink } from '@/components/learn-more';
import {
	useInstallAllWordPressSkills,
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
	useWordPressSkills,
} from '@/data/queries/use-wordpress-skills';
import styles from './style.module.css';
import type { SkillStatus } from '@/data/core';

function getErrorMessage( error: unknown ): string | null {
	return error instanceof Error ? error.message : error ? String( error ) : null;
}

function SkillRow( {
	skill,
	checked,
	disabled,
	onToggle,
}: {
	skill: SkillStatus;
	checked: boolean;
	disabled: boolean;
	onToggle: () => void;
} ) {
	return (
		<li className={ styles.skillRow }>
			<div className={ styles.skillDetails }>
				<span className={ styles.skillName }>{ skill.displayName }</span>
				<span className={ styles.skillDescription }>{ skill.description }</span>
			</div>
			<FormToggle
				checked={ checked }
				disabled={ disabled }
				aria-label={ skill.displayName }
				onChange={ onToggle }
			/>
		</li>
	);
}

export function SkillsPanel() {
	const { data: skills, isLoading, error } = useWordPressSkills();
	const installSkill = useInstallWordPressSkill();
	const installAllSkills = useInstallAllWordPressSkills();
	const removeSkill = useRemoveWordPressSkill();
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

	const handleToggle = ( skill: SkillStatus ) => {
		if ( skill.installed ) {
			removeSkill.mutate( skill.id );
		} else {
			installSkill.mutate( skill.id );
		}
	};

	return (
		<div className={ styles.skillsPanel }>
			<section className={ styles.settingsPanelSection }>
				<div className={ styles.settingsPanelHeader }>
					<div className={ styles.skillsHeaderRow }>
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
							'Skills are reusable instructions that teach agents how to complete specialized WordPress tasks. Enable the ones you want Studio to add to sites so agents have the right context before they start working.'
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsSkills" />
					</p>
				</div>
				{ visibleError ? <div className={ styles.errorMessage }>{ visibleError }</div> : null }
				{ isLoading ? <div className={ styles.state }>{ __( 'Loading skills...' ) }</div> : null }
				{ ! isLoading && skillList.length === 0 ? (
					<div className={ styles.state }>{ __( 'No skills are available.' ) }</div>
				) : null }
				{ skillList.length > 0 ? (
					<ul className={ styles.skillList }>
						{ skillList.map( ( skill ) => (
							<SkillRow
								key={ skill.id }
								skill={ skill }
								checked={ skill.installed }
								disabled={ installAllSkills.isPending }
								onToggle={ () => handleToggle( skill ) }
							/>
						) ) }
					</ul>
				) : null }
			</section>
		</div>
	);
}
