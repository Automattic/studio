import { SyncIcon } from './sync-icon';
import type { ComponentProps } from 'react';

export function PublishTransferIcon( {
	direction,
	...props
}: ComponentProps< 'svg' > & { direction: 'push' | 'pull' } ) {
	return (
		<SyncIcon width="16" height="16" data-publish-transfer={ direction } { ...props }>
			<g fill="currentColor">
				<circle cx="12" cy="14" r="1" />
				<circle cx="12" cy="17" r="1" />
				<circle cx="12" cy="20" r="1" />
			</g>
		</SyncIcon>
	);
}
