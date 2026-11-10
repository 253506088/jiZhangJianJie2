# 一键构建 Android APK

在项目根目录双击 **build-apk.bat**。成功后得到：

`artifacts/jizhang-jianjie2-release.apk`

同时生成带名称与版本的同内容副本，例如 `artifacts/简洁记账·新-1.1.0-release.apk`。根目录的“简洁记账.apk”是保留的原版4.8.8，不能用它验证新版；新旧包名不同，可并存。

窗口会保留完整错误或成功信息。首次构建需要下载依赖，后续会复用 D 盘缓存。脚本会编译前端、同步 Capacitor、构建 Release、验证签名与16KB对齐；任一步失败都会返回非零退出码，旧APK不能当作这次成功的产物。

无交互终端/自动化可运行 `build-apk.bat --no-pause`。

## 本机前提

- 已有 Node.js 24.13.0；本项目不需要 REA 的24.22.2，不自动切换nvm。
- 已有 JDK21：默认用户目录 `.jdks/corretto-21.0.10`。
- 已有 Android SDK：默认 `%LOCALAPPDATA%/Android/Sdk`，平台36与Build Tools36.1.0。
- 构建脚本优先使用 PowerShell7，未安装时使用 Windows PowerShell；ExecutionPolicy仅限该进程。
- 缺少node_modules时一键脚本执行npm ci，使用项目.npmrc指定的D盘缓存。

路径不同时可直接运行：

```powershell
pwsh -NoProfile -File scripts/build-android.ps1 -BuildType Release -JavaHome "D:\JDK21" -SdkPath "D:\Android\Sdk" -BuildCache "D:\jizhang-cache"
```

## 签名和更新

正式包名为 `dev.keepaccounts.jianjie2`，与原版 `com.yu.keepaccounts` 独立，可同时安装。手机运行编译后的界面和本地数据库，不需要Node.js服务。

**请单独安全备份 `.local/signing` 整个目录。** 它包含本项目的私钥和签名配置，不提交Git；更新已经安装的App必须继续使用相同签名。公开证书指纹在 `docs/signing-public.json`。如果已存在公开身份但私钥缺失，脚本会停止，不会悄悄生成另一把钥匙。

从Git重新克隆时，应恢复这份私钥与配置再构建原身份的升级包。维护新版本时同时更新package.json和Android的versionName/versionCode。

Debug仅用于隔离测试，可用 `-BuildType Debug` 构建；日常安装选择Release。

所有镜像、AVD和缓存的位置及删除方法见 [LOCAL-TOOLS.md](LOCAL-TOOLS.md)。签名私钥不能当缓存删除。
