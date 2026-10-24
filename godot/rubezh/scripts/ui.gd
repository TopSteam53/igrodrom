# Оформление интерфейса: шрифты сайта (Onest для текста, Unbounded для заголовков), тёмные панели,
# один тёплый акцент. Без градиентов и значков-эмодзи: иконки построек — рендеры моделей.
extends RefCounted

const BG := Color("11141c")
const PANEL := Color(0.09, 0.105, 0.145, 0.94)
const PANEL_LINE := Color(1, 1, 1, 0.08)
const TEXT := Color("f2efe8")
const MUTED := Color("a7adba")
const ACCENT := Color("ff8a3d")
const ACCENT_DARK := Color("1c1208")
const GOOD := Color("7fd37a")
const BAD := Color("ff5d4d")
const STAR := Color("ffc531")

static var theme: Theme
static var font_text: FontFile
static var font_head: FontFile


static func _font(base: String) -> FontFile:
	var f := load("res://assets/fonts/%s-cyrillic.woff2" % base) as FontFile
	var latin := load("res://assets/fonts/%s-latin.woff2" % base) as FontFile
	if f and latin:
		f.fallbacks = [latin]
	return f


static func build() -> Theme:
	if theme:
		return theme
	font_text = _font("onest")
	font_head = _font("unbounded")
	theme = Theme.new()
	if font_text:
		theme.default_font = font_text
	theme.default_font_size = 18
	theme.set_color("font_color", "Label", TEXT)

	var btn := _box(Color(1, 1, 1, 0.07), 12, PANEL_LINE)
	var btn_hover := _box(Color(1, 1, 1, 0.13), 12, PANEL_LINE)
	var btn_press := _box(Color(1, 1, 1, 0.04), 12, PANEL_LINE)
	var btn_off := _box(Color(1, 1, 1, 0.03), 12, Color(1, 1, 1, 0.04))
	for s in [btn, btn_hover, btn_press, btn_off]:
		s.content_margin_left = 18
		s.content_margin_right = 18
		s.content_margin_top = 10
		s.content_margin_bottom = 10
	theme.set_stylebox("normal", "Button", btn)
	theme.set_stylebox("hover", "Button", btn_hover)
	theme.set_stylebox("pressed", "Button", btn_press)
	theme.set_stylebox("disabled", "Button", btn_off)
	theme.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	theme.set_color("font_color", "Button", TEXT)
	theme.set_color("font_hover_color", "Button", TEXT)
	theme.set_color("font_pressed_color", "Button", TEXT)
	theme.set_color("font_disabled_color", "Button", Color(1, 1, 1, 0.3))
	theme.set_font_size("font_size", "Button", 18)

	# Главная кнопка: акцентная заливка, тёмный текст.
	theme.set_type_variation("Primary", "Button")
	var p := _box(ACCENT, 12)
	var ph := _box(ACCENT.lightened(0.12), 12)
	var pp := _box(ACCENT.darkened(0.12), 12)
	for s in [p, ph, pp]:
		s.content_margin_left = 26
		s.content_margin_right = 26
		s.content_margin_top = 12
		s.content_margin_bottom = 12
	theme.set_stylebox("normal", "Primary", p)
	theme.set_stylebox("hover", "Primary", ph)
	theme.set_stylebox("pressed", "Primary", pp)
	for c in ["font_color", "font_hover_color", "font_pressed_color"]:
		theme.set_color(c, "Primary", ACCENT_DARK)
	theme.set_font_size("font_size", "Primary", 20)

	# Выбранная кнопка (постройка, оружие): обводка акцентом.
	theme.set_type_variation("Picked", "Button")
	var pk := _box(Color(1, 0.54, 0.24, 0.16), 12, ACCENT, 2)
	pk.content_margin_left = 12
	pk.content_margin_right = 12
	pk.content_margin_top = 8
	pk.content_margin_bottom = 8
	for st in ["normal", "hover", "pressed"]:
		theme.set_stylebox(st, "Picked", pk)

	theme.set_stylebox("panel", "PanelContainer", panel())
	return theme


static func _box(color: Color, radius := 12, border := Color(0, 0, 0, 0), width := 1) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = color
	s.set_corner_radius_all(radius)
	if border.a > 0.0:
		s.border_color = border
		s.set_border_width_all(width)
	s.anti_aliasing = true
	return s


static func panel(alpha := 0.94) -> StyleBoxFlat:
	var s := _box(Color(PANEL, alpha), 18, PANEL_LINE)
	s.content_margin_left = 22
	s.content_margin_right = 22
	s.content_margin_top = 18
	s.content_margin_bottom = 18
	return s


static func label(text: String, size := 18, head := false, color := TEXT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if head and font_head:
		l.add_theme_font_override("font", font_head)
	return l


static func button(text: String, variation := "") -> Button:
	var b := Button.new()
	b.text = text
	if variation != "":
		b.theme_type_variation = variation
	b.focus_mode = Control.FOCUS_NONE
	return b


static func icon(name: String) -> Texture2D:
	var path := "res://assets/ui/%s.png" % name
	return load(path) if ResourceLoader.exists(path) else null


# Звёздочка — нарисованный многоугольник, не символ шрифта.
static func star(filled: bool, size := 22.0) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(size, size)
	c.draw.connect(func():
		var pts := PackedVector2Array()
		for i in 10:
			var r := size * (0.5 if i % 2 == 0 else 0.22)
			var a := -PI / 2 + i * PI / 5
			pts.append(Vector2(size / 2, size / 2) + Vector2(cos(a), sin(a)) * r)
		c.draw_colored_polygon(pts, STAR if filled else Color(1, 1, 1, 0.16)))
	return c


static func stars_row(n: int, total := 3, size := 22.0) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 3)
	for i in total:
		h.add_child(star(i < n, size))
	return h


# Полоска здоровья для HUD.
class Bar extends Control:
	var value := 1.0
	var color := Color("7fd37a")
	var back := Color(1, 1, 1, 0.12)

	func set_value(v: float) -> void:
		v = clampf(v, 0.0, 1.0)
		if absf(v - value) > 0.001:
			value = v
			queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		draw_style_box(_rounded(back), r)
		if value > 0.0:
			draw_style_box(_rounded(color), Rect2(Vector2.ZERO, Vector2(maxf(size.y, size.x * value), size.y)))

	func _rounded(c: Color) -> StyleBoxFlat:
		var s := StyleBoxFlat.new()
		s.bg_color = c
		s.set_corner_radius_all(int(size.y / 2))
		return s
