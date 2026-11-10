# 1.0.0 历史验收与交付依据

当前版本已更新至1.0.1，MuMu兼容性修复、对应APK及验证记录见 [MUMU-COMPAT.md](MUMU-COMPAT.md)。本文件保留1.0.0的历史证据，不代表后续版本APK的摘要。

核对日期：2026-11-09。所有流水、联系人、导出文件和测试数据库均为虚构。没有读取用户真实Excel、备份或手机数据。

## 交付包身份

| 项目 | 值 |
| --- | --- |
| 保留的历史文件 | .tools/mumu-compat/baseline-1.0.0.apk（不进Git） |
| 版本 | 1.0.0 / versionCode 1 |
| 包名 | dev.keepaccounts.jianjie2 |
| 大小 | 4,702,458 字节 |
| APK SHA-256 | f30a5783ef53a33a07ce8302d892e14804981b290898180adbac3746ce453da4 |
| 签名证书SHA-256 | 8a5a7549013e7e34af9b66cebee59b64ce71faf1b0bc1a36de11345258144511 |
| 功能代码版本 | 00c1670；后续为验收和交付文档 |

该文件经build-apk.bat实际构建，签名验证与16KB对齐通过。API36专用AVD安装的是同一SHA文件，无DEBUGGABLE/INTERNET权限。APK和私钥不进Git；公开签名身份见signing-public.json。

## 要求与证据对应

| 要求 | 实现与验收证据 |
| --- | --- |
| 当前根目录、React/TypeScript/Vite/Capacitor、隔离预览 | 根src/main.tsx → App → 正式Repository；prototypes/ui-v1有独立5174入口。createEmptyState不含流水或分类；首次启动浏览器测试及原生空账本检查通过。 |
| 延续主要UI与操作习惯 | 原版未修改APK实测四页签、成员/借贷人、概况首页、两级支出/单层收入、数字键盘、再记一笔、预算。LEGACY-FORMAT.md明确事实与新设计选择；legacy-v2、legacy-save-again、budgets-and-repeat用例覆盖。 |
| 用户手动Excel初始化 | 真实原包生成的虚构.xls夹具、SheetJS生成的.xlsx，各经过选择→工作器→映射→预览→原子保存。Android系统DocumentsUI实际选文件；不需要上传给助手。 |
| 修复换机后分类与报表割裂 | native-30-regression.json及截图：原版两笔20元导入后，直接使用原父子分类再记10元，同一categoryId、3笔30元，强停重开保留。核心、导入及浏览器同场景通过。 |
| 避免同名子类错误合并 | 唯一范围含账本/收支/完整父子路径；测试覆盖不同父级“其他”、不同账本、改名/合并与旧路径别名再导入。模板/预算关联同步迁移。 |
| 金额与重复数据安全 | 整数分、未知负数拒绝、损坏日期/精度校验。独立重复流水保留；同文件按来源识别，删除后重导不复活；不同文件重叠仅提示，不按相同内容擅自删除。 |
| 日常功能可用 | 明细搜索编辑删除、账户期初余额、多账本、成员/联系人管理、分类排序归档、模板、预算和报表钻取已纳入29项浏览器流程。 |
| 备份与失败保护 | 明文/加密备份往返、错误密码不写库、明确覆盖确认、取消保留原状态；存储摘要和版本冲突、损坏保存点保护。实际SAF保存并读回校验文本与Excel。 |
| Android操作 | native-back-ime.json：物理返回、金额键盘、未保存确认、系统IME实际输入、取消和放弃、夜间模式；Release系统选择器再次导入原文件为0笔且按钮禁用。 |
| 最终Release持久化 | Release覆盖安装后导出备份与升级前状态完全相等；直接用数字键盘新记10元，强停重开显示4笔40元。release-acceptance.json绑定APK SHA。 |
| 大账本与升级 | large-upgrade-verified.json：10,000笔v1→v2，约4.16MB→4.85MB，旧ID/金额/日期时间/备注保留，未知成员明确标记。SQLite通过流式读取绕过CursorWindow限制。 |
| 最终Release大账本往返 | release-large-roundtrip.json：同一交付APK实际系统选择器恢复10,000笔，强停重开后再次通过SAF导出4,849,509字节；备份内全部状态与源逐字段完全相等。 |
| 可维护、可重建 | package-lock锁定依赖；UI/规则/存储/文件模块分开；BUILD.md和build-apk.bat提供签名Release构建。Node/nvm/Java与持久PATH未改动，D盘缓存说明明确。 |
| 不提交隐私和生成物 | git ls-files检查无APK、数据库、备份、签名密钥、.local、.tools和analysis；git check-ignore逐项通过。只有已证实完全虚构的精选Excel夹具进入Git。原APK哈希保持不变。 |

## 已执行的检查

- `npm test`：14个测试文件，140项通过。
- `npx playwright test --output=.tools/e2e-release-candidate`：29项通过，截图和失败追踪保存在项目D盘临时目录；最后运行状态passed。
- `npm run format:check`、TypeScript检查、Vite构建通过。
- `build-apk.bat --no-pause`：签名Release构建、apksigner和zipalign检查通过；脚本失败会明确保留错误，不将旧APK冒认为新产物。
- Android专用AVD `jianjie_verify36` / API36，adb5051、模拟器5586；验证只使用这个项目的实例。
- 原生Release文件和滚动验收通过真实触摸/系统选择器执行。大账本冷启动、系统文件保存和辅助功能树更新需要等待完成，不将过早读取到的旧页面视为操作失败或重复执行写入。

## 覆盖范围

兼容依据是简洁记账4.8.8的实际导出格式和主要日常流程；不是恢复原工程源码，也不承诺每个隐藏功能或每个厂商机型像素级一致。Android7.0及以上需要WebView111或更新版本，实际原生验收设备为API36。用户最终真实迁移与对账由用户自己在设备上完成。

Excel不含期初余额、完整分类身份、预算或模板；完整迁移使用.jzbackup。导入/备份的大小上限与设备内存限制见README。真实账本不属于开发验收输入。

大部分原始截图、模拟器日志和测试备份在`.tools/native-test`、`.tools/e2e-release-candidate`；旧版调查原始证据在analysis/legacy-lab。这些保留本地，不上传Git。工具删除与私钥保留规则见LOCAL-TOOLS.md。
