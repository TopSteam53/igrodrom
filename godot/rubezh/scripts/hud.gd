# Интерфейс боя: ночь и время, прочность дома, хлам, панель стройки днём, меню постройки,
# джойстик под пальцем, пауза и предложение починить дом за рекламу.
extends CanvasLayer

const D = preload("res://scripts/data.gd")
const UI = preload("res://scripts/ui.gd")

signal quit_to_menu
signal restart

var world: Node
var root: Control
var night_label: Label
var phase_label: Label
var house_bar: UI.Bar
var boss_box: VBoxContainer
var boss_bar: UI.Bar
var scrap_label: Label
var hero_bar: UI.Bar
var build_bar: HBoxContainer
var build_buttons := {}
var night_btn: Button
var reward_btn: Button
var day_box: Control
var toast_label: Label
var toast_t := 0.0
var menu: PanelContainer
var menu_cell := Vector2i.ZERO
var stick_view: Control
var stick_on := false
var stick_a := Vector2.ZERO
var stick_b := Vector2.ZERO
var overlay: Control
var house_flash := 0.0


func _ready() -> void:
	layer = 5
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UI.build()
	add_child(root)

	stick_view = Control.new()
	stick_view.set_anchors_preset(Control.PRESET_FULL_RECT)
	stick_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stick_view.draw.connect(_draw_stick)
	root.add_child(stick_view)

	# Верх слева: какая ночь и сколько осталось.
	var tl := _panel(Control.PRESET_TOP_LEFT, Vector2(14, 12))
	var tlv := VBoxContainer.new()
	tlv.add_theme_constant_override("separation", 2)
	tl.add_child(tlv)
	night_label = UI.label("", 20, true)
	phase_label = UI.label("", 15, false, UI.MUTED)
	tlv.add_child(night_label)
	tlv.add_child(phase_label)

	# Верх по центру: дом (и громила, когда он пришёл).
	var tc := VBoxContainer.new()
	tc.set_anchors_preset(Control.PRESET_CENTER_TOP)
	tc.position = Vector2(-150, 14)
	tc.custom_minimum_size = Vector2(300, 0)
	tc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tc.add_theme_constant_override("separation", 6)
	root.add_child(tc)
	var hl := UI.label("Дом", 14, false, UI.MUTED)
	hl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tc.add_child(hl)
	house_bar = UI.Bar.new()
	house_bar.custom_minimum_size = Vector2(300, 14)
	house_bar.color = UI.GOOD
	tc.add_child(house_bar)
	boss_box = VBoxContainer.new()
	boss_box.visible = false
	var bl := UI.label("Громила", 14, false, UI.BAD)
	bl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	boss_box.add_child(bl)
	boss_bar = UI.Bar.new()
	boss_bar.custom_minimum_size = Vector2(300, 10)
	boss_bar.color = UI.BAD
	boss_box.add_child(boss_bar)
	tc.add_child(boss_box)

	# Верх справа: хлам, звук, пауза.
	var tr := HBoxContainer.new()
	tr.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	tr.position = Vector2(-14, 12)
	tr.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	tr.add_theme_constant_override("separation", 8)
	root.add_child(tr)
	var sp := PanelContainer.new()
	sp.add_theme_stylebox_override("panel", _small_panel())
	var sh := HBoxContainer.new()
	sh.add_theme_constant_override("separation", 8)
	sp.add_child(sh)
	sh.add_child(_scrap_icon())
	scrap_label = UI.label("0", 20, true)
	sh.add_child(scrap_label)
	tr.add_child(sp)
	var pause := UI.button("")
	pause.custom_minimum_size = Vector2(48, 48)
	pause.tooltip_text = "Пауза (Esc)"
	pause.add_child(_pause_icon())
	pause.pressed.connect(toggle_pause)
	tr.add_child(pause)

	# Низ слева: здоровье героя.
	var hb := VBoxContainer.new()
	hb.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	hb.position = Vector2(16, -44)
	hb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hb.add_child(UI.label("Герой", 13, false, UI.MUTED))
	hero_bar = UI.Bar.new()
	hero_bar.custom_minimum_size = Vector2(150, 9)
	hero_bar.color = Color("ff9a5c")
	hb.add_child(hero_bar)
	root.add_child(hb)

	# Низ: панель стройки (только днём).
	day_box = VBoxContainer.new()
	day_box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	day_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	day_box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	day_box.position = Vector2(0, -14)
	day_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	day_box.alignment = BoxContainer.ALIGNMENT_END
	root.add_child(day_box)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	day_box.add_child(row)
	build_bar = HBoxContainer.new()
	build_bar.add_theme_constant_override("separation", 6)
	row.add_child(build_bar)
	var right := VBoxContainer.new()
	right.add_theme_constant_override("separation", 6)
	right.alignment = BoxContainer.ALIGNMENT_END
	row.add_child(right)
	reward_btn = UI.button("+%d хлама за рекламу" % D.REWARD_SCRAP)
	reward_btn.add_theme_font_size_override("font_size", 14)
	reward_btn.pressed.connect(func(): world.reward_scrap())
	right.add_child(reward_btn)
	night_btn = UI.button("Начать ночь", "Primary")
	night_btn.custom_minimum_size = Vector2(170, 64)
	night_btn.pressed.connect(func(): world.start_night())
	right.add_child(night_btn)

	toast_label = UI.label("", 17)
	toast_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast_label.position = Vector2(-300, 96)
	toast_label.custom_minimum_size = Vector2(600, 0)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	toast_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	toast_label.add_theme_constant_override("outline_size", 6)
	toast_label.modulate.a = 0.0
	root.add_child(toast_label)


