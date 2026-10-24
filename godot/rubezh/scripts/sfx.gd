# Звуки и музыка. Файлы — assets/sfx/<имя>.wav (их делает scripts/rubezh-sfx.mjs); если файла нет, звук молчит.
# Громкость зависит от расстояния до героя: далёкая стрельба турели тише ближней.
extends Node

const POOL := 14

var muted := false
var listener := Vector3.ZERO     # где герой: относительно него считаем громкость
var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _next := 0
var _music: Array[AudioStreamPlayer] = []
var _music_on := -1
var _last := {}                   # когда звук играл последний раз: одинаковые не чаще 50 мс


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in POOL:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	for i in 2:
		var m := AudioStreamPlayer.new()
		m.volume_db = -80.0
		add_child(m)
		_music.append(m)


func _stream(name: String) -> AudioStream:
	if not _streams.has(name):
		var path := "res://assets/sfx/%s.wav" % name
		_streams[name] = load(path) if ResourceLoader.exists(path) else null
	return _streams[name]


func play(name: String, at: Variant = null, volume_db := 0.0, pitch_jitter := 0.08) -> void:
	if muted:
		return
	var now := Time.get_ticks_msec()
	if now - int(_last.get(name, -1000)) < 50:
		return
	var s := _stream(name)
	if s == null:
		return
	var vol := volume_db
	if at is Vector3:
		var d := (at as Vector3).distance_to(listener)
		if d > 22.0:
			return
		vol -= d * 0.9
	_last[name] = now
	var p := _players[_next]
	_next = (_next + 1) % POOL
	p.stream = s
	p.volume_db = vol
	p.pitch_scale = 1.0 + randf_range(-pitch_jitter, pitch_jitter)
	p.play()


# Плавная смена музыки: "day", "night" или "" (тишина).
func music(name: String) -> void:
	var idx := -1 if name == "" else (0 if name == "day" else 1)
	if idx == _music_on:
		return
	_music_on = idx
	for i in 2:
		var m := _music[i]
		var target := -80.0
		if i == idx and not muted:
			var s := _stream("music_" + name)
			if s == null:
				continue
			if s is AudioStreamWAV:
				(s as AudioStreamWAV).loop_mode = AudioStreamWAV.LOOP_FORWARD
				(s as AudioStreamWAV).loop_end = int((s as AudioStreamWAV).get_length() * (s as AudioStreamWAV).mix_rate)
			if m.stream != s or not m.playing:
				m.stream = s
				m.play()
			target = -9.0
		var tw := create_tween()
		tw.tween_property(m, "volume_db", target, 1.5)


func set_muted(v: bool) -> void:
	muted = v
	AudioServer.set_bus_mute(0, v)
	if not v and _music_on >= 0:
		var name := "day" if _music_on == 0 else "night"
		_music_on = -1
		music(name)


func pause_all(paused: bool) -> void:
	AudioServer.set_bus_mute(0, paused or muted)
