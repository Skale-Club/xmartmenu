/**
 * Guest-facing text for the dish AR button, in the public menu languages
 * (menu-i18n.ts). Kept apart from MenuCopy so the AR module stays
 * self-contained; unknown languages fall back to English.
 */

export interface ArCopy {
  /** Button on the dish photo that opens the camera with the dish on the guest's table. */
  viewOnTable: string
  /** Screen-reader name of the small cube on a dish card: this dish has a 3D model. */
  available: string
  /** On a phone without an AR camera (no Google Play Services for AR, in-app browser). */
  arUnavailable: string
  /** iPhone, old model without its iOS file: shown while it is prepared. */
  preparing: string
}

const en: ArCopy = {
  viewOnTable: 'See it on your table',
  available: 'Can be seen in 3D on your table',
  arUnavailable: 'This phone cannot show the dish on your table.',
  preparing: 'Preparing…',
}

const COPY: Record<string, ArCopy> = {
  en,
  pt: {
    viewOnTable: 'Ver na sua mesa',
    available: 'Pode ser visto em 3D na sua mesa',
    arUnavailable: 'Este celular não consegue mostrar o prato na sua mesa.',
    preparing: 'Preparando…',
  },
  es: {
    viewOnTable: 'Ver en tu mesa',
    available: 'Se puede ver en 3D en tu mesa',
    arUnavailable: 'Este móvil no puede mostrar el plato en tu mesa.',
    preparing: 'Preparando…',
  },
  fr: {
    viewOnTable: 'Voir sur votre table',
    available: 'Visible en 3D sur votre table',
    arUnavailable: 'Ce téléphone ne peut pas afficher le plat sur votre table.',
    preparing: 'Préparation…',
  },
  de: {
    viewOnTable: 'Auf Ihrem Tisch ansehen',
    available: 'In 3D auf Ihrem Tisch ansehen',
    arUnavailable: 'Dieses Handy kann das Gericht nicht auf Ihrem Tisch zeigen.',
    preparing: 'Wird vorbereitet…',
  },
  it: {
    viewOnTable: 'Vedi sul tuo tavolo',
    available: 'Visibile in 3D sul tuo tavolo',
    arUnavailable: 'Questo telefono non può mostrare il piatto sul tuo tavolo.',
    preparing: 'Preparazione…',
  },
  nl: {
    viewOnTable: 'Bekijk op je tafel',
    available: 'In 3D te zien op je tafel',
    arUnavailable: 'Deze telefoon kan het gerecht niet op je tafel tonen.',
    preparing: 'Voorbereiden…',
  },
  pl: {
    viewOnTable: 'Zobacz na swoim stole',
    available: 'Można zobaczyć w 3D na stole',
    arUnavailable: 'Ten telefon nie może pokazać dania na Twoim stole.',
    preparing: 'Przygotowywanie…',
  },
  tr: {
    viewOnTable: 'Masanızda görün',
    available: 'Masanızda 3B görülebilir',
    arUnavailable: 'Bu telefon yemeği masanızda gösteremiyor.',
    preparing: 'Hazırlanıyor…',
  },
  ru: {
    viewOnTable: 'Посмотреть на столе',
    available: 'Можно увидеть в 3D на столе',
    arUnavailable: 'Этот телефон не может показать блюдо на вашем столе.',
    preparing: 'Подготовка…',
  },
  hi: {
    viewOnTable: 'अपनी टेबल पर देखें',
    available: 'अपनी टेबल पर 3D में देखा जा सकता है',
    arUnavailable: 'यह फ़ोन डिश को आपकी टेबल पर नहीं दिखा सकता।',
    preparing: 'तैयार हो रहा है…',
  },
  ja: {
    viewOnTable: 'テーブルで見る',
    available: 'テーブルの上で3D表示できます',
    arUnavailable: 'この端末では料理をテーブルに表示できません。',
    preparing: '準備中…',
  },
  ko: {
    viewOnTable: '테이블에서 보기',
    available: '테이블 위에서 3D로 볼 수 있어요',
    arUnavailable: '이 휴대폰에서는 요리를 테이블 위에 보여줄 수 없어요.',
    preparing: '준비 중…',
  },
  zh: {
    viewOnTable: '在餐桌上查看',
    available: '可在餐桌上以 3D 查看',
    arUnavailable: '这部手机无法在餐桌上显示这道菜。',
    preparing: '准备中…',
  },
  'zh-TW': {
    viewOnTable: '在餐桌上檢視',
    available: '可在餐桌上以 3D 檢視',
    arUnavailable: '這支手機無法在餐桌上顯示這道菜。',
    preparing: '準備中…',
  },
}

export function getArCopy(lang: string | null | undefined): ArCopy {
  if (!lang) return en
  return COPY[lang] ?? COPY[lang.split('-')[0]] ?? en
}
