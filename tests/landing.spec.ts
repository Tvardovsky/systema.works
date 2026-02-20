import {expect, test} from '@playwright/test';

const locales = ['en', 'ru', 'sr-ME', 'uk'] as const;

const localeHeadlines: Record<(typeof locales)[number], RegExp> = {
  en: /We build digital products that bring leads/i,
  ru: /Создаём цифровые продукты, которые дают лиды/i,
  'sr-ME': /Gradimo digitalne proizvode koji donose leadove/i,
  uk: /Створюємо цифрові продукти, які дають ліди/i
};

function parseRGB(color: string) {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return null;
  }

  const [r, g, b] = match[1].split(',').slice(0, 3).map((value) => Number.parseFloat(value.trim()));
  return {r, g, b};
}

function relativeLuminance({r, g, b}: {r: number; g: number; b: number}) {
  const toLinear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(foreground: string, background: string) {
  const fg = parseRGB(foreground);
  const bg = parseRGB(background);
  if (!fg || !bg) {
    return 0;
  }

  const fgLum = relativeLuminance(fg);
  const bgLum = relativeLuminance(bg);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe('landing', () => {
  for (const locale of locales) {
    test(`renders localized content for ${locale}`, async ({page}) => {
      await page.goto(`/${locale}`);

      await expect(page.locator('#hero')).toBeVisible();
      await expect(page.locator('#services')).toBeVisible();
      await expect(page.locator('#cases')).toBeVisible();
      await expect(page.locator('#process')).toBeVisible();
      await expect(page.locator('#ai-consultation')).toBeVisible();
      await expect(page.locator('#contact')).toBeVisible();

      await expect(page.getByTestId('landing-navbar')).toBeVisible();
      await expect(page.locator('.language-switcher-trigger')).toBeVisible();
      await expect(page.locator('h1')).toHaveText(localeHeadlines[locale]);
    });
  }

  test('navbar is sticky while scrolling', async ({page}) => {
    await page.goto('/en');

    const navbar = page.getByTestId('landing-navbar');
    await expect(navbar).toBeVisible();

    const position = await navbar.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('sticky');

    await page.evaluate(() => window.scrollTo(0, 1400));
    await page.waitForTimeout(80);

    const top = await navbar.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(32);
  });

  test('navbar anchors scroll to sections', async ({page}) => {
    await page.goto('/en');

    const mobileNavToggle = page.getByTestId('landing-mobile-nav-toggle');
    if (await mobileNavToggle.isVisible()) {
      await mobileNavToggle.click();
      await page.evaluate(() => {
        (document.querySelector('[data-testid="nav-services-mobile"]') as HTMLAnchorElement | null)?.click();
      });
      await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe('#services');

      await page.evaluate(() => {
        (document.querySelector('[data-testid="nav-cases-mobile"]') as HTMLAnchorElement | null)?.click();
      });
      await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe('#cases');
      return;
    }

    await page.getByTestId('nav-services-desktop').click();
    await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe('#services');

    await page.getByTestId('nav-cases-desktop').click();
    await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe('#cases');
  });

  test('hero CTA buttons use readable typography', async ({page}) => {
    await page.goto('/en');

    const ctaTypography = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#hero .btn')).slice(0, 1).map((button) => {
        const style = getComputedStyle(button);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          fontWeight: Number.parseInt(style.fontWeight, 10),
          opacity: Number.parseFloat(style.opacity)
        };
      });
    });

    expect(ctaTypography.length).toBe(1);
    for (const item of ctaTypography) {
      expect(item.fontSize).toBeGreaterThanOrEqual(14);
      expect(item.fontWeight).toBeGreaterThanOrEqual(600);
      expect(item.opacity).toBeGreaterThanOrEqual(0.95);
    }
  });

  test('navbar highlights active section while scrolling', async ({page}) => {
    await page.goto('/en');

    await expect(page.getByTestId('nav-services-desktop')).toHaveClass(/active-section/);

    await page.evaluate(() => {
      document.querySelector('#cases')?.scrollIntoView({behavior: 'auto', block: 'start'});
    });

    await expect(page.getByTestId('nav-cases-desktop')).toHaveClass(/active-section/);
  });

  test('primary CTA contrast meets AA in all locales', async ({page}) => {
    for (const locale of locales) {
      await page.goto(`/${locale}`);

      const buttonColors = await page.evaluate(() => {
        const normalizeColor = (value: string) => {
          const probe = document.createElement('span');
          probe.style.color = value;
          document.body.appendChild(probe);
          const normalized = getComputedStyle(probe).color;
          probe.remove();
          return normalized;
        };

        return Array.from(document.querySelectorAll('.landing-section .btn.btn-primary')).map((element) => {
          const style = getComputedStyle(element);
          return {
            text: element.textContent?.trim() ?? '',
            color: normalizeColor(style.color),
            backgroundColor: normalizeColor(style.backgroundColor)
          };
        });
      });

      expect(buttonColors.length).toBeGreaterThanOrEqual(3);
      for (const item of buttonColors) {
        const ratio = contrastRatio(item.color, item.backgroundColor);
        expect(ratio, `${locale} CTA contrast failed for: "${item.text}"`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('mobile stats text wraps and page has no horizontal overflow', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/en');

    const statsStyles = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('#hero .stat-value, #hero .stat-desc, #cases .stat-value, #cases .stat-desc'));
      return {
        whiteSpaceValues: nodes.map((node) => getComputedStyle(node).whiteSpace),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    expect(statsStyles.overflowX).toBeLessThanOrEqual(0);
    for (const whiteSpace of statsStyles.whiteSpaceValues) {
      expect(whiteSpace).not.toBe('nowrap');
    }
  });

  test('landing badges are visible and not clipped on mobile', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/en');

    const badges = page.locator('[data-testid^="landing-badge-"]');
    await expect(badges).toHaveCount(3);

    const badgeMetrics = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid^="landing-badge-"]')).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          textLength: element.textContent?.trim().length ?? 0,
          width: rect.width,
          height: rect.height,
          clippedY: element.scrollHeight > element.clientHeight + 1
        };
      });
    });

    for (const metric of badgeMetrics) {
      expect(metric.textLength).toBeGreaterThan(0);
      expect(metric.width).toBeGreaterThan(40);
      expect(metric.height).toBeGreaterThan(16);
      expect(metric.clippedY).toBe(false);
    }
  });

  test('chat opens from landing CTA buttons', async ({page}) => {
    await page.goto('/en');

    await page.getByTestId('cta-primary-hero').click();
    await expect(page.locator('aside.chat-panel')).toBeVisible();

    await page.getByRole('button', {name: /close/i}).click();
    await expect(page.locator('aside.chat-panel')).toBeHidden();

    await page.getByTestId('cta-primary-ai').click();
    await expect(page.locator('aside.chat-panel')).toBeVisible();
  });

  test('language switcher changes locale prefix and content', async ({page}) => {
    await page.goto('/en');

    await page.locator('.language-switcher-trigger').click();
    await page.getByRole('option', {name: 'Русский'}).click();
    await expect(page).toHaveURL(/\/ru/);
    await expect(page.locator('h1')).toHaveText(localeHeadlines.ru);
  });
});
