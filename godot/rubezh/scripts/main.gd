# Экраны вне боя: главное меню, карта уровней, выбор оружия, улучшения, итог уровня.
# Сохранение (Sdk.data): stars — звёзды по уровням, spent — потрачено на улучшения, up — уровни улучшений,
# best — рекорд бесконечной ночи, weapon — последнее оружие, mute — звук.
extends Node

const D = preload("res://scripts/data.gd")
const UI = preload("res://scripts/ui.gd")
const World = preload("res://scripts/world.gd")
const Hud = preload("res://scripts/hud.gd")

var ui_layer: CanvasLayer
var screen: Control
var world: Node3D
var hud: CanvasLayer
var backdrop: TextureRect
var current := {"level": 0, "endless": false}


func _ready() -> void:
	ui_layer = CanvasLayer.new()
	ui_layer.layer = 10
	add_child(ui_layer)
	var bg := ColorRect.new()
	bg.color = UI.BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.name = "Bg"
	ui_layer.add_child(bg)
	backdrop = TextureRect.new()
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	backdrop.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	backdrop.texture = UI.icon("menu_bg")
	backdrop.modulate = Color(0.55, 0.58, 0.68)
	ui_layer.add_child(backdrop)
	Sdk.pause_changed.connect(_on_sdk_pause)
	await Sdk.start()
	Sfx.set_muted(bool(Sdk.data.get("mute", false)))
	Sdk.game_ready()
	if "--autotest" in OS.get_cmdline_user_args():
		_autotest()
		return
	show_title()


# Прогон без окна: godot --headless --path godot/rubezh -- --autotest [уровень]. Строит пару построек,
# начинает ночь и печатает состояние; герой стоит у дома. Ловит ошибки скриптов и проверяет, что ночи кончаются.
func _autotest() -> void:
	var args := OS.get_cmdline_user_args()
	var lvl := int(args[args.find("--autotest") + 1]) if args.size() > args.find("--autotest") + 1 else 0
	start_level(lvl, "pistol")
	for c in [Vector2i(-1, -3), Vector2i(0, -3), Vector2i(1, -3), Vector2i(2, -4)]:
		world.build("barricade", c)
	world.build("turret", Vector2i(0, -4)) if lvl > 0 else null
	var t := 0.0
	var last_night := 0
	var last_print := 0.0
	var w = world
	while w.phase != "over" and t < 600.0:
		if w.phase == "day":
			w.start_night()
		await get_tree().process_frame
		t += get_process_delta_time()
		if w.night != last_night or t - last_print > 30.0:
			last_night = w.night
			last_print = t
			print("AUTOTEST t=%.0f ночь %d дом %.0f/%.0f хлам %d зомби %d в очереди %d построек %d герой %.0f" % [t, w.night, w.house_hp,
				w.house_max, w.scrap, w.zombies.size(), w.spawn_queue.size(), w.buildings.size(), w.hero.hp])
	print("AUTOTEST конец t=%.0f фаза %s дом %.0f зомби %d" % [t, w.phase, w.house_hp, w.zombies.size()])
	get_tree().quit()


func _on_sdk_pause(p: bool) -> void:
	Sfx.pause_all(p)
	get_tree().paused = p


# ---------- сохранение ----------

func stars_of(i: int) -> int:
	return int(Sdk.data.get("stars", {}).get(str(i), 0))


func total_stars() -> int:
	var t := 0
	for i in D.LEVELS.size():
		t += stars_of(i)
	return t


func best() -> int:
	return int(Sdk.data.get("best", 0))


# Звёзды на улучшения: заработанные на уровнях плюс одна за каждые 3 ночи рекорда бесконечной ночи.
func free_points() -> int:
	return total_stars() + best() / 3 - int(Sdk.data.get("spent", 0))


func ups() -> Dictionary:
	return Sdk.data.get("up", {})


func unlocked(i: int) -> bool:
	return i == 0 or stars_of(i - 1) > 0


# ---------- экраны ----------

func _set_screen(c: Control) -> void:
	if screen:
		screen.queue_free()
	screen = c
	c.theme = UI.build()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui_layer.add_child(c)
	ui_layer.get_node("Bg").visible = true
	backdrop.visible = true


