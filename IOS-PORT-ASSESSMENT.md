# iOS 移植初步核查

本文件为移植方新增，非上游官方文档。

> 2026-09-17 更新：用户已接受 iOS 系统差异，现已加入移植代码。最新实现、检查结果和未完成项以 [IOS-README.md](IOS-README.md) 为准；以下保留初次核查记录。

## 基线与初次核查状态

- 上游：https://github.com/lyswhut/lx-music-mobile
- 核查提交：`cd37a979a5845f1220b306b374285f5d38329e8d`
- package.json 版本：1.9.0；React Native 0.73.11。
- 已完成源码获取和静态核查；尚未实现移植、安装依赖、编译 iOS 或进行真机验证。此目录不是可安装的 iOS 成品。
- 保留上游 LICENSE、README 中项目协议和作者信息。后续发布应说明为非官方移植并标注修改。

## 推荐实现路线

以安卓版为 UI 和功能基准，继续使用原有 React Native 页面、组件、资源、主题和业务逻辑，在平台边界添加 iOS 实现。不要另造一套外观相似但功能不完整的播放器。桌面版属于另一个项目，不能把桌面版独有功能默认为本次移动版已有功能。

| 范围 | 源码证据 | 必要工作 |
| --- | --- | --- |
| 页面、主题、图标 | src/screens、src/components、src/theme、src/resources | 复用，验证字体、导航、安全区、键盘、横竖屏及不同尺寸截图 |
| iOS 工程 | ios/Podfile、ios/LxMusicMobile/AppDelegate.mm | 已有工程骨架；核实 Pods、导航启动、资源和签名配置 |
| 音频播放与锁屏控制 | src/plugins/player；自定义 react-native-track-player Git 依赖 | 核查缓存、标题更新等扩展接口在 iOS 的实现，适配后台音频、中断、耳机控制和队列 |
| 自定义音源 | src/utils/nativeModules/userApi.ts；android 下 userApi 模块 | 实现 iOS 脚本运行环境和事件协议，验证请求、取消、异常和生命周期；不能直接运行 Java 模块 |
| 加密与同步 | src/utils/nativeModules/crypto.ts；src/plugins/sync | 实现并测试相同加密格式及协议，验证与现有同步服务互通 |
| 文件与备份 | src/utils/fs.ts 的 AndroidScoped 调用 | 改用 iOS 文档选择、沙盒存储与授权文件访问，验证导入导出及本地音乐 |
| 系统工具和缓存 | src/utils/nativeModules/utils.ts、cache.ts | 实现 iOS 对应模块，移除启动时对不存在模块的直接依赖 |
| 权限与提示 | src/utils/tools.ts | 处理 Android 权限、Toast 和退出操作的平台差异 |
| 桌面悬浮歌词 | src/utils/nativeModules/lyricDesktop.ts；Android LyricModule | 普通 iOS 应用无法原样实现跨应用任意悬浮窗口；替代形式需明确约定，不能宣称等价 |

## 不能照搬的系统行为

应用内页面可以以高度一致为目标，但需要模拟器及真机截图逐页验收后才能声明视觉一致。系统文件选择器、权限弹窗、通知/锁屏媒体控件由 iOS 管理，不能保证与 Android 相同。APK 更新安装、电池优化白名单等 Android 专有操作需要采用 iOS 对应流程。普通未越狱 iOS 上的跨应用悬浮歌词不能按 Android 原样实现。

## 构建和验收条件

当前工作环境为 Linux，不能执行 Xcode 编译和 iOS 模拟器验证。需要可用的 Mac/Xcode 或 macOS 构建服务；安装到 iPhone 的产物还需要适用的签名与分发方式。不得把 JS 打包成功视为 iOS 编译成功，也不得把未签名产物称为可直接安装的 IPA。

实现后需验收：首次启动、导航与主题、搜索及歌单、音源导入及播放、队列和播放模式、歌词及翻译、后台及锁屏播放、耳机及来电中断、文件导入导出、数据恢复、同步、缓存、断网及异常恢复。在线播放还依赖用户配置的有效自定义音源；源码自身不提供所有歌曲的音频链接。

用户已确认接受 iOS 系统差异，移植已开始；功能完整性和视觉一致性仍须以验收结果为准。
