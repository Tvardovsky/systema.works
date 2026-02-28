# AI Assistant Improvement Plan
# Created: 2026-02-28
# Based on: Real conversation analysis

================================================================================
PROBLEMS IDENTIFIED
================================================================================

## 1. Language Detection Issue ❌

**Problem:** Assistant responds in site locale language, not user's language

**Example from chat:**
```
User (Russian): "Что это такое вообще?"
Assistant (English): "I see you're curious about what we offer..."

User (Russian): "Что вы можете?"
Assistant (English): "I understand you're looking to know more..."
```

**Expected:**
```
User (Russian): "Что это такое вообще?"
Assistant (Russian): "Вижу ваш интерес! Мы цифровое агентство..."
```

---

## 2. Too Many Questions ❌

**Problem:** Assistant asks 1+ questions EVERY turn, even after user shows frustration

**Example:**
```
User: "Слишком много ты пишешь"
Assistant: "...Could you share a quick overview...?" (still asking!)

User: "Нет"
Assistant: "...Would it be okay to share...?" (still asking!)

User: "Не хочу больше общаться с тобой, бот"
Assistant: "...Could you provide your name and contact info...?" (STILL asking!)
```

**Issue:** Assistant doesn't read emotional context or reduce questions when user is frustrated.

---

## 3. Handoff Logic Broken ❌

**Problem:** When user asks for manager, bot should:
1. Ask for contact ONCE
2. If provided → confirm and end
3. If refused twice → escalate anyway

**Current behavior:**
```
User: "Позови своего создателя" (1st request)
Assistant: Ignores, keeps selling

User: "Человека позови" (2nd request)
Assistant: Asks for contact ✓

User: "+38268482789" (contact provided!)
Assistant: "Could you share what specific goals..." (asks MORE questions!)

User: "Мне кажется ты тратишь мое время, я уже дал контакт"
Assistant: "Could you remind me of your main goals..." (STILL asking!)

User: "Хочу бабок заработать" 
Assistant: "What type of art objects..." (UNBELIEVABLE)
```

**Expected:**
```
User: "Позови менеджера" (1st)
Assistant: "Конечно! Чтобы менеджер мог связаться, оставьте контакт."

User: "+38268482789"
Assistant: "Спасибо! Передаю менеджеру. Он свяжется в ближайшее время."
[HANDOFF - conversation ends]
```

---

## 4. Contact Recognition Broken ❌

**Problem:** Email/phone regex not working properly

**Example:**
```
User: "st.underhill@gmail.com"
Assistant: "Could you confirm if you'd prefer to keep using your email..."
(Doesn't recognize email was already provided!)

User: "I gave you my email"
Assistant: "Got it, Stas! Thanks for confirming your email."
(Only then recognizes it)
```

**Issue:** Contact extraction happens but isn't used in conversation flow.

---

## 5. Repetitive Phrases ❌

**Problem:** Same phrases repeated constantly:
- "I understand" (appears in 80% of responses)
- "Could you share..." (every turn)
- "What specific..." (every turn)
- "I see you're..." (every turn)

**User feedback:**
```
User: "Заебал ты своим «i understand» если честно"
```

---

## 6. Response Length ❌

**Problem:** Responses are 3-5 sentences when 1-2 would suffice

**Example:**
```
User: "ok, I have 1000 euro"
Assistant: "Thanks for sharing your budget; it helps narrow down the options! 
With a budget of 1000 euros, we can definitely create a functional website 
that meets your needs. We can explore templates or custom designs to fit 
your vision within that range. Would you like to discuss what an ideal 
timeline looks like for you? When do you hope to have the site launched?"
(5 sentences, 2 questions!)
```

**Expected:**
```
User: "ok, I have 1000 euro"
Assistant: "Отлично! Этого бюджета достаточно для базового сайта. 
Когда планируете запуск?"
(2 sentences, 1 question)
```

================================================================================
ROOT CAUSES
================================================================================

1. **Language Detection:**
   - `detectReplyLanguage()` exists but not used properly in LLM prompt
   - LLM prompt doesn't specify response language
   - System prompt is in English, LLM defaults to English

2. **Question Frequency:**
   - `shouldAskQuestion()` logic too permissive
   - No tracking of questions asked in recent turns
   - No "question cooldown" mechanism

3. **Handoff Logic:**
   - `detectHandoffSignal()` detects but doesn't trigger properly
   - No counter for handoff requests
   - Contact collection doesn't end conversation

4. **Contact Recognition:**
   - Regex patterns too strict
   - Extraction happens but context not passed to LLM
   - LLM doesn't know contact was already captured

5. **Response Variety:**
   - Template acknowledgments limited (4-5 options)
   - LLM prompt doesn't discourage repetition
   - No tracking of recent phrases

6. **Response Length:**
   - LLM prompt allows 2-4 sentences
   - No hard limit enforcement
   - Value-add section too verbose

================================================================================
SOLUTION PLAN
================================================================================

