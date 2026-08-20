export const OPEN_PURCHASE_CREDITS_EVENT = 'studio:open-purchase-credits';
export const PURCHASE_CREDITS_PROTOTYPE_URL =
	'https://wordpress.com/checkout/studio-ai-credits?prototype=1';

export function openPurchaseCreditsDialog() {
	window.dispatchEvent( new Event( OPEN_PURCHASE_CREDITS_EVENT ) );
}
