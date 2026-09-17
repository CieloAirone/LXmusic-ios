# LX Music 非官方 iOS 移植工程

**状态：移植开发版源码，尚未经过 Xcode 编译或真机验收，不是可直接安装的 IPA，也未达到功能完整交付标准。**

以 `lyswhut/lx-music-mobile` 1.9.0（提交 `cd37a979a5845f1220b306b374285f5d38329e8d`）为基线。保留原版页面、主题、资源、搜索、歌单、歌词及同步业务逻辑。原作者不维护此移植版；上游许可证和项目协议见 LICENSE、README.md。

## 已添加的实现

- CocoaPods 本地 LXPlatform 模块：RSA/AES/SHA1、独立 JavaScriptCore 音源运行环境、文件导入、系统设备接口、本地媒体信息读取。
- iOS 文件系统、备份 gzip、缓存、分享、常亮、语言识别和窗口尺寸适配。
- 原版 Android 抽屉的 iOS 手势实现；页面使用安全区，原版页面内容继续复用。
- 播放器平台适配：修复 Android 扩展方法在 iOS 不存在及参数不匹配，增加完整音频文件缓存，保留后台音频及锁屏控制配置。
- 原版图标、icomoon 字体、深链接、文件打开声明和“文件”应用文稿目录访问。
- Android 专属功能的设置调整及非官方版本标识。
- macOS 构建脚本、手动 GitHub Actions 流程、JS 兼容测试和待在 macOS 执行的原生加密测试。

## Linux 上已执行的检查

- iOS 专用 TypeScript 检查通过。
- 7 项 Node 测试通过：音源协议、全字节/Unicode 转换、取消及错误处理、播放器桥接、gzip 互通、缓存并发及清理、同步服务 PEM 密钥兼容。
- iOS Release JavaScript 打包通过；通过 source map 确认 iOS 适配模块被正确选择。
- Android Release JavaScript 对照打包通过；未误包含新增 iOS 模块。
- 新增适配代码的定向 ESLint 检查、plist/XML 和构建脚本语法检查通过。

以上不等于 Xcode 编译通过、模拟器运行通过或真机功能通过。Node 测试中的原生服务为模拟接口，不能替代 Security/JavaScriptCore/UIKit 的实际测试。

## 本地检查

```bash
npm ci --include=dev
npm run check:ios
npm run bundle:ios
```

输出 `build/ios-js/main.jsbundle` 和资源，只是 JavaScript 包，不是 App。

## Mac 上构建

目标为 iOS 15 及以上。需要完整 Xcode、已安装的 iOS SDK/模拟器、Node 20、Ruby 3.2 和 Bundler。依赖仍基于上游 React Native 0.73.11，首次使用当前 Xcode 可能需要进一步兼容修复。

```bash
npm ci --include=dev
npm run build:ios:simulator
```

脚本自动安装 Ruby/Pods 依赖，使用 Release 模式内嵌 JS，不要求另开 Metro。

运行原生测试，模拟器名称需与 `xcrun simctl list devices available` 一致：

```bash
IOS_TEST_DESTINATION='platform=iOS Simulator,name=iPhone 16' npm run test:ios:native
```

生成未签名设备构建：

```bash
npm run build:ios:archive
```

成功后输出 `build/LXMusic-unsigned.ipa`。**它未签名，必须通过适用的开发签名/分发流程签名后才能安装到 iPhone。**

若使用 Xcode 真机安装：先执行构建脚本完成 Pods 安装，打开 `ios/LxMusicMobile.xcworkspace`，为 App 配置自己的唯一 Bundle Identifier、开发 Team 和自动签名，选择设备运行。默认工程标识只是占位，不包含任何账户或证书。

## GitHub Actions 构建（推荐给没有 Mac 的使用者）

上传和运行步骤见 [GITHUB-ACTIONS-使用说明.md](GITHUB-ACTIONS-使用说明.md)。

仓库包含 `.github/workflows/ios-build.yml`，手动触发后在 macOS runner 执行检查、可选模拟器原生测试、设备归档，上传未签名 IPA。此流程目前只写入本地工程，**没有上传仓库或执行云端构建**。只有实际运行成功后才会有 IPA 产物；签名和真机验收仍需完成。

## 已知差异和未完成项

| 项目 | 当前状态 |
| --- | --- |
| 跨应用悬浮歌词 | iOS 不支持原版形式；显示说明，保留应用内歌词和锁屏控制 |
| 文件管理 | 文件通过系统选择器复制到 Documents/Imports；目录操作限于沙盒文稿目录；尚不支持原版式外部目录持久授权 |
| 本地音乐信息编辑 | 在应用内持久保存，界面有说明；**尚未实现写回原音频标签**，跨应用读取不会看到这些编辑 |
| 音频格式 | 使用系统 AVFoundation/TrackPlayer；**OGG 等格式的等价支持尚未完成**，MP3/AAC/FLAC/WAV 也需真机样本验证 |
| 音频缓存 | 完整文件缓存，不是 Android 的分段缓存；首次播放同时下载缓存会增加流量，短期签名链接变化会影响命中 |
| 锁屏歌词 | 可通过原有标题更新机制展示当前行；没有承诺整首歌词通过蓝牙协议传输 |
| APK 更新和电池白名单 | 移除对应 iOS 无效入口；使用原安装渠道更新 |
| 备份迁移 | 共享备份格式已测 gzip 互通；完整歌单/设置导入和还原需端到端验证，Android 文件路径不会自动变成 iOS 路径 |
| UI | 复用原版页面；安全区及抽屉有平台适配；尚未进行模拟器截图和原版逐页像素对照 |
| 音源 | 需要用户提供有效自定义源；运行环境与桥接代码已实现，真实源脚本尚未在 iPhone 验证 |
| 原生构建/签名 | 未执行，无已签名 IPA |

必须完成的真机验收：首次启动及协议弹窗、搜索/歌单/榜单、音源导入、在线播放与本地播放、切歌/拖动/倍速、歌词和翻译、断网及缓存、锁屏及长时间后台、来电及耳机中断、蓝牙与 AirPlay、同步服务互通、备份恢复、文件导入、横竖屏和所有主题。

HTTP 访问策略沿用可连接用户自选音源和同步服务器的需求；Info.plist 已允许 HTTP。未加入源地址、账号或凭据。
