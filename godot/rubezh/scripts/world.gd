# Уровень: поле 28×28 клеток вокруг дома, день — стройка, ночь — волна зомби.
# Зомби идут к дому по «полю расстояний» (Дейкстра от клеток дома): пустая клетка стоит 1, постройка —
# дороже (её придётся ломать), камни и деревья непроходимы. Поэтому они обходят стены, если обход короче,
# а упёршись — ломают. Герой стреляет сам по ближайшему зомби; игрок водит его и строит днём.
extends Node3D

const D = preload("res://scripts/data.gd")
const M = preload("res://scripts/models.gd")

signal finished(result: Dictionary)

const H := D.MAP_HALF
const N := D.MAP_HALF * 2
const INF := 1.0e9
const DIRS := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
	Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(-1, -1)]

# ---------- настройки уровня ----------
var level: Dictionary
var level_idx := 0
var endless := false
var weapon_id := "pistol"
var up := {}
var hud: Node = null

# ---------- состояние ----------
var phase := "day"        # day | night | over
var night := 1
var nights_total := 3
var day_left := 0.0
var scrap := 0
var house_hp := 0.0
var house_max := 0.0
var reward_used := false
var revive_used := false
var paused := false
var tool := ""            # выбранная постройка
var seen_types := {}      # каких зомби уже показывали (подсказка про нового)
var kills := 0

# ---------- сетка ----------
var solid := {}           # клетка → true: дом, камни, деревья, фонари
var house_cells := {}
var buildings := {}       # клетка → Building
var flow := PackedFloat32Array()
var flow_next := {}       # клетка → следующая клетка к дому
var flow_dirty := true

# ---------- сущности ----------
var hero: Hero
var zombies: Array = []
var spawn_queue: Array = []   # [время, вид, край]
var night_time := 0.0
var pickups: Array = []
var spits: Array = []
var tracers: Array = []
var decals: Array = []
var corpses: Array = []

# ---------- сцена ----------
var cam: Camera3D
var cam_target := Vector3.ZERO
var cam_height := 18.0
var shake := 0.0
var sun: DirectionalLight3D
var env: Environment
var lamps: Array[OmniLight3D] = []
var flashlight: SpotLight3D
var muzzle_light: OmniLight3D
var muzzle_t := 0.0
var grid_mesh: MeshInstance3D
var ghost: Node3D
var ghost_kind := ""
var house_node: Node3D
var blob_mesh: QuadMesh
var blob_mat: StandardMaterial3D
var tracer_mat: StandardMaterial3D
var goo_mat: StandardMaterial3D
var scorch_mat: StandardMaterial3D
var spit_mat: StandardMaterial3D
var scrap_mat: StandardMaterial3D
var fx: Particles
var night_amount := 0.0       # 0 — день, 1 — ночь (плавно)

# ---------- ввод ----------
var touch_index := -1
var touch_start := Vector2.ZERO
var touch_now := Vector2.ZERO
var touch_time := 0
var dragging := false
var stick := Vector2.ZERO
var hover_cell := Vector2i(999, 999)


class Hero:
	var node: Node3D
	var rig: Dictionary
	var gun: Node3D
	var blob: MeshInstance3D
	var pos := Vector3(0.5, 0, 3.0)
	var yaw := PI
	var hp := 100.0
	var max_hp := 100.0
	var dead_t := 0.0
	var cd := 0.0
	var phase := 0.0
	var moving := 0.0
	var recoil := 0.0
	var hurt_t := 0.0
	var target = null


class Zombie:
	var kind := ""
	var def: Dictionary
	var node: Node3D
	var rig: Dictionary
	var blob: MeshInstance3D
	var pos := Vector3.ZERO
	var hp := 1.0
	var max_hp := 1.0
	var speed := 1.0
	var radius := 0.3
	var yaw := 0.0
	var phase := 0.0
	var cd := 0.0
	var spit_cd := 0.0
	var scan_cd := 0.0
	var attack := 0.0
	var slow := 0.0
	var flash := 0.0
	var dead := false
	var shoot_at = null      # цель плевка: Vector3
	var stomp_cd := 3.0
	var groan_cd := 0.0


class Building:
	var kind := ""
	var cell := Vector2i.ZERO
	var hp := 1.0
	var max_hp := 1.0
	var node: Node3D
	var head: Node3D
	var muzzle: Node3D
	var cd := 0.0
	var target = null
	var placed_night := 0
	var shake := 0.0


# Частицы: брызги, искры, щепки — один MultiMesh, без узлов на каждую частицу.
class Particles extends MultiMeshInstance3D:
	const MAX := 320
	var pos := PackedVector3Array()
	var vel := PackedVector3Array()
	var life := PackedFloat32Array()
	var size := PackedFloat32Array()
	var col := PackedColorArray()
	var next := 0

	func setup() -> void:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		var bm := BoxMesh.new()
		bm.size = Vector3(1, 1, 1)
		mm.mesh = bm
		mm.instance_count = MAX
		multimesh = mm
		var m := StandardMaterial3D.new()
		m.vertex_color_use_as_albedo = true
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		material_override = m
		cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		pos.resize(MAX); vel.resize(MAX); life.resize(MAX); size.resize(MAX); col.resize(MAX)
		for i in MAX:
			mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))

	func burst(at: Vector3, n: int, color: Color, speed := 3.0, sz := 0.09, up := 2.5) -> void:
		for k in n:
			var i := next
			next = (next + 1) % MAX
			pos[i] = at
			var a := randf() * TAU
			var s := randf_range(0.3, 1.0) * speed
			vel[i] = Vector3(cos(a) * s, randf_range(0.5, 1.0) * up, sin(a) * s)
			life[i] = randf_range(0.35, 0.7)
			size[i] = sz * randf_range(0.6, 1.3)
			col[i] = color.darkened(randf() * 0.25)

	func step(dt: float) -> void:
		var mm := multimesh
		for i in MAX:
			if life[i] <= 0.0:
				continue
			life[i] -= dt
			vel[i].y -= 9.0 * dt
			pos[i] += vel[i] * dt
			if pos[i].y < 0.03:
				pos[i].y = 0.03
				vel[i] *= 0.5
			var s := size[i] * clampf(life[i] * 3.0, 0.0, 1.0)
			mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(s, s, s)), pos[i]))
			mm.set_instance_color(i, col[i])


# =====================================================================
#   Запуск уровня
# =====================================================================

func setup(p_level: Dictionary, p_idx: int, p_endless: bool, p_weapon: String, p_up: Dictionary) -> void:
	level = p_level
	level_idx = p_idx
	endless = p_endless
	weapon_id = p_weapon
	up = p_up
	nights_total = 9999 if endless else int(level.nights)
	scrap = int(level.scrap) + int(_up("scrap") * D.UPGRADES.scrap.step)
	house_max = D.HOUSE_HP * (1.0 + _up("house") * D.UPGRADES.house.step)
	house_hp = house_max
	_build_scene()
	_place_props()
	_rebuild_flow()
	_spawn_hero()
	_start_day(true)


func _up(key: String) -> int:
	return int(up.get(key, 0))


