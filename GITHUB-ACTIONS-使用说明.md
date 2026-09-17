# 上传 GitHub，手动生成 IPA

本包是非官方 iOS 移植开发工程。已配置 Actions，未在云端实际构建过；首次构建若失败，请下载日志供继续修复。功能完成度见 IOS-README.md。

1. 解压 `LXMusic-iOS-GitHub-Actions.zip`。
2. 新建自己的 GitHub 仓库，把解压后的**全部文件和文件夹**上传到仓库根目录。必须包含隐藏目录 `.github`，仓库首页应直接看到 `package.json`、`ios`、`scripts`，不要多套一层目录，也不要只上传 ZIP。
3. 提交到默认分支后，进入 **Actions → Build iOS IPA → Run workflow → Run workflow**。默认不勾选模拟器测试，直接进行代码检查和设备归档；需要额外原生测试时再勾选。
4. 运行成功后，在该次运行页面最下方 **Artifacts** 下载 `LXMusic-iOS-unsigned-运行编号`。
5. 解压下载包，得到 `LXMusic-unsigned.ipa` 和 SHA256 校验文件。

**无需配置 Secrets、Apple 账户或签名证书即可尝试构建未签名 IPA。未签名 IPA 不能直接安装，需要你自行签名。** 该流程不会发布 Release，不会上传 App Store，也不会访问你的其他仓库。

如果上传后 Actions 没有显示流程，首先检查 `.github/workflows/ios-build.yml` 是否在默认分支的这个准确路径。通过 GitHub 网页上传时，注意系统文件选择器可能隐藏点开头目录；必要时用 Git 客户端推送解压目录。

失败时：在运行页面查看红色步骤，并下载 `iOS-build-logs-运行编号`。如在安装 JS 依赖等早期步骤失败、没有日志产物，复制该步骤末尾的错误输出。原生日志可用于继续修复，而不是重新猜测构建配置。

构建固定使用 macOS 15、Xcode 16.4、Node 20、Ruby 3.2、CocoaPods 1.16.2；若 GitHub 将来移除该 Xcode 版本，需要调整工作流的 Xcode 路径。