func _panel(preset: int, offset: Vector2) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", _small_panel())
	p.set_anchors_preset(preset)
	p.position = offset
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(p)
	return p


func _small_panel() -> StyleBoxFlat:
	var s := UI.panel(0.82)
	s.content_margin_left = 14
	s.content_margin_right = 14
	s.content_margin_top = 8
	s.content_margin_bottom = 8
	s.set_corner_radius_all(14)
	return s


func _scrap_icon() -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(22, 22)
	c.draw.connect(func():
		# Гайка: шестиугольник с отверстием.
		var pts := PackedVector2Array()
		for i in 6:
			var a := i * PI / 3 + PI / 6
			pts.append(Vector2(11, 11) + Vector2(cos(a), sin(a)) * 10)
		c.draw_colored_polygon(pts, Color("c3c8cf"))
		c.draw_circle(Vector2(11, 11), 4, Color("2a2f38")))
	return c


func _pause_icon() -> Control:
	var c := Control.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.draw.connect(func():
		var s := c.size
		c.draw_rect(Rect2(s.x / 2 - 8, s.y / 2 - 9, 5, 18), UI.TEXT)
		c.draw_rect(Rect2(s.x / 2 + 3, s.y / 2 - 9, 5, 18), UI.TEXT))
	return c


func bind(w: Node) -> void:
	world = w
	_rebuild_build_bar()
	refresh()


func _rebuild_build_bar() -> void:
	for ch in build_bar.get_children():
		ch.queue_free()
	build_buttons.clear()
	var i := 0
	for k in world.available_buildings():
		i += 1
		var def: Dictionary = D.BUILDINGS[k]
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(84, 96)
		b.tooltip_text = "%s (%d)\n%s" % [def.name, i, def.hint]
		var v := VBoxContainer.new()
		v.set_anchors_preset(Control.PRESET_FULL_RECT)
		v.mouse_filter = Control.MOUSE_FILTER_IGNORE
		v.alignment = BoxContainer.ALIGNMENT_CENTER
		v.add_theme_constant_override("separation", 0)
		var tex := UI.icon("icon_" + k)
		if tex:
			var tr := TextureRect.new()
			tr.texture = tex
			tr.custom_minimum_size = Vector2(54, 54)
			tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
			v.add_child(tr)
		var name := UI.label(def.name, 13)
		name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(name)
		var cost := UI.label(str(def.cost), 15, true, UI.ACCENT)
		cost.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cost.name = "Cost"
		v.add_child(cost)
		b.add_child(v)
		b.pressed.connect(func(): world.set_tool("" if world.tool == k else k))
		build_bar.add_child(b)
		build_buttons[k] = b


func on_tool(kind: String) -> void:
	for k in build_buttons:
		build_buttons[k].theme_type_variation = "Picked" if k == kind else ""
	if kind != "" and world.level_idx == 0 and world.night == 1:
		toast("Коснитесь клетки на утоптанной земле, чтобы поставить. Правая кнопка мыши — отменить выбор.")
	_close_menu()