func _build_scene() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-58, -32, 0)
	sun.shadow_enabled = true
	sun.shadow_blur = 1.5
	sun.directional_shadow_max_distance = 40.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	add_child(sun)

	cam = Camera3D.new()
	cam.fov = 36.0
	cam.near = 1.0
	cam.far = 90.0
	add_child(cam)
	cam.current = true

	# Земля: трава на всё поле и утоптанная земля там, где можно строить.
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(70, 70)
	ground.mesh = pm
	ground.position = Vector3(0.5, 0, 0.5)
	var gm := StandardMaterial3D.new()
	var grass = _tex("ground_grass.jpg")
	if grass:
		gm.albedo_texture = grass
		gm.uv1_scale = Vector3(70.0 / 8.0, 70.0 / 8.0, 1)
		gm.albedo_color = level.ground.lightened(0.6)
	else:
		gm.albedo_color = level.ground
	gm.roughness = 1.0
	ground.material_override = gm
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ground)

	var zone := MeshInstance3D.new()
	var zp := PlaneMesh.new()
	var zs := D.BUILD_RADIUS * 2 + 1
	zp.size = Vector2(zs, zs)
	zone.mesh = zp
	zone.position = Vector3(0.5, 0.004, 0.5)
	var zm := StandardMaterial3D.new()
	var dirt = _tex("ground_dirt.jpg")
	if dirt:
		zm.albedo_texture = dirt
		zm.uv1_scale = Vector3(zs / 8.0, zs / 8.0, 1)
	else:
		zm.albedo_color = Color("7a6650")
	zm.roughness = 1.0
	zone.material_override = zm
	zone.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(zone)

	_build_grid_lines()

	# Дом в центре: клетки −1…1.
	house_node = M.make("house")
	house_node.position = Vector3(0.5, 0, 0.5)
	add_child(house_node)
	for x in range(-D.HOUSE_HALF, D.HOUSE_HALF + 1):
		for z in range(-D.HOUSE_HALF, D.HOUSE_HALF + 1):
			solid[Vector2i(x, z)] = true
			house_cells[Vector2i(x, z)] = true

	# Фонари по углам двора: ночью это главный свет.
	for c in [Vector2i(-3, -3), Vector2i(3, -3), Vector2i(-3, 3), Vector2i(3, 3)]:
		var lp := M.make("lamp_post")
		lp.position = _center(c)
		add_child(lp)
		solid[c] = true
		var l := OmniLight3D.new()
		l.position = _center(c) + Vector3(0, 2.8, 0)
		l.light_color = Color("ffc982")
		l.omni_range = 7.5
		l.omni_attenuation = 1.2
		l.light_energy = 0.0
		add_child(l)
		lamps.append(l)

	muzzle_light = OmniLight3D.new()
	muzzle_light.light_color = Color("ffd27a")
	muzzle_light.omni_range = 5.0
	muzzle_light.light_energy = 0.0
	add_child(muzzle_light)

	# Общие материалы и меши.
	blob_mesh = QuadMesh.new()
	blob_mesh.size = Vector2(1, 1)
	blob_mesh.orientation = PlaneMesh.FACE_Y
	blob_mat = StandardMaterial3D.new()
	blob_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	blob_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var grad := Gradient.new()
	grad.set_color(0, Color(0, 0, 0, 0.42))
	grad.set_color(1, Color(0, 0, 0, 0))
	var gt := GradientTexture2D.new()
	gt.gradient = grad
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(1.0, 0.5)
	gt.width = 64
	gt.height = 64
	blob_mat.albedo_texture = gt

	tracer_mat = StandardMaterial3D.new()
	tracer_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	tracer_mat.albedo_color = Color(1.0, 0.86, 0.5)
	for i in 24:
		var t := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(1, 1, 1)
		t.mesh = bm
		t.material_override = tracer_mat
		t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		t.visible = false
		add_child(t)
		tracers.append({"node": t, "life": 0.0, "a": Vector3.ZERO, "b": Vector3.ZERO})

	goo_mat = _decal_mat("goo.png", Color(0.2, 0.24, 0.12, 0.85))
	scorch_mat = _decal_mat("scorch.png", Color(0.05, 0.05, 0.05, 0.8))
	spit_mat = M.mat(Color("b6e04a"), 2.5)
	scrap_mat = StandardMaterial3D.new()
	scrap_mat.albedo_color = Color("b9bec6")
	scrap_mat.metallic = 0.8
	scrap_mat.roughness = 0.35

	fx = Particles.new()
	add_child(fx)
	fx.setup()


func _tex(file: String) -> Texture2D:
	var p := "res://assets/textures/" + file
	return load(p) if ResourceLoader.exists(p) else null


func _decal_mat(file: String, fallback: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
	m.roughness = 1.0
	var t := _tex(file)
	if t:
		m.albedo_texture = t
	else:
		m.albedo_color = fallback
	return m


func _build_grid_lines() -> void:
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	var r := D.BUILD_RADIUS
	for i in range(-r, r + 2):
		im.surface_add_vertex(Vector3(i, 0.01, -r))
		im.surface_add_vertex(Vector3(i, 0.01, r + 1))
		im.surface_add_vertex(Vector3(-r, 0.01, i))
		im.surface_add_vertex(Vector3(r + 1, 0.01, i))
	im.surface_end()
	grid_mesh = MeshInstance3D.new()
	grid_mesh.mesh = im
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(1, 1, 1, 0.13)
	grid_mesh.material_override = m
	grid_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(grid_mesh)


# Камни, деревья, машины: по краям поля и немного во дворе. Раскладка своя у каждого уровня (seed),
# проход к дому со всех сторон, откуда идут зомби, остаётся.
func _place_props() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(level.seed)
	var kinds := ["tree_pine", "tree_pine", "tree_dead", "rock_a", "rock_b", "crate", "barrel_rusty", "hay_bale", "tires"]
	var placed := 0
	var tries := 0
	while placed < 26 and tries < 400:
		tries += 1
		var c := Vector2i(rng.randi_range(-H, H - 1), rng.randi_range(-H, H - 1))
		var ring := maxi(absi(c.x), absi(c.y))
		if ring <= D.BUILD_RADIUS + 1 or solid.has(c):
			continue
		_add_prop(kinds[rng.randi() % kinds.size()], c, rng)
		placed += 1
	# Пара препятствий во дворе — вокруг них удобно строить.
	var inner := 0
	tries = 0
	while inner < 3 and tries < 100:
		tries += 1
		var c := Vector2i(rng.randi_range(-D.BUILD_RADIUS + 1, D.BUILD_RADIUS - 1), rng.randi_range(-D.BUILD_RADIUS + 1, D.BUILD_RADIUS - 1))
		var ring := maxi(absi(c.x), absi(c.y))
		if ring < 4 or solid.has(c):
			continue
		_add_prop(["rock_a", "rock_b", "crate"][rng.randi() % 3], c, rng)
		inner += 1
	# Машина-развалина у края: занимает три клетки.
	var car := Vector2i(rng.randi_range(-H + 2, H - 4), [-H + 2, H - 3][rng.randi() % 2])
	if not solid.has(car):
		var n := M.make("car_wreck")
		n.position = _center(car) + Vector3(0, 0, 1.0)
		n.rotation.y = PI / 2 if rng.randf() < 0.5 else 0.0
		add_child(n)
		for dz in range(0, 3):
			solid[car + Vector2i(0, dz)] = true
	# Лес за краем поля: декорация, в расчётах не участвует.
	for i in 90:
		var a := rng.randf() * TAU
		var r := rng.randf_range(H + 1.5, H + 9.0)
		var p := Vector3(0.5 + cos(a) * r, 0, 0.5 + sin(a) * r)
		if absf(p.x) < H + 1 and absf(p.z) < H + 1:
			continue
		var t := M.make("tree_pine" if rng.randf() < 0.75 else "tree_dead")
		t.position = p
		t.rotation.y = rng.randf() * TAU
		t.scale = Vector3.ONE * rng.randf_range(0.9, 1.4)
		add_child(t)
	_ensure_paths()


func _add_prop(kind: String, c: Vector2i, rng: RandomNumberGenerator) -> void:
	var n := M.make(kind)
	n.position = _center(c)
	n.rotation.y = rng.randf() * TAU
	if kind.begins_with("tree"):
		n.scale = Vector3.ONE * rng.randf_range(0.85, 1.2)
	add_child(n)
	solid[c] = true
	n.set_meta("cell", c)


# Если какой-то край отрезан от дома камнями, убираем мешающие препятствия.
func _ensure_paths() -> void:
	for attempt in 30:
		_rebuild_flow()
		var bad := Vector2i(999, 999)
		for e in ["n", "e", "s", "w"]:
			for k in range(-H + 2, H - 2, 3):
				var c := _edge_cell(e, k)
				if flow[_idx(c)] >= INF:
					bad = c
					break
			if bad.x != 999:
				break
		if bad.x == 999:
			return
		# Убираем ближайшее к отрезанной клетке препятствие (не дом и не фонарь).
		var best := Vector2i(999, 999)
		var bd := 1e9
		for c in solid.keys():
			if house_cells.has(c) or maxi(absi(c.x), absi(c.y)) == 3:
				continue
			var d := Vector2(c - bad).length()
			if d < bd:
				bd = d
				best = c
		if best.x == 999:
			return
		solid.erase(best)
		for ch in get_children():
			if ch.has_meta("cell") and ch.get_meta("cell") == best:
				ch.queue_free()


func _edge_cell(e: String, k: int) -> Vector2i:
	match e:
		"n": return Vector2i(k, -H)
		"s": return Vector2i(k, H - 1)
		"w": return Vector2i(-H, k)
		_: return Vector2i(H - 1, k)


func _spawn_hero() -> void:
	hero = Hero.new()
	hero.max_hp = D.PLAYER_HP + _up("health") * D.UPGRADES.health.step
	hero.hp = hero.max_hp
	hero.node = M.make("survivor")
	add_child(hero.node)
	M.set_shadows(hero.node, false)
	hero.rig = M.rig(hero.node)
	hero.blob = _blob(0.9)
	_attach_gun()
	flashlight = SpotLight3D.new()
	flashlight.light_color = Color("fff1d0")
	flashlight.spot_range = 11.0
	flashlight.spot_angle = 32.0
	flashlight.spot_attenuation = 1.0
	flashlight.light_energy = 0.0
	add_child(flashlight)


func _attach_gun() -> void:
	if hero.gun:
		hero.gun.queue_free()
	hero.gun = M.make("gun_" + weapon_id)
	var hand: Node3D = hero.rig.get("Hand", hero.node)
	hand.add_child(hero.gun)
	# Рука поднята вперёд: ствол — вдоль руки, «вниз» в её системе координат.
	hero.gun.rotation = Vector3(PI / 2, 0, 0)


func _blob(size: float) -> MeshInstance3D:
	var b := MeshInstance3D.new()
	b.mesh = blob_mesh
	b.material_override = blob_mat
	b.scale = Vector3(size, 1, size)
	b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(b)
	return b


# =====================================================================
#   Сетка и путь к дому
# =====================================================================

func _idx(c: Vector2i) -> int:
	return (c.x + H) + (c.y + H) * N


func _inside(c: Vector2i) -> bool:
	return c.x >= -H and c.x < H and c.y >= -H and c.y < H


func _center(c: Vector2i) -> Vector3:
	return Vector3(c.x + 0.5, 0, c.y + 0.5)


func cell_of(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x), floori(p.z))


