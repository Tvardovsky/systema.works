'use client';

import type {BriefExtractionHistory} from '@/lib/conversation/brief-types';

type Props = {
  extractions: BriefExtractionHistory[];
  locale?: 'ru' | 'uk' | 'en' | 'sr-ME';
};

/**
 * Display timeline of brief extractions.
 */
export function BriefExtractionHistory({extractions, locale = 'en'}: Props) {
  if (!extractions || extractions.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        {translations[locale].noExtractions}
      </div>
    );
  }
  
  const labels = translations[locale];
  
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">{labels.title}</h4>
      
      <div className="relative border-l-2 border-gray-200 ml-3 space-y-4">
        {extractions.map((extraction, index) => (
          <div key={extraction.id} className="relative pl-4">
            {/* Timeline dot */}
            <div className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-blue-500" />
            
            {/* Content */}
            <div className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">
                  {labels.turn} {extraction.extractionTurn}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-500">
                  {new Date(extraction.extractedAt).toLocaleString()}
                </span>
              </div>
              
              {/* Fields updated */}
              <div className="mt-1">
                <span className="text-gray-600">{labels.fieldsUpdated}: </span>
                <span className="text-blue-600">
                  {extraction.fieldsUpdated.length > 0
                    ? extraction.fieldsUpdated.join(', ')
                    : labels.none}
                </span>
              </div>
              
              {/* Model info */}
              <div className="mt-0.5 text-xs text-gray-400">
                {labels.model}: {extraction.modelVersion} • {labels.latency}: {extraction.latencyMs}ms
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const translations: Record<string, Record<string, string>> = {
  en: {
    title: 'Extraction History',
    noExtractions: 'No extractions yet',
    turn: 'Turn',
    fieldsUpdated: 'Fields updated',
    none: 'None',
    model: 'Model',
    latency: 'Latency'
  },
  ru: {
    title: 'История извлечения',
    noExtractions: 'Извлечений пока нет',
    turn: 'Ход',
    fieldsUpdated: 'Обновлены поля',
    none: 'Нет',
    model: 'Модель',
    latency: 'Задержка'
  },
  uk: {
    title: 'Історія вилучення',
    noExtractions: 'Вилучень поки немає',
    turn: 'Хід',
    fieldsUpdated: 'Оновлені поля',
    none: 'Немає',
    model: 'Модель',
    latency: 'Затримка'
  },
  'sr-ME': {
    title: 'Istorija ekstrakcije',
    noExtractions: 'Nema ekstrakcija još',
    turn: 'Potez',
    fieldsUpdated: 'Ažurirana polja',
    none: 'Nema',
    model: 'Model',
    latency: 'Kašnjenje'
  }
};

/**
 * Display extraction summary card.
 */
export function BriefExtractionSummary({
  lastExtraction,
  totalExtractions,
  completenessScore
}: {
  lastExtraction: string | null;
  totalExtractions: number;
  completenessScore: number;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-gray-600">Last extraction: </span>
          <span className="text-gray-900">
            {lastExtraction ? new Date(lastExtraction).toLocaleString() : 'Never'}
          </span>
        </div>
        <div className="text-right">
          <div className="text-gray-600">
            {totalExtractions} extractions
          </div>
          <div className="text-blue-600 font-medium">
            {completenessScore}% complete
          </div>
        </div>
      </div>
    </div>
  );
}
