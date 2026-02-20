# DaisyUI Theming and Authoring

## Sources

- DaisyUI llms source: https://daisyui.com/llms.txt
- Themes docs: https://daisyui.com/docs/themes
- Component docs: https://daisyui.com/components/

## Authoring Pattern

Use this class composition order:

1. Component class (`btn`, `card`, `modal`, `menu`, etc.)
2. Part classes (`card-body`, `navbar-start`, etc.) when the component defines parts
3. Variant/modifier classes (`btn-primary`, `btn-outline`, size/state modifiers)
4. Tailwind utilities only for targeted spacing/layout/typography adjustments

Example:

```html
<button class="btn btn-primary rounded-full">Save</button>
```

## Theme-Aware Styling Rules

- Prefer daisyUI semantic tokens (`primary`, `secondary`, `base-100`, `error`) over fixed utility colors for major surfaces.
- Use `data-theme="<theme-name>"` to scope a section to a specific theme.
- Verify dark mode behavior before finalizing UI choices.

## Built-in Theme Configuration

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
```

## Custom Theme Template

```css
@import "tailwindcss";
@plugin "daisyui";
@plugin "daisyui/theme" {
  name: "mytheme";
  default: true;
  prefersdark: false;
  color-scheme: light;

  --color-base-100: oklch(98% 0.02 240);
  --color-base-content: oklch(20% 0.05 240);
  --color-primary: oklch(55% 0.3 240);
  --color-primary-content: oklch(98% 0.01 240);
  --color-secondary: oklch(70% 0.25 200);
  --color-secondary-content: oklch(98% 0.01 200);
  --color-accent: oklch(65% 0.25 160);
  --color-accent-content: oklch(98% 0.01 160);
  --color-neutral: oklch(50% 0.05 240);
  --color-neutral-content: oklch(98% 0.01 240);
  --color-info: oklch(70% 0.2 220);
  --color-success: oklch(65% 0.25 140);
  --color-warning: oklch(80% 0.25 80);
  --color-error: oklch(65% 0.3 30);
}
```

## Practical Guardrails

- Avoid long chains of one-off utility classes when a daisyUI component exists.
- Keep component structure valid (for example, preserve expected `card`/`card-body` nesting).
- Prefer consistent theme tokens across pages to avoid drift.