func _cost(c: Vector2i) -> float:
	if house_cells.has(c):
		return 0.0
	if solid.has(c):
		return INF
	var b: Building = buildings.get(c)
	if b:
		return float(D.BUILDINGS[b.kind].path_cost)
	return 1.0


func _passable_corner(a: Vector2i, d: Vector2i) -> bool:
	# По диагонали нельзя протиснуться между двумя занятыми клетками.
	var c1 := a + Vector2i(d.x, 0)
	var c2 := a + Vector2i(0, d.y)
	return not (_blocks(c1) or _blocks(c2))


func _blocks(c: Vector2i) -> bool:
	if solid.has(c) and not house_cells.has(c):
		return true
	var b: Building = buildings.get(c)
	return b != null and bool(D.BUILDINGS[b.kind].block)


func _rebuild_flow() -> void:
	flow_dirty = false
	flow.resize(N * N)
	flow.fill(INF)
	var heap: Array = []   # [расстояние, клетка] — простая двоичная куча
	for c in house_cells.keys():
		flow[_idx(c)] = 0.0
		_heap_push(heap, [0.0, c])
	while not heap.is_empty():
		var top: Array = _heap_pop(heap)
		var d: float = top[0]
		var c: Vector2i = top[1]
		if d > flow[_idx(c)]:
			continue
		for dir in DIRS:
			var n: Vector2i = c + dir
			if not _inside(n) or house_cells.has(n):
				continue
			var k := _cost(n)
			if k >= INF:
				continue
			var diag: bool = dir.x != 0 and dir.y != 0
			if diag and not _passable_corner(c, dir):
				continue
			var nd := d + k * (1.4142 if diag else 1.0)
			if nd < flow[_idx(n)]:
				flow[_idx(n)] = nd
				_heap_push(heap, [nd, n])
	flow_next.clear()


func _heap_push(h: Array, item: Array) -> void:
	h.append(item)
	var i := h.size() - 1
	while i > 0:
		var p := (i - 1) >> 1
		if h[p][0] <= h[i][0]:
			break
		var t = h[p]; h[p] = h[i]; h[i] = t
		i = p


func _heap_pop(h: Array) -> Array:
	var top: Array = h[0]
	var last: Array = h.pop_back()
	if not h.is_empty():
		h[0] = last
		var i := 0
		var n := h.size()
		while true:
			var l := i * 2 + 1
			var r := l + 1
			var m := i
			if l < n and h[l][0] < h[m][0]:
				m = l
			if r < n and h[r][0] < h[m][0]:
				m = r
			if m == i:
				break
			var t = h[m]; h[m] = h[i]; h[i] = t
			i = m
	return top


# Следующая клетка на пути к дому. За краем поля — шаг внутрь.
func _next_cell(c: Vector2i) -> Vector2i:
	if not _inside(c):
		return Vector2i(clampi(c.x, -H, H - 1), clampi(c.y, -H, H - 1))
	if flow_next.has(c):
		return flow_next[c]
	var best := c
	var bd := flow[_idx(c)]
	for dir in DIRS:
		var n: Vector2i = c + dir
		if not _inside(n):
			continue
		if dir.x != 0 and dir.y != 0 and not _passable_corner(c, dir):
			continue
		var d := flow[_idx(n)]
		if house_cells.has(n):
			d = -1.0
		if d < bd:
			bd = d
			best = n
	flow_next[c] = best
	return best


# =====================================================================
#   День и ночь
# =====================================================================

func _start_day(first := false) -> void:
	phase = "day"
	day_left = D.DAY_SECONDS + (15.0 if first else 0.0)
	reward_used = false
	grid_mesh.visible = true
	Sfx.music("day")
	Sdk.gameplay(true)
	if hud:
		hud.on_day(night, nights_total, first)


func start_night() -> void:
	if phase != "day":
		return
	phase = "night"
	set_tool("")
	grid_mesh.visible = false
	night_time = 0.0
	spawn_queue = _plan_night()
	Sfx.play("night", null, -2.0, 0.0)
	Sfx.music("night")
	if hud:
		hud.on_night(night, nights_total)
		var fresh: Array = []
		for s in spawn_queue:
			if not seen_types.has(s[1]) and s[1] != "walker":
				seen_types[s[1]] = true
				fresh.append(s[1])
		for k in fresh:
			hud.toast_new_enemy(k)
	seen_types["walker"] = true


# Состав ночи: «бюджет» растёт от ночи к ночи, из него набираются зомби доступных видов.
func _plan_night() -> Array:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(level.seed) * 1000 + night
	var budget: float = float(level.budget) * pow(float(level.grow), night - 1)
	var types: Array = level.types.duplicate()
	if endless:
		types = ["walker"]
		if night >= 2: types.append("runner")
		if night >= 4: types.append("spitter")
		if night >= 6: types.append("brute")
	var boss: bool = (not endless and level.get("boss", false) and night == nights_total) or (endless and night % 10 == 0)
	if boss:
		budget *= 0.6
	var list: Array = []
	var weights := {"walker": 5.0, "runner": 3.0, "spitter": 2.0, "brute": 1.0}
	while budget > 0.6:
		var pool: Array = []
		var total := 0.0
		for t in types:
			var cost: float = D.ZOMBIES[t].cost
			if cost <= budget + 0.5:
				pool.append(t)
				total += weights[t]
		if pool.is_empty():
			break
		var r := rng.randf() * total
		var pick: String = pool[0]
		for t in pool:
			r -= weights[t]
			if r <= 0.0:
				pick = t
				break
		list.append(pick)
		budget -= D.ZOMBIES[pick].cost
	list.shuffle()
	# Зомби идут группами с разных сторон; пауза между группами сокращается к концу ночи.
	var edges: Array = level.edges
	var queue: Array = []
	var t := 2.5
	var i := 0
	while i < list.size():
		var group := mini(rng.randi_range(3, 6), list.size() - i)
		var edge: String = edges[rng.randi() % edges.size()]
		for g in group:
			queue.append([t + g * 0.45, list[i + g], edge])
		i += group
		t += lerpf(7.0, 3.5, float(i) / list.size()) + group * 0.4
	if boss:
		queue.append([t + 3.0, "boss", edges[rng.randi() % edges.size()]])
	return queue


