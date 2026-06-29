import { __, sprintf } from '@wordpress/i18n';
import { check } from '@wordpress/icons';
import { Path, SVG } from '@wordpress/primitives';
import Button from 'src/components/button';
import workbenchStyles from '../development-workbench.module.css';
import { PlaygroundSection } from '../playground-section';
import { MetadataRow, ReadinessItem } from '../shared-ui';
import { VersionManagementSection } from '../version-management-section';
import { formatValidationSummary } from './utils';
import type {
	DevelopmentProject,
	DevelopmentProjectReleaseTag,
	DevelopmentProjectReleaseTagSwitchResult,
	DevelopmentProjectValidationResult,
} from '@studio/common/types/publishing';

const sparkIcon = (
	<SVG xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<Path
			d="M12 3L13.7 8.3L19 10L13.7 11.7L12 17L10.3 11.7L5 10L10.3 8.3L12 3Z"
			fill="currentColor"
		/>
		<Path
			d="M18 14L18.8 16.2L21 17L18.8 17.8L18 20L17.2 17.8L15 17L17.2 16.2L18 14Z"
			fill="currentColor"
		/>
		<Path d="M5 15L5.6 16.4L7 17L5.6 17.6L5 19L4.4 17.6L3 17L4.4 16.4L5 15Z" fill="currentColor" />
	</SVG>
);

type ReleaseSidebarProps = {
	project: DevelopmentProject;
	isBlocked: boolean;
	validationResult: DevelopmentProjectValidationResult | null;
	isValidatingProject: boolean;
	isRunningAiReview: boolean;
	hasUnsavedChanges: boolean;
	onRunValidation: () => void;
	onFixPluginCheck: () => void;
	onSwitchReleaseTag: (
		tag: DevelopmentProjectReleaseTag
	) => Promise< DevelopmentProjectReleaseTagSwitchResult >;
	onReleaseRefSwitched: () => void;
};

export function ReleaseSidebar( {
	project,
	isBlocked,
	validationResult,
	isValidatingProject,
	isRunningAiReview,
	hasUnsavedChanges,
	onRunValidation,
	onFixPluginCheck,
	onSwitchReleaseTag,
	onReleaseRefSwitched,
}: ReleaseSidebarProps ) {
	return (
		<div className={ workbenchStyles.sidebarPane }>
			<div className={ workbenchStyles.sidebarSection }>
				<h3>{ __( 'Project' ) }</h3>
				<div className={ workbenchStyles.metadataGrid }>
					<MetadataRow label={ __( 'Folder' ) } value={ project.path } />
					<MetadataRow label={ __( 'Main file' ) } value={ project.info?.mainFile } />
					<MetadataRow label={ __( 'Text domain' ) } value={ project.info?.textDomain } />
					<MetadataRow label={ __( 'Author' ) } value={ project.info?.author } />
					<MetadataRow
						label={ __( 'Requires at least' ) }
						value={ project.info?.requiresAtLeast }
					/>
					<MetadataRow label={ __( 'Tested up to' ) } value={ project.info?.testedUpTo } />
					<MetadataRow label={ __( 'Requires PHP' ) } value={ project.info?.requiresPhp } />
				</div>
			</div>

			<VersionManagementSection
				project={ project }
				isBlocked={ isBlocked }
				isCompact
				hasUnsavedChanges={ hasUnsavedChanges }
				onSwitchReleaseTag={ onSwitchReleaseTag }
				onReleaseRefSwitched={ onReleaseRefSwitched }
			/>
			<PlaygroundSection project={ project } isBlocked={ isBlocked } isCompact />

			<div className={ workbenchStyles.sidebarSection }>
				<div className={ workbenchStyles.sectionHeader }>
					<h3>{ __( 'Validation' ) }</h3>
					<span>
						{ validationResult
							? formatValidationSummary( validationResult.summary )
							: __( 'Not run' ) }
					</span>
				</div>
				<div className={ workbenchStyles.validationPanel }>
					<div className={ workbenchStyles.validationHeader }>
						<div>
							<strong>{ __( 'Readme + Plugin Check' ) }</strong>
							<span>
								{ validationResult
									? sprintf(
											// translators: %1$d is readme findings, %2$d is plugin-check findings.
											__( '%1$d readme, %2$d Plugin Check' ),
											validationResult.summary.readme,
											validationResult.summary.pluginCheck
									  )
									: __( 'Run validation before packaging.' ) }
							</span>
						</div>
						<div className={ workbenchStyles.validationActions }>
							{ validationResult?.summary.pluginCheck ? (
								<Button
									variant="secondary"
									icon={ sparkIcon }
									iconSize={ 18 }
									disabled={
										isBlocked || isValidatingProject || isRunningAiReview || hasUnsavedChanges
									}
									onClick={ onFixPluginCheck }
								>
									{ __( 'Fix' ) }
								</Button>
							) : null }
							<Button
								variant="secondary"
								icon={ check }
								iconSize={ 18 }
								disabled={ isBlocked || isValidatingProject }
								onClick={ onRunValidation }
							>
								{ isValidatingProject
									? __( 'Running…' )
									: validationResult
									? __( 'Re-run' )
									: __( 'Run' ) }
							</Button>
						</div>
					</div>
				</div>
			</div>

			<div className={ workbenchStyles.sidebarSection }>
				<h3>{ __( 'Publishing readiness' ) }</h3>
				<ul className={ workbenchStyles.readinessList }>
					<ReadinessItem
						label={ __( 'Plugin metadata' ) }
						description={
							isBlocked
								? __( 'Fix the folder or plugin headers before Studio can package it.' )
								: __( 'Studio found the plugin header and local project folder.' )
						}
						state={ isBlocked ? 'blocked' : 'ready' }
					/>
					<ReadinessItem
						label={ __( 'Readme + Plugin Check' ) }
						description={
							validationResult
								? formatValidationSummary( validationResult.summary )
								: __( 'Run validation before packaging.' )
						}
						state={
							validationResult?.summary.error ? 'blocked' : validationResult ? 'ready' : 'next'
						}
					/>
					<ReadinessItem
						label={ __( 'Package dry run' ) }
						description={ __( 'Build a release zip and review ignored files before submission.' ) }
						state="next"
					/>
					<ReadinessItem
						label={ __( 'WordPress.org publish' ) }
						description={ __( 'Submit or release only after an explicit confirmation step.' ) }
						state="next"
					/>
				</ul>
			</div>
		</div>
	);
}
