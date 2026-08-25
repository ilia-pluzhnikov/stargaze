import type { LedgerEvent, Quest, Skill, StarComponent, Store, WishlistItem } from '../types'
import { dayInGameTz } from '../logic/sparks'

// Демо-мир первого запуска: вымышленный персонаж и нейтральные навыки.
// Дедлайны считаются от текущего дня: сид генерируется один раз (первый
// запуск) и дальше живёт в store, а статичные даты протухли бы и встречали
// бы нового пользователя просрочками и капанием искр.

export function seedStore(): Store {
  const ts = new Date().toISOString()
  const inDays = (n: number) => dayInGameTz(new Date(Date.now() + n * 86_400_000).toISOString())

  const skill = (id: string, emoji: string, name: string, hue: number, wantStatement: string): Skill =>
    ({ id, emoji, name, hue, wantStatement, archived: false, createdAt: ts })

  const star = (
    id: string,
    skillId: string,
    parentStarId: string | null,
    tier: StarComponent['tier'],
    title: string,
    lit = false,
  ): StarComponent => ({ id, skillId, parentStarId, tier, title, ...(lit ? { litAt: ts } : {}), createdAt: ts })

  const quest = (
    id: string,
    title: string,
    type: Quest['type'],
    skillId: string | null,
    xpReward: number,
    extra: Partial<Quest> = {},
  ): Quest => ({ id, title, type, skillId, xpReward, status: 'active', createdAt: ts, ...extra })

  const wish = (id: string, kind: WishlistItem['kind'], title: string, extra: Partial<WishlistItem> = {}): WishlistItem =>
    ({ id, kind, title, createdAt: ts, ...extra })

  const startCapital: LedgerEvent = {
    id: 'l_seed_start',
    ts,
    day: dayInGameTz(ts),
    kind: 'adjust',
    amount: 150,
    note: 'Стартовые искры демо-мира',
  }

  return {
    version: 3,
    character: { name: 'Странник', avatar: '🧭' },
    skills: [
      skill('sk_health', '💪', 'Здоровье', 145, 'Тело — опора, а не ограничение'),
      skill('sk_craft', '🎨', 'Творчество', 280, 'Регулярная практика сильнее вдохновения'),
      skill('sk_learn', '📚', 'Обучение', 210, 'Учусь тому, что применяю на этой же неделе'),
      skill('sk_career', '💼', 'Карьера', 330, 'Расту в сторону работы, которая заряжает'),
    ],
    stars: [
      // Здоровье: ствол бега + ветка сна и питания
      star('st_h1', 'sk_health', null, 'D', 'Утренняя зарядка — привычка', true),
      star('st_h2', 'sk_health', null, 'D', 'Сон 7+ часов неделю подряд', true),
      star('st_h3', 'sk_health', 'st_h1', 'C', 'Месяц регулярных тренировок', true),
      star('st_h4', 'sk_health', 'st_h3', 'C', '5 км без остановки'),
      star('st_h5', 'sk_health', 'st_h2', 'C', 'Неделя питания без срывов'),
      star('st_h6', 'sk_health', 'st_h4', 'B', '10 км за час'),
      star('st_h7', 'sk_health', 'st_h3', 'B', 'Полгода тренировок без пропусков дольше недели'),
      star('st_h8', 'sk_health', 'st_h6', 'A', 'Полумарафон'),
      star('st_h9', 'sk_health', 'st_h8', 'S', 'Марафон'),
      // Творчество: практика → серия → выход к людям
      star('st_c1', 'sk_craft', null, 'D', 'Первый набросок показан людям', true),
      star('st_c2', 'sk_craft', null, 'D', 'Десять этюдов'),
      star('st_c3', 'sk_craft', 'st_c1', 'C', 'Серия из пяти работ в одном стиле'),
      star('st_c4', 'sk_craft', 'st_c2', 'C', 'Узнаваемая палитра — свой стиль'),
      star('st_c5', 'sk_craft', 'st_c3', 'B', 'Онлайн мини-выставка'),
      star('st_c6', 'sk_craft', 'st_c3', 'B', 'Заказ от незнакомого человека'),
      star('st_c7', 'sk_craft', 'st_c4', 'A', 'Сто работ'),
      star('st_c8', 'sk_craft', 'st_c7', 'S', 'Работа, которой горжусь и через год'),
      // Обучение: курс → пет-проект → люди
      star('st_l1', 'sk_learn', null, 'D', 'Курс выбран и начат', true),
      star('st_l2', 'sk_learn', null, 'D', 'Первый конспект своими словами', true),
      star('st_l3', 'sk_learn', 'st_l1', 'C', 'Курс пройден до конца', true),
      star('st_l4', 'sk_learn', 'st_l3', 'C', 'Первый пет-проект работает'),
      star('st_l5', 'sk_learn', 'st_l2', 'C', 'Заметки превращаются в статьи'),
      star('st_l6', 'sk_learn', 'st_l4', 'B', 'Пет-проектом пользуются другие люди'),
      star('st_l7', 'sk_learn', 'st_l5', 'B', 'Выступление на митапе'),
      star('st_l8', 'sk_learn', 'st_l7', 'A', 'Ментор для новичка'),
      star('st_l9', 'sk_learn', 'st_l6', 'A', 'Сложный проект от идеи до релиза'),
      star('st_l10', 'sk_learn', 'st_l9', 'S', 'Область, в которой со мной советуются'),
    ],
    quests: [
      quest('q_walk', 'Прогулка 30 минут', 'repeating', 'sk_health', 15),
      quest('q_sketch', 'Этюд или набросок', 'repeating', 'sk_craft', 20, { daysOfWeek: [1, 3, 5] }),
      quest('q_run5k', 'Пробежать 5 км без остановки', 'short', 'sk_health', 60, {
        starId: 'st_h4',
        dueDate: inDays(14),
        description: 'Три пробежки в неделю по плану «с ходьбой на восстановлении», финальная — 5 км без перехода на шаг.',
        why: 'Первая дистанция, после которой бег перестаёт быть насилием и становится опорой.',
        definitionOfDone: [
          { text: 'Три тренировки на этой неделе' },
          { text: 'Контрольная пробежка: 5 км без остановки' },
        ],
        resources: [{ title: 'План «с дивана к 5 км»', url: 'https://ru.wikipedia.org/wiki/C25K' }],
      }),
      quest('q_chapter', 'Пройти главу курса и применить в пет-проекте', 'mid', 'sk_learn', 120, {
        starId: 'st_l4',
        dueDate: inDays(30),
      }),
      quest('q_series', 'Серия из пяти работ в едином стиле', 'long', 'sk_craft', 250, {
        starId: 'st_c3',
        dueDate: inDays(60),
      }),
    ],
    xpLog: [],
    ledger: [startCapital],
    wishlist: [
      wish('w_book', 'small', 'Бумажная книга из вишлиста', { price: 120, emoji: '📖' }),
      wish('w_grinder', 'small', 'Кофемолка мечты', { emoji: '☕', originalPrice: '≈ 8 000 ₽' }),
      wish('w_trip', 'big', 'Выходные в горах', { starId: 'st_h3', emoji: '🏔️' }),
    ],
  }
}
