---
name: daisyui-builder
description: Build and refactor interfaces with daisyUI for Tailwind projects, including installation, configuration, component markup, theming, dark mode, and DaisyUI v5 conventions. Use when requests mention daisyUI classes (such as btn, card, modal, navbar, menu), Tailwind + daisyUI setup, custom theme creation, `data-theme` switching, or migration from older daisyUI/Tailwind patterns.
---

# DaisyUI Builder

## Overview

Build daisyUI-based UIs quickly while preserving daisyUI v5 and Tailwind CSS conventions. Prefer semantic daisyUI classes first, then add Tailwind utilities only for targeted adjustments.

## Workflow

1. Detect project baseline.
- Identify Tailwind major version before editing config.
- Use Tailwind v4 CSS plugin flow by default.
- Use Tailwind v3 JS config flow only when the project is already on v3.

2. Install and wire daisyUI.
- Install `daisyui` as a dev dependency with the project package manager.
- For Tailwind v4, configure in CSS with:
  - `@import "tailwindcss";`
  - `@plugin "daisyui";`
- Do not add `tailwind.config.js` for Tailwind v4-only setups.

3. Author components with daisyUI class grammar.
- Compose elements with `component` class, optional `part` classes, and optional modifiers.
- Combine with Tailwind utilities only when daisyUI classes are insufficient.
- Use utility `!` override as a last resort for specificity conflicts.

4. Apply themes correctly.
- Use daisyUI semantic color tokens (`primary`, `base-100`, `error`, etc.) so colors adapt per theme.
- Avoid hardcoded Tailwind color tokens for primary text/background decisions in themeable surfaces.
- Configure default and dark-preferred themes in plugin config when needed.
- Add custom themes with `@plugin "daisyui/theme"` when brand tokens are required.

5. Make layout responsive and production-safe.
- Add responsive prefixes (`sm:`, `md:`, `lg:`) to `flex` and `grid` layouts.
- Avoid unnecessary custom CSS when daisyUI or Tailwind utilities cover the requirement.
- Verify interactive states and contrast in both light and dark themes.

## Reference Files

- Read `references/setup-and-config.md` for canonical install and config patterns (Tailwind v4/v3).
- Read `references/theming-and-authoring.md` for class grammar, color/token rules, and custom theme patterns.

## Output Rules

- Return copy-paste-ready code snippets.
- Keep examples minimal and framework-appropriate for the target project.
- If asked for a full page/component, prefer semantic daisyUI structure over ad-hoc utility-only markup.
