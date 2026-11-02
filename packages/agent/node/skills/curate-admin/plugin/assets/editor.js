/**
 * Editor behaviour for clients: skips the welcome guide, limits locked posts to
 * their text and photos, and lets a client ask the agency for anything else.
 */
( function ( wp ) {
	const settings = window.clientAdminEditor;
	const { __, sprintf } = wp.i18n;
	const { dispatch, select, subscribe } = wp.data;
	const { createElement: el, useState } = wp.element;

	wp.i18n.setLocaleData( settings.translations, 'client-admin' );

	dispatch( wp.preferences.store ).set( 'core/edit-post', 'welcomeGuide', false );
	dispatch( wp.preferences.store ).set( 'core', 'distractionFree', false );

	wp.blocks.registerBlockBindingsSource( {
		name: 'client-admin/setting',
		getValues: ( { bindings } ) =>
			Object.fromEntries(
				Object.entries( bindings ).map( ( [ attribute, { args } ] ) => [
					attribute,
					settings.settings[ args.setting ]?.[ args.key ] ?? '',
				] )
			),
		canUserEditValue: () => false,
	} );

	const isContentBlock = ( name ) => {
		const type = wp.blocks.getBlockType( name );
		return (
			!! type &&
			( !! type.supports?.contentRole ||
				Object.values( type.attributes ?? {} ).some(
					( attribute ) =>
						attribute.role === 'content' || attribute.__experimentalRole === 'content'
				) )
		);
	};

	// A root `templateLock` leaves block supports open, and a `contentOnly` one
	// leaves top-level blocks removable, so each block gets its editing mode.
	const lockBlocks = () => {
		const blockEditor = select( wp.blockEditor.store );
		const { setBlockEditingMode } = dispatch( wp.blockEditor.store );
		const applied = new WeakSet();
		const apply = ( blocks ) => {
			blocks.forEach( ( block ) => {
				if ( ! applied.has( block ) ) {
					applied.add( block );
					setBlockEditingMode(
						block.clientId,
						isContentBlock( block.name ) ? 'contentOnly' : 'disabled'
					);
				}
				apply( block.innerBlocks );
			} );
		};

		setBlockEditingMode( '', 'disabled' );
		let previous;
		subscribe( () => {
			const blocks = blockEditor.getBlocks();
			if ( blocks !== previous ) {
				previous = blocks;
				apply( blocks );
			}
		} );
		document.body.classList.add( 'client-admin-locked' );
	};

	const AskPanel = () => {
		const [ message, setMessage ] = useState( '' );
		const [ state, setState ] = useState( 'idle' );

		const send = () => {
			setState( 'sending' );
			const body = new URLSearchParams( {
				action: 'client_admin_request',
				_ajax_nonce: settings.nonce,
				message,
				page: select( wp.editor.store ).getPermalink() ?? '',
			} );
			window
				.fetch( window.ajaxurl, { method: 'POST', credentials: 'same-origin', body } )
				.then( ( response ) => response.json() )
				.then( ( result ) => {
					if ( ! result.success ) {
						throw new Error( result.data );
					}
					setMessage( '' );
					setState( 'sent' );
				} )
				.catch( () => setState( 'failed' ) );
		};

		return el(
			'div',
			{ className: 'client-admin-ask' },
			el(
				'p',
				null,
				sprintf(
					/* translators: %s: agency name. */
					__( "Tell %s what you'd like. They'll see this page with your note.", 'client-admin' ),
					settings.agency
				)
			),
			el( wp.components.TextareaControl, {
				__nextHasNoMarginBottom: true,
				label: __( 'Your request', 'client-admin' ),
				value: message,
				onChange: setMessage,
			} ),
			el(
				wp.components.Button,
				{
					variant: 'primary',
					disabled: ! message.trim() || state === 'sending',
					onClick: send,
				},
				__( 'Send request', 'client-admin' )
			),
			state === 'sent' && el( 'p', { role: 'status' }, __( 'Sent. Thank you.', 'client-admin' ) ),
			state === 'failed' &&
				el( 'p', { role: 'alert' }, __( 'That did not send. Please try again.', 'client-admin' ) )
		);
	};

	const DatesPanel = () => {
		const meta = wp.data.useSelect(
			( data ) => data( wp.editor.store ).getEditedPostAttribute( 'meta' ) ?? {},
			[]
		);
		return el(
			wp.editor.PluginDocumentSettingPanel,
			{ name: 'client-admin-dates', title: __( 'Dates', 'client-admin' ) },
			settings.dates.map( ( field ) =>
				el( wp.components.TextControl, {
					key: field.key,
					__nextHasNoMarginBottom: true,
					__next40pxDefaultSize: true,
					type: 'date',
					label: field.label,
					value: meta[ field.key ] ?? '',
					onChange: ( value ) =>
						dispatch( wp.editor.store ).editPost( { meta: { [ field.key ]: value } } ),
				} )
			)
		);
	};

	if ( settings.dates.length ) {
		wp.plugins.registerPlugin( 'client-admin-dates', { render: DatesPanel } );
		// A closed panel is easy to miss, and these fields have no other place.
		const panel = 'client-admin-dates/client-admin-dates';
		if ( ! select( wp.editor.store ).isEditorPanelOpened( panel ) ) {
			dispatch( wp.editor.store ).toggleEditorPanelOpened( panel );
		}
	}

	if ( settings.canAsk ) {
		wp.plugins.registerPlugin( 'client-admin', {
			render: () =>
				el(
					wp.editor.PluginSidebar,
					{
						name: 'ask',
						title: __( 'Need something else changed?', 'client-admin' ),
						icon: 'format-chat',
					},
					el( AskPanel )
				),
		} );
	}

	if ( settings.locked ) {
		lockBlocks();
	}
	if ( settings.locked && settings.isPage ) {
		document.body.classList.add( 'client-admin-page' );
		dispatch( 'core/notices' ).createNotice(
			'info',
			sprintf(
				/* translators: %s: agency name. */
				__(
					'You can change the text and photos on this page. %s looks after the layout and colors.',
					'client-admin'
				),
				settings.agency
			),
			{ id: 'client-admin-locked', isDismissible: false }
		);
	}
} )( window.wp );
