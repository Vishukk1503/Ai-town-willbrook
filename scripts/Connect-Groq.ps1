$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$secretValue = Read-Host 'Groq API key (hidden input)' -AsSecureString
$secretPointer = [IntPtr]::Zero
try {
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretValue)
    $plainValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ([string]::IsNullOrWhiteSpace($plainValue)) { throw 'No API key entered.' }
    Push-Location -LiteralPath $projectPath
    try {
        $plainValue | & node node_modules/convex/bin/main.js env set GROQ_API_KEY 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not set the key. Keep the configured Convex backend running.' }
    } finally { Pop-Location }
    Write-Host 'Groq key configured in the backend. Choose Groq in Models & usage.'
} finally {
    $plainValue = $null
    if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
    if ($secretValue) { $secretValue.Dispose() }
}
