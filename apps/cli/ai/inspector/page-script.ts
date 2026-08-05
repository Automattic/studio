/**
 * Self-contained annotation inspector injected into the page.
 *
 * Lets the user click elements to attach comments, then ship the whole batch
 * back to the CLI by clicking "Done". Vanilla DOM, no React, no esm.sh, no
 * external imports — written this way so injection is reliable on any
 * WordPress page regardless of CSP, network access, or theme CSS.
 *
 * Storage: a single localStorage key `studio-inspector-annotations-v1`,
 * scoped per pathname inside the JSON, so refreshing the page or navigating
 * between site URLs doesn't lose work.
 *
 * Hand-off to the agent: clicking "Done" sets `window.__studioAnnotateDone`,
 * which `waitForAnnotationsDone()` in inspector-inject.ts polls for.
 */

export const INSPECTOR_PAGE_SCRIPT =
	String.raw`
( () => {
	if ( window.__studioInspectorMounted ) {
		return;
	}
	window.__studioInspectorMounted = true;

	const STORAGE_KEY = 'studio-inspector-annotations-v1';
	const HOST_ID = '__studio-inspector-host';
	const MAX_ANNOTATIONS = 100;

	/* --------------------------------------------------------------------
	 * Storage
	 * ------------------------------------------------------------------ */
	function loadAnnotations() {
		try {
			const raw = localStorage.getItem( STORAGE_KEY );
			const parsed = raw ? JSON.parse( raw ) : [];
			return Array.isArray( parsed )
				? parsed
						.filter(
							( annotation ) =>
								typeof annotation === 'object' &&
								annotation !== null &&
								typeof annotation.id === 'string' &&
								annotation.id.length > 0 &&
								annotation.id.length <= 200 &&
								typeof annotation.comment === 'string' &&
								annotation.comment.trim() &&
								annotation.comment.length <= 10000
						)
						.slice( 0, MAX_ANNOTATIONS )
				: [];
		} catch {
			return [];
		}
	}
	function saveAnnotations( list ) {
		try {
			localStorage.setItem( STORAGE_KEY, JSON.stringify( list ) );
		} catch {}
	}

	/* --------------------------------------------------------------------
	 * Element identification — build a CSS selector that's specific enough
	 * for the agent to find the element again via wp_cli/theme files.
	 * ------------------------------------------------------------------ */
	function buildSelector( el ) {
		if ( ! el || el.nodeType !== 1 ) return '';
		if ( el.id ) return '#' + CSS.escape( el.id );
		const parts = [];
		let node = el;
		while ( node && node.nodeType === 1 && node !== document.documentElement ) {
			let part = node.tagName.toLowerCase();
			if ( node.classList && node.classList.length ) {
				const classes = Array.from( node.classList )
					.filter( ( c ) => ! c.startsWith( '__studio-' ) )
					.slice( 0, 3 )
					.map( ( c ) => '.' + CSS.escape( c ) )
					.join( '' );
				part += classes;
			}
			const parent = node.parentElement;
			if ( parent ) {
				/* Exclude our own host element when counting siblings — it
				 * lives directly under <body>, so without this filter every
				 * top-level <div> child of <body> picks up an off-by-one
				 * nth-of-type index and the agent looks up the wrong
				 * element. */
				const sameTagSiblings = Array.from( parent.children ).filter(
					( c ) => c.tagName === node.tagName && c.id !== HOST_ID
				);
				if ( sameTagSiblings.length > 1 ) {
					part += ':nth-of-type(' + ( sameTagSiblings.indexOf( node ) + 1 ) + ')';
				}
			}
			parts.unshift( part );
			node = parent;
			if ( parts.length >= 6 ) break;
		}
		return parts.join( ' > ' );
	}

	function nearbyText( el ) {
		const text = ( el.innerText || el.textContent || '' )
			.replace( /\s+/g, ' ' )
			.trim();
		return text.length > 200 ? text.slice( 0, 200 ) + '…' : text;
	}

	function pickComputedStyles( el ) {
		const cs = window.getComputedStyle( el );
		const keys = [
			'color',
			'background-color',
			'font-size',
			'font-weight',
			'font-family',
			'line-height',
			'padding',
			'margin',
			'border',
			'display',
			'width',
			'height',
		];
		const out = {};
		for ( const k of keys ) {
			out[ k ] = cs.getPropertyValue( k );
		}
		return out;
	}

	function uid() {
		return 'a_' + Math.random().toString( 36 ).slice( 2, 10 );
	}

	/* --------------------------------------------------------------------
	 * Shadow-DOM host so page CSS can't leak in and our CSS doesn't leak out.
	 * ------------------------------------------------------------------ */
	const oldHost = document.getElementById( HOST_ID );
	if ( oldHost ) oldHost.remove();
	const host = document.createElement( 'div' );
	host.id = HOST_ID;
	host.style.cssText =
		'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
	document.body.appendChild( host );
	const root = host.attachShadow( { mode: 'open' } );

	const style = document.createElement( 'style' );
	style.textContent = ` +
	'`' +
	String.raw`
		:host { all: initial; }
		* { box-sizing: border-box; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
		.toolbar {
			position: fixed; bottom: 1.25rem; right: 1.25rem;
			display: flex; align-items: center; gap: 6px;
			background: #1a1a1a; color: #fff; border-radius: 22px;
			padding: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.2), 0 4px 16px rgba(0,0,0,0.1);
			pointer-events: auto;
		}
		.toolbar button {
			height: 32px; padding: 0 12px;
			background: transparent; color: #fff;
			border: none; border-radius: 16px;
			font: 600 12px/1 inherit; cursor: pointer;
			white-space: nowrap;
		}
		.toolbar button:hover { background: rgba(255,255,255,0.1); }
		.toolbar button.primary { background: #fff; color: #1a1a1a; }
		.toolbar button.primary:hover { background: #f0f0f0; }
		.toolbar button.primary[disabled] { opacity: 0.5; cursor: default; }
		.toolbar button.active { background: #2563eb; color: #fff; }
		.toolbar .count {
			min-width: 22px; height: 22px; padding: 0 6px;
			display: inline-flex; align-items: center; justify-content: center;
			background: rgba(255,255,255,0.15); color: #fff;
			border-radius: 11px; font: 600 11px/1 inherit;
		}
		.highlight {
			position: fixed; pointer-events: none;
			border: 2px solid #2563eb;
			background: rgba(37,99,235,0.1);
			border-radius: 2px;
			transition: all 80ms ease-out;
			z-index: 1;
		}
		.marker {
			position: fixed; pointer-events: auto; cursor: pointer;
			width: 22px; height: 22px;
			background: #2563eb; color: #fff;
			border: 2px solid #fff;
			border-radius: 50%;
			box-shadow: 0 2px 6px rgba(0,0,0,0.3);
			font: 700 11px/1 inherit;
			display: inline-flex; align-items: center; justify-content: center;
			z-index: 2;
		}
		.popup {
			position: fixed; width: 320px;
			background: #1a1a1a; color: #fff;
			border-radius: 12px;
			box-shadow: 0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08);
			padding: 12px; z-index: 3;
			pointer-events: auto;
			display: flex; flex-direction: column; gap: 8px;
		}
		.popup .target {
			font-size: 11px; color: rgba(255,255,255,0.5);
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.popup textarea {
			width: 100%; min-height: 72px; resize: vertical;
			background: rgba(255,255,255,0.05); color: #fff;
			border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
			padding: 8px; font: 13px/1.4 inherit; outline: none;
		}
		.popup textarea:focus { border-color: #2563eb; }
		.popup .actions { display: flex; justify-content: flex-end; gap: 6px; }
		.popup button {
			padding: 6px 12px; border-radius: 16px; border: none;
			font: 600 12px/1 inherit; cursor: pointer;
		}
		.popup .delete {
			background: transparent; color: rgba(255,255,255,0.5);
			margin-right: auto;
		}
		.popup .delete:hover { color: #ef4444; }
		.popup .cancel { background: transparent; color: rgba(255,255,255,0.7); }
		.popup .cancel:hover { background: rgba(255,255,255,0.08); }
		.popup .save { background: #fff; color: #1a1a1a; }
		.popup .save[disabled] { opacity: 0.4; cursor: default; }
		.toast {
			position: fixed; bottom: calc(1.25rem + 56px); right: 1.25rem;
			background: rgba(26,26,26,0.95); color: #fff;
			padding: 10px 14px; border-radius: 10px;
			font: 500 12px/1.4 inherit;
			pointer-events: auto;
		}
	` +
	'`' +
	String.raw`;
	root.appendChild( style );

	/* --------------------------------------------------------------------
	 * State
	 * ------------------------------------------------------------------ */
	let isPicking = false;
	let hoveredEl = null;
	let activePopup = null; /* { id?, target, comment } */
	let annotations = loadAnnotations();

	/* --------------------------------------------------------------------
	 * Render
	 * ------------------------------------------------------------------ */
	const layer = document.createElement( 'div' );
	root.appendChild( layer );

	function render() {
		layer.innerHTML = '';

		/* Markers for existing annotations on the current path */
		const path = window.location.pathname;
		const pageAnnotations = annotations.filter( ( a ) => a.pathname === path );
		pageAnnotations.forEach( ( ann, idx ) => {
			let el = null;
			try {
				el = ann.selector ? document.querySelector( ann.selector ) : null;
			} catch {}
			if ( ! el ) return;
			const r = el.getBoundingClientRect();
			const marker = document.createElement( 'div' );
			marker.className = 'marker';
			marker.textContent = String( idx + 1 );
			marker.style.left = r.left + r.width - 11 + 'px';
			marker.style.top = r.top - 11 + 'px';
			marker.title = ann.comment;
			marker.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				openPopupForAnnotation( ann );
			} );
			layer.appendChild( marker );
		} );

		/* Hover highlight while picking */
		if ( isPicking && hoveredEl ) {
			const r = hoveredEl.getBoundingClientRect();
			const hl = document.createElement( 'div' );
			hl.className = 'highlight';
			hl.style.left = r.left + 'px';
			hl.style.top = r.top + 'px';
			hl.style.width = r.width + 'px';
			hl.style.height = r.height + 'px';
			layer.appendChild( hl );
		}

		/* Active popup */
		if ( activePopup ) {
			const popup = buildPopup( activePopup );
			layer.appendChild( popup );
		}

		/* Toolbar */
		const toolbar = document.createElement( 'div' );
		toolbar.className = 'toolbar';

		const pickBtn = document.createElement( 'button' );
		pickBtn.textContent = isPicking ? 'Picking… click element' : 'Annotate';
		pickBtn.className = isPicking ? 'active' : '';
		pickBtn.addEventListener( 'click', () => {
			isPicking = ! isPicking;
			hoveredEl = null;
			activePopup = null;
			render();
		} );
		toolbar.appendChild( pickBtn );

		if ( annotations.length > 0 ) {
			const count = document.createElement( 'span' );
			count.className = 'count';
			count.textContent = String( annotations.length );
			count.title = annotations.length + ' annotation(s) total';
			toolbar.appendChild( count );
		}

		const doneBtn = document.createElement( 'button' );
		doneBtn.className = 'primary';
		doneBtn.textContent = 'Done';
		doneBtn.disabled = annotations.length === 0;
		doneBtn.title =
			annotations.length === 0
				? 'Add at least one annotation first'
				: 'Send annotations and return';
		doneBtn.addEventListener( 'click', () => {
			if ( annotations.length === 0 ) return;
			const sent = annotations.slice();
			/* Hand off to the CLI, then reset the inspector to its default
			 * idle state — annotations are no longer pending in the UI,
			 * picking mode is off, and nothing is left in localStorage to
			 * confuse the next session. */
			window.__studioAnnotateDone = {
				capturedAt: Date.now(),
				url: window.location.href,
				annotations: sent,
			};
			annotations = [];
			saveAnnotations( annotations );
			isPicking = false;
			hoveredEl = null;
			activePopup = null;
			startCountdownToast( sent.length, 10 );
			render();
		} );
		toolbar.appendChild( doneBtn );

		layer.appendChild( toolbar );
	}

	function showToast( text ) {
		const existing = root.querySelector( '.toast' );
		if ( existing ) existing.remove();
		const toast = document.createElement( 'div' );
		toast.className = 'toast';
		toast.textContent = text;
		root.appendChild( toast );
		setTimeout( () => toast.remove(), 4000 );
	}

	/* Live countdown until the inspector-inject helper closes the browser.
	 * The actual close timer lives in the CLI process — we just mirror it
	 * visually so the user sees the window isn't disappearing on them. */
	function startCountdownToast( sentCount, totalSeconds ) {
		const existing = root.querySelector( '.toast' );
		if ( existing ) existing.remove();
		const toast = document.createElement( 'div' );
		toast.className = 'toast';
		root.appendChild( toast );

		let secondsLeft = totalSeconds;
		const paint = () => {
			toast.textContent =
				'Sent ' +
				sentCount +
				' annotation(s) — closing in ' +
				secondsLeft +
				's';
		};
		paint();
		const interval = setInterval( () => {
			secondsLeft -= 1;
			if ( secondsLeft <= 0 ) {
				clearInterval( interval );
				toast.textContent =
					'Sent ' + sentCount + ' annotation(s) — closing now…';
			} else {
				paint();
			}
		}, 1000 );
	}

	function buildPopup( state ) {
		const popup = document.createElement( 'div' );
		popup.className = 'popup';

		/* Position relative to the target element if possible */
		let el = null;
		try {
			el = state.target.selector ? document.querySelector( state.target.selector ) : null;
		} catch {}
		if ( el ) {
			const r = el.getBoundingClientRect();
			const popupWidth = 320;
			const gap = 12;
			const left = Math.min(
				Math.max( 8, r.left + r.width / 2 - popupWidth / 2 ),
				window.innerWidth - popupWidth - 8
			);
			let top = r.bottom + gap;
			if ( top + 200 > window.innerHeight ) {
				top = Math.max( 8, r.top - 200 - gap );
			}
			popup.style.left = left + 'px';
			popup.style.top = top + 'px';
		} else {
			popup.style.left = '50%';
			popup.style.top = '50%';
			popup.style.transform = 'translate(-50%, -50%)';
		}

		const target = document.createElement( 'div' );
		target.className = 'target';
		target.textContent =
			state.target.tag +
			( state.target.nearbyText ? ' — ' + state.target.nearbyText : '' );
		popup.appendChild( target );

		const ta = document.createElement( 'textarea' );
		ta.placeholder = 'What should change about this element?';
		ta.maxLength = 10000;
		ta.value = state.comment || '';
		ta.addEventListener( 'input', () => {
			state.comment = ta.value;
			save.disabled = ! state.comment.trim();
		} );
		popup.appendChild( ta );
		setTimeout( () => ta.focus(), 0 );

		const actions = document.createElement( 'div' );
		actions.className = 'actions';

		/* state.fromPicker is set only when the popup was opened by clicking
		 * a new element — used below by closePopup() to drop the user back
		 * into picking mode after Save/Cancel so they can chain
		 * annotations without re-clicking the Annotate button. */
		if ( state.id ) {
			const del = document.createElement( 'button' );
			del.className = 'delete';
			del.textContent = 'Delete';
			del.addEventListener( 'click', () => {
				annotations = annotations.filter( ( a ) => a.id !== state.id );
				saveAnnotations( annotations );
				activePopup = null;
				render();
			} );
			actions.appendChild( del );
		}

		/* When the popup came from the picker we want to drop the user
		 * straight back into picking mode after Save/Cancel, so they can
		 * chain annotations without re-clicking "Annotate" each time. When
		 * the popup came from clicking an existing marker, leave picking
		 * mode off — they were editing one specific item. */
		const closePopup = () => {
			activePopup = null;
			if ( state.fromPicker ) {
				isPicking = true;
			}
			render();
		};

		const cancel = document.createElement( 'button' );
		cancel.className = 'cancel';
		cancel.textContent = 'Cancel';
		cancel.addEventListener( 'click', closePopup );
		actions.appendChild( cancel );

		const save = document.createElement( 'button' );
		save.className = 'save';
		save.textContent = state.id ? 'Update' : 'Save';
		save.disabled = ! ( state.comment && state.comment.trim() );
		save.addEventListener( 'click', () => {
			const trimmed = ( state.comment || '' ).trim();
			if ( ! trimmed ) return;
			if ( ! state.id && annotations.length >= MAX_ANNOTATIONS ) {
				showToast( 'You can add up to 100 annotations.' );
				return;
			}
			if ( state.id ) {
				annotations = annotations.map( ( a ) =>
					a.id === state.id ? { ...a, comment: trimmed, updatedAt: Date.now() } : a
				);
			} else {
				annotations = annotations.concat( [
					{
						id: uid(),
						comment: trimmed,
						selector: state.target.selector,
						tag: state.target.tag,
						nearbyText: state.target.nearbyText,
						boundingBox: state.target.boundingBox,
						computedStyles: state.target.computedStyles,
						pathname: window.location.pathname,
						url: window.location.href,
						timestamp: Date.now(),
					},
				] );
			}
			saveAnnotations( annotations );
			closePopup();
		} );
		actions.appendChild( save );

		popup.appendChild( actions );

		/* Stop propagation so popup interactions don't pick the element underneath */
		popup.addEventListener( 'click', ( e ) => e.stopPropagation() );
		popup.addEventListener( 'mousemove', ( e ) => e.stopPropagation() );

		return popup;
	}

	function openPopupForAnnotation( ann ) {
		isPicking = false;
		activePopup = {
			id: ann.id,
			comment: ann.comment,
			target: {
				selector: ann.selector,
				tag: ann.tag,
				nearbyText: ann.nearbyText,
				boundingBox: ann.boundingBox,
				computedStyles: ann.computedStyles,
			},
		};
		render();
	}

	function openPopupForElement( el ) {
		const r = el.getBoundingClientRect();
		isPicking = false;
		activePopup = {
			/* Tag this popup so closePopup() restores picking mode after
			 * Save/Cancel, letting the user chain annotations. */
			fromPicker: true,
			comment: '',
			target: {
				selector: buildSelector( el ),
				tag: el.tagName.toLowerCase(),
				nearbyText: nearbyText( el ),
				boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
				computedStyles: pickComputedStyles( el ),
			},
		};
		render();
	}

	/* --------------------------------------------------------------------
	 * Picking interaction
	 *
	 * We listen at document level in the capture phase so we can intercept
	 * clicks before the page's own handlers fire — no accidental link
	 * navigation while annotating.
	 * ------------------------------------------------------------------ */
	function isOurElement( el ) {
		return !! ( el && el.closest && el.closest( '#' + HOST_ID ) );
	}

	document.addEventListener(
		'mousemove',
		( e ) => {
			if ( ! isPicking ) return;
			if ( isOurElement( e.target ) ) {
				hoveredEl = null;
				render();
				return;
			}
			if ( hoveredEl !== e.target ) {
				hoveredEl = e.target;
				render();
			}
		},
		true
	);

	document.addEventListener(
		'click',
		( e ) => {
			if ( ! isPicking ) return;
			if ( isOurElement( e.target ) ) return;
			e.preventDefault();
			e.stopPropagation();
			openPopupForElement( e.target );
		},
		true
	);

	document.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Escape' ) {
			if ( activePopup ) {
				activePopup = null;
				render();
			} else if ( isPicking ) {
				isPicking = false;
				hoveredEl = null;
				render();
			}
		}
	} );

	/* Re-render on scroll/resize so markers and highlights track the page */
	let scrollRaf = 0;
	const onScrollOrResize = () => {
		if ( scrollRaf ) return;
		scrollRaf = requestAnimationFrame( () => {
			scrollRaf = 0;
			render();
		} );
	};
	window.addEventListener( 'scroll', onScrollOrResize, true );
	window.addEventListener( 'resize', onScrollOrResize );

	render();
} )();
`;
