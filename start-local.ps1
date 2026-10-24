$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { $nodePath = $node.Source } else {
  $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 18+ to run this project.' }
Push-Location $PSScriptRoot
try { & $nodePath local/server.cjs } finally { Pop-Location }
