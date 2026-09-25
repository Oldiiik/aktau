// Presentation layer for kk / ru / en. Events are stored once, canonically;
// these templates render them. Critical facts — times, districts, house
// numbers, organisation names — are interpolated verbatim, never translated.
import type { Category, EventStatus, Lang, ServiceKey, ServiceState } from '@aktau/types'

type Dict = Record<string, string>
type Catalog = Record<Lang, Dict>

// ── Pluralisation ───────────────────────────────────────────────────────────
function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function ago(lang: Lang, from: Date | string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 60000))
  if (lang === 'en') {
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const h = Math.round(mins / 60)
    if (h < 24) return `${h} h ago`
    const d = Math.round(h / 24)
    return `${d} ${d === 1 ? 'day' : 'days'} ago`
  }
  if (lang === 'ru') {
    if (mins < 1) return 'только что'
    if (mins < 60) return `${mins} ${ruPlural(mins, 'минуту', 'минуты', 'минут')} назад`
    const h = Math.round(mins / 60)
    if (h < 24) return `${h} ${ruPlural(h, 'час', 'часа', 'часов')} назад`
    const d = Math.round(h / 24)
    return `${d} ${ruPlural(d, 'день', 'дня', 'дней')} назад`
  }
  if (mins < 1) return 'жаңа ғана'
  if (mins < 60) return `${mins} минут бұрын`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} сағат бұрын`
  return `${Math.round(h / 24)} күн бұрын`
}

/** Short "4m ago" form used in compact status rows. */
export function agoShort(lang: Lang, from: Date | string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 60000))
  const h = Math.round(mins / 60)
  if (lang === 'en') return mins < 1 ? 'now' : mins < 60 ? `${mins}m ago` : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
  if (lang === 'ru') return mins < 1 ? 'сейчас' : mins < 60 ? `${mins} мин назад` : h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`
  return mins < 1 ? 'қазір' : mins < 60 ? `${mins} мин бұрын` : h < 24 ? `${h} сағ бұрын` : `${Math.round(h / 24)} күн бұрын`
}