func on_day(night: int, total: int, first: bool) -> void:
	day_box.visible = true
	_close_menu()
	refresh()
	if first and world.level_idx == 0 and not world.endless:
		toast("Днём стройте оборону вокруг дома: выберите постройку внизу. Ночью зомби пойдут с севера — сверху экрана.", 7.0)
	elif first:
		toast("Зомби придут: %s." % _edges_text(world.level.edges), 5.0)


func _edges_text(edges: Array) -> String:
	var names := {"n": "с севера", "e": "с востока", "s": "с юга", "w": "с запада"}
	var parts: Array = []
	for e in edges:
		parts.append(names[e])
	if parts.size() == 4:
		return "со всех сторон"
	return ", ".join(parts)


func on_night(night: int, total: int) -> void:
	day_box.visible = false
	_close_menu()
	refresh()
	if world.level_idx == 0 and night == 1 and not world.endless:
		toast("Герой стреляет сам. Водите его клавишами WASD или пальцем: держитесь у построек и подбирайте хлам.", 7.0)


func on_dawn(night: int, bonus: int) -> void:
	toast("Ночь %d пережита. За рассвет +%d хлама." % [night, bonus], 4.0)


func toast_new_enemy(kind: String) -> void:
	var text := {
		"runner": "Бегуны: быстрые и хилые, прорываются между постройками.",
		"spitter": "Плевуны: плюются кислотой издалека и бьют по турелям. Подходите к ним сами.",
		"brute": "Толстяки: медленные, но ломают стены за пару ударов. Ставьте колья и мины на их пути.",
		"boss": "Громила: огромный и топает так, что рушатся постройки вокруг.",
	}
	if text.has(kind):
		toast(text[kind], 6.0)


func toast(text: String, seconds := 3.5) -> void:
	toast_label.text = text
	toast_t = seconds
	toast_label.modulate.a = 1.0


func refresh() -> void:
	if world == null:
		return
	scrap_label.text = str(world.scrap)
	if world.endless:
		night_label.text = "Ночь %d" % world.night
	else:
		night_label.text = "Ночь %d из %d" % [world.night, world.nights_total]
	reward_btn.visible = not world.reward_used and world.phase == "day"
	for k in build_buttons:
		var ok: bool = world.scrap >= int(D.BUILDINGS[k].cost)
		build_buttons[k].modulate = Color(1, 1, 1, 1.0 if ok else 0.45)


func tick() -> void:
	var dt := get_process_delta_time()
	if world.phase == "day":
		phase_label.text = "День: ещё %d с" % int(ceil(world.day_left))
		night_btn.text = "Начать ночь"
	elif world.phase == "night":
		var left: int = world.spawn_queue.size() + world.zombies.size()
		phase_label.text = "Зомби: %d" % left
	house_bar.set_value(world.house_hp / world.house_max)
	if house_flash > 0.0:
		house_flash -= dt
		house_bar.color = UI.BAD if fmod(house_flash, 0.2) > 0.1 else UI.GOOD
		house_bar.queue_redraw()
	hero_bar.set_value(world.hero.hp / world.hero.max_hp)
	scrap_label.text = str(world.scrap)
	if toast_t > 0.0:
		toast_t -= dt
		toast_label.modulate.a = clampf(toast_t * 2.0, 0.0, 1.0)
	if menu and is_instance_valid(menu):
		_update_menu()
	if Engine.get_process_frames() % 10 == 0:
		refresh()


func house_hit() -> void:
	house_flash = 0.4


func show_boss(on: bool) -> void:
	boss_box.visible = on
	boss_bar.set_value(1.0)


func boss_hp(v: float) -> void:
	boss_bar.set_value(v)


# ---------- меню постройки ----------

func show_building_menu(cell: Vector2i, at: Vector2) -> void:
	_close_menu()
	menu_cell = cell
	menu = PanelContainer.new()
	menu.add_theme_stylebox_override("panel", UI.panel())
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	menu.add_child(v)
	var is_house: bool = world.house_cells.has(cell)
	var title: String = "Дом" if is_house else D.BUILDINGS[world.building_at(cell).kind].name
	v.add_child(UI.label(title, 18, true))
	var hp := UI.label("", 14, false, UI.MUTED)
	hp.name = "Hp"
	v.add_child(hp)
	var rep := UI.button("")
	rep.name = "Repair"
	rep.pressed.connect(func(): world.repair(menu_cell); _update_menu())
	v.add_child(rep)
	if not is_house:
		var sell := UI.button("")
		sell.name = "Sell"
		sell.pressed.connect(func(): world.sell(menu_cell); _close_menu())
		v.add_child(sell)
	var close := UI.button("Закрыть")
	close.pressed.connect(_close_menu)
	v.add_child(close)
	root.add_child(menu)
	_update_menu()
	await get_tree().process_frame
	if menu:
		var vp := root.get_viewport_rect().size
		menu.position = (at - Vector2(menu.size.x / 2, menu.size.y + 10)).clamp(Vector2(8, 8), vp - menu.size - Vector2(8, 8))


