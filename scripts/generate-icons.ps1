$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resources=Join-Path $root 'android\app\src\main\res'
$accent=[Drawing.ColorTranslator]::FromHtml('#de856d')
$white=[Drawing.ColorTranslator]::FromHtml('#fffaf4')
function Write-Icon([string]$Path,[int]$Size,[string]$Shape) {
  $bitmap=[Drawing.Bitmap]::new($Size,$Size)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([Drawing.Color]::Transparent)
  $brush=[Drawing.SolidBrush]::new($accent)
  $background=[Drawing.Drawing2D.GraphicsPath]::new()
  if($Shape -eq 'round') { $graphics.FillEllipse($brush,0,0,$Size-1,$Size-1) }
  elseif($Shape -eq 'square') {
    $radius=$Size*0.32; $edge=$Size-1
    $background.AddArc(0,0,$radius,$radius,180,90);$background.AddArc($edge-$radius,0,$radius,$radius,270,90)
    $background.AddArc($edge-$radius,$edge-$radius,$radius,$radius,0,90);$background.AddArc(0,$edge-$radius,$radius,$radius,90,90)
    $background.CloseFigure();$graphics.FillPath($brush,$background)
  }
  $scale=$Size/64.0
  if($Shape -eq 'foreground') { $graphics.TranslateTransform($Size*0.17,$Size*0.17);$scale*=0.66 }
  $graphics.ScaleTransform($scale,$scale)
  $pen=[Drawing.Pen]::new($white,3.2)
  $pen.LineJoin=[Drawing.Drawing2D.LineJoin]::Round;$pen.StartCap=[Drawing.Drawing2D.LineCap]::Round;$pen.EndCap=$pen.StartCap
  $glyph=[Drawing.Drawing2D.GraphicsPath]::new()
  $glyph.AddLine(21,14,45,14);$glyph.AddLine(45,14,45,50);$glyph.AddLine(45,50,22,50)
  $glyph.AddBezier(22,50,18,50,15,48,15,44);$glyph.AddLine(15,44,15,21);$glyph.AddBezier(15,21,15,17,17,14,21,14)
  $graphics.DrawPath($pen,$glyph);$graphics.DrawLine($pen,16,43,44,43);$graphics.DrawLine($pen,25,25,36,25);$graphics.DrawLine($pen,25,32,32,32)
  $bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)
  $glyph.Dispose();$pen.Dispose();$background.Dispose();$brush.Dispose();$graphics.Dispose();$bitmap.Dispose()
}
foreach($density in @(@('mdpi',48,108),@('hdpi',72,162),@('xhdpi',96,216),@('xxhdpi',144,324),@('xxxhdpi',192,432))) {
  $directory=Join-Path $resources ('mipmap-'+$density[0])
  Write-Icon (Join-Path $directory 'ic_launcher.png') $density[1] 'square'
  Write-Icon (Join-Path $directory 'ic_launcher_round.png') $density[1] 'round'
  Write-Icon (Join-Path $directory 'ic_launcher_foreground.png') $density[2] 'foreground'
}
Write-Output 'Generated the project-owned book icon for Android densities.'
