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
  // Inside the camera (Android, src/components/ar/WebXrDishViewer.tsx).
  /** Before a surface is found. */
  scanning: string
  /** A surface was found: the ring is on the table. */
  tapToPlace: string
  /** After placing: what the fingers do. */
  gestures: string
  /** Size chip at 100 %, and the button that brings the dish back to it. */
  realSize: string
  addToOrder: string
  /** The dish needs a choice (size, flavour…) first: leaves the camera. */
  chooseOptions: string
  /** Toast after adding; {count} = items in the order. */
  added: string
  close: string
  /** "?" button: shows the gestures again. */
  help: string
  // Computers (no AR camera): the dish sheet's 3D viewer.
  /** Button that swaps the dish photo for the 3D model. */
  view3d: string
  /** Button that brings the photo back. */
  viewPhoto: string
  /** Over the 3D model: mouse controls. */
  turnHint: string
}

const en: ArCopy = {
  viewOnTable: 'See it on your table',
  available: 'Can be seen in 3D on your table',
  arUnavailable: 'This phone cannot show the dish on your table.',
  preparing: 'Preparing…',
  scanning: 'Point at the table and move your phone slowly',
  tapToPlace: 'Tap to place the dish',
  gestures: 'Drag to move · Twist to turn · Pinch to resize',
  realSize: 'Real size',
  addToOrder: 'Add to order',
  chooseOptions: 'Choose options',
  added: 'Added ✓ · {count} in your order',
  close: 'Close',
  help: 'How to use',
  view3d: 'View in 3D',
  viewPhoto: 'Back to photo',
  turnHint: 'Drag to turn · Scroll to zoom',
}

