# Модели из Blender (assets/models/<имя>.glb, scripts/blender/rubezh.py) и их анимация без скелета:
# у персонажей части Body/Head/ArmL/ArmR/LegL/LegR с осью в суставе, код качает их синусами.
# Модель смотрит вдоль +Z; поворот к цели — rotation.y = atan2(dx, dz).
# Если файла ещё нет, вместо модели — простая фигура того же размера: игра запускается и без ассетов.
extends RefCounted

const PARTS := ["Body", "Head", "ArmL", "ArmR", "LegL", "LegR"]

static var _cache := {}
static var _fallback_mats := {}


static func has(name: String) -> bool:
	return ResourceLoader.exists("res://assets/models/%s.glb" % name)


static func make(name: String) -> Node3D:
	var path := "res://assets/models/%s.glb" % name
	if not _cache.has(name):
		_cache[name] = load(path) if ResourceLoader.exists(path) else null
	var scene: PackedScene = _cache[name]
	if scene:
		var n := scene.instantiate() as Node3D
		return n
	return _placeholder(name)


# Части персонажа по именам и их исходные повороты — для анимации.
static func rig(root: Node3D) -> Dictionary:
	var r := {}
	for p in PARTS:
		var n := root.find_child(p, true, false) as Node3D
		if n:
			r[p] = n
			r[p + "_rest"] = n.rotation
	var hand := root.find_child("Hand", true, false)
	if hand:
		r["Hand"] = hand
	return r


# Походка: phase — фаза шага, amount — 0…1 насколько идёт, style — "zombie" (руки вперёд) или "hero".
static func animate(r: Dictionary, phase: float, amount: float, style: String, attack := 0.0) -> void:
	var s := sin(phase) * amount
	if r.has("LegL"):
		r["LegL"].rotation.x = r["LegL_rest"].x + s * 0.7
	if r.has("LegR"):
		r["LegR"].rotation.x = r["LegR_rest"].x - s * 0.7
	if r.has("Body"):
		r["Body"].position.y = abs(cos(phase)) * 0.05 * amount
		r["Body"].rotation.z = r["Body_rest"].z + sin(phase) * (0.12 if style == "zombie" else 0.04) * amount
	if style == "zombie":
		var reach := -1.25 - attack * 0.6
		if r.has("ArmL"):
			r["ArmL"].rotation.x = r["ArmL_rest"].x + reach + s * 0.25 + sin(phase * 0.5) * 0.08
		if r.has("ArmR"):
			r["ArmR"].rotation.x = r["ArmR_rest"].x + reach - s * 0.25 - attack * 0.4
		if r.has("Head"):
			r["Head"].rotation.z = r["Head_rest"].z + sin(phase * 0.37) * 0.25
	else:
		if r.has("ArmL"):
			r["ArmL"].rotation.x = r["ArmL_rest"].x - s * 0.5
		if r.has("ArmR"):
			r["ArmR"].rotation.x = r["ArmR_rest"].x - 1.45 + attack * 0.25


static func set_shadows(root: Node, on: bool) -> void:
	for c in root.find_children("*", "GeometryInstance3D", true, false):
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if on else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


# Вспышка при попадании: временно подменяем материал всех мешей на светлый.
static func flash(root: Node, on: bool) -> void:
	for c in root.find_children("*", "MeshInstance3D", true, false):
		(c as MeshInstance3D).material_overlay = _flash_mat() if on else null


static var _flash: StandardMaterial3D
static func _flash_mat() -> StandardMaterial3D:
	if _flash == null:
		_flash = StandardMaterial3D.new()
		_flash.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_flash.albedo_color = Color(1, 1, 1, 0.55)
		_flash.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return _flash


static func mat(color: Color, emission := 0.0) -> StandardMaterial3D:
	var key := "%s/%s" % [color.to_html(), emission]
	if not _fallback_mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = color
		m.roughness = 0.85
		if emission > 0.0:
			m.emission_enabled = true
			m.emission = color
			m.emission_energy_multiplier = emission
		_fallback_mats[key] = m
	return _fallback_mats[key]


# ---------- заглушки ----------
static func _box(parent: Node3D, name: String, size: Vector3, pos: Vector3, color: Color, pivot := Vector3.ZERO) -> Node3D:
	var holder := Node3D.new()
	holder.name = name
	holder.position = pivot
	parent.add_child(holder)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat(color)
	mi.position = pos - pivot
	holder.add_child(mi)
	return holder


