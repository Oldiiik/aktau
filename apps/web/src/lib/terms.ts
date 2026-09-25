// The responsibility graph (city-core) names organisations, systems and reasons
// in English. Residents read them in Russian or Kazakh; this table translates at
// display time so the routing logic keeps one canonical vocabulary.
import type { Lang } from '@aktau/types'

type T = { ru: string; kk?: string }
const TERMS: Record<string, T> = {
  'KZhSA · Kaspiy Zhylu Su Arnasy': { ru: 'КЖСА · Каспий Жылу Су Арнасы', kk: 'КЖСА · Каспий Жылу Су Арнасы' },
  'MAEK-Kazatomprom': { ru: 'МАЭК-Казатомпром', kk: 'МАЭК-Қазатомөнеркәсіп' },
  'AUES · city power networks': { ru: 'АУЭС · городские электросети', kk: 'АУЭС · қалалық электр желілері' },
  'Building OSI / KSK': { ru: 'ОСИ / КСК дома', kk: 'Үйдің ПИБ / ПИК' },
  'Street lighting contractor': { ru: 'Подрядчик по уличному освещению', kk: 'Көше жарығы мердігері' },
  'Waste collection operator': { ru: 'Оператор вывоза мусора', kk: 'Қоқыс шығару операторы' },
  'Dept. of Passenger Transport & Roads': { ru: 'Отдел пассажирского транспорта и дорог', kk: 'Жолаушылар көлігі және жолдар бөлімі' },
  'Akimat · Housing & Utilities Dept.': { ru: 'Акимат · отдел ЖКХ', kk: 'Әкімдік · ТКШ бөлімі' },
  'QazaqGaz Aimaq · gas emergency 104': { ru: 'QazaqGaz Aimaq · аварийная газовая служба 104', kk: 'QazaqGaz Aimaq · газ апат қызметі 104' },
  'Police · 102': { ru: 'Полиция · 102', kk: 'Полиция · 102' },
  'Emergency Dept. · 112': { ru: 'ДЧС · 112', kk: 'ТЖД · 112' },
  'Elevator service company': { ru: 'Лифтовая сервисная компания', kk: 'Лифт қызметі компаниясы' },
  'Akimat · Landscaping': { ru: 'Акимат · благоустройство', kk: 'Әкімдік · абаттандыру' },
  'Aktau Akimat': { ru: 'Акимат Актау', kk: 'Ақтау әкімдігі' },
  'Aktau Akimat or OSI': { ru: 'Акимат Актау или ОСИ', kk: 'Ақтау әкімдігі немесе ПИБ' },
  'Location to confirm': { ru: 'Адрес уточняется', kk: 'Мекенжай нақтылануда' },
  'Sewer network': { ru: 'Канализационная сеть', kk: 'Кәріз желісі' },
  'Cold water distribution network': { ru: 'Распределительная сеть холодной воды', kk: 'Суық су тарату желісі' },
  'In-building pipes': { ru: 'Внутридомовые трубы', kk: 'Үй ішіндегі құбырлар' },
  'Apartment owners (common property)': { ru: 'Собственники квартир (общее имущество)', kk: 'Пәтер иелері (ортақ мүлік)' },
  'District heat network': { ru: 'Тепловая сеть района', kk: 'Аудандық жылу желісі' },
  'Internal heating system': { ru: 'Внутренняя система отопления', kk: 'Ішкі жылыту жүйесі' },
  'Current maintenance contractor': { ru: 'Текущий обслуживающий подрядчик', kk: 'Қазіргі қызмет көрсету мердігері' },
  '0.4–10 kV distribution network': { ru: 'Распределительная сеть 0,4–10 кВ', kk: '0,4–10 кВ тарату желісі' },
  'Building switchboard & risers': { ru: 'Щитовая и стояки дома', kk: 'Үйдің қалқаны мен тіреулері' },
  'Street & yard lighting': { ru: 'Уличное и дворовое освещение', kk: 'Көше және аула жарығы' },
  'Container site': { ru: 'Контейнерная площадка', kk: 'Контейнер алаңы' },
  'Road surface & traffic calming': { ru: 'Дорожное покрытие и лежачие полицейские', kk: 'Жол жабыны' },
  'Public transport network': { ru: 'Сеть общественного транспорта', kk: 'Қоғамдық көлік желісі' },
  'Elevator': { ru: 'Лифт', kk: 'Лифт' },
  'Gas distribution': { ru: 'Газораспределение', kk: 'Газ тарату' },
  'Facade & external units': { ru: 'Фасад и внешние блоки', kk: 'Қасбет және сыртқы блоктар' },
  'Owner of the unit / apartment owners': { ru: 'Владелец блока / собственники квартир', kk: 'Блок иесі / пәтер иелері' },
  'Yard / public green space': { ru: 'Двор / общественное озеленение', kk: 'Аула / қоғамдық көгалдандыру' },
  // notes
  'upstream if the whole district is dry': { ru: 'выше по сети, если без воды весь район', kk: 'бүкіл ауданда су болмаса, жоғары желі' },
  'from the OSI contract register': { ru: 'из реестра договоров ОСИ', kk: 'ПИБ келісімшарт тізілімінен' },
  'if the input cable is dead': { ru: 'если нет напряжения на вводе', kk: 'кіріс кабелінде кернеу болмаса' },
  'per the current maintenance contract': { ru: 'по текущему договору обслуживания', kk: 'қазіргі қызмет көрсету келісімшарты бойынша' },
  'imminent danger to passers-by': { ru: 'прямая опасность для прохожих', kk: 'өтіп бара жатқандарға тікелей қауіп' },
  'imminent danger': { ru: 'прямая опасность', kk: 'тікелей қауіп' },
  // routing notes
  'Several residents affected → distribution network, not in-building pipes.': { ru: 'Затронуто несколько жителей → распределительная сеть, а не трубы в доме.' },
  'No house given — assuming the district network.': { ru: 'Дом не указан, предполагаем сеть района.' },
  'A leak outside the building → the street network.': { ru: 'Течь снаружи дома → уличная сеть.', kk: 'Үйдің сыртындағы ағу → көше желісі.' },
  'Demo session: the organiser at the venue is responsible.': { ru: 'Демо-сессия: отвечает организатор площадки.', kk: 'Демо-сессия: алаң ұйымдастырушысы жауапты.' },
  'One apartment affected → likely in-building pipes. Ask whether neighbours have water.': { ru: 'Затронута одна квартира → вероятно, трубы в доме. Уточните, есть ли вода у соседей.' },
  'Heat network serves the whole block.': { ru: 'Тепловая сеть обслуживает весь квартал.' },
  'Single building → internal heating system of the house.': { ru: 'Один дом → внутренняя система отопления.' },
  'Several homes without power → distribution network / substation.': { ru: 'Несколько домов без света → распределительная сеть или подстанция.' },
  'Only one apartment → check the building switchboard first.': { ru: 'Только одна квартира → сначала проверьте щитовую дома.' },
  'Outdoor lighting is municipal property maintained under contract.': { ru: 'Уличное освещение принадлежит городу и обслуживается по договору.' },
  'Container sites are served on a fixed schedule.': { ru: 'Контейнерные площадки обслуживаются по графику.' },
  'Public road / inter-block driveway.': { ru: 'Дорога общего пользования или внутриквартальный проезд.' },
  'Routes and stops are set by the department.': { ru: 'Маршруты и остановки определяет отдел.' },
  'Elevators are common property serviced under the OSI contract.': { ru: 'Лифты — общее имущество, обслуживаются по договору ОСИ.' },
  'Any smell of gas goes straight to the gas emergency service.': { ru: 'Любой запах газа сразу передаётся аварийной газовой службе.' },
  'Private / common property on a facade — ownership is often disputed. Safety first.': { ru: 'Частное или общее имущество на фасаде, собственник часто спорный. Сначала безопасность.' },
  'Yard territory can belong to the city or to the OSI — check the land plot.': { ru: 'Двор может принадлежать городу или ОСИ, нужно проверить участок.' },
  'Service unclear — operator to classify.': { ru: 'Служба не определена, оператор уточнит.' },
}

