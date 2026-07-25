# 供应链攻击检测

依赖图供应链安全。声明式 campaign + provenance + IOC。

## 攻击模式
- npm / AUR / pypi 恶意包
- 跨生态 payload（AUR 投递 npm 包）
- infostealer + eBPF rootkit 打 dev 凭证 / CI secrets

## 防护
- campaign 声明（lists / ioc_files / sources / date_window）
- 跨生态列表（AUR 攻击的 payload 是 npm 包）
- 活更新源（refresh_url）
- quarantine-before-activation（扩展先进隔离区再激活）

## 落地
scanners 按 campaign.type 分发，新生态 = 加 scanner + 新 type，不改现有 campaign。
