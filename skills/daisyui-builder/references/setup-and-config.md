# DaisyUI Setup and Config

## Sources

- DaisyUI llms source: https://daisyui.com/llms.txt
- DaisyUI docs: https://daisyui.com/docs/install
- DaisyUI v5 docs: https://daisyui.com/docs/v5

## Install

Use the project's package manager:

```bash
npm i -D daisyui@latest
```

```bash
pnpm add -D daisyui@latest
```

```bash
yarn add -D daisyui@latest
```

```bash
bun add -D daisyui@latest
```

## Tailwind CSS v4 (preferred modern flow)

Configure plugin in CSS:

```css
@import "tailwindcss";
@plugin "daisyui";
```

Enable explicit built-in themes:

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
```

## Tailwind CSS v3 (legacy flow)

Keep v3 projects on JS config pattern:

```js
// tailwind.config.js
module.exports = {
  content: ["./src/**/*.{html,js,ts,jsx,tsx}"],
  plugins: [require("daisyui")],
};
```

Use this only when the project is already Tailwind v3.

## Migration Notes

- DaisyUI v5 aligns with Tailwind v4 CSS-based plugin config.
- Do not add redundant JS config in v4-only setups.
- Keep semantic daisyUI classes for maintainability; use utility classes for small, explicit refinements.