func _column(width := 420.0) -> VBoxContainer:
	var root := Control.new()
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(center)
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(width, 0)
	v.add_theme_constant_override("separation", 12)
	center.add_child(v)
	_set_screen(root)
	return v


func show_title() -> void:
	Sfx.music("day")
	var v := _column(380)
	var t := UI.label("Последний рубеж", 46, true)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(t)
	var sub := UI.label("Днём укрепляйте дом. Ночью держите оборону до рассвета.", 17, false, UI.MUTED)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(sub)
	v.add_child(_gap(10))
	var play := UI.button("Играть", "Primary")
	play.pressed.connect(show_levels)
	v.add_child(play)
	var open := stars_of(D.ENDLESS_UNLOCK - 1) > 0
	var endless := UI.button("Бесконечная ночь" + (", рекорд %d" % best() if best() > 0 and open else ""))
	if not open:
		endless.text = "Бесконечная ночь откроется после уровня %d" % D.ENDLESS_UNLOCK
		endless.disabled = true
	endless.pressed.connect(func(): show_loadout(-1))
	v.add_child(endless)
	var pts := free_points()
	var upg := UI.button("Улучшения" + (": свободных звёзд %d" % pts if pts > 0 else ""))
	upg.pressed.connect(show_upgrades)
	v.add_child(upg)
	var snd := UI.button("Звук: выключен" if Sfx.muted else "Звук: включён")
	snd.pressed.connect(func():
		Sfx.set_muted(not Sfx.muted)
		Sdk.data["mute"] = Sfx.muted
		Sdk.save()
		snd.text = "Звук: выключен" if Sfx.muted else "Звук: включён")
	v.add_child(snd)


func _gap(h: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c


func show_levels() -> void:
	var root := Control.new()
	var scroll := ScrollContainer.new()
	scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	root.add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	scroll.add_child(margin)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 16)
	margin.add_child(v)
	var head := HBoxContainer.new()
	var back := UI.button("Назад")
	back.pressed.connect(show_title)
	head.add_child(back)
	var title := UI.label("Уровни", 30, true)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	head.add_child(title)
	var st := HBoxContainer.new()
	st.add_theme_constant_override("separation", 6)
	st.add_child(UI.star(true, 22))
	st.add_child(UI.label("%d из %d" % [total_stars(), D.LEVELS.size() * 3], 18, true))
	head.add_child(st)
	v.add_child(head)
	var grid := HFlowContainer.new()
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	grid.alignment = FlowContainer.ALIGNMENT_CENTER
	v.add_child(grid)
	for i in D.LEVELS.size():
		grid.add_child(_level_card(i))
	_set_screen(root)


func _level_card(i: int) -> Control:
	var lv: Dictionary = D.LEVELS[i]
	var open := unlocked(i)
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(200, 128)
	b.disabled = not open
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 16
	v.offset_top = 12
	v.offset_right = -16
	v.offset_bottom = -12
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_theme_constant_override("separation", 4)
	v.add_child(UI.label("Уровень %d" % (i + 1), 14, false, UI.MUTED))
	var n := UI.label(lv.name, 20, true, UI.TEXT if open else UI.MUTED)
	n.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(n)
	var info := "%d ноч%s" % [lv.nights, "и" if lv.nights < 5 else "ей"]
	if lv.get("boss", false):
		info += ", громила"
	v.add_child(UI.label(info if open else "Сначала пройдите уровень %d" % i, 14, false, UI.MUTED))
	var sp := Control.new()
	sp.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(sp)
	if open:
		v.add_child(UI.stars_row(stars_of(i), 3, 20))
	b.add_child(v)
	b.pressed.connect(func(): show_loadout(i))
	return b


