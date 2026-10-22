# Windows PowerShell: creates .env with random secrets, then builds and starts everything.
Set-Location $PSScriptRoot
function Rand($n) { $b = New-Object byte[] $n; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join "" }
if (Test-Path .env) { Write-Host ".env already exists - keeping it." }
else {
  $pw = Rand 8
  $envText = @"
POSTGRES_DB=smartroad
POSTGRES_USER=smartroad
POSTGRES_PASSWORD=$(Rand 16)
JWT_SECRET=$(Rand 32)
ADMIN_EMAIL=admin@smartroad.local
ADMIN_PASSWORD=$pw
MODEL_FILE=pothole.pt
MIN_CONFIDENCE=0.4
CORS_ORIGINS=http://localhost:8080
"@
  [System.IO.File]::WriteAllText("$PSScriptRoot\.env", $envText)
  Write-Host "Created .env. Admin login: admin@smartroad.local / $pw"
}
New-Item -ItemType Directory -Force models | Out-Null
if (-not (Test-Path models\pothole.pt)) { Write-Host "NOTE: models\pothole.pt not found. Detection returns an error until you train a model (see GUIDE.md step 2)." }
docker compose up --build -d
Write-Host "Open http://localhost:8080  (API docs: http://localhost:8000/docs)"
