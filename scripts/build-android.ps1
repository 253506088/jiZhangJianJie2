param(
  [ValidateSet('Debug','Release')][string]$BuildType='Release',
  [string]$JavaHome=(Join-Path $env:USERPROFILE '.jdks\corretto-21.0.10'),
  [string]$SdkPath=(Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
  [string]$BuildCache,
  [switch]$SkipWeb
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$java=Join-Path $JavaHome 'bin\java.exe'
if (-not (Test-Path -LiteralPath $java)) { throw 'Set -JavaHome to the installed JDK 21.' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms\android-36\android.jar'))) { throw 'Android SDK platform 36 is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'build-tools\36.1.0'))) { throw 'Android SDK Build Tools 36.1.0 is required.' }
if (-not $BuildCache) { $BuildCache=[IO.Path]::GetFullPath((Join-Path $projectRoot '..\.jizhang-gradle-cache')) }
$gradleHome=$BuildCache
$tempDirectory=Join-Path $BuildCache 'build-tmp'
$artifacts=Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Path $gradleHome,$tempDirectory,$artifacts -Force | Out-Null
$variables=@('JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','GRADLE_USER_HOME','TEMP','TMP','PATH')
$previous=@{}
foreach($name in $variables) { $previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
Push-Location $projectRoot
try {
  $env:JAVA_HOME=$JavaHome; $env:ANDROID_HOME=$SdkPath; $env:ANDROID_SDK_ROOT=$SdkPath
  $env:GRADLE_USER_HOME=$gradleHome; $env:TEMP=$tempDirectory; $env:TMP=$tempDirectory
  $env:PATH=(Join-Path $JavaHome 'bin')+';'+$env:PATH
  & (Join-Path $PSScriptRoot 'init-signing.ps1') -JavaHome $JavaHome
  if ($LASTEXITCODE -ne 0) { throw 'Signing initialization failed.' }
  if (-not $SkipWeb) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
  & (Join-Path $projectRoot 'node_modules\.bin\cap.cmd') sync android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
  Push-Location (Join-Path $projectRoot 'android')
  try { & '.\gradlew.bat' (':app:assemble'+$BuildType) --no-daemon --console plain '-Dorg.gradle.internal.instrumentation.agent=false' } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
  $variant=$BuildType.ToLowerInvariant()
  $apk=Join-Path $projectRoot ('android\app\build\outputs\apk\'+$variant+'\app-'+$variant+'.apk')
  if (-not (Test-Path -LiteralPath $apk)) { throw 'Expected APK was not produced.' }
  $destination=Join-Path $artifacts ('jizhang-jianjie2-'+$variant+'.apk')
  Copy-Item -LiteralPath $apk -Destination $destination -Force
  & (Join-Path $SdkPath 'build-tools\36.1.0\apksigner.bat') verify --verbose --print-certs $destination
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  & (Join-Path $SdkPath 'build-tools\36.1.0\zipalign.exe') -c -P 16 4 $destination
  if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed.' }
  $hash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{file=[IO.Path]::GetFileName($destination);sha256=$hash;bytes=(Get-Item -LiteralPath $destination).Length;variant=$variant;builtAt=[DateTimeOffset]::Now.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts ($variant+'-build.json')) -Encoding utf8
  Write-Output ('APK: '+$destination)
  Write-Output ('SHA256: '+$hash)
} finally {
  Pop-Location
  foreach($name in $variables) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
}
