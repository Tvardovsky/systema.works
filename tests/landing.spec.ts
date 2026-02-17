import {expect, test} from '@playwright/test';

const locales = ['en', 'ru', 'sr-ME', 'uk'] as const;

const localeHeadlines: Record<(typeof locales)[number], RegExp> = {
  en: /We build digital products that bring leads/i,
  ru: /Создаём цифровые продукты, которые дают лиды/i,
  'sr-ME': /Gradimo digitalne proizvode koji donose leadove/i,
  uk: /Створюємо цифрові продукти, які дають ліди/i
};

test.describe('landing', () => {
  for (const locale of locales) {
    test(`renders localized content for ${locale}`, async ({page}) => {
      await page.goto(`/${locale}`);

      await expect(page.locator('#hero')).toBeVisible();
      await expect(page.locator('#services')).toBeVisible();
      await expect(page.locator('#cases')).toBeVisible();
      await expect(page.locator('#monte-guide')).toBeVisible();
      await expect(page.locator('#process')).toBeVisible();
      await expect(page.locator('#ai-consultation')).toBeVisible();
      await expect(page.locator('#contact')).toBeVisible();

      await expect(page.locator('.topbar')).toBeVisible();
      await expect(page.locator('.language-switcher-trigger')).toBeVisible();
      await expect(page.locator('h1')).toHaveText(localeHeadlines[locale]);
    });
  }

  test('navbar anchors scroll to sections', async ({page}) => {
    await page.goto('/en');

    await page.getByRole('link', {name: 'Services'}).click();
    await expect(page).toHaveURL(/#services/);

    await page.getByRole('link', {name: 'Cases'}).click();
    await expect(page).toHaveURL(/#cases/);
  });

  test('language switcher changes locale prefix and content', async ({page}) => {
    await page.goto('/en');

    await page.locator('.language-switcher-trigger').click();
    await page.getByRole('option', {name: 'Русский'}).click();
    await expect(page).toHaveURL(/\/ru/);
    await expect(page.locator('h1')).toHaveText(localeHeadlines.ru);
  });
});
