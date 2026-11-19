// =====================================================================
//  ADL — все настройки сайта в одном месте.
//  Цены, телефон, тексты калькулятора меняются ЗДЕСЬ.
// =====================================================================

export const SITE = {
  brand: 'ADL',
  city: 'Алматы',
  phoneDisplay: '8 707 604 19 86',
  phoneTel: '+77076041986',
  whatsapp: '77076041986',          // номер для WhatsApp без «+»
  experienceYears: 15,
  warrantyYears: 5,
  productionDays: 14,
  hours: 'Ежедневно 9:00–21:00',
  // true  — после отправки заявки у клиента открывается WhatsApp с готовым текстом
  // false — только тихое сохранение (когда настроены авто-уведомления CallMeBot)
  openWhatsAppAfterLead: true,
};

// Публичные ключи Supabase (их безопасно держать на сайте — доступ ограничен правилами RLS).
// ⚠️ НИКОГДА не вставляйте сюда secret / service_role ключ.
export const SUPABASE = {
  url: 'https://qfsczrckztgsbgqyidua.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2N6cmNrenRnc2JncXlpZHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMDU5MTIsImV4cCI6MjExMDY4MTkxMn0.HKqB1wf-_ET5hQLaLTvj3PdfwmbH1V4tZ-x2ScOcl-I',
};

export const CATEGORIES = [
  { id: 'kitchen',  name: 'Кухни' },
  { id: 'wardrobe', name: 'Шкафы и купе' },
  { id: 'dressing', name: 'Гардеробные' },
  { id: 'tv',       name: 'ТВ-зоны' },
  { id: 'dresser',  name: 'Тумбы и комоды' },
  { id: 'hallway',  name: 'Прихожие' },
  { id: 'kids',     name: 'Детские' },
  { id: 'other',    name: 'Другое' },
];

// ---------------------------------------------------------------------
//  КОНФИГУРАТОР (бывший калькулятор). Суммы клиенту НЕ показываются —
//  смету готовит менеджер. k — «вес» опции для определения класса проекта.
// ---------------------------------------------------------------------
export const CALC = {
  types: [
    { id: 'kitchen',  name: 'Кухня',          min: 1.2, max: 8,  def: 3.2, height: false },
    { id: 'kupe',     name: 'Шкаф-купе',      min: 1.0, max: 6,  def: 2.4, height: true  },
    { id: 'wardrobe', name: 'Распашной шкаф', min: 0.8, max: 6,  def: 2.0, height: true  },
    { id: 'dressing', name: 'Гардеробная',    min: 1.5, max: 10, def: 4.0, height: true  },
    { id: 'tv',       name: 'ТВ-зона',        min: 1.2, max: 5,  def: 2.4, height: false },
    { id: 'dresser',  name: 'Тумба / комод',  min: 0.6, max: 3,  def: 1.2, height: false },
    { id: 'hallway',  name: 'Прихожая',       min: 1.0, max: 5,  def: 2.0, height: true  },
    { id: 'kids',     name: 'Детская',        min: 1.0, max: 6,  def: 2.5, height: true  },
  ],
  body: [
    { id: 'kronospan', name: 'ЛДСП Kronospan', k: 1.00 },
    { id: 'egger',     name: 'ЛДСП Egger',     k: 1.12 },
    { id: 'mdf',       name: 'МДФ',            k: 1.30 },
  ],
  facade: [
    { id: 'ldsp',   name: 'ЛДСП',                k: 1.00 },
    { id: 'film',   name: 'МДФ в плёнке ПВХ',    k: 1.22 },
    { id: 'acryl',  name: 'Акрил, глянец',       k: 1.42 },
    { id: 'enamel', name: 'МДФ эмаль, матовая',  k: 1.58 },
    { id: 'veneer', name: 'Натуральный шпон',    k: 1.95 },
    { id: 'mirror', name: 'Зеркало / стекло',    k: 1.18 },
  ],
  fittings: [
    { id: 'standard', name: 'Стандарт', note: 'Турция, с доводчиками', k: 1.00 },
    { id: 'hettich',  name: 'Hettich',  note: 'Германия',             k: 1.10 },
    { id: 'blum',     name: 'Blum',     note: 'Австрия',              k: 1.20 },
  ],
  countertops: [
    { id: 'ldsp',    name: 'ЛДСП 38 мм',           k: 1.00 },
    { id: 'compact', name: 'Компакт-плита',        k: 1.10 },
    { id: 'acrylic', name: 'Искусственный камень', k: 1.18 },
    { id: 'quartz',  name: 'Кварц',                k: 1.25 },
  ],
  extras: [
    { id: 'drawers',    name: 'Выдвижные ящики',          qty: true, max: 20, def: 0 },
    { id: 'lifts',      name: 'Подъёмные механизмы',      qty: true, max: 12, def: 0 },
    { id: 'led',        name: 'LED-подсветка' },
    { id: 'push',       name: 'Push-to-open, без ручек' },
    { id: 'gola',       name: 'Профиль Gola', only: ['kitchen'] },
    { id: 'pantograph', name: 'Пантограф (штанга-лифт)',  qty: true, max: 4, def: 0, only: ['kupe', 'wardrobe', 'dressing'] },
  ],
  // границы классов проекта по произведению коэффициентов
  classes: [
    { max: 1.25, name: 'Стандарт', text: 'Надёжные материалы и фурнитура с доводчиками — оптимальное соотношение цены и качества.' },
    { max: 1.75, name: 'Комфорт',  text: 'Европейская фурнитура и улучшенные фасады — тише, плавнее, долговечнее.' },
    { max: 99,   name: 'Премиум',  text: 'Эмаль, шпон, Blum и продуманное наполнение — мебель уровня дизайнерских интерьеров.' },
  ],
};