# Перед боем: какое оружие взять. Новое открывается по мере прохождения.
func show_loadout(i: int) -> void:
	var is_endless := i < 0
	var lv: Dictionary = D.ENDLESS if is_endless else D.LEVELS[i]
	var v := _column(460)
	var t := UI.label(lv.name, 32, true)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	var desc := "Продержитесь, сколько сможете. Рекорд попадает в таблицу игры." if is_endless \
		else "Ночей: %d. Зомби придут %s." % [lv.nights, _edges(lv.edges)]
	var d := UI.label(desc, 16, false, UI.MUTED)
	d.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(d)
	v.add_child(UI.label("Оружие", 18, true))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(row)
	var picked := {"w": str(Sdk.data.get("weapon", "pistol"))}
	var reached := 99 if is_endless else i + 1
	if int(D.WEAPONS[picked.w].unlock) > reached:
		picked.w = "pistol"
	var buttons := {}
	for k in D.WEAPON_ORDER:
		var w: Dictionary = D.WEAPONS[k]
		var open := int(w.unlock) <= maxi(reached, _max_reached() + 1)
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(136, 150)
		b.disabled = not open
		var bv := VBoxContainer.new()
		bv.set_anchors_preset(Control.PRESET_FULL_RECT)
		bv.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bv.alignment = BoxContainer.ALIGNMENT_CENTER
		var tex := UI.icon("icon_" + k)
		if tex:
			var tr := TextureRect.new()
			tr.texture = tex
			tr.custom_minimum_size = Vector2(70, 70)
			tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
			bv.add_child(tr)
		var nm := UI.label(w.name, 16, true)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		bv.add_child(nm)
		var note := _weapon_note(k) if open else "Откроется на уровне %d" % w.unlock
		var nt := UI.label(note, 12, false, UI.MUTED)
		nt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		nt.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		bv.add_child(nt)
		b.add_child(bv)
		b.pressed.connect(func():
			picked.w = k
			for kk in buttons:
				buttons[kk].theme_type_variation = "Picked" if kk == k else "")
		row.add_child(b)
		buttons[k] = b
	buttons[picked.w].theme_type_variation = "Picked"
	v.add_child(_gap(6))
	var go := UI.button("В бой", "Primary")
	go.pressed.connect(func():
		Sdk.data["weapon"] = picked.w
		Sdk.save()
		start_level(i, picked.w))
	v.add_child(go)
	var back := UI.button("Назад")
	back.pressed.connect(func(): show_title() if is_endless else show_levels())
	v.add_child(back)


func _max_reached() -> int:
	var m := 0
	for i in D.LEVELS.size():
		if stars_of(i) > 0:
			m = i + 1
	return m


func _weapon_note(k: String) -> String:
	match k:
		"pistol": return "Быстрый, бьёт далеко"
		"shotgun": return "Веер дроби вблизи"
		_: return "Пробивает троих насквозь"


func _edges(edges: Array) -> String:
	var names := {"n": "с севера", "e": "с востока", "s": "с юга", "w": "с запада"}
	if edges.size() == 4:
		return "со всех сторон"
	var parts: Array = []
	for e in edges:
		parts.append(names[e])
	return ", ".join(parts)


func show_upgrades() -> void:
	var v := _column(560)
	var head := HBoxContainer.new()
	var back := UI.button("Назад")
	back.pressed.connect(show_title)
	head.add_child(back)
	var t := UI.label("Улучшения", 28, true)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	head.add_child(t)
	var pts := HBoxContainer.new()
	pts.add_theme_constant_override("separation", 6)
	pts.add_child(UI.star(true, 22))
	pts.add_child(UI.label(str(free_points()), 20, true))
	head.add_child(pts)
	v.add_child(head)
	var hint := UI.label("Звёзды дают за уровни и за рекорды бесконечной ночи (одна за каждые три ночи).", 14, false, UI.MUTED)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(hint)
	var u := ups()
	for k in D.UPGRADE_ORDER:
		var def: Dictionary = D.UPGRADES[k]
		var lvl := int(u.get(k, 0))
		var maxed: bool = lvl >= def.costs.size()
		var row := PanelContainer.new()
		var rs := UI.panel(0.7)
		rs.content_margin_top = 10
		rs.content_margin_bottom = 10
		row.add_theme_stylebox_override("panel", rs)
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 12)
		row.add_child(h)
		var info := VBoxContainer.new()
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info.add_child(UI.label(def.name, 17, true))
		var total: float = def.step * lvl
		var shown := int(round(total * 100)) if def.step < 1.0 else int(total)
		info.add_child(UI.label((def.fmt % shown) if lvl > 0 else "Пока не улучшено", 13, false, UI.MUTED))
		h.add_child(info)
		var pips := HBoxContainer.new()
		pips.add_theme_constant_override("separation", 4)
		for p in def.costs.size():
			var pip := ColorRect.new()
			pip.custom_minimum_size = Vector2(10, 10)
			pip.color = UI.ACCENT if p < lvl else Color(1, 1, 1, 0.15)
			pip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			pips.add_child(pip)
		h.add_child(pips)
		var buy := UI.button("Готово" if maxed else "За %d" % def.costs[lvl])
		buy.custom_minimum_size = Vector2(110, 0)
		buy.disabled = maxed or free_points() < int(def.costs[lvl])
		buy.pressed.connect(func():
			var cost := int(def.costs[lvl])
			if free_points() < cost:
				return
			var all := ups().duplicate()
			all[k] = lvl + 1
			Sdk.data["up"] = all
			Sdk.data["spent"] = int(Sdk.data.get("spent", 0)) + cost
			Sdk.save()
			Sfx.play("build")
			show_upgrades())
		h.add_child(buy)
		v.add_child(row)


