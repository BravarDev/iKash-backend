# ==========================================
# CONFIGURACIÓN DE VARIABLES
# ==========================================
$projectId   = "ikash-p2p-application"
$serviceName = "ikash-backend-dev"
$region      = "us-central1"
$repoName    = "ikash-repo"
$tagName     = "latest" # Puedes cambiarlo por un hash de commit o versión en el futuro

# Forzar despliegue desde cero (True = Ignora validaciones y hace todo / False = Salta pasos si ya existen)
$forceRebuild = $true

# Construcción de la URL de la imagen
$registryUrl = "${region}-docker.pkg.dev"
$imageName   = "${registryUrl}/${projectId}/${repoName}/${serviceName}:${tagName}"

# ==========================================
# 1. AUTENTICACIÓN INTELIGENTE
# ==========================================
Write-Host "🔐 Verificando autenticación de Google Cloud..." -ForegroundColor Cyan

$currentAccount = gcloud config get-value account 2>$null

if ([string]::IsNullOrEmpty($currentAccount) -or $forceRebuild) {
    Write-Host "🔄 No hay sesión activa o se solicitó reconstrucción. Iniciando gcloud login..." -ForegroundColor Yellow
    gcloud auth login
    gcloud config set project $projectId
} else {
    Write-Host "✅ Ya autenticado como: $currentAccount" -ForegroundColor Green
    # Asegurar que el proyecto actual sea el correcto
    gcloud config set project $projectId --quiet
}

# ==========================================
# 2. VALIDACIÓN DE IMAGEN EN ARTIFACT REGISTRY
# ==========================================
Write-Host "🐳 Verificando si la imagen ya existe en Artifact Registry..." -ForegroundColor Cyan

# Buscamos si la imagen con el tag específico ya existe en el repositorio
$imageExists = $null
if (-not $forceRebuild) {
    $imageExists = gcloud artifacts docker images list "${registryUrl}/${projectId}/${repoName}/${serviceName}" `
        --filter="tags=$tagName" --format="value(IMAGE)" 2>$null
}

if ($imageExists -and $forceRebuild -eq $false) {
    Write-Host "⏭️ La imagen ya existe en Artifact Registry con el tag [$tagName]. Saltando compilación y push." -ForegroundColor Green
} else {
    Write-Host "🛠️ La imagen no existe o se forzó el inicio desde cero. Compilando..." -ForegroundColor Yellow
    
    # Autenticar Docker con el registro regional
    gcloud auth configure-docker $registryUrl --quiet

    # Build de la imagen Docker
    docker build -t $imageName .
    if ($LASTEXITCODE -ne 0) { throw "Error al compilar la imagen Docker." }

    # Push de la imagen Docker
    Write-Host "🚀 Subiendo imagen a Artifact Registry..." -ForegroundColor Yellow
    docker push $imageName
    if ($LASTEXITCODE -ne 0) { throw "Error al subir la imagen a Artifact Registry." }
    
    Write-Host "✅ Imagen compilada y subida con éxito." -ForegroundColor Green
}

# ==========================================
# 3. PREPARACIÓN DE CONFIGURACIONES (ENV & SECRETS)
# ==========================================
$envVars = @(
    "DIDIT_API_URL=https://verification.didit.me/v3",
    "STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org",
    "STELLAR_NETWORK=testnet",
    "TRUSTLESS_WORK_API_URL=https://dev.api.trustlesswork.com",
    "TRUSTLESS_WORK_USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "IKASH_PLATFORM_FEE=1"
) -join ","

$secretVars = @(
    "DIDIT_API_KEY=DIDIT_API_KEY:latest",
    "DIDIT_WEBHOOK_SECRET=DIDIT_WEBHOOK_SECRET:latest",
    "DIDIT_WORKFLOW_ID=DIDIT_WORKFLOW_ID:latest",
    "STELLAR_SIGNER_SECRET=STELLAR_SIGNER_SECRET:latest",
    "DATABASE_URL=DATABASE_URL:latest",
    "DIRECT_URL=DIRECT_URL:latest",
    "TRUSTLESS_WORK_API_KEY=TRUSTLESS_WORK_API_KEY:latest",
    "IKASH_TREASURY_ADDRESS=IKASH_TREASURY_ADDRESS:latest",
    "IKASH_SUPPORT_ADDRESS=IKASH_SUPPORT_ADDRESS:latest",
    "IKASH_DEPLOYER_SECRET=IKASH_DEPLOYER_SECRET:latest"
) -join ","

# ==========================================
# 4. DESPLIEGUE A CLOUD RUN
# ==========================================
Write-Host "🚀 Iniciando despliegue en Cloud Run..." -ForegroundColor Cyan

gcloud run deploy $serviceName `
  --image $imageName `
  --platform managed `
  --region $region `
  --allow-unauthenticated `
  --set-env-vars $envVars `
  --set-secrets $secretVars `
  --timeout 300 `
  --cpu 2

if ($LASTEXITCODE -eq 0) {
    Write-Host "🎉 ¡Servicio desplegado exitosamente!" -ForegroundColor Green
} else {
    Write-Warning "❌ El despliegue de Cloud Run ha fallado."
}