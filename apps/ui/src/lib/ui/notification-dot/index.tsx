import styles from './style.module.css';

/**
 * A small accent dot. `icon` sits on the corner of the icon it follows, which
 * it cuts out of; `end` sits in the trailing action slot of a sidebar row.
 */
export function NotificationDot( {
	position,
	label,
}: {
	position: 'icon' | 'end';
	/** Names the dot for assistive technology; it's decorative without one. */
	label?: string;
} ) {
	return (
		<span
			data-slot="notification-dot"
			data-position={ position }
			className={ styles.dot }
			role={ label ? 'img' : undefined }
			aria-label={ label }
			aria-hidden={ label ? undefined : true }
		/>
	);
}
