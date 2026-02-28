'use client';

type Props = {
  overallScore: number;
  completenessScore: number;
  confidenceScore: number;
  verificationScore: number;
  recommendation: string;
  locale?: 'ru' | 'uk' | 'en' | 'sr-ME';
};

/**
 * Display brief quality score with breakdown.
 */
export function BriefQualityScore({
  overallScore,
  completenessScore,
  confidenceScore,
  verificationScore,
  recommendation,
  locale = 'en'
}: Props) {
  const labels = translations[locale];
  const scoreColor = getScoreColor(overallScore);
  const recommendationConfig = getRecommendationConfig(recommendation, locale);
  
  return (
    <div className="bg-white border rounded-lg p-4 space-y-4">
      {/* Overall Score */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{labels.qualityScore}</h3>
        <div className={`text-2xl font-bold ${scoreColor}`}>
          {overallScore}/100
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${scoreColor.replace('text-', 'bg-')}`}
          style={{width: `${overallScore}%`}}
        />
      </div>
      
      {/* Breakdown */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-gray-500">{labels.completeness}</div>
          <div className="font-medium text-gray-900">{completenessScore}%</div>
        </div>
        <div>
          <div className="text-gray-500">{labels.confidence}</div>
          <div className="font-medium text-gray-900">{confidenceScore}%</div>
        </div>
        <div>
          <div className="text-gray-500">{labels.verification}</div>
          <div className="font-medium text-gray-900">{verificationScore}%</div>
        </div>
      </div>
      
      {/* Recommendation */}
      <div className={`rounded-lg p-3 ${recommendationConfig.bgColor}`}>
        <div className="flex items-start gap-2">
          <span className="text-lg">{recommendationConfig.icon}</span>
          <div>
            <div className="font-medium text-gray-900">{recommendationConfig.title}</div>
            <div className="text-sm text-gray-600">{recommendationConfig.description}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

function getRecommendationConfig(recommendation: string, locale: string): {
  icon: string;
  title: string;
  description: string;
  bgColor: string;
} {
  type RecConfig = {icon: string; title: string; description: string; bgColor: string};
  
  const configs: Record<string, RecConfig> = {
    ready_for_handoff: {
      icon: '✅',
      title: translations[locale].readyTitle,
      description: translations[locale].readyDesc,
      bgColor: 'bg-green-50'
    },
    collect_more_information: {
      icon: '📝',
      title: translations[locale].collectTitle,
      description: translations[locale].collectDesc,
      bgColor: 'bg-yellow-50'
    },
    verify_low_confidence_fields: {
      icon: '⚠️',
      title: translations[locale].verifyTitle,
      description: translations[locale].verifyDesc,
      bgColor: 'bg-orange-50'
    },
    complete_required_fields: {
      icon: '📋',
      title: translations[locale].completeTitle,
      description: translations[locale].completeDesc,
      bgColor: 'bg-yellow-50'
    },
    continue_data_collection: {
      icon: '💬',
      title: translations[locale].continueTitle,
      description: translations[locale].continueDesc,
      bgColor: 'bg-blue-50'
    }
  };
  
  return configs[recommendation] || configs.continue_data_collection;
}

const translations: Record<string, Record<string, string>> = {
  en: {
    qualityScore: 'Brief Quality Score',
    completeness: 'Completeness',
    confidence: 'Confidence',
    verification: 'Verification',
    readyTitle: 'Ready for Handoff',
    readyDesc: 'Brief is complete and ready to transfer to manager',
    collectTitle: 'Collect More Information',
    collectDesc: 'Continue conversation to gather more details',
    verifyTitle: 'Verify Low Confidence Fields',
    verifyDesc: 'Review and verify fields with low confidence scores',
    completeTitle: 'Complete Required Fields',
    completeDesc: 'Fill in required fields: service type, goal, contact info',
    continueTitle: 'Continue Data Collection',
    continueDesc: 'Keep conversation going to build complete brief'
  },
  ru: {
    qualityScore: 'Качество брифа',
    completeness: 'Завершенность',
    confidence: 'Уверенность',
    verification: 'Проверка',
    readyTitle: 'Готово к передаче',
    readyDesc: 'Бриф заполнен и готов к передаче менеджеру',
    collectTitle: 'Собрать больше информации',
    collectDesc: 'Продолжите разговор для сбора деталей',
    verifyTitle: 'Проверить поля с низкой уверенностью',
    verifyDesc: 'Проверьте поля с низкой уверенностью извлечения',
    completeTitle: 'Заполнить обязательные поля',
    completeDesc: 'Заполните: тип услуги, цель, контактная информация',
    continueTitle: 'Продолжить сбор данных',
    continueDesc: 'Продолжите разговор для заполнения брифа'
  },
  uk: {
    qualityScore: 'Якість брифу',
    completeness: 'Завершеність',
    confidence: 'Впевненість',
    verification: 'Перевірка',
    readyTitle: 'Готово до передачі',
    readyDesc: 'Бриф заповнено і готово до передачі менеджеру',
    collectTitle: 'Зібрати більше інформації',
    collectDesc: 'Продовжіть розмову для збору деталей',
    verifyTitle: 'Перевірити поля з низькою впевненістю',
    verifyDesc: 'Перевірте поля з низькою впевненістю вилучення',
    completeTitle: 'Заповнити обовʼязкові поля',
    completeDesc: 'Заповніть: тип послуги, мета, контактна інформація',
    continueTitle: 'Продовжити збір даних',
    continueDesc: 'Продовжіть розмову для заповнення брифу'
  },
  'sr-ME': {
    qualityScore: 'Kvalitet brief-a',
    completeness: 'Kompletnost',
    confidence: 'Sigurnost',
    verification: 'Verifikacija',
    readyTitle: 'Spremno za predaju',
    readyDesc: 'Brief je kompletan i spreman za predaju menadžeru',
    collectTitle: 'Prikupiti više informacija',
    collectDesc: 'Nastavite razgovor za prikupljanje detalja',
    verifyTitle: 'Verifikuj polja sa niskom sigurnošću',
    verifyDesc: 'Pregledaj i verifikuj polja sa niskom sigurnošću',
    completeTitle: 'Popuni obavezna polja',
    completeDesc: 'Popuni: tip usluge, cilj, kontakt informacije',
    continueTitle: 'Nastavi prikupljanje podataka',
    continueDesc: 'Nastavi razgovor za popunjavanje brief-a'
  }
};

/**
 * Display quick stats for brief.
 */
export function BriefQuickStats({
  totalFields,
  filledFields,
  verifiedFields,
  lowConfidenceFields
}: {
  totalFields: number;
  filledFields: number;
  verifiedFields: number;
  lowConfidenceFields: number;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 text-sm">
      <div className="text-center p-2 bg-gray-50 rounded">
        <div className="text-gray-500">Total</div>
        <div className="font-bold text-gray-900">{totalFields}</div>
      </div>
      <div className="text-center p-2 bg-blue-50 rounded">
        <div className="text-blue-600">Filled</div>
        <div className="font-bold text-blue-900">{filledFields}</div>
      </div>
      <div className="text-center p-2 bg-green-50 rounded">
        <div className="text-green-600">Verified</div>
        <div className="font-bold text-green-900">{verifiedFields}</div>
      </div>
      <div className="text-center p-2 bg-orange-50 rounded">
        <div className="text-orange-600">Review</div>
        <div className="font-bold text-orange-900">{lowConfidenceFields}</div>
      </div>
    </div>
  );
}
