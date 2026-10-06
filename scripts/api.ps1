[CmdletBinding()]
param(
  [string]$Query,
  [string]$QueryFile,
  [string]$Variables = '{}',
  [string]$VariablesFile,
  [switch]$NoCache,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$usage = @'
Usage:
  .\scripts\api.ps1 -Query 'query { shop { name } }'
  .\scripts\api.ps1 -QueryFile .\query.graphql [-Variables '{"first":10}']
  .\scripts\api.ps1 -QueryFile .\query.graphql -VariablesFile .\variables.json

Options:
  -NoCache   Request a new Admin API access token instead of using the local cache
  -Help      Show this help without connecting to Shopify

Configuration is read from .env: SHOPIFY_STORE, SHOPIFY_CLIENT_ID,
SHOPIFY_CLIENT_SECRET, and optional SHOPIFY_API_VERSION (default: 2026-01).
'@

if ($Help) {
  Write-Output $usage
  exit 0
}

if (($Query -and $QueryFile) -or (-not $Query -and -not $QueryFile)) {
  Write-Error "Provide exactly one of -Query or -QueryFile.`n`n$usage"
  exit 1
}
if ($VariablesFile -and $Variables -ne '{}') {
  Write-Error 'Provide either -Variables or -VariablesFile, not both.'
  exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  Write-Error "Missing configuration file: $envPath"
  exit 1
}

$envValues = @{}
foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') {
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $envValues[$Matches[1]] = $value
  }
}

foreach ($key in @('SHOPIFY_STORE', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET')) {
  if (-not $envValues[$key]) {
    Write-Error "Missing $key in .env"
    exit 1
  }
}

$store = $envValues['SHOPIFY_STORE'] -replace '^https?://', '' -replace '/$', ''
$apiVersion = if ($envValues['SHOPIFY_API_VERSION']) { $envValues['SHOPIFY_API_VERSION'] } else { '2026-01' }
$cacheDirectory = Join-Path $repoRoot '.shopify'
$cachePath = Join-Path $cacheDirectory 'admin-api-token.json'

function Invoke-JsonPost {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Json,
    [hashtable]$Headers = @{}
  )

  $client = [System.Net.Http.HttpClient]::new()
  try {
    foreach ($header in $Headers.GetEnumerator()) {
      $client.DefaultRequestHeaders.Add($header.Key, [string]$header.Value)
    }
    $content = [System.Net.Http.StringContent]::new($Json, [System.Text.Encoding]::UTF8, 'application/json')
    $response = $client.PostAsync($Uri, $content).GetAwaiter().GetResult()
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $body = [System.Text.Encoding]::UTF8.GetString($bytes)
    if (-not $response.IsSuccessStatusCode) {
      throw "HTTP $([int]$response.StatusCode): $body"
    }
    return $body | ConvertFrom-Json
  }
  finally {
    $client.Dispose()
  }
}

$accessToken = $null
if (-not $NoCache -and (Test-Path -LiteralPath $cachePath -PathType Leaf)) {
  try {
    $cached = Get-Content -LiteralPath $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $expiresAt = [DateTimeOffset]::Parse($cached.expiresAt)
    if ($cached.store -eq $store -and $expiresAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
      $accessToken = $cached.accessToken
    }
  }
  catch {
    $accessToken = $null
  }
}

if (-not $accessToken) {
  $tokenPayload = @{
    client_id = $envValues['SHOPIFY_CLIENT_ID']
    client_secret = $envValues['SHOPIFY_CLIENT_SECRET']
    grant_type = 'client_credentials'
  } | ConvertTo-Json -Compress
  $tokenResponse = Invoke-JsonPost -Uri "https://$store/admin/oauth/access_token" -Json $tokenPayload
  if (-not $tokenResponse.access_token) {
    throw 'Shopify did not return an access token.'
  }
  $accessToken = $tokenResponse.access_token
  $lifetimeSeconds = if ($tokenResponse.expires_in) { [int]$tokenResponse.expires_in } else { 82800 }
  New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
  @{
    store = $store
    accessToken = $accessToken
    expiresAt = [DateTimeOffset]::UtcNow.AddSeconds($lifetimeSeconds).ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $cachePath -Encoding UTF8
}

$graphql = if ($QueryFile) { Get-Content -LiteralPath $QueryFile -Raw -Encoding UTF8 } else { $Query }
$variablesJson = if ($VariablesFile) { Get-Content -LiteralPath $VariablesFile -Raw -Encoding UTF8 } else { $Variables }
try {
  $variablesObject = $variablesJson | ConvertFrom-Json
}
catch {
  Write-Error "Variables must be valid JSON: $($_.Exception.Message)"
  exit 1
}

$requestBody = @{
  query = $graphql
  variables = $variablesObject
} | ConvertTo-Json -Depth 100 -Compress

$requestArguments = @{
  Uri = "https://$store/admin/api/$apiVersion/graphql.json"
  Json = $requestBody
  Headers = @{ 'X-Shopify-Access-Token' = $accessToken }
}
$result = Invoke-JsonPost @requestArguments

$jsonResult = $result | ConvertTo-Json -Depth 100
Write-Output $jsonResult
if ($result.errors) {
  exit 1
}
