// src/lib/fidelity/dialog-probe.ts
//
// Click candidate dialog triggers on a live page and report which opened.
// Both sides of a comparison run the same probe so a dead exported control is
// a difference in behavior, not a difference in how it was measured.
//
import type { Page } from 'playwright';
import type { DialogProbe } from './score.js';

/**
 * Probe every plausibly-dialog-opening control in document order.
 *
 * Label resolution reads `data-dla-disclosure-label` — the export marks its
 * static disclosure summaries with the trigger's captured label — because a
 * summary wrapping an icon-only control has no text and only gains an
 * aria-label after its first toggle.
 */
export async function probeDialogs( page: Page ): Promise< DialogProbe[] > {
	return ( await page.evaluate( `(async () => {
			const isShown = (element) => {
				const rect = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
			};
			const openCount = () =>
				[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].filter(isShown).length;
			const triggers = [...document.querySelectorAll('button,a[aria-haspopup],summary,[aria-expanded]')]
				.filter((element) => {
					if (!isShown(element)) return false;
					if (element.getAttribute('aria-disabled') === 'true') return false;
					const href = element.tagName === 'A' ? (element.getAttribute('href') || '').trim() : '';
					if (href && href !== '#' && !href.startsWith('#')) return false;
					if (element.tagName === 'SUMMARY') return true;
					if (element.hasAttribute('aria-expanded')) return true;
					const popup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
					if (['dialog', 'menu', 'true'].includes(popup)) return true;
					const label = (element.getAttribute('aria-label') || element.innerText || '').toLowerCase();
					return element.tagName === 'BUTTON' && /\\bmenu\\b/.test(label);
				})
				.slice(0, 8);
			const probes = [];
			for (const trigger of triggers) {
				const label = (trigger.getAttribute('aria-label') || trigger.getAttribute('data-dla-disclosure-label') || trigger.innerText || 'dialog').replace(/\\s+/g, ' ').trim().slice(0, 40);
				const before = openCount();
				const expanded = trigger.getAttribute('aria-expanded') === 'true';
				const bodyClass = document.body.className;
				const hidden = [...document.querySelectorAll('[aria-hidden="true"]')];
				trigger.click();
				await new Promise((resolve) => setTimeout(resolve, 400));
				const details = trigger.closest('details');
				const revealed = hidden.some((element) => element.getAttribute('aria-hidden') !== 'true');
				const opened =
					openCount() > before ||
					(trigger.getAttribute('aria-expanded') === 'true' && !expanded) ||
					Boolean(details && details.open) ||
					revealed ||
					document.body.className !== bodyClass;
				probes.push({ label: label || 'dialog', opened });
				document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
				if (details && details.open) details.open = false;
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			return probes;
		})()` ) ) as DialogProbe[];
}
