# Числа игры в одном месте: зомби, постройки, оружие, улучшения и уровни.
# Баланс подбирался прогоном волн в scripts/sim (см. README в godot/rubezh).
extends RefCounted

const MAP_HALF := 14          # карта — клетки от −14 до 13 по X и Z, клетка 1 м
const BUILD_RADIUS := 7       # строить можно в квадрате ±7 клеток от центра дома
const HOUSE_HALF := 1         # дом занимает клетки −1…1

# Зомби. cost — «вес» в бюджете ночи, scrap — сколько хлама выпадает.
const ZOMBIES := {
	"walker": {"name": "Бродяга", "hp": 40.0, "speed": 1.15, "bite": 9.0, "smash": 10.0, "cost": 1.0, "scrap": 3, "radius": 0.32, "scale": 1.0},
	"runner": {"name": "Бегун", "hp": 24.0, "speed": 2.5, "bite": 7.0, "smash": 6.0, "cost": 1.3, "scrap": 2, "radius": 0.28, "scale": 0.95},
	"spitter": {"name": "Плевун", "hp": 36.0, "speed": 1.0, "bite": 6.0, "smash": 6.0, "cost": 2.2, "scrap": 5, "radius": 0.32, "scale": 1.0,
		"range": 5.5, "spit": 11.0, "spit_every": 2.4},
	"brute": {"name": "Толстяк", "hp": 230.0, "speed": 0.8, "bite": 22.0, "smash": 34.0, "cost": 6.0, "scrap": 12, "radius": 0.55, "scale": 1.0},
	"boss": {"name": "Громила", "hp": 1600.0, "speed": 0.85, "bite": 40.0, "smash": 70.0, "cost": 40.0, "scrap": 60, "radius": 0.8, "scale": 1.0},
}

# Постройки. block — зомби не проходят, им надо ломать; path_cost — насколько обходят при поиске пути.
const BUILDINGS := {
	"barricade": {"name": "Баррикада", "cost": 10, "hp": 160.0, "block": true, "path_cost": 14.0, "unlock": 1,
		"hint": "Дешёвая стена из досок. Зомби её ломают, а пока ломают — стоят под огнём."},
	"spikes": {"name": "Колья", "cost": 15, "hp": 120.0, "block": false, "path_cost": 3.0, "unlock": 1,
		"hint": "По кольям зомби идут вдвое медленнее и получают урон. Колья тупятся."},
	"turret": {"name": "Турель", "cost": 45, "hp": 140.0, "block": true, "path_cost": 14.0, "unlock": 2,
		"hint": "Стреляет сама по ближайшему зомби в радиусе 6 м."},
	"mine": {"name": "Мина", "cost": 20, "hp": 1.0, "block": false, "path_cost": 1.0, "unlock": 3,
		"hint": "Взрывается, когда на неё наступит зомби. Одноразовая."},
	"wall": {"name": "Стена", "cost": 28, "hp": 420.0, "block": true, "path_cost": 30.0, "unlock": 4,
		"hint": "Бетон и железо. Держит толстяков, но дорогая."},
}
const BUILD_ORDER := ["barricade", "spikes", "turret", "mine", "wall"]

const TURRET := {"range": 6.0, "every": 0.55, "damage": 9.0}
const SPIKES := {"dps": 14.0, "slow": 0.5, "wear": 6.0}
const MINE := {"radius": 2.4, "damage": 140.0}
const HOUSE_HP := 600.0
const PLAYER_HP := 100.0
const PLAYER_SPEED := 4.6

# Оружие героя. Стреляет само по ближайшему зомби в радиусе.
const WEAPONS := {
	"pistol": {"name": "Пистолет", "damage": 14.0, "every": 0.38, "range": 7.5, "pellets": 1, "spread": 0.0, "pierce": 1, "unlock": 1},
	"shotgun": {"name": "Дробовик", "damage": 10.0, "every": 0.85, "range": 5.0, "pellets": 6, "spread": 0.5, "pierce": 1, "unlock": 3},
	"rifle": {"name": "Винтовка", "damage": 30.0, "every": 0.6, "range": 10.0, "pellets": 1, "spread": 0.0, "pierce": 3, "unlock": 6},
}
const WEAPON_ORDER := ["pistol", "shotgun", "rifle"]

