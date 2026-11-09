/**
 * Guest-facing text for the dish AR button, in the public menu languages
 * (menu-i18n.ts). Kept apart from MenuCopy so the AR module stays
 * self-contained; unknown languages fall back to English.
 */

export interface ArCopy {
  /** Button on the dish photo that opens the camera with the dish on the table. */
  view3d: string
  /** On a phone without an AR camera (no Google Play Services for AR, in-app browser). */
  arUnavailable: string
  /** iPhone, old model without its iOS file: shown while it is prepared. */
  preparing: string
}

const en: ArCopy = {
  view3d: 'View in 3D',
  arUnavailable: 'This phone cannot show the dish on your table.',
  preparing: 'Preparing…',
}

const COPY: Record<string, ArCopy> = {
  en,
  pt: {
    view3d: 'Ver em 3D',
    arUnavailable: 'Este celular não consegue mostrar o prato na sua mesa.',
    preparing: 'Preparando…',
  },
  es: {
    view3d: 'Ver en 3D',
    arUnavailable: 'Este móvil no puede mostrar el plato en tu mesa.',
    preparing: 'Preparando…',
  },
  fr: {
    view3d: 'Voir en 3D',
    arUnavailable: 'Ce téléphone ne peut pas afficher le plat sur votre table.',
    preparing: 'Préparation…',
  },
  de: {
    view3d: 'In 3D ansehen',
    arUnavailable: 'Dieses Handy kann das Gericht nicht auf Ihrem Tisch zeigen.',
    preparing: 'Wird vorbereitet…',
  },
  it: {
    view3d: 'Vedi in 3D',
    arUnavailable: 'Questo telefono non può mostrare il piatto sul tuo tavolo.',
    preparing: 'Preparazione…',
  },
  nl: {
    view3d: 'Bekijk in 3D',
    arUnavailable: 'Deze telefoon kan het gerecht niet op je tafel tonen.',
    preparing: 'Voorbereiden…',
  },
  pl: {
    view3d: 'Zobacz w 3D',
    arUnavailable: 'Ten telefon nie może pokazać dania na Twoim stole.',
    preparing: 'Przygotowywanie…',
  },
  tr: {
    view3d: '3B görüntüle',
    arUnavailable: 'Bu telefon yemeği masanızda gösteremiyor.',
    preparing: 'Hazırlanıyor…',
  },
  ru: {
    view3d: 'Смотреть в 3D',
    arUnavailable: 'Этот телефон не может показать блюдо на вашем столе.',
    preparing: 'Подготовка…',
  },
  hi: {
    view3d: '3D में देखें',
    arUnavailable: 'यह फ़ोन डिश को आपकी टेबल पर नहीं दिखा सकता।',
    preparing: 'तैयार हो रहा है…',
  },
  ja: {
    view3d: '3Dで見る',
    arUnavailable: 'この端末では料理をテーブルに表示できません。',
    preparing: '準備中…',
  },
  ko: {
    view3d: '3D로 보기',
    arUnavailable: '이 휴대폰에서는 요리를 테이블 위에 보여줄 수 없어요.',
    preparing: '준비 중…',
  },
  zh: {
    view3d: '3D 查看',
    arUnavailable: '这部手机无法在餐桌上显示这道菜。',
    preparing: '准备中…',
  },
  'zh-TW': {
    view3d: '3D 檢視',
    arUnavailable: '這支手機無法在餐桌上顯示這道菜。',
    preparing: '準備中…',
  },
}

export function getArCopy(lang: string | null | undefined): ArCopy {
  if (!lang) return en
  return COPY[lang] ?? COPY[lang.split('-')[0]] ?? en
}
