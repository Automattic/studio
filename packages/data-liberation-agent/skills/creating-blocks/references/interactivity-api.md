# Plain JavaScript Frontend Interactivity Reference

Use this reference when creating interactive blocks that need frontend user interaction (accordions, tabs, modals, toggles, counters, carousels, search filters).

Interactive blocks are always dynamic — they use render.php (no save.js).

**IMPORTANT: Never use the WordPress Interactivity API (`@wordpress/interactivity`). Always use plain JavaScript with standard DOM APIs.**

## view.js Structure

```js
document.addEventListener( 'DOMContentLoaded', () => {
    const blocks = document.querySelectorAll( '.wp-block-namespace-slug' );

    blocks.forEach( ( block ) => {
        const toggle = block.querySelector( '.toggle-button' );
        const content = block.querySelector( '.toggle-content' );

        if ( ! toggle || ! content ) {
            return;
        }

        toggle.addEventListener( 'click', () => {
            const isOpen = content.classList.toggle( 'is-open' );
            toggle.setAttribute( 'aria-expanded', isOpen );
            content.hidden = ! isOpen;
        } );
    } );
} );
```

## Key Patterns

**Toggle / Accordion:**
```js
button.addEventListener( 'click', () => {
    const isExpanded = button.getAttribute( 'aria-expanded' ) === 'true';
    button.setAttribute( 'aria-expanded', ! isExpanded );
    panel.hidden = isExpanded;
    panel.classList.toggle( 'is-open', ! isExpanded );
} );
```

**Tabs:**
```js
tabs.forEach( ( tab ) => {
    tab.addEventListener( 'click', () => {
        tabs.forEach( ( t ) => t.classList.remove( 'is-active' ) );
        panels.forEach( ( p ) => ( p.hidden = true ) );
        tab.classList.add( 'is-active' );
        const panel = block.querySelector( `#${ tab.dataset.panel }` );
        if ( panel ) {
            panel.hidden = false;
        }
    } );
} );
```

**Fetch data:**
```js
async function loadData( endpoint ) {
    try {
        const response = await fetch( endpoint );
        const data = await response.json();
        renderItems( data );
    } catch ( error ) {
        console.error( 'Failed to fetch data:', error );
    }
}
```

## Passing Data from PHP to JavaScript

Use `data-*` attributes on the block wrapper:

```php
<div
    <?php echo get_block_wrapper_attributes(); ?>
    data-api-url="<?php echo esc_url( rest_url( 'wp/v2/posts' ) ); ?>"
    data-nonce="<?php echo esc_attr( wp_create_nonce( 'wp_rest' ) ); ?>"
>
```

```js
const block = document.querySelector( '.wp-block-namespace-slug' );
const apiUrl = block.dataset.apiUrl;
const nonce = block.dataset.nonce;
```

## render.php Template

Use standard HTML attributes and CSS classes that JavaScript targets:

```php
<?php
$unique_id = wp_unique_id( 'accordion-' );
?>
<div <?php echo get_block_wrapper_attributes(); ?>>
    <button
        class="toggle-button"
        aria-expanded="false"
        aria-controls="<?php echo esc_attr( $unique_id ); ?>"
    >
        <?php echo esc_html( $attributes['title'] ?? '' ); ?>
    </button>
    <div
        id="<?php echo esc_attr( $unique_id ); ?>"
        class="toggle-content"
        hidden
    >
        <?php echo wp_kses_post( $content ); ?>
    </div>
</div>
```

## block.json Requirements

Interactive blocks use `viewScript` (not `viewScriptModule`):

```json
{
    "supports": {
        "html": false
    },
    "viewScript": "file:./view.js",
    "render": "file:./render.php"
}
```

## Best Practices

1. **Use `DOMContentLoaded`** or check for element existence before attaching handlers
2. **Scope selectors to the block wrapper class** (`.wp-block-namespace-slug`) to avoid collisions
3. **Use `forEach` on `querySelectorAll`** to handle multiple block instances on the same page
4. **Use semantic HTML attributes** (`aria-expanded`, `hidden`, `aria-controls`) for accessibility
5. **Use CSS classes** (`classList.toggle`, `classList.add/remove`) for state-driven styling
6. **Use `dataset` properties** to pass data from PHP to JavaScript
7. **Use `async/await`** for asynchronous operations
