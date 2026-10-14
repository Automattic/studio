import { Icon, plus } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import styles from './environment-section.module.css';
import type { ReactNode } from 'react';

type Props = {
	title: string;
	count: number;
	actionLabel: string;
	actionDisabled: boolean;
	actionLoading?: boolean;
	onAction: () => void;
	// Shown under the header: why the list is empty, or what is in progress.
	status?: ReactNode;
	children: ReactNode;
};

// A list of the site's remote environments (previews, live sites) under a
// header with a count and the action that adds one.
export function EnvironmentSection( {
	title,
	count,
	actionLabel,
	actionDisabled,
	actionLoading,
	onAction,
	status,
	children,
}: Props ) {
	return (
		<section className={ styles.section } aria-label={ title }>
			<div className={ styles.header }>
				<div className={ styles.title }>
					{ title }
					{ count > 0 ? <span className={ styles.count }>{ count }</span> : null }
				</div>
				<Button
					variant="outline"
					tone="neutral"
					size="compact"
					className={ styles.newButton }
					disabled={ actionDisabled }
					loading={ actionLoading }
					onClick={ onAction }
				>
					<Icon icon={ plus } size={ 16 } aria-hidden="true" />
					{ actionLabel }
				</Button>
			</div>
			{ typeof status === 'string' ? <p className={ styles.notice }>{ status }</p> : status }
			{ children }
		</section>
	);
}
