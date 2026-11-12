import type { AccessRequestStep } from '@/lib/access-requests/contract'
import type { Language } from './survey-state'

export interface StepCopy { title: string; helper?: string }
export interface Strings {
  back: string; next: string; skip: string; send: string; sending: string
  stepOf: (n: number, total: number) => string
  errors: { required: string; phone: string; email: string; generic: string; load: string; retry: string }
  steps: Record<AccessRequestStep, StepCopy>
  fields: { businessName: string; businessTypeOther: string; location: string; phone: string; email: string; social: string; countryLabel: string; countrySearch: string }
  languages: Record<Language, string>
  businessTypes: Record<string, string>
  locations: Record<string, string>
  currentMenus: Record<string, string>
  interests: Record<string, string>
  menuSizes: Record<string, string>
  contactTimes: Record<string, string>
  whatsappConsent: string
  pending: { title: string; text: string; whatsapp: string; whatsappMessage: string; signOut: string }
  declined: { title: string; text: string }
  loading: string
}

const en: Strings = {
  back: 'Back', next: 'Continue', skip: 'Skip', send: 'Send request', sending: 'Sending...',
  stepOf: (n, t) => `Question ${n} of ${t}`,
  errors: { required: 'Please answer this question to continue.', phone: 'Enter a valid phone number.', email: 'Enter a valid e-mail or leave it empty.', generic: 'Something went wrong. Please try again.', load: 'We could not load your request.', retry: 'Try again' },
  steps: {
    language: { title: 'Which language do you prefer?' },
    businessName: { title: "What's the name of your business?" },
    businessType: { title: 'What kind of business is it?' },
    location: { title: 'Where is it?', helper: 'City, state, country' },
    contact: { title: 'How can we reach you?', helper: 'We will call or message you to set up your menu.' },
    locations: { title: 'How many locations do you have?' },
    currentMenu: { title: 'How do your customers see your menu today?' },
    interests: { title: 'What are you most interested in?', helper: 'Pick as many as you like.' },
    menuSize: { title: 'How many dishes are on your menu?' },
    socialUrl: { title: 'Instagram or website', helper: 'Optional. It helps us prepare for the meeting.' },
    contactTime: { title: 'When is the best time to contact you?' },
  },
  fields: { businessName: 'Business name', businessTypeOther: 'What kind of business?', location: 'City, state, country', phone: 'Phone', email: 'E-mail (optional)', social: '@instagram or https://...', countryLabel: 'Country', countrySearch: 'Search country' },
  languages: { en: 'English', pt: 'Português', es: 'Español' },
  businessTypes: { restaurant: 'Restaurant', bar: 'Bar', cafe: 'Cafe', bakery: 'Bakery', pizzeria: 'Pizzeria', food_truck: 'Food truck', hotel: 'Hotel', other: 'Other' },
  locations: { '1': '1 location', '2-5': '2 to 5', '6+': '6 or more' },
  currentMenus: { printed: 'Printed menu', pdf_qr: 'PDF or QR code', other_app: 'Another app', none: 'No menu yet' },
  interests: { qr_menu: 'QR code menu', table_ordering: 'Ordering at the table', takeout_delivery: 'Takeout and delivery', ai_chat: 'AI chat assistant', ar_dishes: 'Dishes in 3D / AR', website_domain: 'Website with my domain', multi_language: 'Several languages' },
  menuSizes: { up_to_30: 'Up to 30 dishes', '30_80': '30 to 80 dishes', '80_plus': 'More than 80' },
  contactTimes: { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' },
  whatsappConsent: 'You can contact me on WhatsApp',
  pending: { title: 'We got your request!', text: 'The XmartMenu team will contact you to schedule a meeting and set up your menu with you.', whatsapp: 'Talk to us on WhatsApp', whatsappMessage: 'Hi! I just sent my XmartMenu request.', signOut: 'Sign out' },
  declined: { title: "We can't offer XmartMenu to your business right now", text: 'Thank you for your interest. If you think this is a mistake or your situation changes, please get in touch and we will gladly take another look.' },
  loading: 'Loading...',
}

const pt: Strings = {
  back: 'Voltar', next: 'Continuar', skip: 'Pular', send: 'Enviar pedido', sending: 'Enviando...',
  stepOf: (n, t) => `Pergunta ${n} de ${t}`,
  errors: { required: 'Responda esta pergunta para continuar.', phone: 'Digite um telefone válido.', email: 'Digite um e-mail válido ou deixe vazio.', generic: 'Algo deu errado. Tente novamente.', load: 'Não foi possível carregar seu pedido.', retry: 'Tentar de novo' },
  steps: {
    language: { title: 'Qual idioma você prefere?' },
    businessName: { title: 'Qual é o nome do seu negócio?' },
    businessType: { title: 'Que tipo de negócio é?' },
    location: { title: 'Onde fica?', helper: 'Cidade, estado, país' },
    contact: { title: 'Como podemos falar com você?', helper: 'Vamos ligar ou mandar mensagem para montar seu cardápio.' },
    locations: { title: 'Quantas unidades você tem?' },
    currentMenu: { title: 'Como seus clientes veem o cardápio hoje?' },
    interests: { title: 'O que mais interessa a você?', helper: 'Escolha quantos quiser.' },
    menuSize: { title: 'Quantos pratos tem o seu cardápio?' },
    socialUrl: { title: 'Instagram ou site', helper: 'Opcional. Ajuda a gente a se preparar para a reunião.' },
    contactTime: { title: 'Qual o melhor horário para falar com você?' },
  },
  fields: { businessName: 'Nome do negócio', businessTypeOther: 'Que tipo de negócio?', location: 'Cidade, estado, país', phone: 'Telefone', email: 'E-mail (opcional)', social: '@instagram ou https://...', countryLabel: 'País', countrySearch: 'Buscar país' },
  languages: { en: 'English', pt: 'Português', es: 'Español' },
  businessTypes: { restaurant: 'Restaurante', bar: 'Bar', cafe: 'Cafeteria', bakery: 'Padaria', pizzeria: 'Pizzaria', food_truck: 'Food truck', hotel: 'Hotel', other: 'Outro' },
  locations: { '1': '1 unidade', '2-5': '2 a 5', '6+': '6 ou mais' },
  currentMenus: { printed: 'Cardápio impresso', pdf_qr: 'PDF ou QR code', other_app: 'Outro aplicativo', none: 'Ainda não tenho' },
  interests: { qr_menu: 'Cardápio por QR code', table_ordering: 'Pedido na mesa', takeout_delivery: 'Retirada e entrega', ai_chat: 'Assistente com IA', ar_dishes: 'Pratos em 3D / AR', website_domain: 'Site com meu domínio', multi_language: 'Vários idiomas' },
  menuSizes: { up_to_30: 'Até 30 pratos', '30_80': '30 a 80 pratos', '80_plus': 'Mais de 80' },
  contactTimes: { morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite' },
  whatsappConsent: 'Podem falar comigo pelo WhatsApp',
  pending: { title: 'Recebemos seu pedido!', text: 'A equipe do XmartMenu vai entrar em contato para marcar uma reunião e montar o seu cardápio com você.', whatsapp: 'Falar no WhatsApp', whatsappMessage: 'Olá! Acabei de enviar meu pedido do XmartMenu.', signOut: 'Sair' },
  declined: { title: 'Não podemos oferecer o XmartMenu ao seu negócio agora', text: 'Obrigado pelo interesse. Se acha que foi um engano ou se sua situação mudar, fale com a gente e teremos prazer em olhar de novo.' },
  loading: 'Carregando...',
}

const es: Strings = {
  back: 'Atrás', next: 'Continuar', skip: 'Omitir', send: 'Enviar solicitud', sending: 'Enviando...',
  stepOf: (n, t) => `Pregunta ${n} de ${t}`,
  errors: { required: 'Responde esta pregunta para continuar.', phone: 'Ingresa un teléfono válido.', email: 'Ingresa un correo válido o déjalo vacío.', generic: 'Algo salió mal. Inténtalo de nuevo.', load: 'No pudimos cargar tu solicitud.', retry: 'Reintentar' },
  steps: {
    language: { title: '¿Qué idioma prefieres?' },
    businessName: { title: '¿Cómo se llama tu negocio?' },
    businessType: { title: '¿Qué tipo de negocio es?' },
    location: { title: '¿Dónde está?', helper: 'Ciudad, estado, país' },
    contact: { title: '¿Cómo podemos contactarte?', helper: 'Te llamaremos o escribiremos para armar tu menú.' },
    locations: { title: '¿Cuántos locales tienes?' },
    currentMenu: { title: '¿Cómo ven hoy tu menú tus clientes?' },
    interests: { title: '¿Qué te interesa más?', helper: 'Elige todas las que quieras.' },
    menuSize: { title: '¿Cuántos platos tiene tu menú?' },
    socialUrl: { title: 'Instagram o sitio web', helper: 'Opcional. Nos ayuda a prepararnos para la reunión.' },
    contactTime: { title: '¿Cuál es el mejor horario para contactarte?' },
  },
  fields: { businessName: 'Nombre del negocio', businessTypeOther: '¿Qué tipo de negocio?', location: 'Ciudad, estado, país', phone: 'Teléfono', email: 'Correo (opcional)', social: '@instagram o https://...', countryLabel: 'País', countrySearch: 'Buscar país' },
  languages: { en: 'English', pt: 'Português', es: 'Español' },
  businessTypes: { restaurant: 'Restaurante', bar: 'Bar', cafe: 'Cafetería', bakery: 'Panadería', pizzeria: 'Pizzería', food_truck: 'Food truck', hotel: 'Hotel', other: 'Otro' },
  locations: { '1': '1 local', '2-5': '2 a 5', '6+': '6 o más' },
  currentMenus: { printed: 'Menú impreso', pdf_qr: 'PDF o código QR', other_app: 'Otra aplicación', none: 'Aún no tengo' },
  interests: { qr_menu: 'Menú con código QR', table_ordering: 'Pedidos en la mesa', takeout_delivery: 'Para llevar y entrega', ai_chat: 'Asistente con IA', ar_dishes: 'Platos en 3D / AR', website_domain: 'Sitio web con mi dominio', multi_language: 'Varios idiomas' },
  menuSizes: { up_to_30: 'Hasta 30 platos', '30_80': '30 a 80 platos', '80_plus': 'Más de 80' },
  contactTimes: { morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche' },
  whatsappConsent: 'Pueden contactarme por WhatsApp',
  pending: { title: '¡Recibimos tu solicitud!', text: 'El equipo de XmartMenu te contactará para agendar una reunión y armar tu menú contigo.', whatsapp: 'Hablar por WhatsApp', whatsappMessage: '¡Hola! Acabo de enviar mi solicitud de XmartMenu.', signOut: 'Cerrar sesión' },
  declined: { title: 'Por ahora no podemos ofrecer XmartMenu a tu negocio', text: 'Gracias por tu interés. Si crees que es un error o tu situación cambia, escríbenos y con gusto lo revisaremos de nuevo.' },
  loading: 'Cargando...',
}

export const STRINGS: Record<Language, Strings> = { en, pt, es }
