param([string]$JavaHome = (Join-Path $env:USERPROFILE '.jdks\corretto-21.0.10'))
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signingDirectory = Join-Path $projectRoot '.local\signing'
$propertiesPath = Join-Path $signingDirectory 'release.properties'
$publicPath = Join-Path $projectRoot 'docs\signing-public.json'
$keyPath = Join-Path $signingDirectory 'jianjie-release.p12'
$keytool = Join-Path $JavaHome 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'JDK keytool was not found. Pass -JavaHome with an installed JDK 21 path.' }
if (Test-Path -LiteralPath $propertiesPath) {
  if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Signing configuration exists but the private key is missing. Restore the original key backup.' }
  Write-Output 'Existing project signing identity retained.'
  exit 0
}
if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $publicPath)) {
  throw 'An earlier signing identity exists. Restore its private properties/key; do not silently generate a replacement.'
}
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$acl = Get-Acl -LiteralPath $signingDirectory
$acl.SetAccessRuleProtection($true, $false)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $signingDirectory -AclObject $acl
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$password = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
$previousSecret = [Environment]::GetEnvironmentVariable('JIZHANG_SIGNING_SECRET', 'Process')
try {
  $env:JIZHANG_SIGNING_SECRET = $password
  & $keytool -genkeypair -alias jianjie-release -keyalg RSA -keysize 3072 -validity 10000 -storetype PKCS12 -keystore $keyPath -storepass:env JIZHANG_SIGNING_SECRET -keypass:env JIZHANG_SIGNING_SECRET -dname 'CN=JizhangJianJie2 Local Release'
  if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed.' }
  $properties = @('storeFile=.local/signing/jianjie-release.p12',('storePassword='+$password),'keyAlias=jianjie-release',('keyPassword='+$password)) -join "`n"
  [IO.File]::WriteAllText($propertiesPath, $properties, [Text.UTF8Encoding]::new($false))
  $certificatePath = Join-Path $signingDirectory 'release.cer'
  & $keytool -exportcert -alias jianjie-release -keystore $keyPath -storepass:env JIZHANG_SIGNING_SECRET -file $certificatePath
  if ($LASTEXITCODE -ne 0) { throw 'Public certificate export failed.' }
  $fingerprint = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{ appId='dev.keepaccounts.jianjie2'; alias='jianjie-release'; certificateSha256=$fingerprint; note='Public fingerprint only. The private key and passwords must stay in .local/signing or a secure user backup.' } | ConvertTo-Json | Set-Content -LiteralPath $publicPath -Encoding utf8
  Write-Output 'Created project-local signing identity. Back up .local/signing securely; it is excluded from Git.'
} finally {
  if ($null -eq $previousSecret) { Remove-Item Env:JIZHANG_SIGNING_SECRET -ErrorAction SilentlyContinue } else { $env:JIZHANG_SIGNING_SECRET=$previousSecret }
  $password=$null
}
