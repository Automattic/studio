# Card Layouts in Rows

For equal-height, equal-width cards (with optional bottom-aligned CTAs), use this structure unless the user specifies otherwise:

```
Columns (className: "equal-cards")
  └── Column
        verticalAlignment: "stretch"
        width: "X%" where X = 100 / number_of_cards (e.g., 2 cards = 50%, 3 cards = 33.33%, 4 cards = 25%)
        └── Group [card wrapper]
              └── [content: headings, paragraphs, images*, lists]
              └── (optional) Buttons (className: "cta-bottom")
```

**Width rule**: All cards in a row MUST have equal width. Calculate each column's width as `100% / number_of_cards` (e.g., 3 cards = 33.33% each). The sum of all column widths must equal exactly 100% - never exceed the parent element width.

*Images in cards: `style="height:200px;object-fit:cover;width:100%"`

**Required CSS** (style.css):
```css
.equal-cards > .wp-block-column {
  display: flex;
  flex-direction: column;
  flex-grow: 0;
  flex-shrink: 0;
}
.equal-cards > .wp-block-column > .wp-block-group {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}
```
If present, ensure bottom-aligned CTAs unless otherwise specified:
```css
.equal-cards .cta-bottom {
  margin-top: auto;
  justify-content: center;
}
```
