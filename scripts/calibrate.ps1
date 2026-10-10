# calibrate.ps1 —— 标定辅助脚本
#
# 用途：把 computer_act 产出的「整屏截图」叠上一层**屏幕物理像素**坐标网格，
# 再输出一张图。这样就能直接看着图读出某个按钮/选项在物理坐标里的位置，
# 按 docs/CALIBRATION.md 的步骤把标定档对齐到这台机器。
#
# 用法（PowerShell，Windows 自带 powershell 5.1 即可）：
#   powershell -ExecutionPolicy Bypass -File scripts\calibrate.ps1 `
#       -Screenshot C:\path\to\shot.jpg -ScreenWidth 2560 -ScreenHeight 1600
#
# 说明：
#   - 只读输入截图、只写输出图片，不动系统设置、不联网。
#   - 网格间距是物理像素（默认 100），标号写的是「物理坐标 x,y」。
#   - 想核对某个点，把它的物理坐标读出来，填进 profiles/*.json。

param(
  [Parameter(Mandatory = $true)][string]$Screenshot,
  [string]$Out = "",
  [int]$ScreenWidth = 2560,
  [int]$ScreenHeight = 1600,
  [int]$Step = 100,
  [int]$MaxEdge = 2200
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $Screenshot)) {
  throw "找不到截图：$Screenshot"
}

$img = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Screenshot).Path)
try {
  $scaleX = $ScreenWidth / $img.Width
  $scaleY = $ScreenHeight / $img.Height

  # 输出尺寸（限制长边，免得生成超大图）
  $ratio = [Math]::Min(1.0, $MaxEdge / [Math]::Max($img.Width, $img.Height))
  $w = [int][Math]::Round($img.Width * $ratio)
  $h = [int][Math]::Round($img.Height * $ratio)

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h)

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 255, 0, 0)), 1
  $font = New-Object System.Drawing.Font "Consolas", 9
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 200, 0, 0))

  # 竖线：按物理 x 每 Step 画一条
  for ($px = 0; $px -le $ScreenWidth; $px += $Step) {
    $x = [int][Math]::Round(($px / $scaleX) * $ratio)
    if ($x -lt 0 -or $x -ge $w) { continue }
    $g.DrawLine($pen, $x, 0, $x, $h)
    $g.DrawString([string]$px, $font, $brush, [Math]::Max(0, $x + 2), 2)
  }

  # 横线：按物理 y 每 Step 画一条
  for ($py = 0; $py -le $ScreenHeight; $py += $Step) {
    $y = [int][Math]::Round(($py / $scaleY) * $ratio)
    if ($y -lt 0 -or $y -ge $h) { continue }
    $g.DrawLine($pen, 0, $y, $w, $y)
    $g.DrawString([string]$py, $font, $brush, 2, [Math]::Max(0, $y + 2))
  }

  if (-not $Out) {
    $dir = Split-Path -Parent (Resolve-Path -LiteralPath $Screenshot).Path
    $Out = Join-Path $dir "calibrated-grid.jpg"
  }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Jpeg)

  Write-Output "输入截图：$Screenshot  ($($img.Width)x$($img.Height))"
  Write-Output "物理屏幕：${ScreenWidth}x${ScreenHeight}"
  Write-Output ("换算比例：物理 = 截图坐标 x {0:N4} (x), x {1:N4} (y)" -f $scaleX, $scaleY)
  Write-Output "网格间距：$Step 物理像素"
  Write-Output "输出图片：$Out  ($($w)x$($h))"
  Write-Output ""
  Write-Output "接下来：看着网格图读出目标控件中心的物理坐标，填进 profiles/*.json 的对应字段，"
  Write-Output "然后用 xxtong_layout_check 复核，再拿一道题实测。"

  $font.Dispose(); $brush.Dispose(); $pen.Dispose(); $g.Dispose(); $bmp.Dispose()
}
finally {
  $img.Dispose()
}