// ── Catalog ─────────────────────────────────────────────────────────────────
const C: Catalog = {
  en: {
    'app.name': 'Aktau',
    'nav.home': 'Home', 'nav.map': 'Map', 'nav.ask': 'Ask', 'nav.you': 'You',
    'greeting.morning': 'Good morning, Aktau', 'greeting.afternoon': 'Good afternoon, Aktau', 'greeting.evening': 'Good evening, Aktau', 'greeting.night': 'Good night, Aktau',
    'greeting.morning.name': 'Good morning, {name}', 'greeting.afternoon.name': 'Good afternoon, {name}', 'greeting.evening.name': 'Good evening, {name}', 'greeting.night.name': 'Good night, {name}',
    'loc.home': 'Home', 'loc.work': 'Work', 'loc.school': 'School', 'loc.hotel': 'Hotel', 'loc.custom': 'Place', 'loc.city': 'All of Aktau', 'loc.here': 'Near you',
    'now.label': 'Aktau now',
    'now.calm': 'Everything around you looks normal.',
    'now.calm.city': 'No confirmed disruptions in Aktau right now.',
    'now.affects.upcoming': '{n} upcoming change affects your home.',
    'now.affects.upcoming.many': '{n} upcoming changes affect your home.',
    'now.affects.active': 'A change near home.',
    'now.affects.activeCard': '{n} active change affects your home.',
    'now.affects.activeCard.many': '{n} active changes affect your home.',
    'now.nearby': 'Nothing affects your home. {n} notice nearby.',
    'now.nearby.many': 'Nothing affects your home. {n} notices nearby.',
    'now.unknown': 'We can’t confirm the current situation.',
    'now.backToNormal': 'Back to normal.',
    'updated': 'Updated {ago}',
    'updated.short': 'Updated {ago}',
    'service.water': 'Water', 'service.electricity': 'Electricity', 'service.heating': 'Heating', 'service.roads': 'Roads', 'service.transport': 'Transport',
    'state.NORMAL': 'Normal', 'state.PLANNED_ISSUE': '{n} notice', 'state.PLANNED_ISSUE.many': '{n} notices', 'state.DEGRADED': 'Limited', 'state.DISRUPTED': 'Interrupted', 'state.UNKNOWN': 'Not confirmed',
    'state.roads.PLANNED_ISSUE': '{n} restriction', 'state.roads.PLANNED_ISSUE.many': '{n} restrictions',
    'badge.ACTIVE': 'Active', 'badge.SCHEDULED': 'Planned', 'badge.DELAYED': 'Delayed', 'badge.DEGRADED': 'Limited', 'badge.RESOLVED': 'Resolved', 'badge.CANCELLED': 'Cancelled', 'badge.UNCONFIRMED': 'Not confirmed',
    'badge.affectsHome': 'Affects your home', 'badge.nearby': 'Nearby', 'badge.official': 'Official', 'badge.officialSource': 'Official source', 'badge.community': 'Community report', 'badge.unknown': 'Unknown', 'badge.notConfirmed': 'Not confirmed', 'badge.demo': 'DEMO', 'badge.modelled': 'Model estimate', 'badge.appAdvisory': 'Aktau app advisory',
    'event.WATER.planned_outage': 'Water interruption', 'event.WATER.emergency_outage': 'Water is unavailable', 'event.WATER.restoration': 'Water restored',
    'event.HOT_WATER.planned_outage': 'Hot water interruption', 'event.HOT_WATER.emergency_outage': 'Hot water is unavailable', 'event.HOT_WATER.restoration': 'Hot water restored',
    'event.ELECTRICITY.planned_outage': 'Electricity maintenance', 'event.ELECTRICITY.emergency_outage': 'Power outage', 'event.ELECTRICITY.restoration': 'Power restored',
    'event.HEATING.planned_outage': 'Heating interruption', 'event.HEATING.emergency_outage': 'Heating is unavailable', 'event.HEATING.restoration': 'Heating restored',
    'event.GAS.planned_outage': 'Gas supply interruption', 'event.GAS.emergency_outage': 'Gas supply interrupted', 'event.GAS.restoration': 'Gas supply restored',
    'event.ROAD.road_closure': 'Road closure', 'event.ROAD.road_works': 'Road works', 'event.ROAD': 'Road restriction',
    'event.TRANSPORT': 'Transport change', 'event.WEATHER': 'Weather advisory', 'event.WEATHER.wind_advisory': 'Strong coastal wind', 'event.WEATHER.heat_advisory': 'Extreme heat', 'event.WEATHER.rain_advisory': 'Heavy rain',
    'event.EMERGENCY': 'Emergency notice', 'event.EVENT': 'City event', 'event.OTHER': 'City notice', 'event.AIR_QUALITY': 'Air quality', 'event.CASPIAN': 'Caspian conditions',
    'when.tomorrow': 'tomorrow', 'when.today': 'today', 'when.tonight': 'tonight',
    'time.window': '{start}–{end}', 'time.from': 'From {start}', 'time.until': 'Until {end}',
    'eta.expected': 'Expected restoration · {time}', 'eta.unknown': 'Restoration time not announced.', 'eta.passed': 'Scheduled end ({time}) has passed, status not recently confirmed.',
    'freshness.stale': 'Status not recently confirmed.',
    'relevance.DIRECT': 'Affects your home', 'relevance.DIRECT.building': 'Affects your building', 'relevance.AREA': 'In your microdistrict', 'relevance.NEARBY': 'Near you',
    'scope.buildings': 'Houses {list}', 'scope.partial': 'Part of the area',
    'source.line': '{source} · {kind} · Updated {ago}', 'source.official': 'Official', 'source.reported': 'Reported by {publisher}',
    'history.title': 'Latest updates', 'history.estimate': 'Timing is an estimate from {source}.',
    'upd.CREATED': 'Notice published', 'upd.STATUS_CHANGED.ACTIVE': 'Interruption started', 'upd.STATUS_CHANGED.RESOLVED': 'Service restored', 'upd.STATUS_CHANGED.DELAYED': 'Running late', 'upd.STATUS_CHANGED.CANCELLED': 'Cancelled', 'upd.ETA_CHANGED': 'Estimate updated', 'upd.CONFIRMED': 'Confirmed by another source', 'upd.RESOLVED': 'Marked resolved', 'upd.CORRECTED': 'Corrected', 'upd.CONFLICT_NOTED': 'Conflicting report noted', 'upd.CANCELLED': 'Cancelled',
    'upd.eta': 'Restoration expected at {time}',
    'action.notify': 'Notify me about updates', 'action.notifyBefore': 'Notify me before it starts', 'action.viewInterruption': 'View interruption', 'action.viewHistory': 'View event history', 'action.details': 'Details', 'action.notifyMe': 'Notify me', 'action.tryAgain': 'Try again', 'action.showArea': 'Show the affected area', 'action.showMap': 'Show on map', 'action.viewSource': 'View source', 'action.save': 'Save preferences', 'action.personalize': 'Personalize Aktau', 'action.directions': 'Directions', 'action.savePlace': 'Save place', 'action.add': 'Add',
    'resolved.body': 'Service has resumed in your area.', 'resolved.confirmed': 'Confirmed {ago} · {source}', 'resolved.quiet': 'Aktau returns to its quiet state once the event is resolved.',
    'offline.title': 'You’re offline.', 'offline.last': 'Last confirmed at {time}.', 'offline.body': 'Showing saved information. Current conditions may have changed.', 'offline.saved': 'Saved places and earlier notices remain available.',
    'unknown.title': '{service} status unknown', 'unknown.body': 'The source is temporarily unavailable. We can’t confirm that service is normal.',
    'weather.wind': 'Wind {v} m/s', 'weather.forecast': 'Forecast · Open-Meteo', 'weather.observed': 'Observed {t}° at {time} · Kazhydromet',
    'around.title': 'Around you', 'around.placesOpen': '{n} places open around you', 'around.away': '{d} away', 'around.placesMap': 'Places nearby on the map',
    'ask.title': 'Ask Aktau', 'ask.subtitle': 'Real answers about your city.', 'ask.placeholder': 'Ask anything about Aktau…', 'ask.popular': 'Popular right now',
    'ask.q.water': 'Will I have water tomorrow?', 'ask.q.near': 'What’s happening near home?', 'ask.q.eat': 'Where can I eat after 11 PM?', 'ask.q.airport': 'How do I get to the airport?', 'ask.q.wind': 'How windy is it at the coast?', 'ask.q.weekend': 'What’s on this weekend?',
    'ask.no_info.utility': 'No confirmed information about a {service} interruption for your address has been found.',
    'ask.no_info.detail': 'That is not a guarantee of supply, it means no official notice we track mentions your address.',
    'ask.utility.no': 'Not between {start} and {end}.', 'ask.utility.no.point': 'No, a planned interruption affecting your building is scheduled from {start} to {end}.', 'ask.utility.no.open': 'Not from {start}.', 'ask.utility.no.now': 'Not right now.',
    'ask.utility.detail.planned': 'A planned interruption affects your home in {area}.', 'ask.utility.detail.active': 'An interruption is affecting your home in {area}. {eta}',
    'ask.utility.nearby': 'Your building isn’t listed, but there is a notice in {area}.',
    'ask.map.search': 'Search places, addresses, events', 'map.schematicNote': 'Map data © OpenStreetMap contributors',
    'event.reason': 'Reason', 'you.title': 'Your Aktau', 'you.atHome': 'At home in Aktau.', 'you.myPlaces': 'My places', 'you.noPlaces': 'Add work, a school or family, and notices there will reach you too.', 'you.alerts': 'Alerts', 'you.alerts.sub': 'Only what affects me', 'you.language': 'Language', 'you.appearance': 'Appearance', 'you.sources': 'Data sources', 'you.sources.sub': 'Official & community', 'you.sync': 'Make Aktau yours, everywhere.', 'you.sync.sub': 'Sync saved places across your devices.', 'you.signin': 'Sign in with Apple', 'you.noHome': 'Set your home to see what affects you.', 'you.setHome': 'Set home',
    'alerts.title': 'Only what matters.', 'alerts.subtitle': 'Choose what Aktau should tell you about.', 'alerts.water': 'Water', 'alerts.electricity': 'Electricity', 'alerts.heating': 'Heating & gas', 'alerts.road': 'Road closures', 'alerts.weather': 'Weather warnings', 'alerts.transport': 'Transport disruptions', 'alerts.events': 'Events nearby', 'alerts.onlyMe': 'Only when it affects me', 'alerts.onlyMe.body': 'Utility alerts are matched to your saved home. Essential city warnings stay on.',
    'appearance.system': 'System', 'appearance.light': 'Light', 'appearance.dark': 'Dark',
    'notif.PLANNED.title': '{what} {when}', 'notif.PLANNED.body': 'Your home is affected from {start}–{end}.', 'notif.PLANNED.body.open': 'Your home is affected from {start}.',
    'notif.STARTED.title': '{what} started', 'notif.STARTED.body': 'Your area is currently affected.',
    'notif.UPDATED.title': 'Restoration estimate changed', 'notif.UPDATED.body': 'Expected restoration is now {time}.',
    'notif.RESOLVED.title': '{what}', 'notif.RESOLVED.body': 'The interruption affecting your area is marked resolved.',
    'notif.CANCELLED.title': '{what} cancelled', 'notif.CANCELLED.body': 'The planned interruption for your area was cancelled.',
    'widget.calm': 'All clear near home',
    'inbox.title': 'Notifications', 'inbox.empty': 'Nothing yet. You’ll only hear about changes that affect your saved places.', 'widget.unknown': 'Status not confirmed',
    'lang.en': 'English', 'lang.ru': 'Русский', 'lang.kk': 'Қазақша',
  },
  ru: {
    'app.name': 'Актау',
    'nav.home': 'Главная', 'nav.map': 'Карта', 'nav.ask': 'Спросить', 'nav.you': 'Вы',
    'greeting.morning': 'Доброе утро, Актау', 'greeting.afternoon': 'Добрый день, Актау', 'greeting.evening': 'Добрый вечер, Актау', 'greeting.night': 'Доброй ночи, Актау',
    'greeting.morning.name': 'Доброе утро, {name}', 'greeting.afternoon.name': 'Добрый день, {name}', 'greeting.evening.name': 'Добрый вечер, {name}', 'greeting.night.name': 'Доброй ночи, {name}',
    'loc.home': 'Дом', 'loc.work': 'Работа', 'loc.school': 'Школа', 'loc.hotel': 'Отель', 'loc.custom': 'Место', 'loc.city': 'Весь Актау', 'loc.here': 'Рядом с вами',
    'now.label': 'Актау сейчас',
    'now.calm': 'Рядом с вами всё в порядке.',
    'now.calm.city': 'Подтверждённых отключений в Актау сейчас нет.',
    'now.affects.upcoming': '{n} предстоящее изменение касается вашего дома.',
    'now.affects.upcoming.many': 'Предстоящих изменений для вашего дома: {n}.',
    'now.affects.active': 'Изменение рядом с домом.',
    'now.affects.activeCard': 'Сейчас действует {n} изменение для вашего дома.',
    'now.affects.activeCard.many': 'Сейчас действуют изменения для вашего дома: {n}.',
    'now.nearby': 'Ваш дом не затронут. Рядом: {n}.',
    'now.nearby.many': 'Ваш дом не затронут. Рядом: {n}.',
    'now.unknown': 'Мы не можем подтвердить текущую ситуацию.',
    'now.backToNormal': 'Всё снова в норме.',
    'updated': 'Обновлено {ago}',
    'updated.short': 'Обновлено {ago}',
    'service.water': 'Вода', 'service.electricity': 'Электричество', 'service.heating': 'Отопление', 'service.roads': 'Дороги', 'service.transport': 'Транспорт',
    'state.NORMAL': 'В норме', 'state.PLANNED_ISSUE': '{n} уведомление', 'state.PLANNED_ISSUE.many': 'Уведомлений: {n}', 'state.DEGRADED': 'Ограничено', 'state.DISRUPTED': 'Отключено', 'state.UNKNOWN': 'Не подтверждено',
    'state.roads.PLANNED_ISSUE': '{n} ограничение', 'state.roads.PLANNED_ISSUE.many': 'Ограничений: {n}',
    'badge.ACTIVE': 'Сейчас', 'badge.SCHEDULED': 'Плановое', 'badge.DELAYED': 'Задержка', 'badge.DEGRADED': 'Ограничено', 'badge.RESOLVED': 'Завершено', 'badge.CANCELLED': 'Отменено', 'badge.UNCONFIRMED': 'Не подтверждено',
    'badge.affectsHome': 'Касается вашего дома', 'badge.nearby': 'Рядом', 'badge.official': 'Официально', 'badge.officialSource': 'Официальный источник', 'badge.community': 'Сообщение жителей', 'badge.unknown': 'Неизвестно', 'badge.notConfirmed': 'Не подтверждено', 'badge.demo': 'Демо', 'badge.modelled': 'Модельная оценка', 'badge.appAdvisory': 'Рекомендация Aktau',
    'event.WATER.planned_outage': 'Отключение воды', 'event.WATER.emergency_outage': 'Нет воды', 'event.WATER.restoration': 'Подача воды восстановлена',
    'event.HOT_WATER.planned_outage': 'Отключение горячей воды', 'event.HOT_WATER.emergency_outage': 'Нет горячей воды', 'event.HOT_WATER.restoration': 'Горячая вода восстановлена',
    'event.ELECTRICITY.planned_outage': 'Плановое отключение света', 'event.ELECTRICITY.emergency_outage': 'Нет электричества', 'event.ELECTRICITY.restoration': 'Свет восстановлен',
    'event.HEATING.planned_outage': 'Отключение отопления', 'event.HEATING.emergency_outage': 'Нет отопления', 'event.HEATING.restoration': 'Отопление восстановлено',
    'event.GAS.planned_outage': 'Отключение газа', 'event.GAS.emergency_outage': 'Подача газа прекращена', 'event.GAS.restoration': 'Подача газа восстановлена',
    'event.ROAD.road_closure': 'Перекрытие дороги', 'event.ROAD.road_works': 'Дорожные работы', 'event.ROAD': 'Ограничение движения',
    'event.TRANSPORT': 'Изменение транспорта', 'event.WEATHER': 'Погодное предупреждение', 'event.WEATHER.wind_advisory': 'Сильный ветер на побережье', 'event.WEATHER.heat_advisory': 'Сильная жара', 'event.WEATHER.rain_advisory': 'Сильный дождь',
    'event.EMERGENCY': 'Экстренное сообщение', 'event.EVENT': 'Городское событие', 'event.OTHER': 'Городское уведомление', 'event.AIR_QUALITY': 'Качество воздуха', 'event.CASPIAN': 'Состояние Каспия',
    'when.tomorrow': 'завтра', 'when.today': 'сегодня', 'when.tonight': 'сегодня ночью',
    'time.window': '{start}–{end}', 'time.from': 'С {start}', 'time.until': 'До {end}',
    'eta.expected': 'Ожидаемое восстановление · {time}', 'eta.unknown': 'Время восстановления не объявлено.', 'eta.passed': 'Плановое окончание ({time}) прошло — статус давно не подтверждался.',
    'freshness.stale': 'Статус давно не подтверждался.',
    'relevance.DIRECT': 'Касается вашего дома', 'relevance.DIRECT.building': 'Касается вашего дома', 'relevance.AREA': 'В вашем микрорайоне', 'relevance.NEARBY': 'Рядом с вами',
    'scope.buildings': 'Дома {list}', 'scope.partial': 'Часть района',
    'source.line': '{source} · {kind} · Обновлено {ago}', 'source.official': 'Официально', 'source.reported': 'Сообщает {publisher}',
    'history.title': 'Последние обновления', 'history.estimate': 'Время — оценка {source}.',
    'upd.CREATED': 'Опубликовано уведомление', 'upd.STATUS_CHANGED.ACTIVE': 'Отключение началось', 'upd.STATUS_CHANGED.RESOLVED': 'Подача восстановлена', 'upd.STATUS_CHANGED.DELAYED': 'Задерживается', 'upd.STATUS_CHANGED.CANCELLED': 'Отменено', 'upd.ETA_CHANGED': 'Прогноз обновлён', 'upd.CONFIRMED': 'Подтверждено другим источником', 'upd.RESOLVED': 'Отмечено как завершённое', 'upd.CORRECTED': 'Исправлено', 'upd.CONFLICT_NOTED': 'Получено противоречивое сообщение', 'upd.CANCELLED': 'Отменено',
    'upd.eta': 'Восстановление ожидается в {time}',
    'action.notify': 'Сообщать об изменениях', 'action.notifyBefore': 'Напомнить до начала', 'action.viewInterruption': 'Подробнее об отключении', 'action.viewHistory': 'История события', 'action.details': 'Подробнее', 'action.notifyMe': 'Уведомить', 'action.tryAgain': 'Повторить', 'action.showArea': 'Показать на карте', 'action.showMap': 'На карте', 'action.viewSource': 'Источник', 'action.save': 'Сохранить', 'action.personalize': 'Настроить Актау', 'action.directions': 'Маршрут', 'action.savePlace': 'Сохранить', 'action.add': 'Добавить',
    'resolved.body': 'Подача в вашем районе возобновлена.', 'resolved.confirmed': 'Подтверждено {ago} · {source}', 'resolved.quiet': 'После завершения события Актау возвращается в спокойный режим.',
    'offline.title': 'Нет подключения.', 'offline.last': 'Последнее подтверждение в {time}.', 'offline.body': 'Показаны сохранённые данные. Ситуация могла измениться.', 'offline.saved': 'Сохранённые места и прежние уведомления доступны.',
    'unknown.title': '{service}: статус неизвестен', 'unknown.body': 'Источник временно недоступен. Мы не можем подтвердить, что всё в норме.',
    'weather.wind': 'Ветер {v} м/с', 'weather.forecast': 'Прогноз · Open-Meteo', 'weather.observed': 'Наблюдение {t}° в {time} · Казгидромет',
    'around.title': 'Вокруг вас', 'around.placesOpen': 'Рядом открыто мест: {n}', 'around.away': '{d} от вас', 'around.placesMap': 'Места рядом на карте',
    'ask.title': 'Спросить Актау', 'ask.subtitle': 'Точные ответы о вашем городе.', 'ask.placeholder': 'Спросите что угодно об Актау…', 'ask.popular': 'Сейчас спрашивают',
    'ask.q.water': 'Будет ли завтра вода?', 'ask.q.near': 'Что происходит рядом с домом?', 'ask.q.eat': 'Где поесть после 23:00?', 'ask.q.airport': 'Как добраться до аэропорта?', 'ask.q.wind': 'Какой ветер на побережье?', 'ask.q.weekend': 'Что будет на выходных?',
    'ask.no_info.utility': 'Подтверждённой информации об отключении ({service}) по вашему адресу не найдено.',
    'ask.no_info.detail': 'Это не гарантия подачи — просто ни одно отслеживаемое официальное уведомление не упоминает ваш адрес.',
    'ask.utility.no': 'Нет, с {start} до {end}.', 'ask.utility.no.point': 'Нет — на это время запланировано отключение, затрагивающее ваш дом: с {start} до {end}.', 'ask.utility.no.open': 'Нет, с {start}.', 'ask.utility.no.now': 'Сейчас — нет.',
    'ask.utility.detail.planned': 'Плановое отключение касается вашего дома ({area}).', 'ask.utility.detail.active': 'Отключение затрагивает ваш дом ({area}). {eta}',
    'ask.utility.nearby': 'Ваш дом не указан, но есть уведомление по {area}.',
    'ask.map.search': 'Места, адреса, события', 'map.schematicNote': 'Данные карты © участники OpenStreetMap',
    'event.reason': 'Причина', 'you.title': 'Ваш Актау', 'you.atHome': 'Дома в Актау.', 'you.myPlaces': 'Мои места', 'you.noPlaces': 'Добавьте работу, школу или родных — сообщения рядом с ними тоже дойдут до вас.', 'you.alerts': 'Уведомления', 'you.alerts.sub': 'Только то, что касается меня', 'you.language': 'Язык', 'you.appearance': 'Оформление', 'you.sources': 'Источники данных', 'you.sources.sub': 'Официальные и от жителей', 'you.sync': 'Ваш Актау на всех устройствах.', 'you.sync.sub': 'Синхронизируйте сохранённые места.', 'you.signin': 'Войти через Apple', 'you.noHome': 'Укажите дом, чтобы видеть, что вас касается.', 'you.setHome': 'Указать дом',
    'alerts.title': 'Только важное.', 'alerts.subtitle': 'Выберите, о чём сообщать.', 'alerts.water': 'Вода', 'alerts.electricity': 'Электричество', 'alerts.heating': 'Отопление и газ', 'alerts.road': 'Перекрытия дорог', 'alerts.weather': 'Погодные предупреждения', 'alerts.transport': 'Транспорт', 'alerts.events': 'События рядом', 'alerts.onlyMe': 'Только если касается меня', 'alerts.onlyMe.body': 'Коммунальные уведомления сопоставляются с вашим домом. Важные городские предупреждения остаются включены.',
    'appearance.system': 'Системное', 'appearance.light': 'Светлое', 'appearance.dark': 'Тёмное',
    'notif.PLANNED.title': '{what} {when}', 'notif.PLANNED.body': 'Затрагивает ваш дом с {start} до {end}.', 'notif.PLANNED.body.open': 'Затрагивает ваш дом с {start}.',
    'notif.STARTED.title': '{what}: началось', 'notif.STARTED.body': 'Сейчас затронут ваш район.',
    'notif.UPDATED.title': 'Прогноз восстановления изменился', 'notif.UPDATED.body': 'Восстановление ожидается в {time}.',
    'notif.RESOLVED.title': '{what}', 'notif.RESOLVED.body': 'Отключение в вашем районе отмечено как завершённое.',
    'notif.CANCELLED.title': '{what}: отменено', 'notif.CANCELLED.body': 'Плановое отключение для вашего района отменено.',
    'widget.calm': 'Рядом с домом всё спокойно',
    'inbox.title': 'Уведомления', 'inbox.empty': 'Пока ничего. Мы сообщаем только об изменениях, которые касаются ваших мест.', 'widget.unknown': 'Статус не подтверждён',
    'lang.en': 'English', 'lang.ru': 'Русский', 'lang.kk': 'Қазақша',
  },
  kk: {
    'app.name': 'Ақтау',
    'nav.home': 'Басты', 'nav.map': 'Карта', 'nav.ask': 'Сұрау', 'nav.you': 'Сіз',
    'greeting.morning': 'Қайырлы таң, Ақтау', 'greeting.afternoon': 'Қайырлы күн, Ақтау', 'greeting.evening': 'Қайырлы кеш, Ақтау', 'greeting.night': 'Қайырлы түн, Ақтау',
    'greeting.morning.name': 'Қайырлы таң, {name}', 'greeting.afternoon.name': 'Қайырлы күн, {name}', 'greeting.evening.name': 'Қайырлы кеш, {name}', 'greeting.night.name': 'Қайырлы түн, {name}',
    'loc.home': 'Үй', 'loc.work': 'Жұмыс', 'loc.school': 'Мектеп', 'loc.hotel': 'Қонақүй', 'loc.custom': 'Орын', 'loc.city': 'Бүкіл Ақтау', 'loc.here': 'Жаныңызда',
    'now.label': 'Қазір Ақтауда',
    'now.calm': 'Айналаңызда бәрі қалыпты.',
    'now.calm.city': 'Қазір Ақтауда расталған ақаулар жоқ.',
    'now.affects.upcoming': 'Алдағы {n} өзгеріс үйіңізге қатысты.',
    'now.affects.upcoming.many': 'Алдағы {n} өзгеріс үйіңізге қатысты.',
    'now.affects.active': 'Үйдің жанында өзгеріс бар.',
    'now.affects.activeCard': 'Қазір {n} өзгеріс үйіңізге қатысты.',
    'now.nearby': 'Үйіңізге қатысы жоқ. Жақын маңда: {n}.',
    'now.nearby.many': 'Үйіңізге қатысы жоқ. Жақын маңда: {n}.',
    'now.unknown': 'Қазіргі жағдайды растай алмаймыз.',
    'now.backToNormal': 'Бәрі қалпына келді.',
    'updated': '{ago} жаңартылды',
    'updated.short': '{ago} жаңартылды',
    'service.water': 'Су', 'service.electricity': 'Электр қуаты', 'service.heating': 'Жылу', 'service.roads': 'Жолдар', 'service.transport': 'Көлік',
    'state.NORMAL': 'Қалыпты', 'state.PLANNED_ISSUE': '{n} хабарлама', 'state.PLANNED_ISSUE.many': '{n} хабарлама', 'state.DEGRADED': 'Шектеулі', 'state.DISRUPTED': 'Өшірілген', 'state.UNKNOWN': 'Расталмаған',
    'state.roads.PLANNED_ISSUE': '{n} шектеу', 'state.roads.PLANNED_ISSUE.many': '{n} шектеу',
    'badge.ACTIVE': 'Қазір', 'badge.SCHEDULED': 'Жоспарлы', 'badge.DELAYED': 'Кешігу', 'badge.DEGRADED': 'Шектеулі', 'badge.RESOLVED': 'Аяқталды', 'badge.CANCELLED': 'Тоқтатылды', 'badge.UNCONFIRMED': 'Расталмаған',
    'badge.affectsHome': 'Үйіңізге қатысты', 'badge.nearby': 'Жақын', 'badge.official': 'Ресми', 'badge.officialSource': 'Ресми дереккөз', 'badge.community': 'Тұрғындар хабары', 'badge.unknown': 'Белгісіз', 'badge.notConfirmed': 'Расталмаған', 'badge.demo': 'Демо', 'badge.modelled': 'Модельдік бағалау', 'badge.appAdvisory': 'Aktau ұсынысы',
    'event.WATER.planned_outage': 'Су өшіріледі', 'event.WATER.emergency_outage': 'Су жоқ', 'event.WATER.restoration': 'Су берілді',
    'event.HOT_WATER.planned_outage': 'Ыстық су өшіріледі', 'event.HOT_WATER.emergency_outage': 'Ыстық су жоқ', 'event.HOT_WATER.restoration': 'Ыстық су берілді',
    'event.ELECTRICITY.planned_outage': 'Электр жарығы жоспарлы өшіріледі', 'event.ELECTRICITY.emergency_outage': 'Электр жарығы жоқ', 'event.ELECTRICITY.restoration': 'Электр жарығы берілді',
    'event.HEATING.planned_outage': 'Жылу өшіріледі', 'event.HEATING.emergency_outage': 'Жылу жоқ', 'event.HEATING.restoration': 'Жылу берілді',
    'event.GAS.planned_outage': 'Газ өшіріледі', 'event.GAS.emergency_outage': 'Газ берілмейді', 'event.GAS.restoration': 'Газ берілді',
    'event.ROAD.road_closure': 'Жол жабылады', 'event.ROAD.road_works': 'Жол жұмыстары', 'event.ROAD': 'Қозғалыс шектеуі',
    'event.TRANSPORT': 'Көлік өзгерісі', 'event.WEATHER': 'Ауа райы ескертуі', 'event.WEATHER.wind_advisory': 'Жағалауда қатты жел', 'event.WEATHER.heat_advisory': 'Қатты аптап', 'event.WEATHER.rain_advisory': 'Қатты жаңбыр',
    'event.EMERGENCY': 'Шұғыл хабарлама', 'event.EVENT': 'Қала іс-шарасы', 'event.OTHER': 'Қала хабарламасы', 'event.AIR_QUALITY': 'Ауа сапасы', 'event.CASPIAN': 'Каспий жағдайы',
    'when.tomorrow': 'ертең', 'when.today': 'бүгін', 'when.tonight': 'бүгін түнде',
    'time.window': '{start}–{end}', 'time.from': '{start} бастап', 'time.until': '{end} дейін',
    'eta.expected': 'Қалпына келтіру · {time}', 'eta.unknown': 'Қалпына келтіру уақыты жарияланбаған.', 'eta.passed': 'Жоспарлы аяқталу ({time}) өтті — мәртебе ұзақ уақыт расталмаған.',
    'freshness.stale': 'Мәртебе ұзақ уақыт расталмаған.',
    'relevance.DIRECT': 'Үйіңізге қатысты', 'relevance.DIRECT.building': 'Үйіңізге қатысты', 'relevance.AREA': 'Шағын ауданыңызда', 'relevance.NEARBY': 'Жаныңызда',
    'scope.buildings': '{list} үйлер', 'scope.partial': 'Аумақтың бір бөлігі',
    'source.line': '{source} · {kind} · {ago} жаңартылды', 'source.official': 'Ресми', 'source.reported': 'Хабарлаған: {publisher}',
    'history.title': 'Соңғы жаңартулар', 'history.estimate': 'Уақыт — {source} бағалауы.',
    'upd.CREATED': 'Хабарлама жарияланды', 'upd.STATUS_CHANGED.ACTIVE': 'Өшіру басталды', 'upd.STATUS_CHANGED.RESOLVED': 'Қалпына келтірілді', 'upd.STATUS_CHANGED.DELAYED': 'Кешігуде', 'upd.STATUS_CHANGED.CANCELLED': 'Тоқтатылды', 'upd.ETA_CHANGED': 'Болжам жаңартылды', 'upd.CONFIRMED': 'Басқа дереккөз растады', 'upd.RESOLVED': 'Аяқталды деп белгіленді', 'upd.CORRECTED': 'Түзетілді', 'upd.CONFLICT_NOTED': 'Қайшы хабар тіркелді', 'upd.CANCELLED': 'Тоқтатылды',
    'upd.eta': 'Қалпына келтіру {time} күтіледі',
    'action.notify': 'Жаңартулар туралы хабарлау', 'action.notifyBefore': 'Басталар алдында ескерту', 'action.viewInterruption': 'Толығырақ', 'action.viewHistory': 'Оқиға тарихы', 'action.details': 'Толығырақ', 'action.notifyMe': 'Хабарлау', 'action.tryAgain': 'Қайталау', 'action.showArea': 'Картадан көрсету', 'action.showMap': 'Картада', 'action.viewSource': 'Дереккөз', 'action.save': 'Сақтау', 'action.personalize': 'Ақтауды баптау', 'action.directions': 'Бағыт', 'action.savePlace': 'Сақтау', 'action.add': 'Қосу',
    'resolved.body': 'Ауданыңызда қызмет қайта басталды.', 'resolved.confirmed': '{ago} расталды · {source}', 'resolved.quiet': 'Оқиға аяқталғанда Ақтау тыныш режимге оралады.',
    'offline.title': 'Байланыс жоқ.', 'offline.last': 'Соңғы растау: {time}.', 'offline.body': 'Сақталған ақпарат көрсетілуде. Жағдай өзгеруі мүмкін.', 'offline.saved': 'Сақталған орындар мен бұрынғы хабарламалар қолжетімді.',
    'unknown.title': '{service}: мәртебесі белгісіз', 'unknown.body': 'Дереккөз уақытша қолжетімсіз. Қызметтің қалыпты екенін растай алмаймыз.',
    'weather.wind': 'Жел {v} м/с', 'weather.forecast': 'Болжам · Open-Meteo', 'weather.observed': '{time} кезінде {t}° · Қазгидромет',
    'around.title': 'Айналаңызда', 'around.placesOpen': 'Жақын маңда {n} орын ашық', 'around.away': '{d} жерде', 'around.placesMap': 'Жақын орындар картада',
    'ask.title': 'Ақтаудан сұраңыз', 'ask.subtitle': 'Қалаңыз туралы нақты жауаптар.', 'ask.placeholder': 'Ақтау туралы кез келген сұрақ…', 'ask.popular': 'Қазір жиі сұралатын',
    'ask.q.water': 'Ертең су бола ма?', 'ask.q.near': 'Үйдің жанында не болып жатыр?', 'ask.q.eat': '23:00-ден кейін қайда тамақтануға болады?', 'ask.q.airport': 'Әуежайға қалай жетемін?', 'ask.q.wind': 'Жағалауда жел қандай?', 'ask.q.weekend': 'Демалыста не бар?',
    'ask.no_info.utility': 'Мекенжайыңыз бойынша ({service}) өшіру туралы расталған ақпарат табылмады.',
    'ask.no_info.detail': 'Бұл кепілдік емес — біз бақылайтын ресми хабарламалардың ешқайсысы мекенжайыңызды атамайды.',
    'ask.utility.no': 'Жоқ, {start}–{end} аралығында.', 'ask.utility.no.point': 'Жоқ — үйіңізге қатысты жоспарлы өшіру {start}–{end} аралығында болады.', 'ask.utility.no.open': 'Жоқ, {start} бастап.', 'ask.utility.no.now': 'Қазір — жоқ.',
    'ask.utility.detail.planned': 'Жоспарлы өшіру үйіңізге қатысты ({area}).', 'ask.utility.detail.active': 'Өшіру үйіңізге қатысты ({area}). {eta}',
    'ask.utility.nearby': 'Үйіңіз аталмаған, бірақ {area} бойынша хабарлама бар.',
    'ask.map.search': 'Орындар, мекенжайлар, оқиғалар', 'map.schematicNote': 'Карта деректері © OpenStreetMap қатысушылары',
    'event.reason': 'Себебі', 'you.title': 'Сіздің Ақтау', 'you.atHome': 'Ақтаудағы үйіңіз.', 'you.myPlaces': 'Менің орындарым', 'you.noPlaces': 'Жұмысты, мектепті не туыстарды қосыңыз — олардың маңындағы хабарлар да сізге жетеді.', 'you.alerts': 'Хабарламалар', 'you.alerts.sub': 'Тек маған қатыстысы', 'you.language': 'Тіл', 'you.appearance': 'Көрініс', 'you.sources': 'Дереккөздер', 'you.sources.sub': 'Ресми және тұрғындар', 'you.sync': 'Ақтау барлық құрылғыда.', 'you.sync.sub': 'Сақталған орындарды синхрондаңыз.', 'you.signin': 'Apple арқылы кіру', 'you.noHome': 'Сізге не қатысты екенін көру үшін үйіңізді көрсетіңіз.', 'you.setHome': 'Үйді көрсету',
    'alerts.title': 'Тек маңыздысы.', 'alerts.subtitle': 'Ақтау не туралы хабарлайтынын таңдаңыз.', 'alerts.water': 'Су', 'alerts.electricity': 'Электр қуаты', 'alerts.heating': 'Жылу және газ', 'alerts.road': 'Жол жабылуы', 'alerts.weather': 'Ауа райы ескертулері', 'alerts.transport': 'Көлік', 'alerts.events': 'Жақын іс-шаралар', 'alerts.onlyMe': 'Тек маған қатысты болса', 'alerts.onlyMe.body': 'Коммуналдық хабарламалар үйіңізбен салыстырылады. Маңызды қалалық ескертулер қосулы қалады.',
    'appearance.system': 'Жүйелік', 'appearance.light': 'Ашық', 'appearance.dark': 'Қараңғы',
    'notif.PLANNED.title': '{what} · {when}', 'notif.PLANNED.body': 'Үйіңізге {start}–{end} аралығында қатысты.', 'notif.PLANNED.body.open': 'Үйіңізге {start} бастап қатысты.',
    'notif.STARTED.title': '{what}: басталды', 'notif.STARTED.body': 'Қазір ауданыңызға қатысты.',
    'notif.UPDATED.title': 'Қалпына келтіру болжамы өзгерді', 'notif.UPDATED.body': 'Енді {time} күтіледі.',
    'notif.RESOLVED.title': '{what}', 'notif.RESOLVED.body': 'Ауданыңыздағы өшіру аяқталды деп белгіленді.',
    'notif.CANCELLED.title': '{what}: тоқтатылды', 'notif.CANCELLED.body': 'Ауданыңыздағы жоспарлы өшіру болмайды.',
    'widget.calm': 'Үй маңында тыныш',
    'inbox.title': 'Хабарламалар', 'inbox.empty': 'Әзірге ештеңе жоқ. Тек сақталған орындарыңызға қатысты өзгерістер туралы хабарлаймыз.', 'widget.unknown': 'Мәртебе расталмаған',
    'lang.en': 'English', 'lang.ru': 'Русский', 'lang.kk': 'Қазақша',
  },
}

