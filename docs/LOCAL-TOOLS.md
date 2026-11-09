# 本项目的本机工具与清理

用户要求：新建模拟器和大型文件尽量放 D 盘，避免占用紧张的 C 盘；保持其他项目环境不变。

## 旧版原 APK 的隔离实验

- 实际目录：`D:\code\my\2\记账\.tools\legacy-lab`。
- 为规避 Android emulator 对中文命令行路径的兼容问题，创建目录联接：`D:\code\my\2\rea-legacy-lab-runtime` → 上述目录。它只是同一批文件的 ASCII 入口，不是另一份镜像或新开发项目。
- 新下载的 Android 30 Google APIs x86_64 镜像（压缩包约1.44GB）与 Android24 ARM 镜像（约284MB）、解压系统文件、所有实验 AVD 和虚拟磁盘、临时目录及日志都放在该 D 盘目录内。
- `ANDROID_USER_HOME`、`ANDROID_EMULATOR_HOME`、`ANDROID_AVD_HOME`、`TEMP`、`TMP` 只在本次实验启动进程中指向 D 盘目录，不修改用户全局设置。
- C 盘的 `C:\Users\black\AppData\Local\Android\Sdk\emulator` 与既有 platform-tools 是原先安装的共享程序，只复用，不搬动或删除。
- 实验专用 adb server 为端口 **5039**，模拟器 console/adb 为 **5584/5585**。只操作确认属于该实验的进程，不默认连接真实手机或用户其他 AVD。
- 精确启动参数、各环境观测、镜像官方来源/校验和位于 `analysis/legacy-lab/` 和 `.tools/legacy-lab/` 中的记录。

## 不需要实验环境时

1. 先保存需要的虚构样本、调查说明和截图。
2. 查询实时进程命令行与端口，确认拥有者仍是本项目实验实例。不要依据旧 PID 文件直接终止进程。
3. 仅停止该实例和端口5039的自有 adb server；不要执行全机的 emulator/adb/java/node 批量终止。
4. 确认它们已经退出后，核对实际路径，再删除 `.tools\legacy-lab`，其镜像、AVD、临时数据、实验签名密钥和日志均可一并清理。
5. 单独检查 `D:\code\my\2\rea-legacy-lab-runtime` 的 LinkType 为 Junction 且 Target 是本项目实验目录，然后只移除联接本身，**不要对联接执行递归删除**。

以上为清理说明，本轮没有执行上述删除。

旧版控制实验结束后，已停止本项目 ARM QEMU 与 5039 专用 adb；镜像和证据仍保留，停止进程不会删除它们。

## 新版 Android 验证环境

- 独立空白 AVD：`jianjie_verify36`，API36；仅安装本项目 App、使用固定虚构样本。
- 所有新增数据：`D:\code\my\2\记账\.tools\native-test`，所有权记录为其中的 `owner.json`。
- ASCII 目录联接：`D:\code\my\2\jizhang-native-test-runtime` → 上述目录；没有在 C 盘复制虚拟磁盘。
- 专用 adb server 为 **5051**；模拟器 console/adb 为 **5586/5587**；调试 WebView 的本地转发为 **9238**。不要使用 5040，该端口已有与本项目无关的 Windows 监听器。
- 清理时先核对 AVD 名称、实时进程命令行与 owner.json；只停止这个 AVD、5051 adb 和其端口转发。然后可删除这个项目专属 `.tools/native-test` 目录。最后单独核对并移除 ASCII 联接本身，禁止递归穿越联接。
- 此目录含自动化生成的 10,000 笔虚构压力数据、截图和测试备份。它们不进入 Git，也不是正式用户账本。
- `scripts/native/` 中的脚本会校验该 AVD 身份；部分脚本会写入虚构数据，仅供隔离验收，不能改为连接用户手机运行。
- 2026-11-09完成最终Release验收后，已正常停止本项目AVD、5051专用adb和9238调试转发；复核无相关残留进程。旧版ARM/5039也已停止。D盘镜像、AVD磁盘、原始证据和虚构测试备份保留，未执行删除。

## 前端与安卓构建

- Node.js 使用原有 24.13.0，不切换 nvm，也不依赖 REA 自带的 24.22.2。
- npm 已设置项目级 `.npmrc`，今后本项目包缓存写入 `.tools/npm-cache`（D盘）；不会清空系统共享 npm 缓存。
- 浏览器自动化的临时 profile、下载缓存和跟踪结果在 `.tools/test-tmp`、`.tools/e2e-results`（D盘），不使用用户浏览器 profile。
- 正式Web预览使用127.0.0.1:5173；当前保留本项目Vite进程便于查看。以后不需要时，先核对5173监听进程的命令行确实指向本目录node_modules/vite，再停止该进程；不要批量结束其他Node项目。
- Android 构建复用已有 JDK21：`C:\Users\black\.jdks\corretto-21.0.10`，仅设置构建进程的 JAVA_HOME/PATH。
- 初次插件编译复用了原有 Gradle 用户缓存。后续实际构建已改用 D 盘项目专属缓存；Windows在中文路径缓存中出现Gradle临时目录移动失败，因此缓存从 `.tools/gradle-home` 移到了 **`D:\code\my\2\.jizhang-gradle-cache`**（ASCII路径），并写入 `jizhang-owner.json` 标识所属项目。应用源代码没有搬走。
- 构建临时目录也位于该D盘缓存内的 `build-tmp`；构建脚本可通过 `-BuildCache` 显式指定另一个目录。没有通过回退到C盘解决缓存问题，也没有删除或改动其他项目共用的Gradle/SDK安装。
- 不再需要此构建缓存时，先确认本项目Gradle进程已退出，核对该目录中的owner记录后可删除整个 `.jizhang-gradle-cache`。这是可重新下载的缓存，不是签名密钥或用户账本。
- **签名密钥在 `.local/signing`（D盘项目内）**，与工具缓存不同。升级已安装App需要保留同一密钥；不要把它当缓存清掉。生成脚本在发现旧签名身份但私钥缺失时会拒绝静默创建新身份。私钥/密码不进Git，公开指纹记录在docs/signing-public.json。

`.tools/`、个人数据、签名密钥、原 APK、反编译生成物、日志与构建产物已由 `.gitignore` 排除。应用的源代码、测试、配置和本说明正常提交到 Git。
