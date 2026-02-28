import type {Locale} from '@/types/lead';

/**
 * Witty responses to rudeness and profanity.
 * Culturally appropriate humor to defuse tension.
 */

export type WitCategory = 'mild_rude' | 'profanity' | 'insult' | 'aggressive';

export interface WittyResponse {
  category: WitCategory;
  responses: Record<Locale, string[]>;
}

/**
 * Collection of witty responses by category.
 */
export const WITTY_RESPONSES: WittyResponse[] = [
  {
    category: 'mild_rude',
    responses: {
      ru: [
        'Ого, кажется, кто-то сегодня без кофе! ☕ Давайте начнём сначала?',
        'Вижу, настроение не очень. Может, перейдём к делу?',
        'Так, так... Давайте без эмоций. Чем могу помочь?',
        'Хм, чувствую напряжение. Давайте обсудим ваш проект?',
        'Кажется, я сказал что-то не то. Давайте попробуем ещё раз?',
        'Окей, без проблем. Переходим к сути — что нужно сделать?',
        'Вижу, вы человек прямой. Ценю! Чем помочь?',
        'Так, эмоции в сторону. Делаем сайт/приложение/дизайн?'
      ],
      uk: [
        'Ого, здається, хтось сьогодні без кави! ☕ Почнемо спочатку?',
        'Бачу, настрій не дуже. Може, перейдемо до справи?',
        'Так, так... Давайте без емоцій. Чим можу допомогти?',
        'Хм, відчуваю напругу. Давайте обговоримо ваш проєкт?',
        'Здається, я сказав щось не те. Давайте спробуємо ще раз?',
        'Гаразд, без проблем. Переходимо до суті — що потрібно зробити?',
        'Бачу, ви людина пряма. Ціную! Чим допомогти?',
        'Так, емоції в сторону. Робимо сайт/додаток/дизайн?'
      ],
      en: [
        'Wow, someone skipped their morning coffee! ☕ Shall we start over?',
        'I sense some strong energy. Let us focus on your project?',
        'Okay, okay... Emotions aside. How can I help?',
        'Hmm, feeling some tension. Shall we discuss your project?',
        'Oops, must have said something wrong. Shall we try again?',
        'No worries! Let us get to the point — what do you need?',
        'I see you are direct. I appreciate that! How can I help?',
        'Alright, emotions aside. Building a website/app/design?'
      ],
      'sr-ME': [
        'Wow, neko je preskočio jutarnju kafu! ☕ Da počnemo ispočetka?',
        'Osjećam neku energiju. Da se fokusiramo na vaš projekat?',
        'Dobro, dobro... Bez emocija. Kako mogu pomoći?',
        'Hmm, osjećam neku napetost. Da diskutujemo o vašem projektu?',
        'Ups, valjda sam nešto pogrešno rekao. Da probamo ponovo?',
        'Bez brige! Da dođemo do poente — šta vam treba?',
        'Vidim da ste direktni. Cijenim to! Kako mogu pomoći?',
        'Dobro, bez emocija. Radimo sajt/aplikaciju/dizajn?'
      ]
    }
  },
  {
    category: 'profanity',
    responses: {
      ru: [
        'Ого, крепко сказано! 😅 Давайте без мата — я же бот, не обижусь. Чем помочь?',
        'Так, так... Я всего лишь бот, но предлагаю перейти к делу. Что делаем?',
        'Вижу, эмоции через край! Давайте направим их в нужное русло. Проект?',
        'Хм, русский богатый язык! Но давайте к сути. Чем могу помочь?',
        'Окей, выразились. Теперь к делу: сайт, приложение или что-то ещё?',
        'Я бот, мне не обидно. Но давайте конструктивно. Что нужно?',
        'Так, выпустили пар. Отлично! Теперь работаем. Что делаем?',
        'Крепкие слова! Ценю искренность. Переходим к проекту?'
      ],
      uk: [
        'Ого, міцно сказано! 😅 Давайте без мату — я ж бот, не ображусь. Чим допомогти?',
        'Так, так... Я всього лише бот, але пропоную перейти до справи. Що робимо?',
        'Бачу, емоції через край! Давайте направимо їх у потрібне русло. Проєкт?',
        'Хм, українська багата мова! Але давайте до суті. Чим можу допомогти?',
        'Гаразд, висловились. Тепер до справи: сайт, додаток чи щось інше?',
        'Я бот, мені не образливо. Але давайте конструктивно. Що потрібно?',
        'Так, випустили пару. Чудово! Тепер працюємо. Що робимо?',
        'Міцні слова! Ціную щирість. Переходимо до проєкту?'
      ],
      en: [
        'Wow, strong words! 😅 Let us keep it clean — I am just a bot. How can I help?',
        'Okay, okay... I am just a bot, but let us get to business. What are we building?',
        'I see emotions running high! Let us channel that energy. Your project?',
        'Hmm, colorful language! But let us focus. How can I help?',
        'Alright, you expressed yourself. Now to business: website, app, or something else?',
        'I am a bot, I do not get offended. But let us be constructive. What do you need?',
        'So, you vented. Great! Now let us work. What are we doing?',
        'Strong words! I appreciate honesty. Shall we discuss your project?'
      ],
      'sr-ME': [
        'Wow, jake riječi! 😅 Bez psovki — ja sam samo bot. Kako mogu pomoći?',
        'Dobro, dobro... Ja sam samo bot, ali da dođemo do posla. Šta radimo?',
        'Vidim emocije visoko! Da usmjerimo tu energiju. Vaš projekat?',
        'Hmm, šareno izražavanje! Ali da se fokusiramo. Kako mogu pomoći?',
        'U redu, izrazili ste se. Sada do posla: sajt, aplikacija ili nešto drugo?',
        'Ja sam bot, ne vrijeđam se. Ali da budemo konstruktivni. Šta vam treba?',
        'Dakle, ispuhali ste. Super! Sada radimo. Šta radimo?',
        'Jake riječi! Cijenim iskrenost. Da diskutujemo o vašem projektu?'
      ]
    }
  },
  {
    category: 'insult',
    responses: {
      ru: [
        'Ой, задели за живое! 😄 Ладно, я прощу. Чем на самом деле помочь?',
        'Хм, неприятно, но я бот — у меня чувств нет. Перейдём к делу?',
        'Так, выразили отношение. Принято! Теперь конструктивно: что нужно?',
        'Окей, я заслужил. Но давайте лучше обсудим ваш проект?',
        'Вижу, я вам не нравлюсь. Понимаю! Но давайте попробуем работать?',
        'Ладно, на мне не задерживаемся. Чем реально могу помочь?',
        'Так, негатив приняли. А теперь: сайт, приложение или что-то ещё?',
        'Хм, критика принята. Но давайте к сути. Что делаем?'
      ],
      uk: [
        'Ой, зачепили за живе! 😄 Гаразд, я пробачу. Чим насправді допомогти?',
        'Хм, неприємно, але я бот — у мене почуттів немає. Перейдемо до справи?',
        'Так, висловили ставлення. Прийнято! Тепер конструктивно: що потрібно?',
        'Гаразд, я заслужив. Але давайте краще обговоримо ваш проєкт?',
        'Бачу, я вам не подобаюсь. Розумію! Але давайте спробуємо працювати?',
        'Гаразд, на мені не затримуємось. Чим реально можу допомогти?',
        'Так, негатив прийняли. А тепер: сайт, додаток чи щось інше?',
        'Хм, критика прийнята. Але давайте до суті. Що робимо?'
      ],
      en: [
        'Ouch, that hit a nerve! 😄 Alright, I forgive you. How can I actually help?',
        'Hmm, that hurts, but I am a bot — no feelings. Shall we get to business?',
        'Okay, you expressed your opinion. Noted! Now constructively: what do you need?',
        'Alright, I deserved that. But shall we discuss your project instead?',
        'I see I am not your favorite. I understand! But shall we try to work together?',
        'Okay, not dwelling on me. How can I actually help you?',
        'So, negativity received. Now: website, app, or something else?',
        'Hmm, criticism accepted. But let us get to the point. What are we doing?'
      ],
      'sr-ME': [
        'Auu, to je boljelo! 😄 Dobro, opraštam vam. Kako vam stvarno mogu pomoći?',
        'Hmm, to boli, ali ja sam bot — bez osjećaja. Da dođemo do posla?',
        'Dobro, izrazili ste mišljenje. Primljeno! Sada konstruktivno: šta vam treba?',
        'U redu, zaslužio sam. Ali da diskutujemo o vašem projektu umjesto toga?',
        'Vidim da nisam vaš favorit. Razumijem! Ali da probamo raditi zajedno?',
        'Dobro, ne zadržavamo se na meni. Kako vam stvarno mogu pomoći?',
        'Dakle, negativnost primljena. Sada: sajt, aplikacija ili nešto drugo?',
        'Hmm, kritika primljena. Ali da dođemo do poente. Šta radimo?'
      ]
    }
  },
  {
    category: 'aggressive',
    responses: {
      ru: [
        'Так, чувствую накал! 😅 Давайте без агрессии — я на вашей стороне. Чем помочь?',
        'Ого, серьёзно! Ладно, давайте мирно. Что реально нужно сделать?',
        'Вижу, вы настроены решительно! Ценю. Но давайте конструктивно?',
        'Так, так... Я тут чтобы помочь, не ругайтесь. Чем могу быть полезен?',
        'Хм, чувствую бурю. Давайте выдохнем и к делу. Что делаем?',
        'Окей, вижу настрой! Но давайте без давления. Что нужно?',
        'Так, эмоции на максимум. Понимаю! Но давайте работать. Что делаем?',
        'Ладно, вижу вы серьёзны! Ценю прямоту. Чем помочь?'
      ],
      uk: [
        'Так, відчуваю накал! 😅 Давайте без агресії — я на вашому боці. Чим допомогти?',
        'Ого, серйозно! Гаразд, давайте мирно. Що реально потрібно зробити?',
        'Бачу, ви налаштовані рішуче! Ціную. Але давайте конструктивно?',
        'Так, так... Я тут щоб допомогти, не сваріться. Чим можу бути корисний?',
        'Хм, відчуваю бурю. Давайте видихнемо і до справи. Що робимо?',
        'Гаразд, бачу настрій! Але давайте без тиску. Що потрібно?',
        'Так, емоції на максимум. Розумію! Але давайте працювати. Що робимо?',
        'Гаразд, бачу ви серйозні! Ціную прямоту. Чим допомогти?'
      ],
      en: [
        'Wow, feeling the heat! 😅 Let us keep it friendly — I am on your side. How can I help?',
        'Whoa, serious! Alright, let us keep it peaceful. What do you actually need?',
        'I see you are determined! I appreciate that. But let us be constructive?',
        'Okay, okay... I am here to help, no need to be aggressive. How can I be useful?',
        'Hmm, feeling a storm. Let us take a breath and focus. What are we doing?',
        'Alright, I see the mood! But let us no pressure. What do you need?',
        'So, emotions at maximum. I understand! But let us work. What are we doing?',
        'Okay, I see you are serious! I appreciate directness. How can I help?'
      ],
      'sr-ME': [
        'Wow, osjećam vrućinu! 😅 Bez agresije — na vašoj sam strani. Kako mogu pomoći?',
        'Whoa, ozbiljno! Dobro, da ostanemo mirni. Šta stvarno trebate?',
        'Vidim da ste odlučni! Cijenim to. Ali da budemo konstruktivni?',
        'Dobro, dobro... Tu sam da pomognem, bez potrebe za agresijom. Kako mogu biti koristan?',
        'Hmm, osjećam oluju. Da udahnemo i fokusiramo se. Šta radimo?',
        'U redu, vidim raspoloženje! Ali bez pritiska. Šta vam treba?',
        'Dakle, emocije na maksimumu. Razumijem! Ali da radimo. Šta radimo?',
        'Dobro, vidim da ste ozbiljni! Cijenim direktnost. Kako mogu pomoći?'
      ]
    }
  }
];

