interface ScrollMetrics {
	scrollHeight: number;
	scrollTop: number;
	clientHeight: number;
}

/**
 * Returns true when a scroll container is at (or within `threshold` pixels of)
 * its bottom. Pure helper so the stick-to-bottom logic stays unit-testable.
 */
export function isScrolledToBottom(
	{ scrollHeight, scrollTop, clientHeight }: ScrollMetrics,
	threshold = 32
): boolean {
	return scrollHeight - scrollTop - clientHeight < threshold;
}
