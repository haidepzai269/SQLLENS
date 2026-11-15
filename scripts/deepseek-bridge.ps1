# SQLLens - DeepSeek Freebuff Bridge Launcher
# Chạy script này để mở Freebuff với đầy đủ context dự án và task mới nhất

$repoRoot = "c:\SQLLens"
Set-Location $repoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SQLLENS -> DEEPSEEK V4.1 (FREEBUFF BRIDGE)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

if (Test-Path "$repoRoot\DEEPSEEK_TASK.md") {
    Write-Host "[OK] Đã phát hiện file chỉ thị: DEEPSEEK_TASK.md" -ForegroundColor Yellow
    Write-Host "Mẹo: Trong Freebuff, bạn chỉ cần gõ: @DEEPSEEK_TASK.md triển khai task này" -ForegroundColor DarkGray
} else {
    Write-Host "[INFO] Chưa có DEEPSEEK_TASK.md mới. Antigravity sẽ lập task khi bạn yêu cầu." -ForegroundColor DarkGray
}

Write-Host "`nĐang khởi chạy Freebuff CLI..." -ForegroundColor Cyan
freebuff --trust-agents
