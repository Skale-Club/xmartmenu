/**
 * Guest-facing text for the 3D / augmented reality view, in the public menu
 * languages (menu-i18n.ts). Kept apart from MenuCopy so the AR module stays
 * self-contained; unknown languages fall back to English.
 */

export interface ArCopy {
  /** Button on the dish photo that opens the 3D view. */
  view3d: string
  /** Button inside the 3D view that places the dish on the table (camera). */
  viewOnTable: string
  /** How to handle the model in the 3D view. */
  gestures: string
  /** Shown where AR is not available (desktop, unsupported phone). */
  noAr: string
  /** The model failed to download or parse. */
  loadError: string
}

const en: ArCopy = {
  view3d: 'View in 3D',
  viewOnTable: 'View on your table',
  gestures: 'Drag to turn · pinch to zoom',
  noAr: 'Open the menu on your phone to see this dish on your table.',
  loadError: 'The 3D model could not be loaded.',
}

const COPY: Record<string, ArCopy> = {
  en,
  pt: {
    view3d: 'Ver em 3D',
    viewOnTable: 'Ver na sua mesa',
    gestures: 'Arraste para girar · pinça para zoom',
    noAr: 'Abra o cardápio no celular para ver este prato na sua mesa.',
    loadError: 'Não foi possível carregar o modelo 3D.',
  },
  es: {
    view3d: 'Ver en 3D',
    viewOnTable: 'Ver en tu mesa',
    gestures: 'Arrastra para girar · pellizca para ampliar',
    noAr: 'Abre el menú en tu móvil para ver este plato en tu mesa.',
    loadError: 'No se pudo cargar el modelo 3D.',
  },
  fr: {
    view3d: 'Voir en 3D',
    viewOnTable: 'Voir sur votre table',
    gestures: 'Glissez pour tourner · pincez pour zoomer',
    noAr: 'Ouvrez le menu sur votre téléphone pour voir ce plat sur votre table.',
    loadError: 'Impossible de charger le modèle 3D.',
  },
  de: {
    view3d: 'In 3D ansehen',
    viewOnTable: 'Auf Ihrem Tisch ansehen',
    gestures: 'Ziehen zum Drehen · Finger spreizen zum Zoomen',
    noAr: 'Öffnen Sie die Speisekarte auf dem Handy, um das Gericht auf Ihrem Tisch zu sehen.',
    loadError: 'Das 3D-Modell konnte nicht geladen werden.',
  },
  it: {
    view3d: 'Vedi in 3D',
    viewOnTable: 'Vedi sul tuo tavolo',
    gestures: 'Trascina per ruotare · pizzica per lo zoom',
    noAr: 'Apri il menu sul telefono per vedere questo piatto sul tuo tavolo.',
    loadError: 'Impossibile caricare il modello 3D.',
  },
  nl: {
    view3d: 'Bekijk in 3D',
    viewOnTable: 'Bekijk op je tafel',
    gestures: 'Sleep om te draaien · knijp om te zoomen',
    noAr: 'Open het menu op je telefoon om dit gerecht op je tafel te zien.',
    loadError: 'Het 3D-model kon niet worden geladen.',
  },
  pl: {
    view3d: 'Zobacz w 3D',
    viewOnTable: 'Zobacz na swoim stole',
    gestures: 'Przeciągnij, aby obrócić · uszczypnij, aby powiększyć',
    noAr: 'Otwórz menu na telefonie, aby zobaczyć to danie na swoim stole.',
    loadError: 'Nie udało się wczytać modelu 3D.',
  },
  tr: {
    view3d: '3B görüntüle',
    viewOnTable: 'Masanızda görün',
    gestures: 'Döndürmek için sürükleyin · yakınlaştırmak için kıstırın',
    noAr: 'Bu yemeği masanızda görmek için menüyü telefonunuzda açın.',
    loadError: '3B model yüklenemedi.',
  },
  ru: {
    view3d: 'Смотреть в 3D',
    viewOnTable: 'Посмотреть на вашем столе',
    gestures: 'Проведите, чтобы повернуть · сведите пальцы для масштаба',
    noAr: 'Откройте меню на телефоне, чтобы увидеть блюдо на своём столе.',
    loadError: 'Не удалось загрузить 3D-модель.',
  },
  hi: {
    view3d: '3D में देखें',
    viewOnTable: 'अपनी टेबल पर देखें',
    gestures: 'घुमाने के लिए खींचें · ज़ूम के लिए पिंच करें',
    noAr: 'इस डिश को अपनी टेबल पर देखने के लिए फ़ोन पर मेन्यू खोलें।',
    loadError: '3D मॉडल लोड नहीं हो सका।',
  },
  ja: {
    view3d: '3Dで見る',
    viewOnTable: 'テーブルに置いて見る',
    gestures: 'ドラッグで回転・ピンチでズーム',
    noAr: 'スマートフォンでメニューを開くと、この料理をテーブルに置いて見られます。',
    loadError: '3Dモデルを読み込めませんでした。',
  },
  ko: {
    view3d: '3D로 보기',
    viewOnTable: '내 테이블에서 보기',
    gestures: '드래그해서 회전 · 핀치로 확대',
    noAr: '휴대폰에서 메뉴를 열면 이 요리를 테이블 위에서 볼 수 있어요.',
    loadError: '3D 모델을 불러오지 못했습니다.',
  },
  zh: {
    view3d: '3D 查看',
    viewOnTable: '放到您的餐桌上看',
    gestures: '拖动旋转 · 双指缩放',
    noAr: '在手机上打开菜单，即可在餐桌上查看这道菜。',
    loadError: '无法加载 3D 模型。',
  },
  'zh-TW': {
    view3d: '3D 檢視',
    viewOnTable: '放到您的餐桌上看',
    gestures: '拖曳旋轉 · 雙指縮放',
    noAr: '在手機上開啟菜單，即可在餐桌上檢視這道菜。',
    loadError: '無法載入 3D 模型。',
  },
}

export function getArCopy(lang: string | null | undefined): ArCopy {
  if (!lang) return en
  return COPY[lang] ?? COPY[lang.split('-')[0]] ?? en
}
