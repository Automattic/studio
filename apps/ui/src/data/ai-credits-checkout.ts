// Raised while the user is away at WordPress.com checkout. This flag is what
// keeps a window focus honest: without it, credits bought in some other session
// would surface here as a purchase that never happened in this window.
let checkoutPending = false;

export function markAiCreditsCheckoutPending(): void {
	checkoutPending = true;
}

export function isAiCreditsCheckoutPending(): boolean {
	return checkoutPending;
}

export function clearAiCreditsCheckoutPending(): void {
	checkoutPending = false;
}