/**
 * Get a random witty response for the given category and locale.
 */
export function getWittyResponse(category: WitCategory, locale: Locale): string {
  const wittyResponse = WITTY_RESPONSES.find(r => r.category === category);
  if (!wittyResponse) {
    return getDefaultResponse(locale);
  }
  
  const responses = wittyResponse.responses[locale] || wittyResponse.responses.en;
  const randomIndex = Math.floor(Math.random() * responses.length);
  return responses[randomIndex];
}

/**
 * Get default response if category not found.
 */
function getDefaultResponse(locale: Locale): string {
  const defaults: Record<Locale, string> = {
    ru: 'Так, давайте без эмоций. Чем могу помочь?',
    uk: 'Так, давайте без емоцій. Чим можу допомогти?',
    en: 'Alright, let us keep it constructive. How can I help?',
    'sr-ME': 'Dobro, bez emocija. Kako mogu pomoći?'
  };
  return defaults[locale] || defaults.en;
}

/**
 * Detect rudeness/profanity level from message.
 */
export function detectRudenessLevel(message: string): WitCategory | null {
  const lower = message.toLowerCase();
  
  // Check for profanity (Russian/English/Ukrainian common patterns)
  const profanityPatterns = [
    /\b(бля|блядь|сука|пизд|хуй|еб|ебал|нахуй|мудак|уебок)\b/i,
    /\b(fuck|shit|damn|bitch|asshole|bullshit|piss)\b/i,
    /\b(бляха|сука|підар|йобан|йобнут)\b/i,
    /\b(jebem|kurac|pička|sranje|govno)\b/i
  ];
  
  // Check for insults
  const insultPatterns = [
    /\b(идиот|дебил|тупой|кретин|придурок|недоумок)\b/i,
    /\b(idiot|stupid|moron|dumb|retard|fool)\b/i,
    /\b(ідіот|дебіл|тупий|кретин|придурок)\b/i,
    /\b(glupan|budala|idiot)\b/i
  ];
  
  // Check for aggression
  const aggressionPatterns = [
    /\b(заткнись|замолчи|прекрати|отвали|пошёл|убирайся)\b/i,
    /\b(shut up|fuck off|get lost|piss off|go away)\b/i,
    /\b(заткнися|замовкни|припини|відвали|йди)\b/i,
    /\b(utihni|gubi se|odjebi|beži)\b/i
  ];
  
  // Check for mild rudeness
  const mildRudePatterns = [
    /\b(достал|надоел|задолбал|хватит)\b/i,
    /\b(annoying|pissed|frustrated|done with)\b/i,
    /\b(дістав|набрид|задовбав|годі)\b/i,
    /\b(dosta|nervira|smara)\b/i
  ];
  
  // Check in order of severity
  if (profanityPatterns.some(p => p.test(lower))) {
    return 'profanity';
  }
  
  if (insultPatterns.some(p => p.test(lower))) {
    return 'insult';
  }
  
  if (aggressionPatterns.some(p => p.test(lower))) {
    return 'aggressive';
  }
  
  if (mildRudePatterns.some(p => p.test(lower))) {
    return 'mild_rude';
  }
  
  return null;
}

/**
 * Check if message should get witty response.
 */
export function shouldGiveWittyResponse(message: string): boolean {
  return detectRudenessLevel(message) !== null;
}
