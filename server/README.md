# 服务器更新监控

已部署服务：`lx-ios-monitor.service`，每 300 秒检查 `lyswhut/lx-music-mobile` 最新正式 Release（不跟随每次代码提交或预发布）。

- 程序：`/opt/lx-ios-monitor/monitor.py`
- 私有凭据：`/etc/lx-ios-monitor.env`（0600，勿上传到 GitHub）
- 持久状态：`/var/lib/lx-ios-monitor/state.json`
- 开机自启，异常退出 30 秒后重启；网络检查失败下轮重试。
- 同一 Release 成功触发后不反复触发。构建失败、代码冲突不会无限消耗构建额度，需要修复后在 GitHub 重跑。
- 服务器触发上游同步；GitHub Actions 在 macOS 编译并测试。成功后发布上游版本对应的预发布 Release，含未签名 IPA 和 SHA256。
- 主分支提交仍会构建并发布。上游分支保留 PR 供审阅，不强制合并到主分支。GitHub 每日定时检查作为补充。
- GitHub 授权撤销或失效后需要重新授权并更新私有环境文件，随后重启服务。

```bash
systemctl status lx-ios-monitor.service
journalctl -u lx-ios-monitor.service -n 50 --no-pager
systemctl restart lx-ios-monitor.service
systemctl disable --now lx-ios-monitor.service
```

图标使用原版 `doc/images/icon.png`。修复了丢弃 alpha 导致透明区域变灰的问题，正确合成白色背景后生成 iOS 图标；原图只有 200×200，无法宣称放大到 1024 后新增真实细节。iOS 圆角由系统处理。