func _dawn() -> void:
	# Хлам, который не успели подобрать, долетает до героя сам.
	for p in pickups:
		scrap += int(p.value)
		p.node.queue_free()
	pickups.clear()
	var bonus := 12 + night * 4
	scrap += bonus
	hero.hp = hero.max_hp
	Sfx.play("dawn", null, -2.0, 0.0)
	if endless:
		Sdk.set_score("nights", night)
	if not endless and night >= nights_total:
		_finish(true)
		return
	if hud:
		hud.on_dawn(night, bonus)
	night += 1
	_start_day()


func _finish(win: bool) -> void:
	if phase == "over":
		return
	phase = "over"
	set_tool("")
	Sdk.gameplay(false)
	Sfx.music("")
	Sfx.play("win" if win else "lose", null, -1.0, 0.0)
	var ratio := house_hp / house_max
	var stars := 0
	if win:
		stars = 3 if ratio >= 0.8 else (2 if ratio >= 0.4 else 1)
	finished.emit({"win": win, "stars": stars, "nights": night - (0 if win else 1), "endless": endless,
		"level": level_idx, "kills": kills, "house": ratio})


# Реклама за награду днём: +хлам, раз в день.
func reward_scrap() -> void:
	if phase != "day" or reward_used:
		return
	reward_used = true
	if await Sdk.rewarded():
		scrap += D.REWARD_SCRAP
		Sfx.play("scrap", null, 0.0, 0.0)
	if hud:
		hud.refresh()


# Дом разрушен: один раз за уровень можно починить его за рекламу и продолжить ночь.
func revive() -> bool:
	if revive_used:
		return false
	revive_used = true
	if await Sdk.rewarded():
		house_hp = house_max * 0.5
		phase = "night"
		Sdk.gameplay(true)
		Sfx.music("night")
		# Отбрасываем зомби от дома взрывной волной, иначе сразу снова проигрыш.
		for z in zombies:
			if not z.dead and z.pos.distance_to(Vector3(0.5, 0, 0.5)) < 5.0:
				_damage_zombie(z, 9999.0, Vector3(0.5, 0, 0.5))
		_explosion_fx(Vector3(0.5, 0, 0.5), 2.0)
		return true
	return false


# =====================================================================
#   Стройка
# =====================================================================

func set_tool(kind: String) -> void:
	tool = kind
	if ghost:
		ghost.queue_free()
		ghost = null
	ghost_kind = ""
	if hud:
		hud.on_tool(kind)


func can_build(kind: String, c: Vector2i) -> bool:
	if phase != "day" or kind == "":
		return false
	if maxi(absi(c.x), absi(c.y)) > D.BUILD_RADIUS:
		return false
	if solid.has(c) or buildings.has(c):
		return false
	if scrap < int(D.BUILDINGS[kind].cost):
		return false
	# Не строим на герое: проверяем, не заходит ли его круг в клетку.
	var cx := clampf(hero.pos.x, c.x, c.x + 1)
	var cz := clampf(hero.pos.z, c.y, c.y + 1)
	if Vector2(cx - hero.pos.x, cz - hero.pos.z).length() < 0.3 and bool(D.BUILDINGS[kind].block):
		return false
	return true