/** Translates one graph term; unknown strings pass through unchanged. */
export function term(lang: Lang, s: string): string {
  if (lang === 'en' || !s) return s
  const hit = TERMS[s]
  if (hit) return lang === 'kk' ? hit.kk ?? hit.ru : hit.ru
  // "14 mkr, house 20" / "MAEK-Kazatomprom (heat source)" / notes with a history suffix
  const obj = s.match(/^(\S+) mkr(?:, house (\S+))?$/)
  if (obj) return lang === 'kk' ? `${obj[1]} ш/а${obj[2] ? `, ${obj[2]} үй` : ''}` : `${obj[1]} мкр${obj[2] ? `, дом ${obj[2]}` : ''}`
  const paren = s.match(/^(.+) \((source & trunk mains|heat source)\)$/)
  if (paren) return `${term(lang, paren[1]!)} (${paren[2] === 'heat source' ? (lang === 'kk' ? 'жылу көзі' : 'источник тепла') : (lang === 'kk' ? 'көз және магистраль' : 'источник и магистрали')})`
  const hist = s.match(/^(.*\.) (\d+) similar incidents? here were resolved by this organisation\.$/)
  if (hist) return `${term(lang, hist[1]!)} ${lang === 'kk' ? `Мұнда осындай ${hist[2]} оқиғаны осы ұйым шешкен.` : `Здесь эта организация уже решила похожих случаев: ${hist[2]}.`}`
  return s
}
