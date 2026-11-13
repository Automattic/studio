import { getSnapshotExpiry } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { CopyButton } from '@/features/clipboard';
import { ExternalLinkIcon, GlobeIcon, GlobeHemisphereIcon, LinkIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import { DomainPlusIcon } from './domain-plus-icon';
import { PublishedTime } from './published-time';
import styles from './style.module.css';
import type { Snapshot } from '@/data/core';
import type { Ref } from 'react';

export function DomainControl( {
	hostname,
	disabled,
	shareUrl,
	copyRef,
	onClick,
	onOpen,
	hasCustomDomain = false,
	makePublic = false,
	grouped = false,
	snapshot,
	publishedAt,
}: {
	hostname?: string;
	disabled: boolean;
	shareUrl?: string;
	copyRef?: Ref< HTMLButtonElement >;
	onClick: () => void;
	onOpen?: () => void;
	hasCustomDomain?: boolean;
	makePublic?: boolean;
	grouped?: boolean;
	snapshot?: Snapshot;
	publishedAt?: string | null;
} ) {
	const label = makePublic ? __( 'Make it public' ) : __( 'Add a domain' );
	const description = makePublic ? __( 'Add a domain and go live' ) : __( 'Blah' );
	const locale = useUserLocale();
	return (
		<>
			{ hostname ? (
				<div>
					{ onOpen && ! snapshot ? (
						<Button
							variant="ghost"
							className={ `${ styles.domainTrigger } ${
								publishedAt ? styles.domainWithDescription : ''
							}` }
							onClick={ onOpen }
						>
							<GlobeIcon data-icon="inline-start" />
							<span className={ styles.previewAddress }>
								<span className={ styles.previewHostname } title={ hostname }>
									{ hostname }
								</span>
								{ publishedAt ? (
									<span className={ styles.expiry }>
										<PublishedTime timestamp={ publishedAt } />
									</span>
								) : null }
							</span>
							<ExternalLinkIcon data-icon="inline-end" />
						</Button>
					) : (
						<div className={ styles.addressRow }>
							<Button
								variant="ghost"
								className={ styles.previewOpenButton }
								onClick={ onOpen }
								aria-label={ sprintf( __( 'Open preview: %s' ), hostname ) }
							>
								<LinkIcon data-icon="inline-start" />
								<span className={ styles.previewAddress }>
									<span className={ styles.previewUrl }>
										<span className={ styles.previewHostname } title={ hostname }>
											{ hostname }
										</span>
									</span>
									{ snapshot ? (
										<span className={ styles.expiry }>
											{ sprintf(
												__( 'Expires %s' ),
												new Date( getSnapshotExpiry( snapshot ) ).toLocaleDateString( locale, {
													month: 'short',
													day: 'numeric',
												} )
											) }
										</span>
									) : null }
								</span>
							</Button>
							{ shareUrl ? (
								<CopyButton
									key={ shareUrl }
									ref={ copyRef }
									className={ styles.previewCopyButton }
									text={ shareUrl }
									label={ __( 'Copy preview link' ) }
									size="icon-sm"
								/>
							) : null }
						</div>
					) }
				</div>
			) : null }
			{ ! hasCustomDomain ? (
				<div className={ styles.addressRow }>
					<Button
						variant={ makePublic && ! grouped ? 'outline' : 'ghost' }
						disabled={ disabled }
						className={ `${ styles.domainTrigger } ${ styles.domainWithDescription } ${ styles.domainOpenButton }` }
						aria-label={ label }
						aria-description={ description }
						onClick={ onClick }
					>
						{ makePublic ? (
							<GlobeHemisphereIcon data-icon="inline-start" />
						) : (
							<DomainPlusIcon data-icon="inline-start" />
						) }
						<span className={ styles.domainText }>
							<span>{ label }</span>
							<span className={ styles.accessDescription }>{ description }</span>
						</span>
					</Button>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="muted-ghost"
									size="icon-sm"
									className={ styles.previewCopyButton }
									aria-label={ __( 'Open WordPress.com' ) }
									disabled={ disabled }
									onClick={ onClick }
								/>
							}
						>
							<ExternalLinkIcon />
						</TooltipTrigger>
						<TooltipContent>{ __( 'Open WordPress.com' ) }</TooltipContent>
					</Tooltip>
				</div>
			) : null }
		</>
	);
}