func _update_menu() -> void:
	if not is_instance_valid(menu):
		return
	var is_house: bool = world.house_cells.has(menu_cell)
	var b = null if is_house else world.building_at(menu_cell)
	if not is_house and b == null:
		_close_menu()
		return
	var hp: float = world.house_hp if is_house else b.hp
	var mx: float = world.house_max if is_house else b.max_hp
	(menu.find_child("Hp", true, false) as Label).text = "Прочность %d из %d" % [int(hp), int(mx)]
	var cost: int = world.repair_cost(menu_cell)
	var rep := menu.find_child("Repair", true, false) as Button
	rep.text = "Починить за %d" % cost if cost > 0 else "Целое"
	rep.disabled = cost <= 0 or cost > world.scrap
	var sell := menu.find_child("Sell", true, false) as Button
	if sell:
		sell.text = "Разобрать: +%d" % world.refund(menu_cell)


func _close_menu() -> void:
	if menu and is_instance_valid(menu):
		menu.queue_free()
	menu = null


# ---------- джойстик ----------

func show_stick(on: bool, a: Vector2, b: Vector2) -> void:
	stick_on = on
	stick_a = a
	stick_b = b
	stick_view.queue_redraw()


func _draw_stick() -> void:
	if not stick_on:
		return
	var s := root.get_viewport_transform().affine_inverse()
	var a := s * stick_a
	var b := s * stick_b
	stick_view.draw_circle(a, 70, Color(1, 1, 1, 0.08))
	stick_view.draw_arc(a, 70, 0, TAU, 48, Color(1, 1, 1, 0.25), 2.0, true)
	stick_view.draw_circle(b, 26, Color(1, 1, 1, 0.35))


# ---------- пауза и проигрыш ----------

func toggle_pause() -> void:
	if overlay:
		_close_overlay()
		world.set_paused(false)
		Sdk.gameplay(true)
		return
	world.set_paused(true)
	Sdk.gameplay(false)
	var v := _overlay("Пауза")
	var go := UI.button("Продолжить", "Primary")
	go.pressed.connect(toggle_pause)
	v.add_child(go)
	var again := UI.button("Начать уровень заново")
	again.pressed.connect(func(): restart.emit())
	v.add_child(again)
	var snd := UI.button("Звук: выключен" if Sfx.muted else "Звук: включён")
	snd.pressed.connect(func():
		Sfx.set_muted(not Sfx.muted)
		Sdk.data["mute"] = Sfx.muted
		Sdk.save()
		snd.text = "Звук: выключен" if Sfx.muted else "Звук: включён")
	v.add_child(snd)
	var out := UI.button("Выйти к уровням")
	out.pressed.connect(func(): quit_to_menu.emit())
	v.add_child(out)


func offer_revive() -> void:
	var v := _overlay("Дом разрушен")
	var t := UI.label("Можно один раз починить дом за рекламу и доиграть ночь.", 16, false, UI.MUTED)
	t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	t.custom_minimum_size = Vector2(320, 0)
	v.add_child(t)
	var yes := UI.button("Починить за рекламу", "Primary")
	yes.pressed.connect(func():
		yes.disabled = true
		var ok: bool = await world.revive()
		_close_overlay()
		if not ok:
			world.give_up())
	v.add_child(yes)
	var no := UI.button("Сдаться")
	no.pressed.connect(func(): _close_overlay(); world.give_up())
	v.add_child(no)


func _overlay(title: String) -> VBoxContainer:
	_close_overlay()
	overlay = ColorRect.new()
	(overlay as ColorRect).color = Color(0.03, 0.04, 0.07, 0.72)
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(overlay)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(center)
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UI.panel())
	center.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	v.custom_minimum_size = Vector2(300, 0)
	p.add_child(v)
	var h := UI.label(title, 26, true)
	h.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(h)
	return v


func _close_overlay() -> void:
	if overlay and is_instance_valid(overlay):
		overlay.queue_free()
	overlay = null