func build(kind: String, c: Vector2i) -> bool:
	if not can_build(kind, c):
		return false
	var def: Dictionary = D.BUILDINGS[kind]
	scrap -= int(def.cost)
	print("BUILD ", kind, " ", c)
	var b := Building.new()
	b.kind = kind
	b.cell = c
	b.max_hp = float(def.hp) * (1.0 + _up("armor") * D.UPGRADES.armor.step)
	b.hp = b.max_hp
	b.placed_night = night
	b.node = M.make(kind)
	b.node.position = _center(c)
	add_child(b.node)
	if kind == "turret":
		b.head = b.node.find_child("Head", true, false)
		b.muzzle = b.node.find_child("Muzzle", true, false)
	if kind == "barricade" or kind == "wall":
		# Стенки поворачиваем вдоль соседних, чтобы ряд выглядел ровно.
		var horiz := buildings.has(c + Vector2i(1, 0)) or buildings.has(c + Vector2i(-1, 0))
		b.node.rotation.y = 0.0 if horiz or not (buildings.has(c + Vector2i(0, 1)) or buildings.has(c + Vector2i(0, -1))) else PI / 2
	buildings[c] = b
	b.node.scale = Vector3(1, 0.2, 1)
	create_tween().tween_property(b.node, "scale", Vector3.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	fx.burst(_center(c) + Vector3(0, 0.2, 0), 8, Color("9a8366"), 1.5, 0.07, 1.5)
	Sfx.play("build", _center(c))
	flow_dirty = true
	if hud:
		hud.refresh()
	return true


func building_at(c: Vector2i) -> Building:
	return buildings.get(c)


func repair_cost(c: Vector2i) -> int:
	if house_cells.has(c):
		return int(ceil((house_max - house_hp) / 5.0))
	var b: Building = buildings.get(c)
	if b == null or b.hp >= b.max_hp:
		return 0
	return maxi(1, int(ceil((1.0 - b.hp / b.max_hp) * float(D.BUILDINGS[b.kind].cost) * 0.6)))


func refund(c: Vector2i) -> int:
	var b: Building = buildings.get(c)
	if b == null:
		return 0
	var cost := int(D.BUILDINGS[b.kind].cost)
	# Построил сегодня и передумал — деньги назад целиком.
	if b.placed_night == night and phase == "day" and b.hp >= b.max_hp:
		return cost
	return int(cost * 0.5 * b.hp / b.max_hp)


func repair(c: Vector2i) -> void:
	var cost := repair_cost(c)
	if cost <= 0 or cost > scrap:
		return
	scrap -= cost
	if house_cells.has(c):
		house_hp = house_max
	else:
		var b: Building = buildings[c]
		b.hp = b.max_hp
	Sfx.play("build", _center(c))
	if hud:
		hud.refresh()


func sell(c: Vector2i) -> void:
	var b: Building = buildings.get(c)
	if b == null:
		return
	scrap += refund(c)
	_remove_building(b, false)
	Sfx.play("sell", _center(c))
	if hud:
		hud.refresh()


func _remove_building(b: Building, broken: bool) -> void:
	buildings.erase(b.cell)
	flow_dirty = true
	if broken:
		fx.burst(_center(b.cell) + Vector3(0, 0.5, 0), 16, Color("7a5a3a") if b.kind != "wall" else Color("8d9196"), 3.0, 0.12, 3.0)
		Sfx.play("break", _center(b.cell))
		shake = maxf(shake, 0.15)
	b.node.queue_free()


# =====================================================================
#   Кадр
# =====================================================================

func _process(delta: float) -> void:
	if paused or phase == "over":
		_update_camera(delta, true)
		return
	var dt := minf(delta, 0.05)
	if flow_dirty:
		_rebuild_flow()
	if phase == "day":
		day_left -= dt
		if day_left <= 0.0:
			start_night()
	else:
		night_time += dt
		while not spawn_queue.is_empty() and spawn_queue[0][0] <= night_time:
			var s: Array = spawn_queue.pop_front()
			_spawn_zombie(s[1], s[2])
		if spawn_queue.is_empty() and zombies.is_empty():
			_dawn()
	_update_light(dt)
	_update_hero(dt)
	_update_zombies(dt)
	_update_buildings(dt)
	_update_spits(dt)
	_update_pickups(dt)
	_update_fx(dt)
	_update_camera(dt, false)
	_update_ghost()
	if hud:
		hud.tick()


func _update_light(dt: float) -> void:
	var target := 1.0 if phase == "night" else 0.0
	night_amount = move_toward(night_amount, target, dt * 0.6)
	var n := night_amount
	sun.light_color = Color("ffe2b8").lerp(Color("7f9dd6"), n)
	sun.light_energy = lerpf(1.25, 0.32, n)
	env.background_color = Color("9db6c4").lerp(Color("0b1020"), n)
	env.ambient_light_color = Color("c9c2b4").lerp(Color("33456e"), n)
	env.ambient_light_energy = lerpf(0.55, 0.45, n)
	for l in lamps:
		l.light_energy = n * 2.4
	flashlight.light_energy = n * 3.2 if hero.dead_t <= 0.0 else 0.0
	if muzzle_t > 0.0:
		muzzle_t -= dt
		muzzle_light.light_energy = (0.6 + n * 2.2) * clampf(muzzle_t / 0.06, 0.0, 1.0)
	else:
		muzzle_light.light_energy = 0.0


# ---------- герой ----------

func _update_hero(dt: float) -> void:
	var h := hero
	if h.dead_t > 0.0:
		h.dead_t -= dt
		if h.dead_t <= 0.0:
			h.hp = h.max_hp
			h.pos = Vector3(0.5, 0, 2.6)
			h.node.rotation = Vector3.ZERO
			h.node.visible = true
		_place_actor(h.node, h.blob, h.pos, h.yaw)
		return
	var input := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if stick.length() > 0.05:
		input = stick
	var vel := Vector3(input.x, 0, input.y) * D.PLAYER_SPEED
	h.moving = move_toward(h.moving, clampf(input.length(), 0.0, 1.0), dt * 6.0)
	if input.length() > 0.05:
		h.pos = _collide(h.pos + vel * dt, 0.3, true)
		h.phase += dt * 11.0 * h.moving
	h.pos.x = clampf(h.pos.x, -H + 0.4, H - 0.4)
	h.pos.z = clampf(h.pos.z, -H + 0.4, H - 0.4)
	Sfx.listener = h.pos

	# Цель — ближайший зомби в радиусе оружия; без цели смотрим, куда идём.
	var w: Dictionary = D.WEAPONS[weapon_id]
	var target = _nearest_zombie(h.pos, float(w.range))
	h.target = target
	var face := h.yaw
	if target != null:
		face = atan2(target.pos.x - h.pos.x, target.pos.z - h.pos.z)
	elif input.length() > 0.1:
		face = atan2(input.x, input.y)
	h.yaw = lerp_angle(h.yaw, face, clampf(dt * 14.0, 0.0, 1.0))
	h.cd -= dt
	h.recoil = move_toward(h.recoil, 0.0, dt * 6.0)
	if target != null and h.cd <= 0.0 and absf(angle_difference(h.yaw, face)) < 0.35:
		_hero_shoot(target)
		h.cd = float(w.every) / (1.0 + _up("rate") * D.UPGRADES.rate.step)
	if h.hurt_t > 0.0:
		h.hurt_t -= dt
		M.flash(h.node, h.hurt_t > 0.0)
	M.animate(h.rig, h.phase, h.moving, "hero", h.recoil)
	_place_actor(h.node, h.blob, h.pos, h.yaw)
	var fwd := Vector3(sin(h.yaw), 0, cos(h.yaw))
	flashlight.global_transform = Transform3D(Basis.looking_at(fwd * 4.0 + Vector3(0, -1.6, 0)), h.pos + Vector3(0, 1.7, 0))


func _place_actor(node: Node3D, blob: MeshInstance3D, pos: Vector3, yaw: float) -> void:
	node.position = pos
	node.rotation.y = yaw
	blob.position = pos + Vector3(0, 0.02, 0)


func _gun_tip() -> Vector3:
	var fwd := Vector3(sin(hero.yaw), 0, cos(hero.yaw))
	return hero.pos + fwd * 0.75 + Vector3(0, 1.25, 0)


func _hero_shoot(target: Zombie) -> void:
	var w: Dictionary = D.WEAPONS[weapon_id]
	var dmg: float = float(w.damage) * (1.0 + _up("damage") * D.UPGRADES.damage.step)
	var from := _gun_tip()
	var aim := (target.pos + Vector3(0, 1.0, 0) - from)
	aim.y = 0
	aim = aim.normalized()
	for p in int(w.pellets):
		var dir := aim
		if float(w.spread) > 0.0:
			dir = aim.rotated(Vector3.UP, randf_range(-float(w.spread), float(w.spread)) * 0.5)
		var hits := _ray(from, dir, float(w.range), int(w.pierce))
		var end := from + dir * float(w.range)
		for z in hits:
			_damage_zombie(z, dmg, from)
			end = Vector3(z.pos.x, from.y, z.pos.z)
		_tracer(from, end)
	hero.recoil = 1.0
	muzzle_t = 0.06
	muzzle_light.position = from
	fx.burst(from, 3, Color(1.0, 0.85, 0.4), 1.2, 0.06, 0.6)
	Sfx.play("shot_" + weapon_id, hero.pos, -3.0)


# Кто попадает под выстрел: зомби вдоль луча, ближние первыми, не больше pierce.
func _ray(from: Vector3, dir: Vector3, length: float, pierce: int) -> Array:
	var hits: Array = []
	for z in zombies:
		if z.dead:
			continue
		var to := Vector3(z.pos.x - from.x, 0, z.pos.z - from.z)
		var along := to.dot(dir)
		if along < 0.0 or along > length + z.radius:
			continue
		var side := (to - dir * along).length()
		if side <= z.radius + 0.18:
			hits.append([along, z])
	hits.sort_custom(func(a, b): return a[0] < b[0])
	var out: Array = []
	for i in mini(pierce, hits.size()):
		out.append(hits[i][1])
	return out


func _nearest_zombie(p: Vector3, r: float) -> Variant:
	var best = null
	var bd := r * r
	for z in zombies:
		if z.dead:
			continue
		var d := Vector2(z.pos.x - p.x, z.pos.z - p.z).length_squared()
		if d < bd:
			bd = d
			best = z
	return best


func _hurt_hero(dmg: float) -> void:
	if hero.dead_t > 0.0:
		return
	hero.hp -= dmg
	hero.hurt_t = 0.12
	shake = maxf(shake, 0.12)
	Sfx.play("hurt", hero.pos, -2.0)
	if hero.hp <= 0.0:
		hero.hp = 0.0
		hero.dead_t = 4.0
		hero.node.rotation.x = -PI / 2
		fx.burst(hero.pos + Vector3(0, 0.8, 0), 14, Color("6b2a20"), 2.5, 0.1, 2.5)
		if hud:
			hud.toast("Героя ранили. Он вернётся через 4 секунды — дом пока держат постройки.")


# Не проходим сквозь дом, камни и постройки-преграды: выталкиваем круг из занятых клеток.
func _collide(p: Vector3, r: float, is_hero: bool) -> Vector3:
	var c := cell_of(p)
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var n := c + Vector2i(dx, dz)
			if not (_blocks(n) or house_cells.has(n)):
				continue
			if is_hero and buildings.has(n) and not bool(D.BUILDINGS[buildings[n].kind].block):
				continue
			var qx := clampf(p.x, n.x, n.x + 1)
			var qz := clampf(p.z, n.y, n.y + 1)
			var d := Vector2(p.x - qx, p.z - qz)
			var l := d.length()
			if l < r:
				if l < 0.0001:
					d = Vector2(p.x - (n.x + 0.5), p.z - (n.y + 0.5)).normalized()
					l = 0.0
				else:
					d /= l
				p.x += d.x * (r - l)
				p.z += d.y * (r - l)
	return p


# ---------- зомби ----------

func _spawn_zombie(kind: String, edge: String) -> void:
	var z := Zombie.new()
	z.kind = kind
	z.def = D.ZOMBIES[kind]
	var k := 1.0
	if endless:
		k = 1.0 + maxf(0.0, night - 8) * 0.06
	z.max_hp = float(z.def.hp) * k
	z.hp = z.max_hp
	z.speed = float(z.def.speed) * randf_range(0.9, 1.1)
	z.radius = float(z.def.radius)
	var along := randf_range(-H + 2.0, H - 2.0)
	match edge:
		"n": z.pos = Vector3(along, 0, -H - 1.5)
		"s": z.pos = Vector3(along, 0, H + 1.5)
		"w": z.pos = Vector3(-H - 1.5, 0, along)
		_: z.pos = Vector3(H + 1.5, 0, along)
	z.node = M.make("zombie_" + kind)
	add_child(z.node)
	M.set_shadows(z.node, false)
	z.rig = M.rig(z.node)
	z.blob = _blob(z.radius * 3.0)
	z.phase = randf() * TAU
	z.groan_cd = randf_range(1.0, 6.0)
	z.spit_cd = randf_range(0.5, 1.5)
	zombies.append(z)
	if kind == "boss":
		Sfx.play("brute_roar", null, 2.0, 0.0)
		shake = 0.4
		if hud:
			hud.show_boss(true)


func _update_zombies(dt: float) -> void:
	var house_c := Vector3(0.5, 0, 0.5)
	for z in zombies:
		if z.dead:
			continue
		var c := cell_of(z.pos)
		var slow := 1.0
		var b_here: Building = buildings.get(c)
		if b_here and b_here.kind == "spikes":
			slow = D.SPIKES.slow
			z.hp -= D.SPIKES.dps * dt
			b_here.hp -= D.SPIKES.wear * dt
			if randf() < dt * 3.0:
				fx.burst(z.pos + Vector3(0, 0.3, 0), 1, Color("4a5a2a"), 1.0, 0.06, 1.0)
			if b_here.hp <= 0.0:
				_remove_building(b_here, true)
			if z.hp <= 0.0:
				_kill_zombie(z, z.pos + Vector3(0, 0, 1))
				continue
		elif b_here and b_here.kind == "mine":
			_explode_mine(b_here)
			if z.dead:
				continue
		z.cd -= dt
		z.attack = move_toward(z.attack, 0.0, dt * 3.0)
		z.flash -= dt
		if z.flash <= 0.0 and z.flash > -dt * 2.0:
			M.flash(z.node, false)
		z.groan_cd -= dt
		if z.groan_cd <= 0.0:
			z.groan_cd = randf_range(4.0, 9.0)
			Sfx.play("zombie_groan%d" % (randi() % 3 + 1), z.pos, -8.0, 0.15)

		var move_dir := Vector3.ZERO
		var attacking := false
		var to_hero: Vector3 = hero.pos - z.pos
		to_hero.y = 0
		var hero_d: float = to_hero.length()
		var hero_alive := hero.dead_t <= 0.0
		var aggro := 4.0 if z.kind != "brute" and z.kind != "boss" else 1.8

		# Плевун: стоит и плюёт в героя или в ближайшую постройку в радиусе.
		if z.kind == "spitter":
			z.scan_cd -= dt
			if z.scan_cd <= 0.0:
				z.scan_cd = 0.4
				z.shoot_at = _spitter_target(z)
			if z.shoot_at != null:
				attacking = true
				var aim: Vector3 = z.shoot_at
				z.yaw = lerp_angle(z.yaw, atan2(aim.x - z.pos.x, aim.z - z.pos.z), dt * 8.0)
				z.spit_cd -= dt
				if z.spit_cd <= 0.0:
					z.spit_cd = float(z.def.spit_every)
					z.attack = 1.0
					_spit(z.pos + Vector3(0, 1.3, 0), aim)

		if not attacking and hero_alive and hero_d < aggro:
			# Рядом герой — идём к нему; вплотную — кусаем.
			if hero_d < z.radius + 0.55:
				attacking = true
				z.yaw = lerp_angle(z.yaw, atan2(to_hero.x, to_hero.z), dt * 10.0)
				if z.cd <= 0.0:
					z.cd = 1.0
					z.attack = 1.0
					_hurt_hero(float(z.def.bite))
			else:
				move_dir = to_hero / hero_d
				var ahead := cell_of(z.pos + move_dir * (z.radius + 0.35))
				if _blocks(ahead) and buildings.has(ahead):
					attacking = _smash(z, buildings[ahead], dt)
					move_dir = Vector3.ZERO
		elif not attacking:
			var nxt := _next_cell(c)
			if house_cells.has(nxt) and _dist_to_cell(z.pos, nxt) < z.radius + 0.12:
				attacking = true
				z.yaw = lerp_angle(z.yaw, atan2(house_c.x - z.pos.x, house_c.z - z.pos.z), dt * 8.0)
				if z.cd <= 0.0:
					z.cd = 1.4 if z.kind == "brute" else 1.0
					z.attack = 1.0
					_hit_house(float(z.def.smash), z.pos)
			elif buildings.has(nxt) and _blocks(nxt) and _dist_to_cell(z.pos, nxt) < z.radius + 0.12:
				attacking = _smash(z, buildings[nxt], dt)
			else:
				var goal := _center(nxt) if nxt != c or not _inside(c) else house_c
				move_dir = goal - z.pos
				move_dir.y = 0
				if move_dir.length() > 0.001:
					move_dir = move_dir.normalized()

		# Громила топает: бьёт постройки вокруг.
		if z.kind == "boss":
			z.stomp_cd -= dt
			if z.stomp_cd <= 0.0 and (attacking or hero_d < 2.5):
				z.stomp_cd = 3.2
				shake = maxf(shake, 0.35)
				Sfx.play("explosion", z.pos, -6.0)
				fx.burst(z.pos, 20, Color("6f5a44"), 4.0, 0.12, 1.5)
				for bb in buildings.values():
					if _center(bb.cell).distance_to(z.pos) < 2.2:
						_damage_building(bb, 45.0)
				if hero_d < 2.5:
					_hurt_hero(20.0)

		if move_dir != Vector3.ZERO:
			var sp: float = z.speed * slow
			z.pos += move_dir * sp * dt
			z.yaw = lerp_angle(z.yaw, atan2(move_dir.x, move_dir.z), dt * 7.0)
			z.phase += dt * sp * 4.5
		elif not attacking:
			z.phase += dt * 1.5

	# Расталкиваем друг друга и не проходим сквозь стены.
	var n := zombies.size()
	for i in n:
		var a: Zombie = zombies[i]
		if a.dead:
			continue
		for j in range(i + 1, n):
			var b: Zombie = zombies[j]
			if b.dead:
				continue
			var dx := b.pos.x - a.pos.x
			var dz := b.pos.z - a.pos.z
			var rr := a.radius + b.radius
			var d2 := dx * dx + dz * dz
			if d2 < rr * rr and d2 > 0.000001:
				var d := sqrt(d2)
				var push := (rr - d) * 0.5
				var wa := b.radius / rr
				var wb := a.radius / rr
				a.pos.x -= dx / d * push * wa
				a.pos.z -= dz / d * push * wa
				b.pos.x += dx / d * push * wb
				b.pos.z += dz / d * push * wb
	for z in zombies:
		if z.dead:
			continue
		if _inside(cell_of(z.pos)):
			z.pos = _collide(z.pos, z.radius, false)
		M.animate(z.rig, z.phase, 1.0 if z.kind != "boss" else 0.8, "zombie", z.attack)
		_place_actor(z.node, z.blob, z.pos, z.yaw)

	# Мёртвые падают и уходят в землю.
	for i in range(corpses.size() - 1, -1, -1):
		var cp: Dictionary = corpses[i]
		cp.t += dt
		var node: Node3D = cp.node
		if cp.t < 0.35:
			node.rotation.x = lerpf(0.0, -PI / 2, cp.t / 0.35)
		elif cp.t > 1.4:
			node.position.y -= dt * 0.9
		if cp.t > 2.6:
			node.queue_free()
			cp.blob.queue_free()
			corpses.remove_at(i)
	zombies = zombies.filter(func(z): return not z.dead)


func _dist_to_cell(p: Vector3, c: Vector2i) -> float:
	var qx := clampf(p.x, c.x, c.x + 1)
	var qz := clampf(p.z, c.y, c.y + 1)
	return Vector2(p.x - qx, p.z - qz).length()


func _smash(z: Zombie, b: Building, dt: float) -> bool:
	var bc := _center(b.cell)
	z.yaw = lerp_angle(z.yaw, atan2(bc.x - z.pos.x, bc.z - z.pos.z), dt * 8.0)
	if z.cd <= 0.0:
		z.cd = 1.4 if z.kind == "brute" else 1.0
		z.attack = 1.0
		_damage_building(b, float(z.def.smash))
	return true


func _spitter_target(z: Zombie) -> Variant:
	var r: float = z.def.range
	if hero.dead_t <= 0.0 and z.pos.distance_to(hero.pos) < r:
		return hero.pos + Vector3(0, 0.8, 0)
	var best = null
	var bd := r
	for b in buildings.values():
		if not bool(D.BUILDINGS[b.kind].block):
			continue
		var d: float = _center(b.cell).distance_to(z.pos)
		if d < bd:
			bd = d
			best = _center(b.cell) + Vector3(0, 0.6, 0)
	if best == null and z.pos.distance_to(Vector3(0.5, 0, 0.5)) < r + 1.5:
		best = Vector3(0.5, 1.0, 0.5)
	return best


func _damage_zombie(z: Zombie, dmg: float, from: Vector3) -> void:
	if z.dead:
		return
	z.hp -= dmg
	z.flash = 0.08
	M.flash(z.node, true)
	var back := Vector3(z.pos.x - from.x, 0, z.pos.z - from.z).normalized()
	if z.kind != "boss" and z.kind != "brute":
		z.pos += back * 0.12
	fx.burst(z.pos + Vector3(0, 1.0 * z.node.scale.y, 0) + back * 0.2, 4, Color("3f4a22"), 2.0, 0.08, 1.8)
	Sfx.play("hit", z.pos, -6.0)
	if z.kind == "boss" and hud:
		hud.boss_hp(z.hp / z.max_hp)
	if z.hp <= 0.0:
		_kill_zombie(z, from)


func _kill_zombie(z: Zombie, from: Vector3) -> void:
	z.dead = true
	kills += 1
	M.flash(z.node, false)
	Sfx.play("zombie_die", z.pos, -4.0)
	var back := Vector3(z.pos.x - from.x, 0, z.pos.z - from.z).normalized()
	z.node.rotation.y = atan2(-back.x, -back.z)
	corpses.append({"node": z.node, "blob": z.blob, "t": 0.0})
	_decal(goo_mat, z.pos + back * 0.6, 1.2 * z.radius / 0.32)
	fx.burst(z.pos + Vector3(0, 0.8, 0), 10, Color("3f4a22"), 2.5, 0.1, 2.5)
	# Хлам выпадает кусочками: подбирается, если подойти.
	var total: int = z.def.scrap
	var pieces := mini(total, 4)
	for i in pieces:
		var v := total / pieces + (1 if i < total % pieces else 0)
		_drop_scrap(z.pos, v)
	if z.kind == "boss":
		shake = 0.6
		if hud:
			hud.show_boss(false)


func _damage_building(b: Building, dmg: float) -> void:
	b.hp -= dmg
	b.shake = 0.2
	fx.burst(_center(b.cell) + Vector3(0, 0.6, 0), 3, Color("8a6a48"), 1.5, 0.06, 1.5)
	if b.hp <= 0.0 and buildings.get(b.cell) == b:
		_remove_building(b, true)


func _hit_house(dmg: float, from: Vector3) -> void:
	house_hp -= dmg
	shake = maxf(shake, 0.1)
	fx.burst(from.lerp(Vector3(0.5, 1.0, 0.5), 0.6) + Vector3(0, 1.0, 0), 4, Color("9a8a70"), 1.5, 0.07, 1.5)
	if hud:
		hud.house_hit()
	if house_hp <= 0.0:
		house_hp = 0.0
		if endless:
			_finish(false)
		elif hud and not revive_used:
			phase = "over"
			Sdk.gameplay(false)
			hud.offer_revive()
		else:
			_finish(false)


# Продолжение после предложения починить дом: игрок отказался.
func give_up() -> void:
	phase = "night"
	_finish(false)


func _explode_mine(b: Building) -> void:
	var at := _center(b.cell)
	_remove_building(b, false)
	_explosion_fx(at, 1.0)
	for z in zombies:
		if z.dead:
			continue
		var d: float = z.pos.distance_to(at)
		if d < D.MINE.radius:
			_damage_zombie(z, D.MINE.damage * (1.0 - d / D.MINE.radius * 0.5), at)


func _explosion_fx(at: Vector3, scale: float) -> void:
	fx.burst(at + Vector3(0, 0.3, 0), int(26 * scale), Color("ffb347"), 6.0 * scale, 0.16, 5.0)
	fx.burst(at + Vector3(0, 0.3, 0), int(14 * scale), Color("3a3a3a"), 3.0 * scale, 0.22, 3.0)
	_decal(scorch_mat, at, 2.4 * scale)
	muzzle_t = 0.25
	muzzle_light.position = at + Vector3(0, 1, 0)
	shake = maxf(shake, 0.45)
	Sfx.play("explosion", at, 0.0)


# ---------- постройки ----------

func _update_buildings(dt: float) -> void:
	var tdmg: float = D.TURRET.damage * (1.0 + _up("turret") * D.UPGRADES.turret.step)
	for b in buildings.values():
		if b.shake > 0.0:
			b.shake -= dt
			b.node.position = _center(b.cell) + Vector3(randf_range(-1, 1), 0, randf_range(-1, 1)) * b.shake * 0.25
			if b.shake <= 0.0:
				b.node.position = _center(b.cell)
		if b.kind != "turret" or phase != "night":
			continue
		b.cd -= dt
		var base := _center(b.cell)
		if b.target == null or b.target.dead or b.target.pos.distance_to(base) > D.TURRET.range or b.cd < -0.3:
			b.target = _nearest_zombie(base, D.TURRET.range)
		if b.target == null:
			continue
		var want := atan2(b.target.pos.x - base.x, b.target.pos.z - base.z)
		if b.head:
			b.head.rotation.y = lerp_angle(b.head.rotation.y, want - b.node.rotation.y, dt * 10.0)
		var aimed := b.head == null or absf(angle_difference(b.head.rotation.y + b.node.rotation.y, want)) < 0.25
		if b.cd <= 0.0 and aimed:
			b.cd = D.TURRET.every
			var from: Vector3 = b.muzzle.global_position if b.muzzle else base + Vector3(0, 0.8, 0)
			var tz: Zombie = b.target
			_damage_zombie(tz, tdmg, from)
			_tracer(from, tz.pos + Vector3(0, 0.9, 0))
			fx.burst(from, 2, Color(1.0, 0.85, 0.4), 1.0, 0.05, 0.5)
			Sfx.play("turret_shot", base, -7.0)


# ---------- плевки ----------

func _spit(from: Vector3, to: Vector3) -> void:
	var m := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.14
	s.height = 0.28
	s.radial_segments = 8
	s.rings = 4
	m.mesh = s
	m.material_override = spit_mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(m)
	var dist := Vector2(to.x - from.x, to.z - from.z).length()
	spits.append({"node": m, "from": from, "to": to, "t": 0.0, "dur": maxf(0.35, dist / 7.0)})
	Sfx.play("spit", from, -5.0)


func _update_spits(dt: float) -> void:
	for i in range(spits.size() - 1, -1, -1):
		var s: Dictionary = spits[i]
		s.t += dt
		var k: float = s.t / s.dur
		var p: Vector3 = s.from.lerp(s.to, k)
		p.y += sin(k * PI) * 1.4
		s.node.position = p
		if k >= 1.0:
			var hit: Vector3 = s.to
			fx.burst(hit, 8, Color("b6e04a"), 2.0, 0.08, 1.5)
			_decal(goo_mat, Vector3(hit.x, 0, hit.z), 0.7)
			var spit_dmg: float = D.ZOMBIES.spitter.spit
			if hero.dead_t <= 0.0 and Vector2(hero.pos.x - hit.x, hero.pos.z - hit.z).length() < 0.8:
				_hurt_hero(spit_dmg)
			var c := cell_of(hit)
			if buildings.has(c):
				_damage_building(buildings[c], spit_dmg)
			elif house_cells.has(c) or Vector2(hit.x - 0.5, hit.z - 0.5).length() < 2.0:
				_hit_house(spit_dmg * 0.6, hit)
			s.node.queue_free()
			spits.remove_at(i)


# ---------- хлам ----------

func _drop_scrap(at: Vector3, value: int) -> void:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = Vector3(0.16, 0.08, 0.16)
	m.mesh = b
	m.material_override = scrap_mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(m)
	var a := randf() * TAU
	pickups.append({"node": m, "pos": at + Vector3(0, 0.6, 0), "vel": Vector3(cos(a) * 1.6, 3.2, sin(a) * 1.6), "value": value, "t": 0.0})


func _update_pickups(dt: float) -> void:
	for i in range(pickups.size() - 1, -1, -1):
		var p: Dictionary = pickups[i]
		p.t += dt
		var pos: Vector3 = p.pos
		var vel: Vector3 = p.vel
		var to := hero.pos + Vector3(0, 0.8, 0) - pos
		if p.t > 0.5 and hero.dead_t <= 0.0 and to.length() < 3.2:
			vel = vel.lerp(to.normalized() * 9.0, clampf(dt * 8.0, 0.0, 1.0))
		else:
			vel.y -= 12.0 * dt
			vel.x *= 1.0 - dt * 2.0
			vel.z *= 1.0 - dt * 2.0
		pos += vel * dt
		if pos.y < 0.06:
			pos.y = 0.06
			vel.y = absf(vel.y) * 0.3
		p.pos = pos
		p.vel = vel
		p.node.position = pos
		p.node.rotation.y += dt * 4.0
		if to.length() < 0.5:
			scrap += int(p.value)
			Sfx.play("scrap", pos, -6.0)
			p.node.queue_free()
			pickups.remove_at(i)


# ---------- эффекты ----------

func _tracer(a: Vector3, b: Vector3) -> void:
	for t in tracers:
		if t.life <= 0.0:
			t.life = 0.07
			t.a = a
			t.b = b
			t.node.visible = true
			return


func _update_fx(dt: float) -> void:
	fx.step(dt)
	for t in tracers:
		if t.life <= 0.0:
			continue
		t.life -= dt
		var n: MeshInstance3D = t.node
		if t.life <= 0.0:
			n.visible = false
			continue
		var a: Vector3 = t.a
		var b: Vector3 = t.b
		var len := a.distance_to(b)
		var w: float = 0.05 * (t.life / 0.07)
		var basis := Basis.looking_at(b - a, Vector3.UP).scaled(Vector3(w, w, len))
		n.global_transform = Transform3D(basis, (a + b) * 0.5)


func _decal(m: StandardMaterial3D, at: Vector3, size: float) -> void:
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(size, size)
	qm.orientation = PlaneMesh.FACE_Y
	q.mesh = qm
	q.material_override = m
	q.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	q.position = Vector3(at.x, 0.012 + (decals.size() % 20) * 0.0008, at.z)
	q.rotation.y = randf() * TAU
	add_child(q)
	decals.append(q)
	if decals.size() > 60:
		decals.pop_front().queue_free()


# ---------- камера ----------

func _update_camera(dt: float, frozen: bool) -> void:
	var vp := get_viewport().get_visible_rect().size
	var portrait := vp.y > vp.x
	var want_h := 21.0 if phase == "day" else 17.0
	if portrait:
		want_h *= 1.45
	cam_height = lerpf(cam_height, want_h, clampf(dt * 2.0, 0.0, 1.0))
	if not frozen:
		var t := hero.pos
		if phase == "day":
			t = t.lerp(Vector3(0.5, 0, 0.5), 0.5)
		cam_target = cam_target.lerp(t, clampf(dt * 4.0, 0.0, 1.0))
	var tilt := deg_to_rad(54.0)
	var off := Vector3(0, cam_height, cam_height / tan(tilt))
	var shake_v := Vector3.ZERO
	if shake > 0.0:
		shake = maxf(0.0, shake - dt)
		shake_v = Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * shake * 0.5
	cam.position = cam_target + off + shake_v
	cam.look_at(cam_target + shake_v, Vector3.UP)


# =====================================================================
#   Ввод: касание или мышь — джойстик там, где палец; короткое касание — стройка
# =====================================================================

func _unhandled_input(event: InputEvent) -> void:
	if paused or phase == "over":
		return
	if event is InputEventScreenTouch:
		_press(event.index, event.position, event.pressed)
	elif event is InputEventScreenDrag:
		_drag(event.index, event.position)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		_press(-2, event.position, event.pressed)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		set_tool("")
	elif event is InputEventMouseMotion:
		if touch_index == -2:
			_drag(-2, event.position)
		hover_cell = _screen_cell(event.position)
	elif event is InputEventKey and event.pressed and not event.echo:
		var k: int = event.physical_keycode
		if k >= KEY_1 and k <= KEY_5 and phase == "day":
			var avail := available_buildings()
			var i := k - KEY_1
			if i < avail.size():
				set_tool("" if tool == avail[i] else avail[i])
		elif k == KEY_SPACE or k == KEY_ENTER:
			start_night()
		elif k == KEY_ESCAPE:
			if tool != "":
				set_tool("")
			elif hud:
				hud.toggle_pause()


func _press(index: int, pos: Vector2, pressed: bool) -> void:
	if pressed:
		if touch_index != -1:
			return
		touch_index = index
		touch_start = pos
		touch_now = pos
		touch_time = Time.get_ticks_msec()
		dragging = false
	elif index == touch_index:
		touch_index = -1
		stick = Vector2.ZERO
		if hud:
			hud.show_stick(false, Vector2.ZERO, Vector2.ZERO)
		if not dragging and Time.get_ticks_msec() - touch_time < 450:
			_tap(pos)
		dragging = false


func _drag(index: int, pos: Vector2) -> void:
	if index != touch_index:
		return
	touch_now = pos
	var v := pos - touch_start
	if not dragging and v.length() > 14.0:
		dragging = true
	if dragging:
		var r := 70.0
		if v.length() > r:
			touch_start = pos - v.normalized() * r   # джойстик «тянется» за пальцем
			v = pos - touch_start
		stick = v / r
		if hud:
			hud.show_stick(true, touch_start, pos)


func _screen_cell(p: Vector2) -> Vector2i:
	var from := cam.project_ray_origin(p)
	var dir := cam.project_ray_normal(p)
	if absf(dir.y) < 0.0001:
		return Vector2i(999, 999)
	var t := -from.y / dir.y
	return cell_of(from + dir * t)


func _tap(p: Vector2) -> void:
	var c := _screen_cell(p)
	print("TAP ", p, " -> ", c, " tool=", tool, " phase=", phase)
	if phase != "day":
		return
	if tool != "" and can_build(tool, c):
		build(tool, c)
		return
	if buildings.has(c) or house_cells.has(c):
		if hud:
			hud.show_building_menu(c, cam.unproject_position(_center(c) + Vector3(0, 1.2, 0)))
		return
	if tool != "":
		if hud:
			hud.toast(_why_not(tool, c))


func _why_not(kind: String, c: Vector2i) -> String:
	if maxi(absi(c.x), absi(c.y)) > D.BUILD_RADIUS:
		return "Строить можно только на утоптанной земле вокруг дома."
	if scrap < int(D.BUILDINGS[kind].cost):
		return "Не хватает хлама: нужно %d." % int(D.BUILDINGS[kind].cost)
	if solid.has(c) or buildings.has(c):
		return "Клетка занята."
	return "Здесь стоит герой — отойдите."


func _update_ghost() -> void:
	if tool == "" or phase != "day" or hover_cell.x == 999:
		if ghost:
			ghost.visible = false
		return
	if ghost_kind != tool:
		if ghost:
			ghost.queue_free()
		ghost = M.make(tool)
		M.set_shadows(ghost, false)
		add_child(ghost)
		ghost_kind = tool
	ghost.visible = true
	ghost.position = _center(hover_cell)
	var ok := can_build(tool, hover_cell)
	var m := M.mat(Color(0.4, 1.0, 0.5) if ok else Color(1.0, 0.35, 0.3))
	for mi in ghost.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).material_override = _ghost_mat(ok)


var _ghost_ok: StandardMaterial3D
var _ghost_bad: StandardMaterial3D
func _ghost_mat(ok: bool) -> StandardMaterial3D:
	if _ghost_ok == null:
		_ghost_ok = StandardMaterial3D.new()
		_ghost_ok.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_ghost_ok.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_ghost_ok.albedo_color = Color(0.45, 1.0, 0.55, 0.45)
		_ghost_bad = _ghost_ok.duplicate()
		_ghost_bad.albedo_color = Color(1.0, 0.35, 0.3, 0.45)
	return _ghost_ok if ok else _ghost_bad


func available_buildings() -> Array:
	var out: Array = []
	var lvl := level_idx + 1 if not endless else 99
	for k in D.BUILD_ORDER:
		if int(D.BUILDINGS[k].unlock) <= lvl:
			out.append(k)
	return out


func set_paused(p: bool) -> void:
	paused = p
	stick = Vector2.ZERO
	touch_index = -1