## Phase 1: Fix Language Detection (Priority: CRITICAL)

**Files to modify:**
- `src/lib/conversation/llm-responder.ts`
- `src/lib/conversation/intent-analyzer.ts`

**Changes:**
1. Detect user language from CURRENT message (not just history)
2. Pass detected language to LLM system prompt
3. Instruct LLM to respond in detected language
4. Fallback to site locale if detection confidence < 0.6

**Code:**
```typescript
// In llm-responder.ts
function detectUserLanguage(message: string, history: ChatMessage[]): Locale {
  // Check current message first
  const currentLang = analyzeMessageLanguage(message);
  if (currentLang.confidence > 0.6) {
    return currentLang.locale;
  }
  
  // Fallback to history
  const recentUserMessages = history
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content);
    
  return detectLanguageFromMessages(recentUserMessages);
}

// In system prompt
`IMPORTANT: Respond in the SAME LANGUAGE as the user.
User's language: ${detectedLocale}
If user writes in Russian, respond in Russian.
If user writes in English, respond in English.`
```

---

## Phase 2: Reduce Question Frequency (Priority: HIGH)

**Files to modify:**
- `src/lib/conversation/llm-responder.ts`
- `src/lib/conversation/types.ts`

**Changes:**
1. Track questions asked in last 3 turns
2. Max 1 question per 2 turns (unless handoff-ready)
3. Add `questionsInLastTurns` to context
4. Pass to LLM with explicit instruction

**Code:**
```typescript
// In orchestrator.ts
const questionsInLast3Turns = history
  .slice(-3)
  .filter(m => m.role === 'assistant' && m.content.includes('?'))
  .length;

const shouldAskQuestion = questionsInLast3Turns < 2 && 
  (threadDepth === 'detailed' || isCommitmentSignal);

// In LLM prompt
`QUESTION RULE:
- Max 1 question per 2 turns
- Questions asked in last 3 turns: ${questionsInLast3Turns}
- If ≥2, do NOT ask another question
- Only ask if user shows commitment or context is detailed`
```

---

## Phase 3: Fix Handoff Logic (Priority: CRITICAL)

**Files to modify:**
- `src/lib/conversation/handoff-detector.ts`
- `src/lib/conversation/orchestrator.ts`

**Changes:**
1. Track handoff request count in context metadata
2. On 1st request: Ask for contact (once)
3. On 2nd request OR contact provided: Trigger handoff immediately
4. After handoff: Lock conversation, no more questions

**Code:**
```typescript
// In handoff-detector.ts
export function detectHandoffSignal(params: {
  context: ConversationContext;
  message: string;
  handoffRequestCount?: number;
}): HandoffSignal {
  const {context, message, handoffRequestCount = 0} = params;
  
  const explicitRequest = HANDOFF_REQUEST_PATTERNS.some(p => p.test(message));
  
  if (explicitRequest) {
    return {
      isReady: handoffRequestCount >= 1, // Ready on 2nd request
      confidence: 0.9,
      signals: ['explicit_request'],
      action: handoffRequestCount >= 1 ? 'immediate_handoff' : 'collect_contact'
    };
  }
  
  // ...existing logic
}

// In orchestrator.ts
const handoffRequestCount = context.metadata?.handoffRequestCount ?? 0;

if (handoffSignal.isReady && handoffSignal.action === 'immediate_handoff') {
  return handleImmediateHandoff(locale, context, message, turnNumber);
}

if (handoffSignal.action === 'collect_contact') {
  return handleContactCollection(locale, context, message, turnNumber);
}
```

---

## Phase 4: Improve Contact Recognition (Priority: HIGH)

**Files to modify:**
- `src/lib/conversation/context-builder.ts`
- `src/lib/chat-safety.ts` (existing regex)

**Changes:**
1. Relax email regex (currently too strict)
2. Add fuzzy matching for partial emails
3. Pass captured contacts to LLM context
4. LLM acknowledges contact already provided

**Code:**
```typescript
// In context-builder.ts
const emailPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,  // Full email
  /[A-Z0-9._%+-]+@/i,  // Partial (user@)
  /@gmail\.com/i,  // Domain only
  /@icloud\.com/i,
  /@yahoo\.com/i
];

// In LLM prompt
`CAPTURED CONTACTS:
${context.threads.relationship.entities.email ? 'Email: ' + context.threads.relationship.entities.email : 'No email'}
${context.threads.relationship.entities.phone ? 'Phone: ' + context.threads.relationship.entities.phone : 'No phone'}

DO NOT ask for contacts that are already captured above.`
```

---

## Phase 5: Reduce Repetition (Priority: MEDIUM)

**Files to modify:**
- `src/lib/conversation/response-composer.ts`
- `src/lib/conversation/llm-responder.ts`

**Changes:**
1. Track last 5 acknowledgment phrases
2. Pass to LLM with "avoid these phrases" instruction
3. Expand acknowledgment templates (add 10+ more)
4. Add variation based on turn number

