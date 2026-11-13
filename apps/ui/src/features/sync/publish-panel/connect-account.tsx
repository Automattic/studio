import { getConnectMethod, getProvider, type SitesProviderId } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useConnectProvider } from '@/data/queries/use-ai-settings';
import { useOffline } from '@/lib/hooks';
import { SyncIcon } from '@/lib/icons';
import { Button, EmptyDescription, EmptyHeader, EmptyMedia } from '@/lib/ui';
import { ErrorMessage, PanelBody } from './parts';
import styles from './style.module.css';

// Connects a provider's account, signing in on its site, before its sites can be published to.
export function ConnectAccount( { provider }: { provider: SitesProviderId } ) {
	const connector = useConnector();
	const offline = useOffline();
	const { label, sites } = getProvider( provider );
	const signIn = useConnectProvider( provider );
	return (
		<div className={ styles.content }>
			<EmptyHeader className={ styles.emptyIntro }>
				<EmptyMedia className={ styles.emptyIcon }>
					<SyncIcon width="40" height="40" aria-hidden="true" />
				</EmptyMedia>
				<h2 className={ styles.emptyTitle }>{ sites!.intro.title() }</h2>
				<EmptyDescription className={ styles.emptyDescription }>
					{ sites!.intro.description() }{ ' ' }
					<Button
						variant="inline-accent"
						size="inline"
						onClick={ () => void connector.openExternalUrl( sites!.intro.learnMoreUrl ) }
					>
						{ __( 'Learn more…' ) }
					</Button>
				</EmptyDescription>
			</EmptyHeader>
			<PanelBody insetTop>
				<ErrorMessage error={ signIn.error } />
				{ signIn.pending?.code ? (
					<p className={ styles.text } role="status">
						{ sprintf(
							/* translators: 1: a sign-in code, 2: a service name such as Spacefast */
							__( 'Approve the code %1$s on %2$s to connect.' ),
							signIn.pending.code,
							label
						) }
					</p>
				) : null }
				<div className={ styles.introActions }>
					<Button
						variant="accent"
						size="lg"
						disabled={ offline }
						loading={ signIn.isPending }
						onClick={ () => signIn.mutate( { method: getConnectMethod( provider ).id } ) }
					>
						{ /* translators: %s: a service name such as Spacefast */ }
						{ sprintf( __( 'Connect %s' ), label ) }
					</Button>
				</div>
			</PanelBody>
		</div>
	);
}
