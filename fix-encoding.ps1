$files = Get-ChildItem "C:\base-bangkago\web\BangkaGO-WEB\admin-dashboard\*.html", "C:\base-bangkago\web\BangkaGO-WEB\coastguard-dashboard\*.html", "C:\base-bangkago\web\BangkaGO-WEB\*.html" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    $original = $content
    $content = $content -replace [regex]::Escape("â€""), "—"
    $content = $content -replace [regex]::Escape("â€""), "–"
    $content = $content -replace [regex]::Escape("â€¢"), "•"
    $content = $content -replace [regex]::Escape("â€¦"), "..."
    $content = $content -replace [regex]::Escape("â‚±"), "₱"
    $content = $content -replace [regex]::Escape("â†'"), "→"
    $content = $content -replace [regex]::Escape("â€œ"), '"'
    $content = $content -replace [regex]::Escape("â€"), '"'
    if ($content -ne $original) {
        Set-Content $_.FullName -Value $content -Encoding UTF8
        Write-Host "Fixed: $($_.Name)"
    }
}