**Code:**
```typescript
// In LLM prompt
`AVOID REPETITION:
Recent phrases used: ${recentPhrases.join(', ')}
Do NOT use these phrases again.
Use varied acknowledgments: "Понял", "Ясно", "Принял", "Услышал вас", etc.`
```

---

## Phase 6: Shorten Responses (Priority: MEDIUM)

**Files to modify:**
- `src/lib/conversation/llm-responder.ts`

**Changes:**
1. Reduce max tokens from 300 to 180
2. Instruct LLM: "Max 2 sentences, 1 question"
3. Add penalty for long responses in prompt
4. Post-process: truncate if >250 chars

**Code:**
```typescript
// In system prompt
`RESPONSE LENGTH:
- Max 2 sentences (3 if complex topic)
- Max 1 question per turn
- Max 200 characters total
- Be concise and direct

BAD (too long):
"I understand you're looking to know more about our services. We specialize 
in a range of digital solutions, including custom website development, SEO, 
social media marketing, and branding strategies, all tailored to fit your 
unique business needs. What specific goals do you have in mind?"

GOOD (concise):
"Понял! Делаем сайты, SEO и маркетинг. Какая у вас цель для бизнеса?"`
```

================================================================================
IMPLEMENTATION ORDER
================================================================================

| Phase | Priority | Est. Time | Impact |
|-------|----------|-----------|--------|
| 1. Language Detection | CRITICAL | 45 min | 🔥🔥🔥 |
| 3. Handoff Logic | CRITICAL | 60 min | 🔥🔥🔥 |
| 2. Question Frequency | HIGH | 30 min | 🔥🔥 |
| 4. Contact Recognition | HIGH | 45 min | 🔥🔥 |
| 6. Response Length | MEDIUM | 20 min | 🔥 |
| 5. Reduce Repetition | MEDIUM | 30 min | 🔥 |

**Total: ~4 hours**

================================================================================
TESTING SCENARIOS
================================================================================

After implementation, test these scenarios:

**1. Language Switching:**
```
User (RU): "Привет"
→ Assistant (RU): "Привет! Чем помочь?"

User (EN): "I need a website"
→ Assistant (EN): "Got it! What type of website?"

User (RU): "Лендинг"
→ Assistant (RU): "Понял! Для какого бизнеса?"
```

**2. Handoff Flow:**
```
User: "Позови менеджера" (1st)
→ Assistant: "Конечно! Оставьте контакт для связи."

User: "Не хочу давать контакт"
→ Assistant: "Понимаю. Менеджер всё равно может связаться. Как к вам обращаться?"

User: "Позови менеджера" (2nd)
→ Assistant: "Передаю менеджеру. Он свяжется в ближайшее время."
[HANDOFF - conversation locked]
```

**3. Contact Recognition:**
```
User: "Нужен сайт. Моя почта test@gmail.com"
→ Assistant: "Понял! test@gmail.com сохранил. Какой сайт нужен?"
(NOT: "Could you share your email?")
```

**4. Question Frequency:**
```
Turn 1: User describes project
→ Assistant: Acknowledges, NO question (turn 1)

Turn 2: User adds details
→ Assistant: Acknowledges, 1 question (turn 2)

Turn 3: User answers
→ Assistant: Acknowledges, NO question (cooldown)

Turn 4: User asks about price
→ Assistant: Answers, 1 question (turn 4)
```

**5. Response Length:**
```
User: "Нужен лендинг для автосалона"
→ Assistant: "Понял! Делаем лендинги для автосалонов. 
              Какой функционал нужен: каталог, формы, калькулятор?"
(2 sentences, 1 question, ~150 chars)
```

================================================================================
FILES TO CREATE/MODIFY
================================================================================

**Create:**
- [ ] `src/lib/conversation/language-detector.ts` (new module)
- [ ] `src/lib/conversation/question-tracker.ts` (track question frequency)

**Modify:**
- [ ] `src/lib/conversation/llm-responder.ts` (language, length, repetition)
- [ ] `src/lib/conversation/handoff-detector.ts` (handoff count, actions)
- [ ] `src/lib/conversation/orchestrator.ts` (handoff flow, question tracking)
- [ ] `src/lib/conversation/context-builder.ts` (contact regex)
- [ ] `src/lib/conversation/types.ts` (add handoffRequestCount, questionsInLastTurns)
- [ ] `src/lib/conversation/response-composer.ts` (phrase tracking)

================================================================================
CURRENT TASK
================================================================================

Phase 1: Fix Language Detection
  - Create language-detector.ts
  - Update llm-responder.ts system prompt
  - Pass detected language to LLM
  - Test with RU/EN switching

================================================================================
NOTES
================================================================================

- Language detection is MOST IMPORTANT (users hate wrong language)
- Handoff logic is SECOND (frustrated users need escape hatch)
- Question frequency is THIRD (feels less interrogatory)
- Keep changes incremental, test after each phase
- Monitor conversation logs for new issues
