import {expect, test} from '@playwright/test';

const locales = ['en', 'ru', 'sr-ME', 'uk'] as const;

const localeHeadlines: Record<(typeof locales)[number], RegExp> = {
  en: /We build digital products that bring leads/i,
  ru: /Создаём цифровые продукты, которые дают лиды/i,
  'sr-ME': /Gradimo digitalne proizvode koji donose leadove/i,
  uk: /Створюємо цифрові продукти, які дають ліди/i
};

const aiPreviewByLocale: Record<(typeof locales)[number], {
  badge: string;
  user: string;
  assistant: string;
}> = {
  en: {
    badge: 'AI sales-manager roadmap',
    user: 'Need a landing page and chatbot handoff in 2 weeks.',
    assistant: 'Got it. I will clarify scope, timeline, budget range and contact, then pass a structured brief to a manager.'
  },
  ru: {
    badge: 'AI roadmap квалификации',
    user: 'Нужен лендинг и чат-бот с передачей менеджеру за 2 недели.',
    assistant: 'Принято. Уточню scope, сроки, бюджет и контакт, затем передам менеджеру структурированный бриф.'
  },
  'sr-ME': {
    badge: 'AI roadmap kvalifikacije',
    user: 'Treba mi landing stranica i chatbot handoff za 2 nedelje.',
    assistant: 'Primljeno. Razjasniću scope, rok, budžet i kontakt, pa proslediti menadžeru strukturiran brief.'
  },
  uk: {
    badge: 'AI roadmap кваліфікації',
    user: 'Потрібен лендінг і чат-бот з передачею менеджеру за 2 тижні.',
    assistant: 'Прийнято. Уточню scope, строки, бюджет і контакт, а потім передам менеджеру структурований бриф.'
  }
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

function buildChatHistory(count = 80): Array<{role: 'user' | 'assistant'; content: string}> {
  const longTail = ' details about scope, integrations, timeline and expected outcomes for this request.';
  return Array.from({length: count}, (_, index) => ({
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `${index % 2 === 0 ? 'Assistant' : 'User'} message ${index + 1}${longTail}`
  }));
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

  test('ai consultation preview is localized for each locale', async ({page}) => {
    for (const locale of locales) {
      await page.goto(`/${locale}`);
      const section = page.locator('#ai-consultation');

      await expect(section).toContainText(aiPreviewByLocale[locale].badge);
      await expect(section).toContainText(aiPreviewByLocale[locale].user);
      await expect(section).toContainText(aiPreviewByLocale[locale].assistant);

      if (locale !== 'en') {
        await expect(section).not.toContainText('Need a landing + chatbot handoff in 2 weeks.');
        await expect(section).not.toContainText('Got it. I will qualify scope, budget, timeline, and route your brief to manager.');
      }
    }
  });

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
    const panel = page.locator('aside.chat-panel');

    await page.getByTestId('cta-primary-hero').click();
    await expect(panel).toBeVisible();

    await page.locator('aside.chat-panel header button', {hasText: /close/i}).click();
    await expect(panel).toBeHidden();

    await page.locator('button.chat-launcher').click();
    await expect(panel).toBeVisible();
    await page.locator('aside.chat-panel header button', {hasText: /close/i}).click();
    await expect(panel).toBeHidden();

    await page.getByTestId('cta-primary-ai').click();
    await expect(panel).toBeVisible();
  });

  test('chat keeps briefing after timeline and does not lock immediately', async ({page}) => {
    let replyStep = 0;
    await page.route('**/api/chat/session/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          allowed: true,
          sessionId: 'test-briefing-session',
          message: 'Здравствуйте. Опишите задачу.'
        })
      });
    });
    await page.route('**/api/chat/message', async (route) => {
      const scriptedReplies = [
        'Понял задачу, двигаемся дальше по брифу. Чтобы не потерять контекст, напишите ваше имя и любой контакт: email, телефон или Telegram.',
        'Спасибо. Подскажите, пожалуйста, срок запуска.',
        'Отлично. И какой бюджет вы планируете?'
      ];
      const answer = scriptedReplies[Math.min(replyStep, scriptedReplies.length - 1)];
      replyStep += 1;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer,
          topic: 'allowed',
          leadIntentScore: 0.91,
          nextQuestion: ''
        })
      });
    });

    await page.goto('/ru');

    await page.getByRole('button', {name: 'AI чат'}).click();
    const startButton = page.getByRole('button', {name: 'Начать', exact: true});
    if (await startButton.count()) {
      await startButton.click();
    }

    const input = page.getByRole('textbox', {name: 'Опишите вашу задачу'});
    const sendButton = page.getByRole('button', {name: 'Отправить'});

    await input.fill('Нужен лендинг для аренды авто');
    await sendButton.click();
    await expect(page.locator('.chat-message.assistant:not(.chat-message-typing)').last()).toContainText(/имя|контакт/i);

    await input.fill('Олег, +38268291324');
    await sendButton.click();
    await expect(page.locator('.chat-message.assistant:not(.chat-message-typing)').last()).toContainText(/срок/i);

    await input.fill('3 месяца');
    await sendButton.click();
    await expect(page.locator('.chat-message.assistant:not(.chat-message-typing)').last()).toContainText(/бюджет/i);
    await expect(page.locator('text=/Cooldown:/i')).toHaveCount(0);
    await expect(input).toBeEnabled();
  });

  test('chat safety guard warns twice and locks on third invalid contact input', async ({page}) => {
    let invalidAttempts = 0;
    let isLocked = false;

    await page.route('**/api/chat/session/start', async (route) => {
      if (isLocked) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            allowed: false,
            chatLocked: true,
            chatMode: 'safety_locked',
            retryAfterSeconds: 3600,
            message: 'This chat is temporarily closed due to repeated invalid contact attempts.'
          })
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          allowed: true,
          sessionId: 'test-safety-session',
          message: 'Please provide your name and contact.'
        })
      });
    });

    await page.route('**/api/chat/message', async (route) => {
      invalidAttempts += 1;
      if (invalidAttempts >= 3) {
        isLocked = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            answer: 'This chat is temporarily closed due to repeated invalid contact attempts.',
            topic: 'disallowed',
            leadIntentScore: 0.1,
            nextQuestion: '',
            chatLocked: true,
            chatMode: 'safety_locked',
            retryAfterSeconds: 3600,
            sessionClosed: true
          })
        });
        return;
      }

      const attemptsLeft = 3 - invalidAttempts;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: `Your name looks invalid. Attempts left before a 1-hour pause: ${attemptsLeft}`,
          topic: 'unclear',
          leadIntentScore: 0.3,
          nextQuestion: ''
        })
      });
    });

    await page.goto('/en');

    await page.locator('button.chat-launcher').click();
    const startButton = page.locator('aside.chat-panel').getByRole('button', {name: /start/i});
    if (await startButton.count()) {
      await startButton.click();
    }

    const input = page.locator('.chat-composer input');
    const sendButton = page.locator('.chat-composer button[type="submit"]');

    await input.fill('My name is admin123');
    await sendButton.click();
    await expect(page.locator('.chat-message.assistant:not(.chat-message-typing)').last()).toContainText(/name looks invalid|attempts left/i, {timeout: 15000});

    await input.fill('My name is admin123');
    await sendButton.click();
    await expect(page.locator('.chat-message.assistant:not(.chat-message-typing)').last()).toContainText(/Attempts left before a 1-hour pause: 1/i, {timeout: 15000});

    await input.fill('My name is admin123');
    await sendButton.click();
    await expect(page.locator('.chat-message.assistant:not(.chat-message-typing)').last()).toContainText(/temporarily closed/i, {timeout: 15000});
    await expect(page.locator('.chat-system-note')).toBeVisible();
    await expect(page.locator('.chat-composer')).toHaveCount(0);

    await page.reload();
    await page.locator('button.chat-launcher').click();
    const startAfterReload = page.locator('aside.chat-panel').getByRole('button', {name: /start/i});
    if (await startAfterReload.count()) {
      await startAfterReload.click();
    }

    await expect(page.locator('.chat-message.assistant:not(.chat-message-typing)').last()).toContainText(/temporarily closed/i, {timeout: 15000});
    await expect(page.locator('.chat-system-note')).toBeVisible();
    await expect(page.locator('.chat-composer')).toHaveCount(0);
  });

  test('chat mobile layout uses messenger bubbles and typing lifecycle', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});

    await page.route('**/api/chat/session/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          allowed: true,
          sessionId: 'test-mobile-session',
          message: 'Welcome. Tell me what you need.'
        })
      });
    });

    await page.route('**/api/chat/message', async (route) => {
      let message = 'Need details';
      const rawBody = route.request().postData();
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody) as {message?: string};
          if (parsed.message) {
            message = parsed.message;
          }
        } catch {
          message = 'Need details';
        }
      }

      await page.waitForTimeout(380);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: `Got it. I will qualify scope for: ${message}`,
          topic: 'allowed',
          leadIntentScore: 0.92,
          nextQuestion: 'What timeline do you have?'
        })
      });
    });

    await page.goto('/en');

    await page.locator('button.chat-launcher').click();
    await page.getByRole('button', {name: 'Start', exact: true}).click();
    await expect(page.locator('.chat-row-assistant .chat-message').first()).toContainText('Welcome. Tell me what you need.');

    const layoutMetrics = await page.evaluate(() => {
      const panel = document.querySelector('aside.chat-panel') as HTMLElement | null;
      const log = document.querySelector('.chat-log') as HTMLElement | null;
      if (!panel || !log) {
        return null;
      }

      const panelRect = panel.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      return {
        panelHeightRatio: panelRect.height / viewportHeight,
        panelOverflowY: getComputedStyle(panel).overflowY,
        logOverflowY: getComputedStyle(log).overflowY
      };
    });

    expect(layoutMetrics).not.toBeNull();
    if (!layoutMetrics) {
      throw new Error('Missing chat layout metrics');
    }
    expect(layoutMetrics.panelHeightRatio).toBeGreaterThanOrEqual(0.85);
    expect(layoutMetrics.panelOverflowY).toBe('hidden');
    expect(['auto', 'scroll']).toContain(layoutMetrics.logOverflowY);

    const input = page.getByRole('textbox', {name: 'Describe your task'});
    const sendButton = page.getByRole('button', {name: 'Send'});
    const userText = 'Need a landing + chatbot handoff in 2 weeks.';
    await input.fill(userText);
    await sendButton.click();

    await expect(page.locator('.chat-message-typing')).toBeVisible();
    await expect(sendButton).toBeDisabled();
    await expect(page.locator('.chat-row-user .chat-message').last()).toContainText(userText);
    await expect(page.locator('.chat-row-assistant .chat-message:not(.chat-message-typing)').last()).toContainText('Got it. I will qualify scope');
    await expect(page.locator('.chat-message-typing')).toHaveCount(0);
    await expect(input).toBeEnabled();
    await expect(sendButton).toBeDisabled();

    const bubbleMetrics = await page.evaluate(() => {
      const userBubble = document.querySelector('.chat-row-user .chat-message') as HTMLElement | null;
      const assistantBubble = Array
        .from(document.querySelectorAll('.chat-row-assistant .chat-message'))
        .find((node) => !node.classList.contains('chat-message-typing')) as HTMLElement | undefined;

      if (!userBubble || !assistantBubble || !userBubble.parentElement || !assistantBubble.parentElement) {
        return null;
      }

      const userStyle = getComputedStyle(userBubble);
      const assistantStyle = getComputedStyle(assistantBubble);
      return {
        userJustify: getComputedStyle(userBubble.parentElement).justifyContent,
        assistantJustify: getComputedStyle(assistantBubble.parentElement).justifyContent,
        userTail: Number.parseFloat(userStyle.borderBottomRightRadius),
        userTop: Number.parseFloat(userStyle.borderTopRightRadius),
        assistantTail: Number.parseFloat(assistantStyle.borderBottomLeftRadius),
        assistantTop: Number.parseFloat(assistantStyle.borderTopLeftRadius),
        userBg: userStyle.backgroundColor,
        assistantBg: assistantStyle.backgroundColor
      };
    });

    expect(bubbleMetrics).not.toBeNull();
    if (!bubbleMetrics) {
      throw new Error('Missing bubble metrics');
    }
    expect(bubbleMetrics.userJustify).toBe('flex-end');
    expect(bubbleMetrics.assistantJustify).toBe('flex-start');
    expect(bubbleMetrics.userTail).toBeLessThan(bubbleMetrics.userTop);
    expect(bubbleMetrics.assistantTail).toBeLessThan(bubbleMetrics.assistantTop);
    expect(bubbleMetrics.userBg).not.toBe(bubbleMetrics.assistantBg);

    const userBg = parseRGB(bubbleMetrics.userBg);
    const assistantBg = parseRGB(bubbleMetrics.assistantBg);
    expect(userBg).not.toBeNull();
    expect(assistantBg).not.toBeNull();
    if (!userBg || !assistantBg) {
      throw new Error('Failed to parse bubble colors');
    }
    expect(relativeLuminance(userBg)).toBeLessThan(relativeLuminance(assistantBg));
  });

  test('chat scroll stays inside chat on mobile when locked', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});

    await page.route('**/api/chat/session/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          allowed: true,
          sessionId: 'test-locked-mobile-session',
          chatLocked: true,
          chatMode: 'handoff_locked',
          retryAfterSeconds: 3600,
          message: 'Chat is in cooldown mode.',
          history: buildChatHistory(96)
        })
      });
    });

    await page.goto('/en');
    await page.addStyleTag({content: '.chat-panel .chat-log { height: 120px !important; max-height: 120px !important; }'});
    await page.evaluate(() => window.scrollTo(0, 1400));

    await page.locator('button.chat-launcher').click();
    const startButton = page.getByRole('button', {name: 'Start', exact: true});
    if (await startButton.count()) {
      await startButton.click();
    }

    const chatLog = page.locator('aside.chat-panel .chat-log');
    await expect(chatLog).toBeVisible();
    await expect(page.locator('.chat-composer')).toHaveCount(0);
    await expect(page.locator('aside.chat-panel .chat-row')).toHaveCount(96);

    const logMetrics = await chatLog.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
    expect(logMetrics.scrollHeight).toBeGreaterThan(logMetrics.clientHeight + 20);

    const lockedWindowY = await page.evaluate(() => window.scrollY);
    const scrolledTop = await chatLog.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollBy(0, 920);
      return element.scrollTop;
    });

    const afterScroll = await page.evaluate(() => {
      const chat = document.querySelector('aside.chat-panel .chat-log') as HTMLElement | null;
      return {
        windowY: window.scrollY,
        chatScrollTop: chat?.scrollTop ?? 0
      };
    });

    expect(scrolledTop).toBeGreaterThan(0);
    expect(afterScroll.chatScrollTop).toBeGreaterThan(0);
    expect(Math.abs(afterScroll.windowY - lockedWindowY)).toBeLessThanOrEqual(1);
  });

  test('chat scroll lock works on wide viewport for coarse pointer devices', async ({page}) => {
    await page.addInitScript(() => {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const mql = originalMatchMedia(query);
        if (query === '(pointer: coarse)' || query === '(hover: none)') {
          return new Proxy(mql, {
            get(target, prop, receiver) {
              if (prop === 'matches') {
                return true;
              }
              const value = Reflect.get(target, prop, receiver);
              return typeof value === 'function' ? value.bind(target) : value;
            }
          });
        }
        return mql;
      }) as typeof window.matchMedia;
    });

    await page.setViewportSize({width: 1180, height: 900});
    await page.route('**/api/chat/session/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          allowed: true,
          sessionId: 'test-locked-coarse-session',
          chatLocked: true,
          chatMode: 'handoff_locked',
          retryAfterSeconds: 3600,
          message: 'Chat is in cooldown mode.',
          history: buildChatHistory(100)
        })
      });
    });

    await page.goto('/en');
    await page.addStyleTag({content: '.chat-panel .chat-log { height: 120px !important; max-height: 120px !important; }'});
    await page.evaluate(() => window.scrollTo(0, 1500));

    await page.locator('button.chat-launcher').click();
    const startButton = page.getByRole('button', {name: 'Start', exact: true});
    if (await startButton.count()) {
      await startButton.click();
    }

    const chatLog = page.locator('aside.chat-panel .chat-log');
    await expect(chatLog).toBeVisible();
    await expect(page.locator('.chat-composer')).toHaveCount(0);
    await expect(page.locator('aside.chat-panel .chat-row')).toHaveCount(100);

    const lockY = await page.evaluate(() => window.scrollY);
    const moved = await chatLog.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollBy(0, 980);
      return element.scrollTop;
    });

    const state = await page.evaluate(() => {
      const chat = document.querySelector('aside.chat-panel .chat-log') as HTMLElement | null;
      return {
        windowY: window.scrollY,
        chatScrollTop: chat?.scrollTop ?? 0
      };
    });

    expect(moved).toBeGreaterThan(0);
    expect(state.chatScrollTop).toBeGreaterThan(0);
    expect(Math.abs(state.windowY - lockY)).toBeLessThanOrEqual(1);
  });

  test('language switcher changes locale prefix and content', async ({page}) => {
    await page.goto('/en');

    await page.locator('.language-switcher-trigger').click();
    await page.getByRole('option', {name: 'Русский'}).click();
    await expect(page).toHaveURL(/\/ru/);
    await expect(page.locator('h1')).toHaveText(localeHeadlines.ru);
  });
});