# ---------- бой ----------

func start_level(i: int, weapon: String) -> void:
	_clear_world()
	current = {"level": i, "endless": i < 0, "weapon": weapon}
	if screen:
		screen.queue_free()
		screen = null
	ui_layer.get_node("Bg").visible = false
	backdrop.visible = false
	world = World.new()
	add_child(world)
	hud = Hud.new()
	add_child(hud)
	world.hud = hud
	hud.world = world
	var lv: Dictionary = D.ENDLESS if i < 0 else D.LEVELS[i]
	world.setup(lv, maxi(i, 0), i < 0, weapon, ups())
	hud.bind(world)
	world.finished.connect(_on_finished)
	hud.quit_to_menu.connect(func(): _clear_world(); show_levels() if i >= 0 else show_title())
	hud.restart.connect(func(): start_level(i, weapon))


func _clear_world() -> void:
	if world:
		world.queue_free()
		world = null
	if hud:
		hud.queue_free()
		hud = null
	Sdk.gameplay(false)


func _on_finished(r: Dictionary) -> void:
	var gained := 0
	var new_best := false
	if r.endless:
		if int(r.nights) > best():
			Sdk.data["best"] = int(r.nights)
			new_best = true
	elif r.win:
		var was := stars_of(r.level)
		if r.stars > was:
			var s: Dictionary = Sdk.data.get("stars", {}).duplicate()
			s[str(r.level)] = r.stars
			Sdk.data["stars"] = s
			gained = r.stars - was
	Sdk.save()
	await get_tree().create_timer(1.6).timeout
	_show_result(r, gained, new_best)


func _show_result(r: Dictionary, gained: int, new_best: bool) -> void:
	_clear_world()
	var v := _column(420)
	var title := "Рассвет" if r.win else ("Ночь закончилась" if r.endless else "Дом разрушен")
	var t := UI.label(title, 36, true)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	if r.win:
		var row := UI.stars_row(r.stars, 3, 44)
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		v.add_child(row)
		var why := "Дом цел на %d%%." % int(r.house * 100)
		if r.stars < 3:
			why += " Три звезды — если к концу уцелеет 80% дома."
		var w := UI.label(why, 15, false, UI.MUTED)
		w.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		w.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.add_child(w)
	var lines: Array = []
	if r.endless:
		lines.append("Пережито ночей: %d" % r.nights)
		if new_best:
			lines.append("Новый рекорд")
	lines.append("Зомби побеждено: %d" % r.kills)
	if gained > 0:
		lines.append("Новых звёзд: %d — потратьте их на улучшения" % gained)
	for l in lines:
		var lb := UI.label(l, 17)
		lb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(lb)
	v.add_child(_gap(8))
	var i: int = -1 if r.endless else int(r.level)
	if r.win and i + 1 < D.LEVELS.size():
		var next := UI.button("Следующий уровень", "Primary")
		next.pressed.connect(func(): show_loadout(i + 1))
		v.add_child(next)
	var again := UI.button("Ещё раз", "" if r.win else "Primary")
	again.pressed.connect(func(): start_level(i, str(current.weapon)))
	v.add_child(again)
	if free_points() > 0:
		var up := UI.button("Улучшения: свободных звёзд %d" % free_points())
		up.pressed.connect(show_upgrades)
		v.add_child(up)
	var menu := UI.button("К уровням" if not r.endless else "В меню")
	menu.pressed.connect(func(): show_levels() if not r.endless else show_title())
	v.add_child(menu)
	# Полноэкранная реклама — между уровнями, площадка сама решает, показывать ли.
	Sdk.fullscreen()
