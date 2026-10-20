# Картинки для превью ссылок (Telegram, ВК, поисковики): SVG там не показываются, поэтому
# обложки рендерятся в JPEG через headless Chrome/Edge.
#   public/games/<игра>/og.jpg — 928×522, из обложки игры
#   public/og.jpg              — 1200×630, коллаж обложек для главной
# Запуск (Windows): powershell -ExecutionPolicy Bypass -File scripts/og-images.ps1 [игра ...]
param([string[]]$Games)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$public = Join-Path $root 'public'
$browser = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Нужен Chrome или Edge' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("og-" + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
$url = { param($p) ([Uri](Resolve-Path $p).Path).AbsoluteUri }

function Shot([string]$html, [int]$w, [int]$h, [string]$out) {
  $page = Join-Path $tmp 'page.html'
  $png = Join-Path $tmp 'shot.png'
  Set-Content -Path $page -Value $html -Encoding UTF8
  Remove-Item $png -ErrorAction SilentlyContinue
  # Браузер пишет в stderr служебные предупреждения — уводим их в файл, чтобы PowerShell не счёл это ошибкой.
  $argv = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    "--user-data-dir=$(Join-Path $tmp 'profile')", "--window-size=$($w + 200),$($h + 200)", "--screenshot=$png",
    '--virtual-time-budget=3000', ([Uri]$page).AbsoluteUri)
  Start-Process -FilePath $browser -ArgumentList $argv -Wait -WindowStyle Hidden `
    -RedirectStandardError (Join-Path $tmp 'err.txt') -RedirectStandardOutput (Join-Path $tmp 'out.txt')
  if (-not (Test-Path $png)) { throw "Браузер не сделал снимок: $out" }
  # Видимая область окна меньше его размера, поэтому окно берём с запасом и обрезаем снимок.
  $full = [Drawing.Bitmap]::FromFile($png)
  $img = $full.Clone((New-Object Drawing.Rectangle 0, 0, $w, $h), $full.PixelFormat)
  $full.Dispose()
  try {
    $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $params = New-Object Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 86L
    $img.Save($out, $codec, $params)
  } finally { $img.Dispose() }
  Write-Host ("{0}  {1:N0} КБ" -f $out, ((Get-Item $out).Length / 1KB))
}

$all = Get-ChildItem (Join-Path $public 'games') -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'meta.json') }
$covers = @{}
foreach ($g in $all) {
  $c = Get-ChildItem $g.FullName -File -Filter 'cover.*' | Select-Object -First 1
  if ($c) { $covers[$g.Name] = & $url $c.FullName }
}

foreach ($g in $all) {
  if ($Games -and $Games -notcontains $g.Name) { continue }
  if (-not $covers[$g.Name]) { continue }
  $html = "<!doctype html><style>html,body{margin:0;background:#12152A}img{display:block;width:928px;height:522px;object-fit:cover}</style><img src=""$($covers[$g.Name])"">"
  Shot $html 928 522 (Join-Path $g.FullName 'og.jpg')
}

if (-not $Games) {
  $fonts = & $url (Join-Path $public 'fonts')
  $tiles = ($covers.Keys | Sort-Object { [Math]::Abs($_.GetHashCode()) } | ForEach-Object { "<img src=""$($covers[$_])"">" }) -join ''
  $html = @"
<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:U;src:url($fonts/unbounded-cyrillic.woff2);font-weight:200 900;unicode-range:U+0400-04FF}
@font-face{font-family:U;src:url($fonts/unbounded-latin.woff2);font-weight:200 900;unicode-range:U+0000-00FF}
@font-face{font-family:O;src:url($fonts/onest-cyrillic.woff2);font-weight:100 900}
html,body{margin:0;background:#12152A}body{position:relative;width:1200px;height:630px;overflow:hidden}
.wall{position:absolute;left:330px;top:-150px;width:1200px;display:grid;grid-template-columns:repeat(4,232px);gap:18px;transform:rotate(-12deg)}
.wall img{width:232px;height:130px;border-radius:14px;object-fit:cover;box-shadow:0 6px 0 #0a0c1c}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#12152A 34%,rgba(18,21,42,.86) 50%,rgba(18,21,42,0) 72%)}
.txt{position:absolute;left:72px;top:96px;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;color:#ECEEF7}
h1{font:800 64px/1.04 U;margin:0 0 22px;letter-spacing:-.01em}
p{font:500 30px/1.3 O;color:#A3AAC7;margin:0 0 34px}
.brand{position:absolute;left:72px;top:58px;display:flex;align-items:center;gap:16px;font:700 40px U;color:#ECEEF7;letter-spacing:-.01em}.brand img{width:58px;height:58px}
.play{align-self:flex-start;font:700 28px O;color:#1C2140;background:#FFC531;border-radius:16px;padding:16px 34px;box-shadow:0 5px 0 #b8860b}
</style>
<div class="wall">$tiles$tiles</div><div class="fade"></div>
<div class="brand"><img src="$(& $url (Join-Path $public 'favicon.svg'))">Gamely</div>
<div class="txt"><h1>Игры прямо в&nbsp;браузере</h1><p>Без скачивания. Прогресс сохраняется на&nbsp;любом устройстве.</p><span class="play">Играть</span></div>
"@
  Shot $html 1200 630 (Join-Path $public 'og.jpg')
}
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
