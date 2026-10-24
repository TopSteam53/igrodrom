# Связь с площадкой Gamely через её SDK (/sdk.js, подключён в <head> экспортированной страницы).
# В браузере вызовы идут в window.Gamely через JavaScriptBridge, в редакторе — заглушки и файл user://save.json.
# Сохранение: один словарь data, пишется не чаще раза в секунду.
extends Node

signal pause_changed(paused: bool)

const LOCAL_SAVE := "user://save.json"

var data: Dictionary = {}
var host := "editor"
var ready_done := false
var _sdk: JavaScriptObject = null
var _json: JavaScriptObject = null
var _keep: Array = []          # колбэки JS живут, пока на них есть ссылка
var _dirty := false
var _save_left := 0.0


class Waiter extends RefCounted:
	signal done
	var ok := false
	var value: Variant = null

	func resolve(args: Array) -> void:
		ok = true
		value = args[0] if args.size() > 0 else null
		done.emit()

	func reject(args: Array) -> void:
		ok = false
		value = args[0] if args.size() > 0 else null
		done.emit()


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func is_web() -> bool:
	return OS.has_feature("web") and _sdk != null


# Подключение к площадке и загрузка сохранения. Вызывается один раз при старте.
func start() -> void:
	if OS.has_feature("web"):
		var g = JavaScriptBridge.get_interface("Gamely")
		_json = JavaScriptBridge.get_interface("JSON")
		if g != null:
			var r := await _await(g.init())
			if r[0] and r[1] != null:
				_sdk = r[1]
				host = str(_sdk.environment.host)
				_listen("pause", true)
				_listen("resume", false)
				var d := await _await(_sdk.data.get())
				if d[0] and d[1] != null:
					var parsed = JSON.parse_string(str(_json.stringify(d[1])))
					if parsed is Dictionary:
						data = parsed
	elif FileAccess.file_exists(LOCAL_SAVE):
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(LOCAL_SAVE))
		if parsed is Dictionary:
			data = parsed
	ready_done = true


func _listen(event: String, paused: bool) -> void:
	var cb := JavaScriptBridge.create_callback(func(_args): pause_changed.emit(paused))
	_keep.append(cb)
	_sdk.on(event, cb)


func _await(promise: JavaScriptObject) -> Array:
	var w := Waiter.new()
	var ok_cb := JavaScriptBridge.create_callback(w.resolve)
	var err_cb := JavaScriptBridge.create_callback(w.reject)
	_keep.append(ok_cb)
	_keep.append(err_cb)
	promise.then(ok_cb, err_cb)
	await w.done
	_keep.erase(ok_cb)
	_keep.erase(err_cb)
	return [w.ok, w.value]


func save() -> void:
	_dirty = true


func _process(delta: float) -> void:
	if not _dirty:
		return
	_save_left -= delta
	if _save_left > 0.0:
		return
	_save_left = 1.0
	_dirty = false
	var text := JSON.stringify(data)
	if is_web():
		_sdk.data.set(_json.parse(text))
	elif not OS.has_feature("web"):
		var f := FileAccess.open(LOCAL_SAVE, FileAccess.WRITE)
		if f:
			f.store_string(text)


func game_ready() -> void:
	if is_web():
		_sdk.game.ready()


func gameplay(on: bool) -> void:
	if is_web():
		if on:
			_sdk.game.start()
		else:
			_sdk.game.stop()


# Реклама за награду: true, если игрок досмотрел. Без площадки награда выдаётся сразу.
func rewarded() -> bool:
	if not is_web():
		return true
	pause_changed.emit(true)
	var r := await _await(_sdk.ads.rewarded())
	pause_changed.emit(false)
	return r[0] and r[1] != null and bool(r[1].rewarded)


func fullscreen() -> void:
	if not is_web():
		return
	pause_changed.emit(true)
	await _await(_sdk.ads.fullscreen())
	pause_changed.emit(false)


# Рекорд в таблице «ночей пережито». Гостю площадка откажет — это не ошибка игры.
func set_score(board: String, score: int) -> void:
	if not is_web():
		return
	var opts = _json.parse(JSON.stringify({"board": board}))
	await _await(_sdk.leaderboard.setScore(score, opts))