const COPY: Record<string, ArCopy> = {
  en,
  pt: {
    viewOnTable: 'Ver na sua mesa',
    available: 'Pode ser visto em 3D na sua mesa',
    arUnavailable: 'Este celular não consegue mostrar o prato na sua mesa.',
    preparing: 'Preparando…',
    scanning: 'Aponte para a mesa e mova o celular devagar',
    tapToPlace: 'Toque para colocar o prato',
    gestures: 'Arraste para mover · Gire com dois dedos · Pinça para aumentar',
    realSize: 'Tamanho real',
    addToOrder: 'Adicionar ao pedido',
    chooseOptions: 'Escolher opções',
    added: 'Adicionado ✓ · {count} no pedido',
    close: 'Fechar',
    help: 'Como usar',
    view3d: 'Ver em 3D',
    viewPhoto: 'Ver foto',
    turnHint: 'Arraste para girar · Role para aproximar',
  },
  es: {
    viewOnTable: 'Ver en tu mesa',
    available: 'Se puede ver en 3D en tu mesa',
    arUnavailable: 'Este móvil no puede mostrar el plato en tu mesa.',
    preparing: 'Preparando…',
    scanning: 'Apunta a la mesa y mueve el móvil despacio',
    tapToPlace: 'Toca para colocar el plato',
    gestures: 'Arrastra para mover · Gira con dos dedos · Pellizca para agrandar',
    realSize: 'Tamaño real',
    addToOrder: 'Añadir al pedido',
    chooseOptions: 'Elegir opciones',
    added: 'Añadido ✓ · {count} en tu pedido',
    close: 'Cerrar',
    help: 'Cómo usar',
    view3d: 'Ver en 3D',
    viewPhoto: 'Ver foto',
    turnHint: 'Arrastra para girar · Desplázate para acercar',
  },
  fr: {
    viewOnTable: 'Voir sur votre table',
    available: 'Visible en 3D sur votre table',
    arUnavailable: 'Ce téléphone ne peut pas afficher le plat sur votre table.',
    preparing: 'Préparation…',
    scanning: 'Visez la table et bougez le téléphone lentement',
    tapToPlace: 'Touchez pour poser le plat',
    gestures: 'Glissez pour déplacer · Tournez à deux doigts · Pincez pour agrandir',
    realSize: 'Taille réelle',
    addToOrder: 'Ajouter à la commande',
    chooseOptions: 'Choisir les options',
    added: 'Ajouté ✓ · {count} dans la commande',
    close: 'Fermer',
    help: 'Mode d’emploi',
    view3d: 'Voir en 3D',
    viewPhoto: 'Voir la photo',
    turnHint: 'Faites glisser pour tourner · Molette pour zoomer',
  },
  de: {
    viewOnTable: 'Auf Ihrem Tisch ansehen',
    available: 'In 3D auf Ihrem Tisch ansehen',
    arUnavailable: 'Dieses Handy kann das Gericht nicht auf Ihrem Tisch zeigen.',
    preparing: 'Wird vorbereitet…',
    scanning: 'Auf den Tisch richten und das Handy langsam bewegen',
    tapToPlace: 'Tippen, um das Gericht abzustellen',
    gestures: 'Ziehen zum Verschieben · Mit zwei Fingern drehen · Spreizen zum Vergrößern',
    realSize: 'Echte Größe',
    addToOrder: 'Zur Bestellung',
    chooseOptions: 'Optionen wählen',
    added: 'Hinzugefügt ✓ · {count} in der Bestellung',
    close: 'Schließen',
    help: 'So geht’s',
    view3d: 'In 3D ansehen',
    viewPhoto: 'Foto ansehen',
    turnHint: 'Ziehen zum Drehen · Scrollen zum Zoomen',
  },
  it: {
    viewOnTable: 'Vedi sul tuo tavolo',
    available: 'Visibile in 3D sul tuo tavolo',
    arUnavailable: 'Questo telefono non può mostrare il piatto sul tuo tavolo.',
    preparing: 'Preparazione…',
    scanning: 'Inquadra il tavolo e muovi il telefono lentamente',
    tapToPlace: 'Tocca per posare il piatto',
    gestures: 'Trascina per spostare · Ruota con due dita · Pizzica per ingrandire',
    realSize: 'Dimensione reale',
    addToOrder: 'Aggiungi all’ordine',
    chooseOptions: 'Scegli le opzioni',
    added: 'Aggiunto ✓ · {count} nell’ordine',
    close: 'Chiudi',
    help: 'Come si usa',
    view3d: 'Vedi in 3D',
    viewPhoto: 'Vedi foto',
    turnHint: 'Trascina per ruotare · Scorri per lo zoom',
  },
  nl: {
    viewOnTable: 'Bekijk op je tafel',
    available: 'In 3D te zien op je tafel',
    arUnavailable: 'Deze telefoon kan het gerecht niet op je tafel tonen.',
    preparing: 'Voorbereiden…',
    scanning: 'Richt op de tafel en beweeg je telefoon langzaam',
    tapToPlace: 'Tik om het gerecht neer te zetten',
    gestures: 'Sleep om te verplaatsen · Draai met twee vingers · Knijp om te vergroten',
    realSize: 'Echte grootte',
    addToOrder: 'Aan bestelling toevoegen',
    chooseOptions: 'Opties kiezen',
    added: 'Toegevoegd ✓ · {count} in je bestelling',
    close: 'Sluiten',
    help: 'Zo werkt het',
    view3d: 'Bekijk in 3D',
    viewPhoto: 'Bekijk foto',
    turnHint: 'Sleep om te draaien · Scroll om te zoomen',
  },
  pl: {
    viewOnTable: 'Zobacz na swoim stole',
    available: 'Można zobaczyć w 3D na stole',
    arUnavailable: 'Ten telefon nie może pokazać dania na Twoim stole.',
    preparing: 'Przygotowywanie…',
    scanning: 'Skieruj na stół i powoli poruszaj telefonem',
    tapToPlace: 'Dotknij, aby postawić danie',
    gestures: 'Przeciągnij, by przesunąć · Obróć dwoma palcami · Rozsuń, by powiększyć',
    realSize: 'Prawdziwy rozmiar',
    addToOrder: 'Dodaj do zamówienia',
    chooseOptions: 'Wybierz opcje',
    added: 'Dodano ✓ · {count} w zamówieniu',
    close: 'Zamknij',
    help: 'Jak używać',
    view3d: 'Zobacz w 3D',
    viewPhoto: 'Zobacz zdjęcie',
    turnHint: 'Przeciągnij, by obrócić · Przewiń, by przybliżyć',
  },
  tr: {
    viewOnTable: 'Masanızda görün',
    available: 'Masanızda 3B görülebilir',
    arUnavailable: 'Bu telefon yemeği masanızda gösteremiyor.',
    preparing: 'Hazırlanıyor…',
    scanning: 'Masaya doğrultun ve telefonu yavaşça hareket ettirin',
    tapToPlace: 'Yemeği yerleştirmek için dokunun',
    gestures: 'Taşımak için sürükleyin · İki parmakla çevirin · Büyütmek için açın',
    realSize: 'Gerçek boyut',
    addToOrder: 'Siparişe ekle',
    chooseOptions: 'Seçenekleri seç',
    added: 'Eklendi ✓ · siparişte {count}',
    close: 'Kapat',
    help: 'Nasıl kullanılır',
    view3d: '3B görüntüle',
    viewPhoto: 'Fotoğrafı gör',
    turnHint: 'Döndürmek için sürükleyin · Yakınlaştırmak için kaydırın',
  },
  ru: {
    viewOnTable: 'Посмотреть на столе',
    available: 'Можно увидеть в 3D на столе',
    arUnavailable: 'Этот телефон не может показать блюдо на вашем столе.',
    preparing: 'Подготовка…',
    scanning: 'Наведите на стол и медленно двигайте телефон',
    tapToPlace: 'Нажмите, чтобы поставить блюдо',
    gestures: 'Перетащите, чтобы сдвинуть · Поверните двумя пальцами · Разведите, чтобы увеличить',
    realSize: 'Реальный размер',
    addToOrder: 'Добавить в заказ',
    chooseOptions: 'Выбрать опции',
    added: 'Добавлено ✓ · в заказе {count}',
    close: 'Закрыть',
    help: 'Как пользоваться',
    view3d: 'Смотреть в 3D',
    viewPhoto: 'Смотреть фото',
    turnHint: 'Перетащите, чтобы повернуть · Прокрутите для масштаба',
  },
  hi: {
    viewOnTable: 'अपनी टेबल पर देखें',
    available: 'अपनी टेबल पर 3D में देखा जा सकता है',
    arUnavailable: 'यह फ़ोन डिश को आपकी टेबल पर नहीं दिखा सकता।',
    preparing: 'तैयार हो रहा है…',
    scanning: 'टेबल की ओर रखें और फ़ोन धीरे-धीरे घुमाएँ',
    tapToPlace: 'डिश रखने के लिए टैप करें',
    gestures: 'खिसकाने के लिए खींचें · दो उंगलियों से घुमाएँ · बड़ा करने के लिए फैलाएँ',
    realSize: 'असली आकार',
    addToOrder: 'ऑर्डर में जोड़ें',
    chooseOptions: 'विकल्प चुनें',
    added: 'जोड़ा गया ✓ · ऑर्डर में {count}',
    close: 'बंद करें',
    help: 'कैसे इस्तेमाल करें',
    view3d: '3D में देखें',
    viewPhoto: 'फ़ोटो देखें',
    turnHint: 'घुमाने के लिए खींचें · ज़ूम के लिए स्क्रॉल करें',
  },
  ja: {
    viewOnTable: 'テーブルで見る',
    available: 'テーブルの上で3D表示できます',
    arUnavailable: 'この端末では料理をテーブルに表示できません。',
    preparing: '準備中…',
    scanning: 'テーブルに向けて、スマホをゆっくり動かしてください',
    tapToPlace: 'タップして料理を置く',
    gestures: 'ドラッグで移動・2本指で回転・ピンチで拡大',
    realSize: '実物大',
    addToOrder: '注文に追加',
    chooseOptions: 'オプションを選ぶ',
    added: '追加しました ✓ ・注文 {count} 点',
    close: '閉じる',
    help: '使い方',
    view3d: '3Dで見る',
    viewPhoto: '写真を見る',
    turnHint: 'ドラッグで回転・スクロールで拡大',
  },
  ko: {
    viewOnTable: '테이블에서 보기',
    available: '테이블 위에서 3D로 볼 수 있어요',
    arUnavailable: '이 휴대폰에서는 요리를 테이블 위에 보여줄 수 없어요.',
    preparing: '준비 중…',
    scanning: '테이블을 비추고 휴대폰을 천천히 움직이세요',
    tapToPlace: '탭해서 요리를 놓기',
    gestures: '드래그해서 이동 · 두 손가락으로 회전 · 벌려서 확대',
    realSize: '실제 크기',
    addToOrder: '주문에 추가',
    chooseOptions: '옵션 선택',
    added: '추가됨 ✓ · 주문 {count}개',
    close: '닫기',
    help: '사용 방법',
    view3d: '3D로 보기',
    viewPhoto: '사진 보기',
    turnHint: '드래그해서 회전 · 스크롤로 확대',
  },
  zh: {
    viewOnTable: '在餐桌上查看',
    available: '可在餐桌上以 3D 查看',
    arUnavailable: '这部手机无法在餐桌上显示这道菜。',
    preparing: '准备中…',
    scanning: '对准餐桌，慢慢移动手机',
    tapToPlace: '轻点放下这道菜',
    gestures: '拖动移动 · 双指旋转 · 双指张开放大',
    realSize: '实际大小',
    addToOrder: '加入订单',
    chooseOptions: '选择规格',
    added: '已加入 ✓ · 订单共 {count} 份',
    close: '关闭',
    help: '使用方法',
    view3d: '3D 查看',
    viewPhoto: '查看照片',
    turnHint: '拖动旋转 · 滚动缩放',
  },
  'zh-TW': {
    viewOnTable: '在餐桌上檢視',
    available: '可在餐桌上以 3D 檢視',
    arUnavailable: '這支手機無法在餐桌上顯示這道菜。',
    preparing: '準備中…',
    scanning: '對準餐桌，慢慢移動手機',
    tapToPlace: '輕點放下這道菜',
    gestures: '拖曳移動 · 雙指旋轉 · 雙指張開放大',
    realSize: '實際大小',
    addToOrder: '加入訂單',
    chooseOptions: '選擇規格',
    added: '已加入 ✓ · 訂單共 {count} 份',
    close: '關閉',
    help: '使用方法',
    view3d: '3D 檢視',
    viewPhoto: '查看照片',
    turnHint: '拖曳旋轉 · 捲動縮放',
  },
}

export function getArCopy(lang: string | null | undefined): ArCopy {
  if (!lang) return en
  return COPY[lang] ?? COPY[lang.split('-')[0]] ?? en
}
