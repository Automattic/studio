import styles from './style.module.css';

/**
 * A small accent dot. `icon` sits on the corner of the icon it follows, which
 * it cuts out of; `icon-outside` clears the icon without masking it.
 * `end` sits in the trailing action slot of a sidebar row.
 */
export function NotificationDot( {
	position,
	tone = 'accent',
	size = 'sm',
	label,
}: {
	position: 'icon' | 'icon-outside' | 'end' | 'inline';
	tone?: 'accent' | 'current';
	size?: 'sm' | 'md';
	/** Names the dot for assistive technology; it's decorative without one. */
	label?: string;
} ) {
	return (
		<span
			data-slot="notification-dot"
			data-position={ position }
			data-tone={ tone }
			data-size={ size }
			className={ styles.dot }
			role={ label ? 'img' : undefined }
			aria-label={ label }
			aria-hidden={ label ? undefined : true }
		/>
	);
}