# Улучшения покупаются за звёзды. step — прибавка за уровень (доля или единицы), costs — цена каждого уровня.
const UPGRADES := {
	"damage": {"name": "Урон оружия", "step": 0.15, "costs": [1, 2, 2, 3, 3], "fmt": "+%d%% урона"},
	"rate": {"name": "Скорострельность", "step": 0.10, "costs": [1, 2, 3, 3], "fmt": "+%d%% к скорости стрельбы"},
	"health": {"name": "Здоровье героя", "step": 25.0, "costs": [1, 2, 3], "fmt": "+%d здоровья"},
	"armor": {"name": "Прочность построек", "step": 0.20, "costs": [1, 2, 2, 3], "fmt": "+%d%% прочности"},
	"turret": {"name": "Урон турелей", "step": 0.20, "costs": [2, 2, 3, 3], "fmt": "+%d%% урона турелей"},
	"scrap": {"name": "Запас хлама", "step": 15.0, "costs": [1, 1, 2, 2], "fmt": "+%d хлама в начале"},
	"house": {"name": "Крепкий дом", "step": 0.25, "costs": [2, 3, 3], "fmt": "+%d%% прочности дома"},
}
const UPGRADE_ORDER := ["damage", "rate", "health", "armor", "turret", "scrap", "house"]

# Уровни. edges — откуда идут зомби (n, e, s, w), types — кто появляется, budget — сила первой ночи,
# grow — во сколько раз крепчает каждая следующая ночь. boss — громила в последнюю ночь.
const LEVELS := [
	{"name": "Ферма", "nights": 3, "edges": ["n"], "types": ["walker"], "budget": 9.0, "grow": 1.45, "scrap": 40, "seed": 11, "ground": Color(0.42, 0.5, 0.32)},
	{"name": "Кукурузное поле", "nights": 3, "edges": ["n", "e"], "types": ["walker", "runner"], "budget": 13.0, "grow": 1.4, "scrap": 45, "seed": 23, "ground": Color(0.5, 0.5, 0.3)},
	{"name": "Заправка", "nights": 4, "edges": ["n", "e", "w"], "types": ["walker", "runner"], "budget": 16.0, "grow": 1.35, "scrap": 50, "seed": 37, "ground": Color(0.45, 0.45, 0.4)},
	{"name": "Лесопилка", "nights": 4, "edges": ["n", "w"], "types": ["walker", "runner", "spitter"], "budget": 19.0, "grow": 1.35, "scrap": 55, "seed": 41, "ground": Color(0.36, 0.46, 0.3)},
	{"name": "Школа", "nights": 4, "edges": ["n", "e", "s"], "types": ["walker", "runner", "spitter"], "budget": 22.0, "grow": 1.33, "scrap": 60, "seed": 53, "ground": Color(0.44, 0.48, 0.36), "boss": true},
	{"name": "Мост", "nights": 5, "edges": ["e", "w"], "types": ["walker", "runner", "spitter", "brute"], "budget": 25.0, "grow": 1.3, "scrap": 65, "seed": 67, "ground": Color(0.4, 0.44, 0.38)},
	{"name": "Больница", "nights": 5, "edges": ["n", "e", "s", "w"], "types": ["walker", "runner", "spitter", "brute"], "budget": 28.0, "grow": 1.3, "scrap": 70, "seed": 71, "ground": Color(0.46, 0.46, 0.42)},
	{"name": "Рынок", "nights": 5, "edges": ["n", "s", "w"], "types": ["walker", "runner", "spitter", "brute"], "budget": 32.0, "grow": 1.28, "scrap": 75, "seed": 83, "ground": Color(0.48, 0.44, 0.36)},
	{"name": "Телевышка", "nights": 6, "edges": ["n", "e", "s", "w"], "types": ["walker", "runner", "spitter", "brute"], "budget": 35.0, "grow": 1.26, "scrap": 80, "seed": 97, "ground": Color(0.38, 0.42, 0.36)},
	{"name": "Последний рубеж", "nights": 6, "edges": ["n", "e", "s", "w"], "types": ["walker", "runner", "spitter", "brute"], "budget": 40.0, "grow": 1.26, "scrap": 90, "seed": 101, "ground": Color(0.36, 0.38, 0.36), "boss": true},
]

# Бесконечная оборона открывается после 3-го уровня; рекорд — число пережитых ночей.
const ENDLESS_UNLOCK := 3
const ENDLESS := {"name": "Бесконечная ночь", "edges": ["n", "e", "s", "w"], "types": ["walker", "runner", "spitter", "brute"], "budget": 12.0, "grow": 1.22, "scrap": 60, "seed": 7, "ground": Color(0.4, 0.42, 0.36)}

const DAY_SECONDS := 40.0      # день: время на стройку, можно начать ночь раньше
const REWARD_SCRAP := 40       # хлам за рекламу днём (раз в ночь)
