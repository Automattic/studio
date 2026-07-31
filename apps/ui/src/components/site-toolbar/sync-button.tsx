import { __, sprintf } from '@wordpress/i18n';
import { forwardRef } from 'react';
import * as Menu from '@/components/menu';
import { ActionButton } from './action-button';
import { formatSyncTimestamp } from './derive-toolbar-state';
import styles from './style.module.css';
import { getConnectionLabel, stripProtocol } from './utils';
import type { ToolbarAction } from './derive-toolbar-state';
import type { SyncSite } from '@/data/core';
import type { ElementRef } from 'react';

type Props = {
	action: ToolbarAction;
	// Every connection this action could run against, production first.
	targets: SyncSite[];
	onRun: ( target: SyncSite ) => void;
};

/** The freshest thing this connection can say about itself, if anything. */
function connectionAge( target: SyncSite ): string | null {
	return (
		formatSyncTimestamp( target.lastPushTimestamp ) ??
		formatSyncTimestamp( target.lastPullTimestamp )
	);
}

/**
 * A push or pull button that knows how many places it could go. With one
 * connection it just runs. With more than one it asks which, at the moment it
 * matters — so nothing is left armed at the wrong environment between visits,
 * and no header space is spent on a picker most sites don't need.
 */
export const SyncButton = forwardRef< ElementRef< typeof ActionButton >, Props >(
	function SyncButton( { action, targets, onRun }, ref ) {
		if ( targets.length <= 1 ) {
			return (
				<ActionButton
					ref={ ref }
					action={ action }
					onClick={ () => targets[ 0 ] && onRun( targets[ 0 ] ) }
				/>
			);
		}

		return (
			<Menu.Root modal={ false }>
				<Menu.Trigger render={ <ActionButton action={ action } /> } />
				<Menu.Popup side="bottom" align="end" className={ styles.menu }>
					<div className={ styles.menuGroupLabel }>
						{ action.id === 'pull'
							? __( 'Pull from…' )
							: // translators: header of a list of sites to push to.
							  __( 'Push to…' ) }
					</div>
					{ targets.map( ( target ) => {
						const age = connectionAge( target );
						return (
							<Menu.Item
								key={ target.id }
								disabled={ action.disabled }
								onClick={ () => onRun( target ) }
							>
								<span className={ styles.menuItemStack }>
									<span>{ getConnectionLabel( target ) }</span>
									<span className={ styles.menuItemSub }>{ stripProtocol( target.url ) }</span>
								</span>
								<span className={ styles.menuItemMeta }>
									{ age
										? sprintf(
												// translators: %s: compact relative time, e.g. "6d".
												__( '%s ago' ),
												age
										  )
										: __( 'never' ) }
								</span>
							</Menu.Item>
						);
					} ) }
				</Menu.Popup>
			</Menu.Root>
		);
	}
);