export function t(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const count = typeof params.n === 'number' ? params.n : undefined
  const pluralKey = count !== undefined && count !== 1 && C[lang][`${key}.many`] ? `${key}.many` : key
  const raw = C[lang][pluralKey] ?? C.en[pluralKey] ?? C[lang][key] ?? C.en[key] ?? key
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
}

export function has(lang: Lang, key: string): boolean {
  return key in C[lang] || key in C.en
}

export function eventHeadline(lang: Lang, e: { category: Category; event_type: string; status?: EventStatus }): string {
  const type = e.status === 'RESOLVED' && ['planned_outage', 'emergency_outage'].includes(e.event_type) ? 'restoration' : e.event_type
  const specific = `event.${e.category}.${type}`
  if (has(lang, specific)) return t(lang, specific)
  if (has(lang, `event.${e.category}`)) return t(lang, `event.${e.category}`)
  if (has(lang, `event.${e.category}.planned_outage`)) return t(lang, `event.${e.category}.planned_outage`)
  return t(lang, 'event.OTHER')
}

export function serviceLabel(lang: Lang, key: ServiceKey): string {
  return t(lang, `service.${key}`)
}

export function serviceStateLabel(lang: Lang, key: ServiceKey, state: ServiceState, n: number): string {
  if (state === 'PLANNED_ISSUE' && key === 'roads') return t(lang, 'state.roads.PLANNED_ISSUE', { n })
  return t(lang, `state.${state}`, { n })
}

export function greetingKey(date: Date): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Aqtau', hour: 'numeric', hourCycle: 'h23' }).format(date))
  return h < 5 ? 'greeting.night' : h < 12 ? 'greeting.morning' : h < 18 ? 'greeting.afternoon' : h < 23 ? 'greeting.evening' : 'greeting.night'
}

/** "14 microdistrict" / "14-й микрорайон" / "14-шағын аудан" from area names. */
export function areaName(lang: Lang, a: { name: string; name_ru?: string | null; name_kk?: string | null; name_en?: string | null }): string {
  if (lang === 'ru') return a.name_ru ?? a.name
  if (lang === 'kk') return a.name_kk ?? a.name
  return a.name_en ?? a.name
}

/** Compact district designator for dense UI: '14 mkr' / '14 мкр' / '14 ш/а'. */
export function areaShort(lang: Lang, designator: string | null, fallback: string): string {
  if (!designator) return fallback
  if (!/^\d/.test(designator)) return fallback
  return lang === 'en' ? `${designator} mkr` : lang === 'ru' ? `${designator} мкр` : `${designator} ш/а`
}

export const LANG_NAMES: Record<Lang, string> = { en: 'English', ru: 'Русский', kk: 'Қазақша' }
