# SVG draft -> PNG 128x128 conversion
# Tool: PowerShell + WPF (System.Windows.Media.Imaging)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$outDir = $PSScriptRoot

function New-Canvas {
  return (New-Object System.Windows.Media.Imaging.RenderTargetBitmap(128, 128, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32))
}

function Save-Png($bmp, $path) {
  $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bmp))
  $stream = [System.IO.File]::Create($path)
  $enc.Save($stream)
  $stream.Close()
  Write-Host "Saved: $path"
}

function Brush($hex) {
  $c = [System.Windows.Media.ColorConverter]::ConvertFromString($hex)
  return (New-Object System.Windows.Media.SolidColorBrush($c))
}

function BrushA($a, $r, $g, $b) {
  $c = [System.Windows.Media.Color]::FromArgb($a, $r, $g, $b)
  return (New-Object System.Windows.Media.SolidColorBrush($c))
}

function DrawRR($dc, $brush, $pen, $x, $y, $w, $h, $rx) {
  $rect = [System.Windows.Rect]::new($x, $y, $w, $h)
  $geo = New-Object System.Windows.Media.RectangleGeometry($rect, $rx, $rx)
  $dc.DrawGeometry($brush, $pen, $geo)
}

function MakePen($hex, $thickness) {
  return (New-Object System.Windows.Media.Pen((Brush $hex), $thickness))
}

function MakePenA($a, $r, $g, $b, $thickness) {
  return (New-Object System.Windows.Media.Pen((BrushA $a $r $g $b), $thickness))
}

# ============================================================
# Draft A: Calendar Grid
# ============================================================
$bmpA = New-Canvas
$dv = New-Object System.Windows.Media.DrawingVisual
$dc = $dv.RenderOpen()

DrawRR $dc (Brush "#1a73e8") $null 0 0 128 128 16
DrawRR $dc (Brush "#ffffff") $null 14 30 100 84 6
DrawRR $dc (Brush "#1557b0") $null 14 30 100 26 6
$dc.DrawRectangle((Brush "#1557b0"), $null, [System.Windows.Rect]::new(14, 44, 100, 12))
DrawRR $dc (Brush "#ffffff") $null 36 22 8 18 4
DrawRR $dc (Brush "#ffffff") $null 84 22 8 18 4

$tf = New-Object System.Windows.Media.Typeface("Arial Black")
$ft = New-Object System.Windows.Media.FormattedText("KC", [System.Globalization.CultureInfo]::InvariantCulture, [System.Windows.FlowDirection]::LeftToRight, $tf, 15, (Brush "#ffffff"), 1.0)
$dc.DrawText($ft, [System.Windows.Point]::new((64 - $ft.Width / 2), 36))

$cols = @(20, 36, 52, 68, 84, 100)
$rows = @(64, 78, 92, 106)

for ($ri = 0; $ri -lt 4; $ri++) {
  for ($ci = 0; $ci -lt 6; $ci++) {
    $x = $cols[$ci]
    $y = $rows[$ri]
    if ($ri -eq 1 -and $ci -eq 2) {
      DrawRR $dc (Brush "#ea580c") $null $x $y 12 10 2
    } elseif ($ri -eq 2 -and $ci -eq 3) {
      DrawRR $dc (Brush "#818cf8") $null $x $y 28 10 2
    } elseif ($ri -eq 2 -and $ci -eq 4) {
      # merged - skip
    } else {
      DrawRR $dc (Brush "#dbeafe") $null $x $y 12 10 2
    }
  }
}

$dc.Close()
$bmpA.Render($dv)
Save-Png $bmpA (Join-Path $outDir "icon-draft-a.png")

# ============================================================
# Draft B: Large KC letters + calendar frame
# ============================================================
$bmpB = New-Canvas
$dv = New-Object System.Windows.Media.DrawingVisual
$dc = $dv.RenderOpen()

DrawRR $dc (Brush "#1557b0") $null 0 0 128 128 18
DrawRR $dc $null (MakePen "#ffffff" 5) 10 28 108 90 8
$dc.DrawLine((MakePenA 179 255 255 255 3), [System.Windows.Point]::new(10, 52), [System.Windows.Point]::new(118, 52))
DrawRR $dc (Brush "#ffffff") $null 32 20 7 16 3
DrawRR $dc (Brush "#ffffff") $null 89 20 7 18 3

$tf2 = New-Object System.Windows.Media.Typeface("Arial Black")
$ft2 = New-Object System.Windows.Media.FormattedText("KC", [System.Globalization.CultureInfo]::InvariantCulture, [System.Windows.FlowDirection]::LeftToRight, $tf2, 46, (Brush "#ffffff"), 1.0)
$dc.DrawText($ft2, [System.Windows.Point]::new((64 - $ft2.Width / 2), 58))

$dotX   = @(34, 46, 58, 70, 82, 94)
$dotClr = @("#bfdbfe", "#bfdbfe", "#bfdbfe", "#ea580c", "#bfdbfe", "#818cf8")
for ($i = 0; $i -lt 6; $i++) {
  $dc.DrawEllipse((Brush $dotClr[$i]), $null, [System.Windows.Point]::new($dotX[$i], 40), 3, 3)
}

$dc.Close()
$bmpB.Render($dv)
Save-Png $bmpB (Join-Path $outDir "icon-draft-b.png")

# ============================================================
# Draft C: Stacked card abstract
# ============================================================
$bmpC = New-Canvas
$dv = New-Object System.Windows.Media.DrawingVisual
$dc = $dv.RenderOpen()

DrawRR $dc (Brush "#f0f4ff") $null 0 0 128 128 18
DrawRR $dc (BrushA 89 129 140 248) $null 22 32 76 72 10
DrawRR $dc (BrushA 140 26 115 232) $null 16 24 76 72 10
DrawRR $dc (Brush "#ffffff") (MakePen "#1a73e8" 2) 10 16 82 72 10
DrawRR $dc (Brush "#1a73e8") $null 10 16 82 20 10
$dc.DrawRectangle((Brush "#1a73e8"), $null, [System.Windows.Rect]::new(10, 28, 82, 8))
DrawRR $dc (Brush "#1557b0") $null 28 10 6 14 3
DrawRR $dc (Brush "#1557b0") $null 68 10 6 14 3

$gp = MakePen "#e5e7eb" 1
$dc.DrawLine($gp, [System.Windows.Point]::new(10, 54), [System.Windows.Point]::new(92, 54))
$dc.DrawLine($gp, [System.Windows.Point]::new(10, 68), [System.Windows.Point]::new(92, 68))
DrawRR $dc (Brush "#ea580c") $null 16 57 48 8 3
DrawRR $dc (Brush "#818cf8") $null 16 71 32 8 3

$tf3 = New-Object System.Windows.Media.Typeface("Arial Black")
$ft3 = New-Object System.Windows.Media.FormattedText("KC", [System.Globalization.CultureInfo]::InvariantCulture, [System.Windows.FlowDirection]::LeftToRight, $tf3, 22, (Brush "#1a73e8"), 1.0)
$dc.DrawText($ft3, [System.Windows.Point]::new((110 - $ft3.Width), 96))

$dc.DrawEllipse((BrushA 38 234 88 12), $null, [System.Windows.Point]::new(110, 95), 12, 12)
$dc.DrawEllipse((BrushA 178 234 88 12), $null, [System.Windows.Point]::new(110, 95), 7, 7)

$dc.Close()
$bmpC.Render($dv)
Save-Png $bmpC (Join-Path $outDir "icon-draft-c.png")

Write-Host "Done: icon-draft-a.png / icon-draft-b.png / icon-draft-c.png"
