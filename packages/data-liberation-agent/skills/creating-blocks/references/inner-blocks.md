# Inner Blocks

Use InnerBlocks as much as possible — prefer composing core blocks over custom markup.

## Rules

- Import `InnerBlocks`, `useBlockProps`, and `useInnerBlocksProps` from `@wordpress/block-editor`
- A block can only contain ONE InnerBlocks area
- `useBlockProps()` must be called BEFORE `useInnerBlocksProps()` — otherwise blockProps returns `{}`
- `orientation="horizontal"` only changes mover arrows/drag direction, not CSS — you must apply flex/grid styles yourself
- `parent` in block.json = direct child only; `ancestor` = any depth within the subtree
- `templateLock` inherits from parent InnerBlocks — pass `templateLock={false}` explicitly to opt out

## Edit Pattern (useInnerBlocksProps — preferred)

```jsx
import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

const TEMPLATE = [
    ['core/heading', { level: 2, placeholder: 'Title' }],
    ['core/paragraph', { placeholder: 'Content' }],
];

export default function Edit() {
    const blockProps = useBlockProps();
    const innerBlocksProps = useInnerBlocksProps(blockProps, {
        allowedBlocks: ['core/heading', 'core/paragraph', 'core/image'],
        template: TEMPLATE,
    });
    return <div {...innerBlocksProps} />;
}
```

## Save — Static Block

Must mirror the edit structure exactly, or the block enters recovery mode silently.

```jsx
import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

export default function save() {
    const blockProps = useBlockProps.save();
    const innerBlocksProps = useInnerBlocksProps.save(blockProps);
    return <div {...innerBlocksProps} />;
}
```

## Save — Dynamic Block with InnerBlocks

Do NOT return `null` — inner block content will be lost and `$content` in render.php will be empty.

```jsx
import { InnerBlocks } from '@wordpress/block-editor';

export default function save() {
    return <InnerBlocks.Content />;
}
```

Then in render.php, `$content` contains the serialized inner blocks HTML. Do not run it through `wp_kses_post` — it arrives pre-sanitized:

```php
<?php
echo '<div ' . get_block_wrapper_attributes() . '>' . $content . '</div>';
```

## Template Format

Array of arrays: `[blockName, attributes]` or `[blockName, attributes, [nestedBlocks]]`.

```js
const TEMPLATE = [
    ['core/image', { aspectRatio: '16/9' }],
    ['core/columns', {}, [
        ['core/column', {}, [
            ['core/paragraph', { placeholder: 'Left' }],
        ]],
        ['core/column', {}, [
            ['core/paragraph', { placeholder: 'Right' }],
        ]],
    ]],
];
```

## templateLock Values

- `"all"` — no inserting, moving, or deleting
- `"insert"` — no inserting or removing, reordering allowed
- `"contentOnly"` — only text/media editable, hides structural blocks from List View
- `false` — explicitly unlocks (overrides inherited lock from parent)

## renderAppender

```jsx
<InnerBlocks renderAppender={InnerBlocks.ButtonBlockAppender} />  // small + button
<InnerBlocks renderAppender={false} />                            // hide appender
```

## Silent Failures

- Dynamic save returns `null` with InnerBlocks → `$content` always empty, inner blocks lost on reload
- Save structure differs from edit → "Block validation failed", block enters recovery mode
- `useBlockProps` not called before `useInnerBlocksProps` → block loses `data-block` attributes silently
- `$content` run through `wp_kses_post` → embeds and complex blocks break