static func _person(root: Node3D, body: Color, skin: Color, legs: Color, h := 1.8, w := 1.0) -> void:
	var k := h / 1.8
	_box(root, "LegL", Vector3(0.18, 0.8, 0.2) * Vector3(w, k, 1), Vector3(-0.12 * w, 0.4 * k, 0), legs, Vector3(-0.12 * w, 0.8 * k, 0))
	_box(root, "LegR", Vector3(0.18, 0.8, 0.2) * Vector3(w, k, 1), Vector3(0.12 * w, 0.4 * k, 0), legs, Vector3(0.12 * w, 0.8 * k, 0))
	var b := _box(root, "Body", Vector3(0.5 * w, 0.62 * k, 0.3 * w), Vector3(0, 1.11 * k, 0), body, Vector3(0, 0.8 * k, 0))
	var head := _box(b, "Head", Vector3(0.3, 0.3, 0.3) * k, Vector3(0, 0.7 * k, 0), skin, Vector3(0, 0.62 * k, 0))
	head.position = Vector3(0, 0.62 * k, 0)
	var al := _box(b, "ArmL", Vector3(0.14, 0.6, 0.14) * Vector3(w, k, w), Vector3(-0.33 * w, 0.28 * k, 0), skin, Vector3(-0.33 * w, 0.56 * k, 0))
	var ar := _box(b, "ArmR", Vector3(0.14, 0.6, 0.14) * Vector3(w, k, w), Vector3(0.33 * w, 0.28 * k, 0), skin, Vector3(0.33 * w, 0.56 * k, 0))
	al.position = Vector3(-0.33 * w, 0.56 * k, 0)
	ar.position = Vector3(0.33 * w, 0.56 * k, 0)
	var hand := Node3D.new()
	hand.name = "Hand"
	hand.position = Vector3(0, -0.55 * k, 0)
	ar.add_child(hand)


static func _placeholder(name: String) -> Node3D:
	var root := Node3D.new()
	root.name = name
	match name:
		"survivor":
			_person(root, Color("e8742a"), Color("e2b48c"), Color("2d3442"))
		"zombie_walker":
			_person(root, Color("3c5a86"), Color("8aa07a"), Color("3b3a38"))
		"zombie_runner":
			_person(root, Color("b8312f"), Color("c9c7b0"), Color("2f2f36"), 1.75, 0.8)
		"zombie_spitter":
			_person(root, Color("8f9a2a"), Color("b8c45a"), Color("4a4630"), 1.6, 1.1)
		"zombie_brute":
			_person(root, Color("d0682a"), Color("8a7f96"), Color("4b3f55"), 2.3, 1.9)
		"zombie_boss":
			_person(root, Color("5a5f66"), Color("7a3f30"), Color("3a2a25"), 3.2, 2.2)
		"house":
			_box(root, "Walls", Vector3(2.8, 2.0, 2.8), Vector3(0, 1.0, 0), Color("b9a68a"))
			_box(root, "Roof", Vector3(3.1, 0.6, 3.1), Vector3(0, 2.3, 0), Color("7c3b2c"))
			var w := MeshInstance3D.new()
			var q := BoxMesh.new()
			q.size = Vector3(0.6, 0.5, 0.05)
			w.mesh = q
			w.material_override = mat(Color("ffcf73"), 2.0)
			w.position = Vector3(0, 1.2, 1.42)
			root.add_child(w)
		"barricade":
			_box(root, "Planks", Vector3(0.95, 0.9, 0.3), Vector3(0, 0.45, 0), Color("8a6440"))
		"wall":
			_box(root, "Block", Vector3(1.0, 1.2, 0.6), Vector3(0, 0.6, 0), Color("8d9196"))
		"spikes":
			for i in 3:
				for j in 3:
					_box(root, "S", Vector3(0.08, 0.45, 0.08), Vector3(-0.3 + i * 0.3, 0.22, -0.3 + j * 0.3), Color("a07a4c"))
		"turret":
			_box(root, "Base", Vector3(0.7, 0.6, 0.7), Vector3(0, 0.3, 0), Color("566070"))
			var h := _box(root, "Head", Vector3(0.45, 0.3, 0.7), Vector3(0, 0.78, 0.15), Color("3d4552"), Vector3(0, 0.78, 0))
			var mz := Node3D.new()
			mz.name = "Muzzle"
			mz.position = Vector3(0, 0, 0.55)
			h.add_child(mz)
		"mine":
			_box(root, "Barrel", Vector3(0.45, 0.6, 0.45), Vector3(0, 0.3, 0), Color("c0392b"))
		"lamp_post":
			_box(root, "Pole", Vector3(0.1, 3.0, 0.1), Vector3(0, 1.5, 0), Color("333840"))
			_box(root, "Bulb", Vector3(0.3, 0.2, 0.3), Vector3(0, 3.0, 0), Color("fff0b0"))
		"tree_pine", "tree_dead":
			_box(root, "Trunk", Vector3(0.3, 1.6, 0.3), Vector3(0, 0.8, 0), Color("5b4030"))
			if name == "tree_pine":
				_box(root, "Crown", Vector3(1.6, 2.4, 1.6), Vector3(0, 2.6, 0), Color("2f5a3a"))
		"rock_a", "rock_b":
			_box(root, "Rock", Vector3(1.0, 0.6, 0.9), Vector3(0, 0.3, 0), Color("6d6f70"))
		"car_wreck":
			_box(root, "Car", Vector3(1.6, 1.0, 3.0), Vector3(0, 0.5, 0), Color("6b4a3a"))
		"gun_pistol", "gun_shotgun", "gun_rifle":
			_box(root, "Gun", Vector3(0.08, 0.1, 0.35 if name == "gun_pistol" else 0.7), Vector3(0, 0, 0.15), Color("22252a"))
		_:
			_box(root, "Prop", Vector3(0.8, 0.8, 0.8), Vector3(0, 0.4, 0), Color("7b6a55"))
	return root
